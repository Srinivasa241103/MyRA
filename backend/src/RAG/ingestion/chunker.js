import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters"

const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 2700,
    chunkOverlap: 400,
});

export async function chunkDocument(doc) {
    if (!doc.content) return [];

    const chunks = await splitter.splitText(doc.content);
    return chunks.map((chunk, index) => ({
        content: chunk,
        chunk_index: index,
        source_type: doc.source,
    }));

}
