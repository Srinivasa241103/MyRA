from __future__ import annotations

from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    KeepTogether,
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    Preformatted,
    SimpleDocTemplate,
    Spacer,
)


OUT_DIR = Path(__file__).resolve().parent
MARKDOWN_PATH = OUT_DIR / "myra-master-interview-prep.md"
PDF_PATH = OUT_DIR / "myra-master-interview-prep.pdf"


API_DOCS = [
    {
        "name": "Health check",
        "method": "GET",
        "path": "/",
        "purpose": "Returns a simple string to prove the Express server is running.",
        "request": "No body and no params.",
        "response": "Plain text: API is running...",
        "errors": "Only framework/server errors.",
        "auth": "No authentication.",
        "handler": "Inline route in backend/src/app.js.",
        "services": "None.",
        "tables": "None.",
        "example_request": "curl http://localhost:2020/",
        "example_response": "API is running...",
        "interview": "Explain it as a basic operational endpoint used to quickly verify that the backend process started and is reachable.",
    },
    {
        "name": "Start Google OAuth login",
        "method": "GET",
        "path": "/auth/google/login",
        "purpose": "Builds a Google OAuth consent URL for Gmail, Gmail send/compose, Google Calendar events, profile, and email scopes.",
        "request": "No body. The backend creates a random state string but currently does not persist or validate it later.",
        "response": "JSON with success true and data.authUrl.",
        "errors": "Returns through Express next(error) if URL generation fails.",
        "auth": "No existing app auth required.",
        "handler": "AuthController.initiateGoogleLogin in backend/src/api/controllers/authController.js.",
        "services": "Uses google.auth.OAuth2 from googleapis.",
        "tables": "None at this step.",
        "example_request": "GET /auth/google/login",
        "example_response": '{"success":true,"data":{"authUrl":"https://accounts.google.com/o/oauth2/v2/auth?..."}}',
        "interview": "Say this endpoint starts the account-connection flow. It requests offline access so the app can refresh tokens and later read Gmail, send Gmail, and read/write Calendar for the user.",
    },
    {
        "name": "Google OAuth callback",
        "method": "GET",
        "path": "/auth/google/callback",
        "purpose": "Handles Google's callback, exchanges the authorization code for tokens, fetches Google profile data, creates or updates the user, stores encrypted credentials, signs a JWT, and redirects to the frontend callback page.",
        "request": "Query params: code from Google, or error if the user denied consent.",
        "response": "Redirects to FRONTEND_URL/auth/callback?token=<jwt> on success. Redirects to /login with error codes on failure.",
        "errors": "access_denied, missing_code, auth_failed redirect paths. Internal errors are logged.",
        "auth": "Google authorization code is required, but no existing app JWT is required.",
        "handler": "AuthController.handleGoogleCallback and AuthController.createOrUpdateUser.",
        "services": "googleapis OAuth2 and OAuth userinfo. GoogleAuthService.encrypt for token encryption.",
        "tables": "users and api_credentials.",
        "example_request": "GET /auth/google/callback?code=4/0Ab...",
        "example_response": "HTTP 302 redirect to http://frontend/auth/callback?token=<jwt>",
        "interview": "Explain this as the bridge between Google identity and your own app identity. Google returns the code, the backend stores protected tokens, then the frontend receives only the app JWT.",
    },
    {
        "name": "Get current user",
        "method": "GET",
        "path": "/auth/me",
        "purpose": "Validates the JWT, loads the user row, and adds connected source information from stored credentials.",
        "request": "Authorization: Bearer <jwt>.",
        "response": "JSON with data.user including user fields and connectedSources.",
        "errors": "401 for missing token, 401 for invalid token, 404 if the user id from the token is not found.",
        "auth": "Required.",
        "handler": "AuthController.getCurrentUser.",
        "services": "jsonwebtoken, UserRepository, CredentialRepository.",
        "tables": "users and api_credentials.",
        "example_request": "GET /auth/me with Authorization header.",
        "example_response": '{"success":true,"data":{"user":{"id":3,"email":"user@example.com","connectedSources":[{"source":"gmail"}]}}}',
        "interview": "Say this endpoint is how the frontend restores a login session from localStorage. It also tells the UI which integrations are connected.",
    },
    {
        "name": "Update display name",
        "method": "PATCH",
        "path": "/auth/user/name",
        "purpose": "Updates user_name, which is the app-level display name separate from the Google account name.",
        "request": "Authorization header plus JSON body { userName: string }.",
        "response": "Updated user object in data.user.",
        "errors": "401 for missing/invalid token, 400 when userName is missing or blank.",
        "auth": "Required.",
        "handler": "AuthController.updateUserName.",
        "services": "UserRepository.updateUserName.",
        "tables": "users.",
        "example_request": 'PATCH /auth/user/name {"userName":"Cherry"}',
        "example_response": '{"success":true,"data":{"user":{"id":3,"user_name":"Cherry"}}}',
        "interview": "Explain that it prevents overwriting the Google profile name and keeps a user-controlled app display name.",
    },
    {
        "name": "Logout",
        "method": "POST",
        "path": "/auth/logout",
        "purpose": "Returns a logout success message. The frontend removes the JWT from localStorage.",
        "request": "Optional Authorization header. No body required.",
        "response": '{"success":true,"message":"Logged out successfully"}',
        "errors": "Only unexpected server errors.",
        "auth": "Not strictly enforced by the controller.",
        "handler": "AuthController.logout.",
        "services": "None.",
        "tables": "None.",
        "example_request": "POST /auth/logout",
        "example_response": '{"success":true,"message":"Logged out successfully"}',
        "interview": "Say logout is currently client-side token removal plus a backend acknowledgement. There is no server-side JWT blacklist yet.",
    },
    {
        "name": "Send chat message",
        "method": "POST",
        "path": "/chat/message",
        "purpose": "Main assistant endpoint. It routes the message to email agent, calendar agent, RAG, or general LLM chat.",
        "request": "JSON body: message, conversationId, llmProvider, confirmationStatus, agentActive, activeAgentMode. JWT is optional; fallback user id comes from SYNC_USER_ID.",
        "response": "JSON with queryId, conversationId, query, response, mode, agentActive flags, context and metadata. Email mode may return structured emailResponse.",
        "errors": "400 if message is missing. 401 if a supplied Bearer token is expired/invalid. 500 if routing, agent, RAG, or LLM flow fails.",
        "auth": "Optional authentication middleware. For production this should be required because personal data is involved.",
        "handler": "chatController.sendMessage in backend/src/api/controllers/chatController.js.",
        "services": "routeIntent, calendarAgentGraph, invokeEmailAgent, RagChain, LLMService, MemoryService.",
        "tables": "conversations, documents, document_chunks, llm_usage_logs, recipients, api_credentials, Google Calendar/Gmail API when agents run.",
        "example_request": '{"message":"What emails did I get from Rahul?","conversationId":null,"llmProvider":"OpenAI"}',
        "example_response": '{"success":true,"conversationId":"uuid","response":"According to Source 1...","mode":"rag","context":{"selectedDocuments":2}}',
        "interview": "Explain this as the orchestration endpoint. The backend first classifies intent, then chooses the correct path: RAG for personal-data Q&A, calendar graph for event creation, email graph for safe email drafting/sending, or a normal model call for general chat.",
    },
    {
        "name": "Stream chat message",
        "method": "POST",
        "path": "/chat/message/stream",
        "purpose": "Intended streaming version of chat.",
        "request": "Same concept as /chat/message.",
        "response": "Would be SSE events if implemented.",
        "errors": "Current route calls chatController.sendMessageStream, but that method is commented out in the controller. Calling this endpoint will fail at runtime.",
        "auth": "Optional auth middleware is present in route.",
        "handler": "Route in backend/src/api/routes/chat.js points to a missing method.",
        "services": "Not active.",
        "tables": "Not active.",
        "example_request": "POST /chat/message/stream",
        "example_response": "Runtime failure because sendMessageStream is not available.",
        "interview": "Be honest: streaming was planned and partially sketched, but the current RAG service is non-streaming and the active route should be removed or implemented.",
    },
    {
        "name": "Create conversation id",
        "method": "POST",
        "path": "/chat/conversation",
        "purpose": "Returns a new UUID so the frontend can start a conversation before the first message is saved.",
        "request": "No body.",
        "response": "data.conversationId and createdAt.",
        "errors": "500 if UUID generation or response fails, which is unlikely.",
        "auth": "No authentication on this route.",
        "handler": "chatController.createConversation.",
        "services": "uuid.",
        "tables": "None.",
        "example_request": "POST /chat/conversation",
        "example_response": '{"success":true,"data":{"conversationId":"uuid","createdAt":"2026-07-08T..."}}',
        "interview": "Say the real conversation record is created when a message is saved; this only reserves an id.",
    },
    {
        "name": "List conversations",
        "method": "GET",
        "path": "/chat/conversations",
        "purpose": "Returns recent distinct conversation threads for the sidebar.",
        "request": "Optional query limit. Optional Bearer token; otherwise falls back to SYNC_USER_ID.",
        "response": "data.conversations with conversationId, title, startedAt, lastMessageAt.",
        "errors": "500 on DB failure. 401 only if an invalid Bearer token is supplied.",
        "auth": "Optional in code; should be required in production.",
        "handler": "chatController.getConversations.",
        "services": "ConversationRepository.getConversations.",
        "tables": "conversations.",
        "example_request": "GET /chat/conversations?limit=50",
        "example_response": '{"success":true,"data":{"conversations":[{"conversationId":"uuid","title":"What emails..."}]}}',
        "interview": "Explain that the title is derived from the first user message and ordering uses the most recent message timestamp.",
    },
    {
        "name": "Get conversation history",
        "method": "GET",
        "path": "/chat/history/:conversationId",
        "purpose": "Loads previous turns for a conversation and formats them for the UI.",
        "request": "Path param conversationId. Optional query limit. Optional auth.",
        "response": "data.history as pairs of user_message and assistant_message.",
        "errors": "400 if conversationId is missing, 500 on DB failure.",
        "auth": "Optional in code; user id is still scoped from token or SYNC_USER_ID.",
        "handler": "chatController.getHistory.",
        "services": "MemoryService.loadHistory.",
        "tables": "conversations.",
        "example_request": "GET /chat/history/abc?limit=50",
        "example_response": '{"success":true,"data":{"conversationId":"abc","history":[{"user_message":"Hi","assistant_message":"Hello"}]}}',
        "interview": "Say this converts the DB memory format back into UI message pairs. It currently assumes user and assistant messages alternate.",
    },
    {
        "name": "Get email workflow status",
        "method": "GET",
        "path": "/chat/email-status/:conversationId",
        "purpose": "Reads the LangGraph email-agent checkpoint state for the conversation.",
        "request": "Path param conversationId. Optional auth.",
        "response": "exists, active, emailStatus, response, interrupt, revokeDeadline.",
        "errors": "400 if conversationId is missing, 500 on state read failure.",
        "auth": "Optional in code.",
        "handler": "chatController.getEmailStatus.",
        "services": "getEmailSessionStatus in backend/src/agent/emailAgent/index.js.",
        "tables": "No DB table because the current email graph uses MemorySaver in process memory.",
        "example_request": "GET /chat/email-status/abc",
        "example_response": '{"success":true,"conversationId":"abc","exists":true,"active":true,"emailStatus":"pending_revoke"}',
        "interview": "Explain it lets the UI refresh pending email send state, especially during the short revoke window.",
    },
    {
        "name": "Start Gmail sync",
        "method": "POST",
        "path": "/sync/gmail",
        "purpose": "Starts background ingestion from Gmail and then embedding generation for that user's pending documents.",
        "request": "JSON body: userId required, syncType optional full or incremental. sinceDate and untilDate are accepted but not used.",
        "response": "Immediate response with syncId and status running. The actual work continues after the response.",
        "errors": "400 if userId is missing. 500 if sync log creation or initial setup fails. Later failures are written to sync_logs and emitted by WebSocket.",
        "auth": "No auth middleware on the route even though frontend sends JWT. This is a production gap.",
        "handler": "SyncController.syncGmail and performDocumentsSync.",
        "services": "IngestionPipeline, GmailDataSource, GmailNormalizer, EmbeddingPipeline, socketServer.",
        "tables": "sync_logs, documents, document_chunks, api_credentials.",
        "example_request": '{"userId":3,"syncType":"incremental"}',
        "example_response": '{"success":true,"data":{"syncId":22,"status":"running","message":"Gmail sync started"}}',
        "interview": "Explain the async design: the API returns fast, while the backend emits progress and continues ingestion plus embedding in the background.",
    },
    {
        "name": "Start Calendar sync",
        "method": "POST",
        "path": "/sync/calendar",
        "purpose": "Starts background ingestion from Google Calendar and embedding generation.",
        "request": "JSON body: userId required, syncType optional full or incremental.",
        "response": "Immediate syncId and running status.",
        "errors": "400 if userId missing, 500 for initial failures, WebSocket and sync_logs for background errors.",
        "auth": "No auth middleware on the route.",
        "handler": "SyncController.syncCalendar and performDocumentsSync.",
        "services": "IngestionPipeline, GoogleCalendarDataSource, GoogleCalendarNormalizer, EmbeddingPipeline, socketServer.",
        "tables": "sync_logs, documents, document_chunks, api_credentials.",
        "example_request": '{"userId":3,"syncType":"full"}',
        "example_response": '{"success":true,"data":{"syncId":23,"status":"running","message":"Calendar sync started"}}',
        "interview": "Explain it mirrors Gmail sync but uses Google Calendar events and event-specific normalization.",
    },
    {
        "name": "Get sync status",
        "method": "GET",
        "path": "/sync/status/:syncId",
        "purpose": "Reads one sync_logs row.",
        "request": "Path param syncId.",
        "response": "data is the sync log row.",
        "errors": "404 when the sync id is not found, 500 on DB failure.",
        "auth": "No auth middleware.",
        "handler": "SyncController.getSyncStatus.",
        "services": "SyncLogRepository.findById.",
        "tables": "sync_logs.",
        "example_request": "GET /sync/status/22",
        "example_response": '{"success":true,"data":{"id":22,"status":"success"}}',
        "interview": "Say it is the polling fallback to WebSocket progress.",
    },
    {
        "name": "Get sync history",
        "method": "GET",
        "path": "/sync/history",
        "purpose": "Returns recent sync logs for a user and source.",
        "request": "Query params: userId required, source defaults to gmail, limit defaults to 10.",
        "response": "data.history array.",
        "errors": "400 if userId missing, 500 on DB failure.",
        "auth": "No auth middleware.",
        "handler": "SyncController.getSyncHistory.",
        "services": "SyncLogRepository.findBySource.",
        "tables": "sync_logs.",
        "example_request": "GET /sync/history?userId=3&source=gmail&limit=10",
        "example_response": '{"success":true,"data":{"history":[{"source":"gmail","status":"success"}]}}',
        "interview": "Explain that the profile page uses it to show sync history.",
    },
    {
        "name": "Stats dashboard",
        "method": "GET",
        "path": "/stats/all",
        "purpose": "Aggregates data for the frontend stats page: emails, tokens, sessions, calendar events, and model cost.",
        "request": "Query range is one of 7d, 14d, 30d, 90d. Optional Bearer token; invalid token is ignored and fallback user id is used.",
        "response": "data.emails, data.tokens, data.reminders, data.cost, data.sessions, data.calEvents.",
        "errors": "500 if aggregation queries fail.",
        "auth": "Optional in code.",
        "handler": "StatsController.getAllStats.",
        "services": "StatsRepository.",
        "tables": "llm_usage_logs, embedding_costs, conversations, documents.",
        "example_request": "GET /stats/all?range=14d",
        "example_response": '{"success":true,"data":{"emails":[2,3],"tokens":[{"name":"model","value":1000}],"cost":[{"provider":"OpenAI","spend":0.4}]}}',
        "interview": "Say this endpoint denormalizes several backend metrics into the exact shape needed by the dashboard.",
    },
    {
        "name": "Calendar agent route",
        "method": "POST",
        "path": "/agent/calender",
        "purpose": "Standalone calendar agent route that directly invokes calendarAgentGraph.",
        "request": "Body: message, threadId, confirmationStatus.",
        "response": "response, status, eventDetails, pendingConfirmation.",
        "errors": "500 on agent failure.",
        "auth": "No auth shown in route.",
        "handler": "backend/src/api/routes/agent.js.",
        "services": "calendarAgentGraph.",
        "tables": "Google Calendar API through graph nodes.",
        "example_request": '{"message":"Schedule a meeting tomorrow at 3","threadId":"t1"}',
        "example_response": '{"response":"What should the event be called?","pendingConfirmation":false}',
        "interview": "Mention this route currently is not mounted in app.js, so the active calendar-agent path is through /chat/message, not this standalone route.",
    },
]


