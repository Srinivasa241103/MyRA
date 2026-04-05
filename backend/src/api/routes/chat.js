import { Router } from "express";
import jwt from "jsonwebtoken";
import chatController from "../controllers/chatController.js";

const router = Router();

function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      req.user = jwt.verify(header.substring(7), process.env.JWT_SECRET);
    } catch {
      // invalid token — continue without user context
    }
  }
  next();
}

router.post("/message", optionalAuth, (req, res) =>
  chatController.sendMessage(req, res)
);
router.post("/message/stream", optionalAuth, (req, res) =>
  chatController.sendMessageStream(req, res)
);
router.post("/conversation", (req, res) =>
  chatController.createConversation(req, res)
);
router.get("/conversations", (req, res) =>
  chatController.getConversations(req, res)
);
router.get("/history/:conversationId", (req, res) =>
  chatController.getHistory(req, res)
);

export default router;
