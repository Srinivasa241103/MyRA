import "./src/config/env.js";
import { logger } from "./src/utils/logger.js";
import socketServer from "./src/service/websocket/sockeService.js";

import app from "./src/app.js";
import CronManager from "./src/service/cron/cronManager.js";
import { shutdown, startup } from "./src/observability/health/lifecycle.js";

const cronManager = new CronManager();

let server;
let runtimeConfig;

/**
 * FND-05.6 boot: the lifecycle module owns the ordering (validate config →
 * bind listener → connect Postgres → settle migrations → probe → ready); this
 * file wires only what is process-specific — the listener, the websocket
 * attach, cron, and the signal handlers.
 */
const bindListener = (config) =>
  new Promise((resolve, reject) => {
    server = app
      .listen(config.server.port, () => {
        logger.info(`Server is running http://localhost:${config.server.port}`);
        socketServer.initialize(server);
        logger.info("WebSocket server attached to HTTP server");
        resolve();
      })
      .once("error", reject);
  });

/**
 * Stop accepting connections, wait for in-flight requests up to the drain
 * deadline, then force-close whatever is left and report it.
 */
const closeHttpServer = (drainTimeoutMs) =>
  new Promise((resolve) => {
    if (!server || !server.listening) {
      resolve({ forced: false, openConnections: 0 });
      return;
    }

    const deadline = setTimeout(() => {
      server.getConnections((err, count) => {
        server.closeAllConnections();
        resolve({ forced: true, openConnections: err ? undefined : count });
      });
    }, drainTimeoutMs);
    deadline.unref();

    server.close(() => {
      clearTimeout(deadline);
      resolve({ forced: false, openConnections: 0 });
    });
    // Idle keep-alive sockets hold the server open without carrying a request.
    server.closeIdleConnections();
  });

startup({
  bindListener,
  startCron: () => cronManager.startAll(),
})
  .then((result) => {
    runtimeConfig = result.config;
  })
  .catch((err) => {
    // Configuration or listener failure: nothing can be served, not even
    // /health/*. ConfigValidationError lists variable names, never values.
    logger.error("Startup failed before the service could report health", err);
    process.exit(1);
  });

const handleSignal = (signal) => {
  shutdown(signal, {
    drainTimeoutMs: runtimeConfig?.runtime.shutdownDrainTimeoutMs,
    stopCron: () => cronManager.stopAll(),
    closeWebsockets: () => {
      // Long-lived by design — disconnect so the HTTP drain isn't spent
      // waiting on connections that would never close; clients reconnect.
      socketServer.getIO()?.disconnectSockets(true);
    },
    closeHttpServer,
  })
    .then((exitCode) => process.exit(exitCode))
    .catch((err) => {
      logger.error("Shutdown failed", err);
      process.exit(1);
    });
};

process.on("SIGTERM", () => handleSignal("SIGTERM"));
process.on("SIGINT", () => handleSignal("SIGINT"));
