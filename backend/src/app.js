import express from "express";
import cors from "cors";
import authRoutes from "./api/routes/authRoutes.js";
import syncRoutes from "./api/routes/syncRoutes.js";
import chatRoutes from "./api/routes/chat.js";
import statsRoutes from "./api/routes/stats.js";
import apiBudgetRoutes from "./api/routes/apiBudgets.js";
import { createHealthRouter } from "./api/routes/health.js";
import { readinessState } from "./observability/index.js";

const app = express();

//base config
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// CORS configuration
const allowedOrigins = (
  process.env.CORS_ORIGIN ||
  process.env.FRONTEND_URL ||
  "http://localhost:5173"
)
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Health endpoints are unauthenticated by design: orchestrators and load
// balancers cannot present a token. They are mounted ahead of the application
// routes so probes stay answerable regardless of downstream state, and they
// expose no user data. The probe runner is registered at boot (FND-05.6), so
// mounting here does not couple app.js to the probe implementations.
app.use("/health", createHealthRouter());

// FND-05.6 boot gate: the listener binds before dependencies connect, so until
// startup completes only /health/* answers. Application routes would otherwise
// surface raw driver errors from a database that is not connected yet. The
// gate lifts permanently once startup completes — startupComplete latches, so
// a later drain keeps serving in-flight traffic while /health/ready 503s.
app.use((req, res, next) => {
  if (readinessState.startupComplete) return next();
  res.set("Retry-After", "1");
  res.status(503).json({ error: "Service is starting", phase: readinessState.phase });
});

app.get("/", (req, res) => {
  res.send("API is running...");
});

// Auth routes
app.use("/auth", authRoutes);
app.use("/sync", syncRoutes);
app.use("/chat", chatRoutes);
app.use("/stats", statsRoutes);
app.use("/budgets", apiBudgetRoutes);

// AGT-07 mounts "/agent" here, below the boot gate above and behind
// AGENT_RUNTIME_ENABLED (default false). Both placements are load-bearing: a
// run endpoint mounted above the gate would accept work before PostgreSQL and
// the checkpointer are connected, and an unflagged mount would ship the agent
// runtime to every deploy that upgrades. /chat stays unconditional either way.

export default app;
