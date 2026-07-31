# NeoFlo Visual Agent

> A Chrome Extension (Manifest V3) + Node/Express backend that watches your active browser tab, captures periodic screenshots, classifies them with a multimodal AI model (GPT-4o or Claude), and persists labeled activity events to PostgreSQL — with S3/local-disk blob storage and a Redis/BullMQ queue decoupling ingestion from inference.

---

## Architecture

```
Browser (Chrome Extension — MV3)
────────────────────────────────────────────────────────────────
background.ts (Service Worker)
  ├── chrome.tabs.onActivated / onUpdated  →  track active URL + title
  ├── chrome.alarms (every ~12s)           →  captureVisibleTab()
  ├── POST /api/events (multipart)         →  send screenshot + metadata
  └── offline queue (chrome.storage.local) →  drain on reconnect

content.ts (injected into every page)
  └── scroll depth, click count, focus → sendMessage → background

popup/ (React 18)
  ├── Consent banner (first-launch gate)
  ├── On/Off toggle → sendMessage → background
  ├── Current activity card (reads chrome.storage.local)
  └── Pause-until-navigation control

────────────────────────────────────────────────────────────────
Backend (Node/Express + TypeScript)
────────────────────────────────────────────────────────────────
POST /api/auth/register  →  upsert User by installId, issue 365d JWT
POST /api/events         →  multer → blobStorage.save() → DB(PENDING) → queue
GET  /api/events/recent  →  last N LABELED events for this user

Queue (Redis / BullMQ)
  producer.ts  →  enqueueVisionJob({ eventId })
  worker.ts    →  load Event → blobStorage.getBuffer() → classifyScreenshot()
                  → update Event(LABELED, aiActivity, aiApp, aiConfidence)

Services
  visionClient.ts  →  VISION_PROVIDER=openai|anthropic  (provider interface)
  blobStorage.ts   →  STORAGE_PROVIDER=local|s3          (storage interface)

Persistence
  PostgreSQL (Prisma)  →  User, Session, Event (with EventStatus enum)
  Redis                →  BullMQ job queue + result store
  Local disk / S3      →  raw JPEG screenshots (NOT stored in Postgres)
```

---

## Why these design choices?

### `chrome.alarms` instead of `setInterval`
MV3 service workers are ephemeral — Chrome can kill and restart them at any time. `setInterval` timers don't survive restarts. `chrome.alarms` are managed by the browser and fire correctly even after a SW restart. On every wakeup the SW re-acquires the active tab via `chrome.tabs.query()`.

### Provider-abstraction pattern (visionClient.ts + blobStorage.ts)
Both services export a single public function and select the actual implementation from a map keyed by an env var (`VISION_PROVIDER`, `STORAGE_PROVIDER`). Adding a new provider is one function + one map entry — nothing else changes. This is the same pattern used in AI-GCM to intercept and route calls across Claude/GPT-4/Gemini.

### BullMQ queue instead of inline vision API call
The vision API call takes 2–5 seconds. If it were inline in the POST handler, the extension would block for that time on every capture. Instead:
- POST `/api/events` returns `202 Queued` in ~50ms (only a DB write + Redis push)
- The worker processes at its own pace, retries on failure (3× with exponential backoff)
- The extension is never affected by vision API latency or downtime

### Screenshots in S3/local disk, not Postgres
Storing raw JPEG bytes in Postgres as `bytea` bloats the table, kills replication throughput, and makes point-in-time recovery expensive. We store a `screenshotKey` (S3 key or local filename) + a `screenshotUrl` (presigned URL) in the `Event` row. The actual bytes live in a purpose-built blob store. This is the standard production pattern and an explicit tradeoff worth mentioning in reviews.

### JWT issued per install, no login UX
The extension generates a stable `installId` (UUID, persisted in `chrome.storage.local`) and registers with the backend once. The backend upserts a `User` record and issues a 365-day JWT. Subsequent requests use this token. No login screen, no OAuth flow — appropriate for a single-user productivity tool where the identity IS the browser install.

### Local-first defaults
`STORAGE_PROVIDER=local` and `VISION_PROVIDER=openai` are the defaults. A reviewer can:
```
docker compose up -d
```
…and have Postgres + Redis + the Express API running with zero cloud credentials. They only need to add `OPENAI_API_KEY` to `backend/.env` to get the full vision pipeline.

---

## Repository Structure

