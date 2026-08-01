export function createSseParser({ onEvent, onMalformed } = {}) {
  let buffer = "";

  const parseBlock = (block) => {
    if (!block || block.startsWith(":")) return;

    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");

    if (!data) return;

    try {
      onEvent?.(JSON.parse(data));
    } catch (error) {
      onMalformed?.(error, data);
    }
  };

  const drain = (flush = false) => {
    // A CRLF can be split across network chunks. Keep a trailing CR until the
    // next chunk arrives so it cannot become a false blank event boundary.
    const heldCarriageReturn = !flush && buffer.endsWith("\r") ? "\r" : "";
    const source = heldCarriageReturn ? buffer.slice(0, -1) : buffer;
    const normalized = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const blocks = normalized.split("\n\n");
    const remainder = blocks.pop() ?? "";
    buffer = flush ? "" : remainder + heldCarriageReturn;
    for (const block of blocks) parseBlock(block);
    if (flush && remainder.trim()) parseBlock(remainder);
  };

  return {
    push(text) {
      buffer += text;
      drain(false);
    },
    finish(text = "") {
      buffer += text;
      drain(true);
    },
  };
}

export async function readSseJsonStream(readable, { onEvent } = {}) {
  if (!readable) {
    throw new Error("Streaming is not supported by this browser.");
  }

  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let result = null;
  let terminalError = null;
  let done = false;
  let malformed = null;
  const parser = createSseParser({
    onEvent: (event) => {
      onEvent?.(event);
      if (event.type === "result") result = event.data;
      if (event.type === "error") terminalError = event.data;
      if (event.type === "done") done = true;
    },
    onMalformed: (error) => {
      malformed = error;
    },
  });

  try {
    while (true) {
      const { value, done: readerDone } = await reader.read();
      if (readerDone) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.finish(decoder.decode());
  } finally {
    reader.releaseLock?.();
  }

  if (malformed) {
    throw new Error("The server returned an invalid streaming response.");
  }
  if (terminalError) {
    const error = new Error(terminalError.error || "Failed to process message");
    error.data = terminalError;
    throw error;
  }
  if (!done || !result) {
    throw new Error("The response stream ended before completion.");
  }

  return result;
}
