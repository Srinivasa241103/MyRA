import { Router } from "express";
import apiBudgetController from "../controllers/apiBudgetController.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

router.get("/", requireAuth, (req, res) => apiBudgetController.get(req, res));
router.put("/", requireAuth, (req, res) => apiBudgetController.update(req, res));

export default router;
