import {
  retrievalMetadataRepository,
  type MetadataPersonCandidate,
  type MetadataPersonRole,
  type RetrievalMetadataRepository,
} from "../../database/retrievalMetadataRepository.js";
import type { OwnerId } from "../vectorStores/vectorStore.js";
import type {
  PersonFilter,
  PersonResolutionCandidate,
  RetrievalSourceScope,
} from "./retrievalPlan.js";

/**
 * Structural view of the resolver used by the planner and the Retriever.
 * `PersonResolver` itself has a private field, so a nominal reference would
 * make the collaborator un-substitutable; this interface keeps the seam open
 * for callers that supply their own resolution (FND-06 baselines).
 */
export interface PersonResolverLike {
  resolvePeople(input: {
    people: PersonFilter[];
    userId: OwnerId;
    source: RetrievalSourceScope;
  }): Promise<PersonFilter[]>;
}

const MIN_RESOLUTION_SCORE = 0.72;
const MIN_AMBIGUOUS_SCORE = 0.55;
const MIN_CLEAR_SCORE_GAP = 0.08;
const MAX_PERSON_CANDIDATES = 5;

function normalizeForMatch(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[<>"'()[\]{}]/g, " ")
    .replace(/[^\p{L}\p{N}@._+-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string | null | undefined): string[] {
  return [
    ...new Set(
      normalizeForMatch(value)
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2),
    ),
  ];
}

function tokenMatches(queryToken: string, candidateToken: string): boolean {
  if (queryToken === candidateToken) return true;
  if (queryToken.length >= 3 && candidateToken.includes(queryToken)) return true;
  return candidateToken.length >= 3 && queryToken.includes(candidateToken);
}

function countMatchedTokens(queryTokens: string[], candidateTokens: string[]): number {
  return queryTokens.filter((queryToken) =>
    candidateTokens.some((candidateToken) =>
      tokenMatches(queryToken, candidateToken),
    ),
  ).length;
}

function scoreCandidate(person: PersonFilter, candidate: MetadataPersonCandidate): number {
  const queryText = normalizeForMatch(
    person.email ?? person.normalizedText ?? person.rawText,
  );
  const candidateName = normalizeForMatch(candidate.normalizedName);
  const candidateEmail = normalizeForMatch(candidate.email);

  if (person.email && candidateEmail === normalizeForMatch(person.email)) {
    return 1;
  }

  const queryTokens = tokenize(queryText);
  const candidateTokens = tokenize(`${candidateName} ${candidateEmail}`);

  if (queryTokens.length === 0 || candidateTokens.length === 0) {
    return 0;
  }

  const matchedQueryTokens = countMatchedTokens(queryTokens, candidateTokens);
  const matchedCandidateTokens = countMatchedTokens(candidateTokens, queryTokens);
  const queryCoverage = matchedQueryTokens / queryTokens.length;
  const candidateCoverage = matchedCandidateTokens / candidateTokens.length;
  const exactNameBonus = candidateName && candidateName === queryText ? 0.1 : 0;
  const emailContainsBonus =
    candidateEmail && queryTokens.some((token) => candidateEmail.includes(token))
      ? 0.05
      : 0;

  return Math.min(
    1,
    queryCoverage * 0.75 +
      candidateCoverage * 0.15 +
      exactNameBonus +
      emailContainsBonus,
  );
}

function metadataKeyForCandidate(candidate: MetadataPersonCandidate): string {
  return candidate.email ? candidate.emailMetadataKey : candidate.nameMetadataKey;
}

function metadataValueForCandidate(candidate: MetadataPersonCandidate): string | null {
  return candidate.email ?? candidate.normalizedName;
}

function toResolutionCandidate(
  candidate: MetadataPersonCandidate,
  score: number,
): PersonResolutionCandidate | null {
  const metadataValue = metadataValueForCandidate(candidate);
  if (!metadataValue) return null;

  return {
    metadataKey: metadataKeyForCandidate(candidate),
    metadataValue,
    normalizedName: candidate.normalizedName,
    email: candidate.email,
    score,
    documentCount: candidate.documentCount,
    latestTimestamp: candidate.latestTimestamp,
  };
}

function roleToRepositoryRole(
  person: PersonFilter,
  source: RetrievalSourceScope,
): MetadataPersonRole | null {
  if (person.role === "sender") return "sender";
  if (person.role === "organizer") return "organizer";

  if (person.role === "any") {
    return source === "calendar" ? "organizer" : "sender";
  }

  return null;
}

function isClearWinner(
  candidates: PersonResolutionCandidate[],
): boolean {
  const top = candidates[0];
  const second = candidates[1];

  if (!top || top.score < MIN_RESOLUTION_SCORE) return false;
  if (!second) return true;
  if (top.score >= 0.92) return true;

  return top.score - second.score >= MIN_CLEAR_SCORE_GAP;
}

export class PersonResolver {
  constructor(
    private readonly repository: RetrievalMetadataRepository =
      retrievalMetadataRepository,
  ) {}

  async resolvePeople({
    people,
    userId,
    source,
  }: {
    people: PersonFilter[];
    userId: OwnerId;
    source: RetrievalSourceScope;
  }): Promise<PersonFilter[]> {
    const resolvedPeople: PersonFilter[] = [];

    for (const person of people) {
      resolvedPeople.push(
        await this.resolvePerson({
          person,
          userId,
          source,
        }),
      );
    }

    return resolvedPeople;
  }

  async resolvePerson({
    person,
    userId,
    source,
  }: {
    person: PersonFilter;
    userId: OwnerId;
    source: RetrievalSourceScope;
  }): Promise<PersonFilter> {
    if (person.status === "resolved" && person.metadataKey && person.metadataValue) {
      return person;
    }

    const repositoryRole = roleToRepositoryRole(person, source);
    if (!repositoryRole) {
      return person;
    }

    const candidates = await this.repository.findPersonCandidates({
      userId,
      role: repositoryRole,
      queryText: person.email ?? person.normalizedText ?? person.rawText,
      limit: 25,
    });

    const resolutionCandidates = candidates
      .map((candidate) => toResolutionCandidate(candidate, scoreCandidate(person, candidate)))
      .filter((candidate): candidate is PersonResolutionCandidate =>
        Boolean(candidate && candidate.score >= MIN_AMBIGUOUS_SCORE),
      )
      .sort((a, b) =>
        b.score - a.score ||
        (b.documentCount ?? 0) - (a.documentCount ?? 0),
      )
      .slice(0, MAX_PERSON_CANDIDATES);

    if (resolutionCandidates.length === 0) {
      return {
        ...person,
        status: "unresolved",
        candidates: [],
      };
    }

    const bestCandidate = resolutionCandidates[0];

    if (!isClearWinner(resolutionCandidates)) {
      return {
        ...person,
        status: "ambiguous",
        confidence: bestCandidate.score,
        candidates: resolutionCandidates,
      };
    }

    return {
      ...person,
      status: "resolved",
      resolvedName: bestCandidate.normalizedName ?? null,
      email: bestCandidate.email ?? person.email ?? null,
      metadataKey: bestCandidate.metadataKey,
      metadataValue: bestCandidate.metadataValue,
      confidence: bestCandidate.score,
      candidates: resolutionCandidates,
    };
  }
}

export const personResolver = new PersonResolver();

