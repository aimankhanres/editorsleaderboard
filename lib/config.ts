export const cfg = {
  tw: {
    apiKey: process.env.TRIPLEWHALE_API_KEY ?? '',
    shopId: process.env.TRIPLEWHALE_SHOP_ID ?? '',
    base: process.env.TRIPLEWHALE_API_BASE ?? 'https://api.triplewhale.com/api/v2',
    channel: process.env.TRIPLEWHALE_CHANNEL ?? 'facebook-ads',
  },
  cu: {
    token: process.env.CLICKUP_TOKEN ?? '',
    teamId: process.env.CLICKUP_TEAM_ID ?? '',
    editorField: (process.env.CLICKUP_EDITOR_FIELD ?? 'Editor').trim().toLowerCase(),
    // Resilia's "Brief ID" short_text field. Override with CLICKUP_BRIEF_FIELD_ID if it ever changes.
    briefFieldId: process.env.CLICKUP_BRIEF_FIELD_ID?.trim() || 'f129c811-0d3b-481d-9971-eb0b10bcf746',
    // "Old Brief Id" on resize tasks: the 6-digit brief they were resized from (lives in another workspace)
    oldBriefFieldId: process.env.CLICKUP_OLD_BRIEF_FIELD_ID?.trim() || '6d5035b2-d44c-43e8-a58c-0650af0f32a5',
  },
  splitMode: (process.env.SPLIT_MODE === 'joint' ? 'joint' : 'split') as 'split' | 'joint',
  /** An ad is a "winner" when its spend in the selected period reaches this (USD) */
  winnerSpend: Number(process.env.WINNER_SPEND ?? 40000),
  maxLookups: Number(process.env.MAX_CLICKUP_LOOKUPS_PER_RUN ?? 250),
  refreshHours: Number(process.env.EDITOR_REFRESH_HOURS ?? 6),
  timezone: process.env.REPORT_TIMEZONE ?? 'America/New_York',
  hasDb: Boolean(process.env.DATABASE_URL),
  /** Credit agency (6-digit) briefs to the original agency editor as well; ?agency=0 shows the numbers without it */
  agencyCredit: process.env.AGENCY_CREDIT !== 'off', // on by default (Aiman, Nov 25 2026); AGENCY_CREDIT=off turns it off
};
