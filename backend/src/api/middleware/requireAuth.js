import jwt from "jsonwebtoken";

const UNAUTHENTICATED_RESPONSE = Object.freeze({
  success: false,
  error: "Authentication required.",
});

function hasUserId(value) {
  return (
    (typeof value === "string" && value.trim().length > 0) ||
    (typeof value === "number" && Number.isInteger(value) && value >= 0)
  );
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT authentication is not configured");
  }
  return secret;
}

/**
 * Verify a MyRA access token and return only the trusted server identity fields.
 * Caller-provided request data is never merged into this principal.
 */
export function verifyAccessToken(token) {
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new Error("Missing access token");
  }

  const decoded = jwt.verify(token, getJwtSecret(), {
    algorithms: ["HS256"],
  });

  if (!decoded || typeof decoded === "string" || !hasUserId(decoded.userId)) {
    throw new Error("Invalid token payload");
  }

  return Object.freeze({
    userId: decoded.userId,
    authType: "jwt",
  });
}

/**
 * Local bypass is intentionally opt-in and is ignored in production even if
 * the flag is accidentally set there.
 */
export function getDevelopmentPrincipal() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_AUTH_DEV_BYPASS !== "true"
  ) {
    return null;
  }

  const configuredUserId = process.env.SYNC_USER_ID;
  if (!configuredUserId || configuredUserId.trim().length === 0) {
    return null;
  }

  const numericUserId = Number(configuredUserId);
  const userId = Number.isSafeInteger(numericUserId) && numericUserId >= 0
    ? numericUserId
    : configuredUserId.trim();

  return Object.freeze({ userId, authType: "development_bypass" });
}

export function extractBearerToken(authorization) {
  if (typeof authorization !== "string") return null;
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] ?? null;
}

export function requireAuth(req, res, next) {
  const authorization = req.headers.authorization;
  const token = extractBearerToken(authorization);

  if (!authorization) {
    const developmentPrincipal = getDevelopmentPrincipal();
    if (developmentPrincipal) {
      req.user = developmentPrincipal;
      return next();
    }

    return res.status(401).json(UNAUTHENTICATED_RESPONSE);
  }

  // A malformed or invalid supplied credential is never converted into a
  // development-bypass request.
  if (!token) {
    return res.status(401).json(UNAUTHENTICATED_RESPONSE);
  }

  try {
    req.user = verifyAccessToken(token);
    return next();
  } catch {
    return res.status(401).json(UNAUTHENTICATED_RESPONSE);
  }
}

export function getAuthenticatedUserId(req) {
  if (!hasUserId(req.user?.userId)) {
    throw new Error("Authenticated user context is required");
  }
  return req.user.userId;
}
