import "../src/config/env.js";
import { getPool } from "../src/config/dbConfig.js";
import EmbeddingPipeline from "../src/RAG/ingestion/embeddingPipeline.js";
import { RetrievalIndexRepository } from "../src/database/retrievalIndexRepository.js";

const DEFAULT_BATCH_SIZE = 50;

interface ReconciliationArgs {
  batchSize: number;
  dryRun: boolean;
  userId: string;
}

function parseArgs(argv: string[]): ReconciliationArgs {
  let batchSize = DEFAULT_BATCH_SIZE;
  let dryRun = false;
  let userId = process.env.SYNC_USER_ID?.trim() ?? "";

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--batch-size") {
      batchSize = Number(argv[++index]);
      continue;
    }

    if (arg === "--user-id") {
      userId = argv[++index]?.trim() ?? "";
    }
  }

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("--batch-size must be a positive integer");
  }

  if (!userId) {
    throw new Error(
      "Provide --user-id <id> or set SYNC_USER_ID before reconciliation",
    );
  }

  return { batchSize, dryRun, userId };
}

async function queueMissingPostgresDocuments(
  repository: RetrievalIndexRepository,
  userId: string,
  batchSize: number,
): Promise<number> {
  let totalQueued = 0;

  while (true) {
    const queued = await repository.queueDocumentsMissingPostgresChunks({
      userId,
      limit: batchSize,
    });

    totalQueued += queued;
    if (queued < batchSize) return totalQueued;
  }
}

async function reconcile(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const repository = new RetrievalIndexRepository();
  const before = await repository.getConsistencyStats(args.userId);

  console.log("Retrieval index consistency before reconciliation", {
    userId: args.userId,
    ...before,
  });

  if (args.dryRun) {
    console.log("Dry run enabled. No document or index writes were performed.");
    return;
  }

  const queuedDocuments = await queueMissingPostgresDocuments(
    repository,
    args.userId,
    args.batchSize,
  );

  const result = await new EmbeddingPipeline().runEmbedding(args.userId, {
    batchSize: args.batchSize,
    maxBatches: Number.POSITIVE_INFINITY,
    conversationId: "retrieval_index_reconciliation",
  });

  const after = await repository.getConsistencyStats(args.userId);
  console.log("Retrieval index reconciliation completed", {
    userId: args.userId,
    queuedDocuments,
    ...result,
    consistencyAfter: after,
  });

  if (result.failed > 0 || after.missingPostgresChunkDocumentCount > 0) {
    process.exitCode = 1;
  }
}

reconcile()
  .catch((error) => {
    console.error("Retrieval index reconciliation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end().catch(() => undefined);
  });
