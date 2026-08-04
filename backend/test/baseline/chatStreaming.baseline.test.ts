/**
 * FND-06 — SSE transport and chat streaming baseline.
 *
 * The frontend renders from this event stream, and AGT-07 will add a versioned
 * agent stream beside it. What must not drift underneath either:
 *   1. The SSE frame format — `data: {json}\n\n`, one JSON object per frame,
 *      every frame stamped with the queryId and conversationId.
 *   2. The event vocabulary and order: start → status → context → delta* →
 *      result → done, with error → done on the failure path.
 *   3. Ownership: the conversation is checked against the *authenticated* user,
 *      and a deleted conversation is refused before a single byte is streamed.
 *   4. A client disconnect ends as `stopped`, not as an error, and an
 *      interrupted answer is persisted rather than lost.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { ChatController } from "../../src/api/controllers/chatController.js";
import { createSseWriter } from "../../src/utils/sseWriter.js";

import {
  CONVERSATION_ID,
  FakeRequest,
  FakeResponse,
  OWNER_USER_ID,
} from "../fixtures/fnd06-baseline-fixtures.js";

/* -------------------------------------------------------------------------- */
/* doubles                                                                     */
/* -------------------------------------------------------------------------- */

class StubConversationRepository {
  readonly statusCalls: Array<{ conversationId: string; userId: number }> = [];
  readonly saves: Array<Record<string, unknown>> = [];

  constructor(
    private readonly status = { exists: true, active: true, totalCount: 1, activeCount: 1 },
  ) {}

  async getConversationStatus(conversationId: string, userId: number) {
    this.statusCalls.push({ conversationId, userId });
    return this.status;
  }

  async saveChatConversation(row: Record<string, unknown>) {
    this.saves.push(row);
  }
}

interface StubChatOptions {
  tokens?: string[];
  documents?: Array<Record<string, unknown>>;
  statuses?: Array<{ stage: string; detail?: string | null; cancellable?: boolean }>;
  failure?: Error;
  /** Thrown rather than returned, the way an aborted LLM stream surfaces. */
  throws?: Error;
  /** Awaited mid-turn so a test can disconnect while the stream is open. */
  gate?: Promise<void>;
  stopped?: boolean;
  clarificationRequired?: boolean;
}

class StubRagChain {
  readonly calls: Array<{ userId: number; conversationId: string; userMessage: string }> = [];

  constructor(private readonly options: StubChatOptions = {}) {}

  async chat({
    userMessage,
    conversationId,
    userId,
    llmProvider,
    model,
    stream,
  }: {
    userMessage: string;
    conversationId: string;
    userId: number;
    llmProvider: string;
    model: string | null;
    stream?: {
      signal?: AbortSignal;
      onStatus?: (status: { stage: string; detail?: string | null; cancellable?: boolean }) => void;
      onContext?: (documents: Array<Record<string, unknown>>) => void;
      onToken?: (text: string) => void;
    };
  }) {
    this.calls.push({ userId, conversationId, userMessage });

    const {
      tokens = ["Anand ", "shared the roadmap."],
      documents = [
        {
          content: "Please send roadmap review comments by Friday.",
          source: 1,
          type: "gmail",
          metadata: { sender_email: "anand@example.com" },
        },
      ],
      statuses = [{ stage: "collecting_data" }, { stage: "generating", cancellable: true }],
      failure,
      throws,
      gate,
      stopped = false,
      clarificationRequired = false,
    } = this.options;

    for (const status of statuses) stream?.onStatus?.(status);
    stream?.onContext?.(documents);

    for (const token of tokens) {
      if (stream?.signal?.aborted) break;
      stream?.onToken?.(token);
    }

    if (gate) await gate;
    if (throws) throw throws;

    if (failure) {
      return {
        success: false,
        error: failure.message,
        partialResponse: (failure as Error & { partialAnswer?: string }).partialAnswer ?? null,
        conversationId,
      };
    }

    return {
      success: true,
      conversationId,
      response: tokens.join(""),
      provider: llmProvider,
      model,
      duration: 12,
      clarificationRequired,
      stopped,
      sourcedDocuments: documents,
    };
  }
}

