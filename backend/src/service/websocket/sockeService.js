import { Server } from "socket.io";
import { logger } from "../../utils/logger.js";
import {
  extractBearerToken,
  getDevelopmentPrincipal,
  verifyAccessToken,
} from "../../api/middleware/requireAuth.js";

function userRoom(userId) {
  return `user:${String(userId)}`;
}

export class SocketServer {
  constructor() {
    this.io = null;
    this.connectedClients = new Map();
  }

  initialize(httpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || "http://localhost:5173",
        methods: ["GET", "POST"],
        credentials: true,
      },
      pingTimeout: 60000,
      pingInterval: 25000,
    });
    this.setupAuthentication();
    this.setupEventHandlers();
    logger.info("WebSocket server initialized");
    return this;
  }

  setupAuthentication() {
    this.io.use((socket, next) => {
      const suppliedToken = socket.handshake.auth?.token;
      const headerToken = extractBearerToken(
        socket.handshake.headers.authorization,
      );

      try {
        const principal = suppliedToken
          ? verifyAccessToken(suppliedToken)
          : headerToken
            ? verifyAccessToken(headerToken)
            : getDevelopmentPrincipal();

        if (!principal) {
          return next(new Error("Authentication required"));
        }

        socket.data.user = principal;
        return next();
      } catch {
        return next(new Error("Authentication required"));
      }
    });
  }

  setupEventHandlers() {
    this.io.on("connection", (socket) => {
      logger.info(`Client connected: ${socket.id}`);
      const userId = socket.data.user.userId;
      socket.join(userRoom(userId));
      this.connectedClients.set(socket.id, {
        connectedAt: new Date(),
        userId,
      });

      socket.on("ping", () => {
        socket.emit("pong");
      });

      socket.on("disconnect", (reason) => {
        logger.info(`Client disconnected: ${socket.id}, reason: ${reason}`);
        this.connectedClients.delete(socket.id);
      });

      socket.on("error", (error) => {
        logger.error(
          `WebSocket error from client ${socket.id}: ${error.message}`
        );
      });

      socket.emit("connected", {
        socketId: socket.id,
        timestamp: new Date().toISOString(),
      });
    });
  }

  emitSyncProgress(userId, source, update) {
    if (!this.io) {
      logger.warn("Socket.IO not initialized");
      return;
    }

    const event = `sync:${source}:progress`;
    this.io.to(userRoom(userId)).emit(event, {
      source,
      ...update,
      timestamp: new Date().toISOString(),
    });

    logger.debug(`Emitted ${event}:`, update);
  }

  emitSyncComplete(userId, source, result) {
    if (!this.io) return;

    const event = `sync:${source}:complete`;
    this.io.to(userRoom(userId)).emit(event, {
      source,
      ...result,
      timestamp: new Date().toISOString(),
    });

    logger.info(`Sync completed for ${source}:`, result);
  }

  emitSyncError(userId, source, error) {
    if (!this.io) return;

    const event = `sync:${source}:error`;
    this.io.to(userRoom(userId)).emit(event, {
      source,
      error: {
        message: error.message,
        code: error.code || "SYNC_ERROR",
        details: error.details || null,
      },
      timestamp: new Date().toISOString(),
    });

    logger.error(`Sync error for ${source}:`, error);
  }

  emitEmbeddingProgress(userId, progress) {
    if (!this.io) return;

    this.io.to(userRoom(userId)).emit("embeddings:progress", {
      ...progress,
      timestamp: new Date().toISOString(),
    });
  }

  emitQueryProgress(userId, queryId, update) {
    if (!this.io) return;

    this.io.to(userRoom(userId)).emit("query:progress", {
      queryId,
      ...update,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Emit RAG pipeline progress for chat queries
   * @param {string} queryId - Unique query identifier
   * @param {Object} update - Progress update details
   */
  emitRAGProgress(userId, queryId, update) {
    if (!this.io) return;

    this.io.to(userRoom(userId)).emit("rag:progress", {
      queryId,
      ...update,
      timestamp: new Date().toISOString(),
    });

    logger.debug(`RAG progress [${queryId}]: ${update.stage} - ${update.message}`);
  }

  /**
   * Emit RAG pipeline completion
   */
  emitRAGComplete(userId, queryId, result) {
    if (!this.io) return;

    this.io.to(userRoom(userId)).emit("rag:complete", {
      queryId,
      ...result,
      timestamp: new Date().toISOString(),
    });

    logger.info(`RAG completed [${queryId}]`);
  }

  /**
   * Emit RAG pipeline error
   */
  emitRAGError(userId, queryId, error) {
    if (!this.io) return;

    this.io.to(userRoom(userId)).emit("rag:error", {
      queryId,
      error: {
        message: error.message || error,
        stage: error.stage || "unknown",
      },
      timestamp: new Date().toISOString(),
    });

    logger.error(`RAG error [${queryId}]: ${error.message || error}`);
  }

  emitHealthUpdate(health) {
    if (!this.io) return;

    this.io.emit("system:health", {
      ...health,
      timestamp: new Date().toISOString(),
    });
  }

  getConnectedClientsCount() {
    return this.connectedClients.size;
  }

  getIO() {
    return this.io;
  }
}

// Export as singleton for easy import across the app
const socketServer = new SocketServer();
export default socketServer;
