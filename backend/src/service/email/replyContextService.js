/**
 * Searches the Gmail vector store to find the original email
 * the user wants to reply to.
 *
 * Wraps your existing generateEmbedding and searchVectors functions.
 * Adjust import paths to match your actual pipeline locations.
 */
import { generateEmbedding } from "../data-pipeline/embedder.js";
import { searchVectors } from "../retrieval/vector-store.js";

const TOP_K = 3;

/**
 * Searches Gmail embeddings using the user's natural language reference phrase.
 *
 * @param {string} replyReference — e.g. "Raj's email about the deadline"
 * @returns {{ candidates: Array, confidence: number }}
 *
 * Each candidate: { messageId, threadId, from, subject, bodyPreview, timestamp, references, score }
 */
const findOriginalEmail = async (replyReference) => {
  try {
    const queryEmbedding = await generateEmbedding(replyReference);

    const results = await searchVectors({
      embedding: queryEmbedding,
      topK: TOP_K,
      filter: {
        source: "gmail",
        type: "email",
      },
    });

    if (!results || results.length === 0) {
      return { candidates: [], confidence: 0 };
    }

    const candidates = results.map((r) => ({
      messageId: r.metadata.messageId || r.id,
      threadId: r.metadata.threadId,
      from: r.metadata.from,
      subject: r.metadata.subject || r.metadata.title,
      bodyPreview:
        r.metadata.content_preview ||
        (r.pageContent && r.pageContent.slice(0, 300)),
      timestamp: r.metadata.timestamp || r.metadata.date,
      references: r.metadata.references || null,
      score: r.score,
    }));

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
