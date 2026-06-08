import GmailDataSource from "../../service/sources/GmailDataSource.js";
import GoogleCalendarDataSource from "../../service/sources/GoogleCalendarDataSource.js";
import { logger } from "../../utils/logger.js";
import { GmailNormalizer } from "../../service/normalizers/GmailNormalizer.js";
import { GoogleCalendarNormalizer } from "../../service/normalizers/GoogleCalendarNormalizer.js";
import { SyncLogRepository } from "../../database/syncLogsRepository.js";
import { DocumentRepository } from "../../database/documentRepository.js";
import socketServer from "../../service/websocket/sockeService.js";

// TODO: wire the new RAG ingestion/embedding pipeline (src/RAG/ingestion) in
// here to replace the old embeddingPipeline.processAllPendingEmbeddings calls.

export default class SyncController {
  constructor() {
    this.documentRepo = new DocumentRepository();
    this.syncLogRepo = new SyncLogRepository();
  }

  async syncGmail(req, res) {
    try {
      const {
        userId,
        syncType = "incremental",
        sinceDate = "2025/12/31",
      } = req.body;
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "userId is required",
        });
      }
      logger.info(`Starting ${syncType} Gmailsync for user ${userId}`);

      const syncLog = await this.syncLogRepo.create("gmail");
      res.json({
        success: true,
        data: {
          syncId: syncLog.id,
          status: "running",
          message: `Gmail sync started`,
        },
      });

      this.performSync(userId, syncType, syncLog.id, sinceDate).catch(
        (error) => {
          logger.error(
            `Gmail sync failed for user ${userId}: ${error.message}`
          );
        }
      );
    } catch (error) {
      logger.error(`Error initiating Gmail sync: ${error.message}`);
      res.status(500).json({
        success: false,
        message: "Failed to start Gmail sync",
      });
    }
  }

  async performSync(userId, syncType, syncLogId, sinceDate) {
    try {
      // Emit: Starting sync
      socketServer.emitSyncProgress("gmail", {
        syncId: syncLogId,
        status: "in_progress",
        phase: "fetching",
        message: "Fetching emails from Gmail...",
        progress: 0,
      });

      const gmailSource = new GmailDataSource(userId);
      let rawMessages;

      if (syncType == "full") {
        const sinceTimestamp = Math.floor(new Date(sinceDate).getTime() / 1000);
        rawMessages = await gmailSource.fetchAll({
          maxResults: Infinity,
          query: `after:${sinceTimestamp}`,
        });
      } else {
        const lastSync = await this.syncLogRepo.getLastSuccessfulSync("gmail");
        const since =
          lastSync?.sync_completed_at ||
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        rawMessages = await gmailSource.fetchNew(since);
      }

      logger.info(
        `Fetched ${rawMessages.length} Gmail messages for user ${userId}`
      );

      // Emit: Fetching complete, starting normalization
      socketServer.emitSyncProgress("gmail", {
        syncId: syncLogId,
        status: "in_progress",
        phase: "normalizing",
        message: `Fetched ${rawMessages.length} emails. Processing...`,
        progress: 25,
        totalMessages: rawMessages.length,
      });

      const normalizer = new GmailNormalizer();
      const normalizedDocs = normalizer.normalizeBatch(rawMessages, userId);
      logger.info(
        `Normalized ${normalizedDocs.length} Gmail documents for user ${userId}`
      );

      // Emit: Normalization complete, starting storage
      socketServer.emitSyncProgress("gmail", {
        syncId: syncLogId,
        status: "in_progress",
        phase: "storing",
        message: `Storing ${normalizedDocs.length} documents...`,
        progress: 50,
        totalDocuments: normalizedDocs.length,
      });

      let documentsAdded = 0;
      let documentsFailed = 0;
      let documentsSkipped = 0;
      const totalDocs = normalizedDocs.length;

      for (let i = 0; i < normalizedDocs.length; i++) {
        const doc = normalizedDocs[i];
        try {
          const existing = await this.documentRepo.findByDocumentId(
            doc.documentId
          );

          // Skip if document already exists
          if (existing) {
            documentsSkipped++;
            continue;
          }

          // Map camelCase to snake_case for database
          const dbDocument = {
            document_id: doc.documentId,
            source: doc.source,
            type: doc.type,
            content: doc.content,
            title: doc.title,
            timestamp: doc.timestamp,
            author: doc.author,
            metadata: doc.metadata,
          };

          await this.documentRepo.create(dbDocument);
          documentsAdded++;
        } catch (docError) {
          logger.error(
            `Failed to store document ${doc.documentId}: ${docError.message}`
          );
          documentsFailed++;
        }

        // Emit progress every 10 documents or on last document
        if ((i + 1) % 10 === 0 || i === totalDocs - 1) {
          const progressPercent = 50 + Math.floor(((i + 1) / totalDocs) * 50);
          socketServer.emitSyncProgress("gmail", {
            syncId: syncLogId,
            status: "in_progress",
            phase: "storing",
            message: `Processed ${i + 1}/${totalDocs} documents...`,
            progress: progressPercent,
            documentsAdded,
            documentsSkipped,
            documentsFailed,
          });
        }
      }

      await this.syncLogRepo.complete(syncLogId, {
        status: "success",
        documentsFetched: rawMessages.length,
        documentsStored: documentsAdded,
        lastSyncTimestamp: new Date(),
      });

      logger.info(
        `Gmail sync completed for user ${userId}: ${documentsAdded} added, ${documentsSkipped} skipped, ${documentsFailed} failed`
      );

      // Emit: Documents stored, starting embeddings
      socketServer.emitSyncProgress("gmail", {
        syncId: syncLogId,
        status: "in_progress",
        phase: "embedding_start",
        message: "Documents stored. Starting embedding generation...",
        progress: 60,
        documentsAdded,
        documentsSkipped,
      });

      // Step 2: Process ALL pending embeddings
      // TODO: replace with the new RAG ingestion pipeline (src/RAG/ingestion)
      logger.info("Starting embedding generation for synced documents");
      const embeddingResult = { processed: 0, duration: 0 };

      logger.info("Embedding generation completed", {
        syncId: syncLogId,
        embeddingsProcessed: embeddingResult.processed,
      });

      // Emit: Everything complete (sync + embeddings)
      socketServer.emitSyncComplete("gmail", {
        syncId: syncLogId,
        status: "success",
        message: "Gmail sync and embeddings completed successfully",
        summary: {
          totalFetched: rawMessages.length,
          documentsAdded,
          documentsSkipped,
          documentsFailed,
          embeddingsGenerated: embeddingResult.processed,
          embeddingDuration: embeddingResult.duration,
        },
      });
    } catch (syncError) {
      logger.error(`Gmail sync error for user ${userId}: ${syncError.message}`);
      await this.syncLogRepo.fail(syncLogId, syncError.message);

      // Emit: Sync failed
      socketServer.emitSyncError("gmail", {
        syncId: syncLogId,
        message: syncError.message,
        code: "SYNC_FAILED",
      });
    }
  }

  async syncCalendar(req, res) {
    try {
      const {
        userId,
        syncType = "incremental",
        sinceDate = "2026-01-01",
      } = req.body;

      if (!userId) {
        return res.status(400).json({ success: false, message: "userId is required" });
      }

      logger.info(`Starting ${syncType} Calendar sync for user ${userId}`);

      const syncLog = await this.syncLogRepo.create("google_calendar");
      res.json({
        success: true,
        data: {
          syncId: syncLog.id,
          status: "running",
          message: "Calendar sync started",
        },
      });

      this.performCalendarSync(userId, syncType, syncLog.id, sinceDate).catch(
        (error) => {
          logger.error(`Calendar sync failed for user ${userId}: ${error.message}`);
        }
      );
    } catch (error) {
      logger.error(`Error initiating Calendar sync: ${error.message}`);
      res.status(500).json({ success: false, message: "Failed to start Calendar sync" });
    }
  }

  async performCalendarSync(userId, syncType, syncLogId, sinceDate) {
    try {
      socketServer.emitSyncProgress("google_calendar", {
        syncId: syncLogId,
        status: "in_progress",
        phase: "fetching",
        message: "Fetching events from Google Calendar...",
        progress: 0,
      });

      const calendarSource = new GoogleCalendarDataSource(userId);
      let rawEvents;

      if (syncType === "full") {
        rawEvents = await calendarSource.fetchAll({
          timeMin: new Date(sinceDate).toISOString(),
          maxResults: Infinity,
        });
      } else {
        const lastSync = await this.syncLogRepo.getLastSuccessfulSync("google_calendar");
        const since =
          lastSync?.sync_completed_at ||
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        rawEvents = await calendarSource.fetchNew(since);
      }

      logger.info(`Fetched ${rawEvents.length} Calendar events for user ${userId}`);

      socketServer.emitSyncProgress("google_calendar", {
        syncId: syncLogId,
        status: "in_progress",
        phase: "normalizing",
        message: `Fetched ${rawEvents.length} events. Processing...`,
        progress: 25,
        totalMessages: rawEvents.length,
      });

      const normalizer = new GoogleCalendarNormalizer();
      const normalizedDocs = normalizer.normalizeBatch(rawEvents, userId);
      logger.info(`Normalized ${normalizedDocs.length} Calendar documents for user ${userId}`);

      socketServer.emitSyncProgress("google_calendar", {
        syncId: syncLogId,
        status: "in_progress",
        phase: "storing",
        message: `Storing ${normalizedDocs.length} documents...`,
        progress: 50,
        totalDocuments: normalizedDocs.length,
      });

      let documentsAdded = 0;
      let documentsFailed = 0;
      let documentsSkipped = 0;
      const totalDocs = normalizedDocs.length;

      for (let i = 0; i < normalizedDocs.length; i++) {
        const doc = normalizedDocs[i];
        try {
          const existing = await this.documentRepo.findByDocumentId(doc.documentId);

          if (existing) {
            documentsSkipped++;
            continue;
          }

          await this.documentRepo.create({
            document_id: doc.documentId,
            source: doc.source,
            type: doc.type,
            content: doc.content,
            title: doc.title,
            timestamp: doc.timestamp,
            author: doc.author,
            metadata: doc.metadata,
          });
          documentsAdded++;
        } catch (docError) {
          logger.error(`Failed to store document ${doc.documentId}: ${docError.message}`);
          documentsFailed++;
        }

        if ((i + 1) % 10 === 0 || i === totalDocs - 1) {
          const progressPercent = 50 + Math.floor(((i + 1) / totalDocs) * 50);
          socketServer.emitSyncProgress("google_calendar", {
            syncId: syncLogId,
            status: "in_progress",
            phase: "storing",
            message: `Processed ${i + 1}/${totalDocs} documents...`,
            progress: progressPercent,
            documentsAdded,
            documentsSkipped,
            documentsFailed,
          });
        }
      }

      await this.syncLogRepo.complete(syncLogId, {
        status: "success",
        documentsFetched: rawEvents.length,
        documentsStored: documentsAdded,
        lastSyncTimestamp: new Date(),
      });

      logger.info(
        `Calendar sync completed for user ${userId}: ${documentsAdded} added, ${documentsSkipped} skipped, ${documentsFailed} failed`
      );

      socketServer.emitSyncProgress("google_calendar", {
        syncId: syncLogId,
        status: "in_progress",
        phase: "embedding_start",
        message: "Documents stored. Starting embedding generation...",
        progress: 60,
        documentsAdded,
        documentsSkipped,
      });

      // TODO: replace with the new RAG ingestion pipeline (src/RAG/ingestion)
      const embeddingResult = { processed: 0, duration: 0 };

      logger.info("Calendar embedding generation completed", {
        syncId: syncLogId,
        embeddingsProcessed: embeddingResult.processed,
      });

      socketServer.emitSyncComplete("google_calendar", {
        syncId: syncLogId,
        status: "success",
        message: "Calendar sync and embeddings completed successfully",
        summary: {
          totalFetched: rawEvents.length,
          documentsAdded,
          documentsSkipped,
          documentsFailed,
          embeddingsGenerated: embeddingResult.processed,
          embeddingDuration: embeddingResult.duration,
        },
      });
    } catch (syncError) {
      logger.error(`Calendar sync error for user ${userId}: ${syncError.message}`);
      await this.syncLogRepo.fail(syncLogId, syncError.message);

      socketServer.emitSyncError("google_calendar", {
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
      const { userId, source = "gmail", limit = 10 } = req.query;
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "userId is required",
        });
      }

      const history = await this.syncLogRepo.findBySource(source);
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
