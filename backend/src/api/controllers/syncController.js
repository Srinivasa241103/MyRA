import { logger } from "../../utils/logger.js";
import { SyncLogRepository } from "../../database/syncLogsRepository.js";
import EmbeddingPipeline from "../../RAG/ingestion/embeddingPipeline.js";
import IngestionPipeline from "../../RAG/ingestion/ingestionPipeline.js";
import socketServer from "../../service/websocket/sockeService.js";
import { SYNC_SOURCE } from "../../utils/constants.js";

// sync_logs/websocket source names ("gmail"/"google_calendar") differ from
// IngestionPipeline's source keys ("gmail"/"calendar")
const INGESTION_SOURCE_BY_SYNC_SOURCE = {
  [SYNC_SOURCE.GMAIL]: "gmail",
  [SYNC_SOURCE.GOOGLE_CALENDER]: "calendar",
};

export default class SyncController {
  constructor() {
    this.syncLogRepo = new SyncLogRepository();
    this.embeddingPipeline = new EmbeddingPipeline();
    this.ingestionPipeline = new IngestionPipeline();
  }

  async syncGmail(req, res) {
    try {
      const { userId, syncType = "incremental" } = req.body;
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "userId is required",
        });
      }
      logger.info(`Starting ${syncType} Gmail sync for user ${userId}`);

      const syncLog = await this.syncLogRepo.create("gmail", userId);
      res.json({
        success: true,
        data: {
          syncId: syncLog.id,
          status: "running",
          message: `Gmail sync started`,
        },
      });

      this.performDocumentsSync(userId, syncType, syncLog.id, SYNC_SOURCE.GMAIL).catch((error) => {
        logger.error(`Gmail sync failed for user ${userId}: ${error.message}`);
      });
    } catch (error) {
      logger.error(`Error initiating Gmail sync: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to start Gmail sync",
      });
    }
  }

  async syncCalendar(req, res) {
    try {
      const {
        userId,
        syncType = "incremental",
      } = req.body;

      if (!userId) {
        return res.status(400).json({ success: false, message: "userId is required" });
      }

      logger.info(`Starting ${syncType} Calendar sync for user ${userId}`);

      const syncLog = await this.syncLogRepo.create("google_calendar", userId);
      res.json({
        success: true,
        data: {
          syncId: syncLog.id,
          status: "running",
          message: "Calendar sync started",
        },
      });

      this.performDocumentsSync(userId, syncType, syncLog.id, SYNC_SOURCE.GOOGLE_CALENDER).catch(
        (error) => {
          logger.error(`Calendar sync failed for user ${userId}: ${error.message}`);
        }
      );
    } catch (error) {
      logger.error(`Error initiating Calendar sync: ${error.message}`);
      res.status(500).json({ success: false, message: "Failed to start Calendar sync" });
    }
  }

  async performDocumentsSync(userId, syncType, syncLogId, source) {
    try {
      socketServer.emitSyncProgress(`${source}`, {
        syncId: syncLogId,
        status: "in_progress",
        phase: "ingesting",
        message: `Fetching and storing documents from ${source}...`,
        progress: 25,
      });
      const isFullSync = syncType === "full";
      // sync_logs/websocket source names ("gmail"/"google_calendar") differ
      // from IngestionPipeline's source keys ("gmail"/"calendar")
      const ingestionSource = INGESTION_SOURCE_BY_SYNC_SOURCE[source] || source;
      const ingestionResponse = await this.ingestionPipeline.runIngestion(
        ingestionSource,
        isFullSync,
        userId
      );

      logger.info(
        `${source} ingestion completed for user ${userId}: ${ingestionResponse.inserted} inserted, ${ingestionResponse.skipped} skipped, ${ingestionResponse.failed} failed`
      );

      if (ingestionResponse.failed > 0) {
        await this.syncLogRepo.complete(syncLogId, {
          status: "failed",
          documentsFetched: ingestionResponse.fetched,
          documentsStored: ingestionResponse.inserted,
          lastSyncTimestamp: new Date(),
        });
        return;
      }

      await this.syncLogRepo.complete(syncLogId, {
        status: "success",
        documentsFetched: ingestionResponse.fetched,
        documentsStored: ingestionResponse.inserted,
        lastSyncTimestamp: new Date(),
      });

      socketServer.emitSyncProgress(`${source}`, {
        syncId: syncLogId,
        status: "in_progress",
        phase: "embedding_start",
        message: "Documents stored. Starting embedding generation...",
        progress: 60,
        documentsAdded: ingestionResponse.inserted,
        documentsSkipped: ingestionResponse.skipped,
      });

      const embeddingResponse = await this.embeddingPipeline.runEmbedding(userId);

      logger.info(`${source} embedding generation completed`, {
        syncId: syncLogId,
        embeddingsProcessed: embeddingResponse.processed,
      });

      socketServer.emitSyncComplete(`${source}`, {
        syncId: syncLogId,
        status: "success",
        message: `${source} sync and embeddings completed successfully`,
        summary: {
          totalFetched: ingestionResponse.fetched,
          documentsAdded: ingestionResponse.inserted,
          documentsSkipped: ingestionResponse.skipped,
          documentsFailed: ingestionResponse.failed,
          embeddingsGenerated: embeddingResponse.processed,
          embeddingsFailed: embeddingResponse.failed,
        },
      });
    } catch (syncError) {
      logger.error(`${source} sync error for user ${userId}: ${syncError.message}`);
      await this.syncLogRepo.fail(syncLogId, syncError.message);

      socketServer.emitSyncError(`${source}`, {
        syncId: syncLogId,
        message: syncError.message,
        code: "SYNC_FAILED",
      });
    }
  }

  async getSyncStatus(req, res) {
    try {
      const { syncId } = req.params;
      const syncLog = await this.syncLogRepo.findById(syncId);
      if (!syncLog) {
        return res.status(404).json({
          success: false,
          error: "Sync operation not found",
        });
      }

      res.json({
        success: true,
        data: syncLog,
      });
    } catch (error) {
      logger.error(`Error fetching sync status: ${error.message}`);
      res.status(500).json({
        success: false,
        error: "Failed to fetch sync status",
      });
    }
  }

  async getSyncHistory(req, res) {
    try {
      const { userId, source = SYNC_SOURCE.GMAIL, limit = 10 } = req.query;
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "userId is required",
        });
      }

      const history = await this.syncLogRepo.findBySource(source, userId, parseInt(limit, 10));
      res.json({
        success: true,
        data: { history },
      });
    } catch (error) {
      logger.error(`Error fetching sync history: ${error.message}`);
      res.status(500).json({
        success: false,
        error: "Failed to fetch sync history",
      });
    }
  }
}
