import cron from "node-cron";
import { sendBudgetAlert } from "../alertServices/CredAlertService.js";
import { apiBudgetRepository } from "../../database/apiBudgetRepository.js";
import { getAlertLevels } from "../../utils/emailTemplates.js";
import { logger } from "../../utils/logger.js";

export default class CredsAlertCronJob {
  constructor() {
    this.isRunning = false;
    this.task = null;
    this.schedule =
      process.env.API_BUDGET_ALERT_CRON_SCHEDULE ||
      process.env.CREDS_ALERT_CRON_SCHEDULE ||
      "0 9 * * *";
    this.timezone = process.env.CRON_TIMEZONE || "Asia/Kolkata";
  }

  start() {
    if (this.task) {
      logger.warn("API budget alert cron job already running");
      return;
    }

    if (!cron.validate(this.schedule)) {
      logger.error("Invalid API budget alert cron schedule", {
        schedule: this.schedule,
      });
      throw new Error(`Invalid cron schedule: ${this.schedule}`);
    }

    this.task = cron.schedule(
      this.schedule,
      async () => {
        await this.executeJob();
      },
      { timezone: this.timezone },
    );

    logger.info("API budget alert cron job scheduled", {
      schedule: this.schedule,
      timezone: this.timezone,
    });
  }

  async executeJob() {
    if (this.isRunning) {
      logger.warn("API budget alert job already running, skipping");
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();
    let sent = 0;
    let failed = 0;

    try {
      const candidates =
        await apiBudgetRepository.getCurrentMonthAlertCandidates();

      for (const candidate of candidates) {
        const used = Number(candidate.usage_inr) || 0;
        const budget = Number(candidate.monthly_budget_inr);
        const percent = (used / budget) * 100;
        const crossedLevels = getAlertLevels(percent, candidate.thresholds);
        const level = crossedLevels.at(-1);

        if (!level) continue;

        const claim = await apiBudgetRepository.claimAlert({
          apiBudgetId: candidate.api_budget_id,
          userId: candidate.user_id,
          providerKey: candidate.provider_key,
          periodStart: candidate.alert_period_start,
          thresholdKey: level.key,
          thresholdPercent: level.threshold,
          usageInr: used,
          budgetInr: budget,
        });

        if (!claim) continue;

        const result = await sendBudgetAlert({
          service: candidate.provider_name,
          used,
          budget,
          recipient: candidate.email,
          level,
          periodStart: candidate.usage_period_start,
          periodEnd: candidate.usage_period_end,
        });

        if (result.sent) {
          await apiBudgetRepository.markAlertSent(claim.id, result.messageId);
          sent += 1;
        } else {
          await apiBudgetRepository.markAlertFailed(claim.id, result.reason);
          failed += 1;
        }
      }

      logger.info("API budget alert cron job completed", {
        candidates: candidates.length,
        sent,
        failed,
        duration: Date.now() - startTime,
      });
    } catch (error) {
      logger.error("API budget alert cron job failed", error);
    } finally {
      this.isRunning = false;
    }
  }

  stop() {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info("API budget alert cron job stopped");
    }
  }

  getStatus() {
    return {
      running: this.task !== null,
      schedule: this.schedule,
      timezone: this.timezone,
      currentlyExecuting: this.isRunning,
    };
  }

  async triggerManually() {
    logger.info("Manually triggering API budget alert job");
    await this.executeJob();
  }
}
