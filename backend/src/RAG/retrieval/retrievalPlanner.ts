import type {
  OwnerId,
  VectorMetadata,
  VectorSearchFilters,
} from "../vectorStores/vectorStore.js";
import type {
  DateInput,
  PersonFilter,
  PersonRole,
  PlannedVectorSearch,
  RetrievalDateRange,
  RetrievalPlan,
  RetrievalPlanInput,
  RetrievalPlannerOptions,
  RetrievalPlannerResult,
  RetrievalSort,
  RetrievalSourceScope,
  RetrievalStrategy,
  TemporalIntent,
} from "./retrievalPlan.js";
import {
  personResolver,
  type PersonResolver,
} from "./personResolver.js";

export const DEFAULT_RETRIEVAL_PLANNER_OPTIONS: RetrievalPlannerOptions = {
  defaultSource: "all",
  defaultStrategy: "hybrid",
  defaultSort: "relevance",
  vectorTopK: 20,
  keywordTopK: 20,
  finalTopK: 8,
};

export interface ResolvedRetrievalPlanInput extends RetrievalPlanInput {
  resolver?: PersonResolver;
}

const DEFAULT_TIMEZONE = process.env.DEFAULT_USER_TIMEZONE || "UTC";

const GMAIL_SOURCE_PATTERN = /\b(gmail|email|emails|mail|mails|message|messages|inbox)\b/i;
const CALENDAR_SOURCE_PATTERN = /\b(calendar|event|events|meeting|meetings|schedule|appointment|appointments|organizer|organiser|organized|organised)\b/i;

const GMAIL_SOURCE_TERMS_PATTERN =
  /\b(gmail|email|emails|mail|mails|message|messages|inbox)\b/gi;
const CALENDAR_SOURCE_TERMS_PATTERN =
  /\b(calendar|event|events|meeting|meetings|schedule|appointment|appointments)\b/gi;
const CROSS_SOURCE_PATTERN =
  /\b(?:gmail|email|emails|mail|mails|inbox)\b[\s\S]*\b(?:and|or)\b[\s\S]*\b(?:calendar|events?|meetings?|appointments?)\b|\b(?:calendar|events?|meetings?|appointments?)\b[\s\S]*\b(?:and|or)\b[\s\S]*\b(?:gmail|email|emails|mail|mails|inbox)\b/i;

const LATEST_PATTERN =
  /\b(latest|newest|recent|most\s+recent)\b|\blast\s+(email|mail|message|gmail|event|meeting|appointment)\b/i;
const OLDEST_PATTERN = /\b(oldest|earliest|first)\b/i;

const DATE_PHRASE_PATTERN =
  /\b(today|yesterday|tomorrow|this\s+week|last\s+week|last\s+\d+\s+days?|past\s+\d+\s+days?)\b/gi;

const SORT_PHRASE_PATTERN =
  /\b(latest|newest|recent|most\s+recent|oldest|earliest|first)\b/gi;

const FROM_PERSON_PATTERN =
  /\bfrom\s+(.+?)(?=\s+(?:today|yesterday|tomorrow|this\s+week|last\s+week|last\s+\d+\s+days?|past\s+\d+\s+days?|latest|newest|recent|most\s+recent|oldest|earliest|first|about|regarding|related\s+to|on|before|after)\b|$)/i;

const WITH_PERSON_PATTERN =
  /\bwith\s+(.+?)(?=\s+(?:today|yesterday|tomorrow|this\s+week|last\s+week|last\s+\d+\s+days?|past\s+\d+\s+days?|latest|newest|recent|most\s+recent|oldest|earliest|first|about|regarding|related\s+to|on|before|after)\b|$)/i;

const ORGANIZER_PERSON_PATTERN =
  /\b(?:organized|organised)\s+by\s+(.+?)(?=\s+(?:today|yesterday|tomorrow|this\s+week|last\s+week|last\s+\d+\s+days?|past\s+\d+\s+days?|latest|newest|recent|most\s+recent|oldest|earliest|first|about|regarding|related\s+to|on|before|after)\b|$)/i;

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
}

interface DateRangeDetection {
  dateRange: RetrievalDateRange;
  matchedText: string;
}

