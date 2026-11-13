# Editor Leaderboard

Ranks editors by the Meta spend on ads made from their briefs. Spend comes from Triple Whale;
brief IDs (`OO-xxxx`) in ad names identify ClickUp tasks; each task's **Editor** field says who
gets the credit. See `CLAUDE.md` for the full spec.

## Run it locally (demo data)

```bash
npm install
npm run dev
```

With no `DATABASE_URL` the page shows invented demo data, so you can check the UI without any keys.

## Deploy

1. Push this folder to a new GitHub repo (`main` = production).
2. Import the repo in Vercel.
3. In the Vercel project, open **Storage** and add **Neon Postgres**. `DATABASE_URL` is set for you.
4. Add the rest of the variables from `.env.example` in **Settings → Environment Variables**.
   Generate `CRON_SECRET` with `openssl rand -hex 32`.
5. Locally: `npm install`, `vercel env pull .env.local`, `npm run db:init` (creates the tables).
6. **Check Triple Whale first** (nothing is written):
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" "https://<app>.vercel.app/api/sync?dry=1"
   ```
   Compare `total` with Meta Ads Manager for the same dates (month-to-date, account time zone).
7. Run the first real sync:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>.vercel.app/api/sync
   ```
   Each run looks up at most `MAX_CLICKUP_LOOKUPS_PER_RUN` (80) briefs, so the first month fills in over
   a few runs. Until then those ads show under **Needs review → Waiting for ClickUp lookup**.

### Scheduling

- **Pro plan:** `vercel.json` runs `/api/sync` every 15 minutes. Nothing else to do.
- **Hobby plan:** Vercel only allows daily crons, so a `*/15` cron makes the deploy fail. Remove the
  `crons` entry from `vercel.json` and use `.github/workflows/sync.yml` instead: add repo secrets
  `SYNC_URL` (`https://<app>.vercel.app/api/sync`) and `CRON_SECRET`.

### ClickUp webhook (optional, makes editor changes show up faster)

Without it, every brief is re-checked every `EDITOR_REFRESH_HOURS` (6). To pick up changes sooner,
create a webhook (`POST https://api.clickup.com/api/v2/team/{team_id}/webhook`) with endpoint
`https://<app>.vercel.app/api/clickup-webhook` and events `taskUpdated`. Put the `secret` from the
response in `CLICKUP_WEBHOOK_SECRET`.

### Access

Set `APP_PASSWORD` to require a shared password (browser prompt, any username). Leave it empty for an
open dashboard. Google sign-in for the company domain is not built yet.

## How the numbers are computed

- Ad-level spend only, summed by ad across the month. Ad sets and campaigns are never summed.
- An ad with two brief IDs gives each brief half. A task with two editors gives each half
  (`SPLIT_MODE=split`) or credits the pair as one entry (`SPLIT_MODE=joint`).
- Attribution is computed when the page loads, so changing an Editor in ClickUp re-credits past spend
  after the next lookup.
- Anything that can't be credited is listed under **Needs review** with its spend: ads with no brief ID,
  brief IDs with no ClickUp task, tasks with an empty Editor field, and lookups still pending. Ads whose
  name mentions a different editor than ClickUp are listed too (already credited, just flagged).
- `rOO-12345` in an ad name (a reference to the original brief on resize variants) is not counted as a brief ID.

## Editors who leave

Editors are added to the `editors` table automatically. To tag someone "No longer with us":

```sql
UPDATE editors SET active = false WHERE name = 'Full Name';
```

`display_name` overrides the ClickUp name if you want a shorter one.

## Files

| Path | What it does |
| --- | --- |
| `lib/triplewhale.ts` | Triple Whale SQL API → ad-level daily spend (`ads_table`, channel `facebook-ads`) |
| `lib/clickup.ts` | Brief ID → task lookup, Editor field parsing (users / dropdown / labels / text), throttling |
| `lib/leaderboard.ts` | `allocate()` (pure attribution) and `buildLeaderboard(month)` |
| `lib/store.ts` | All Postgres queries |
| `lib/demo.ts` | Demo data when there is no database |
| `app/api/sync` | Cron job: fetch spend, look up briefs, write snapshots |
| `app/api/leaderboard` | Read API for the page |
| `app/api/clickup-webhook` | Marks a task stale when it changes in ClickUp |
| `components/Leaderboard.tsx` | The dashboard |
