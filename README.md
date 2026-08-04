# MyRA

MyRA is a personal RAG application that connects Gmail and Google Calendar with conversational personal-data retrieval.

**Live application:** [https://yoursmyra.com](https://yoursmyra.com)

## Overview

MyRA brings email and calendar retrieval into one chat interface. After signing in with Google, users can sync Gmail and Calendar data and ask questions about that indexed data.

The project is under active development. The current backend is intentionally RAG-only while the application use case is being redesigned. Some visible controls are still prototypes; the current limitations are listed below.

## Key features

- Google OAuth sign-in with Gmail and Google Calendar access
- RAG chat with selectable OpenAI and Anthropic models
- Gmail and Calendar synchronization, normalization, chunking, and embedding
- Personal-data retrieval with source, date, and person-aware filtering
- Retrieved context references included in RAG responses
- Saved conversation history with conversation-level soft deletion
- Usage views for model tokens, estimated cost, chat sessions, synced emails, and calendar events
- Per-user OpenAI and Anthropic monthly budgets based on current calendar-month INR usage, with editable 50%, 80%, and 95% email alert thresholds by default
- Live sync progress through Socket.IO
- Responsive light and dark interfaces

## Current limitations

- Email sending, drafting, and calendar mutations are not available; Google data access is read-only.
- File attachments and the Notes source are present in the interface but are not processed by the backend.
- Voice controls call a configurable voice endpoint, but this repository does not include the matching backend route.
- Some home summary and upcoming-calendar cards fall back to empty states because their expected endpoints are not registered by the backend.
- API budget settings are persisted; most other settings controls are still local interface state.
- Memory currently consists of stored conversation history. The full personal memory engine described in the roadmap is not implemented.
- Spotify, Google Drive, and GitHub are not active integrations.

## How it works

1. The user signs in through Google OAuth. MyRA stores the connected Gmail and Calendar credentials in PostgreSQL.
2. Manual or scheduled sync jobs fetch Google data, normalize it into documents, and store it in PostgreSQL.
3. Documents are split into chunks and embedded with OpenAI. Vectors are stored in pgvector by default, with Chroma available as an alternative.
4. Every chat message runs through the user-scoped RAG query pipeline.
5. Retrieval plans source, date, and person filters, builds context, and generates the response with the selected model.

The Express API is organized under `/auth`, `/sync`, `/chat`, `/stats`, and `/budgets`. A budget job totals each user’s current calendar-month LLM usage and sends newly crossed alert levels without repeating the same alert within four days. Socket.IO is used separately for sync progress updates.

## Tech stack

### Frontend

- React 19 and Vite
- Zustand
- Socket.IO client
- React Markdown and Lucide icons
- CSS with Tailwind and PostCSS tooling

### Backend and AI

- Node.js, Express, JavaScript, and TypeScript
- LangChain
- OpenAI chat models and embeddings
- Anthropic chat models
- Socket.IO, JSON Web Tokens, and node-cron

### Data

- PostgreSQL
- pgvector as the default vector store
- Optional local or hosted Chroma

### Integrations and deployment

- Google OAuth
- Gmail API
- Google Calendar API
- Vercel SPA configuration for the frontend

The repository does not contain a backend hosting configuration.

## Project structure

```text
frontend/                 React application, pages, stores, and API clients
backend/
  src/api/                Express routes and controllers
  src/RAG/                Ingestion, embeddings, retrieval, and query pipeline
  src/service/            Google sync, cron, OAuth, alert, and WebSocket services
  src/database/           PostgreSQL repositories
  scripts/                Vector-store migration utility
  API_BUDGETS_MIGRATION.sql  API budget tables and user threshold columns
  REMOVE_AGENT_DATABASE_OBJECTS.sql  One-time cleanup for the removed workflows
```

## Local setup

### Prerequisites

- Node.js and npm
- A PostgreSQL database
- pgvector when using the default vector store, or a Chroma instance when `VECTOR_STORE=chroma`
- Google OAuth credentials with the Gmail and Calendar scopes requested by the application
- OpenAI and Anthropic API keys for the models exposed by the current interface

The repository does not include a full database bootstrap. A compatible PostgreSQL schema must already be provisioned. Apply the included API budget migration from the repository root:

```bash
psql "<postgres-connection-string>" -f backend/API_BUDGETS_MIGRATION.sql
```

This adds the reusable `api_budgets` table, monthly alert delivery records, and the three budget threshold columns on `users`.

If upgrading a database that previously ran the calendar or email workflows, review and run the one-time cleanup separately:

```bash
psql "<postgres-connection-string>" -f backend/REMOVE_AGENT_DATABASE_OBJECTS.sql
```

### Quick start — V2 dev stack (recommended)

The V2 foundation (FND-05) provides a layered startup: one command per layer,
each verified before the next. Requires Docker Desktop; everything else is
provisioned for you on non-default ports (55432/58000/56379), so nothing
collides with services you already run.

```bash
git clone https://github.com/Srinivasa241103/personal-ai-assistant.git
cd personal-ai-assistant/backend
npm install

# 1. Backing services: PostgreSQL (pgvector), ChromaDB, Redis.
#    --wait blocks until every container healthcheck passes.
npm run services:up

# 2. Configuration: copy the template, then fill in the two blank secrets
#    (JWT_SECRET, TOKEN_ENCRYPTION_KEY — `openssl rand -hex 32` each).
#    Defaults already point at the services from step 1.
cp .env.example .env

# 3. Backend. Boot order: validate config → bind listener → connect Postgres
#    → apply migrations (development only) → probe dependencies → ready.
npm run dev

# 4. Frontend, in another terminal.
cd ../frontend && npm install && npm run dev
```

Startup validates every environment variable at once and reports all problems
together, never printing a secret. The backend binds its listener immediately
and reports its own state on unauthenticated health endpoints:

| Endpoint | Question it answers |
| --- | --- |
| `GET /health/live` | Should this process be restarted? (never touches dependencies) |
| `GET /health/ready` | Should this process receive traffic? 503 lists each dependency's status |
| `GET /health/startup` | Has boot (including migrations) completed? |

If a required dependency (PostgreSQL, migrations, Chroma when
`VECTOR_STORE=chroma`) is unavailable, the backend stays up and unready,
retrying with capped backoff — it becomes ready on its own once the dependency
returns. `SIGTERM`/`SIGINT` drain gracefully: readiness flips to 503, cron
stops, in-flight requests get `SHUTDOWN_DRAIN_TIMEOUT_MS` to finish, then
Redis and the PostgreSQL pool close (exit 0; exit 1 if the drain was forced).

Service management: `npm run services:status`, `services:logs`,
`services:down` (keeps data), `services:reset` (wipes the `myra_v2_*` volumes).
To populate a fresh local Chroma from PostgreSQL without re-embedding:
`npm run migrate:chroma`.

### Manual setup (V1 path)

### 1. Clone the repository

```bash
git clone https://github.com/Srinivasa241103/personal-ai-assistant.git
cd personal-ai-assistant
```

### 2. Start the backend

```bash
cd backend
npm install
npm run dev
```

The development server uses port `2020` unless `PORT` is set.

### 3. Start the frontend

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

Vite serves the frontend at `http://localhost:5173` by default.

### Build and validation

```bash
cd backend
npm run typecheck
npm run build
npm start
```

```bash
cd frontend
npm run lint
npm run build
npm run preview
```

The backend typecheck/build and frontend lint/build pass in the current repository state.

### Regression baseline

The V2 foundation keeps a behavioural safety net (FND-06) around the existing
RAG, ingestion, Chroma, Google sync, chat persistence, and SSE paths. It runs
entirely on fixtures and injected collaborators, so no database, vector store,
Google account, or model key is needed:

```bash
cd backend
npm run test:fnd-06
```

```bash
cd backend
npm run typecheck:baseline
```

The suite includes mutation guards that deliberately remove user filtering and
source metadata and assert the baseline rejects the result — a net that has been
shown to catch the regressions it claims to catch. Foundation package suites run
with `npm run test:foundation`.

### V2 module boundary

The agentic V2 code is built in ten strict, layered TypeScript modules under
`backend/src/` — `agents`, `freshness`, `entities`, `tools`, `evidence`,
`actions`, `memory`, `connectors`, `evaluation`, `observability` — while the
existing mixed JS/TS application keeps building under the loose root config
(FND-07). The layering, allowed dependency edges, and the credential and legacy
rules are declared in `backend/architecture/moduleBoundaries.ts` and enforced:

```bash
cd backend
npm run check:architecture
```

```bash
cd backend
npm run typecheck:v2
```

The check walks every import in `src/`, rejects import cycles, undeclared or
upward dependencies, reaching past a module's public surface, and any path from
the agent, evidence, or memory layers to a credential. Provider adapters sit
below the Tool Gateway and are unreachable from outside it. Each rule ships with
a guard proving it rejects the violation it exists to catch.

## Environment variables

Create `backend/.env` with placeholder values like these:

```dotenv
PORT=2020
FRONTEND_URL=http://localhost:5173
CORS_ORIGIN=http://localhost:5173

DB_HOST=<postgres-host>
DB_PORT=5432
DB_NAME=<database-name>
DB_USER=<database-user>
DB_PASSWORD=<database-password>

JWT_SECRET=<strong-random-secret>
TOKEN_ENCRYPTION_KEY=<64-character-hex-key>

GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>
GOOGLE_REDIRECT_URI=http://localhost:2020/auth/google/callback

OPENAI_API_KEY=<openai-api-key>
OPENAI_CHAT_MODEL=<openai-chat-model>
OPENAI_LIGHT_MODEL=<openai-lightweight-model>
OPENAI_EMBEDDING_MODEL=<openai-embedding-model>
EMBEDDING_DIMENSIONS=1536

ANTHROPIC_API_KEY=<anthropic-api-key>
ANTHROPIC_CHAT_MODEL=<anthropic-chat-model>

# Recommended while setting up locally
ENABLE_CRON_JOBS=false
```

Create `frontend/.env.local`:

```dotenv
VITE_API_BASE_URL=http://localhost:2020
```

To enable API budget emails in a running environment, enable cron jobs and configure the SMTP sender:

```dotenv
ENABLE_CRON_JOBS=true
ENABLE_API_BUDGET_ALERT_CRON=true
API_BUDGET_ALERT_CRON_SCHEDULE="0 9 * * *"
MAIL_USER=<smtp-user>
MAIL_APP_PASSWORD=<smtp-password>
MAIL_SMTP_HOST=<smtp-host>
MAIL_SMTP_PORT=587
MAIL_FROM_NAME=MyRA
MAIL_FROM_ADDRESS=<sender-address>
```

Additional variables are only needed for the related optional behavior:

- **Model settings:** `OPENAI_MODEL_TEMP`, `OPENAI_MAX_TOKENS`, `ANTHROPIC_MODEL_TEMP`, and `ANTHROPIC_MAX_TOKENS`
- **Runtime and retrieval:** `DEFAULT_USER_TIMEZONE`, `LOG_LEVEL`, and `VECTOR_STORE`. Local authentication bypass is disabled by default; enable it only with both `ENABLE_AUTH_DEV_BYPASS=true` and `SYNC_USER_ID=<local-user-id>`. The bypass is ignored when `NODE_ENV=production`.
- **Chroma:** `CHROMA_HOST`, `CHROMA_PORT`, `CHROMA_SSL`, `CHROMA_COLLECTION`, `CHROMA_API_KEY`, `CHROMA_TENANT`, and `CHROMA_DATABASE`
- **Scheduled Google sync:** `ENABLE_GOOGLE_WORKSPACE_SYNC_CRON`, `ENABLE_GMAIL_SYNC_CRON`, `ENABLE_CALENDAR_SYNC_CRON`, `GOOGLE_WORKSPACE_SYNC_CRON_SCHEDULE`, `CRON_TIMEZONE`, `GOOGLE_WORKSPACE_SYNC_STALE_MINUTES`, `GOOGLE_WORKSPACE_SYNC_EMBEDDING_BATCH_SIZE`, and `GOOGLE_WORKSPACE_SYNC_EMBEDDING_MAX_BATCHES`
- **API budget alerts:** `ENABLE_API_BUDGET_ALERT_CRON`, `API_BUDGET_ALERT_CRON_SCHEDULE`, `MAIL_USER`, `MAIL_APP_PASSWORD`, `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `MAIL_FROM_NAME`, and `MAIL_FROM_ADDRESS`; the older `ENABLE_CREDS_ALERT_CRON` and `CREDS_ALERT_CRON_SCHEDULE` names remain accepted as aliases. Budgets and thresholds are saved per user in PostgreSQL rather than environment variables.
- **Usage-cost overrides:** `<PROVIDER>_INPUT_COST_PER_MILLION`, `<PROVIDER>_OUTPUT_COST_PER_MILLION`, or the model-specific `<PROVIDER>_<MODEL>_INPUT_COST_PER_MILLION` and `<PROVIDER>_<MODEL>_OUTPUT_COST_PER_MILLION` forms
- **Frontend voice hook:** `VITE_VOICE_CHAT_PATH`; the corresponding voice backend is not part of this repository

Do not commit real credentials or local environment files.

## Upcoming features and development

The following items are planned and are **not currently available**.

### Ask My Docs — Production RAG

A document upload and question-answering system for:

- PDF documents
- Word documents
- Markdown files
- Research papers
- Legal documents
- Policy documents

The production version is planned to include document ingestion, parsing, chunking, indexing, retrieval, citations, and document management.

### More personal integrations

Planned integrations include Spotify, Google Drive, and GitHub. These sources are intended to give the assistant more useful personal context.

### Personal Memory Engine

A controllable memory system planned to support:

- Episodic memory
- Factual or semantic memory
- Contextual sliding-window memory
- Short-term and long-term memory
- Memory retrieval and relevance scoring
- Memory consolidation and updates
- Expiry and conflict handling

The goal is to build structured personal context over time while keeping stored memory understandable and controllable.

## Privacy and safety

- Google OAuth access and refresh tokens are encrypted before they are stored in PostgreSQL.
- Google OAuth requests read-only Gmail and Calendar access for synchronization and retrieval.
- Synced content, retrieved context, and prompts may be sent to the configured OpenAI or Anthropic service to produce a response.
- Deleting a conversation currently marks its rows as deleted rather than physically removing them.
- Full account export and deletion flows are not implemented in this repository.

The deployed application also provides a [Privacy Policy](https://yoursmyra.com/privacy) and [Terms of Service](https://yoursmyra.com/terms).

## Author

Built by [Srinivasa Shankar](https://github.com/Srinivasa241103).
