export type EditorRef = { key: string; name: string; avatar?: string | null };

export type BriefStatus = 'ok' | 'no_editor' | 'not_found' | 'error' | 'pending';

export type BriefInfo = {
  briefId: string;
  taskId: string | null;
  taskName: string | null;
  taskUrl: string | null;
  editors: EditorRef[];
  status: BriefStatus;
  /** From the task mirror (cu_tasks): where the task lives and who the strategist is */
  listId?: string | null;
  workspace?: string | null;
  product?: string | null;
  strategists?: EditorRef[];
  /**
   * 6-digit (agency) briefs: the original task in the agency ClickUp workspace. Its Editor(s) are credited on top of
   * the resize editors (each on their own team board; the dollar is counted once in totals).
   */
  agency?: { editors: EditorRef[]; strategists: EditorRef[]; taskName: string | null; taskUrl: string | null; product: string | null } | null;
};

/** One ad's spend for the month, already summed across days */
export type AdAgg = { adId: string; adName: string; campaign: string; spend: number; briefIds: string[] };

export type RosterEntry = { name: string; avatar: string | null; active: boolean };

export type EditorBrief = { briefId: string; taskName: string | null; taskUrl: string | null; spend: number; ads: number; board?: string | null };

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
  /** false: not in Resilia's ClickUp workspace, so nothing can be credited */
  inClickUp?: boolean;
  tier?: 'lead' | 'senior' | 'editor';
  /** Assets finished in the period (ClickUp Edit Complete / Asset Delivered date), videos vs statics */
  videos?: number;
  statics?: number;
  /** Minutes of finished video (Frame.io durations of the tasks' Frame links) */
  minutes?: number;
  /** People on several teams: their spend per team board (this row shows only this team's part) */
  boards?: { team: string; name: string; spend: number; ads: number }[];
};

export type TeamBoard = {
  id: string;
  name: string;
  group?: string;
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
