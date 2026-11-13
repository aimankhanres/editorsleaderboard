-- Daily spend per ad, straight from Triple Whale (ad level only)
CREATE TABLE IF NOT EXISTS ad_spend (
  spend_date  date        NOT NULL,
  ad_id       text        NOT NULL,
  ad_name     text        NOT NULL,
  campaign    text,
  adset       text,
  channel     text,
  spend       numeric(14,2) NOT NULL DEFAULT 0,
  brief_ids   jsonb       NOT NULL DEFAULT '[]',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (spend_date, ad_id)
);
CREATE INDEX IF NOT EXISTS ad_spend_date_idx ON ad_spend (spend_date);

-- Brief ID -> ClickUp task -> editor(s). Cached so ClickUp is only called for new or stale briefs.
CREATE TABLE IF NOT EXISTS brief_map (
  brief_id    text PRIMARY KEY,
  task_id     text,
  task_name   text,
  task_url    text,
  editors     jsonb       NOT NULL DEFAULT '[]',
  status      text        NOT NULL DEFAULT 'pending',
  fetched_at  timestamptz NOT NULL DEFAULT 'epoch'
);
CREATE INDEX IF NOT EXISTS brief_map_task_idx ON brief_map (task_id);

-- Editor roster. Names/avatars fill in automatically; set active=false for people who left.
CREATE TABLE IF NOT EXISTS editors (
  key          text PRIMARY KEY,
  name         text NOT NULL,
  avatar_url   text,
  active       boolean NOT NULL DEFAULT true,
  display_name text
);

-- One row per editor per day, used for the rank-change arrows
CREATE TABLE IF NOT EXISTS snapshots (
  snap_date  date    NOT NULL,
  month      text    NOT NULL,
  editor_key text    NOT NULL,
  spend      numeric(14,2) NOT NULL,
  rank       integer NOT NULL,
  PRIMARY KEY (snap_date, month, editor_key)
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id          bigserial PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok          boolean,
  ads         integer,
  lookups     integer,
  pending     integer,
  error       text
);
