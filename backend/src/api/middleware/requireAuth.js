import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const authorization = req.headers.authorization;

  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: "Please sign in to manage API budgets.",
    });
  }

  try {
    const decoded = jwt.verify(
      authorization.substring(7),
      process.env.JWT_SECRET,
    );
    if (!decoded || typeof decoded === "string" || !decoded.userId) {
      throw new Error("Invalid token payload");
    }
    req.user = decoded;
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      error: "Your session has expired. Please sign in again.",
    });
  }
}
