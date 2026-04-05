import { BaseCheckpointSaver } from "@langchain/langgraph";
import { pool } from "../../../config/dbConfig.js";

export class PostgresCheckpointer extends BaseCheckpointSaver {
  async get(config) {
    const threadId = config.configurable?.thread_id;
    const result = await pool.query(
      "SELECT state FROM agent_checkpoints WHERE thread_id = $1",
      [threadId]
    );
    return result.rows[0]?.state || null;
  }

  async put(config, checkpoint) {
    const threadId = config.configurable?.thread_id;
    await pool.query(
      `INSERT INTO agent_checkpoints (thread_id, state, updated_at) 
         VALUES ($1, $2, NOW())
         ON CONFLICT (thread_id) DO UPDATE SET state = $2, updated_at = NOW()`,
      [threadId, JSON.stringify(checkpoint)]
    );
    return config;
  }
}

// CREATE TABLE agent_checkpoints (
//   thread_id VARCHAR(255) PRIMARY KEY,
//   state JSONB NOT NULL,
//   updated_at TIMESTAMP DEFAULT NOW()
// );
