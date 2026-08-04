/**
 * FND-06 — Gmail and Calendar normalization smoke baseline.
 *
 * Normalization is where provider payloads become the unified document every
 * later stage assumes: the chunker splits `content`, the vector mapper reads
 * `metadata.gmail` / `metadata.calendar`, person resolution matches on the
 * sender and organizer, and ownership rides on `userId`. A normalizer that
 * quietly drops one of those fields breaks retrieval without breaking a build,
 * so each is asserted explicitly here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { GmailNormalizer } from "../../src/service/normalizers/GmailNormalizer.js";
import { GoogleCalendarNormalizer } from "../../src/service/normalizers/GoogleCalendarNormalizer.js";

import {
  CALENDAR_ALL_DAY_EVENT,
  CALENDAR_CANCELLED_EVENT,
  CALENDAR_TIMED_EVENT,
  GMAIL_EMPTY_MESSAGE,
  GMAIL_HTML_MESSAGE,
  GMAIL_MULTIPART_MESSAGE,
  GMAIL_PLAIN_MESSAGE,
  OWNER_USER_ID,
} from "../fixtures/fnd06-baseline-fixtures.js";
import {
  assertNormalizedDocumentUserScoped,
  assertNormalizedSourceMetadata,
} from "./baselineAssertions.js";

const gmail = new GmailNormalizer();
const calendar = new GoogleCalendarNormalizer();

/* -------------------------------------------------------------------------- */
/* Gmail                                                                       */
/* -------------------------------------------------------------------------- */

test("a plain-text email normalizes into the unified document shape", () => {
  const document = gmail.normalize(GMAIL_PLAIN_MESSAGE, OWNER_USER_ID);

  assertNormalizedDocumentUserScoped(document, OWNER_USER_ID);
  assertNormalizedSourceMetadata(document, "gmail");

  assert.equal(document.documentId, `gmail_${GMAIL_PLAIN_MESSAGE.id}`);
  assert.equal(document.type, "email");
  assert.equal(document.title, "Quarterly roadmap review");
  assert.equal(document.author, "Anand Rao <anand@example.com>");
  assert.equal(document.content, "Please send roadmap review comments by Friday.");
  assert.equal(document.indexed, false);
  assert.equal(document.embeddingId, null);
  assert.deepEqual(
    document.timestamp,
    new Date(Number(GMAIL_PLAIN_MESSAGE.internalDate)),
    "the message timestamp must come from internalDate",
  );
});

test("Gmail headers land in the metadata person resolution matches on", () => {
  const document = gmail.normalize(GMAIL_PLAIN_MESSAGE, OWNER_USER_ID);

  assert.deepEqual(document.metadata.gmail, {
    messageId: GMAIL_PLAIN_MESSAGE.id,
    threadId: GMAIL_PLAIN_MESSAGE.threadId,
    labelIds: ["INBOX", "IMPORTANT"],
    snippet: "Roadmap review comments by Friday",
    from: "Anand Rao <anand@example.com>",
    to: "me@example.com",
    subject: "Quarterly roadmap review",
    date: "Sat, 01 Aug 2026 15:30:00 +0530",
  });
});

test("a multipart email prefers the plain-text part, including nested parts", () => {
  const document = gmail.normalize(GMAIL_MULTIPART_MESSAGE, OWNER_USER_ID);

  assert.equal(document.content, "Notes from the design sync.");
  assert.equal(document.metadata.gmail.subject, "Design sync notes");
});

test("an HTML-only email is stripped to readable text", () => {
  const document = gmail.normalize(GMAIL_HTML_MESSAGE, OWNER_USER_ID);

  assert.equal(document.content, "Release v2 & notes");
  assert.ok(!document.content.includes("<"), "markup survived normalization");
  assert.ok(!document.content.includes("alert(1)"), "script content survived normalization");
});

test("a subject-less email keeps a stable placeholder title", () => {
  const document = gmail.normalize(
    {
      ...GMAIL_PLAIN_MESSAGE,
      payload: { ...GMAIL_PLAIN_MESSAGE.payload, headers: [] },
    },
    OWNER_USER_ID,
  );

  assert.equal(document.title, "(No Subject)");
  assert.equal(document.author, null);
});

test("an empty email is skipped rather than indexed", () => {
  assert.equal(gmail.normalize(GMAIL_EMPTY_MESSAGE, OWNER_USER_ID), null);
});

test("a malformed email is skipped instead of throwing at the sync boundary", () => {
  assert.equal(gmail.normalize({ id: "broken" } as never, OWNER_USER_ID), null);
});

test("very long email bodies are truncated to a bounded length", () => {
  const long = "a".repeat(40_000);
  const document = gmail.normalize(
    {
      ...GMAIL_PLAIN_MESSAGE,
      payload: {
        ...GMAIL_PLAIN_MESSAGE.payload,
        body: { data: Buffer.from(long, "utf-8").toString("base64") },
      },
    },
    OWNER_USER_ID,
  );

  assert.ok(document.content.endsWith("... [truncated]"));
  assert.ok(document.content.length <= 32_020);
  assert.equal(document.contentLength, 40_000, "contentLength records the pre-clean size");
});

