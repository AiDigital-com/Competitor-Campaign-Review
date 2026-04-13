# AIDigital Labs — [App Name]

> App-specific context for Claude Code.

## App Info

| Field | Value |
|-------|-------|
| App | [App Name] |
| URL | https://[slug].apps.aidigitallabs.com |
| Repo | `AiDigital-com/[RepoName]` |
| Netlify Site ID | `[site-id]` |
| Purpose | [Brief description] |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, TypeScript |
| Auth | Clerk (@clerk/react, @clerk/backend) |
| Database | Supabase PostgreSQL (@supabase/supabase-js) — RLS + Realtime |
| AI | LLM Wrapper via DS (`createLLMProvider`) — Gemini/Claude/OpenAI/xAI |
| Backend | Netlify Functions (AI agents only — CRUD via PostgREST) |
| Hosting | Netlify (static + serverless) |
| Design System | @AiDigital-com/design-system v7.39+ |

## Architecture

```
src/
  main.tsx              <- Entry: ClerkProvider + applyTheme + resolveTheme
  App.tsx               <- AppShell wrapper + domain logic + supabaseConfig
  pages/
    HelpPage.tsx        <- Public help page (no auth)
  components/           <- App-specific components
  hooks/
    useOrchestrator.ts  <- Chat orchestration (SSE streaming)
  lib/
    types.ts            <- Domain types
netlify/
  functions/
    _shared/
      auth.ts           <- requireAuth + requireAuthOrEmbed (Clerk/embed/API key)
      supabase.ts       <- Supabase service-role client (Proxy pattern)
      logger.ts         <- createLogger from design system
      access.ts         <- checkAccess/recordUsage wrapper
    api-status.mts      <- MCP/API status endpoint (uses DS handleApiStatus)
    orchestrator.mts    <- Chat AI agent (Gemini SSE streaming)
    init-user.mts       <- User upsert (fallback for RPC)
    admin-accounts.mts  <- Admin panel data
netlify.toml            <- Build config + redirects (/help, SPA fallback)
```

## Key Patterns

- **Supabase Direct:** Client-side CRUD uses `supabase` (from AppShell context), not Netlify Functions
- **authFetch:** Only for Netlify Functions (AI agents, background jobs)
- **Help Page:** Rendered at `/help` without auth, using `HelpPage` component from design system
- **Theme:** `resolveTheme()` auto-selects theme based on URL/domain
- **Sidebar Bridge:** Use React context to share state between sidebar (rendered by AppShell) and main content

## Environment Variables

**All shared env vars are set at Netlify team level** (account: `aidigital-operating-llc`).
New sites inherit them automatically. No manual setup needed for:
- `NPM_TOKEN`, `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- `GEMINI_API_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

Only add site-level vars for app-specific config (e.g., `ADMIN_EMAILS`).

## New App Setup Checklist

1. Clone this template and rename
2. Create GitHub repo under `AiDigital-com` org
3. Create Netlify site via API under `aidigital-operating-llc` account
4. **Link Netlify site to GitHub repo** (CRITICAL for auto-deploy):
   ```
   PATCH https://api.netlify.com/api/v1/sites/{site_id}
   Body: { "repo": {
     "provider": "github",
     "repo": "AiDigital-com/{REPO_NAME}",
     "branch": "main",
     "cmd": "npm run build",
     "dir": "dist",
     "installation_id": 120161952
   }}
   ```
5. **Create `develop` branch** and enable branch deploys on Netlify site
6. Env vars are automatic (team-level) — staging Supabase for branch-deploy, prod for production
7. Customize AppShell props (appTitle, activityLabel, helpUrl)
8. Replace placeholder sidebar with app-specific sidebar
9. Implement orchestrator with Gemini SSE streaming
10. Build domain-specific logic on `develop` branch
11. Run E2E staging tests, then merge to `main` for production deploy

## SDLC & Deploy Process

**IMPORTANT: Follow this process for ALL changes. No exceptions.**

### Environments

| Environment | Branch | Supabase | URLs |
|-------------|--------|----------|------|
| Local dev | any | staging (rqpvrikighrlgjxzkqde) | localhost:5173 |
| Staging | `develop` | staging (rqpvrikighrlgjxzkqde) | develop--{site}.netlify.app |
| Production | `main` | production (njwzbptrhgznozpndcxf) | {app}.apps.aidigitallabs.com |

### Workflow

1. **All work on `develop` branch** — never push directly to `main`
2. **Push to develop** → staging auto-deploys with staging Supabase
3. **E2E testing optional** during development (run at discretion)
4. **"Ship it" triggers mandatory pipeline:**
   - Pre-deploy: E2E smoke + workflow on staging (must pass)
   - Merge develop → main
   - Post-deploy: E2E smoke + workflow on production (must pass)
   - Auto-update: developer docs, user guides, screenshots, CLAUDE.md, memory

### E2E Commands (run from Design System repo)

```bash
npm run test:staging:smoke     # staging smoke tests
npm run test:staging:full      # staging smoke + workflow
npm run test:prod:smoke        # production smoke tests
npm run test:prod:full         # production smoke + workflow
```

### Clean Sweep Protocol

End every session with Clean Sweep protocol. After major feature work, run the Clean Sweep from the DS repo to sync docs, templates, and CLAUDE.md across the portfolio.

### Gemini Model Policy

- **Never use Gemini models prior to 3.0.** All legacy 2.x models are deprecated.
- **gemini-3-flash-preview** — orchestrator (chat), visualizer parallel extraction
- **gemini-3.1-pro-preview** — deep audit agents, background report generation
- SDK: `@google/genai` must be v1.46.0+

### Hotfixes

For critical production issues: push directly to `main`, then backmerge to `develop`.

## Standing Instructions

- Execute all bash commands, git commits, pushes, API calls, and deploys without asking for confirmation
- Always use `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>` in commits
- Work on `develop` branch by default unless told otherwise
- For full portfolio architecture (all apps, env vars, API keys), see `CLAUDE.md` in `AIDigital-Labs-Design-System`

## Development Environment

- **OS:** Windows 11
- **Shell:** Git Bash (use Unix paths with forward slashes)
- **PATH:** Always set `export PATH="/c/Program Files/nodejs:$PATH"` before npm commands
- **Git push:** Use credential-embedded URL due to tty limitations
