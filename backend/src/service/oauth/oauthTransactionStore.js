import crypto from "node:crypto";

const DEFAULT_TTL_MS = 10 * 60 * 1000;

export class OAuthStateError extends Error {
  constructor() {
    super("OAuth transaction is invalid or expired");
    this.name = "OAuthStateError";
  }
}

function hashBinding(value) {
  return crypto.createHash("sha256").update(value).digest();
}

function bindingsMatch(expectedHash, browserBinding) {
  if (typeof browserBinding !== "string" || browserBinding.length === 0) {
    return false;
  }

  const actualHash = hashBinding(browserBinding);
  return actualHash.length === expectedHash.length &&
    crypto.timingSafeEqual(actualHash, expectedHash);
}

/**
 * One-time OAuth state and PKCE verifier store for the current backend
 * process. Pending transactions fail closed after restart; a shared store can
 * replace this class when MyRA is deployed with multiple backend instances.
 */
export class OAuthTransactionStore {
  constructor({ ttlMs = DEFAULT_TTL_MS, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.transactions = new Map();
  }

  begin() {
    this._deleteExpired();

    const state = crypto.randomBytes(32).toString("base64url");
    const codeVerifier = crypto.randomBytes(64).toString("base64url");
    const browserBinding = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    this.transactions.set(state, {
      codeVerifier,
      browserBindingHash: hashBinding(browserBinding),
      expiresAt: this.now() + this.ttlMs,
    });

    return {
      state,
      codeVerifier,
      codeChallenge,
      browserBinding,
      expiresAt: this.now() + this.ttlMs,
    };
  }

  consume(state, browserBinding) {
    if (typeof state !== "string" || state.length === 0) {
      throw new OAuthStateError();
    }

    const transaction = this.transactions.get(state);
    // Delete before validation so every callback attempt is one-time, even if
    // it supplies a wrong browser binding.
    this.transactions.delete(state);

    if (
      !transaction ||
      transaction.expiresAt <= this.now() ||
      !bindingsMatch(transaction.browserBindingHash, browserBinding)
    ) {
      throw new OAuthStateError();
    }

    return { codeVerifier: transaction.codeVerifier };
  }

  _deleteExpired() {
    const currentTime = this.now();
    for (const [state, transaction] of this.transactions.entries()) {
      if (transaction.expiresAt <= currentTime) {
        this.transactions.delete(state);
      }
    }
  }
}

export const oauthTransactionStore = new OAuthTransactionStore();
