# MyRA

MyRA is a personal AI assistant that connects Gmail and Google Calendar with chat, personal-data retrieval, email drafting, and calendar actions.

**Live application:** [https://yoursmyra.com](https://yoursmyra.com)

## Overview

MyRA brings email, calendar, and general AI chat into one interface. After signing in with Google, users can sync Gmail and Calendar data, ask questions about that data, draft new emails, and create calendar events with confirmation steps.

The project is under active development. The core Google sync, retrieval, chat, email-agent, and calendar-agent paths are implemented. Some visible controls are still prototypes; the current limitations are listed below.

## Key features

- Google OAuth sign-in with Gmail and Google Calendar access
- General chat with selectable OpenAI and Anthropic models
- Gmail and Calendar synchronization, normalization, chunking, and embedding
- Personal-data retrieval with source, date, and person-aware filtering
- Retrieved context references included in RAG responses
- Calendar search and event creation with conflict checks and user confirmation
- New-email drafting with recipient lookup, draft review, edits, explicit approval, and a six-second revoke window
- Saved conversation history with conversation-level soft deletion
- Usage views for model tokens, estimated cost, chat sessions, synced emails, and calendar events
- Live sync progress through Socket.IO
- Responsive light and dark interfaces

## Current limitations

- Replying to an existing email thread is not available.
- File attachments and the Notes source are present in the interface but are not processed by the backend.
- Voice controls call a configurable voice endpoint, but this repository does not include the matching backend route.
- Some home summary and upcoming-calendar cards fall back to empty states because their expected endpoints are not registered by the backend.
- Most settings controls are local interface state and are not persisted.
- Memory currently consists of stored conversation history. The full personal memory engine described in the roadmap is not implemented.
- Spotify, Google Drive, and GitHub are not active integrations.

## How it works

1. The user signs in through Google OAuth. MyRA stores the connected Gmail and Calendar credentials in PostgreSQL.
2. Manual or scheduled sync jobs fetch Google data, normalize it into documents, and store it in PostgreSQL.
3. Documents are split into chunks and embedded with OpenAI. Vectors are stored in pgvector by default, with Chroma available as an alternative.
4. An intent router sends each message to general chat, personal-data retrieval, the calendar agent, or the email agent.
5. Retrieval builds a user-scoped context for the selected model. Calendar creation and email sending add confirmation steps before making changes.

The Express API is organized under `/auth`, `/sync`, `/chat`, and `/stats`. Socket.IO is used separately for sync progress updates.

## Tech stack

### Frontend

- React 19 and Vite
- Zustand
- Socket.IO client
- React Markdown and Lucide icons
- CSS with Tailwind and PostCSS tooling

### Backend and AI

- Node.js, Express, JavaScript, and TypeScript
- LangChain and LangGraph
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
  src/agent/              Calendar and email LangGraph workflows
  src/service/            Google, email, cron, OAuth, and WebSocket services
  src/database/           PostgreSQL repositories
  scripts/                Vector-store migration utility
```

## Local setup

### Prerequisites

- Node.js and npm
- A PostgreSQL database
- pgvector when using the default vector store, or a Chroma instance when `VECTOR_STORE=chroma`
- Google OAuth credentials with the Gmail and Calendar scopes requested by the application
- OpenAI and Anthropic API keys for the models exposed by the current interface

This repository does not include SQL migrations or a database bootstrap script. A compatible PostgreSQL schema must already be provisioned before the backend can run.

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

Additional variables are only needed for the related optional behavior:

- **Model settings:** `OPENAI_MODEL_TEMP`, `OPENAI_MAX_TOKENS`, `ANTHROPIC_MODEL_TEMP`, `ANTHROPIC_MAX_TOKENS`, `CALENDAR_AGENT_LLM_PROVIDER`, and `CALENDAR_AGENT_MODEL`
- **Runtime and retrieval:** `SYNC_USER_ID` for unauthenticated development fallbacks, `DEFAULT_USER_TIMEZONE`, `LOG_LEVEL`, and `VECTOR_STORE`
- **Chroma:** `CHROMA_HOST`, `CHROMA_PORT`, `CHROMA_SSL`, `CHROMA_COLLECTION`, `CHROMA_API_KEY`, `CHROMA_TENANT`, and `CHROMA_DATABASE`
- **Scheduled Google sync:** `ENABLE_GOOGLE_WORKSPACE_SYNC_CRON`, `ENABLE_GMAIL_SYNC_CRON`, `ENABLE_CALENDAR_SYNC_CRON`, `GOOGLE_WORKSPACE_SYNC_CRON_SCHEDULE`, `CRON_TIMEZONE`, `GOOGLE_WORKSPACE_SYNC_STALE_MINUTES`, `GOOGLE_WORKSPACE_SYNC_EMBEDDING_BATCH_SIZE`, and `GOOGLE_WORKSPACE_SYNC_EMBEDDING_MAX_BATCHES`
- **Credential usage alerts:** `ENABLE_CREDS_ALERT_CRON`, `CREDS_ALERT_CRON_SCHEDULE`, `ANTHROPIC_MONTHLY_BUDGET`, `GOOGLE_MONTHLY_BUDGET`, `MAIL_USER`, `MAIL_APP_PASSWORD`, `MAIL_SMTP_HOST`, `MAIL_SMTP_PORT`, `MAIL_FROM_NAME`, `MAIL_FROM_ADDRESS`, and `MAIL_ALERT_RECIPIENT`
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

### Personal Agent Memory Engine

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
- Calendar events are created only after confirmation.
- The email agent requires draft approval and provides a six-second revoke window before sending.
- Synced content, retrieved context, and prompts may be sent to the configured OpenAI or Anthropic service to produce a response.
- Deleting a conversation currently marks its rows as deleted rather than physically removing them.
- Full account export and deletion flows are not implemented in this repository.

The deployed application also provides a [Privacy Policy](https://yoursmyra.com/privacy) and [Terms of Service](https://yoursmyra.com/terms).

## Author

Built by [Srinivasa Shankar](https://github.com/Srinivasa241103).