function buildController(options: {
  chat?: StubChatOptions;
  status?: { exists: boolean; active: boolean; totalCount: number; activeCount: number };
} = {}) {
  const conversationRepo = new StubConversationRepository(options.status);
  const ragChainService = new StubRagChain(options.chat);
  const controller = new ChatController({
    conversationRepo: conversationRepo as never,
    ragChainService: ragChainService as never,
  });

  return { controller, conversationRepo, ragChainService };
}

/* -------------------------------------------------------------------------- */
/* SSE wire format                                                             */
/* -------------------------------------------------------------------------- */

/** sseWriter is untyped JS; this keeps the frame payload explicit at the call site. */
function send(
  writer: ReturnType<typeof createSseWriter>,
  type: string,
  payload: { queryId?: string; conversationId?: string; data?: unknown },
): boolean {
  return (writer.send as (type: string, payload: unknown) => boolean)(type, payload);
}

test("the SSE writer emits one JSON frame per event with streaming headers", () => {
  const res = new FakeResponse();
  const writer = createSseWriter(res as never, { heartbeatMs: 60_000 });

  send(writer, "start", {
    queryId: "q1",
    conversationId: CONVERSATION_ID,
    data: { query: "hi" },
  });
  writer.end();

  assert.equal(res.headers["Content-Type"], "text/event-stream; charset=utf-8");
  assert.equal(res.headers["Cache-Control"], "no-cache, no-transform");
  assert.equal(res.headers["X-Accel-Buffering"], "no");
  assert.ok(res.headersFlushed);

  assert.equal(res.chunks.length, 1);
  assert.ok(res.chunks[0]?.startsWith("data: "));
  assert.ok(res.chunks[0]?.endsWith("\n\n"));
  assert.deepEqual(res.frames[0], {
    type: "start",
    queryId: "q1",
    conversationId: CONVERSATION_ID,
    data: { query: "hi" },
  });
  assert.ok(res.writableEnded);
});

test("the SSE writer stops writing after the response closes", () => {
  const res = new FakeResponse();
  const writer = createSseWriter(res as never, { heartbeatMs: 60_000 });

  res.emit("close");
  const wrote = send(writer, "delta", { queryId: "q1", data: { text: "x" } });

  assert.equal(wrote, false);
  assert.equal(writer.closed, true);
  assert.equal(res.chunks.length, 0);
});

/* -------------------------------------------------------------------------- */
/* streamed chat                                                               */
/* -------------------------------------------------------------------------- */

test("a streamed chat emits the frozen event sequence", async () => {
  const { controller, ragChainService } = buildController();
  const req = new FakeRequest({
    body: { message: "roadmap review", conversationId: CONVERSATION_ID },
  });
  const res = new FakeResponse();

  await controller.sendMessageStream(req as never, res as never);

  assert.deepEqual(res.frameTypes, [
    "start",
    "status",
    "status",
    "status",
    "context",
    "delta",
    "delta",
    "result",
    "done",
  ]);

  const frames = res.frames;
  assert.equal(frames[1]?.data && (frames[1].data as { stage: string }).stage, "routing");
  assert.deepEqual(
    frames
      .filter((frame) => frame.type === "status")
      .map((frame) => (frame.data as { stage: string }).stage),
    ["routing", "collecting_data", "generating"],
  );
  assert.ok(
    frames.every((frame) => frame.conversationId === CONVERSATION_ID),
    "every frame must name its conversation",
  );
  const queryIds = new Set(frames.map((frame) => frame.queryId));
  assert.equal(queryIds.size, 1, "every frame in a turn shares one queryId");

  assert.deepEqual(
    frames
      .filter((frame) => frame.type === "delta")
      .map((frame) => (frame.data as { text: string }).text),
    ["Anand ", "shared the roadmap."],
  );

  assert.equal(ragChainService.calls[0]?.userId, OWNER_USER_ID);
  assert.equal(ragChainService.calls[0]?.conversationId, CONVERSATION_ID);
  assert.ok(res.writableEnded);
});

