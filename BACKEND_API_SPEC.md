# MyRA Backend API Specification

All endpoints are prefixed by the Express app root. Auth-required routes must include an `Authorization: Bearer <JWT>` header.

---

## Authentication (already implemented)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/auth/google/login` | No | Returns `{ success: true, data: { authUrl } }` — frontend redirects browser to `authUrl` |
| GET | `/auth/google/callback` | No | OAuth callback from Google; exchanges code for token; redirects to `FRONTEND_URL/auth/callback?token=JWT` |
| GET | `/auth/me` | Yes | Returns `{ success: true, data: { user: { id, name, email, picture } } }` |
| POST | `/auth/logout` | Yes | Invalidates session; returns `{ success: true }` |

---

## Sync (already implemented)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/sync/gmail` | Yes | Triggers Gmail sync for user |
| POST | `/sync/calendar` | Yes | Triggers Google Calendar sync for user |
| GET | `/sync/history` | Yes | Query param: `userId` — returns array of past sync records |

---

## Chat (already implemented)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/chat` | Yes | Body: `{ message, conversationId? }` → `{ reply, conversationId, context }` |
| GET | `/chat/conversations` | Yes | Returns list of conversations for the user |
| GET | `/chat/conversations/:id` | Yes | Returns full message history for a conversation |

---

## Stats — **NEW, not yet built**

All stats endpoints accept a `range` query param: `7d | 14d | 30d | 90d`.

### `GET /stats/emails`

Returns daily email counts over the requested range.

**Query params:** `range` (default `14d`)

**Response:**
```json
{
  "success": true,
  "data": [38, 42, 31, 56, 47, 22, 18, 51, 64, 39, 43, 58, 29, 47]
}
```
Each item is an integer (number of emails received that day), ordered oldest → newest.

---

### `GET /stats/tokens`

Returns token usage grouped by model over the requested range.

**Query params:** `range` (default `30d`)

**Response:**
```json
{
  "success": true,
  "data": [
    { "name": "Claude Haiku 4.5",  "value": 1240000, "color": "#7A4A2E" },
    { "name": "GPT-4o",            "value": 720000,  "color": "#C9845A" }
  ]
}
```
`color` can be assigned server-side or left for frontend to assign.

---

### `GET /stats/reminders`

Returns daily reminder statistics over the requested range.

**Query params:** `range` (default `7d`)

**Response:**
```json
{
  "success": true,
  "data": [
    { "day": "Mon", "set": 6, "done": 5 },
    { "day": "Tue", "set": 4, "done": 4 }
  ]
}
```

---

### `GET /stats/cost`

Returns spend per LLM provider over the requested range.

**Query params:** `range` (default `30d`)

**Response:**
```json
{
  "success": true,
  "data": [
    { "provider": "Claude", "spend": 18.42 },
    { "provider": "OpenAI", "spend": 11.07 }
  ]
}
```
`spend` is in USD.

---

### `GET /stats/sessions`

Returns daily chat session counts over the requested range.

**Query params:** `range` (default `14d`)

**Response:**
```json
{
  "success": true,
  "data": [3, 5, 2, 7, 8, 4, 6, 9, 5, 7, 11, 6, 8, 10]
}
```

---

### `GET /stats/calendar`

Returns daily calendar events handled by the agent over the requested range.

**Query params:** `range` (default `14d`)

**Response:**
```json
{
  "success": true,
  "data": [2, 4, 3, 6, 5, 1, 3, 4, 7, 2, 5, 6, 3, 4]
}
```

---

### `GET /stats/daily-summary`

Returns today's KPI snapshot for the Home page tiles.

**Query params:** none

**Response:**
```json
{
  "success": true,
  "data": {
    "unreadEmails": 14,
    "remindersDue": 3,
    "meetings": 2
  }
}
```

---

## Calendar — **NEW, not yet built**

### `GET /calendar/upcoming`

Returns the next N upcoming calendar events for the authenticated user.

**Query params:** `limit` (default `5`)

**Response:**
```json
{
  "success": true,
  "data": [
    { "time": "2:00 PM",  "title": "Design crit — Onboarding v3", "where": "Conf room A" },
    { "time": "4:00 PM",  "title": "1:1 with Priya",              "where": "Google Meet" },
    { "time": "Tomorrow", "title": "Quarterly review prep",        "where": "Block · 90 min" }
  ]
}
```
`time` is a human-readable string (e.g., `"2:00 PM"`, `"Tomorrow"`, `"Wed 10 AM"`). The backend should format this relative to the current date.

---

## User — **NEW, not yet built**

### `PUT /user/profile`

Updates the authenticated user's profile information.

**Auth:** Yes

**Request body:**
```json
{
  "name": "Cherry",
  "email": "cherry@example.com",
  "picture": "https://..."
}
```
All fields optional — patch semantics.

**Response:**
```json
{
  "success": true,
  "data": {
    "user": { "id": "...", "name": "Cherry", "email": "cherry@example.com", "picture": "..." }
  }
}
```

---

## Settings — **NEW, not yet built**

### `GET /settings`

Returns user's current settings.

**Auth:** Yes

**Response:**
```json
{
  "success": true,
  "data": {
    "general": {
      "timezone": "Asia/Kolkata",
      "language": "en",
      "theme": "light"
    },
    "notifications": {
      "emailDigest": true,
      "reminderAlerts": true,
      "syncAlerts": false
    },
    "privacy": {
      "storeChatHistory": true,
      "shareAnalytics": false,
      "allowDataTraining": false
    }
  }
}
```

---

### `PUT /settings`

Updates user settings. Patch semantics — only send what changed.

**Auth:** Yes

**Request body:** same shape as GET response `data`, all fields optional.

**Response:**
```json
{ "success": true }
```

---

### `GET /settings/sources`

Returns connected data sources with document counts and last sync time.

**Auth:** Yes

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "gmail",
      "name": "Gmail",
      "connected": true,
      "docCount": 4218,
      "lastSync": "2026-05-09T10:23:00Z"
    },
    {
      "id": "google_calendar",
      "name": "Google Calendar",
      "connected": true,
      "docCount": 312,
      "lastSync": "2026-05-09T09:00:00Z"
    }
  ]
}
```

---

## Error format (all endpoints)

```json
{
  "success": false,
  "error": "Human-readable error message"
}
```

HTTP status codes: `400` bad request, `401` unauthorized, `403` forbidden, `404` not found, `500` internal server error.

---

## Environment variables required (backend)

| Variable | Example | Purpose |
|----------|---------|---------|
| `PORT` | `2020` | Express server port |
| `FRONTEND_URL` | `http://localhost:5173` | Used in CORS + OAuth redirect |
| `GOOGLE_CLIENT_ID` | `...apps.googleusercontent.com` | OAuth client |
| `GOOGLE_CLIENT_SECRET` | `...` | OAuth secret |
| `GOOGLE_REDIRECT_URI` | `http://localhost:2020/auth/google/callback` | Must match Google Console |
| `JWT_SECRET` | `supersecret` | Signs JWT tokens |
| `CORS_ORIGIN` | `http://localhost:5173` | CORS allowed origin |

---

## Frontend environment variables

| Variable | Example | Purpose |
|----------|---------|---------|
| `VITE_API_BASE_URL` | `http://localhost:2020` | Backend base URL (set in `frontend/.env.local`) |
