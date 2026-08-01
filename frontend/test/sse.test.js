import test from "node:test";
import assert from "node:assert/strict";
import { createSseParser, readSseJsonStream } from "../src/api/sse.js";

const streamFromStrings = (...parts) => {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
};

test("parses fragmented UTF-8 SSE frames and ignores heartbeats", () => {
  const events = [];
  const malformed = [];
  const parser = createSseParser({
    onEvent: (event) => events.push(event),
    onMalformed: (error) => malformed.push(error),
  });
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const payload = [
    ': keep-alive\r\n\r\n',
    'data: {"type":"status","data":{"stage":"collecting_data"}}\r\n\r\n',
    'data: {"type":"delta","data":{"text":"Namasté ₹"}}\r\n\r\n',
    'data: {"type":"done","data":{"stopped":false}}\r\n\r\n',
  ].join("");
  const bytes = encoder.encode(payload);

  for (let index = 0; index < bytes.length; index += 3) {
    parser.push(decoder.decode(bytes.slice(index, index + 3), { stream: true }));
  }
  parser.finish(decoder.decode());

  assert.equal(malformed.length, 0);
  assert.deepEqual(events.map((event) => event.type), ["status", "delta", "done"]);
  assert.equal(events[1].data.text, "Namasté ₹");
});

test("reports malformed events without losing later valid frames", () => {
  const events = [];
  const malformed = [];
  const parser = createSseParser({
    onEvent: (event) => events.push(event),
    onMalformed: (error, data) => malformed.push({ error, data }),
  });

  parser.push('data: {bad json}\n\ndata: {"type":"done"}\n\n');
  parser.finish();

  assert.equal(malformed.length, 1);
  assert.deepEqual(events, [{ type: "done" }]);
});

test("returns the atomic result after a complete stream", async () => {
  const eventTypes = [];
  const result = await readSseJsonStream(
    streamFromStrings(
      'data: {"type":"delta","data":{"text":"Part"}}\n\n',
      'data: {"type":"result","data":{"success":true,"response":"Part"}}\n\n',
      'data: {"type":"done","data":{"stopped":false}}\n\n',
    ),
    { onEvent: (event) => eventTypes.push(event.type) },
  );

  assert.equal(result.response, "Part");
  assert.deepEqual(eventTypes, ["delta", "result", "done"]);
});

test("rejects a premature stream closure", async () => {
  await assert.rejects(
    readSseJsonStream(
      streamFromStrings('data: {"type":"delta","data":{"text":"Part"}}\n\n'),
    ),
    /ended before completion/,
  );
});

test("surfaces safe server error events", async () => {
  await assert.rejects(
    readSseJsonStream(
      streamFromStrings(
        'data: {"type":"error","data":{"error":"Safe failure","stopped":false}}\n\n',
        'data: {"type":"done","data":{"stopped":false}}\n\n',
      ),
    ),
    (error) => error.message === "Safe failure" && error.data?.stopped === false,
  );
});
