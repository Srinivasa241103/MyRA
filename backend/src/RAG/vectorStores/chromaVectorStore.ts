import {
  ChromaClient,
  CloudClient,
  IncludeEnum,
  type Collection,
  type Metadata,
  type Where,
} from "chromadb";
import VectorStore, {
  type DeleteDocumentChunksParams,
  type UpsertDocumentChunksParams,
  type VectorMetadataValue,
  type VectorSearchFilters,
  type VectorSearchParams,
  type VectorSearchResult,
} from "./vectorStore.js";
import { mapDocumentChunksToVectorRecords } from "./vectorRecordMapper.js";

const DEFAULT_CHROMA_HOST = "localhost";
const DEFAULT_CHROMA_PORT = 8000;
const DEFAULT_COLLECTION = "myra_chunks_v1";
const SCHEMA_VERSION = "v1";

function envBoolean(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined) return defaultValue;
  return ["1", "true", "yes"].includes(value.trim().toLowerCase());
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when using Chroma Cloud`);
  }

  return value;
}

function toLiteral(value: VectorMetadataValue | undefined): string | number | boolean | null {
  if (value === undefined || value === null || Array.isArray(value)) return null;
  return value;
}

function toLiteralArray(value: VectorMetadataValue): Array<string | number | boolean> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string | number | boolean =>
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean",
  );
}

function andWhere(conditions: Where[]): Where | undefined {
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return { $and: conditions };
}

function buildMetadataWhere(filters: VectorSearchFilters): Where[] {
  const conditions: Where[] = [];

  for (const [key, value] of Object.entries(filters.metadata ?? {})) {
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      const values = toLiteralArray(value);
      if (values.length > 0) {
        conditions.push({ [key]: { $in: values } });
      }
      continue;
    }

    conditions.push({ [key]: value });
  }

  return conditions;
}

function buildWhere(userId: string | number, filters: VectorSearchFilters = {}): Where {
  const conditions: Where[] = [
    { user_id: String(userId) },
    { schema_version: SCHEMA_VERSION },
  ];

  if (filters.sourceType) {
    conditions.push({ source: filters.sourceType });
  }

  if (filters.occurredAfter) {
    const timestamp = new Date(filters.occurredAfter).getTime();
    if (!Number.isNaN(timestamp)) {
      conditions.push({ occurred_at_ms: { $gte: timestamp } });
    }
  }

  if (filters.occurredBefore) {
    const timestamp = new Date(filters.occurredBefore).getTime();
    if (!Number.isNaN(timestamp)) {
      conditions.push({ occurred_at_ms: { $lte: timestamp } });
    }
  }

  conditions.push(...buildMetadataWhere(filters));

  return andWhere(conditions) ?? { user_id: String(userId) };
}

function buildDocumentWhere(userId: string | number, documentId: string | number): Where {
  const conditions: Where[] = [{ user_id: String(userId) }];
  const numericDocumentId = Number(documentId);

  if (Number.isFinite(numericDocumentId)) {
    conditions.push({ document_pk: numericDocumentId });
  } else {
    conditions.push({ document_id: String(documentId) });
  }

  return andWhere(conditions) ?? { user_id: String(userId) };
}

function metadataValue(metadata: Metadata | null, key: string): string | number | boolean | null {
  const value = metadata?.[key];
  return toLiteral(value as VectorMetadataValue | undefined);
}

function metadataDate(metadata: Metadata | null): Date | null {
  const timestamp = metadataValue(metadata, "occurred_at_ms");
  if (typeof timestamp !== "number") return null;

  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function metadataNumber(metadata: Metadata | null, key: string): number | null {
  const value = metadataValue(metadata, key);
  if (typeof value === "number") return value;

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function metadataString(metadata: Metadata | null, key: string): string | null {
  const value = metadataValue(metadata, key);
  return typeof value === "string" ? value : null;
}

export default class ChromaVectorStore extends VectorStore {
  private readonly client: ChromaClient;
  private readonly collectionName: string;
  private collectionPromise: Promise<Collection> | null = null;

  constructor() {
    super();

    this.collectionName = process.env.CHROMA_COLLECTION || DEFAULT_COLLECTION;
    this.client = process.env.CHROMA_API_KEY
      ? new CloudClient({
          apiKey: process.env.CHROMA_API_KEY,
          tenant: requiredEnv("CHROMA_TENANT"),
          database: requiredEnv("CHROMA_DATABASE"),
          host: process.env.CHROMA_HOST,
          port: process.env.CHROMA_PORT ? Number(process.env.CHROMA_PORT) : undefined,
        })
      : new ChromaClient({
          host: process.env.CHROMA_HOST || DEFAULT_CHROMA_HOST,
          port: process.env.CHROMA_PORT
            ? Number(process.env.CHROMA_PORT)
            : DEFAULT_CHROMA_PORT,
          ssl: envBoolean(process.env.CHROMA_SSL),
          tenant: process.env.CHROMA_TENANT,
          database: process.env.CHROMA_DATABASE,
        });
  }

  private getCollection(): Promise<Collection> {
    if (!this.collectionPromise) {
      this.collectionPromise = this.client.getOrCreateCollection({
        name: this.collectionName,
        configuration: {
          hnsw: {
            space: "cosine",
          },
        },
        metadata: {
          schema_version: SCHEMA_VERSION,
          embedding_source: "precomputed",
        },
        embeddingFunction: null,
      });
    }

    return this.collectionPromise;
  }

  async upsertDocumentChunks({
    document,
    chunks,
  }: UpsertDocumentChunksParams): Promise<void> {
    if (!document?.id) {
      throw new Error("document.id is required to store vector chunks");
    }

    const collection = await this.getCollection();
    await this.deleteDocumentChunks({
      userId: document.user_id,
      documentId: document.id,
    });

    if (!chunks || chunks.length === 0) return;

    const records = mapDocumentChunksToVectorRecords(document, chunks, SCHEMA_VERSION);

    await collection.upsert({
      ids: records.map((record) => record.id),
      embeddings: records.map((record) => record.embedding),
      metadatas: records.map((record) => record.metadata as Metadata),
      documents: records.map((record) => record.document),
    });
  }

  async deleteDocumentChunks({
    userId,
    documentId,
  }: DeleteDocumentChunksParams): Promise<void> {
    if (!documentId) {
      throw new Error("documentId is required to delete vector chunks");
    }

    const collection = await this.getCollection();
    await collection.delete({
      where: buildDocumentWhere(userId, documentId),
    });
  }

  async search({
    queryEmbedding,
    userId,
    filters = {},
    topK = 10,
  }: VectorSearchParams): Promise<VectorSearchResult[]> {
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      throw new Error("search requires a non-empty queryEmbedding array");
    }

    const collection = await this.getCollection();
    const result = await collection.query<Metadata>({
      queryEmbeddings: [queryEmbedding],
      nResults: topK,
      where: buildWhere(userId, filters),
      include: [
        IncludeEnum.documents,
        IncludeEnum.metadatas,
        IncludeEnum.distances,
      ],
    });

    const ids = result.ids[0] ?? [];
    const documents = result.documents[0] ?? [];
    const metadatas = result.metadatas[0] ?? [];
    const distances = result.distances[0] ?? [];

    return ids.map((id, index) => {
      const metadata = metadatas[index] ?? null;
      const documentPk = metadataNumber(metadata, "document_pk");
      const sourceId = metadataString(metadata, "document_id") ?? id;

      return {
        chunk_id: id,
        content: documents[index] ?? "",
        chunk_index: metadataNumber(metadata, "chunk_index") ?? 0,
        source_type: metadataString(metadata, "source") ?? "unknown",
        occurred_at: metadataDate(metadata),
        distance: distances[index] ?? Number.POSITIVE_INFINITY,
        document: {
          id: documentPk ?? sourceId,
          source_id: sourceId,
          author: metadataString(metadata, "sender_email")
            ?? metadataString(metadata, "organizer_email"),
          metadata,
        },
      };
    });
  }
}