FEATURE_FLOWS = [
    (
        "Google login and account connection",
        [
            "User clicks Continue with Google in frontend/src/pages/LoginPage.jsx.",
            "authApi.loginWithGoogle calls GET /auth/google/login.",
            "The backend creates a Google OAuth URL with Gmail and Calendar scopes.",
            "Google redirects to /auth/google/callback with a code.",
            "AuthController exchanges the code, reads Google profile data, upserts users, encrypts access and refresh tokens, stores both gmail and google_calendar credentials, signs a JWT, and redirects to the frontend callback.",
            "AuthCallbackPage stores the JWT as myra_auth_token, calls /auth/me, then puts the user in authStore.",
            "Edge cases: denied consent, missing code, expired/invalid JWT, missing TOKEN_ENCRYPTION_KEY.",
            "Interview explanation: this is OAuth-based authentication plus integration authorization. The app never gives raw Google tokens to the browser.",
        ],
    ),
    (
        "Gmail data sync",
        [
            "User clicks Sync Gmail Now in ProfilePage.",
            "The frontend posts userId and syncType to /sync/gmail.",
            "SyncController creates a sync_logs row and immediately returns syncId.",
            "performDocumentsSync emits progress over Socket.IO.",
            "IngestionPipeline chooses GmailDataSource and GmailNormalizer.",
            "GmailDataSource gets a valid access token, refreshes if needed, lists Gmail messages, and fetches each message in batches.",
            "GmailNormalizer extracts headers, decodes text/plain or text/html, recursively handles multipart messages, cleans content, and creates a document object.",
            "DocumentRepository stores new documents in documents and skips already-seen document_id values for that user.",
            "EmbeddingPipeline splits each document, embeds chunks, stores them in document_chunks, and marks the document as embedded.",
            "Edge cases: empty emails skipped, duplicate documents skipped, token refresh failure, Google API rate limits, embedding failure, missing auth enforcement on sync route.",
        ],
    ),
    (
        "Calendar data sync",
        [
            "User clicks Sync Calendar in ProfilePage or Sidebar.",
            "Frontend posts to /sync/calendar.",
            "SyncController uses IngestionPipeline with sourceName calendar.",
            "GoogleCalendarDataSource gets an authenticated calendar client and lists primary calendar events.",
            "GoogleCalendarNormalizer skips cancelled events, handles all-day and dateTime events, extracts attendees, organizer, location, description, recurrence, and builds embedding-friendly content.",
            "Documents are stored in documents and later chunked/embedded in document_chunks.",
            "Edge cases: cancelled events return null, missing start/end data may break normalization, and full sync uses a hardcoded 2026-01-01 timeMin.",
        ],
    ),
    (
        "RAG chat over personal data",
        [
            "User types a personal-data question in ChatWindow.",
            "chatStore.sendMessage calls POST /chat/message.",
            "ChatController validates message and resolves userId from JWT or SYNC_USER_ID.",
            "routeIntent classifies the message using an OpenAI-backed LLMService call.",
            "For rag, email_read, or calendar_rag intents, RagChain.chat is used.",
            "QueryPipeline embeds the query with OpenAIEmbeddings, retrieves chunks with pgvector distance, filters by distance <= 0.6, builds a context block with source labels, loads conversation history, builds the final prompt, calls LLMService, saves the turn, and returns answer plus source documents.",
            "Frontend renders the response and source count in the assistant bubble.",
            "Edge cases: no relevant chunks results in a no-context block; no userId throws; invalid llmProvider throws; token/cost stats can fail without failing the chat.",
        ],
    ),
    (
        "General chat",
        [
            "If routeIntent returns general, ChatController does not use RAG.",
            "It loads conversation history, creates a system message for a helpful assistant, and calls LLMService directly.",
            "The response is saved with metadata mode general_chat.",
            "This is useful because not every question should search private data.",
            "Edge case: intent classifier can misclassify; default provider must be exactly OpenAI or Anthropic.",
        ],
    ),
    (
        "Calendar event creation agent",
        [
            "User asks to schedule, create, update, cancel, or delete a calendar event. routeIntent returns calendar_agent.",
            "ChatController invokes calendarAgentGraph with a stable thread_id equal to the conversationId.",
            "parse_intent uses Anthropic Claude Haiku to extract title, date, startTime, endTime, description, attendees, and location as JSON.",
            "If required fields title, date, or startTime are missing, ask_for_missing_info returns a targeted question.",
            "When enough fields are present, check_conflicts lists calendar events in the target time window.",
            "If conflicts exist, suggest_slots calls freebusy and shows free one-hour slots.",
            "If no conflict exists, await_confirmation returns a preview and asks yes/no.",
            "On confirmationStatus confirmed, the graph creates the Google Calendar event with sendUpdates all when attendees exist.",
            "Edge cases: date parsing depends on the LLM, timezone conversion uses Asia/Kolkata, graph checkpoints are in memory only, and rejection ends without a custom rejection message.",
        ],
    ),
    (
        "Secure email drafting and sending agent",
        [
            "User asks to compose/write/send a new email. routeIntent returns email_draft.",
            "ChatController starts the emailAgent graph with thread_id secure_email_<userId>_<conversationId>.",
            "parse_request uses OpenAI structured output to extract recipient name/email, tone, and purpose.",
            "resolve_recipient either trusts an explicit valid email or searches recipients using trigram similarity in RecipientRepository.",
            "present_recipient_choice interrupts and asks the user to choose a candidate or enter an email.",
            "draft_email uses OpenAI structured output to produce subject and body.",
            "review_draft interrupts with a draft card. The user can approve, edit, regenerate, or cancel.",
            "prepare_send creates a 6-second revoke window with a random pending_send_token.",
            "revoke_window interrupts and the frontend can send revoke. If timeout occurs, the graph moves to send_email.",
            "send_email uses Gmail API to send a plain-text RFC 2822 message.",
            "Edge cases: MemorySaver means email sessions vanish on server restart, recipient search needs pg_trgm similarity support, reply drafting is intentionally disabled until original thread verification is implemented.",
        ],
    ),
    (
        "Stats dashboard",
        [
            "StatsPage calls statsApi.getAll(range).",
            "StatsController fetches LLM usage, embedding usage, chat sessions, Gmail document counts, and Calendar document counts.",
            "Frontend draws KPI tiles and pure SVG charts from returned arrays.",
            "If any fetch fails, statsApi returns empty arrays so the page remains usable.",
            "Edge cases: stats API default base URL is 2020 while other APIs default to 9000; chart labels are generated from array length and not actual row dates.",
        ],
    ),
]


