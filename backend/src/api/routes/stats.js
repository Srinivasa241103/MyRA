import { Router } from "express";
import jwt from "jsonwebtoken";
import StatsController from "../controllers/statsController.js";

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

const statsController = new StatsController();
const router = Router();
router.get("/all", optionalAuth, (req, res) => statsController.getAllStats(req, res));

export default router;
