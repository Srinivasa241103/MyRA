import CredsAlertCronJob from "./credsAlertCron.js";
import { logger } from "../../utils/logger.js";

export default class CronManager {
  constructor() {
    this.jobs = {
      credsAlert: new CredsAlertCronJob(),
    };
  }

  startAll() {
    logger.info("Starting all cron jobs");
    try {
      if (process.env.ENABLE_EMBEDDING_CRON !== "false") {
        this.jobs.embedding.start();
      }
      if (process.env.ENABLE_GMAIL_SYNC_CRON !== "false") {
        this.jobs.gmailSync.start();
      }
      if (process.env.ENABLE_CALENDAR_SYNC_CRON !== "false") {
        this.jobs.calendarSync.start();
      }
      if (process.env.ENABLE_CREDS_ALERT_CRON !== "false") {
        this.jobs.credsAlert.start();
      }
    } catch (error) {
      logger.error("Error starting cron jobs", error);
      throw error;
    }
  }

  stopAll() {
    logger.info("Stopping all cron jobs");
    Object.values(this.jobs).forEach((job) => job.stop());
    logger.info("All cron jobs stopped");
  }

  getAllStatus() {
    return {
      embedding: this.jobs.embedding.getStatus(),
      gmailSync: this.jobs.gmailSync.getStatus(),
      calendarSync: this.jobs.calendarSync.getStatus(),
      credsAlert: this.jobs.credsAlert.getStatus(),
    };
  }

  async triggerJob(jobName) {
    if (!this.jobs[jobName]) {
      throw new Error(`Unknown job: ${jobName}`);
    }
    logger.info("Manually triggering job", { jobName });
    await this.jobs[jobName].triggerManually();
  }
}
