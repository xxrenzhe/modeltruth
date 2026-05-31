create table if not exists playground_quota_events (
  id text primary key,
  quota_key text not null,
  created_at timestamptz not null
);

create index if not exists idx_playground_quota_key_created
  on playground_quota_events(quota_key, created_at);
