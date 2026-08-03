import { Router } from "express";
import chatController from "../controllers/chatController.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

router.use(requireAuth);

router.post("/message", (req, res) =>
  chatController.sendMessage(req, res)
);
router.post("/message/stream", (req, res) =>
  chatController.sendMessageStream(req, res)
);
router.post("/conversation", (req, res) =>
  chatController.createConversation(req, res)
);
router.delete("/conversation/:conversationId", (req, res) =>
  chatController.deleteConversation(req, res)
);
router.delete("/conversations/:conversationId", (req, res) =>
  chatController.deleteConversation(req, res)
);
router.get("/conversations", (req, res) =>
  chatController.getConversations(req, res)
);
router.get("/history/:conversationId", (req, res) =>
  chatController.getHistory(req, res)
);

export default router;
