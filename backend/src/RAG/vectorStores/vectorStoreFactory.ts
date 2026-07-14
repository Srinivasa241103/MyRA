import { logger } from "../../utils/logger.js";
import ChromaVectorStore from "./chromaVectorStore.js";
import PgVectorStore from "./pgVectorStore.js";
import type VectorStore from "./vectorStore.js";

export type VectorStoreProvider = "pgvector" | "chroma";

let vectorStore: VectorStore | null = null;

export function resolveVectorStoreProvider(
  rawProvider = process.env.VECTOR_STORE,
): VectorStoreProvider {
  const provider = (rawProvider || "pgvector").trim().toLowerCase();

  if (provider === "pgvector" || provider === "postgres" || provider === "postgresql") {
    return "pgvector";
  }

  if (provider === "chroma" || provider === "chromadb") {
    return "chroma";
  }

  throw new Error(
    `Unsupported VECTOR_STORE "${rawProvider}". Expected "pgvector" or "chroma".`,
  );
}

export function createVectorStore(
  provider: VectorStoreProvider = resolveVectorStoreProvider(),
): VectorStore {
  switch (provider) {
    case "pgvector":
      return new PgVectorStore();
    case "chroma":
      return new ChromaVectorStore();
    default: {
      const unreachableProvider: never = provider;
      throw new Error(`Unsupported vector store provider: ${unreachableProvider}`);
    }
  }
}

export function getVectorStore(): VectorStore {
  if (!vectorStore) {
    const provider = resolveVectorStoreProvider();
    vectorStore = createVectorStore(provider);
    logger.info("Vector store initialized", { provider });
  }

  return vectorStore;
}

export function resetVectorStoreForTests(): void {
  vectorStore = null;
}
