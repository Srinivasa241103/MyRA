import assert from "node:assert/strict";
import crypto from "node:crypto";
import { afterEach, test } from "node:test";
import jwt from "jsonwebtoken";
import { AuthController } from "../../src/api/controllers/authController.js";
import SyncController from "../../src/api/controllers/syncController.js";
import {
  getDevelopmentPrincipal,
  requireAuth,
} from "../../src/api/middleware/requireAuth.js";
import { SyncLogRepository } from "../../src/database/syncLogsRepository.js";
import ConversationRepository from "../../src/database/conversationsRepo.js";
import { CredentialRepository } from "../../src/database/credentialRepository.js";
import { AgentRunRepository } from "../../src/database/foundation/agentRunRepository.js";
import { ConnectorInstallationRepository } from "../../src/database/foundation/connectorInstallationRepository.js";
import { EvidenceRepository } from "../../src/database/foundation/evidenceRepository.js";
import {
  OAuthStateError,
  OAuthTransactionStore,
} from "../../src/service/oauth/oauthTransactionStore.js";
import { SocketServer } from "../../src/service/websocket/sockeService.js";

const MANAGED_ENV_KEYS = [
  "NODE_ENV",
  "JWT_SECRET",
  "ENABLE_AUTH_DEV_BYPASS",
  "SYNC_USER_ID",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "FRONTEND_URL",
] as const;

const originalEnvironment = Object.fromEntries(
  MANAGED_ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of MANAGED_ENV_KEYS) {
    const originalValue = originalEnvironment[key];
    if (originalValue === undefined) delete process.env[key];
    else process.env[key] = originalValue;
  }
});

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    redirectUrl: null as string | null,
    cookies: [] as Array<Record<string, unknown>>,
    clearedCookies: [] as Array<Record<string, unknown>>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    cookie(name: string, value: string, options: Record<string, unknown>) {
      this.cookies.push({ name, value, options });
      return this;
    },
    clearCookie(name: string, options: Record<string, unknown>) {
      this.clearedCookies.push({ name, options });
      return this;
    },
    redirect(url: string) {
      this.redirectUrl = url;
      return this;
    },
  };
}

test("JWT authentication derives identity only from the verified token", () => {
  process.env.JWT_SECRET = "fnd-04-test-secret";
  process.env.ENABLE_AUTH_DEV_BYPASS = "false";
  const token = jwt.sign({ userId: 101 }, process.env.JWT_SECRET, {
    algorithm: "HS256",
  });
  const request = {
    headers: { authorization: `Bearer ${token}` },
    body: { userId: 202 },
    query: { userId: "202" },
  } as any;
  const response = responseRecorder();
  let nextCalled = false;

  requireAuth(request, response as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.deepEqual(request.user, { userId: 101, authType: "jwt" });
});

test("missing and malformed credentials fail without disclosing resource state", () => {
  process.env.JWT_SECRET = "fnd-04-test-secret";
  process.env.ENABLE_AUTH_DEV_BYPASS = "false";

  for (const authorization of [undefined, "Basic abc", "Bearer invalid-token"]) {
    const response = responseRecorder();
    let nextCalled = false;
    requireAuth(
      { headers: { authorization } } as any,
      response as any,
      () => { nextCalled = true; },
    );
    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.body, {
      success: false,
      error: "Authentication required.",
    });
  }
});

test("development bypass is opt-in and can never run in production", () => {
  process.env.SYNC_USER_ID = "303";
  process.env.ENABLE_AUTH_DEV_BYPASS = "false";
  process.env.NODE_ENV = "development";
  assert.equal(getDevelopmentPrincipal(), null);

  process.env.ENABLE_AUTH_DEV_BYPASS = "true";
  assert.deepEqual(getDevelopmentPrincipal(), {
    userId: 303,
    authType: "development_bypass",
  });

  process.env.NODE_ENV = "production";
  assert.equal(getDevelopmentPrincipal(), null);
});

test("OAuth transactions bind state to the browser, use S256 PKCE, and reject replay", () => {
  let now = Date.parse("2026-08-03T10:00:00.000Z");
  const store = new OAuthTransactionStore({ ttlMs: 60_000, now: () => now });
  const transaction = store.begin();
  const expectedChallenge = crypto
    .createHash("sha256")
    .update(transaction.codeVerifier)
    .digest("base64url");
  assert.equal(transaction.codeChallenge, expectedChallenge);

  assert.deepEqual(store.consume(transaction.state, transaction.browserBinding), {
    codeVerifier: transaction.codeVerifier,
  });
  assert.throws(
    () => store.consume(transaction.state, transaction.browserBinding),
    OAuthStateError,
  );

  const expired = store.begin();
  now += 60_001;
  assert.throws(
    () => store.consume(expired.state, expired.browserBinding),
    OAuthStateError,
  );
});

