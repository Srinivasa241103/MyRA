import CredsAlertCronJob from "./credsAlertCron.js";
import GoogleWorkspaceSyncCronJob from "./googleWorkspaceSyncCron.js";
import { logger } from "../../utils/logger.js";

export default class CronManager {
  constructor() {
    this.jobs = {
      googleWorkspaceSync: new GoogleWorkspaceSyncCronJob(),
      credsAlert: new CredsAlertCronJob(),
    };
  }

  startAll() {
    logger.info("Starting all cron jobs");
    try {
      if (process.env.ENABLE_GOOGLE_WORKSPACE_SYNC_CRON !== "false") {
        this.jobs.googleWorkspaceSync.start();
      }
      if (
        process.env.ENABLE_API_BUDGET_ALERT_CRON === "true" ||
        process.env.ENABLE_CREDS_ALERT_CRON === "true"
      ) {
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
    return Object.fromEntries(
      Object.entries(this.jobs).map(([name, job]) => [name, job.getStatus()])
    );
  }

  async triggerJob(jobName) {
    if (!this.jobs[jobName]) {
      throw new Error(`Unknown job: ${jobName}`);
    }
    logger.info("Manually triggering job", { jobName });
    await this.jobs[jobName].triggerManually();
  }
}
