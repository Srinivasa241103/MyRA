import { Router } from "express";
import StatsController from "../controllers/statsController.js";

const statsController = new StatsController();
const router = Router();
router.get("/all", (req, res) => statsController.getAllStats(req, res));

export default router;
