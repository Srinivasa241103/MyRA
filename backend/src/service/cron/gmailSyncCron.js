import cron from "node-cron";
import SyncController from "../../api/controllers/syncController.js";
import { SyncLogRepository } from "../../database/syncLogsRepository.js";
import { logger } from "../../utils/logger.js";

const syncController = new SyncController();
const syncLogRepo = new SyncLogRepository();

export default class GmailSyncCronJob {
  constructor() {
    this.isRunning = false;
    this.task = null;
    this.schedule = process.env.GMAIL_SYNC_CRON_SCHEDULE || "30 4 * * *";
    this.userId = process.env.SYNC_USER_ID;
  }

  start() {
    if (this.task) {
      logger.warn("Gmail sync cron job already running");
      return;
    }

    if (!this.userId) {
      logger.warn("SYNC_USER_ID not set in env — Gmail sync cron will not start");
      return;
    }

    if (!cron.validate(this.schedule)) {
      logger.error("Invalid Gmail sync cron schedule", { schedule: this.schedule });
      throw new Error(`Invalid cron schedule: ${this.schedule}`);
    }

    this.task = cron.schedule(
      this.schedule,
      async () => {
        await this.executeJob();
      },
      { timezone: "Asia/Kolkata" }
    );

    logger.info("Gmail sync cron job scheduled", {
      schedule: this.schedule,
      timezone: "Asia/Kolkata",
      nextRun: "04:30 AM IST daily",
      userId: this.userId,
    });
  }

  async executeJob() {
    if (this.isRunning) {
      logger.warn("Gmail sync already running, skipping this execution");
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info("Gmail sync cron job executing", { userId: this.userId });

      const syncLog = await syncLogRepo.create("gmail");
      await syncController.performSync(
        this.userId,
        "incremental",
        syncLog.id,
        null
      );

      const duration = Date.now() - startTime;
      logger.info("Gmail sync cron job completed", {
        duration,
        userId: this.userId,
      });
    } catch (error) {
      logger.error("Gmail sync cron job failed", error);
    } finally {
      this.isRunning = false;
    }
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info("Gmail sync cron job stopped");
    }
  }

  getStatus() {
    return {
      running: this.task !== null,
      schedule: this.schedule,
      timezone: "Asia/Kolkata",
      currentlyExecuting: this.isRunning,
      userId: this.userId,
    };
  }

  async triggerManually() {
    logger.info("Manually triggering Gmail sync job");
    await this.executeJob();
  }
}
