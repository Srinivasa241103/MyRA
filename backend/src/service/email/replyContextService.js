/**
 * Searches the user's Gmail chunks to find the original email
 * they want to reply to.
 */
import Retriever from "../../RAG/retrieval/retriever.js";

const TOP_K = 3;
const retriever = new Retriever();

/**
 * Searches the user's Gmail embeddings using their natural language reference phrase.
 *
 * @param {string} replyReference — e.g. "Raj's email about the deadline"
 * @param {number} userId — owning user, scopes the search to their own emails
 * @returns {{ candidates: Array, confidence: number }}
 *
 * Each candidate: { messageId, threadId, from, subject, bodyPreview, timestamp, references, score }
 */
const findOriginalEmail = async (replyReference, userId) => {
  try {
    const chunks = await retriever.retrieve(replyReference, userId, { sourceType: "gmail", topK: TOP_K });

    if (!chunks || chunks.length === 0) {
      return { candidates: [], confidence: 0 };
    }

    const candidates = chunks.map((chunk) => {
      const gmailMeta = chunk.document?.metadata?.gmail || {};
      return {
        messageId: gmailMeta.messageId || chunk.document?.source_id,
        threadId: gmailMeta.threadId,
        from: gmailMeta.from || chunk.document?.author,
        subject: gmailMeta.subject,
        bodyPreview: chunk.content?.slice(0, 300),
        timestamp: gmailMeta.date || chunk.occurred_at,
        references: gmailMeta.references || null,
        score: 1 - chunk.distance,
      };
    });

    return {
      candidates,
      confidence: candidates[0]?.score || 0,
    };
  } catch (err) {
    console.error(
      "[replyContextService.findOriginalEmail] Error:",
      err.message,
    );
    throw err;
  }
};

export const replyContextService = { findOriginalEmail };
