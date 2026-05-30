create table if not exists users (
  id text primary key,
  email text not null unique,
  name text,
  created_at text not null,
  updated_at text not null
);

create table if not exists workspaces (
  id text primary key,
  owner_id text not null references users(id),
  name text not null,
  tier text not null default 'free',
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text not null default 'inactive',
  created_at text not null,
  updated_at text not null
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
  next_heartbeat_at text,
  next_deep_audit_at text,
  created_at text not null,
  updated_at text not null
);

create table if not exists jobs (
  id text primary key,
  type text not null,
  status text not null default 'queued',
  payload_json text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after text not null,
  locked_at text,
  locked_by text,
  last_error text,
  created_at text not null,
  updated_at text not null
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
  confidence real,
  started_at text,
  finished_at text,
  error_code text,
  error_message text,
  metrics_json text not null default '{}',
  assertions_json text not null default '[]',
  evidence_summary_json text not null default '{}',
  evidence_object_path text,
  created_at text not null
);

create table if not exists alert_channels (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  type text not null,
  encrypted_target text not null,
  enabled integer not null default 1,
  created_at text not null,
  updated_at text not null
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
  published_at text,
  updated_at text not null,
  unique(locale, type, slug)
);
