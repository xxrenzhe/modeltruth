create table if not exists users (
  id text primary key,
  email text not null unique,
  name text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists workspaces (
  id text primary key,
  owner_id text not null references users(id),
  name text not null,
  tier text not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text not null default 'inactive',
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists provider_nodes (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  base_url text not null,
  base_url_host_hash text not null,
  model_id text not null,
  encrypted_api_key text,
  api_key_suffix text,
  status text not null default 'active',
  heartbeat_interval_seconds integer not null default 300,
  deep_audit_interval_seconds integer not null default 43200,
  next_heartbeat_at timestamptz,
  next_deep_audit_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists jobs (
  id text primary key,
  type text not null,
  status text not null default 'queued',
  payload_json text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists audit_runs (
  id text primary key,
  workspace_id text,
  node_id text,
  suite_id text not null,
  suite_version text not null,
  run_type text not null,
  target_model_id text not null,
  status text not null,
  confidence double precision,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  metrics_json jsonb not null default '{}'::jsonb,
  assertions_json jsonb not null default '[]'::jsonb,
  evidence_summary_json jsonb not null default '{}'::jsonb,
  evidence_object_path text,
  created_at timestamptz not null
);

create table if not exists alert_channels (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  type text not null,
  encrypted_target text not null,
  enabled integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists content_pages (
  id text primary key,
  locale text not null,
  type text not null,
  slug text not null,
  title text not null,
  description text not null,
  body_markdown text not null,
  seo_title text,
  seo_description text,
  canonical_slug text,
  no_index integer not null default 0,
  published_at timestamptz,
  updated_at timestamptz not null,
  unique(locale, type, slug)
);
