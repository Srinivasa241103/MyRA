import "./src/config/env.js";
import { logger } from "./src/utils/logger.js";
import socketServer from "./src/service/websocket/sockeService.js";

import app from "./src/app.js";
import { connectToDB } from "./src/config/dbConfig.js";
import CronManager from "./src/service/cron/cronManager.js";

const PORT = process.env.PORT || 2020;
let server;
const cronManager = new CronManager();

connectToDB()
  .then(() => {
    console.log("Starting server...");
    server = app.listen(PORT, () => {
      console.log(`Server is running http://localhost:${PORT}`);

      // Initialize WebSocket server
      socketServer.initialize(server);
      logger.info("WebSocket server attached to HTTP server");

      if (process.env.ENABLE_CRON_JOBS !== "false") {
        cronManager.startAll();
      }
    });
  })
  .catch((err) => {
    logger.error("Failed to connect to the database", err);
    process.exit(1);
  });

const shutdown = (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);

  cronManager.stopAll();

  if (server) {
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
