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
      return res.status(401).json({
        success: false,
        error: "Your session has expired. Please sign in again.",
      });
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
router.delete("/conversation/:conversationId", optionalAuth, (req, res) =>
  chatController.deleteConversation(req, res)
);
router.delete("/conversations/:conversationId", optionalAuth, (req, res) =>
  chatController.deleteConversation(req, res)
);
router.get("/conversations", optionalAuth, (req, res) =>
  chatController.getConversations(req, res)
);
router.get("/history/:conversationId", optionalAuth, (req, res) =>
  chatController.getHistory(req, res)
);

export default router;
