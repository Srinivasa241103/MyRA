import assert from "node:assert/strict";
import "../src/config/env.js";
import { getPool } from "../src/config/dbConfig.js";
import { StatsRepository } from "../src/database/statsRepository.js";
import { LLM_INVOCATION_TYPES } from "../src/utils/constants.js";

const invocationTypes = [
  LLM_INVOCATION_TYPES.RAG_CHAT,
  LLM_INVOCATION_TYPES.EMBEDDING,
  LLM_INVOCATION_TYPES.QUERY_REWRITE,
  LLM_INVOCATION_TYPES.RERANK,
];

async function run(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  const repository = new StatsRepository();
  const testPrefix = `usage_test:${Date.now()}`;

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      "SELECT id FROM users ORDER BY id LIMIT 1",
    );
    assert.ok(userResult.rows[0]?.id, "A database user is required for this test");

    for (const invocationType of invocationTypes) {
      const row = await repository.insertLLMPrice(
        {
          conversationId: `${testPrefix}:${invocationType}`,
          provider: "OpenAI",
          model: "usage-test-model",
          inputTokens: 125,
          outputTokens: 25,
          inputCost: 0.01,
          outputCost: 0.02,
          invocationType,
          userId: userResult.rows[0].id,
        },
        client,
      );

      assert.equal(row.total_tokens, 150);
      assert.equal(Number(row.total_cost), 0.03);
    }

    const inserted = await client.query(
      `SELECT invocation_type,
              input_tokens,
              output_tokens,
              total_tokens,
              input_cost,
              output_cost,
              total_cost
         FROM llm_usage_logs
        WHERE conversation_id LIKE $1
        ORDER BY invocation_type`,
      [`${testPrefix}:%`],
    );

    assert.equal(inserted.rowCount, invocationTypes.length);
    assert.deepEqual(
      new Set(inserted.rows.map((row) => row.invocation_type)),
      new Set(invocationTypes),
    );

    for (const row of inserted.rows) {
      assert.equal(
        row.total_tokens,
        row.input_tokens + row.output_tokens,
        `${row.invocation_type} token total is incorrect`,
      );
      assert.equal(
        Number(row.total_cost),
        Number(row.input_cost) + Number(row.output_cost),
        `${row.invocation_type} INR cost total is incorrect`,
      );
    }

    console.log(
      `Validated ${inserted.rowCount} LLM usage categories with INR totals; transaction will be rolled back.`,
    );
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
