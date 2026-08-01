import "../src/config/env.js";
import { getPool } from "../src/config/dbConfig.js";
import { createVectorStore } from "../src/RAG/vectorStores/vectorStoreFactory.js";
import type {
  EmbeddedChunk,
  VectorStoreDocument,
} from "../src/RAG/vectorStores/vectorStore.js";
import {
  vectorMigrationRepository,
  type PgvectorMigrationChunkRow,
} from "../src/database/vectorMigrationRepository.js";

const DEFAULT_BATCH_SIZE = 250;

function parseArgs(argv: string[]) {
  const args = {
    batchSize: DEFAULT_BATCH_SIZE,
    userId: null as string | null,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (arg === "--batch-size") {
      args.batchSize = Number(argv[++index]);
      continue;
    }

    if (arg === "--user-id") {
      args.userId = argv[++index];
      continue;
    }
  }

  if (!Number.isInteger(args.batchSize) || args.batchSize <= 0) {
    throw new Error("--batch-size must be a positive integer");
  }

  return args;
}

function parsePgvector(value: string): number[] {
  const trimmed = value.trim();
  const withoutBrackets = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;

  if (!withoutBrackets) return [];

  return withoutBrackets.split(",").map((part) => Number(part.trim()));
}

function groupRowsByDocument(rows: PgvectorMigrationChunkRow[]) {
  const groups = new Map<number, PgvectorMigrationChunkRow[]>();

  for (const row of rows) {
    const existing = groups.get(row.document_pk) ?? [];
    existing.push(row);
    groups.set(row.document_pk, existing);
  }

  return groups;
}

function toVectorDocument(row: PgvectorMigrationChunkRow): VectorStoreDocument {
  return {
    id: row.document_pk,
    user_id: row.user_id,
    document_id: row.document_id,
    source: row.source,
    type: row.type,
    title: row.title,
    timestamp: row.timestamp,
    author: row.author,
    metadata: row.metadata,
  };
}

function toEmbeddedChunk(row: PgvectorMigrationChunkRow): EmbeddedChunk {
  const embedding = parsePgvector(row.embedding_text);

  if (embedding.some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid embedding values for chunk ${row.chunk_id}`);
  }

  return {
    content: row.content,
    chunk_index: row.chunk_index,
    source_type: row.source_type,
    occurred_at: row.occurred_at,
    embedding,
  };
}

async function migrate() {
  const args = parseArgs(process.argv.slice(2));

  if (process.env.VECTOR_STORE !== "chroma") {
    throw new Error("Set VECTOR_STORE=chroma before running this migration");
  }

  const totalChunks = await vectorMigrationRepository.countSourceChunks(args.userId);
  console.log(`Found ${totalChunks} pgvector chunks to migrate`);

  if (args.dryRun) {
    console.log("Dry run enabled. No Chroma writes will be performed.");
    await getPool().end();
    return;
  }

  const vectorStore = createVectorStore("chroma");

  let migratedChunks = 0;
  let migratedDocuments = 0;
  let lastDocumentPk = 0;

  while (migratedChunks < totalChunks) {
    const rows = await vectorMigrationRepository.fetchDocumentChunkBatch({
      limit: args.batchSize,
      afterDocumentPk: lastDocumentPk,
      userId: args.userId,
    });

    if (rows.length === 0) break;

    const documentGroups = groupRowsByDocument(rows);
    for (const groupRows of documentGroups.values()) {
      const firstRow = groupRows[0];
      const document = toVectorDocument(firstRow);
      const chunks = groupRows.map(toEmbeddedChunk);
      await vectorStore.upsertDocumentChunks({ document, chunks });

      migratedDocuments++;
      migratedChunks += chunks.length;
    }

    lastDocumentPk = Math.max(...documentGroups.keys());
    console.log(`Migrated ${migratedChunks}/${totalChunks} chunks`);
  }

  console.log("Migration completed", {
    migratedDocuments,
    migratedChunks,
  });

  await getPool().end();
}

migrate().catch(async (error) => {
  console.error("Migration failed:", error);
  await getPool().end().catch(() => undefined);
  process.exit(1);
});
