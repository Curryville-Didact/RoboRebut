# Phase 2.2 Complete — Response Generation Engine

**Completed:** 2026-03-22  
**Branch:** phase-2.2-response-engine  
**Commit:** 9e13f3f

---

## What Was Built

### 1. Rebuttal Prompt Engine
**File:** `packages/backend/src/prompts/rebuttalPrompt.ts`

Builds a structured Claude prompt from any Phase 2.1 analysis payload.
- Uses the **Acknowledge / Reframe / Position / Redirect (ARPR)** framework
- Per-category guidance for 11 objection types: financial, trust, timing, authority, need, no_need, competitor, confusion, brush_off, hesitation, hidden
- Tone and urgency modifiers injected dynamically
- Strict JSON output rules enforced in system prompt
- Returns 3 ranked rebuttals: empathetic, direct, social-proof

---

### 2. Response Generator Service
**File:** `packages/backend/src/services/responseGenerator.ts`

Calls Claude via **OpenClaw gateway** (OpenAI-compat HTTP endpoint at `http://127.0.0.1:18789/v1/chat/completions`).
- Model: `anthropic/claude-sonnet-4-6`
- Returns 3 ranked `RebuttalOption` objects with: `rank`, `text`, `tone`, `framework`, `confidence`
- Parses and validates Claude's JSON response, strips markdown fences if present
- **Graceful fallback:** if the AI call fails for any reason, returns template-based rebuttals so the pipeline never breaks
- 30s abort timeout on AI calls

---

### 3. Rebuttal API Route
**File:** `packages/backend/src/routes/rebuttal.ts`

`POST /api/rebuttal`
- Accepts full analysis payload: `raw_input`, `category`, `intent`, `emotional_tone`, `urgency`, `confidence`, `signals`
- Returns 3 ranked rebuttals in standard output format
- Persists every result to PostgreSQL via Prisma (best-effort — request never fails on DB error)

**Example request:**
```json
{
  "raw_input": "I can't afford this right now",
  "category": "financial",
  "intent": "stall",
  "emotional_tone": "defensive",
  "urgency": "low",
  "confidence": 0.92
}
```

**Example response:**
```json
{
  "rebuttals": [
    {
      "rank": 1,
      "text": "I completely understand...",
      "tone": "empathetic",
      "framework": "acknowledge-reframe",
      "confidence": 0.94
    },
    { "rank": 2, "text": "...", "tone": "direct", "framework": "reframe-position", "confidence": 0.86 },
    { "rank": 3, "text": "...", "tone": "social-proof", "framework": "reframe-position-redirect", "confidence": 0.79 }
  ]
}
```

---

### 4. Database Storage (Prisma)
**Migration:** `prisma/migrations/20260322031853_add_rebuttal_model/`

Added `Rebuttal` model to `prisma/schema.prisma`:
| Field | Type | Notes |
|---|---|---|
| id | String (cuid) | Primary key |
| raw_input | String | Original objection text |
| category | String | Objection category |
| intent | String? | Stall, genuine concern, brush-off |
| emotional_tone | String? | Defensive, curious, skeptical, neutral |
| urgency | String? | Low, medium, high |
| rebuttal_1 | String | Rank 1 rebuttal text |
| rebuttal_2 | String | Rank 2 rebuttal text |
| rebuttal_3 | String | Rank 3 rebuttal text |
| rebuttals_json | Json? | Full structured output |
| confidence | Float? | Classification confidence |
| created_at | DateTime | Indexed |

Indexes on `category` and `created_at`.

---

### 5. WebSocket Integration
**File:** `packages/backend/src/server.ts`

The full pipeline now runs: `INPUT → CLASSIFY → STRATEGIZE → GENERATE → EVALUATE → STORE → REBUTTALS`

New WebSocket event sequence:
```
connected
→ received         (echo of input)
→ analysis         (Phase 2.1 classification result)
→ generating_rebuttals
→ rebuttal         (rank 1 — streams immediately)
→ rebuttal         (rank 2)
→ rebuttal         (rank 3)
→ response         (backwards-compat: rank 1 text + full rebuttals array)
→ done
```

- Each `rebuttal` event carries the full `RebuttalOption` object
- `response` event now includes a `rebuttals` array for frontends that want all 3 at once
- DB persistence happens async (best-effort) — does not block WebSocket response

---

## Infrastructure Changes

- **OpenClaw gateway** chat completions HTTP endpoint enabled (`gateway.http.endpoints.chatCompletions.enabled: true`)
- Backend `.env` corrected: `DATABASE_URL` now uses correct Docker credentials (`roborebut:roborebut_dev`)
- Added to `.env` and `.env.example`: `OPENCLAW_GATEWAY_URL`, `OPENCLAW_GATEWAY_TOKEN`, `CLAUDE_MODEL`

---

## Definition of Done — Verified

- [x] Given any objection input, system returns 3 ranked rebuttals via Claude
- [x] Rebuttals stream back to frontend in real time (3 individual `rebuttal` events)
- [x] Every rebuttal set is stored in PostgreSQL via Prisma (confirmed via psql query)
- [x] Full TypeScript build passes clean (`npx tsc --noEmit`)
- [x] All new code committed with clear message
- [x] This `PHASE_2.2_COMPLETE.md` file created

---

## What's Next (Phase 2.3 candidates)

- **Frontend integration:** Display 3 ranked rebuttals with rank badges and tone labels in the UI
- **Persona/voice customization:** Let reps configure their tone preference (empathetic vs. challenger)
- **Rebuttal history view:** Admin UI to browse stored rebuttals by category
- **Response scoring:** Rate rebuttals after calls to improve quality over time
- **Streaming token output:** Stream Claude's tokens as they arrive instead of waiting for full response
