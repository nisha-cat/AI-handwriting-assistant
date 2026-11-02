# AI Handwriting Assistant

Speak or type an answer → optionally let an LLM tidy it (you review every change) → get **handwriting-style** notes you can preview, edit and export as **PDF** or **PNG**.

Built for students and anyone who finds writing by hand difficult (temporary injury, certain disabilities). The output is a *handwriting-style rendering* made with open-licensed fonts. It is **not** real handwriting and the app deliberately has no feature for imitating a specific person's handwriting or signature.

```
React + Vite + Tailwind  ──►  Express API  ──►  MySQL (or in-memory in dev)
   │ canvas preview             │  OpenAI (organise + transcribe, optional)
   │ Web Speech dictation       │  pdf-lib + embedded fonts (PDF)
   └ PNG export (canvas)        └  Zod validation everywhere
```

## Contents

1. [Features](#features) · 2. [Verification status](#verification-status-read-this) · 3. [Quick start](#quick-start) · 4. [Configuration](#configuration) · 5. [Scripts & testing](#scripts--testing) · 6. [Architecture](#architecture) · 7. [API](#api) · 8. [Database](#database) · 9. [Security](#security-notes) · 10. [Deployment](#deployment) · 11. [Limitations & remaining work](#limitations--remaining-work)

## Features

| Area | What it does |
|---|---|
| **Voice → text** | Live browser dictation (Web Speech API); record in-browser and transcribe on the server; upload an audio file. Each path is offered **only if it can really produce a transcript**; nothing is ever inserted unless a transcription actually ran. Handles unsupported browsers, denied/missing microphone, empty or oversized audio, network and provider errors. Typing/pasting always works. |
| **AI organiser** | Modes: exam answer, short notes, detailed explanation, summary, Q&A, bullet revision notes. Inputs: question, subject, level, length, detail, language, answer structure (intro / main points / examples / conclusion). Output is schema-validated JSON, shown as editable text. Changes are listed ("Corrected / Reorganized / Expanded / Removed") and content the model *added* triggers a prominent warning. The original text is always kept and restorable. |
| **No-key fallback** | Without `OPENAI_API_KEY` a rule-based local formatter (spacing, capitalisation, simple structure) runs. The UI and API label it as "no AI used". |
| **Handwriting renderer** | 3 licensed fonts (Caveat, Kalam, Patrick Hand – SIL OFL 1.1), ink colours + custom colour, ruled / grid / blank paper, A4 & Letter, font size, line spacing, margins, title/date/page numbers, "natural variation" (seeded, so preview = export). Automatic wrapping and pagination (headings are kept with the following line). |
| **Exam mode** | Question → answer → organise with a configurable structure → review → style → export. |
| **Documents** | Save, reopen, rename, duplicate, delete; created/updated timestamps; revision snapshots on update (API). Create is idempotent (safe to retry). Local browser backup protects unsaved work. |
| **Export** | PDF via `POST /api/export/pdf` (vector text, font embedded); per-page or all-pages PNG (≈215 dpi) from the same layout. |
| **UX / a11y** | Dashboard, 5-step workspace, side-by-side editor/preview on desktop, Edit/Preview toggle on mobile, labelled controls, visible focus, skip link, live regions, toasts, loading/empty/error states. |

## Verification status (read this)

I ran everything below in the build environment. Items marked ✗ could **not** be verified here and are listed honestly.

| Check | Result |
|---|---|
| `npm run typecheck` (shared, server, web) | ✓ clean |
| Unit/API/component tests | ✓ **172 passing** (shared 18 · server 112 · web 42) |
| MySQL repository contract tests | ✓ passed against **MariaDB 10.11** with the real migration (not MySQL 8 itself) |
| Production build (`npm run build`) | ✓ server bundle + web bundle |
| Browser E2E (`e2e/smoke.mjs`, Chromium) | ✓ 14/14 on both the in-memory store **and** MariaDB: input → organise → review → style → PDF + PNG download → save → dashboard → duplicate/rename/delete → reopen → mobile (no horizontal scroll) |
| axe-core WCAG A/AA scan of the workspace page | ✓ 0 violations (found and fixed one: keyboard access to the scrollable preview) |
| Exported PDF opens | ✓ `pdfinfo`/`pdffonts`/`pdftoppm`: valid A4 PDF, Caveat embedded, renders correctly |
| API behaviour via curl | ✓ idempotent create, per-browser isolation, validation errors, 413 on oversize body, "transcription not configured" |
| **Real OpenAI calls** (organise + transcription) | ✗ **No API key was available.** The integration is tested against mocked HTTP only (success, 429, 5xx, timeout, malformed/invalid JSON, schema failures). Try it with your key before relying on it. The default model `gpt-4o-mini` is a configurable assumption. |
| **Microphone / Web Speech dictation** | ✗ Headless Chromium has no microphone or speech service. Logic (support detection, fallbacks, error mapping) is unit-tested, but live dictation needs a manual check in Chrome/Edge/Safari. |
| **MySQL 8 specifically, cloud deployment** | ✗ Not tested. |
| Cross-browser (Firefox/Safari), real-device mobile | ✗ Only Chromium at 1360px and 390px widths. |

## Quick start

**Prerequisites:** Node.js ≥ 20 (developed on 22). MySQL 8+ and an OpenAI key are **optional** in development.

```bash
npm install
cp .env.example .env          # optional in dev; leave DATABASE_URL commented out to use the in-memory store
npm run dev                   # API on :8787, web on :5173
```

Open http://localhost:5173. With no `.env` you get: in-memory storage (lost on restart), the local formatter instead of AI, and audio transcription reported as "not configured". The dashboard states each of these.

### With MySQL

```bash
mysql -e "CREATE DATABASE handwriting_assistant CHARACTER SET utf8mb4"
# in .env:  DATABASE_URL=mysql://USER:PASSWORD@localhost:3306/handwriting_assistant
npm run migrate               # applies server/migrations/*.sql, tracked in schema_migrations
npm run dev
```

### With OpenAI

Set `OPENAI_API_KEY` in `.env` (server-side only; it is never sent to or bundled into the frontend). This enables AI organisation and audio transcription.

## Configuration

All config is environment variables, validated at start-up (`server/src/config.ts`). See `.env.example`.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | In `production`, `DATABASE_URL` is **required** and cookies are `Secure`. |
| `PORT` | `8787` | |
| `CORS_ORIGIN` | `http://localhost:5173` | Comma-separated allowed origins. |
| `DATABASE_URL` | – | `mysql://user:pass@host:3306/db`. Empty → in-memory (dev only). |
| `OPENAI_API_KEY` | – | Empty → local formatter; transcription disabled. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Must support JSON-schema structured output. |
| `OPENAI_TRANSCRIPTION_MODEL` | `whisper-1` | |
| `AI_TIMEOUT_MS` | `30000` | Per provider call. |
| `MAX_AUDIO_MB` | `10` | Enforced server-side and pre-checked in the browser. |
| `ALLOW_MEMORY_STORE` | `false` | `true` lets `NODE_ENV=production` run without MySQL (demo hosting only). |
| `WEB_DIST_DIR` | `../web/dist` if present | Built web app served by the API (single-service hosting). |
| `TRUST_PROXY` | `0` | Set to the number of reverse-proxy hops so rate limiting sees real client IPs. |
| `VITE_API_BASE_URL` | empty (same origin) | Build-time, frontend only. See [Deployment](#deployment). |

## Scripts & testing

```bash
npm run dev          # API + web with reload
npm run build        # server bundle (server/dist) + web bundle (web/dist)
npm start            # run the built API (node server/dist/index.js)
npm run migrate      # apply SQL migrations to DATABASE_URL
npm run typecheck    # tsc for all workspaces (there is no separate ESLint config; `npm run lint` is an alias)
npm test             # shared + server + web (Vitest) – no network, no paid API calls
```

- **Mocked externals:** OpenAI is mocked in all automated tests.
- **MySQL contract tests** are skipped unless you provide a throw-away database:
  `TEST_DATABASE_URL=mysql://user:pass@127.0.0.1:3306/handwriting_test npm test -w server`
  (the same suite runs against the in-memory and MySQL repositories).
- **Browser E2E** (needs `npm run dev` running and Playwright with Chromium: `npm i -D playwright && npx playwright install chromium`):
  `node e2e/smoke.mjs` – writes screenshots, `export.pdf` and a PNG to `e2e/output/` and runs an axe-core scan.

What the tests cover: text validation and answer formatting, AI response schema validation, missing credentials and provider errors (rate limit, timeout, 5xx, malformed JSON), voice fallback planning, document CRUD + user isolation + idempotency + versions, pagination/page boundaries of the layout engine, PDF generation, API client error mapping, component states (loading/empty/error), and accessibility checks.

## Architecture

```
shared/   @hw/shared – Zod schemas & types, layout engine (wrapping, pagination, seeded variation),
          paper geometry, font metadata. Used by BOTH client and server so they can't drift.
server/   Express 5 + TypeScript
  src/ai/            provider interface, OpenAI provider (fetch + retry/backoff), local fallback,
                     versioned prompt (prompts/organize.v1.ts), output validation
  src/transcription/ OpenAI transcription provider
  src/db/            Repository interface; MemoryRepository + MysqlRepository (parameterised SQL), migrations
  src/export/pdf.ts  pdf-lib + @pdf-lib/fontkit, embeds server/assets/fonts/*.woff
  src/middleware/    session, rate limits, error handler
  migrations/        001_init.sql
  assets/fonts/      Caveat, Kalam, Patrick Hand (+ OFL licence text)
web/      React 19 + Vite + Tailwind 4
  src/pages/         Dashboard, Workspace (the 5-step flow)
  src/components/    StepInput/Organize/Review/Style/Export, VoiceInput, PreviewPane, Toasts, Dialog
  src/lib/           api client, speech hooks, canvas renderer, local draft backup, hash router
e2e/      Playwright smoke test
```

**Why the PDF and preview match:** the browser computes a *layout* (every line with position, size, rotation) using real font metrics. The canvas draws it for preview/PNG, and the same JSON is sent to `/api/export/pdf`, where `pdf-lib` draws identical lines with the embedded font. Variation is seeded, so there is no randomness between renders.

**OpenAI integration:** uses the official `openai` SDK behind a small provider interface (`server/src/ai/provider.ts`), so it is mocked in tests and can be swapped for another provider. Retries are handled with a bounded backoff.

## API

All errors use one envelope: `{"error":{"code","message","details?"}}`. Responses below are real output from the running server.

### `GET /api/health`
```json
{"status":"ok","store":"memory","ai":"local-fallback","transcription":false,"maxAudioMb":10}
```

### `POST /api/ai/organize-answer`
```bash
curl -X POST localhost:8787/api/ai/organize-answer -H 'Content-Type: application/json' -d '{
  "text": "mitosis is cell division. it makes two identical cells. it has four stages prophase metaphase anaphase and telophase",
  "mode": "short_notes", "subject": "Biology"
}'
```
```json
{
  "organized": {
    "title": "Mitosis is cell division",
    "sections": [{ "heading": "Biology", "paragraphs": [], "ordered": false,
                   "points": ["Mitosis is cell division.", "It makes two identical cells.", "It has four stages prophase metaphase anaphase and telophase."] }],
    "changeNotes": [{ "kind": "corrected", "description": "Normalised spacing, capital letters and sentence-ending punctuation." },
                    { "kind": "reorganized", "description": "Turned each sentence into a separate point." }],
    "addedContent": false
  },
  "text": "# Biology\n- Mitosis is cell division.\n- It makes two identical cells.\n- It has four stages prophase metaphase anaphase and telophase.",
  "provider": "local-fallback", "model": null, "promptVersion": "organize.v1",
  "warnings": ["No AI service is configured, so only basic formatting was applied (no rewriting). Set OPENAI_API_KEY on the server for full AI organisation."]
}
```
Optional fields: `question`, `level`, `length` (`short|medium|long`), `detail` (`concise|balanced|thorough`), `language`, `structure` (`introduction`, `mainPoints`, `examples`, `conclusion` booleans). Errors: `VALIDATION_ERROR` (400), `RATE_LIMITED` (429, this API's own limiter), `AI_RATE_LIMITED` (429, provider), `AI_TIMEOUT` (504), `AI_UNREACHABLE` / `AI_PROVIDER_ERROR` / `AI_AUTH_FAILED` / `AI_REQUEST_REJECTED` / `AI_EMPTY_RESPONSE` / `AI_INVALID_RESPONSE` (502). A missing API key is not an error: the local formatter runs and the response says `"provider": "local-fallback"`. Failed AI calls never alter the user's text.

### `POST /api/transcription` (multipart, field `audio`, optional `language`)
Without a provider (real response):
```json
{"error":{"code":"TRANSCRIPTION_NOT_CONFIGURED","message":"Audio transcription is not configured on this server (no OPENAI_API_KEY). Use browser dictation or type your answer instead - no transcript was produced."}}
```
Success: `{"text":"…","provider":"openai"}`. Files are validated for size, type and emptiness, are held in memory only and are never logged or stored.

### Documents (cookie-scoped; see [Security](#security-notes))
| Method & path | Notes |
|---|---|
| `POST /api/documents` | Body `{title, content}`. Header `Idempotency-Key` makes retries return the original document. → `201 {document}` |
| `GET /api/documents?limit=20&offset=0` | `{items, total, limit, offset}` (summaries only) |
| `GET /api/documents/:id` | `{document}` with full `content` |
| `PUT /api/documents/:id` | Replace; snapshots the previous version |
| `PATCH /api/documents/:id` | `{title?, content?}` (used by rename) |
| `POST /api/documents/:id/duplicate` | → `{document}` |
| `DELETE /api/documents/:id` | → `204` |
| `GET /api/documents/:id/versions` | `{versions:[{version,title,createdAt}]}` |
| `GET/PUT /api/preferences` | Default handwriting settings |

```bash
curl -c jar -b jar -X POST localhost:8787/api/documents -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: demo-key-0001' \
  -d '{"title":"Mitosis","content":{"rawText":"mitosis is cell division","bodyText":"# Mitosis\nMitosis is cell division."}}'
```
```json
{"document":{"id":"6e11c6ab-f1aa-4276-9d5b-81d4a5f95cf4","title":"Mitosis","mode":"notes","excerpt":"Mitosis Mitosis is cell division.","version":1,
 "createdAt":"2026-10-27T03:43:13.323Z","updatedAt":"2026-10-27T03:43:13.323Z","content":{ "...": "full draft incl. handwriting settings" }}}
```
Repeating the call with the same `Idempotency-Key` returned the same `id`; a request without the cookie got `{"items":[],"total":0,…}`.

### `POST /api/export/pdf`
Body `{title, layout}` where `layout` is produced by the web app's layout engine (`computeLayout` in `shared/`). Returns `application/pdf`. Minimal example (one line on one page):
```bash
curl -o out.pdf -X POST localhost:8787/api/export/pdf -H 'Content-Type: application/json' -d '{"title":"demo","layout":{
 "pageWidth":595.28,"pageHeight":841.89,"style":"caveat","paper":"ruled","inkColor":"#1f3fa0","pitch":26,"gridTop":64,"rows":28,
 "marginLeft":64,"marginRight":48,
 "pages":[{"lines":[{"text":"Hello world","x":64,"y":90,"fontSize":18,"rotation":0,"width":80,"kind":"body","underline":false}]}]}}'
# → 200 application/pdf, %PDF-1.7
```
Characters the fonts lack are replaced with `?` (and reported to the user in the UI) rather than drawn as empty boxes. The Letter/A4 sizes and paper types are part of `layout`.

## Database

`server/migrations/001_init.sql` (InnoDB, utf8mb4, UTC timestamps):

- `users` – anonymous per-browser identity (stores only the SHA-256 of the cookie token)
- `documents` – title, mode, short `excerpt`, `content` JSON, `version`, `idempotency_key` (unique per user), timestamps; index on `(user_id, updated_at)`
- `document_versions` – snapshot of the previous state before each update
- `user_preferences` – default handwriting settings
- `schema_migrations` – applied migrations

Generated PDFs/PNGs are **not stored**: rendering is deterministic, so exports are regenerated from the saved document. No binary blobs sit in document rows. (If you later add share links or cached exports, put them in object storage such as S3.)

## Security notes

- Secrets only via environment variables; `.env*` is git-ignored except `.env.example` (placeholders). The API key never reaches the browser.
- Zod validation on every body/query/upload; JSON limit 256 kB (2 MB for layouts); audio limited by `MAX_AUDIO_MB` + type/emptiness checks.
- Rate limits: 600 requests / 15 min / IP overall, 20 / min / IP on AI and transcription.
- `helmet`, explicit CORS allow-list with credentials, parameterised SQL only, error handler that never returns stack traces; access log records method/path/status/time only – **never request bodies or audio**.
- **Identity model:** documents are scoped to an anonymous, random, `httpOnly`, `SameSite=Lax` (`Secure` in production) cookie; only its hash is stored. Other browsers cannot read your documents (verified), but there are **no accounts** – clearing cookies loses access to your documents, and anyone with the cookie has access. See limitations.
- Browser dictation (Web Speech API) sends audio to the browser vendor's speech service (e.g. Google in Chrome). Server transcription sends audio to OpenAI. Tell your users.

## Deployment

I have **not** deployed this; the steps below follow from how the code works.

### Fastest: one URL on Render (free, demo)

The API can also serve the built web app, so one service gives you one URL (no CORS or cookie problems).

1. Push this repo to GitHub.
2. On https://render.com choose **New > Blueprint**, select the repo. `render.yaml` sets everything up (`ALLOW_MEMORY_STORE=true`, so documents are kept in memory and lost on restart; the free plan also sleeps after ~15 minutes idle, so the first load can take about a minute).
3. Optional: paste an `OPENAI_API_KEY` when asked to enable real AI and transcription.
4. Open the `https://….onrender.com` URL Render gives you.

For persistent storage, create a MySQL database (e.g. Aiven, PlanetScale-compatible, or your own), set `DATABASE_URL`, run `npm run migrate` once, and remove `ALLOW_MEMORY_STORE`.

### Separate hosts (frontend + API + MySQL)

**1. Database** – provision MySQL 8 (managed service or your own). Create a database and a least-privilege user. Run `DATABASE_URL=… npm run migrate` from a machine/CI job that can reach it.

**2. API** – any Node ≥ 20 host (Render, Railway, Fly.io, a VM, Docker):
```bash
npm ci && npm run build
NODE_ENV=production DATABASE_URL=… OPENAI_API_KEY=… CORS_ORIGIN=https://your-frontend TRUST_PROXY=1 npm start
```
Terminate TLS in front (cookies are `Secure` in production). Point health checks at `/api/health`. The in-memory store is refused in production.

**3. Frontend** – `npm run build -w web` produces static files in `web/dist` (Netlify, Vercel, Cloudflare Pages, S3+CDN, nginx).

> **Cookie caveat – pick one of these shapes.** Sessions rely on a `SameSite=Lax` cookie, which browsers will **not** send on cross-*site* `fetch` calls. So either
> 1. serve the frontend and proxy `/api/*` to the API **on the same origin** (nginx `location /api/`, or a Netlify/Vercel rewrite) and leave `VITE_API_BASE_URL` empty – **recommended**; or
> 2. use subdomains of one registrable domain (`app.example.com` + `api.example.com`), build the frontend with `VITE_API_BASE_URL=https://api.example.com`, and set `CORS_ORIGIN=https://app.example.com`.
>
> Putting the frontend on `*.vercel.app` and the API on `*.onrender.com` without a proxy will make saving silently fail to identify the user.

## Limitations & remaining work

**Known limitations**
- No user accounts or login: identity is an anonymous cookie (see above). Add real auth (e.g. email magic link/OAuth) before storing anything sensitive.
- Handwriting fonts cover **Latin** characters only (no Devanagari, Arabic, CJK…), even though the AI can output other languages; unsupported characters become `?` with a warning.
- Output is font-based: three styles, deterministic light variation. It is not a model of anyone's handwriting, by design.
- The in-memory development store loses data on restart; the UI says so.
- AI quality, cost and the default model are untested with a real key; the "no invented facts" rule is enforced by prompt + schema + flags (`addedContent`, `changeNotes`) but cannot be guaranteed – hence the mandatory review step.
- PDF fonts are embedded in full (not subset), so PDFs are slightly larger than necessary.
- Several stacked toasts can cover form fields on small phones until they auto-dismiss.
- No ESLint/Prettier config; type-checking is the static check.

**Ideas / not yet done**
- Account system and sharing; UI for browsing/restoring document versions (API exists).
- More handwriting fonts, per-user custom *own-handwriting* upload (with consent), richer layouts (diagrams, tables, equations).
- Streaming transcription, background job queue for long audio, per-user AI quotas.
- CI pipeline (typecheck + tests + MySQL service container + E2E), Dockerfile, E2E in more browsers.

## Licences

Code: choose your own (none set). Fonts: Caveat, Kalam, Patrick Hand under the SIL Open Font License 1.1 – licence texts are in `server/assets/fonts/`.
