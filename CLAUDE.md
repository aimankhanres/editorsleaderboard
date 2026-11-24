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
- Brief ID regex: `(OO|AOG|CIN)[-_ ]?\d+` (Oregano, Garlic, Cinnamon), case-insensitive, normalised to
  `PREFIX-<digits>`; a prefix glued to a letter (`rOO-`, `rCIN-`, `iCIN-`) is ignored (see `lib/briefs.ts`).
- Internal briefs are named by number: `#103_W2_cs:MIA_pn: AOG_Offer…` (no OO-/AOG- ID in the ad). Key `AOG#103-W2`
  (product from `pn`, optional; week optional; needs `_W<n>` or `_cs` after the number, so `… .mp4 #3` is ignored).
  Resolved from the task mirror `cu_tasks` (task name starts `#103_W2`, editor set, not a "Cross Launch" copy, oldest
  first), not the ClickUp API. `GET /api/sync?requeue=internal` re-resolves them.
- Bare-number fallback: an ad name with no prefixed brief ID (`PDP + b.h [23755 vh]`, `102186 PDP`) first uses a prefix glued to the number (`RSOO-4547` -> OO-4547, exact),
  else gets
  each standalone 4-6 digit number as `#23755` (not years 2010-2039, prices, dimensions, or numbers glued to a letter).
  The lookup tries OO-/AOG-/CIN-<n>; credited only if exactly one prefix finds a task, otherwise Needs review lists
  the candidates. After changing extraction rules, run `GET /api/sync?reextract=1` to rewrite stored brief_ids.
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

## Teams (what the dashboard shows)

- Boards: **Resizing**, **Iterations** and **Rips** (Resizing group), **Iterations** (own group), plus the Internal, Variations and Agency teams from the org chart. Rips (Clariz, Ayyaz, Cristian, Jasmin, Lucy: only on Rips, not Resizing;
  credited with all their ClickUp work for now, a rip-only task filter is still to be defined since nothing in
  ClickUp marks rips yet), defined in
  `lib/teams.ts` by ClickUp user id. Only listed
  people appear; members with no spend this month are listed under "No spend yet". Ranks and rank changes
  are within each team (`buildTeams`). Attribution itself is unchanged: an editor's spend is everything
  credited to them via the Editor field, whatever the task type.
- To add/move someone, edit `lib/teams.ts` and push.

## Capacity screen (`/capacity`, burger menu)

- Edits finished per editor per day/week vs team KPI (`kpi` in `lib/teams.ts`): Resizing 2/day, 14/week; every other
  team (incl. Iterations, Rips) 1/day, 5/week. Workdays = perWeek / perDay from Monday (7 for Resizing, Mon–Fri else).
- Source: `cu_tasks`, a mirror of every ClickUp task with an Editor, kept by `/api/tasks-sync` (2nd step of the GitHub
  workflow; incremental by date_updated, oldest first, resumable; state in `kv.tasks_sync`). A task is done on its
  "Edit Complete Date" (fallback "Asset Delivered Date"), bucketed in `CAPACITY_TIMEZONE` (default Asia/Karachi).
  Two editors on a task: counts for both. "Open" = Editor Assigned Date in the last 45 days, not finished.
- Teams: all editing teams from the Nov 2026 org chart, grouped Resizing (Resizing + Rips) / Iterations / Internal / Variations / Agency. Capacity has one tab per team
  (Resizing + Rips share the Resizing tab). Agency
  editors are mostly not in Resilia's ClickUp (`id: null`): listed, but nothing can be counted or credited.
- The attribution page shows the same teams, with a group switcher above the team tabs.

## Channels

- Meta (`facebook-ads`, all campaigns) and Google (`google-ads`, only `DEMAND_GEN` / `VIDEO` campaign types;
  Search/Shopping/Display have no editor creatives). Defined in `lib/channels.ts`. Google ad ids are stored
  with a `g:` prefix. The UI has a Meta / Google / All switch (`/api/leaderboard?channel=`); Meta is the default.
- Snapshots are per view: Meta uses the plain editor key, others are prefixed (`google|u:1`, `all|u:1`).

## Ad-name check

- "Ad name mentions a different editor" only looks for people on the team lists (`lib/teams.ts`): first name,
  plus a bracketed nickname ("Lucylen (Lucy) Pagado"). Informational only; the spend stays credited per ClickUp.

