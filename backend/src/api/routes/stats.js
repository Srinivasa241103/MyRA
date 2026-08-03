import { Router } from "express";
import StatsController from "../controllers/statsController.js";
import { requireAuth } from "../middleware/requireAuth.js";

const statsController = new StatsController();
const router = Router();
router.get("/all", requireAuth, (req, res) => statsController.getAllStats(req, res));

export default router;
