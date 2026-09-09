# Prospera

**Prospera** (Funding Opportunities) is a UCSF-adjacent app for research development: **Simpler.Grants.gov** funding data in **Supabase**, **investigator** profiles (CSV + normalization), deterministic **PI ↔ NOFO matches**, and Match Center review tools. Connected to OCR and ImmunoX. This is **not** a submission, budget, or proposal-writing system.

## Stack

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind CSS**
- **Supabase** (Postgres, Auth, RLS)
- **Zod** where forms/actions validate input
- **Simpler.Grants.gov** REST API (`POST /v1/opportunities/search`) → `funding_opportunities`
- **OpenAI** (optional) for PI community narrative / charts copy on **Community Snapshot**

## Prerequisites

- Node 20+
- A [Supabase](https://supabase.com) project
- Apply SQL migrations (Supabase CLI or **SQL Editor**), in filename order

## Environment variables

Copy `.env.example` to `.env.local`:

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key (browser + server) |
| `SUPABASE_SERVICE_ROLE_KEY` | Cron / admin scripts | Service role; never expose to the browser |
| `SIMPLER_GRANTS_API_KEY` | No | Simpler sync into `funding_opportunities` (server-only) |
| `SIMPLER_GRANTS_API_BASE_URL` | No | Default `https://api.simpler.grants.gov` |
| `OPENAI_API_KEY` | No | Optional narrative on **Community Snapshot** |
| `NCBI_CONTACT_EMAIL` | No | Politeness header for PubMed E-utilities on PI pages |
| `CRON_SECRET` | No | Bearer secret for Vercel Cron / `POST` or `GET /api/cron/*` |

## Supabase setup

1. Create a project in Supabase.
2. Run every file under `supabase/migrations/` **in lexicographic (timestamp) order** in the **SQL Editor** (or `supabase db push`).
3. **Authentication → Providers**: enable **Email** (password).
4. Sign up once from `/login`.
5. (Optional) promote an admin user:

```sql
update public.profiles set role = 'admin' where email = 'you@university.edu';
```

RLS allows all `authenticated` users full access to app tables for this MVP.

## Local development

```bash
npm install
cp .env.example .env.local
# fill NEXT_PUBLIC_* from Supabase

npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you will be redirected to `/login` until a session exists.

### Seed script

`npm run seed` prints a short notice only (legacy Grants.gov / watchlist seeding was removed). Use **Match Center** and **Funding Opportunities** in the app to load data.

### Tests

```bash
npm test
```

## NIH investigators, Simpler funding, and matching

1. **Investigators**: CSV import from **Investigators**; normalization fills `investigator_profile_features`.
2. **Funding**: set `SIMPLER_GRANTS_API_KEY`, then **Sync Simpler** (Funding Opportunities or Match Center).
3. **Features**: re-extract `opportunity_features`, then **Recompute** suggested matches (per PI, per NOFO, or batch in Match Center).
4. **Cron** (optional): see [Vercel Cron](#vercel-cron-nightly-funding-sync) below.

Scoring lives under `src/lib/matching/` (`weights.ts`, `score-match.ts`, explanations). `matches` rows use `funding_opportunities.id` as `opportunity_id`.

See `docs/IMPLEMENTATION_PLAN_MATCHING.md` for historical design notes (some items predate the current schema).

## Vercel deployment

Production: **https://prospera.ucsf.edu** — the address to give anyone in the office.

The Vercel project is **prospera**; its `*.vercel.app` deployment URLs are build artifacts, not the app's address. Do not paste one into a document or an email — they are not stable, and a strategist who followed the one this line used to carry got `DEPLOYMENT_NOT_FOUND`.

1. Import the repo into Vercel as the **prospera** project (one project only — do not create a second deployment for the same repo).
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Add server-only secrets (`SIMPLER_GRANTS_API_KEY`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) only where those routes/scripts run.
4. Add your site URL under Supabase **Authentication → URL Configuration** if you use email links.

### Vercel Cron (nightly funding sync)

The **Funding Opportunities** list is refreshed from **Simpler.Grants.gov** (Grants.gov NIH/federal notices), not the NIH RePORTER project API. RePORTER is used separately for investigator grant history on PI pages.

`vercel.json` schedules a production cron:

| Schedule (UTC) | Route | Purpose |
|----------------|-------|---------|
| `0 8 * * *` | `GET /api/cron/sync-funding-opportunities` | Full Simpler sync (up to 5,000 notices per run) |

`0 8 * * *` is **midnight US Pacific (PST)**. During daylight saving time the job runs at **1:00 AM Pacific**. To use another local midnight, change the hour in `vercel.json` (cron is always UTC) and redeploy.

**Setup on Vercel**

1. Generate a long random `CRON_SECRET` and add it under **Project → Settings → Environment Variables** (Production).
2. Ensure `SIMPLER_GRANTS_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are set for Production.
3. Deploy to **production** (cron jobs do not run on preview deployments).
4. After deploy, open **Project → Settings → Cron Jobs** and confirm `sync-funding-opportunities` is listed.

Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron invocations when that variable is set. You can also trigger manually:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  "https://prospera.ucsf.edu/api/cron/sync-funding-opportunities"
```

Other cron routes (same `CRON_SECRET`):

- `GET /api/cron/refresh-investigator-caches` — PubMed + NIH RePORTER per investigator (slow; not scheduled by default)
- `GET /api/cron/funding-search-notifications` — saved-search email digests (needs Resend)

## Project layout (high level)

- `src/app/` — routes, `api/cron/*`, server actions under `app/actions`
- `src/lib/ingestion/simpler-grants/` — Simpler API client
- `src/lib/normalization/` — synonym dictionaries + text → tags
- `src/lib/investigators/` — PI feature normalization
- `src/lib/funding-opportunities/` — NOFO feature extraction
- `src/lib/matching/` — retrieval, scoring, explanations
- `src/lib/services/` — Simpler sync, sync job logs, activity logging
- `src/lib/queries/` — dashboard data
- `supabase/migrations/` — schema + RLS

## Routes

| Path | Description |
|------|-------------|
| `/login` | Email / password |
| `/dashboard` | Counts and links into funding + investigators |
| `/funding-opportunities` | Simpler-sourced list (filters, sort) |
| `/funding-opportunities/[id]` | NOFO detail, features, matches, cutoff |
| `/investigators` | PI directory + CSV import |
| `/investigators/[id]` | Profile + ranked funding matches |
| `/portfolio-intelligence` | Watched-community overview, investigator drill-down, community view |
| `/portfolio-intelligence/data-sources` | PubMed / RePORTER / CT bulk refresh, signal sync, UCSF News backfill |
| `/portfolio-intelligence/engagements` | Strategist engagement list + create |
| `/portfolio-intelligence/engagements/[id]` | Edit engagement |
| `/pi-community` | Redirects to `/portfolio-intelligence` (legacy URL) |
| `/admin/matching` | Review queue, batch jobs, sync logs (admin) |
| `/settings` | Profile readout |

## License

Private / institutional use — adjust as needed.