test("Google login emits a browser-bound state and PKCE challenge", async () => {
  process.env.GOOGLE_CLIENT_ID = "fixture-client-id";
  process.env.GOOGLE_CLIENT_SECRET = "fixture-client-secret";
  process.env.GOOGLE_REDIRECT_URI = "http://localhost:2020/auth/google/callback";
  const store = new OAuthTransactionStore();
  const controller = new AuthController({
    oauthService: {} as any,
    oauthTransactions: store,
    userRepo: {} as any,
    credentialRepo: {} as any,
  });
  const response = responseRecorder();

  await controller.initiateGoogleLogin({} as any, response as any, (error: Error) => {
    throw error;
  });

  const authUrl = new URL((response.body as any).data.authUrl);
  assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authUrl.searchParams.get("code_challenge"));
  assert.ok(authUrl.searchParams.get("state"));
  assert.equal(response.cookies[0].name, "myra_oauth_binding");
  assert.equal((response.cookies[0].options as any).httpOnly, true);
  assert.equal((response.cookies[0].options as any).sameSite, "lax");
});

test("OAuth callback rejects invalid state before any provider exchange", async () => {
  process.env.FRONTEND_URL = "http://localhost:5173";
  const controller = new AuthController({
    oauthService: {} as any,
    oauthTransactions: new OAuthTransactionStore(),
    userRepo: {} as any,
    credentialRepo: {} as any,
  });
  const response = responseRecorder();

  await controller.handleGoogleCallback(
    {
      query: { state: "not-issued", code: "provider-code" },
      headers: { cookie: "myra_oauth_binding=not-issued" },
    } as any,
    response as any,
    () => undefined,
  );

  assert.equal(
    response.redirectUrl,
    "http://localhost:5173/login?error=invalid_oauth_state",
  );
});

test("sync controller ignores caller-supplied ownership", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const syncLogRepo = {
    async create(source: string, userId: number) {
      calls.push({ operation: "create", source, userId });
      return { id: 77 };
    },
    async findBySource(source: string, userId: number, limit: number) {
      calls.push({ operation: "history", source, userId, limit });
      return [];
    },
    async findById(syncId: number, userId: number) {
      calls.push({ operation: "status", syncId, userId });
      return null;
    },
  };
  const controller = new SyncController({
    syncLogRepo: syncLogRepo as any,
    embeddingPipeline: {} as any,
    ingestionPipeline: {} as any,
  });
  controller.performDocumentsSync = async () => undefined;

  const startResponse = responseRecorder();
  await controller.syncGmail(
    {
      user: { userId: 101 },
      body: { userId: 202, syncType: "incremental" },
    } as any,
    startResponse as any,
  );
  const historyResponse = responseRecorder();
  await controller.getSyncHistory(
    {
      user: { userId: 101 },
      query: { userId: "202", source: "gmail", limit: "10" },
    } as any,
    historyResponse as any,
  );
  const statusResponse = responseRecorder();
  await controller.getSyncStatus(
    {
      user: { userId: 101 },
      params: { syncId: "owned-by-user-202" },
    } as any,
    statusResponse as any,
  );

  assert.equal((calls[0] as any).userId, 101);
  assert.equal((calls[1] as any).userId, 101);
  assert.equal((calls[2] as any).userId, 101);
  assert.equal(startResponse.statusCode, 200);
  assert.equal(historyResponse.statusCode, 200);
  assert.equal(statusResponse.statusCode, 404);
  assert.deepEqual(statusResponse.body, {
    success: false,
    error: "Sync operation not found",
  });
});

test("sync repository scopes status reads and writes by user", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const db = {
    async query(text: string, values: readonly unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 };
    },
  };
  const repository = new SyncLogRepository(db as any);

  assert.equal(await repository.findById(77, 101), null);
  assert.match(calls[0].text, /WHERE id = \$1 AND user_id = \$2/);
  assert.deepEqual(calls[0].values, [77, 101]);

  await assert.rejects(
    repository.complete(77, 202, { status: "success" }),
    /not found/,
  );
  assert.match(calls[1].text, /WHERE id = \$6 AND user_id = \$7/);
  assert.equal(calls[1].values.at(-1), 202);
});

test("sync socket events target only the authenticated user's room", () => {
  const emissions: Array<Record<string, unknown>> = [];
  const socketServer = new SocketServer();
  socketServer.io = {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emissions.push({ room, event, payload });
        },
      };
    },
  } as any;

  socketServer.emitSyncProgress(101, "gmail", {
    syncId: 77,
    status: "in_progress",
  });

  assert.equal(emissions.length, 1);
  assert.equal(emissions[0].room, "user:101");
  assert.equal(emissions[0].event, "sync:gmail:progress");
});