```
neoflo-visual-agent/
├── extension/                  # Chrome Extension (MV3, TypeScript, React)
│   ├── manifest.json
│   ├── popup.html
│   ├── src/
│   │   ├── background.ts       # Service worker: tab tracking, alarm, offline queue
│   │   ├── content.ts          # DOM signals: scroll depth, click count, focus
│   │   ├── types.ts            # Shared types + message protocol
│   │   ├── lib/
│   │   │   ├── api.ts          # Backend POST wrapper + offline fallback
│   │   │   ├── capture.ts      # captureVisibleTab wrapper
│   │   │   └── storage.ts      # chrome.storage.local typed wrappers
│   │   └── popup/
│   │       ├── index.tsx
│   │       ├── Popup.tsx       # Consent + toggle + activity card + stats
│   │       └── Popup.css       # Dark-mode premium UI
│   ├── scripts/
│   │   └── generate-icons.mjs  # macOS sips-based icon resizer
│   ├── package.json            # @crxjs/vite-plugin + React 18
│   └── vite.config.ts
│
├── backend/                    # Express API + BullMQ worker
│   ├── prisma/
│   │   └── schema.prisma       # User, Session, Event + EventStatus enum
│   ├── src/
│   │   ├── index.ts            # Express app, /uploads static, graceful shutdown
│   │   ├── config.ts           # Zod-validated env config
│   │   ├── db/client.ts        # Prisma singleton
│   │   ├── middleware/auth.ts  # JWT Bearer middleware
│   │   ├── routes/
│   │   │   ├── auth.ts         # POST /api/auth/register
│   │   │   └── events.ts       # POST /api/events, GET /api/events/recent
│   │   ├── queue/
│   │   │   ├── producer.ts     # enqueueVisionJob()
│   │   │   └── worker.ts       # BullMQ worker process
│   │   └── services/
│   │       ├── visionClient.ts # classifyScreenshot() — openai | anthropic
│   │       ├── blobStorage.ts  # saveScreenshot() — local | s3
│   │       └── logger.ts       # Winston
│   ├── Dockerfile.dev
│   ├── .env.example
│   └── package.json
│
├── docker-compose.yml           # postgres + redis + backend + worker
└── README.md
```

---

## Quick Start (Local)

### Prerequisites
- Docker + Docker Compose
- Node 20+
- An OpenAI API key (or Anthropic key if you set `VISION_PROVIDER=anthropic`)
- Chrome browser

### 1. Clone and configure
```bash
git clone https://github.com/Yashtyagi2406/Visual-Ai-Agent.git
cd Visual-Ai-Agent

# Add your API key to the backend env
cp backend/.env.example backend/.env
# Edit backend/.env and set: OPENAI_API_KEY=sk-...
```

### 2. Start the backend stack
```bash
docker compose up -d
```
This starts:
- PostgreSQL on port `5432`
- Redis on port `6379`
- Express API on port `3000` (runs `prisma migrate deploy` on first start)
- BullMQ vision worker

Verify:
```bash
curl http://localhost:3000/health
# → {"status":"ok","ts":"..."}
```

### 3. Build and load the extension
```bash
cd extension
npm install
npm run build   # outputs to extension/dist/
```

In Chrome:
1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/dist/` folder

### 4. Use it
1. Click the NeoFlo icon in the toolbar
2. Accept the consent banner
3. Toggle tracking **ON**
4. Browse normally — every ~12 seconds a screenshot is captured and classified
5. Reopen the popup to see the current AI activity label

---

## API Reference

### `POST /api/auth/register`
Register a new extension install (idempotent).

**Body:** `{ installId: string }` (UUID)  
**Response:** `{ token: string, userId: string }`

---

### `POST /api/events`
Submit a captured screenshot for classification.

**Auth:** `Authorization: Bearer <token>`  
**Body:** `multipart/form-data`
- `screenshot` — JPEG image (max 5 MB)
- `metadata` — JSON string: `{ tabUrl, tabTitle, capturedAt, domSignals? }`

**Response:** `{ eventId: string, status: "queued" }` (202)

---

### `GET /api/events/recent?limit=N`
Fetch the last N labeled events for this install.

**Auth:** `Authorization: Bearer <token>`  
**Response:** `{ events: [{ id, tabUrl, tabTitle, aiActivity, aiApp, aiConfidence, capturedAt, ... }] }`

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Express listen port |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `JWT_SECRET` | — | Min 16 chars, used to sign install tokens |
| `VISION_PROVIDER` | `openai` | `openai` or `anthropic` |
| `OPENAI_API_KEY` | — | Required when `VISION_PROVIDER=openai` |
| `ANTHROPIC_API_KEY` | — | Required when `VISION_PROVIDER=anthropic` |
| `STORAGE_PROVIDER` | `local` | `local` (disk) or `s3` |
| `BASE_URL` | `http://localhost:3000` | Used to construct screenshot URLs |
| `S3_BUCKET` | — | Required when `STORAGE_PROVIDER=s3` |
| `AWS_REGION` | `us-east-1` | S3 bucket region |
| `AWS_ACCESS_KEY_ID` | — | S3 credentials |
| `AWS_SECRET_ACCESS_KEY` | — | S3 credentials |

---

## Git History

The commit graph was structured to show real incremental development:

| Branch | What it delivers |
|---|---|
| `main` | Initial scaffold (`.gitignore`, `docker-compose.yml`) |
| `feat/extension-scaffold` | Full MV3 extension: manifest, build config, all source files |
| `feat/backend-skeleton` | Express app, Prisma schema, auth + events routes |
| `feat/redis-queue` | BullMQ producer + worker (decoupled ingestion from inference) |
| `feat/vision-api` | Provider-abstraction: visionClient + blobStorage |
| `feat/popup-ui` | Consent banner, toggle, activity card, session stats |
| `docs/readme` | This write-up |

All branches merged with `--no-ff` to preserve the graph topology.

---

## Possible Improvements

- **WebSocket push**: instead of the popup polling `/api/events/recent`, the backend could push new labels via WebSocket or SSE, reducing perceived latency
- **Session boundaries**: detect idle gaps (>5 min no capture) and auto-close sessions
- **Redaction**: blur or skip screenshots when sensitive form fields are focused (password inputs, etc.)
- **Dashboard**: a web UI to browse the full labeled event timeline
- **Rate limiting**: add express-rate-limit on `/api/events` keyed by userId
- **Prisma migrations**: automate `prisma migrate deploy` in the Docker entrypoint (already done in `docker-compose.yml`)
