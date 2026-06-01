create table if not exists gtm_daily_visitors (
  day text not null,
  surface text not null,
  visitor_hash text not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  visit_count integer not null default 1,
  primary key (day, surface, visitor_hash)
);

create table if not exists gtm_external_metric_snapshots (
  source text primary key,
  metric_value integer not null,
  captured_at timestamptz not null,
  metadata_json jsonb not null default '{}'::jsonb
);

create index if not exists idx_gtm_daily_visitors_surface_day
  on gtm_daily_visitors(surface, day);

create index if not exists idx_gtm_external_metric_snapshots_captured
  on gtm_external_metric_snapshots(captured_at);
