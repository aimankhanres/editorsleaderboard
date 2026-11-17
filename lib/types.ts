export type EditorRef = { key: string; name: string; avatar?: string | null };

export type BriefStatus = 'ok' | 'no_editor' | 'not_found' | 'error' | 'pending';

export type BriefInfo = {
  briefId: string;
  taskId: string | null;
  taskName: string | null;
  taskUrl: string | null;
  editors: EditorRef[];
  status: BriefStatus;
};

/** One ad's spend for the month, already summed across days */
export type AdAgg = { adId: string; adName: string; campaign: string; spend: number; briefIds: string[] };

export type RosterEntry = { name: string; avatar: string | null; active: boolean };

export type EditorBrief = { briefId: string; taskName: string | null; taskUrl: string | null; spend: number; ads: number };

/** An ad credited to an editor whose spend (the whole ad, not the editor's share) is >= the winner threshold */
export type WinnerAd = { adId: string; adName: string; spend: number; briefId: string; taskUrl: string | null };

export type EditorRow = {
  key: string;
  name: string;
  avatar: string | null;
  active: boolean;
  spend: number;
  share: number;
  ads: number;
  briefs: EditorBrief[];
  /** Winner ads, biggest first */
  winners: WinnerAd[];
  rank: number;
  prevRank: number | null;
  role?: string;
};

export type TeamBoard = {
  id: string;
  name: string;
  /** Spend credited to this team's members */
  spend: number;
  /** Distinct winner ads across the team */
  winners: number;
  /** Members ranked by spend; members with no spend yet come last with spend 0 */
  editors: EditorRow[];
};

export type ReviewKind = 'no_brief_id' | 'pending' | 'task_not_found' | 'other_workspace' | 'no_editor' | 'name_mismatch';

export type ReviewItem = {
  kind: ReviewKind;
  adId: string;
  adName: string;
  spend: number;
  briefId?: string;
  taskUrl?: string | null;
  detail?: string;
};

export type LeaderboardPayload = {
  month: string;
  /** Which ad channels the numbers cover: meta, google or all */
  channel: 'meta' | 'google' | 'all';
  /** Custom inclusive date range; null = the whole `month` */
  range: { from: string; to: string } | null;
  /** First / last day with stored spend */
  dataFrom: string | null;
  dataTo: string | null;
  months: string[];
  total: number;
  attributed: number;
  editors: EditorRow[];
  teams: TeamBoard[];
  review: ReviewItem[];
  lastSync: { at: string; ok: boolean; error?: string | null } | null;
  splitMode: 'split' | 'joint';
  /** Winner ad threshold in USD */
  winnerSpend: number;
  demo: boolean;
};