test("the result frame carries the answer, sources, and turn metadata", async () => {
  const { controller } = buildController();
  const req = new FakeRequest({
    body: { message: "roadmap review", conversationId: CONVERSATION_ID },
  });
  const res = new FakeResponse();

  await controller.sendMessageStream(req as never, res as never);

  const result = res.frames.find((frame) => frame.type === "result")?.data as {
    success: boolean;
    mode: string;
    response: string;
    context: { totalDocuments: number; selectedDocuments: number };
    metadata: { provider: string; clarificationRequired: boolean; streamStatus: string };
  };

  assert.equal(result.success, true);
  assert.equal(result.mode, "rag");
  assert.equal(result.response, "Anand shared the roadmap.");
  assert.equal(result.context.totalDocuments, 1);
  assert.equal(result.context.selectedDocuments, 1);
  assert.equal(result.metadata.clarificationRequired, false);
  assert.equal(result.metadata.streamStatus, "complete");
  assert.equal(result.metadata.provider, "OpenAI");

  const done = res.frames.at(-1);
  assert.equal(done?.type, "done");
  assert.deepEqual(done?.data, { stopped: false });
});

test("a stopped turn ends with stopped: true", async () => {
  const { controller } = buildController({ chat: { stopped: true } });
  const req = new FakeRequest({ body: { message: "roadmap", conversationId: CONVERSATION_ID } });
  const res = new FakeResponse();

  await controller.sendMessageStream(req as never, res as never);

  assert.deepEqual(res.frames.at(-1)?.data, { stopped: true });
  const result = res.frames.find((frame) => frame.type === "result")?.data as {
    metadata: { streamStatus: string };
  };
  assert.equal(result.metadata.streamStatus, "stopped");
});

/* -------------------------------------------------------------------------- */
/* ownership                                                                   */
/* -------------------------------------------------------------------------- */

test("streaming checks the conversation against the authenticated user", async () => {
  const { controller, conversationRepo } = buildController();
  const req = new FakeRequest({
    body: { message: "roadmap", conversationId: CONVERSATION_ID, userId: 999 },
  });
  const res = new FakeResponse();

  await controller.sendMessageStream(req as never, res as never);

  assert.deepEqual(conversationRepo.statusCalls, [
    { conversationId: CONVERSATION_ID, userId: OWNER_USER_ID },
  ]);
});

test("a deleted conversation is refused before the stream opens", async () => {
  const { controller } = buildController({
    status: { exists: true, active: false, totalCount: 2, activeCount: 0 },
  });
  const req = new FakeRequest({ body: { message: "roadmap", conversationId: CONVERSATION_ID } });
  const res = new FakeResponse();

  await controller.sendMessageStream(req as never, res as never);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.jsonBody, { success: false, error: "Chat does not exist" });
  assert.equal(res.chunks.length, 0, "bytes were streamed for a deleted conversation");
});

test("a conversation id the client allocated but never saved is accepted", async () => {
  const { controller } = buildController({
    status: { exists: false, active: false, totalCount: 0, activeCount: 0 },
  });
  const req = new FakeRequest({ body: { message: "roadmap", conversationId: CONVERSATION_ID } });
  const res = new FakeResponse();

  await controller.sendMessageStream(req as never, res as never);

  assert.equal(res.frameTypes.at(-1), "done");
});

test("an empty message is rejected before any work starts", async () => {
  const { controller, ragChainService } = buildController();
  const req = new FakeRequest({ body: { message: "   " } });
  const res = new FakeResponse();

  await controller.sendMessageStream(req as never, res as never);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.jsonBody, { success: false, error: "Message is required" });
  assert.equal(ragChainService.calls.length, 0);
});

/* -------------------------------------------------------------------------- */
/* failure paths                                                               */
/* -------------------------------------------------------------------------- */

