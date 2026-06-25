import "./src/config/env.js";
import { logger } from "./src/utils/logger.js";
import socketServer from "./src/service/websocket/sockeService.js";

import app from "./src/app.js";
import { connectToDB } from "./src/config/dbConfig.js";

const PORT = process.env.PORT || 2020;
let server;

connectToDB()
  .then(() => {
    console.log("Starting server...");
    server = app.listen(PORT, () => {
      console.log(`Server is running http://localhost:${PORT}`);

      // Initialize WebSocket server
      socketServer.initialize(server);
      logger.info("WebSocket server attached to HTTP server");

    });
  })
  .catch((err) => {
    logger.error("Failed to connect to the database", err);
    process.exit(1);
  });

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down gracefully");

  if (server) {
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down gracefully");

  if (server) {
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});
