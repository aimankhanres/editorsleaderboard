# Editor Leaderboard

Live dashboard ranking video editors by the Meta ad spend on ads built from their briefs.
Modelled on our existing strategist leaderboard (dark theme, month tabs, top-3 podium,
ranked list with rank-change arrows, "no longer with us" tags).

## How attribution works (the core rule)

1. Triple Whale has every ad with its spend. Ad names contain a brief ID like `OO-19041`.
2. **The brief ID only identifies a ClickUp task.** It says nothing about who the editor is.
3. Each ClickUp task has a custom field named **Editor** (name configurable via
   `CLICKUP_EDITOR_FIELD`). That field is the source of truth for who gets the spend.
4. Spend for the ad is credited to the editor(s) in that field.

Details:
- Use **ad-level** rows only. Never sum ad sets or campaigns (double-counting).
- Brief ID regex: `OO[-_ ]?\d+`, case-insensitive, normalised to `OO-<digits>` (see `lib/briefs.ts`).
- The same brief ID on several ads (duplicates and copies) rolls up to the same task.
- An ad with 2 brief IDs: split spend evenly across the briefs.
- A task with 2 editors: `SPLIT_MODE=split` gives each an equal share; `SPLIT_MODE=joint`
  credits the pair as one entry ("A / B").
- Nothing gets silently dropped. Ads with no brief ID, briefs with no matching task, and tasks
  with an empty Editor field all go into a "Needs review" list with their spend.
- Verification: many ad names also contain the editor's name (e.g. `9x16_Vincent_H1_OO-14983`).
  ClickUp still wins, but flag ads where the name mentions a known editor who isn't the one in
  ClickUp. Strategist names (Liran, Farwa, etc.) also appear in names; only match against the
  editor roster.
- First step: inspect a few real tasks (e.g. OO-19041, OO-14983) to confirm whether `OO-xxxx` is
  the ClickUp custom task ID or stored in a custom field, and what type the Editor field is
  (people / dropdown / text). Handle all three types.

## Stack

- Next.js 14 (App Router, TypeScript) deployed on Vercel from GitHub (`main` = production).
- Neon Postgres via the Vercel Marketplace (`DATABASE_URL`). Schema in `db/schema.sql`,
  applied with `npm run db:init`.
- Scheduler: Vercel Cron hitting `/api/sync` every 15 min (`vercel.json`). If we stay on the
  Hobby plan, use a GitHub Actions scheduled workflow calling the same URL with `CRON_SECRET`.
- No API calls from the browser. The sync route writes to Postgres; the page reads from
  `/api/leaderboard`.

## Data flow

```
/api/sync (cron, protected by CRON_SECRET)
  1. Triple Whale: ad-level daily spend, month-to-date (also the previous month during days 1-3)
  2. Upsert into ad_spend with extracted brief_ids
  3. For brief IDs that are new or stale in brief_map: ClickUp GET task -> read Editor field
     - Lookup: GET /api/v2/task/{OO-id}?custom_task_ids=true&team_id=...  (if OO is the custom ID)
       else filter team tasks by CLICKUP_BRIEF_FIELD_ID
     - Throttle to stay under ~100 req/min, cap per run (MAX_CLICKUP_LOOKUPS_PER_RUN),
       stop on 429, keep within the function time limit
  4. Compute the month's leaderboard, write today's snapshot rows
  5. Log to sync_runs
/api/leaderboard?month=YYYY-MM
  - Aggregate ad_spend x brief_map at read time (so editor reassignments apply retroactively)
  - Rank change = compare with the previous day's snapshot
  - Return editors, review items, totals, months available, last sync status
  - With no DATABASE_URL, return demo data so the UI can be previewed locally
/api/clickup-webhook (optional)
  - Verify X-Signature (HMAC-SHA256 with CLICKUP_WEBHOOK_SECRET)
  - On task updates, mark that task's brief_map row stale so the next sync refetches it
```

## Triple Whale: verify before relying on it

Confirmed from the docs (triplewhale.readme.io, Nov 2026), not yet against a live key:
`POST https://api.triplewhale.com/api/v2/orcabase/api/sql` with `x-api-key`, body
`{ shopId, query, period: { startDate, endDate } }`, rows in `data`. Table `ads_table`
(`event_date, channel, campaign_name, adset_name, ad_id, ad_name, spend`), Meta channel
`facebook-ads`, ClickHouse SQL, `@startDate`/`@endDate` placeholders, 600 req/min. Row limits are
undocumented, so `lib/triplewhale.ts` queries one month per request.
Run `/api/sync?dry=1` and compare with Ads Manager before trusting it.
Fallback: the Meta Marketing API `/insights?level=ad` gives the same spend numbers.

## Status

Built (Nov 2026): everything in the data flow above, the UI, optional shared-password gate
(`APP_PASSWORD`, `middleware.ts`), GitHub Actions fallback scheduler, README.

Findings from the live ClickUp workspace:
- `OO-xxxx` is stored in the short_text custom field **Brief ID** (`f129c811-0d3b-481d-9971-eb0b10bcf746`).
  Custom task IDs are `RS-xxxx` and do not reliably share the number, so lookups use `CLICKUP_BRIEF_FIELD_ID`.
- **Editor** is a `users` field. Tasks also have **Sr Editor** and **Strategist** users fields; match the
  field name exactly.
- Resize variants (Google/YT Variants folder) have their own Brief ID plus an **Old Brief Id** field and
  names like `OO-24590_rOO-19041_...`. `rOO-` is not extracted as a brief ID.
- OO-19041 and OO-14983 have no task with that Brief ID (they only appear as Old Brief Id), so ads
  carrying them land in Needs review as "Brief not found".

Still open:
- Triple Whale client written from the docs but not yet run against a real key: use `/api/sync?dry=1`.
- Access control decision (shared password is in; Google sign-in not built).

## Conventions

- Never commit secrets. All keys live in Vercel environment variables and `.env.local`.
- Money is stored as numeric(14,2); format in the UI as $1.24M / $943.6K / $952.
- Keep the ClickUp and Triple Whale code isolated in their own files so either can be swapped.

## Commands

- `npm run dev`: local dev (demo data if no DATABASE_URL)
- `npm run db:init`: create tables
- `vercel env pull .env.local`: pull env vars from Vercel