## Winner ads

- An ad is a winner when that single ad's spend in the selected period/channel is >= `WINNER_SPEND` (default
  40000 USD). It counts for every editor credited on it (shared ads count for each) and once per team.
  Computed in `allocate()`. The expanded row lists winner ads above the full brief list (stacked, one column).

## Custom date ranges

- `/api/leaderboard?from=YYYY-MM-DD&to=YYYY-MM-DD` (inclusive) sums spend over exactly those days
  (`store.loadAds`). Rank changes are hidden for custom ranges. The UI has a "Custom…" date picker with presets.
  Only days already synced are available (`dataFrom`/`dataTo` in the payload).

## Stack

- Next.js 14 (App Router, TypeScript) deployed on Vercel from GitHub (`main` = production).
- Neon Postgres via the Vercel Marketplace (`DATABASE_URL`). Schema in `db/schema.sql`,
  applied with `npm run db:init`.
- Scheduler: we are on the Vercel Hobby plan (daily crons only), so `.github/workflows/sync.yml`
  calls `/api/sync` every 15 min with `CRON_SECRET` (repo secrets `SYNC_URL`, `CRON_SECRET`).
  There is no `vercel.json`; on Pro, a Vercel cron could replace the workflow.
- No API calls from the browser. The sync route writes to Postgres; the page reads from
  `/api/leaderboard`.

## Data flow

```
/api/sync (cron, protected by CRON_SECRET)
  1. Triple Whale: ad-level daily spend for the last 3 days plus 3 older days of the month in rotation (also the
     previous month during days 1-3); `?full=1` refetches the whole range. Keeps runs well under the 300s limit.
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
- `OO-` / `AOG-` / `CIN-` IDs are stored in the short_text custom field **Brief ID** (`f129c811-0d3b-481d-9971-eb0b10bcf746`).
  Custom task IDs are `RS-xxxx` and do not reliably share the number, so lookups use `CLICKUP_BRIEF_FIELD_ID`.
- **Editor** is a `users` field. Tasks also have **Sr Editor** and **Strategist** users fields; match the
  field name exactly.
- Resize variants (Google/YT Variants folder) have their own Brief ID plus an **Old Brief Id** field and
  names like `OO-24590_rOO-19041_...`. `rOO-` is not extracted as a brief ID.
- 6-digit brief IDs (OO-102573, AOG-100721, CIN-102186 ...) are created in a separate ClickUp workspace
  (resize tasks link to the original via the "Org Task ID" field); our token can't read it. Per the team's
  decision, their spend is credited to the Editor(s) of the resize tasks here whose **Old Brief Id** field
  (`CLICKUP_OLD_BRIEF_FIELD_ID`, default 6d5035b2-…) equals that brief AND whose name carries the resize
  reference `r<brief>` (e.g. `16x9_AOG-26331_rAOG-100721_…`; iterations also set Old Brief Id but are
  excluded), split evenly; the task name shows
  "Via resize: …". With no such resize task they stay under "Made in another ClickUp workspace".
  `GET /api/sync?requeue=other` re-queues 6-digit not-found briefs for lookup.
- OO-19041 and OO-14983 have no task with that Brief ID (they only appear as Old Brief Id), so ads
  carrying them land in Needs review as "Brief not found".

Triple Whale (verified against the live API, Nov 2026):
- The API returns a bare JSON array of rows, not `{ data }` as documented. Both are accepted.
- Large result sets fail with a bare `400: An error occurred`, so spend is fetched one day per request,
  paged with LIMIT/OFFSET, zero-spend ads dropped. `?diag=1` runs query variants to debug.
- ClickHouse SELECT aliases must not reuse column names (they shadow columns in WHERE).
- Nov 1-16 2026: $11.94M Meta spend, ~25% on OO- briefs; the rest mostly AOG-/CIN-.

Still open:
- Access control decision (shared password is in; Google sign-in not built).

## Conventions

- Never commit secrets. All keys live in Vercel environment variables and `.env.local`.
- Money is stored as numeric(14,2); format in the UI as $1.24M / $943.6K / $952.
- Keep the ClickUp and Triple Whale code isolated in their own files so either can be swapped.

## Commands

- `npm run dev`: local dev (demo data if no DATABASE_URL)
- `npm run db:init`: create tables
- `vercel env pull .env.local`: pull env vars from Vercel
