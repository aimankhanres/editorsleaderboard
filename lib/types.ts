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

export type EditorRow = {
  key: string;
  name: string;
  avatar: string | null;
  active: boolean;
  spend: number;
  share: number;
  ads: number;
  briefs: EditorBrief[];
  rank: number;
  prevRank: number | null;
};

export type ReviewKind = 'no_brief_id' | 'pending' | 'task_not_found' | 'no_editor' | 'name_mismatch';

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
  months: string[];
  total: number;
  attributed: number;
  editors: EditorRow[];
  review: ReviewItem[];
  lastSync: { at: string; ok: boolean; error?: string | null } | null;
  splitMode: 'split' | 'joint';
  demo: boolean;
};
