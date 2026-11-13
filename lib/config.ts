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
    briefFieldId: process.env.CLICKUP_BRIEF_FIELD_ID ?? '',
  },
  splitMode: (process.env.SPLIT_MODE === 'joint' ? 'joint' : 'split') as 'split' | 'joint',
  maxLookups: Number(process.env.MAX_CLICKUP_LOOKUPS_PER_RUN ?? 80),
  refreshHours: Number(process.env.EDITOR_REFRESH_HOURS ?? 6),
  timezone: process.env.REPORT_TIMEZONE ?? 'America/New_York',
  hasDb: Boolean(process.env.DATABASE_URL),
};
