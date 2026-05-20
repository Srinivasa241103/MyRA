import cron from "node-cron";
import { checkAndAlert } from "../alertServices/CredAlertService.js";
import { StatsRepository } from "../../database/statsRepository.js";
import { logger } from "../../utils/logger.js";

const statsRepo = new StatsRepository();

// Budget env vars (in USD). Set these in .env to override defaults.
const BUDGETS = {
  anthropic: Number(process.env.ANTHROPIC_MONTHLY_BUDGET) || 10,
  google: Number(process.env.GOOGLE_MONTHLY_BUDGET) || 5,
};

// Maps provider values stored in the DB to display names and budget keys
const PROVIDER_MAP = {
  anthropic: { name: "Anthropic Claude", budgetKey: "anthropic" },
  google: { name: "Google Gemini", budgetKey: "google" },
};

export default class CredsAlertCronJob {
  constructor() {
    this.isRunning = false;
    this.task = null;
    this.schedule = process.env.CREDS_ALERT_CRON_SCHEDULE || "* * * * *";
  }

  start() {
    if (this.task) {
      logger.warn("Creds alert cron job already running");
      return;
    }

    if (!cron.validate(this.schedule)) {
      logger.error("Invalid creds alert cron schedule", {
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

    logger.info("Creds alert cron job scheduled", {
      schedule: this.schedule,
      timezone: "Asia/Kolkata",
      nextRun: "09:00 AM IST daily",
    });
  }

  async executeJob() {
    if (this.isRunning) {
      logger.warn("Creds alert job already running, skipping");
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info("Creds alert cron job executing");

      const rows = await statsRepo.getLLMCredsUsage();

      if (!rows.length) {
        logger.info("Creds alert: no LLM usage recorded this month, skipping");
        return;
      }

      for (const row of rows) {
        const providerKey = row.provider?.toLowerCase();
        const meta = PROVIDER_MAP[providerKey];

        if (!meta) {
          logger.warn("Creds alert: unknown provider in usage data", {
            provider: row.provider,
          });
          continue;
        }

        const used = Number(row.totalcost) || 0;
        const budget = BUDGETS[meta.budgetKey];

        logger.info("Creds alert: checking usage", {
          service: meta.name,
          used,
          budget,
        });

        const alertResult = await checkAndAlert({
          service: meta.name,
          used,
          budget,
          unit: "$",
        });

        if (alertResult.sent) {
          logger.info("Creds alert: alert email sent", {
            service: meta.name,
            level: alertResult.level,
          });
        } else {
          logger.info("Creds alert: no email sent", {
            service: meta.name,
            reason: alertResult.reason,
          });
        }
      }

      logger.info("Creds alert cron job completed", {
        duration: Date.now() - startTime,
      });
    } catch (error) {
      logger.error("Creds alert cron job failed", error);
    } finally {
      this.isRunning = false;
    }
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info("Creds alert cron job stopped");
    }
  }

  getStatus() {
    return {
      running: this.task !== null,
      schedule: this.schedule,
      timezone: "Asia/Kolkata",
      currentlyExecuting: this.isRunning,
    };
  }

  async triggerManually() {
    logger.info("Manually triggering creds alert job");
    await this.executeJob();
  }
}
