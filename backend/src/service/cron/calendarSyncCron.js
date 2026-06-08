import cron from "node-cron";
import SyncController from "../../api/controllers/syncController.js";
import { SyncLogRepository } from "../../database/syncLogsRepository.js";
import { SYNC_SOURCE } from "../../utils/constants.js";
import { logger } from "../../utils/logger.js";

const syncController = new SyncController();
const syncLogRepo = new SyncLogRepository();

export default class CalendarSyncCronJob {
  constructor() {
    this.isRunning = false;
    this.task = null;
    this.schedule = process.env.CALENDAR_SYNC_CRON_SCHEDULE || "0 5 * * *";
    this.userId = process.env.SYNC_USER_ID;
  }

  start() {
    if (this.task) {
      logger.warn("Calendar sync cron job already running");
      return;
    }

    if (!this.userId) {
      logger.warn(
        "SYNC_USER_ID not set in env — Calendar sync cron will not start"
      );
      return;
    }

    if (!cron.validate(this.schedule)) {
      logger.error("Invalid Calendar sync cron schedule", {
        schedule: this.schedule,
      });
      throw new Error(`Invalid cron schedule: ${this.schedule}`);
    }

    this.task = cron.schedule(
      this.schedule,
      async () => {
        await this.executeJob();
      },
      { timezone: "Asia/Kolkata" }
    );

    logger.info("Calendar sync cron job scheduled", {
      schedule: this.schedule,
      timezone: "Asia/Kolkata",
      nextRun: "05:00 AM IST daily",
      userId: this.userId,
    });
  }

  async executeJob() {
    if (this.isRunning) {
      logger.warn("Calendar sync already running, skipping this execution");
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info("Calendar sync cron job executing", { userId: this.userId });

      const syncLog = await syncLogRepo.create("google_calendar", this.userId);
      await syncController.performDocumentsSync(
        this.userId,
        "incremental",
        syncLog.id,
        SYNC_SOURCE.GOOGLE_CALENDER
      );

      const duration = Date.now() - startTime;
      logger.info("Calendar sync cron job completed", {
        duration,
        userId: this.userId,
      });
    } catch (error) {
      logger.error("Calendar sync cron job failed", error);
    } finally {
      this.isRunning = false;
    }
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info("Calendar sync cron job stopped");
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
    logger.info("Manually triggering Calendar sync job");
    await this.executeJob();
  }
}