test("socket identity comes from JWT and never from handshake query data", () => {
  process.env.JWT_SECRET = "fnd-04-test-secret";
  process.env.ENABLE_AUTH_DEV_BYPASS = "false";
  const socketServer = new SocketServer();
  let authenticationMiddleware: ((socket: any, next: (error?: Error) => void) => void) | null = null;
  socketServer.io = {
    use(middleware: typeof authenticationMiddleware) {
      authenticationMiddleware = middleware;
    },
  } as any;
  socketServer.setupAuthentication();
  assert.ok(authenticationMiddleware);

  const unauthenticatedSocket = {
    handshake: {
      auth: {},
      headers: {},
      query: { userId: "101" },
    },
    data: {},
  };
  let authenticationError: Error | undefined;
  authenticationMiddleware(unauthenticatedSocket, (error?: Error) => {
    authenticationError = error;
  });
  assert.equal(authenticationError?.message, "Authentication required");
  assert.deepEqual(unauthenticatedSocket.data, {});

  const token = jwt.sign({ userId: 202 }, process.env.JWT_SECRET, {
    algorithm: "HS256",
  });
  const authenticatedSocket = {
    handshake: {
      auth: { token },
      headers: {},
      query: { userId: "101" },
    },
    data: {},
  };
  authenticationError = undefined;
  authenticationMiddleware(authenticatedSocket, (error?: Error) => {
    authenticationError = error;
  });
  assert.equal(authenticationError, undefined);
  assert.deepEqual(authenticatedSocket.data, {
    user: { userId: 202, authType: "jwt" },
  });
});

test("conversation, credential, run, evidence, and connector queries carry user scope", async () => {
  const calls: Array<{ text: string; values: readonly unknown[] }> = [];
  const db = {
    async query(text: string, values: readonly unknown[] = []) {
      calls.push({ text, values });
      return { rows: [], rowCount: 0 };
    },
  };

  const conversations = new ConversationRepository(db as any);
  await conversations.getConversationHistory("conversation-b", 101, 20);
  await conversations.clear("conversation-b", 101);

  const credentials = new CredentialRepository(db as any);
  await credentials.findByUserAndSource(101, "gmail");
  await credentials.delete(101, "credential-b");

  const runs = new AgentRunRepository(db as any);
  const evidence = new EvidenceRepository(db as any);
  const connectors = new ConnectorInstallationRepository(db as any);
  await runs.findById(101, "run-b");
  await evidence.findById(101, "evidence-b");
  await connectors.findByConnector(101, "gmail");

  assert.match(calls[0].text, /conversation_id = \$1 AND user_id = \$2/);
  assert.deepEqual(calls[0].values, ["conversation-b", 101, 20]);
  assert.match(calls[1].text, /user_id = \$1 AND conversation_id = \$2/);
  assert.deepEqual(calls[1].values, [101, "conversation-b"]);
  assert.match(calls[2].text, /user_id = \$1 AND source = \$2/);
  assert.deepEqual(calls[2].values, [101, "gmail"]);
  assert.match(calls[3].text, /user_id = \$1 AND id = \$2/);
  assert.deepEqual(calls[3].values, [101, "credential-b"]);
  assert.deepEqual(calls[4].values, ["run-b", 101]);
  assert.deepEqual(calls[5].values, ["evidence-b", 101]);
  assert.deepEqual(calls[6].values, [101, "gmail"]);
  for (const call of calls) {
    assert.match(call.text, /user_id/);
  }
});

test("all currently implemented protected route families install required auth", async () => {
  const [
    { default: chatRouter },
    { default: syncRouter },
    { default: statsRouter },
    { default: budgetsRouter },
    { default: authRouter },
  ] = await Promise.all([
    import("../../src/api/routes/chat.js"),
    import("../../src/api/routes/syncRoutes.js"),
    import("../../src/api/routes/stats.js"),
    import("../../src/api/routes/apiBudgets.js"),
    import("../../src/api/routes/authRoutes.js"),
  ]);

  const hasGlobalAuth = (router: any) => router.stack.some(
    (layer: any) => !layer.route && layer.handle === requireAuth,
  );
  const routeHasAuth = (router: any, path: string) => {
    const layer = router.stack.find((candidate: any) => candidate.route?.path === path);
    return Boolean(layer?.route?.stack.some(
      (routeLayer: any) => routeLayer.handle === requireAuth,
    ));
  };

  assert.equal(hasGlobalAuth(chatRouter), true);
  assert.equal(hasGlobalAuth(syncRouter), true);
  assert.equal(routeHasAuth(statsRouter, "/all"), true);
  assert.equal(routeHasAuth(budgetsRouter, "/"), true);
  assert.equal(routeHasAuth(authRouter, "/me"), true);
  assert.equal(routeHasAuth(authRouter, "/user/name"), true);
  assert.equal(routeHasAuth(authRouter, "/logout"), true);
});
