import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { AIMessageChunk } from "@langchain/core/messages";
import LLMService from "../src/RAG/query/llmService.js";
import { createSseWriter } from "../src/utils/sseWriter.js";

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headers = new Map<string, string>();
  output = "";
  destroyed = false;
  writableEnded = false;

  status(code: number) {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value);
  }

  flushHeaders() {}
  flush() {}

  write(value: string) {
    this.output += value;
    return true;
  }

  end() {
    this.writableEnded = true;
    this.emit("finish");
  }
}

async function testCompletedStream(): Promise<void> {
  const usageCalls: Array<Record<string, unknown>> = [];
  const received: string[] = [];
  const service = new LLMService({
    modelFactory: () => ({
      stream: async () => (async function* () {
        yield new AIMessageChunk({ content: "Hello" });
        yield new AIMessageChunk({ content: " from MyRA" });
        yield new AIMessageChunk({
          content: "",
          usage_metadata: {
            input_tokens: 20,
            output_tokens: 4,
            total_tokens: 24,
          },
        });
      })(),
    }),
    usageLogger: async (usage: Record<string, unknown>) => {
      usageCalls.push(usage);
    },
  });

  const result = await service.generateResponseStream(
    "OpenAI",
    [{ role: "user", content: "Say hello" }],
    3,
    "stream-test",
    {
      model: "gpt-4.1-nano",
      onToken: (text: string) => received.push(text),
    },
  );

  assert.equal(result.answer, "Hello from MyRA");
  assert.equal(result.stopped, false);
  assert.deepEqual(received, ["Hello", " from MyRA"]);
  assert.equal(usageCalls.length, 1);
  const usage = (usageCalls[0].usageData as AIMessageChunk).usage_metadata;
  assert.equal(usage?.input_tokens, 20);
  assert.equal(usage?.output_tokens, 4);
  assert.equal(usage?.total_tokens, 24);
}

async function testStoppedStream(): Promise<void> {
  const controller = new AbortController();
  const usageCalls: Array<Record<string, unknown>> = [];
  const service = new LLMService({
    modelFactory: () => ({
      stream: async (_messages: unknown, options: { signal?: AbortSignal }) =>
        (async function* () {
          yield new AIMessageChunk({ content: "Partial answer" });
          if (options.signal?.aborted) {
            const error = new Error("Stopped");
            error.name = "AbortError";
            throw error;
          }
        })(),
    }),
    usageLogger: async (usage: Record<string, unknown>) => {
      usageCalls.push(usage);
    },
  });

  const result = await service.generateResponseStream(
    "Anthropic",
    [{ role: "user", content: "A long answer" }],
    3,
    "stream-stop-test",
    {
      model: "claude-haiku-4-5",
      signal: controller.signal,
      onToken: () => controller.abort(),
    },
  );

  assert.equal(result.answer, "Partial answer");
  assert.equal(result.stopped, true);
  assert.equal(usageCalls.length, 1);
  assert.ok(Number(usageCalls[0].estimatedInputTokens) > 0);
  assert.ok(Number(usageCalls[0].estimatedOutputTokens) > 0);
}

function testSseWriter(): void {
  const response = new FakeResponse();
  const writer = createSseWriter(response, { heartbeatMs: 60_000 });
  writer.send("status", {
    queryId: "query-1",
    conversationId: "conversation-1",
    data: { stage: "thinking", flow: "general", cancellable: false },
  });
  writer.end();

  assert.equal(response.statusCode, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
  assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.match(response.output, /"type":"status"/);
  assert.match(response.output, /"stage":"thinking"/);
  assert.equal(response.writableEnded, true);
  assert.equal(writer.closed, true);
}

function testSseDisconnect(): void {
  const response = new FakeResponse();
  const writer = createSseWriter(response, { heartbeatMs: 60_000 });
  response.emit("close");

  assert.equal(writer.closed, true);
  assert.equal(writer.send("delta", { data: { text: "too late" } }), false);
  assert.equal(response.output, "");
}

await testCompletedStream();
await testStoppedStream();
testSseWriter();
testSseDisconnect();
console.log("Chat streaming tests passed.");