test("a failed turn emits error then done and never a result", async () => {
  const { controller } = buildController({
    chat: { failure: new Error("provider exploded"), tokens: [] },
  });
  const req = new FakeRequest({ body: { message: "roadmap", conversationId: CONVERSATION_ID } });
  const res = new FakeResponse();

  await controller.sendMessageStream(req as never, res as never);

  assert.deepEqual(res.frameTypes, ["start", "status", "status", "status", "context", "error", "done"]);
  const error = res.frames.find((frame) => frame.type === "error")?.data as {
    error: string;
    mode: string;
    stopped: boolean;
  };
  assert.equal(error.error, "Failed to process message");
  assert.equal(error.mode, "rag");
  assert.equal(error.stopped, false);
  assert.ok(res.writableEnded);
});

test("an interrupted answer is persisted instead of being lost", async () => {
  const failure = Object.assign(new Error("provider exploded"), {
    partialAnswer: "Anand sha",
  });
  const { controller, conversationRepo } = buildController({
    chat: { failure, tokens: [] },
  });
  const req = new FakeRequest({ body: { message: "roadmap", conversationId: CONVERSATION_ID } });
  const res = new FakeResponse();

  await controller.sendMessageStream(req as never, res as never);

  const [save] = conversationRepo.saves;
  assert.ok(save, "the partial answer was dropped");
  assert.equal(save.userId, OWNER_USER_ID);
  assert.equal(save.conversation_id, CONVERSATION_ID);
  assert.equal(save.assistant_message, "Anand sha");
  assert.deepEqual(save.metadata, { mode: "rag", streamStatus: "interrupted" });
});

test("a client disconnect mid-turn stops silently instead of writing to a dead socket", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { controller, conversationRepo } = buildController({
    chat: { failure: new Error("aborted"), tokens: [], gate },
  });
  const req = new FakeRequest({ body: { message: "roadmap", conversationId: CONVERSATION_ID } });
  const res = new FakeResponse();

  // The abort listener is registered inside sendMessageStream, so the
  // disconnect has to be raised after the stream is already open.
  const streaming = controller.sendMessageStream(req as never, res as never);
  await new Promise((resolve) => setImmediate(resolve));
  req.emit("aborted");
  release();
  await streaming;

  assert.ok(
    !res.frameTypes.includes("error"),
    "an error frame was written after the client disconnected",
  );
  assert.ok(!res.frameTypes.includes("done"));
  assert.equal(conversationRepo.saves.length, 0, "a disconnect must not persist a turn");
});

test("an aborted generation reports the turn as stopped", async () => {
  const abortError = Object.assign(new Error("The operation was aborted"), {
    name: "AbortError",
  });
  const { controller } = buildController({ chat: { throws: abortError, tokens: [] } });
  const req = new FakeRequest({ body: { message: "roadmap", conversationId: CONVERSATION_ID } });
  const res = new FakeResponse();

  await controller.sendMessageStream(req as never, res as never);

  const error = res.frames.find((frame) => frame.type === "error")?.data as {
    error: string;
    stopped: boolean;
  };
  assert.equal(error.error, "Response stopped.");
  assert.equal(error.stopped, true);
  assert.deepEqual(res.frames.at(-1)?.data, { stopped: true });
});

/* -------------------------------------------------------------------------- */
/* non-streaming chat                                                          */
/* -------------------------------------------------------------------------- */

test("the non-streaming reply shape matches the streamed result frame", async () => {
  const { controller } = buildController();
  const req = new FakeRequest({
    body: { message: "roadmap review", conversationId: CONVERSATION_ID },
  });
  const res = new FakeResponse();

  await controller.sendMessage(req as never, res as never);

  const body = res.jsonBody as {
    success: boolean;
    mode: string;
    conversationId: string;
    response: string;
    context: { totalDocuments: number };
    metadata: { streamStatus: string };
  };

  assert.equal(body.success, true);
  assert.equal(body.mode, "rag");
  assert.equal(body.conversationId, CONVERSATION_ID);
  assert.equal(body.response, "Anand shared the roadmap.");
  assert.equal(body.context.totalDocuments, 1);
  assert.equal(body.metadata.streamStatus, "complete");
});