def build_markdown() -> str:
    lines: list[str] = []
    add = lines.append

    add("# MyRA Personal AI Assistant - Master Interview Preparation Document")
    add("")
    add("Generated on: 2026-07-08")
    add("")
    add("Project root: `/Users/cherry/projects/personal-ai-assistant`")
    add("")
    add("This document is based on the actual repository files inspected in this project. It focuses heavily on the backend, RAG, agents, APIs, architecture, database design, and interview explanations. The frontend is also covered so you can explain the complete product flow.")
    add("")
    add("## Table of Contents")
    for title in [
        "A. Project Overview",
        "B. Complete Project Architecture",
        "C. Backend Deep Explanation",
        "D. Database and Data Model",
        "E. RAG System Detailed Explanation",
        "F. Agentic AI Flow Detailed Explanation",
        "G. LangChain, LangGraph, and AI Libraries",
        "H. Frontend Explanation",
        "I. Complete Feature-by-Feature Flow",
        "J. Tech Stack and Tools",
        "K. Design Decisions",
        "L. Bugs, Gaps, and Production Improvements",
        "M. Interview Question Bank",
        "N. File-by-File Revision Map",
    ]:
        add(f"- {title}")
    add("")

    add("## A. Project Overview")
    add("")
    add("### What this project does")
    add("")
    add("MyRA is a personal AI assistant that connects to a user's Google account, syncs personal Gmail and Google Calendar data, stores that data as searchable documents, creates embeddings, and answers questions using RAG. It also has agentic workflows for creating calendar events and safely drafting/sending emails.")
    add("")
    add("The project has two main applications:")
    add("")
    add("- Backend: `backend`, an Express 5 Node.js service with PostgreSQL, pgvector-style vector search, Google OAuth, Gmail/Calendar integrations, RAG services, LangChain model calls, and LangGraph agents.")
    add("- Frontend: `frontend`, a Vite React app with Zustand stores, a custom SPA router in `App.jsx`, chat UI, auth callback handling, profile/data sync UI, stats dashboard, and settings/profile screens.")
    add("")
    add("### Main problem it solves")
    add("")
    add("The problem is that personal information is spread across inboxes and calendars. A user may know that something exists in their email or calendar but not remember where. MyRA lets the user ask natural-language questions like: What did Rahul send me last week? What meetings do I have today? Draft an email to Priya about the review. Schedule a meeting tomorrow at 3 PM.")
    add("")
    add("### Users")
    add("")
    add("The expected user is a person who wants a private assistant over personal productivity data. In interview terms, the user is a knowledge worker who spends time in Gmail and Calendar and wants retrieval, summarization, drafting, and scheduling from one chat interface.")
    add("")
    add("### Major features")
    add("")
    for item in [
        "Google OAuth login and account connection.",
        "Encrypted storage of Gmail and Google Calendar access/refresh tokens.",
        "Gmail sync into a unified documents table.",
        "Google Calendar sync into the same unified documents table.",
        "RAG over synced personal data using chunking, embeddings, vector search, context building, prompt construction, and LLM response generation.",
        "Conversation memory stored in PostgreSQL.",
        "Intent routing between general chat, RAG, calendar agent, and email agent.",
        "Calendar creation agent with missing-field collection, conflict checking, alternative-slot suggestion, and confirmation before event creation.",
        "Email drafting agent with recipient resolution, draft approval/edit loop, and a revoke window before sending.",
        "Stats dashboard for emails, tokens, cost, chat sessions, and calendar events.",
        "Socket.IO support for sync progress updates.",
        "Profile page for display name, Gmail/Calendar sync, and sync history.",
    ]:
        add(f"- {item}")
    add("")
    add("### How the parts work together")
    add("")
    add("The frontend calls REST APIs in the backend. The backend authenticates the user through Google OAuth and stores Google tokens in `api_credentials`. When the user starts a sync, the backend fetches Gmail or Calendar items through Google APIs, normalizes them, stores them in `documents`, then creates chunks and embeddings in `document_chunks`. When the user asks a question, the backend classifies intent. For personal-data questions, it embeds the query, retrieves relevant chunks, builds context, sends that context to an LLM, saves the conversation, and returns an answer with sources. For action requests, the backend runs a LangGraph agent that asks for confirmation before changing external state.")
    add("")
    add("### One-minute interview answer")
    add("")
    add("My project is MyRA, a personal AI assistant for Gmail and Google Calendar. The backend is an Express and PostgreSQL system. Users sign in with Google OAuth, and I store encrypted OAuth tokens so the backend can sync Gmail and Calendar data. I normalize emails and events into a common documents table, split them into chunks, generate embeddings, and store chunk vectors for semantic retrieval. When the user asks a question, the chat endpoint routes the message using an intent classifier. Personal-data questions go through my RAG pipeline: embed query, vector search, build context, prompt the LLM, save the conversation, and return sources. I also built agentic flows with LangGraph: one calendar agent that collects event details, checks conflicts, asks for confirmation, and creates events, and one email agent that drafts an email, lets the user review or edit it, and gives a short revoke window before sending through Gmail.")
    add("")
    add("### Three-minute detailed interview answer")
    add("")
    add("MyRA is a full-stack personal AI assistant. The frontend is a Vite React app with Zustand state stores for auth, chat, and sync. The backend is more important: it is an Express 5 app with route/controller/service/repository layers. Google OAuth is used for authentication and authorization. After OAuth callback, the backend creates or updates the user row, encrypts Google tokens using AES-256-CBC in `GoogleAuthService`, stores credentials for both Gmail and Calendar, then issues a JWT for the frontend.")
    add("")
    add("For RAG, I built an ingestion pipeline and a query pipeline. Ingestion pulls Gmail messages and Calendar events using Google APIs. Normalizers convert source-specific API data into a unified document shape: source, type, content, title, timestamp, author, and metadata. Documents are stored in PostgreSQL. Pending documents are split using LangChain's `RecursiveCharacterTextSplitter` with chunk size 2700 and overlap 400. The chunks are embedded using OpenAI embeddings and inserted into `document_chunks` with pgvector-compatible vectors.")
    add("")
    add("For querying, the chat API first classifies intent. If it is a personal-data query, the RAG pipeline embeds the query, searches `document_chunks` scoped by user id, filters results by vector distance, builds a source-numbered context block, adds conversation history, calls the selected chat model, saves the conversation, and returns both answer and source documents. For general questions it skips RAG and calls the LLM directly.")
    add("")
    add("I also implemented agentic flows using LangGraph. The calendar agent extracts event details, asks for missing fields, checks Google Calendar conflicts, suggests free slots, asks for confirmation, then creates the event. The email agent uses LangGraph interrupts to pause for human choices: selecting a recipient, approving or editing a draft, and revoking a pending send. This is important because actions like sending email and creating events need human confirmation and safety checks.")
    add("")

    add("## B. Complete Project Architecture")
    add("")
    add("### High-level architecture")
    add("")
    add("```text")
    add("React/Vite frontend")
    add("  -> REST fetch calls to Express backend")
    add("  -> Socket.IO sync progress listeners on ProfilePage")
    add("")
    add("Express backend")
    add("  -> Auth routes and Google OAuth")
    add("  -> Chat routes")
    add("      -> intent router")
    add("      -> general LLM")
    add("      -> RAG pipeline")
    add("      -> calendar LangGraph agent")
    add("      -> email LangGraph agent")
    add("  -> Sync routes")
    add("      -> Gmail/Calendar data sources")
    add("      -> normalizers")
    add("      -> document repository")
    add("      -> embedding pipeline")
    add("  -> Stats routes")
    add("      -> aggregation queries")
    add("")
    add("PostgreSQL")
    add("  -> users")
    add("  -> api_credentials")
    add("  -> documents")
    add("  -> document_chunks")
    add("  -> conversations")
    add("  -> sync_logs")
    add("  -> llm_usage_logs")
    add("  -> embedding_costs")
    add("  -> recipients")
    add("```")
    add("")
    add("### Folder structure explanation")
    add("")
    add("Important backend folders:")
    add("")
    add("- `backend/index.js`: process entrypoint. Loads env, connects to DB, starts Express, attaches Socket.IO, and handles SIGTERM/SIGINT shutdown.")
    add("- `backend/src/app.js`: Express app setup, CORS, body parsing, static files, route mounting.")
    add("- `backend/src/api/routes`: route definitions for auth, chat, sync, stats, and an unmounted calendar-agent route.")
    add("- `backend/src/api/controllers`: controller classes/functions that validate requests, call services, and shape responses.")
    add("- `backend/src/database`: repository classes for PostgreSQL access.")
    add("- `backend/src/RAG`: RAG ingestion, retrieval, context, prompt, memory, LLM, and top-level RAG service.")
    add("- `backend/src/agent`: intent router and LangGraph agent implementations.")
    add("- `backend/src/service`: Google data sources, normalizers, OAuth, email sending, WebSocket, cron, and alert services.")
    add("- `backend/src/utils`: logger, validation, token utilities, mailer, constants, exchange-rate helper, and email templates.")
    add("- `backend/test`: ad-hoc smoke tests, not a full automated test suite.")
    add("")
    add("Important frontend folders:")
    add("")
    add("- `frontend/src/App.jsx`: custom SPA routing, theme handling, auth check, layout selection.")
    add("- `frontend/src/api`: REST clients for auth, chat, sync, stats, home, and user profile updates.")
    add("- `frontend/src/store`: Zustand stores for auth, chat, and sync.")
    add("- `frontend/src/pages`: login, auth callback, home, chat, profile, stats, settings.")
    add("- `frontend/src/components/chat`: chat window, assistant/user messages, typing indicator, placeholder ChatInput.")
    add("- `frontend/src/components/layout/Sidebar.jsx`: chat history, navigation, profile menu, and calendar sync button.")
    add("- `frontend/src/service/socketService.js`: Socket.IO client wrapper used by ProfilePage.")
    add("")
    add("### Backend architecture")
    add("")
    add("The backend follows a practical layered architecture:")
    add("")
    add("- Routes define HTTP paths and attach middleware.")
    add("- Controllers own request/response behavior.")
    add("- Services own external integrations and business pipelines.")
    add("- Repositories own SQL queries.")
    add("- RAG and agents are separated into their own modules because they are complex workflows.")
    add("")
    add("This structure is acceptable for a junior-to-mid project because it avoids putting all logic inside route handlers. It also keeps the interview story clean: routes -> controllers -> services -> repositories.")
    add("")
    add("### Frontend architecture")
    add("")
    add("The frontend is a single-page React app but does not use React Router. Instead, `App.jsx` maps URL paths to page ids using `PATH_TO_PAGE` and `PAGE_TO_PATH`, listens to `popstate`, and updates browser history manually. State is kept in Zustand stores. API clients are plain fetch wrappers. The UI is custom CSS with some Tailwind installed but not used as the main styling system.")
    add("")
    add("### Database architecture")
    add("")
    add("The code expects PostgreSQL. Vector operations use the pgvector `<=>` distance operator. There are no migrations in the repo, so table structure must be inferred from SQL. Main tables are users, api_credentials, documents, document_chunks, conversations, sync_logs, llm_usage_logs, embedding_costs, recipients, and optionally agent_checkpoints.")
    add("")
    add("### AI/RAG architecture")
    add("")
    add("RAG has two halves:")
    add("")
    add("- Ingestion: Google API raw items -> normalizer -> documents -> chunker -> embeddings -> document_chunks.")
    add("- Query: user query -> intent classifier -> query embedding -> vector search -> context builder -> prompt builder -> LLM -> saved conversation -> frontend response.")
    add("")
    add("### Agent architecture")
    add("")
    add("There are two LangGraph agents:")
    add("")
    add("- Calendar agent in `backend/src/agent/calenderAgent`: state graph with nodes for parsing, asking missing info, checking conflicts, suggesting slots, awaiting confirmation, and creating events.")
    add("- Email agent in `backend/src/agent/emailAgent`: state graph with interrupts for recipient selection, draft approval/editing, and pending-send revoke.")
    add("")
    add("The calendar folder is spelled `calenderAgent` in the repo. The standalone route path is also spelled `/agent/calender`.")
    add("")
    add("### External integrations")
    add("")
    add("- Google OAuth: login and offline access.")
    add("- Gmail API: reading synced messages and sending emails.")
    add("- Google Calendar API: reading events, checking free/busy, creating events.")
    add("- OpenAI: embeddings, chat, intent routing, and email draft structured output depending on env config.")
    add("- Anthropic: calendar-agent extraction and optional chat provider.")
    add("- Frankfurter exchange-rate API: converts USD model pricing to INR in `usdToInr`.")
    add("- SMTP/Nodemailer: sends cost-alert emails.")
    add("- Socket.IO: emits sync progress to the browser.")
    add("")
    add("### Request lifecycle")
    add("")
    add("A typical RAG request lifecycle:")
    add("")
    add("1. User sends a message from `ChatWindow.jsx`.")
    add("2. `useChatStore.sendMessage` appends the user message and calls `chatApi.sendMessage`.")
    add("3. `POST /chat/message` runs optional JWT auth.")
    add("4. `ChatController.sendMessage` validates the message and resolves the handler.")
    add("5. `routeIntent` calls `LLMService.generateResponse` to classify the message.")
    add("6. For `rag`, `RagChain.chat` calls `QueryPipeline.run`.")
    add("7. `Retriever` embeds the query and searches `document_chunks` by vector distance.")
    add("8. `buildContext` creates source-numbered context.")
    add("9. `MemoryService` loads conversation history.")
    add("10. `buildPrompt` creates model messages.")
    add("11. `LLMService` calls OpenAI or Anthropic and logs token/cost usage.")
    add("12. `MemoryService.saveConversation` inserts into `conversations`.")
    add("13. Controller returns answer and sources.")
    add("14. Zustand store appends the assistant message.")
    add("")
    add("### Why this architecture is used")
    add("")
    add("This architecture is good for this project because it separates source ingestion from query-time RAG, separates RAG from action-taking agents, and keeps external API logic outside controllers. It is also easy to explain: sync builds the knowledge base; chat queries the knowledge base; agents perform actions with confirmation.")
    add("")
    add("### Alternative architectures")
    add("")
    add("- Use Next.js full-stack instead of separate frontend/backend. Simpler deployment, but less explicit backend separation.")
    add("- Use a managed vector database such as Pinecone, Weaviate, or Qdrant. Easier vector operations at scale, but more infrastructure and cost.")
    add("- Use Redis queues or BullMQ for background sync. More reliable than fire-and-forget promises, but more setup.")
    add("- Use Prisma migrations and ORM. More maintainable schema evolution, but raw SQL currently gives direct control.")
    add("- Use server-side sessions instead of JWT in localStorage. More secure for browser apps, but requires session store and cookie strategy.")
    add("- Use a single agent for all tasks. More flexible, but harder to control and harder to prove safe for email/calendar side effects.")
    add("")
    add("### Why the current approach is acceptable")
    add("")
    add("For an interview project, the current approach is acceptable because it demonstrates backend fundamentals, OAuth, database repositories, vector retrieval, LLM orchestration, and agent safety flows. The production gaps are mostly around auth hardening, migrations, background job durability, persistent LangGraph checkpoints, and route cleanup.")
    add("")

    add("## C. Backend Deep Explanation")
    add("")
    add("### Backend framework used")
    add("")
    add("The backend uses Express 5.2.1 with ES modules. The package is `myra-server` in `backend/package.json`. Development uses `tsx watch index.js`, and TypeScript compilation is configured with `allowJs: true` and `checkJs: false` in `backend/tsconfig.json`.")
    add("")
    add("### Why Express was chosen")
    add("")
    add("Express is lightweight and flexible. It is a good fit because this project needs custom workflows rather than a rigid MVC framework. Express lets the code mount route modules for auth, sync, chat, and stats while keeping complex logic in separate services.")
    add("")
    add("### Server startup")
    add("")
    add("`backend/index.js` does the following:")
    add("")
    add("- Imports `./src/config/env.js`, which currently only imports `dotenv/config`.")
    add("- Imports `logger`, `socketServer`, `app`, and `connectToDB`.")
    add("- Resolves `PORT` from `process.env.PORT || 2020`.")
    add("- Calls `connectToDB()` before listening.")
    add("- Starts Express and attaches Socket.IO with `socketServer.initialize(server)`.")
    add("- Handles SIGTERM and SIGINT by closing the HTTP server.")
    add("")
    add("### Express app setup")
    add("")
    add("`backend/src/app.js` configures:")
    add("")
    add("- JSON body parsing with a small `16kb` limit.")
    add("- URL encoded body parsing.")
    add("- Static file serving from `public`.")
    add("- CORS origins from `CORS_ORIGIN`, `FRONTEND_URL`, or default `http://localhost:5173`.")
    add("- Credentials allowed.")
    add("- Methods GET, POST, PUT, DELETE, PATCH.")
    add("- Routes mounted at `/auth`, `/sync`, `/chat`, and `/stats`.")
    add("")
    add("Important: `backend/src/api/routes/agent.js` exists but is not mounted in `app.js`.")
    add("")
    add("### Configuration and environment variables")
    add("")
    add("Main environment variables used by code:")
    add("")
    for env in [
        "PORT: backend port, default 2020 in index.js.",
        "FRONTEND_URL or CORS_ORIGIN: allowed browser origin and OAuth redirect target.",
        "DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD: required by environment.js and dbConfig.ts.",
        "DB_SSL, DB_MAX_CONNECTIONS: included in config object but dbConfig.ts does not use DB_SSL.",
        "JWT_SECRET: signs and verifies app JWTs.",
        "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI: Google OAuth.",
        "TOKEN_ENCRYPTION_KEY: hex key used for AES-256-CBC token encryption. The first 64 hex chars are used.",
        "OPENAI_API_KEY, OPENAI_CHAT_MODEL, OPENAI_MODEL_TEMP, OPENAI_MAX_TOKENS, OPENAI_EMBEDDING_MODEL, EMBEDDING_DIMENSIONS, OPENAI_LIGHT_MODEL.",
        "ANTHROPIC_API_KEY, ANTHROPIC_CHAT_MODEL, ANTHROPIC_MODEL_TEMP, ANTHROPIC_MAX_TOKENS.",
        "SYNC_USER_ID: fallback user id when auth is optional or absent.",
        "MAIL_USER, MAIL_APP_PASSWORD, MAIL_SMTP_HOST, MAIL_SMTP_PORT, MAIL_FROM_NAME, MAIL_FROM_ADDRESS, MAIL_ALERT_RECIPIENT.",
        "ANTHROPIC_MONTHLY_BUDGET, GOOGLE_MONTHLY_BUDGET, CREDS_ALERT_CRON_SCHEDULE, ENABLE_CREDS_ALERT_CRON.",
    ]:
        add(f"- {env}")
    add("")
    add("`backend/src/config/environment.js` validates DB env vars at module load and exits the process if they are missing. `backend/src/config/dbConfig.ts` lazily creates the pg Pool in `getPool()` so dotenv has time to load before the pool is created.")
    add("")
    add("### Database connection")
    add("")
    add("`connectToDB` calls `getPool().connect()`, logs success, and releases the client. The pool has `connectionTimeoutMillis: 5000` and `max: 10`. The repository files often import `pool` directly. Because ES module imports are live bindings, after `getPool()` assigns the pool the repositories can use it, but this pattern is fragile if code tries to query before DB connection.")
    add("")
    add("### Routes and controllers")
    add("")
    add("The route modules are:")
    add("")
    add("- `authRoutes.js`: Google login, callback, current user, update display name, logout.")
    add("- `chat.js`: chat message, planned stream message, conversation id, conversation list, history, email status.")
    add("- `syncRoutes.js`: Gmail sync, Calendar sync, sync status, sync history.")
    add("- `stats.js`: all stats.")
    add("- `agent.js`: standalone calendar-agent route, currently not mounted.")
    add("")
    add("### Authentication and authorization")
    add("")
    add("Authentication is inconsistent:")
    add("")
    add("- Auth-specific routes manually validate JWTs in `AuthController.getCurrentUser` and `updateUserName`.")
    add("- Chat and stats use local `optionalAuth` middleware. If a valid token exists, `req.user` is set. If missing, the code falls back to `SYNC_USER_ID`. In chat, an invalid token returns 401. In stats, an invalid token is ignored.")
    add("- Sync routes have no auth middleware, even though syncing reads personal data and uses userId from the request body.")
    add("")
    add("Interview answer: This is okay for a prototype, but production should require authentication on all personal-data routes, derive userId from the JWT instead of the body, and remove `SYNC_USER_ID` fallback outside local development.")
    add("")
    add("### Error handling")
    add("")
    add("Error handling is local to controllers and services. There is no global Express error middleware in `app.js`. Controllers generally return JSON 400/401/404/500. Some auth errors redirect to frontend login. Background sync errors are logged, written to sync_logs, and emitted by WebSocket.")
    add("")
    add("### Validation")
    add("")
    add("Validation exists but is manual:")
    add("")
    add("- Chat validates that `message` is a non-empty string.")
    add("- Auth update validates non-empty `userName`.")
    add("- Sync validates `userId` presence.")
    add("- Repository helpers validate some numeric inputs.")
    add("- `utils/validation.js` validates unified documents and source metadata, but current ingestion normalizers mostly bypass `schemas/index.js` and call `DocumentRepository.create` directly.")
    add("- Email agent uses Zod structured output schemas for parsing requests and drafts.")
    add("")
    add("There are no centralized DTO schemas for API request bodies. Adding Zod route schemas would make the backend safer.")
    add("")
    add("### Logging")
    add("")
    add("`backend/src/utils/logger.ts` defines a simple logger with ERROR, WARN, INFO, and DEBUG levels. It writes colored logs to console. It also has sync-specific helper methods. Several files import `logger.js` even though the source file currently exists as `logger.ts` in the dirty worktree. TypeScript/tsx may resolve this during development, but plain Node over source JS would not.")
    add("")
    add("### WebSocket service")
    add("")
    add("`backend/src/service/websocket/sockeService.js` creates a Socket.IO server. It stores connected clients in memory, accepts an `identify` event, and emits events like `sync:gmail:progress`, `sync:gmail:complete`, `sync:google_calendar:error`, `rag:progress`, and system health events. In current active code, sync progress is the main WebSocket usage. The RAG progress emitters exist but QueryPipeline does not call them.")
    add("")
    add("### Background jobs and cron")
    add("")
    add("`CredsAlertCronJob` checks monthly LLM usage and sends alert emails when usage crosses 50, 75, or 90 percent of configured budgets. It uses `StatsRepository.getLLMCredsUsage` and `CredsAlertService.checkAndAlert`. Alerts are deduplicated in an in-memory Map.")
    add("")
    add("`CronManager` is incomplete: it only creates `credsAlert`, but `startAll`, `stopAll`, and `getAllStatus` also reference `embedding`, `gmailSync`, and `calendarSync`, which are not defined. Also, `index.js` does not start CronManager.")
    add("")
    add("### File upload handling")
    add("")
    add("There is no active file upload handling. The chat composer shows an attach icon, but no upload API exists.")
    add("")
    add("### Complete backend API documentation")
    add("")
    for api in API_DOCS:
        add(f"#### {api['method']} {api['path']} - {api['name']}")
        add("")
        add(f"- Purpose: {api['purpose']}")
        add(f"- Request params/body: {api['request']}")
        add(f"- Response body: {api['response']}")
        add(f"- Error cases: {api['errors']}")
        add(f"- Authentication: {api['auth']}")
        add(f"- Controller/function: {api['handler']}")
        add(f"- Services/business logic: {api['services']}")
        add(f"- Database tables/collections: {api['tables']}")
        add(f"- Example request: `{api['example_request']}`")
        add(f"- Example response: `{api['example_response']}`")
        add(f"- Interview explanation: {api['interview']}")
        add("")

    add("## D. Database and Data Model")
    add("")
    add("### Database used")
    add("")
    add("The backend uses PostgreSQL through the `pg` package. Vector search uses the pgvector operator `<=>`, so the database needs the pgvector extension and vector columns.")
    add("")
    add("### Why PostgreSQL is a good choice here")
    add("")
    add("PostgreSQL is acceptable because the project needs relational data such as users, credentials, documents, conversations, sync logs, and usage logs. With pgvector, the same database can store vector embeddings and run similarity search. For a personal assistant prototype, that keeps the architecture simpler than combining Postgres plus a separate vector database.")
    add("")
    add("### Missing migrations")
    add("")
    add("There are no migration files in this repo. This is a major setup gap. The table design below is inferred from repository SQL and service code. In production, you should add migrations using Prisma, Drizzle, Knex, node-pg-migrate, or raw SQL migration files.")
    add("")
    add("### Inferred tables")
    add("")
    add("#### users")
    add("")
    add("Used by `UserRepository`. Important fields:")
    add("")
    for field in [
        "id: internal user id.",
        "google_id: Google profile id.",
        "email: Google account email.",
        "name: Google profile name.",
        "user_name: app-level display name that can be edited independently.",
        "picture: Google profile picture URL.",
        "email_verified, locale, preferences, status.",
        "last_login_at, login_count, created_at, updated_at.",
    ]:
        add(f"- {field}")
    add("")
    add("Relationships: users.id is referenced by documents.user_id, conversations.user_id, sync_logs.user_id, api_credentials.user_id, llm_usage_logs.user_id, and recipients.user_id.")
    add("")
    add("#### api_credentials")
    add("")
    add("Used by `CredentialRepository` and `GoogleAuthService`. Important fields:")
    add("")
    for field in [
        "id: credential row id.",
        "user_id: owner.",
        "source: gmail or google_calendar.",
        "access_token: encrypted token.",
        "refresh_token: encrypted refresh token.",
        "token_expires_at: expiry timestamp.",
        "scope or scopes: scopes from Google.",
        "created_at, updated_at.",
    ]:
        add(f"- {field}")
    add("")
    add("There is inconsistency in the repository: older methods use `scope` and conflict on `(source)`, while OAuth storage uses `scopes` and conflict on `(user_id, source)`. The current OAuth path uses `storeOAuthTokens`, so the schema should support `scopes` and a unique `(user_id, source)` index.")
    add("")
    add("#### documents")
    add("")
    add("Used by `DocumentRepository`, `EmbeddingRepository`, stats queries, and ingestion. Important fields:")
    add("")
    for field in [
        "id: internal DB id.",
        "user_id: owner.",
        "document_id: external unique id such as gmail_<messageId> or calendar_<eventId>.",
        "source: gmail or calendar.",
        "type: email or event.",
        "content: normalized full text.",
        "title: subject or event summary.",
        "timestamp: source occurrence time.",
        "author: email sender or calendar organizer.",
        "metadata: JSONB source metadata.",
        "needs_embedding: boolean used by EmbeddingPipeline.",
        "embedding, embedding_generated_at, embedding_tokens, embedding_model: older document-level embedding support still present in EmbeddingRepository.",
        "created_at, updated_at.",
    ]:
        add(f"- {field}")
    add("")
    add("Current active RAG stores chunk embeddings in `document_chunks`, but some repository code still supports document-level embeddings. This is a design transition to mention honestly.")
    add("")
    add("#### document_chunks")
    add("")
    add("Used by `ChunkRepository`. Important fields:")
    add("")
    for field in [
        "id: chunk id.",
        "document_id: foreign key to documents.id.",
        "content: chunk text.",
        "chunk_index: original chunk position.",
        "embedding: vector.",
        "source_type: gmail or calendar.",
        "occurred_at: used in search filters, but insertChunks currently does not set it.",
    ]:
        add(f"- {field}")
    add("")
    add("Important index: create an ANN/vector index on embedding, for example IVFFlat or HNSW depending on pgvector version. Also index document_id and source_type.")
    add("")
    add("#### conversations")
    add("")
    add("Used by `ConversationRepository` and `MemoryService`. Important fields:")
    add("")
    for field in [
        "conversation_id: UUID string shared by multiple turns.",
        "user_id: owner.",
        "user_message: raw user text.",
        "assistant_message: assistant text or JSON string for structured email-agent interrupts.",
        "metadata: JSON string/JSONB with mode, source count, durations, etc.",
        "is_deleted: soft delete flag.",
        "created_at.",
    ]:
        add(f"- {field}")
    add("")
    add("Design note: each row stores one user+assistant pair. This is simple but less flexible than storing each message as a separate row with role and content.")
    add("")
    add("#### sync_logs")
    add("")
    add("Used by `SyncLogRepository` and sync controller. Important fields: id, source, status, user_id, sync_started_at, sync_completed_at, documents_fetched, documents_stored, last_sync_timestamp, error_message.")
    add("")
    add("#### llm_usage_logs")
    add("")
    add("Used by `StatsRepository.insertLLMPrice`. Important fields: conversation_id, provider, model, input_tokens, output_tokens, input_cost, output_cost, invocation_type, user_id, created_at.")
    add("")
    add("#### embedding_costs")
    add("")
    add("Used by `EmbeddingRepository.logEmbeddingCost` and stats. Important fields: batch_id, model, document_count, total_tokens, estimated_cost, status, processed_at. Current active `EmbeddingPipeline` does not call `logEmbeddingCost`, so embedding-cost stats may remain empty.")
    add("")
    add("#### recipients")
    add("")
    add("Used by `RecipientRepository.getRelavantRecipient` for email agent recipient resolution. Important fields: id, user_id, email, name, given_name, family_name, source, interaction_count, last_interaction_at, is_favorite. It uses PostgreSQL trigram functions `similarity` and `%`, so pg_trgm extension is required.")
    add("")
    add("#### agent_checkpoints")
    add("")
    add("A PostgresCheckpointer file contains SQL comments for `agent_checkpoints`, but active graphs use `MemorySaver`, not this table. If productionizing agents, use a persistent checkpointer.")
    add("")
    add("### Schema design decisions")
    add("")
    add("- Unified documents let Gmail and Calendar share one ingestion and RAG pipeline.")
    add("- JSON metadata keeps source-specific fields without needing separate email/event tables.")
    add("- Separate chunks table supports multiple embeddings per document and better retrieval than one vector per whole document.")
    add("- conversations rows are simple and easy to retrieve, but message-per-row would be more scalable.")
    add("- sync_logs make async work observable.")
    add("- llm_usage_logs supports cost tracking and dashboards.")
    add("")
    add("### What can be improved")
    add("")
    for item in [
        "Add migrations and seed/setup docs.",
        "Enforce foreign keys and unique indexes, especially `(user_id, document_id)` and `(user_id, source)`.",
        "Use consistent credential field names: choose `scopes` or `scope`, not both.",
        "Populate `document_chunks.occurred_at` during insert so date filters work.",
        "Persist LangGraph checkpoints.",
        "Add row-level ownership checks to all personal-data endpoints.",
        "Create a separate `messages` table or JSON transcript for richer chat history.",
        "Track embedding usage from the active chunk embedding path.",
    ]:
        add(f"- {item}")
    add("")

    add("## E. RAG System Detailed Explanation")
    add("")
    add("### What RAG means in this project")
    add("")
    add("RAG means Retrieval-Augmented Generation. In this project, the LLM does not answer personal questions from memory alone. The backend first retrieves relevant chunks from the user's synced Gmail and Calendar data, then gives those chunks to the LLM as context. The LLM answers based on that context.")
    add("")
    add("### Why RAG is needed")
    add("")
    add("The user's personal emails and calendar events are private, recent, and not present in the base model's training data. RAG allows the assistant to answer questions about that private data without fine-tuning a model. It also helps reduce hallucination because the prompt tells the model to answer only from retrieved context.")
    add("")
    add("### Complete ingestion pipeline")
    add("")
    add("Files involved:")
    add("")
    for path in [
        "backend/src/api/controllers/syncController.js",
        "backend/src/RAG/ingestion/ingestionPipeline.js",
        "backend/src/service/sources/GmailDataSource.js",
        "backend/src/service/sources/GoogleCalendarDataSource.js",
        "backend/src/service/normalizers/GmailNormalizer.js",
        "backend/src/service/normalizers/GoogleCalendarNormalizer.js",
        "backend/src/database/documentRepository.js",
        "backend/src/RAG/ingestion/embeddingPipeline.js",
        "backend/src/RAG/ingestion/chunker.js",
        "backend/src/RAG/ingestion/embeddingsProvider.js",
        "backend/src/database/chunkRepository.js",
    ]:
        add(f"- `{path}`")
    add("")
    add("Step-by-step:")
    add("")
    add("1. User starts sync through `/sync/gmail` or `/sync/calendar`.")
    add("2. SyncController creates a sync log and returns immediately.")
    add("3. `performDocumentsSync` runs in the background.")
    add("4. `IngestionPipeline.runIngestion` selects source and normalizer from the `SOURCES` map.")
    add("5. For full sync, it fetches up to 500 records. For incremental sync, it uses last successful sync time, or last 7 days if none exists.")
    add("6. Gmail fetch uses Gmail query `after:YYYY/MM/DD`; Calendar fetch uses `timeMin`.")
    add("7. Normalizers create unified document objects.")
    add("8. Existing documents are skipped by `findByDocumentId(doc.documentId, userId)`.")
    add("9. New documents are inserted into `documents` with `needs_embedding` expected to be true by DB default.")
    add("10. EmbeddingPipeline finds pending documents for the user.")
    add("11. Each document is chunked with `RecursiveCharacterTextSplitter`.")
    add("12. Each chunk is embedded using OpenAI embeddings.")
    add("13. Chunk rows are inserted into `document_chunks`.")
    add("14. The document is marked as not needing embedding.")
    add("")
    add("### Document upload flow")
    add("")
    add("There is no user document upload feature yet. In this codebase, ingestion comes from external APIs: Gmail and Google Calendar. The frontend has an attach icon in the composer, but no upload route or file parser exists.")
    add("")
    add("### Text extraction flow")
    add("")
    add("Gmail extraction:")
    add("")
    add("- `GmailNormalizer.extractHeaders` extracts From, To, Subject, and Date.")
    add("- `extractContent` handles text/plain, text/html, and multipart payloads.")
    add("- HTML is converted to plain text by regex stripping scripts/styles/tags and decoding common HTML entities.")
    add("- `cleanContent` collapses excessive newlines, removes signature-like trailing content, and truncates above 32000 chars.")
    add("")
    add("Calendar extraction:")
    add("")
    add("- `GoogleCalendarNormalizer` skips cancelled events.")
    add("- It handles all-day events and dateTime events.")
    add("- It extracts summary, start, end, location, description, attendees, organizer, recurrence, html_link, and conference data.")
    add("- `buildContent` creates a plain-text block designed for embeddings.")
    add("")
    add("### Chunking strategy")
    add("")
    add("`backend/src/RAG/ingestion/chunker.js` uses `RecursiveCharacterTextSplitter` with:")
    add("")
    add("- chunkSize: 2700 characters.")
    add("- chunkOverlap: 400 characters.")
    add("")
    add("This means each chunk is big enough to contain meaningful context, while overlap reduces the chance that important meaning is split across chunk boundaries. For emails and calendar events, this is reasonable because many items are short but long email threads can still be split.")
    add("")
    add("### Embedding generation")
    add("")
    add("`Embedding` in `embeddingsProvider.js` uses `OpenAIEmbeddings` with:")
    add("")
    add("- model from `OPENAI_EMBEDDING_MODEL` or default `text-embedding-3-small`.")
    add("- API key from `OPENAI_API_KEY`.")
    add("- dimensions from `EMBEDDING_DIMENSIONS` or default 1536.")
    add("")
    add("`embedChunks` sends chunk contents to `embedDocuments` and attaches vectors back to chunk objects. `embedQuery` embeds one user query for retrieval.")
    add("")
    add("### Vector storage")
    add("")
    add("Chunk vectors are inserted into `document_chunks.embedding` as pgvector-compatible strings like `[0.1,0.2,...]::vector`. Retrieval uses PostgreSQL vector distance:")
    add("")
    add("```sql")
    add("ORDER BY c.embedding <=> $1::vector")
    add("```")
    add("")
    add("`ChunkRepository.searchByEmbedding` joins chunks to documents and scopes search by `d.user_id = $2`, which is important for privacy.")
    add("")
    add("### Metadata stored with chunks")
    add("")
    add("The chunk row stores content, chunk_index, embedding, source_type, and maybe occurred_at. Source metadata is read through the joined document row: document id, external source id, author, and metadata JSON. The metadata contains Gmail message id/thread id/subject/from/to/date, or Calendar event id/start/end/attendees/organizer/location/etc.")
    add("")
    add("### Retrieval flow")
    add("")
    add("`Retriever.retrieve` does:")
    add("")
    add("1. Validate query and userId.")
    add("2. Embed query with OpenAI embeddings.")
    add("3. Search chunks for that user by vector distance.")
    add("4. Return empty list if no chunks are found.")
    add("5. Filter chunks with `distance <= 0.6`.")
    add("6. Return filtered chunks.")
    add("")
    add("The hard threshold is a simple relevance control. It should be tuned with real evaluation data.")
    add("")
    add("### Context creation")
    add("")
    add("`buildContext` in `contextBuilder.js` formats each chunk as a numbered source:")
    add("")
    add("```text")
    add("[Source 1] gmail 2026-05-01 from sender@example.com - Subject")
    add("<chunk content>")
    add("```")
    add("")
    add("It approximates token budget as 4 characters per token and uses a default max of 4000 tokens. It always includes at least one block if chunks exist.")
    add("")
    add("### Prompt creation")
    add("")
    add("`prompts.js` has a system prompt that says the assistant has access to the user's personal data, should answer using context, cite sources, ask clarifying questions when ambiguous, and avoid hallucination when no context exists. `buildPrompt` creates messages:")
    add("")
    add("- System prompt.")
    add("- Prior conversation history.")
    add("- User message containing retrieved context plus the question.")
    add("")
    add("### LLM call")
    add("")
    add("`LLMService.generateResponse` supports two providers: `OpenAI` and `Anthropic`. It creates `ChatOpenAI` and `ChatAnthropic` clients from env vars. It invokes the selected model, reads `llmResponse.content`, stores the model name, duration, token counts if `usage_metadata` exists, and logs estimated costs into `llm_usage_logs`.")
    add("")
    add("### Final answer generation")
    add("")
    add("`QueryPipeline.run` returns `{ answer, sources, conversationId, model }`. `RagChain.chat` wraps this into an API-friendly response with `sourcedDocuments` containing chunk content, document id, source type, and metadata.")
    add("")
    add("### Error cases")
    add("")
    for item in [
        "Missing userId throws in RagChain.",
        "Missing conversationId throws in QueryPipeline.",
        "Invalid llmProvider throws in LLMService.",
        "No chunks returns no-context prompt rather than a crash.",
        "Embedding provider failure fails retrieval.",
        "Database vector extension missing will fail search.",
        "Embedding dimension mismatch between stored vectors and query vectors will fail.",
        "Stats logging failure is caught and logged without failing the answer.",
    ]:
        add(f"- {item}")
    add("")
    add("### How hallucination is reduced")
    add("")
    add("- The system prompt tells the model to answer from context and say when context is missing.")
    add("- Retrieved context is source-numbered.")
    add("- The answer should cite sources.")
    add("- Vector retrieval is user-scoped.")
    add("- Distance filtering removes weak matches.")
    add("")
    add("This reduces hallucination but does not eliminate it. Stronger improvements would include answer-grounding checks, source citation validation, hybrid search, reranking, and tests with expected answers.")
    add("")
    add("### Why RAG instead of fine-tuning")
    add("")
    add("Fine-tuning is not a good fit for constantly changing private Gmail and Calendar data. It would be expensive, slow to update, and risky for privacy. RAG keeps data in the database, updates quickly after sync, and can cite retrieved evidence.")
    add("")
    add("### Alternatives")
    add("")
    add("- Simple keyword search: easier, but misses semantic matches.")
    add("- Full-text search: good for exact words and ranking, but weaker for paraphrases.")
    add("- Hybrid search: combines full-text and vector retrieval; likely a strong next improvement.")
    add("- Reranking: retrieves many chunks then reorders them with a cross-encoder or LLM; improves precision.")
    add("- Fine-tuning: better style or task behavior, not good for constantly changing private facts.")
    add("- Managed vector DB: better scale/ops for vectors, but more infrastructure.")
    add("")
    add("### How to explain the RAG pipeline in an interview")
    add("")
    add("Say: I built RAG in two stages. First, sync and indexing: I pull Gmail and Calendar data, normalize it into documents, split content into overlapping chunks, create embeddings, and store chunk vectors in Postgres. Second, query-time retrieval: I embed the user question, run vector search scoped to the user's chunks, build a source-cited context block, combine it with conversation history, call the LLM, save the conversation, and return the answer with sources.")
    add("")
    add("### Likely RAG interview questions and answers")
    add("")
    rag_qas = [
        ("Why chunk documents?", "Because embeddings work better on focused pieces of text. Whole emails or long threads may contain multiple topics, so chunking improves retrieval precision."),
        ("Why overlap chunks?", "Overlap prevents important context from being lost at chunk boundaries."),
        ("Why store metadata?", "Metadata lets the answer cite where information came from and lets the UI show source type, author, subject, or event details."),
        ("How do you prevent one user from seeing another user's data?", "The retrieval query joins chunks to documents and filters by documents.user_id. Production should also require auth and derive userId from JWT."),
        ("What is the retrieval threshold?", "The current code filters chunks with distance <= 0.6. That is a heuristic and should be tuned using evaluation data."),
        ("What happens when no relevant context is found?", "The context builder says no relevant context was found, and the prompt instructs the model to say it cannot find enough information instead of hallucinating."),
        ("Why not just use the LLM without RAG?", "The LLM does not know the user's private emails or calendar events, and it should not guess. RAG gives it the needed private context at query time."),
    ]
    for q, a in rag_qas:
        add(f"- Question: {q}")
        add(f"  Answer: {a}")
    add("")

    add("## F. Agentic AI Flow Detailed Explanation")
    add("")
    add("### What agentic AI means here")
    add("")
    add("In this project, agentic AI means the backend does not only generate text. It runs a stateful workflow that can collect missing information, call tools/APIs, pause for user decisions, and perform an external action only after safety checks.")
    add("")
    add("### Intent router")
    add("")
    add("File: `backend/src/agent/intentRouter.js`.")
    add("")
    add("The intent router calls `LLMService.generateResponse` with a classifier prompt. Valid active intents are `calendar_agent`, `email_draft`, `email_reply`, `email_read`, and `rag`. If output is not valid or classification fails, it returns `general`. The prompt also mentions `calendar_rag` and `general`, but `calendar_rag` is not in `VALID_INTENTS`. This means calendar read questions likely return `rag` or `general`, not `calendar_rag`.")
    add("")
    add("### Calendar agent")
    add("")
    add("Files:")
    add("")
    for path in [
        "backend/src/agent/calenderAgent/state.js",
        "backend/src/agent/calenderAgent/nodes.js",
        "backend/src/agent/calenderAgent/graph.js",
        "backend/src/service/sources/GoogleCalendarDataSource.js",
    ]:
        add(f"- `{path}`")
    add("")
    add("What it does: creates Google Calendar events after collecting details, checking conflicts, and getting confirmation.")
    add("")
    add("Why an agent is needed: Calendar creation is multi-step. A normal API call expects complete structured input, but users say things like schedule a call tomorrow afternoon. The agent can extract fields, ask missing questions, check conflicts, suggest slots, and wait for confirmation.")
    add("")
    add("State fields:")
    add("")
    for field in [
        "userId",
        "userMessage",
        "eventDetails: title, date, startTime, endTime, description, attendees, location",
        "missingFields",
        "conflicts",
        "suggestedSlots",
        "confirmationStatus",
        "responseToUser",
        "messages",
    ]:
        add(f"- {field}")
    add("")
    add("Graph nodes:")
    add("")
    for node in [
        "parse_intent: calls Anthropic Claude Haiku to extract event details as JSON.",
        "ask_for_missing_info: asks one required missing field at a time.",
        "check_conflicts: lists primary calendar events in the requested time window.",
        "suggest_slots: shows up to three free slots using Calendar freebusy.",
        "await_confirmation: returns a preview and asks yes/no.",
        "create_event: inserts the event into the user's primary Google Calendar.",
    ]:
        add(f"- {node}")
    add("")
    add("Tools/APIs available to this agent:")
    add("")
    add("- `getGoogleCalendarClient(userId)`: gets an authenticated Google Calendar API client.")
    add("- `calendar.events.list`: checks conflicts.")
    add("- `calendar.freebusy.query`: finds free slots between 8 AM and 8 PM.")
    add("- `calendar.events.insert`: creates the final event.")
    add("")
    add("How confirmation is handled: `ChatController` passes `confirmationStatus` from the frontend. If status is confirmed, the graph routes directly to create_event. If rejected, the graph ends.")
    add("")
    add("Memory/state: The graph uses `MemorySaver`, so state persists only inside the running backend process. `PostgresCheckpointer` exists but is not used.")
    add("")
    add("Safety checks:")
    add("")
    add("- Required fields are collected before event creation.")
    add("- Calendar conflicts are checked before confirmation.")
    add("- User confirmation is required before insertion.")
    add("")
    add("Limitations:")
    add("")
    for item in [
        "Only creation is implemented even though the intent prompt mentions update/delete/cancel.",
        "LLM JSON parsing can fail and silently become empty extraction.",
        "Date/time parsing depends on the LLM and current server date.",
        "Timezone is hardcoded to Asia/Kolkata.",
        "State is not persisted across restarts.",
        "Standalone `/agent/calender` route is not mounted.",
    ]:
        add(f"- {item}")
    add("")
    add("Interview explanation: I used a LangGraph state machine because calendar creation is a controlled workflow. The graph lets me model each step, return to the user when information is missing, call Calendar APIs only at the right point, and require confirmation before side effects.")
    add("")
    add("### Email agent")
    add("")
    add("Files:")
    add("")
    for path in [
        "backend/src/agent/emailAgent/graph.js",
        "backend/src/agent/emailAgent/state.js",
        "backend/src/agent/emailAgent/index.js",
        "backend/src/agent/emailAgent/tools.js",
        "backend/src/agent/emailAgent/nodes/parseRequest.js",
        "backend/src/agent/emailAgent/nodes/resolveRecipient.js",
        "backend/src/agent/emailAgent/nodes/presentRecipientChoice.js",
        "backend/src/agent/emailAgent/nodes/draftEmail.js",
        "backend/src/agent/emailAgent/nodes/reviewDraft.js",
        "backend/src/agent/emailAgent/nodes/prepareSend.js",
        "backend/src/agent/emailAgent/nodes/revokeWindow.js",
        "backend/src/agent/emailAgent/nodes/sendEmail.js",
        "backend/src/service/email/gmailSendService.js",
    ]:
        add(f"- `{path}`")
    add("")
    add("What it does: creates a safe email workflow from natural language. It extracts intent, resolves recipient, drafts the email, lets the user review/edit/cancel, waits through a revoke window, and then sends through Gmail.")
    add("")
    add("Why an agent is needed: Email sending is a high-impact side effect. A one-shot API could accidentally send the wrong content to the wrong person. This graph forces human-in-the-loop confirmation and gives a short revoke period.")
    add("")
    add("State fields:")
    add("")
    for field in [
        "user_prompt and original_user_request",
        "purpose and tone",
        "recipient_name and recipient_email_from_request",
        "recipient_candidates and chosen_recipient",
        "current_draft, previous_draft, draft_history, edit_instructions",
        "approval_status",
        "send_status",
        "approval_timestamp, revoke_deadline, pending_send_token",
        "message_id, thread_id",
        "cancelled, last_error, final_response",
    ]:
        add(f"- {field}")
    add("")
    add("Graph nodes:")
    add("")
    for node in [
        "parse_request: OpenAI structured output extracts recipient name/email, tone, and purpose.",
        "resolve_recipient: uses explicit email or searches recipients by name.",
        "present_recipient_choice: LangGraph interrupt asks the user to choose or enter a recipient.",
        "draft_email: OpenAI structured output creates subject and body.",
        "review_draft: interrupt asks the user to approve, edit, regenerate, or cancel.",
        "prepare_send: creates a pending send token and 6-second revoke deadline.",
        "revoke_window: interrupt lets the user revoke before timeout.",
        "send_email: calls Gmail send API after safety checks.",
    ]:
        add(f"- {node}")
    add("")
    add("Tools/APIs available:")
    add("")
    add("- OpenAI structured output for parsing and drafting.")
    add("- `RecipientRepository.getRelavantRecipient` for recipient search.")
    add("- Gmail API through `sendEmail` in `gmailSendService.js`.")
    add("- LangGraph interrupts and Command resume.")
    add("")
    add("How tool calling works: This graph does not use LLM tool calling in the OpenAI function-call sense. Instead, the workflow itself calls deterministic tools/services at specific nodes. This is safer because the graph controls when recipient search and Gmail send can happen.")
    add("")
    add("How the agent decides what to do: The graph edges route based on state. After recipient choice, cancelled ends or draft_email runs. After review, approval goes to prepare_send, edit goes back to draft_email, and cancel ends. After revoke window, sending goes to send_email; otherwise it ends.")
    add("")
    add("How user confirmation is handled: `interrupt()` pauses the graph and returns structured payloads to the backend. The frontend renders cards for recipient choice, draft approval, and pending send. User actions are sent back as normal chat messages, and `invokeEmailAgent` resumes the graph with `Command({ resume })`.")
    add("")
    add("Revoke window: `prepareSend.js` sets `REVOKE_WINDOW_MS = 6000`. `index.js` schedules a timer that resumes the graph with `{ action: 'timeout', token }`. If the user sends revoke/cancel/undo/stop before timeout, the pending timer is cleared.")
    add("")
    add("Safety checks:")
    add("")
    for item in [
        "Recipient must be chosen or entered as a valid email.",
        "Draft must be approved before sending.",
        "Email cannot be sent early during the revoke window.",
        "Pending send token is checked.",
        "sendEmailNode requires approval_status approved, send_status sending, and expired revoke deadline.",
        "Errors from Gmail send return failed status instead of throwing to the user.",
    ]:
        add(f"- {item}")
    add("")
    add("Limitations:")
    add("")
    for item in [
        "Graph state is in process memory. A server restart loses active email sessions.",
        "The recipient repository method name is misspelled `getRelavantRecipient`.",
        "Recipient search needs pg_trgm extension.",
        "Reply-to-existing-email is disabled in ChatController because original thread verification is not safe yet.",
        "The 6-second revoke window is useful for a demo but should be configurable.",
        "The pending timers map is in memory and not durable across restarts or multiple server instances.",
    ]:
        add(f"- {item}")
    add("")
    add("Interview explanation: I designed the email agent as a human-in-the-loop LangGraph workflow. The LLM helps parse and draft, but the graph owns safety. It cannot send until the user selects a recipient, approves the draft, and passes a revoke window.")
    add("")

    add("## G. LangChain, LangGraph, and AI Libraries")
    add("")
    add("### AI-related backend packages")
    add("")
    packages = [
        ("@langchain/openai", "Used for ChatOpenAI in LLMService, intent routing, email agent structured output, and OpenAIEmbeddings."),
        ("@langchain/anthropic", "Used for ChatAnthropic in LLMService and directly in calendar agent nodes."),
        ("@langchain/langgraph", "Used for StateGraph, MemorySaver, interrupts, Command, and StateSchema in agents."),
        ("@langchain/textsplitters", "Used for RecursiveCharacterTextSplitter in the RAG chunker."),
        ("@langchain/core", "Used for prompts, messages, chat history, and LangGraph-related types."),
        ("langchain", "General LangChain package dependency."),
        ("openai", "Installed as underlying OpenAI dependency."),
        ("@google/generative-ai", "Installed but not used in active inspected code."),
        ("natural", "Used in textProcessing utilities for tokenization."),
        ("stopword", "Used in textProcessing utilities to remove stop words."),
        ("zod", "Used by email agent state schemas and structured output schemas."),
    ]
    for name, desc in packages:
        add(f"- `{name}`: {desc}")
    add("")
    add("### How model calls are made")
    add("")
    add("`LLMService` creates two chat model clients in its constructor:")
    add("")
    add("- `ChatOpenAI` with env model, temperature, maxTokens, retries, timeout, and streaming false.")
    add("- `ChatAnthropic` with env model, temperature, maxTokens, retries, timeout, and streaming false.")
    add("")
    add("`generateResponse` chooses provider by string. It accepts only `OpenAI` or `Anthropic`. It calls `llm.invoke(messages)` and reads `content` plus `usage_metadata`.")
    add("")
    add("### Structured output")
    add("")
    add("The email agent uses `.withStructuredOutput(zodSchema)` for two tasks:")
    add("")
    add("- Parse email request into recipient_name, recipient_email, tone, purpose.")
    add("- Draft email into subject and body.")
    add("")
    add("This is stronger than asking the model for plain JSON because LangChain validates the model output against Zod schemas.")
    add("")
    add("### Tools bound to model")
    add("")
    add("The code does not bind tools directly to a model with function/tool calling. Instead, tools are ordinary functions called by graph nodes. This is simpler and more controlled.")
    add("")
    add("### Prompt management")
    add("")
    add("Prompts are stored in code:")
    add("")
    add("- RAG prompts in `backend/src/RAG/query/prompts.js`.")
    add("- Intent classifier prompt in `backend/src/agent/intentRouter.js`.")
    add("- Calendar extraction prompt inside `backend/src/agent/calenderAgent/nodes.js`.")
    add("- Email parse/draft prompts in email agent node/tool files.")
    add("")
    add("For production, prompts could be versioned and tested separately.")
    add("")
    add("### Token and cost tracking")
    add("")
    add("`LLMService` reads `usage_metadata` and logs input/output token counts. It estimates cost using hardcoded OpenAI-like prices and converts USD to INR by calling `https://api.frankfurter.app/latest?from=USD&to=INR`. This is useful, but it is not provider/model-specific enough yet. Anthropic pricing differs, and exchange-rate network calls add latency and failure risk.")
    add("")
    add("### Improvements")
    add("")
    for item in [
        "Make pricing model-specific and provider-specific.",
        "Cache exchange rates.",
        "Use LangSmith or structured tracing for RAG and agent runs.",
        "Add prompt tests and golden-answer evaluation.",
        "Implement streaming support or remove the streaming route.",
        "Add reranker and query transformer, since files exist but are empty.",
    ]:
        add(f"- {item}")
    add("")

    add("## H. Frontend Explanation")
    add("")
    add("### Frontend framework")
    add("")
    add("The frontend uses React 19.2 with Vite. The Vite package is `rolldown-vite` through an npm alias. State management uses Zustand. Markdown rendering uses `react-markdown`. Real-time sync progress uses `socket.io-client`.")
    add("")
    add("### Why this stack is acceptable")
    add("")
    add("React and Vite are good for a fast SPA. Zustand is simpler than Redux and works well for this app because stores are small: auth, chat, and sync. Plain fetch clients are enough for the current API size.")
    add("")
    add("### Routing")
    add("")
    add("`App.jsx` manually maps paths to pages:")
    add("")
    for mapping in ["/ -> home", "/chat -> chat", "/stats -> stats", "/settings -> settings", "/profile -> profile", "/login -> login", "/auth/callback -> auth-callback"]:
        add(f"- {mapping}")
    add("")
    add("It pushes browser history manually and listens to `popstate`. `frontend/vercel.json` rewrites all routes to `index.html`, which supports direct SPA page loads.")
    add("")
    add("### State management")
    add("")
    add("- `authStore.js`: user, isAuthenticated, isLoading, error, setUser, logout.")
    add("- `chatStore.js`: messages, typing state, conversation id, agent active flags, pending confirmation, conversations list, sendMessage, load history, email status sync, reset/start chat.")
    add("- `syncStore.js`: Gmail and Calendar sync progress states and actions.")
    add("")
    add("### API clients")
    add("")
    add("- `auth.js`: Google login, JWT get/set/remove, current user, logout. Default base URL 9000.")
    add("- `chat.js`: send message, get email status, create conversation, get history, list conversations. Default base URL 9000.")
    add("- `sync.js`: start Gmail/Calendar sync. Default base URL 9000.")
    add("- `stats.js`: stats dashboard. Default base URL 2020.")
    add("- `home.js`: daily summary and upcoming events with dummy fallback. Default base URL 2020.")
    add("- `user.js`: update display name. Default base URL 2020.")
    add("")
    add("There is inconsistency in default API ports: some clients default to 9000, others to 2020, while backend `index.js` defaults to 2020. In real deployment, `VITE_API_BASE_URL` should be set consistently.")
    add("")
    add("### Major pages")
    add("")
    add("- LoginPage: Google login, guest mode, animated design.")
    add("- AuthCallbackPage: reads token from URL, stores it, loads user, navigates to chat.")
    add("- HomePage: greeting, query composer, suggestions, dummy/fallback daily summary and upcoming events.")
    add("- ChatPage/ChatWindow: main assistant UI, message list, composer, source pills, calendar confirmation, email agent cards.")
    add("- ProfilePage: profile data, display-name edit, Gmail and Calendar sync buttons, Socket.IO progress panels, sync history, logout.")
    add("- StatsPage: activity dashboard with SVG charts.")
    add("- SettingsPage: mostly dummy local settings UI, not wired to backend except theme passed from App.")
    add("")
    add("### Chat UI flow")
    add("")
    add("`ChatWindow` lets the user type a message. `sendMessage` in chatStore optimistically appends the user message, calls backend, then appends AI response. It handles three kinds of responses:")
    add("")
    add("- Normal text response.")
    add("- Calendar agent response with `pendingConfirmation` and mode `agent`.")
    add("- Email agent structured response types: recipient_choice, draft_approval, pending_send.")
    add("")
    add("### Email agent frontend flow")
    add("")
    add("- recipient_choice renders a card with candidates and email input.")
    add("- draft_approval renders a draft preview and Approve/Edit/Regenerate/Cancel buttons.")
    add("- pending_send renders countdown state and Revoke send button.")
    add("- `syncEmailStatus` polls `/chat/email-status/:conversationId` to update pending send status.")
    add("")
    add("### Sync frontend flow")
    add("")
    add("ProfilePage connects to Socket.IO with `socketService.connect(userId)`, listens for `sync:gmail:*` and `sync:google_calendar:*`, and updates syncStore. It filters events by syncId refs. Sync buttons use fetch directly in ProfilePage rather than `syncApi`.")
    add("")
    add("### Loading/error states")
    add("")
    add("- Chat has `isTyping` and error messages.")
    add("- Auth callback has processing/success/error states.")
    add("- Sync progress panels show progress, complete, and error states.")
    add("- Stats API returns empty data on failure so UI shows no-data states.")
    add("- Sidebar shows conversation loading/error/empty states.")
    add("")
    add("### Frontend gaps")
    add("")
    for item in [
        "No React Router, so route handling is manual.",
        "Socket service is mainly used on ProfilePage, not globally.",
        "Chat streaming is not implemented.",
        "Attach and voice buttons are UI-only.",
        "Settings page is mostly dummy and not backed by APIs.",
        "Home page daily summary/upcoming events call endpoints that do not exist and fall back to dummy data.",
        "Sidebar groups conversations by updatedAt/createdAt, but backend returns startedAt/lastMessageAt, so grouping can be wrong.",
    ]:
        add(f"- {item}")
    add("")
    add("### How to explain frontend briefly")
    add("")
    add("The frontend is a React/Vite SPA with Zustand stores. It has pages for login, home, chat, profile, stats, and settings. The chat UI calls the backend chat endpoint and can render normal RAG answers, calendar confirmations, and structured email-agent cards. The profile page starts Gmail/Calendar sync and listens to Socket.IO progress events.")
    add("")

    add("## I. Complete Feature-by-Feature Flow")
    add("")
    for title, steps in FEATURE_FLOWS:
        add(f"### {title}")
        add("")
        for step in steps:
            add(f"- {step}")
        add("")

    add("## J. Tech Stack and Tools")
    add("")
    add("### Backend technologies")
    add("")
    for item in [
        "Node.js with ES modules.",
        "Express 5.2.1 for HTTP API.",
        "PostgreSQL via pg.",
        "pgvector-style vector search with `<=>` operator.",
        "Socket.IO for progress events.",
        "Google APIs for OAuth, Gmail, and Calendar.",
        "JWT for app auth tokens.",
        "AES-256-CBC through Node crypto for OAuth token encryption.",
        "LangChain and LangGraph for LLM workflows.",
        "Zod for email-agent state and structured output validation.",
        "Nodemailer for alert emails.",
        "node-cron for cost alert scheduling.",
        "TypeScript compiler with allowJs for mixed JS/TS source.",
    ]:
        add(f"- {item}")
    add("")
    add("### Frontend technologies")
    add("")
    for item in [
        "React 19.2.",
        "Vite/Rolldown Vite.",
        "Zustand for state.",
        "socket.io-client for sync progress.",
        "react-markdown for assistant response rendering.",
        "Custom CSS in index.css/App.css and style JS files.",
        "Vercel SPA rewrite config.",
    ]:
        add(f"- {item}")
    add("")
    add("### AI models")
    add("")
    add("Model names are env-driven in most places. The stats controller includes colors for `claude-haiku-4-5-20251001`, `claude-3-5-sonnet-20241022`, and `gemini-embedding-001`. The active embedding provider defaults to `text-embedding-3-small`, while the stats controller still references Gemini embedding cost labels. Calendar agent nodes directly use Claude Haiku 4.5 as a hardcoded model.")
    add("")
    add("### Testing tools")
    add("")
    add("The backend has ad-hoc node scripts in `backend/test`. There is no Jest/Vitest/Mocha setup. The frontend has ESLint but no test runner. `backend/package.json` maps `npm test` to `node test/test-setup.js`, which only tests logger/config/schema validation basics.")
    add("")
    add("### Deployment tools")
    add("")
    add("Frontend has `vercel.json` for SPA rewrites. Backend has build/start scripts but no deployment manifest such as Dockerfile, Render/Railway config, or CI file in the inspected repo.")
    add("")

    add("## K. Design Decisions")
    add("")
    add("### Why this backend structure")
    add("")
    add("The backend structure separates HTTP concerns from business logic. Controllers handle request validation and responses, services handle integrations and workflows, and repositories handle SQL. This makes the backend easier to explain and debug.")
    add("")
    add("### Why PostgreSQL")
    add("")
    add("PostgreSQL handles relational application data and vector search in one database. For a personal assistant MVP, this reduces operational complexity.")
    add("")
    add("### Why the RAG pipeline")
    add("")
    add("RAG is better than fine-tuning for personal data because user data changes daily and must remain private. The pipeline is also explainable: synced data -> chunks -> embeddings -> vector retrieval -> LLM answer.")
    add("")
    add("### Why this agent design")
    add("")
    add("Calendar and email actions require multiple steps and user confirmation. LangGraph gives explicit state, transitions, and interrupts. This is safer than allowing an LLM to directly call send/create tools whenever it wants.")
    add("")
    add("### Why current API design")
    add("")
    add("The API is simple REST. `/chat/message` acts as an orchestrator endpoint. `/sync/*` endpoints start background jobs. `/stats/all` aggregates dashboard data. This is practical for a small product, though production should split some concerns and harden auth.")
    add("")
    add("### Tradeoffs")
    add("")
    for item in [
        "Optional auth makes local development easier but is unsafe for personal data.",
        "Fire-and-forget sync is simple but not durable like a queue.",
        "MemorySaver is simple but loses agent state on restart.",
        "Raw SQL is transparent but missing migrations make setup fragile.",
        "Hardcoded retrieval threshold is easy but needs evaluation.",
        "One chat endpoint is convenient but can become large as modes grow.",
    ]:
        add(f"- {item}")
    add("")

    add("## L. Bugs, Gaps, and Production Improvements")
    add("")
    add("### Current bugs or incomplete parts")
    add("")
    bugs = [
        "Route `/chat/message/stream` calls `chatController.sendMessageStream`, but that method is commented out. This endpoint will fail.",
        "`backend/src/api/routes/agent.js` is not mounted in `app.js`, so `/agent/calender` is unreachable.",
        "`CronManager` references undefined jobs `embedding`, `gmailSync`, and `calendarSync`.",
        "`CronManager` is not started in `index.js`.",
        "`GoogleAuthService.revokeAccess` calls `credentialsRepo.delete(credential.id)`, but `delete` expects a source, not an id.",
        "Credential repository mixes `scope` and `scopes` column names and has old upsert logic on `(source)` alongside newer upsert on `(user_id, source)`.",
        "Some frontend API clients default to port 9000 and others to 2020.",
        "Sidebar conversation grouping reads `updatedAt` or `createdAt`, but backend returns `startedAt` and `lastMessageAt`.",
        "Home page calls `/stats/daily-summary` and `/calendar/upcoming`, but those backend endpoints do not exist.",
        "Settings page has many dummy values and TODOs.",
        "RAG queryTransformer.js and reranker.js are empty.",
        "Embedding cost logging exists but active chunk embedding pipeline does not call it.",
        "document_chunks insert does not set occurred_at, but retrieval filters support occurredAfter/occurredBefore.",
        "Sync routes accept userId from request body and do not enforce JWT auth.",
        "Chat/stat routes use optional auth and fallback `SYNC_USER_ID`.",
        "`backend/test/test-agent.js` imports `../src/service/router/intentRouter.js`, which does not exist. The actual file is `src/agent/intentRouter.js`.",
        "Google Calendar full sync starts at hardcoded `2026-01-01T00:00:00Z`.",
        "Gmail full sync default query is hardcoded `after:2026/01/01`.",
        "Calendar and email agent checkpoints are in memory only.",
        "Email pending-send timers are in memory only and will not work reliably across restarts or multiple instances.",
    ]
    for bug in bugs:
        add(f"- {bug}")
    add("")
    add("### Security improvements")
    add("")
    for item in [
        "Require JWT auth for all chat, sync, stats, profile, and personal-data endpoints.",
        "Derive userId from JWT instead of request body.",
        "Persist and verify OAuth state to prevent CSRF in the OAuth flow.",
        "Use secure httpOnly cookies or short-lived access tokens plus refresh strategy instead of long-lived JWT in localStorage.",
        "Add rate limiting and request size validation.",
        "Add audit logs for external side effects like email sending and event creation.",
        "Consider stronger token encryption with AES-GCM to provide authentication, not only confidentiality.",
    ]:
        add(f"- {item}")
    add("")
    add("### Reliability improvements")
    add("")
    for item in [
        "Use a real job queue for sync and embedding, such as BullMQ, pg-boss, or cloud queues.",
        "Make sync idempotent with unique `(user_id, document_id)` constraints.",
        "Persist LangGraph checkpoints and pending email timers.",
        "Add retries/backoff for Google API and embedding calls.",
        "Add health checks for DB, Google credentials, and model providers.",
        "Add structured logs with request ids and trace ids.",
    ]:
        add(f"- {item}")
    add("")
    add("### RAG quality improvements")
    add("")
    for item in [
        "Add hybrid retrieval with PostgreSQL full-text search plus vector search.",
        "Implement reranker.js.",
        "Implement queryTransformer.js for follow-up question rewriting or multi-query retrieval.",
        "Tune chunk size and distance threshold with evaluation data.",
        "Add citation validation to ensure answers cite only retrieved sources.",
        "Add source filters from frontend, such as Gmail only or Calendar only.",
        "Store and use occurred_at on chunks.",
    ]:
        add(f"- {item}")
    add("")
    add("### Developer-experience improvements")
    add("")
    for item in [
        "Add migrations and schema docs.",
        "Add .env.example.",
        "Add API tests with supertest.",
        "Add unit tests for normalizers, chunking, retrieval filtering, and graph routing.",
        "Add CI for typecheck, lint, tests, and build.",
        "Remove dead/old files or clearly mark them as planned.",
    ]:
        add(f"- {item}")
    add("")

    add("## M. Interview Question Bank")
    add("")
    qas = [
        ("What is the main backend responsibility?", "The backend authenticates users, syncs data from Google services, stores documents and embeddings, runs RAG queries, orchestrates agents, and exposes REST APIs to the frontend."),
        ("How does OAuth work in your project?", "The frontend asks the backend for a Google consent URL. Google returns a code to the backend callback. The backend exchanges the code for tokens, fetches the Google profile, stores encrypted tokens, creates a user, signs a JWT, and redirects the frontend with that JWT."),
        ("How do you store private Google tokens?", "Access and refresh tokens are encrypted in GoogleAuthService with AES-256-CBC using TOKEN_ENCRYPTION_KEY before being stored in api_credentials."),
        ("How do you refresh expired Google tokens?", "GoogleAuthService.getValidAccessToken decrypts tokens, checks expiry with a 5-minute buffer, uses the refresh token if needed, updates the stored encrypted access token, and returns a valid access token."),
        ("What is your unified document model?", "Emails and calendar events are normalized into a common shape: document id, source, type, content, title, timestamp, author, and metadata. This lets one RAG pipeline work across sources."),
        ("How does Gmail normalization work?", "It extracts headers, decodes base64url body content, prefers plain text, strips HTML when needed, handles multipart recursively, cleans the text, truncates very long messages, and returns a gmail document."),
        ("How does Calendar normalization work?", "It skips cancelled events, handles all-day and timed events, extracts attendees and organizer, builds a readable text representation, and stores source-specific metadata."),
        ("Why did you use chunk embeddings instead of document embeddings?", "Chunks improve precision because long documents can contain multiple topics. Querying chunks returns the most relevant part instead of an entire document."),
        ("How is vector search done?", "The query is embedded with OpenAIEmbeddings. PostgreSQL searches document_chunks by pgvector distance, joins to documents, filters by user id, optionally filters source/date, orders by vector distance, and limits topK."),
        ("How do you reduce hallucination?", "I retrieve context from user data, format it as numbered sources, instruct the model to answer only from context, and tell it to say when context is missing."),
        ("Why use LangGraph?", "LangGraph is useful for stateful workflows with branches and interruptions. Calendar and email actions are multi-step and require human confirmation, so an explicit graph is safer than one-shot generation."),
        ("How does the calendar agent check conflicts?", "It creates start/end timestamps, calls Google Calendar events.list for that window, and if conflicts exist it calls freebusy to find available one-hour slots."),
        ("How does the email agent prevent accidental sends?", "It resolves the recipient, drafts the message, interrupts for review, requires approval, creates a pending-send token, waits through a revoke window, and only then calls Gmail send after safety checks."),
        ("What are the main production gaps?", "Auth is optional on several personal-data endpoints, migrations are missing, background jobs and graph checkpoints are in memory, streaming route is broken, and sync should use a durable queue."),
        ("How does the frontend connect to the backend?", "API clients in frontend/src/api use fetch. chatStore calls /chat/message, authApi calls /auth/*, sync UI calls /sync/*, statsApi calls /stats/all, and ProfilePage uses Socket.IO for sync progress."),
        ("What would you improve first?", "I would require auth everywhere and derive user id from JWT, add migrations and unique indexes, fix broken/unmounted routes, persist graph checkpoints, and add tests for RAG and agents."),
    ]
    for q, a in qas:
        add(f"### {q}")
        add("")
        add(a)
        add("")

    add("## N. File-by-File Revision Map")
    add("")
    add("### Backend files")
    add("")
    backend_files = [
        ("backend/index.js", "Entrypoint: loads env, connects DB, starts server, attaches WebSocket, handles shutdown."),
        ("backend/src/app.js", "Express app config and route mounting."),
        ("backend/src/config/environment.js", "Config object and required DB env validation."),
        ("backend/src/config/dbConfig.ts", "Lazy PostgreSQL pool creation and connectToDB."),
        ("backend/src/api/routes/authRoutes.js", "Auth route paths."),
        ("backend/src/api/controllers/authController.js", "Google OAuth, user upsert, token storage, JWT, current user, display-name update."),
        ("backend/src/api/routes/chat.js", "Chat routes and optional auth."),
        ("backend/src/api/controllers/chatController.js", "Main chat orchestration across email agent, calendar agent, RAG, and general LLM."),
        ("backend/src/api/routes/syncRoutes.js", "Gmail/Calendar sync route paths."),
        ("backend/src/api/controllers/syncController.js", "Async sync orchestration, sync logs, ingestion, embedding, WebSocket events."),
        ("backend/src/api/routes/stats.js", "Stats route with optional auth."),
        ("backend/src/api/controllers/statsController.js", "Dashboard aggregation response shaping."),
        ("backend/src/api/routes/agent.js", "Standalone unmounted calendar-agent route."),
        ("backend/src/database/userRepository.js", "SQL for users table."),
        ("backend/src/database/credentialRepository.js", "SQL for API credentials and OAuth token storage."),
        ("backend/src/database/documentRepository.js", "SQL for documents and older document-level vector search."),
        ("backend/src/database/chunkRepository.js", "SQL for inserting/searching chunk embeddings."),
        ("backend/src/database/conversationsRepo.js", "Conversation persistence and sidebar conversation list queries."),
        ("backend/src/database/syncLogsRepository.js", "Sync log CRUD and stats."),
        ("backend/src/database/statsRepository.js", "LLM/embedding usage and dashboard aggregation queries."),
        ("backend/src/database/recipientRepository.js", "Recipient fuzzy search for email agent."),
        ("backend/src/RAG/ragService.js", "Top-level RAG chat service."),
        ("backend/src/RAG/ingestion/ingestionPipeline.js", "Selects source/normalizer and stores documents."),
        ("backend/src/RAG/ingestion/embeddingPipeline.js", "Finds pending docs, chunks, embeds, inserts chunks."),
        ("backend/src/RAG/ingestion/chunker.js", "RecursiveCharacterTextSplitter settings."),
        ("backend/src/RAG/ingestion/embeddingsProvider.js", "OpenAI embeddings wrapper."),
        ("backend/src/RAG/retrieval/retriever.js", "Query embedding plus vector retrieval and threshold filtering."),
        ("backend/src/RAG/retrieval/contextBuilder.js", "Formats retrieved chunks into source-numbered context."),
        ("backend/src/RAG/query/queryPipeline.js", "Full query-time RAG orchestration."),
        ("backend/src/RAG/query/llmService.js", "OpenAI/Anthropic model invocation and usage logging."),
        ("backend/src/RAG/query/memoryService.js", "Conversation history loading/saving."),
        ("backend/src/RAG/query/prompts.js", "RAG prompts and prompt builder."),
        ("backend/src/RAG/retrieval/queryTransformer.js", "Empty planned file."),
        ("backend/src/RAG/retrieval/reranker.js", "Empty planned file."),
        ("backend/src/agent/intentRouter.js", "LLM-based intent classifier."),
        ("backend/src/agent/calenderAgent/state.js", "Calendar agent state reducers."),
        ("backend/src/agent/calenderAgent/nodes.js", "Calendar agent node implementations."),
        ("backend/src/agent/calenderAgent/graph.js", "Calendar StateGraph wiring."),
        ("backend/src/agent/calenderAgent/checkPointer.js", "Unused Postgres checkpointer draft."),
        ("backend/src/agent/emailAgent/graph.js", "Email StateGraph wiring."),
        ("backend/src/agent/emailAgent/state.js", "Email state schema."),
        ("backend/src/agent/emailAgent/index.js", "Email graph invocation, serialization, interrupts, timers, status helpers."),
        ("backend/src/agent/emailAgent/tools.js", "Recipient search, email draft generation, Gmail send wrapper."),
        ("backend/src/agent/emailAgent/nodes/*.js", "Individual email workflow nodes."),
        ("backend/src/service/sources/GmailDataSource.js", "Gmail API fetcher."),
        ("backend/src/service/sources/GoogleCalendarDataSource.js", "Calendar API fetcher plus free-slot helpers."),
        ("backend/src/service/normalizers/GmailNormalizer.js", "Gmail raw message to document."),
        ("backend/src/service/normalizers/GoogleCalendarNormalizer.js", "Calendar raw event to document."),
        ("backend/src/service/oauth/googleOAuthService.js", "Token encryption, refresh, and OAuth helper methods."),
        ("backend/src/service/email/gmailSendService.js", "Raw RFC 2822 email building, Gmail send, Gmail draft save."),
        ("backend/src/service/email/replyContextService.js", "Planned Gmail thread lookup for replies using RAG."),
        ("backend/src/service/websocket/sockeService.js", "Socket.IO server singleton."),
        ("backend/src/service/alertServices/CredAlertService.js", "Monthly budget alert logic."),
        ("backend/src/service/cron/credsAlertCron.js", "node-cron job for cost alerts."),
        ("backend/src/service/cron/cronManager.js", "Incomplete cron manager."),
        ("backend/src/utils/validation.js", "Unified document and metadata validation helpers."),
        ("backend/src/utils/logger.ts", "Console logger."),
        ("backend/src/utils/tokenCounter.js", "Approximate token counting helpers."),
        ("backend/src/utils/textProcessing.js", "Keyword/entity utility functions."),
        ("backend/src/utils/mailSender.js", "Nodemailer wrapper."),
        ("backend/src/utils/emailTemplates.ts", "HTML cost-alert email builder."),
        ("backend/src/utils/constants.ts", "LLM invocation and sync constants."),
        ("backend/src/utils/exchanceRates.ts", "USD to INR API helper."),
    ]
    for path, desc in backend_files:
        add(f"- `{path}`: {desc}")
    add("")
    add("### Frontend files")
    add("")
    frontend_files = [
        ("frontend/src/App.jsx", "Manual routing, theme, auth check, layouts."),
        ("frontend/src/main.jsx", "React root render."),
        ("frontend/src/api/auth.js", "Google login and JWT user session client."),
        ("frontend/src/api/chat.js", "Chat API client."),
        ("frontend/src/api/sync.js", "Sync API client."),
        ("frontend/src/api/stats.js", "Stats API client."),
        ("frontend/src/api/home.js", "Home dummy/fallback API client."),
        ("frontend/src/api/user.js", "Display name update client."),
        ("frontend/src/store/authStore.js", "Auth Zustand store."),
        ("frontend/src/store/chatStore.js", "Chat, agent, conversation Zustand store."),
        ("frontend/src/store/syncStore.js", "Gmail/Calendar sync progress store."),
        ("frontend/src/service/socketService.js", "Socket.IO client singleton."),
        ("frontend/src/pages/LoginPage.jsx", "Login screen and Google OAuth entry."),
        ("frontend/src/pages/AuthCallbackPage.jsx", "OAuth callback token handling."),
        ("frontend/src/pages/HomePage.jsx", "Home dashboard and prompt suggestions."),
        ("frontend/src/pages/ChatPage.jsx", "Chat page wrapper."),
        ("frontend/src/components/chat/ChatWindow.jsx", "Main chat UI and email/calendar cards."),
        ("frontend/src/components/chat/Message.jsx", "Older/general message component."),
        ("frontend/src/components/chat/TypingIndicator.jsx", "Typing indicator."),
        ("frontend/src/components/chat/ChatInput.jsx", "Placeholder, now embedded in ChatWindow."),
        ("frontend/src/components/layout/Sidebar.jsx", "Navigation, chat history, profile menu, calendar sync."),
        ("frontend/src/pages/ProfilePage.jsx", "Profile, data connections, sync progress, sync history."),
        ("frontend/src/pages/StatsPage.jsx", "Stats dashboard and SVG chart components."),
        ("frontend/src/pages/SettingsPage.jsx", "Mostly local/dummy settings UI."),
        ("frontend/vite.config.js", "Vite config with React plugin."),
        ("frontend/vercel.json", "SPA rewrite."),
        ("frontend/eslint.config.js", "ESLint config."),
        ("frontend/tailwind.config.js", "Tailwind config, though custom CSS dominates."),
    ]
    for path, desc in frontend_files:
        add(f"- `{path}`: {desc}")
    add("")
    add("## Final revision checklist")
    add("")
    for item in [
        "Practice the one-minute and three-minute answers.",
        "Be ready to draw the RAG pipeline from sync to answer.",
        "Be ready to explain why RAG beats fine-tuning for private changing data.",
        "Be honest about gaps: auth hardening, migrations, queues, persistent checkpoints, and broken streaming route.",
        "Emphasize safety in the agents: confirmation before Calendar changes and approval/revoke before email sending.",
        "Use exact file paths from this document when asked where logic lives.",
    ]:
        add(f"- {item}")
    add("")
    return "\n".join(lines)


