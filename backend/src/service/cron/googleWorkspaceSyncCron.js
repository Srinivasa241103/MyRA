import cron from "node-cron";
import IngestionPipeline from "../../RAG/ingestion/ingestionPipeline.js";
import EmbeddingPipeline from "../../RAG/ingestion/embeddingPipeline.js";
import { CredentialRepository } from "../../database/credentialRepository.js";
import { SyncLogRepository } from "../../database/syncLogsRepository.js";
import { logger } from "../../utils/logger.js";

const SYNC_SOURCES = [
  {
    name: "gmail",
    displayName: "Gmail",
    credentialSource: "gmail",
    syncLogSource: "gmail",
    ingestionSource: "gmail",
    enabledEnv: "ENABLE_GMAIL_SYNC_CRON",
  },
  {
    name: "calendar",
    displayName: "Google Calendar",
    credentialSource: "google_calendar",
    syncLogSource: "google_calendar",
    ingestionSource: "calendar",
    enabledEnv: "ENABLE_CALENDAR_SYNC_CRON",
  },
];

const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export default class GoogleWorkspaceSyncCronJob {
  constructor() {
    this.isRunning = false;
    this.task = null;
    this.schedule =
      process.env.GOOGLE_WORKSPACE_SYNC_CRON_SCHEDULE ||
      process.env.GOOGLE_SYNC_CRON_SCHEDULE ||
      "0 * * * *";
    this.timezone = process.env.CRON_TIMEZONE || "Asia/Kolkata";
    this.staleInProgressMinutes = numberFromEnv(
      "GOOGLE_WORKSPACE_SYNC_STALE_MINUTES",
      55
    );
    this.embeddingBatchSize = numberFromEnv(
      "GOOGLE_WORKSPACE_SYNC_EMBEDDING_BATCH_SIZE",
      50
    );
    this.embeddingMaxBatches = numberFromEnv(
      "GOOGLE_WORKSPACE_SYNC_EMBEDDING_MAX_BATCHES",
      3
    );

    this.credentialRepo = new CredentialRepository();
    this.syncLogRepo = new SyncLogRepository();
    this.ingestionPipeline = new IngestionPipeline();
    this.embeddingPipeline = new EmbeddingPipeline();
  }

  start() {
    if (this.task) {
      logger.warn("Google workspace sync cron job already running");
      return;
    }

    if (!cron.validate(this.schedule)) {
      logger.error("Invalid Google workspace sync cron schedule", {
        schedule: this.schedule,
      });
      throw new Error(`Invalid cron schedule: ${this.schedule}`);
    }

    this.task = cron.schedule(
      this.schedule,
      async () => {
        await this.executeJob();
      },
      { timezone: this.timezone }
    );

    logger.info("Google workspace sync cron job scheduled", {
      schedule: this.schedule,
      timezone: this.timezone,
    });
  }

  async executeJob() {
    if (this.isRunning) {
      logger.warn("Google workspace sync cron job already running, skipping");
      return;
    }

    this.isRunning = true;
    const startedAt = Date.now();
    const summary = {
      users: 0,
      sourcesAttempted: 0,
      sourcesSucceeded: 0,
      sourcesFailed: 0,
      sourcesSkipped: 0,
      documentsFetched: 0,
      documentsInserted: 0,
      embeddingsProcessed: 0,
      embeddingsFailed: 0,
    };

    try {
      const enabledSources = SYNC_SOURCES.filter(
        (source) => process.env[source.enabledEnv] !== "false"
      );

      if (!enabledSources.length) {
        logger.info("Google workspace sync cron job has no enabled sources");
        return;
      }

      logger.info("Google workspace sync cron job executing", {
        sources: enabledSources.map((source) => source.name),
      });

      const users = await this.credentialRepo.findUsersWithSources(
        enabledSources.map((source) => source.credentialSource)
      );
      summary.users = users.length;

      if (!users.length) {
        logger.info("Google workspace sync cron job found no connected users");
        return;
      }

      for (const user of users) {
        const userSummary = await this.syncUser(user, enabledSources);

        summary.sourcesAttempted += userSummary.sourcesAttempted;
        summary.sourcesSucceeded += userSummary.sourcesSucceeded;
        summary.sourcesFailed += userSummary.sourcesFailed;
        summary.sourcesSkipped += userSummary.sourcesSkipped;
        summary.documentsFetched += userSummary.documentsFetched;
        summary.documentsInserted += userSummary.documentsInserted;
        summary.embeddingsProcessed += userSummary.embeddingsProcessed;
        summary.embeddingsFailed += userSummary.embeddingsFailed;
      }

      logger.info("Google workspace sync cron job completed", {
        ...summary,
        duration: Date.now() - startedAt,
      });
    } catch (error) {
      logger.error("Google workspace sync cron job failed", {
        error: error.message,
      });
    } finally {
      this.isRunning = false;
    }
  }

  async syncUser(user, enabledSources) {
    const userSources = new Set(user.sources || []);
    const userId = user.user_id;
    const summary = {
      sourcesAttempted: 0,
      sourcesSucceeded: 0,
      sourcesFailed: 0,
      sourcesSkipped: 0,
      documentsFetched: 0,
      documentsInserted: 0,
      embeddingsProcessed: 0,
      embeddingsFailed: 0,
    };

    logger.info("Starting scheduled Google workspace sync for user", {
      userId,
      sources: Array.from(userSources),
    });

    for (const source of enabledSources) {
      if (!userSources.has(source.credentialSource)) {
        continue;
      }

      const result = await this.syncUserSource(userId, source);
      summary.sourcesAttempted++;

      if (result.status === "skipped") {
        summary.sourcesSkipped++;
        continue;
      }

      if (result.status === "success") {
        summary.sourcesSucceeded++;
        summary.documentsFetched += result.fetched;
        summary.documentsInserted += result.inserted;
      } else {
        summary.sourcesFailed++;
      }
    }

    if (summary.sourcesSucceeded > 0) {
      const embeddingResponse = await this.embeddingPipeline.runEmbedding(userId, {
        batchSize: this.embeddingBatchSize,
        maxBatches: this.embeddingMaxBatches,
      });

      summary.embeddingsProcessed = embeddingResponse.processed;
      summary.embeddingsFailed = embeddingResponse.failed;

      logger.info("Scheduled embedding generation completed for user", {
        userId,
        processed: embeddingResponse.processed,
        failed: embeddingResponse.failed,
      });
    }

    return summary;
  }

  async syncUserSource(userId, source) {
    const activeSync = await this.getRecentInProgressSync(
      userId,
      source.syncLogSource
    );

    if (activeSync) {
      logger.warn("Skipping scheduled sync because source is already in progress", {
        userId,
        source: source.syncLogSource,
        syncId: activeSync.id,
      });
      return { status: "skipped", reason: "in_progress" };
    }

    const syncLog = await this.syncLogRepo.create(source.syncLogSource, userId);

    try {
      logger.info("Scheduled source sync started", {
        userId,
        source: source.displayName,
        syncId: syncLog.id,
      });

      const ingestionResponse = await this.ingestionPipeline.runIngestion(
        source.ingestionSource,
        false,
        userId
      );

      if (ingestionResponse.failed > 0) {
        await this.syncLogRepo.complete(syncLog.id, {
          status: "failed",
          documentsFetched: ingestionResponse.fetched,
          documentsStored: ingestionResponse.inserted,
          lastSyncTimestamp: new Date(),
          error: `${ingestionResponse.failed} ${source.name} item(s) failed during ingestion`,
        });

        logger.error("Scheduled source sync completed with item failures", {
          userId,
          source: source.displayName,
          syncId: syncLog.id,
          failed: ingestionResponse.failed,
        });

        return { status: "failed", ...ingestionResponse };
      }

      await this.syncLogRepo.complete(syncLog.id, {
        status: "success",
        documentsFetched: ingestionResponse.fetched,
        documentsStored: ingestionResponse.inserted,
        lastSyncTimestamp: new Date(),
      });

      logger.info("Scheduled source sync completed", {
        userId,
        source: source.displayName,
        syncId: syncLog.id,
        fetched: ingestionResponse.fetched,
        inserted: ingestionResponse.inserted,
        skipped: ingestionResponse.skipped,
      });

      return { status: "success", ...ingestionResponse };
    } catch (error) {
      logger.error("Scheduled source sync failed", {
        userId,
        source: source.displayName,
        syncId: syncLog.id,
        error: error.message,
      });
      await this.syncLogRepo.fail(syncLog.id, error.message);
      return {
        status: "failed",
        fetched: 0,
        inserted: 0,
        skipped: 0,
        failed: 1,
      };
    }
  }

  async getRecentInProgressSync(userId, source) {
    const lastSync = await this.syncLogRepo.getLastSync(source, userId);
    if (lastSync?.status !== "in_progress") {
      return null;
    }

    const startedAt = new Date(lastSync.sync_started_at).getTime();
    const maxAgeMs = this.staleInProgressMinutes * 60 * 1000;

    if (Number.isFinite(startedAt) && Date.now() - startedAt <= maxAgeMs) {
      return lastSync;
    }

    logger.warn("Ignoring stale in-progress sync log", {
      userId,
      source,
      syncId: lastSync.id,
      startedAt: lastSync.sync_started_at,
    });
    return null;
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info("Google workspace sync cron job stopped");
    }
  }

  getStatus() {
    return {
      running: this.task !== null,
      schedule: this.schedule,
      timezone: this.timezone,
      currentlyExecuting: this.isRunning,
      staleInProgressMinutes: this.staleInProgressMinutes,
    };
  }

  async triggerManually() {
    logger.info("Manually triggering Google workspace sync cron job");
    await this.executeJob();
  }
}
