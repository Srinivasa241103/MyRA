import { StatsRepository } from "../../database/statsRepository.js";
import { logger } from "../../utils/logger.js";

const RANGE_TO_DAYS = { "7d": 7, "14d": 14, "30d": 30, "90d": 90 };

const MODEL_COLORS = {
  "claude-haiku-4-5-20251001": "#7A4A2E",
  "claude-3-5-sonnet-20241022": "#C9845A",
  "gemini-embedding-001": "#D4A96A",
};

const EMBEDDING_MODEL_PROVIDER = {
  "gemini-embedding-001": "Google",
};
const DEFAULT_COLOR = "#8C6A4A";

export default class StatsController {
  constructor() {
    this.statsRepo = new StatsRepository();
  }

  async getAllStats(req, res) {
    const rangeParam = req.query.range || "14d";
    const days = RANGE_TO_DAYS[rangeParam] ?? 14;

    try {
      const [tokensData, embeddingData, sessionData, emailsData, calData] = await Promise.all([
        this.statsRepo.getCostAndTokensConsumed(days),
        this.statsRepo.getEmbeddingCostAndTokens(days),
        this.statsRepo.getConversationSessions(days),
        this.statsRepo.getEmails(days),
        this.statsRepo.getCalendarEvents(days),
      ]);

      // tokens: one entry per model with total token count + color
      const tokens = [
        ...tokensData.map((row) => ({
          name: row.model,
          value:
            parseInt(row.totalinputtokens || 0) +
            parseInt(row.totaloutputtokens || 0),
          color: MODEL_COLORS[row.model] || DEFAULT_COLOR,
        })),
        ...embeddingData.map((row) => ({
          name: row.model,
          value: parseInt(row.totaltokens || 0),
          color: MODEL_COLORS[row.model] || DEFAULT_COLOR,
        })),
      ];

      // cost: aggregate spend by provider (multiple models can share a provider)
      const costMap = {};
      for (const row of tokensData) {
        const spend =
          parseFloat(row.totalinputcost || 0) +
          parseFloat(row.totaloutputcost || 0);
        costMap[row.provider] = (costMap[row.provider] || 0) + spend;
      }
      for (const row of embeddingData) {
        const provider =
          EMBEDDING_MODEL_PROVIDER[row.model] || row.model;
        const spend = parseFloat(row.totalcost || 0);
        costMap[provider] = (costMap[provider] || 0) + spend;
      }
      const cost = Object.entries(costMap).map(([provider, spend]) => ({
        provider,
        spend: parseFloat(spend.toFixed(2)),
      }));

      const sessions = sessionData.map((row) => parseInt(row.totalsessions || 0));
      const emails = emailsData.map((row) => parseInt(row.count || 0));
      const calEvents = calData.map((row) => parseInt(row.count || 0));

      return res.status(200).json({
        success: true,
        data: {
          emails,
          tokens,
          reminders: [],
          cost,
          sessions,
          calEvents,
        },
      });
    } catch (error) {
      logger.error("Error fetching stats", { error: error.message });
      return res
        .status(500)
        .json({ success: false, error: "Failed to fetch stats" });
    }
  }
}