def make_styles():
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="TitleCustom",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=27,
            alignment=TA_CENTER,
            spaceAfter=18,
            textColor=colors.HexColor("#222222"),
        )
    )
    styles.add(
        ParagraphStyle(
            name="Heading1Custom",
            parent=styles["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=17,
            leading=22,
            spaceBefore=14,
            spaceAfter=8,
            textColor=colors.HexColor("#3A2E23"),
            keepWithNext=True,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Heading2Custom",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13.5,
            leading=18,
            spaceBefore=10,
            spaceAfter=6,
            textColor=colors.HexColor("#4B392A"),
            keepWithNext=True,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Heading3Custom",
            parent=styles["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=11.5,
            leading=15,
            spaceBefore=8,
            spaceAfter=4,
            textColor=colors.HexColor("#5A4331"),
            keepWithNext=True,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BodyCustom",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=9.5,
            leading=13.2,
            spaceAfter=5,
            alignment=TA_LEFT,
        )
    )
    styles.add(
        ParagraphStyle(
            name="BulletCustom",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=9.2,
            leading=12.8,
            leftIndent=12,
            firstLineIndent=0,
            spaceAfter=3,
        )
    )
    styles.add(
        ParagraphStyle(
            name="CodeCustom",
            parent=styles["Code"],
            fontName="Courier",
            fontSize=7.3,
            leading=9,
            leftIndent=6,
            rightIndent=6,
            spaceBefore=4,
            spaceAfter=7,
            backColor=colors.HexColor("#F3F1EC"),
        )
    )
    return styles


def para(text: str, style: ParagraphStyle) -> Paragraph:
    text = escape(text)
    text = text.replace("`", "")
    return Paragraph(text, style)


def markdown_to_story(markdown: str):
    styles = make_styles()
    story = []
    code_lines: list[str] = []
    in_code = False
    bullet_buffer: list[Paragraph] = []

    def flush_bullets():
        nonlocal bullet_buffer
        if bullet_buffer:
            items = [ListItem(p, leftIndent=8) for p in bullet_buffer]
            story.append(
                ListFlowable(
                    items,
                    bulletType="bullet",
                    start="circle",
                    leftIndent=16,
                    bulletFontSize=6,
                    spaceAfter=4,
                )
            )
            bullet_buffer = []

    def flush_code():
        nonlocal code_lines
        if code_lines:
            story.append(Preformatted("\n".join(code_lines), styles["CodeCustom"], maxLineLength=95))
            code_lines = []

    for raw in markdown.splitlines():
        line = raw.rstrip()

        if line.startswith("```"):
            if in_code:
                in_code = False
                flush_code()
            else:
                flush_bullets()
                in_code = True
            continue

        if in_code:
            code_lines.append(line)
            continue

        if not line.strip():
            flush_bullets()
            story.append(Spacer(1, 3))
            continue

        if line.startswith("# "):
            flush_bullets()
            story.append(para(line[2:].strip(), styles["TitleCustom"]))
            story.append(Spacer(1, 8))
        elif line.startswith("## "):
            flush_bullets()
            story.append(PageBreak())
            story.append(para(line[3:].strip(), styles["Heading1Custom"]))
        elif line.startswith("### "):
            flush_bullets()
            story.append(para(line[4:].strip(), styles["Heading2Custom"]))
        elif line.startswith("#### "):
            flush_bullets()
            story.append(para(line[5:].strip(), styles["Heading3Custom"]))
        elif line.startswith("- "):
            bullet_buffer.append(para(line[2:].strip(), styles["BulletCustom"]))
        elif len(line) > 2 and line[0].isdigit() and ". " in line[:5]:
            flush_bullets()
            story.append(para(line, styles["BodyCustom"]))
        else:
            flush_bullets()
            story.append(para(line, styles["BodyCustom"]))

    flush_bullets()
    flush_code()
    return story


def add_page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#666666"))
    canvas.drawString(0.65 * inch, 0.42 * inch, "MyRA Master Interview Prep")
    canvas.drawRightString(A4[0] - 0.65 * inch, 0.42 * inch, f"Page {doc.page}")
    canvas.restoreState()


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    markdown = build_markdown()
    MARKDOWN_PATH.write_text(markdown, encoding="utf-8")

    doc = SimpleDocTemplate(
        str(PDF_PATH),
        pagesize=A4,
        rightMargin=0.62 * inch,
        leftMargin=0.62 * inch,
        topMargin=0.68 * inch,
        bottomMargin=0.62 * inch,
        title="MyRA Master Interview Preparation Document",
        author="Codex",
    )
    story = markdown_to_story(markdown)
    doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
    print(f"Wrote {MARKDOWN_PATH}")
    print(f"Wrote {PDF_PATH}")


if __name__ == "__main__":
    main()
