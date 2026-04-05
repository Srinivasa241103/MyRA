import express from "express";
import { calendarAgentGraph } from "../../service/agent/calenderAgent/graph.js";

const router = express.Router();

router.post("/agent/calender", async (req, res) => {
  const { message, threadId, confirmationStatus } = req.body;

  try {
    const config = {
      configurable: { thread_id: threadId },
    };

    const input = confirmationStatus
      ? { confirmationStatus, messages: [{ role: "user", content: message }] }
      : { userMessage: message };

    const result = await calendarAgentGraph.invoke(input, config);

    res.json({
      response: result.responseToUser,
      status: result.confirmationStatus,
      eventDetails: result.eventDetails,
      // Send these so the frontend can show a nice confirmation UI
      pendingConfirmation: result.confirmationStatus === "pending_confirmation",
    });
  } catch (error) {
    console.error("Calender agent error: ", error);
    res.status(500).json({ error: "Agent execution failed" });
  }
});

export default router;
