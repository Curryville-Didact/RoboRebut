# RoboRebut Coach

Real-time live call coaching: transcribe calls, detect questions/objections, surface suggested responses and follow-up questions.

## Prerequisites

- Node.js 20+
- Docker and Docker Compose (for Postgres + Redis)
- (Optional for local dev) Clerk account, OpenAI API key, Deepgram API key, Twilio account

## Repo structure

- `packages/frontend` — Next.js (App Router), TypeScript, Tailwind, shadcn/ui
- `packages/backend` — Fastify, TypeScript, Prisma, Redis, WebSocket
- `docker-compose.yml` — Postgres (pgvector) + Redis

## Local setup

1. **Clone and install**

   ```bash
   cd RoboRebut
   npm install
   ```

2. **Environment**

   - Copy `.env.example` to `.env` at repo root (backend env).
   - Copy `packages/frontend/.env.example` to `packages/frontend/.env.local` (frontend env).
   - Fill in `DATABASE_URL`, `REDIS_URL`; add Clerk/OpenAI/Deepgram/Twilio keys when you need those features.

3. **Database (after running Step 2 / Prisma schema)**

   ```bash
   npm run docker:up
   npm run db:migrate
   ```

4. **Run**

   - Terminal 1: `npm run dev:backend`
   - Terminal 2: `npm run dev:frontend`
   - Frontend: http://localhost:3000
   - Backend: http://localhost:4000 (e.g. http://localhost:4000/health)

## Commands

| Command            | Description                    |
|--------------------|--------------------------------|
| `npm run docker:up`   | Start Postgres + Redis        |
| `npm run docker:down` | Stop containers               |
| `npm run dev:frontend`| Start Next.js dev server     |
| `npm run dev:backend` | Start Fastify dev server     |
| `npm run build`       | Build all packages           |
| `npm run db:generate` | Generate Prisma client (after Step 2)       |
| `npm run db:migrate`  | Run Prisma migrations (after Step 2)       |
| `npm run db:push`     | Push Prisma schema without migration (dev) |

## Mock audio mode

For local development without Twilio, use mock audio mode to simulate live transcript and suggestions. (Documented in docs after implementation.)

## Twilio (real calls)

Twilio integration is implemented for production; local MVP demos typically use mock audio first. See `docs/DEPLOYMENT.md` and `docs/API.md` when configuring Twilio.

## Docs

- `docs/ARCHITECTURE.md` — System design and data flow
- `docs/API.md` — REST and WebSocket API
- `docs/DEPLOYMENT.md` — Deployment and env
- `docs/ROADMAP.md` — V1.5 / V2 roadmap
