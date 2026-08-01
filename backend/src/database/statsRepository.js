import { getPool } from "../config/dbConfig.js";

export const LLM_USAGE_INSERT_SQL = `INSERT INTO llm_usage_logs (
                    conversation_id,
                    provider,
                    model,
                    input_tokens,
                    output_tokens,
                    input_cost,
                    output_cost,
                    invocation_type,
                    user_id
                  )
                  VALUES (
                    $1::varchar(255),
                    $2::varchar(50),
                    $3::varchar(100),
                    $4::integer,
                    $5::integer,
                    $6::numeric,
                    $7::numeric,
                    $8::varchar(50),
                    $9::integer
                  )
                  RETURNING id, total_tokens, total_cost`;

function finiteNonNegative(value, fieldName) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new TypeError(`${fieldName} must be a finite, non-negative number`);
  }

  return numericValue;
}

export class StatsRepository {
  async insertLLMPrice(stats, queryable = getPool()) {
    const inputTokens = finiteNonNegative(stats.inputTokens, "inputTokens");
    const outputTokens = finiteNonNegative(stats.outputTokens, "outputTokens");
    const inputCost = finiteNonNegative(stats.inputCost, "inputCost");
    const outputCost = finiteNonNegative(stats.outputCost, "outputCost");

    const result = await queryable.query(LLM_USAGE_INSERT_SQL, [
      stats.conversationId,
      stats.provider,
      stats.model,
      inputTokens,
      outputTokens,
      inputCost,
      outputCost,
      stats.invocationType,
      stats.userId,
    ]);

    return result.rows[0];
  }

  async getCostAndTokensConsumed(days, userId) {
    const query = `SELECT
                    provider,
                    model,
                    SUM(input_tokens) AS totalinputtokens,
                    SUM(output_tokens) AS totaloutputtokens,
                    SUM(input_cost) AS totalinputcost,
                    SUM(output_cost) AS totaloutputcost
                  FROM llm_usage_logs
                  WHERE created_at >= NOW() - INTERVAL '${days} days'
                  AND user_id = $1
                  GROUP BY provider, model`;
    const result = await getPool().query(query, [userId]);
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

  async getConversationSessions(days, userId) {
    const query = `SELECT DATE(created_at) AS day, COUNT(DISTINCT conversation_id) AS totalsessions
                  FROM conversations
                  WHERE created_at >= NOW() - INTERVAL '${days} days'
                  AND user_id = $1
                  GROUP BY DATE(created_at)
                  ORDER BY DATE(created_at) ASC`;
    const result = await getPool().query(query, [userId]);
    return result.rows;
  }

  async getEmails(days, userId) {
    const query = `SELECT DATE(created_at) AS day, COUNT(*) AS count
                  FROM documents
                  WHERE source = 'gmail'
                  AND user_id = $1
                  AND created_at >= NOW() - INTERVAL '${days} days'
                  GROUP BY DATE(created_at)
                  ORDER BY DATE(created_at) ASC`;
    const result = await getPool().query(query, [userId]);
    return result.rows;
  }

  async getCalendarEvents(days, userId) {
    const query = `SELECT DATE(created_at) AS day, COUNT(*) AS count
                  FROM documents
                  WHERE source = 'calendar'
                  AND user_id = $1
                  AND created_at >= NOW() - INTERVAL '${days} days'
                  GROUP BY DATE(created_at)
                  ORDER BY DATE(created_at) ASC`;
    const result = await getPool().query(query, [userId]);
    return result.rows;
  }

  async getLLMCredsUsage() {
    const query = `SELECT
                    provider,
                    SUM(input_cost + output_cost) AS totalcost
                  FROM llm_usage_logs
                  WHERE created_at >= date_trunc('month', CURRENT_DATE)
                  GROUP BY provider`;
    const result = await getPool().query(query);
    return result.rows;
  }
}