test("a Gmail batch stamps every document with the syncing user and drops skips", () => {
  const documents = gmail.normalizeBatch(
    [GMAIL_PLAIN_MESSAGE, GMAIL_EMPTY_MESSAGE, GMAIL_MULTIPART_MESSAGE],
    OWNER_USER_ID,
  );

  assert.equal(documents.length, 2);
  for (const document of documents) {
    assertNormalizedDocumentUserScoped(document, OWNER_USER_ID);
    assertNormalizedSourceMetadata(document, "gmail");
  }
});

/* -------------------------------------------------------------------------- */
/* Calendar                                                                    */
/* -------------------------------------------------------------------------- */

test("a timed event normalizes into the unified document shape", () => {
  const document = calendar.normalize(CALENDAR_TIMED_EVENT, OWNER_USER_ID);

  assertNormalizedDocumentUserScoped(document, OWNER_USER_ID);
  assertNormalizedSourceMetadata(document, "calendar");

  assert.equal(document.documentId, "calendar_evt_9001");
  assert.equal(document.type, "event");
  assert.equal(document.title, "Design sync");
  assert.equal(document.author, "priya@example.com");
  assert.deepEqual(document.timestamp, new Date("2026-08-01T10:00:00.000Z"));
  assert.equal(document.metadata.calendar.is_all_day, false);
  assert.equal(document.metadata.calendar.calendar_id, "primary");
  assert.equal(document.metadata.calendar.html_link, CALENDAR_TIMED_EVENT.htmlLink);
});

test("event content carries the fields an answer has to cite", () => {
  const document = calendar.normalize(CALENDAR_TIMED_EVENT, OWNER_USER_ID);
  const lines = document.content.split("\n");

  assert.equal(lines[0], "Event: Design sync");
  assert.ok(lines[1]?.startsWith("Start: "));
  assert.ok(lines[2]?.startsWith("End: "));
  assert.ok(document.content.includes("Location: Meet"));
  assert.ok(
    document.content.includes("Description: Walk through the retrieval UI & states"),
    "the description was not stripped of markup",
  );
  assert.ok(document.content.includes("Attendees: me@example.com, Anand Rao <anand@example.com>"));
  assert.ok(document.content.includes("Organizer: Priya Menon"));
});

test("attendees are normalized with an explicit response status", () => {
  const document = calendar.normalize(CALENDAR_TIMED_EVENT, OWNER_USER_ID);

  assert.deepEqual(document.metadata.calendar.attendees, [
    {
      email: "me@example.com",
      displayName: null,
      responseStatus: "accepted",
      self: true,
    },
    {
      email: "anand@example.com",
      displayName: "Anand Rao",
      responseStatus: "needsAction",
      self: false,
    },
  ]);
});

test("an all-day event uses date boundaries and reports recurrence", () => {
  const document = calendar.normalize(CALENDAR_ALL_DAY_EVENT, OWNER_USER_ID);

  assert.equal(document.metadata.calendar.is_all_day, true);
  assert.ok(document.content.includes("Start: 2026-08-05"));
  assert.ok(document.content.includes("End: 2026-08-06"));
  assert.ok(document.content.includes("Recurring: yes"));
  assert.deepEqual(document.metadata.calendar.recurrence, ["RRULE:FREQ=YEARLY"]);
});

test("a cancelled event is skipped rather than indexed", () => {
  assert.equal(calendar.normalize(CALENDAR_CANCELLED_EVENT, OWNER_USER_ID), null);
});

test("a malformed event is skipped instead of throwing at the sync boundary", () => {
  assert.equal(calendar.normalize({ id: "broken", status: "confirmed" } as never, OWNER_USER_ID), null);
});

test("a calendar batch stamps every document with the syncing user and drops skips", () => {
  const documents = calendar.normalizeBatch(
    [CALENDAR_TIMED_EVENT, CALENDAR_CANCELLED_EVENT, CALENDAR_ALL_DAY_EVENT],
    OWNER_USER_ID,
  );

  assert.equal(documents.length, 2);
  for (const document of documents) {
    assertNormalizedDocumentUserScoped(document, OWNER_USER_ID);
    assertNormalizedSourceMetadata(document, "calendar");
  }
});

/* -------------------------------------------------------------------------- */
/* cross-source invariants                                                     */
/* -------------------------------------------------------------------------- */

test("both sources produce disjoint, source-prefixed document ids", () => {
  const email = gmail.normalize(GMAIL_PLAIN_MESSAGE, OWNER_USER_ID);
  const event = calendar.normalize(CALENDAR_TIMED_EVENT, OWNER_USER_ID);

  assert.ok(email.documentId.startsWith("gmail_"));
  assert.ok(event.documentId.startsWith("calendar_"));
  assert.notEqual(email.documentId, event.documentId);
  assert.deepEqual(
    [email.source, event.source],
    ["gmail", "calendar"],
    "the ingestion pipeline routes on these source keys",
  );
});