function mergeOptions(
  options?: Partial<RetrievalPlannerOptions>,
): RetrievalPlannerOptions {
  const merged = { ...DEFAULT_RETRIEVAL_PLANNER_OPTIONS };

  for (const [key, value] of Object.entries(options ?? {})) {
    if (value !== undefined) {
      Object.assign(merged, { [key]: value });
    }
  }

  merged.vectorTopK = Number.isInteger(merged.vectorTopK) && merged.vectorTopK > 0
    ? merged.vectorTopK
    : DEFAULT_RETRIEVAL_PLANNER_OPTIONS.vectorTopK;
  merged.keywordTopK = Number.isInteger(merged.keywordTopK) && merged.keywordTopK > 0
    ? merged.keywordTopK
    : DEFAULT_RETRIEVAL_PLANNER_OPTIONS.keywordTopK;
  merged.finalTopK = Number.isInteger(merged.finalTopK) && merged.finalTopK > 0
    ? merged.finalTopK
    : DEFAULT_RETRIEVAL_PLANNER_OPTIONS.finalTopK;

  return merged;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePersonText(value: string): string {
  return normalizeWhitespace(
    value
      .toLowerCase()
      .replace(/[<>"'()[\]{}]/g, " ")
      .replace(/[^\p{L}\p{N}@._+-]+/gu, " "),
  );
}

function trimPersonText(value: string): string {
  return normalizeWhitespace(
    value
      .replace(EMAIL_PATTERN, " ")
      .replace(/[.,;:!?]+$/g, "")
      .replace(/^(the|a|an)\s+/i, ""),
  );
}

function getPartMap(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const parts = getPartMap(date, timeZone);

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getPartMap(date, timeZone);
  const localHour = parts.hour === "24" ? 0 : Number(parts.hour);
  const localTimestamp = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    localHour,
    Number(parts.minute),
    Number(parts.second),
  );

  return localTimestamp - date.getTime();
}

function zonedDateTimeToUtc(
  parts: ZonedDateParts,
  timeZone: string,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
): Date {
  const timestamp = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    hour,
    minute,
    second,
    millisecond,
  );

  let utcDate = new Date(timestamp - getTimeZoneOffsetMs(new Date(timestamp), timeZone));
  utcDate = new Date(timestamp - getTimeZoneOffsetMs(utcDate, timeZone));
  return utcDate;
}

function addDays(parts: ZonedDateParts, days: number): ZonedDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function startOfDay(
  now: Date,
  timeZone: string,
  dayOffset = 0,
): Date {
  const today = getZonedDateParts(now, timeZone);
  return zonedDateTimeToUtc(addDays(today, dayOffset), timeZone);
}

function dayRange(
  now: Date,
  timeZone: string,
  dayOffset: number,
  label: string,
): RetrievalDateRange {
  return {
    startInclusive: startOfDay(now, timeZone, dayOffset),
    endExclusive: startOfDay(now, timeZone, dayOffset + 1),
    label,
  };
}

function weekRange(
  now: Date,
  timeZone: string,
  weekOffset: number,
  label: string,
): RetrievalDateRange {
  const today = getZonedDateParts(now, timeZone);
  const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const start = addDays(today, mondayOffset + weekOffset * 7);
  const end = addDays(start, 7);

  return {
    startInclusive: zonedDateTimeToUtc(start, timeZone),
    endExclusive: zonedDateTimeToUtc(end, timeZone),
    label,
  };
}

function lastDaysRange(
  now: Date,
  timeZone: string,
  days: number,
  label: string,
): RetrievalDateRange {
  return {
    startInclusive: startOfDay(now, timeZone, -(days - 1)),
    endExclusive: startOfDay(now, timeZone, 1),
    label,
  };
}

function detectSource(
  query: string,
  defaultSource: RetrievalSourceScope,
): RetrievalSourceScope {
  const mentionsGmail = GMAIL_SOURCE_PATTERN.test(query);
  const mentionsCalendar = CALENDAR_SOURCE_PATTERN.test(query);

  if (mentionsGmail && !mentionsCalendar) return "gmail";
  if (mentionsCalendar && !mentionsGmail) return "calendar";
  if (mentionsGmail && mentionsCalendar) {
    if (CROSS_SOURCE_PATTERN.test(query)) return "all";

    const gmailIndex = query.search(GMAIL_SOURCE_PATTERN);
    const calendarIndex = query.search(CALENDAR_SOURCE_PATTERN);
    return gmailIndex <= calendarIndex ? "gmail" : "calendar";
  }
  return defaultSource;
}

function detectSort(query: string, defaultSort: RetrievalSort): RetrievalSort {
  if (OLDEST_PATTERN.test(query)) return "oldest";
  if (LATEST_PATTERN.test(query)) return "latest";
  return defaultSort;
}

function detectDateRange(
  query: string,
  now: Date,
  timeZone: string,
): DateRangeDetection | null {
  const lowerQuery = query.toLowerCase();
  const lastDaysMatch = lowerQuery.match(/\b(?:last|past)\s+(\d+)\s+days?\b/);

  if (lastDaysMatch) {
    const days = Number(lastDaysMatch[1]);
    if (Number.isInteger(days) && days > 0) {
      return {
        dateRange: lastDaysRange(now, timeZone, days, lastDaysMatch[0]),
        matchedText: lastDaysMatch[0],
      };
    }
  }

  if (/\byesterday\b/i.test(query)) {
    return {
      dateRange: dayRange(now, timeZone, -1, "yesterday"),
      matchedText: "yesterday",
    };
  }

  if (/\btoday\b/i.test(query)) {
    return {
      dateRange: dayRange(now, timeZone, 0, "today"),
      matchedText: "today",
    };
  }

  if (/\btomorrow\b/i.test(query)) {
    return {
      dateRange: dayRange(now, timeZone, 1, "tomorrow"),
      matchedText: "tomorrow",
    };
  }

  if (/\blast\s+week\b/i.test(query)) {
    return {
      dateRange: weekRange(now, timeZone, -1, "last week"),
      matchedText: "last week",
    };
  }

  if (/\bthis\s+week\b/i.test(query)) {
    return {
      dateRange: weekRange(now, timeZone, 0, "this week"),
      matchedText: "this week",
    };
  }

  return null;
}

function roleForFromPhrase(source: RetrievalSourceScope): PersonRole {
  return source === "calendar" ? "organizer" : "sender";
}

function metadataKeyForRole(role: PersonRole, hasEmail: boolean): string | null {
  if (role === "sender") return hasEmail ? "sender_email" : "sender_name_norm";
  if (role === "organizer") return hasEmail ? "organizer_email" : "organizer_name_norm";
  return null;
}

function createPersonFilter(
  role: PersonRole,
  rawText: string,
  confidence: number,
): PersonFilter | null {
  const emailMatch = rawText.match(EMAIL_PATTERN);
  const email = emailMatch?.[0]?.toLowerCase() ?? null;
  const cleanedText = trimPersonText(rawText);
  const normalizedText = normalizePersonText(cleanedText || rawText);

  if (!email && normalizedText.length < 2) return null;

  return {
    role,
    rawText: cleanedText || email || rawText,
    normalizedText,
    email,
    metadataKey: metadataKeyForRole(role, Boolean(email)),
    status: email ? "resolved" : "unresolved",
    confidence,
  };
}

function pushUniquePersonFilter(
  people: PersonFilter[],
  candidate: PersonFilter | null,
): void {
  if (!candidate) return;

  const alreadyExists = people.some((person) =>
    person.role === candidate.role &&
    person.normalizedText === candidate.normalizedText &&
    person.email === candidate.email
  );

  if (!alreadyExists) {
    people.push(candidate);
  }
}

function extractPersonFilters(
  query: string,
  source: RetrievalSourceScope,
): PersonFilter[] {
  const people: PersonFilter[] = [];
  const fromMatch = query.match(FROM_PERSON_PATTERN);
  const withMatch = query.match(WITH_PERSON_PATTERN);
  const organizerMatch = query.match(ORGANIZER_PERSON_PATTERN);
  const emailMatch = query.match(EMAIL_PATTERN);

  if (fromMatch?.[1]) {
    pushUniquePersonFilter(
      people,
      createPersonFilter(roleForFromPhrase(source), fromMatch[1], 0.8),
    );
  }

  if (withMatch?.[1]) {
    pushUniquePersonFilter(
      people,
      createPersonFilter("participant", withMatch[1], 0.65),
    );
  }

  if (organizerMatch?.[1]) {
    pushUniquePersonFilter(
      people,
      createPersonFilter("organizer", organizerMatch[1], 0.9),
    );
  }

  if (emailMatch?.[0] && people.length === 0) {
    pushUniquePersonFilter(
      people,
      createPersonFilter(roleForFromPhrase(source), emailMatch[0], 0.95),
    );
  }

  return people;
}

function removeFromPersonPhrase(query: string): string {
  return query.replace(FROM_PERSON_PATTERN, " ");
}

function removeWithPersonPhrase(query: string): string {
  return query.replace(WITH_PERSON_PATTERN, " ");
}

function removeOrganizerPersonPhrase(query: string): string {
  return query.replace(ORGANIZER_PERSON_PATTERN, " ");
}

function buildContentQuery(
  query: string,
  source: RetrievalSourceScope,
): string | null {
  let cleanedQuery = removeOrganizerPersonPhrase(
    removeWithPersonPhrase(removeFromPersonPhrase(query)),
  );

  if (source === "gmail") {
    cleanedQuery = cleanedQuery.replace(GMAIL_SOURCE_TERMS_PATTERN, " ");
  } else if (source === "calendar") {
    cleanedQuery = cleanedQuery.replace(CALENDAR_SOURCE_TERMS_PATTERN, " ");
  } else {
    cleanedQuery = cleanedQuery
      .replace(GMAIL_SOURCE_TERMS_PATTERN, " ")
      .replace(CALENDAR_SOURCE_TERMS_PATTERN, " ");
  }

  const cleaned = normalizeWhitespace(
    cleanedQuery
      .replace(DATE_PHRASE_PATTERN, " ")
      .replace(SORT_PHRASE_PATTERN, " ")
      .replace(/\b(show|get|find|search|tell\s+me|what\s+is|what\s+are)\b/gi, " ")
      .replace(/\b(about|regarding|related\s+to)\b/gi, " "),
  );

  return cleaned.length > 0 ? cleaned : null;
}

function buildTemporalIntent(
  dateRange: RetrievalDateRange | null,
  sort: RetrievalSort,
): TemporalIntent {
  if (dateRange) return "date_range";
  if (sort === "latest") return "latest";
  if (sort === "oldest") return "oldest";
  return "none";
}

function inferStrategy(
  defaultStrategy: RetrievalStrategy,
  people: PersonFilter[],
  dateRange: RetrievalDateRange | null,
  sort: RetrievalSort,
): RetrievalStrategy {
  if (people.length > 0 || dateRange || sort !== "relevance") {
    return "hybrid";
  }

  return defaultStrategy;
}

function endExclusiveToInclusive(value: DateInput | null | undefined): DateInput | null {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Date(date.getTime() - 1);
}

function buildResolvedPersonMetadata(people: PersonFilter[] = []): VectorMetadata {
  const metadata: VectorMetadata = {};

  for (const person of people) {
    if (person.status !== "resolved") continue;

    if (person.metadataKey && person.metadataValue) {
      metadata[person.metadataKey] = person.metadataValue;
      continue;
    }

    if (person.email) {
      const key = person.metadataKey ?? metadataKeyForRole(person.role, true);
      if (key) metadata[key] = person.email;
      continue;
    }

    if (person.resolvedName) {
      const key = person.metadataKey ?? metadataKeyForRole(person.role, false);
      if (key) metadata[key] = person.resolvedName;
    }
  }

  return metadata;
}

function hasMetadata(metadata: VectorMetadata): boolean {
  return Object.keys(metadata).length > 0;
}

export function buildVectorSearchFromPlan(
  plan: RetrievalPlan,
  userId: OwnerId,
): PlannedVectorSearch {
  const resolvedPersonMetadata = buildResolvedPersonMetadata(plan.filters.people);
  const metadata = {
    ...(plan.filters.metadata ?? {}),
    ...resolvedPersonMetadata,
  };

  const filters: VectorSearchFilters = {
    sourceType: plan.filters.source === "all" ? null : plan.filters.source,
    occurredAfter: plan.filters.dateRange?.startInclusive ?? null,
    occurredBefore: endExclusiveToInclusive(plan.filters.dateRange?.endExclusive),
    metadata: hasMetadata(metadata) ? metadata : undefined,
  };

  return {
    query: plan.semanticQuery,
    userId,
    topK: plan.limits.vectorTopK,
    filters,
    sort: plan.sort,
  };
}

function buildResolutionWarnings(people: PersonFilter[]): string[] {
  const warnings: string[] = [];

  for (const person of people) {
    if (person.status === "unresolved") {
      warnings.push(`Could not resolve ${person.role}: ${person.rawText}`);
    }

    if (person.status === "ambiguous") {
      warnings.push(`Ambiguous ${person.role}: ${person.rawText}`);
    }
  }

  return warnings;
}

export function buildRetrievalPlan({
  query,
  userId,
  now = new Date(),
  timezone = DEFAULT_TIMEZONE,
  options,
}: RetrievalPlanInput): RetrievalPlannerResult {
  if (typeof query !== "string") {
    throw new Error("query must be a string");
  }

  if (!userId) {
    throw new Error("userId is required");
  }

  const normalizedQuery = normalizeWhitespace(query);
  if (!normalizedQuery) {
    throw new Error("query must not be empty");
  }

  const plannerOptions = mergeOptions(options);
  const source = detectSource(normalizedQuery, plannerOptions.defaultSource);
  const sort = detectSort(normalizedQuery, plannerOptions.defaultSort);
  const dateDetection = detectDateRange(normalizedQuery, now, timezone);
  const people = extractPersonFilters(normalizedQuery, source);
  const contentQuery = buildContentQuery(normalizedQuery, source);
  const strategy = inferStrategy(
    plannerOptions.defaultStrategy,
    people,
    dateDetection?.dateRange ?? null,
    sort,
  );

  const plan: RetrievalPlan = {
    rawQuery: normalizedQuery,
    semanticQuery: contentQuery ?? normalizedQuery,
    contentQuery,
    strategy,
    sort,
    temporalIntent: buildTemporalIntent(dateDetection?.dateRange ?? null, sort),
    filters: {
      source,
      dateRange: dateDetection?.dateRange ?? null,
      people,
    },
    limits: {
      vectorTopK: plannerOptions.vectorTopK,
      keywordTopK: plannerOptions.keywordTopK,
      finalTopK: plannerOptions.finalTopK,
    },
    requiresMetadataResolution: people.some((person) => person.status !== "resolved"),
  };

  return {
    plan,
    vectorSearch: buildVectorSearchFromPlan(plan, userId),
  };
}

export async function buildResolvedRetrievalPlan({
  resolver = personResolver,
  ...input
}: ResolvedRetrievalPlanInput): Promise<RetrievalPlannerResult> {
  const result = buildRetrievalPlan(input);
  const people = result.plan.filters.people ?? [];

  if (people.length === 0) {
    return result;
  }

  const resolvedPeople = await resolver.resolvePeople({
    people,
    userId: input.userId,
    source: result.plan.filters.source,
  });
  const hasUnsupportedUnresolvedPerson = resolvedPeople.some((person) =>
    person.status !== "resolved" &&
    person.role !== "sender" &&
    person.role !== "organizer"
  );

  const plan: RetrievalPlan = {
    ...result.plan,
    semanticQuery: hasUnsupportedUnresolvedPerson
      ? result.plan.rawQuery
      : result.plan.semanticQuery,
    contentQuery: hasUnsupportedUnresolvedPerson
      ? result.plan.rawQuery
      : result.plan.contentQuery,
    filters: {
      ...result.plan.filters,
      people: resolvedPeople,
    },
    requiresMetadataResolution: resolvedPeople.some(
      (person) => person.status !== "resolved",
    ),
  };

  return {
    plan,
    vectorSearch: buildVectorSearchFromPlan(plan, input.userId),
    warnings: buildResolutionWarnings(resolvedPeople),
  };
}
