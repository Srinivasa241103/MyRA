import { getPool } from "../config/dbConfig.js";

export class StatsRepository {
  async insertLLMPrice(stats) {
    const query = `INSERT INTO llm_usage_logs (
                    conversation_id,
                    provider,
                    model,
                    input_tokens,
                    output_tokens,
                    input_cost,
                    output_cost,
                    invocation_type
                  )
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;
    await getPool().query(query, [
      stats.conversationId,
      stats.provider,
      stats.model,
      stats.inputTokens,
      stats.outputTokens,
      stats.inputCost,
      stats.outputCost,
      stats.invocationType,
    ]);
  }

  async getCostAndTokensConsumed(days) {
    const query = `SELECT
                    provider,
                    model,
                    SUM(input_tokens) AS totalinputtokens,
                    SUM(output_tokens) AS totaloutputtokens,
                    SUM(input_cost) AS totalinputcost,
                    SUM(output_cost) AS totaloutputcost
                  FROM llm_usage_logs
                  WHERE created_at >= NOW() - INTERVAL '${days} days'
                  GROUP BY provider, model`;
    const result = await getPool().query(query);
    return result.rows;
  }

  async getEmbeddingCostAndTokens(days) {
    const query = `SELECT
                    model,
                    SUM(total_tokens) AS totaltokens,
                    SUM(estimated_cost) AS totalcost
                  FROM embedding_costs
                  WHERE processed_at >= NOW() - INTERVAL '${days} days'
                  GROUP BY model`;
    const result = await getPool().query(query);
    return result.rows;
  }

  async getConversationSessions(days) {
    const query = `SELECT DATE(created_at) AS day, COUNT(DISTINCT conversation_id) AS totalsessions
                  FROM conversations
                  WHERE created_at >= NOW() - INTERVAL '${days} days'
                  GROUP BY DATE(created_at)
                  ORDER BY DATE(created_at) ASC`;
    const result = await getPool().query(query);
    return result.rows;
  }

  async getEmails(days) {
    const query = `SELECT DATE(created_at) AS day, COUNT(*) AS count
                  FROM documents
                  WHERE source = 'gmail'
                  AND created_at >= NOW() - INTERVAL '${days} days'
                  GROUP BY DATE(created_at)
                  ORDER BY DATE(created_at) ASC`;
    const result = await getPool().query(query);
    return result.rows;
  }

  async getCalendarEvents(days) {
    const query = `SELECT DATE(created_at) AS day, COUNT(*) AS count
                  FROM documents
                  WHERE source = 'google_calendar'
                  AND created_at >= NOW() - INTERVAL '${days} days'
                  GROUP BY DATE(created_at)
                  ORDER BY DATE(created_at) ASC`;
    const result = await getPool().query(query);
    return result.rows;
  }
}
