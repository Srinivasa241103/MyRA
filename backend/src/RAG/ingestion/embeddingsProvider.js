import { OpenAIEmbeddings } from "@langchain/openai";

export default class Embedding {
    constructor() {
        this.embeddings = new OpenAIEmbeddings({
            model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
            apiKey: process.env.OPENAI_API_KEY,
            dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || "1536"),
        });
    }
    async embedChunks(chunks) {
        if (!chunks?.length) return [];
        //embed each chunk and store them in the same chunk
        const contents = chunks.map((chunk) => (chunk.content));
        const vectors = await this.embeddings.embedDocuments(contents);

        return chunks.map((chunk, i) => ({
            ...chunk,
            embedding: vectors[i],
        }));
    }

    async embedQuery(query) {
        if (!query || typeof query !== "string") {
            throw new Error("embedQuery requires a non-empty string");
        }

        return await this.embeddings.embedQuery(query);
    }
}

