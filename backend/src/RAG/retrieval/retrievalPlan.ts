import type {
  OwnerId,
  VectorMetadata,
  VectorSearchFilters,
} from "../vectorStores/vectorStore.js";

export type RetrievalSource = "gmail" | "calendar";
export type RetrievalSourceScope = RetrievalSource | "all";

export type RetrievalStrategy = "vector" | "keyword" | "hybrid";
export type RetrievalSort = "relevance" | "latest" | "oldest";

export type TemporalIntent = "none" | "date_range" | "latest" | "oldest";

export type DateInput = Date | string;

export interface RetrievalDateRange {
  startInclusive?: DateInput | null;
  endExclusive?: DateInput | null;
  label?: string | null;
}

export type PersonRole =
  | "sender"
  | "recipient"
  | "organizer"
  | "attendee"
  | "participant"
  | "any";

export type EntityResolutionStatus = "unresolved" | "resolved" | "ambiguous";

export interface PersonResolutionCandidate {
  metadataKey: string;
  metadataValue: string;
  normalizedName?: string | null;
  email?: string | null;
  score: number;
  documentCount?: number | null;
  latestTimestamp?: DateInput | null;
}

export interface PersonFilter {
  role: PersonRole;
  rawText: string;
  normalizedText?: string | null;
  resolvedName?: string | null;
  email?: string | null;
  metadataKey?: string | null;
  metadataValue?: string | null;
  status: EntityResolutionStatus;
  confidence?: number | null;
  candidates?: PersonResolutionCandidate[];
}

export interface RetrievalPlanFilters {
  source: RetrievalSourceScope;
  dateRange?: RetrievalDateRange | null;
  people?: PersonFilter[];
  metadata?: VectorMetadata;
}

export interface RetrievalLimits {
  vectorTopK: number;
  keywordTopK: number;
  finalTopK: number;
}

export interface RetrievalPlan {
  rawQuery: string;
  semanticQuery: string;
  contentQuery: string | null;
  strategy: RetrievalStrategy;
  sort: RetrievalSort;
  temporalIntent: TemporalIntent;
  filters: RetrievalPlanFilters;
  limits: RetrievalLimits;
  requiresMetadataResolution: boolean;
}

export interface RetrievalPlanInput {
  query: string;
  userId: OwnerId;
  now?: Date;
  timezone?: string;
  options?: Partial<RetrievalPlannerOptions>;
}

export interface RetrievalPlannerOptions {
  defaultSource: RetrievalSourceScope;
  defaultStrategy: RetrievalStrategy;
  defaultSort: RetrievalSort;
  vectorTopK: number;
  keywordTopK: number;
  finalTopK: number;
}

export interface PlannedVectorSearch {
  query: string;
  userId: OwnerId;
  topK: number;
  filters: VectorSearchFilters;
  sort: RetrievalSort;
}

export interface RetrievalPlannerResult {
  plan: RetrievalPlan;
  vectorSearch?: PlannedVectorSearch;
  warnings?: string[];
}
