# AIDigital Labs — App Template

> Starter template for new AIDigital Labs tools.
> Clone this repo, follow the setup steps, and start building.

## What This Template Provides

- React 19 + Vite + TypeScript boilerplate
- `@boriskulakhmetov-aidigital/design-system` v7.10+ pre-wired
  - `applyTheme(resolveTheme())` in main.tsx
  - `style.css` imported for all component styles
  - `AppShell` wrapping the app (auth, layout, header, admin panel, Supabase Realtime)
  - `ChatPanel` with placeholder orchestrator
  - `HelpPage` component for public help route
- Clerk auth (ClerkProvider in main.tsx, AppShell handles auth gates)
- Supabase integration (client-side via AppShell, server-side via Proxy pattern)
- Netlify Functions stubs:
  - `_shared/auth.ts` — Clerk JWT verification (requireAuth)
  - `_shared/supabase.ts` — Supabase service-role client (Proxy pattern)
  - `_shared/logger.ts` — Structured logging via design system
  - `_shared/access.ts` — Tier/status gating + usage tracking
  - `orchestrator.mts` — Chat AI agent stub (Gemini SSE)
  - `init-user.mts` — User upsert via Supabase RPC
  - `admin-accounts.mts` — Admin panel data stub
- `netlify.toml` with build config, redirects, security headers
- `.npmrc` for GitHub Packages auth
- `.env.example` with required variables (Supabase, Clerk, Gemini)
- Help page at `/help` (no auth required)

## Setup Steps for a New App

### 1. Clone and Rename

```bash
git clone https://github.com/boriskulakhmetov-aidigital/AIDigital-Labs-App-Template.git MyNewApp
cd MyNewApp
rm -rf .git
git init
```

### 2. Create GitHub Repo

```bash
git remote add origin https://github.com/boriskulakhmetov-aidigital/MyNewApp.git
git add -A && git commit -m "feat: initial app from template"
git branch -M main && git push -u origin main
```

### 3. Create Netlify Site

```bash
npx netlify-cli sites:create --name my-new-app --account-slug aidigital-operating-llc
npx netlify-cli api updateSite --data '{"site_id":"SITE_ID","body":{"custom_domain":"my-app.apps.aidigitallabs.com"}}'
```

### 4. Link Netlify to GitHub (CRITICAL)

Without this, pushes to main will NOT trigger auto-deploys:

```
PATCH https://api.netlify.com/api/v1/sites/{site_id}
Body: { "repo": {
  "provider": "github",
  "repo": "boriskulakhmetov-aidigital/{REPO_NAME}",
  "branch": "main",
  "cmd": "npm run build",
  "dir": "dist",
  "installation_id": 114303162
}}
```

### 5. Environment Variables

**All shared env vars are set at Netlify team level.** New sites inherit them automatically.
No manual setup needed. Only add site-level vars for app-specific config.

### 6. Create Local .env.local

Copy `.env.example` to `.env.local` and fill in real values from the design system CLAUDE.md.

### 7. Customize the App

1. **App.tsx:** Change `appTitle`, `activityLabel`
2. **main.tsx:** Already configured (no changes needed)
3. **Sidebar:** Replace `PlaceholderSidebar` with your app's sidebar
4. **Orchestrator:** Implement `netlify/functions/orchestrator.mts` with Gemini SSE
5. **Database:** Add your app-specific queries to `_shared/supabase.ts`
6. **Help page:** Update `src/pages/HelpPage.tsx` with your app's guide
7. **CLAUDE.md:** Update with your app's specific context

### 8. Deploy

```bash
npm run build
npx netlify-cli deploy --prod --dir=dist --site=YOUR_SITE_ID
```

## Project Structure

```
src/
  main.tsx              <- Entry: ClerkProvider + applyTheme + resolveTheme
  App.tsx               <- AppShell + domain logic + supabaseConfig
  App.css               <- App-specific styles
  index.css             <- Global reset (theme vars from applyTheme)
  pages/
    HelpPage.tsx        <- Public help page (no auth)
netlify/
  functions/
    _shared/
      auth.ts           <- Clerk JWT verification (requireAuth)
      supabase.ts       <- Supabase service-role client (Proxy)
      logger.ts         <- Structured logging
      access.ts         <- Tier gating + usage tracking
    orchestrator.mts    <- Chat AI agent (Gemini SSE)
    init-user.mts       <- User upsert
    admin-accounts.mts  <- Admin panel queries
netlify.toml            <- Build + redirects + security headers
.env.example            <- Required env vars (copy to .env.local)
.npmrc                  <- GitHub Packages auth
```

## Design System Components Available

Import from `@boriskulakhmetov-aidigital/design-system`:

**App Shell:** AppShell, BrandMark, ThemeToggle, LogoRenderer
**Chat:** ChatPanel, MessageBubble, UploadZone
**Navigation:** Sidebar (renderItem), AdminPanel (self-contained)
**Reports:** ReportViewer, DownloadBar, ShareBar, ReportSidebar
**Primitives:** ScorePill, SeverityBadge, PriorityBadge, SectionDivider, PageHeader, BriefSection/BriefRow, CollapsibleRow, ActionCard, KpiTile, AssetPreview, ReportTable, ProtocolBlock
**Visualization:** ValueEffortChart, ImpactTable, SVGRing, StepList, ProgressBar, Spinner
**Utilities:** renderMarkdown, downloadMarkdown, downloadPDF, slugify, groupByDate
**Themes:** applyTheme, resolveTheme, aiLabsTheme, aiDigitalTheme, ThemeConfig
**Pages:** HelpPage
**Server:** createLogger (logger), checkAccess, recordUsage, getUserOrgId (access)

## Architecture Reference

For the full portfolio architecture (all apps, env vars, API keys, conventions), see `CLAUDE.md` in `AIDigital-Labs-Design-System`.
