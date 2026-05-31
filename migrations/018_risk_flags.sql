create table if not exists risk_flags (
  id text primary key,
  workspace_id text,
  node_id text,
  provider_slug text,
  assertion_id text not null,
  severity text not null,
  status text not null default 'active',
  target_model_id text,
  suite_id text,
  first_run_id text,
  last_run_id text,
  evidence_count integer not null default 0,
  last_seen_at text not null,
  created_at text not null,
  updated_at text not null
);

create table if not exists evidence_packages (
  id text primary key,
  run_id text not null unique,
  provider_slug text,
  risk_flag_id text references risk_flags(id) on delete set null,
  redacted_summary_json text not null default '{}',
  created_at text not null
);

create table if not exists risk_flag_events (
  id text primary key,
  risk_flag_id text not null references risk_flags(id) on delete cascade,
  event_type text not null,
  from_status text,
  to_status text,
  run_id text,
  actor text,
  note text,
  evidence_package_id text references evidence_packages(id) on delete set null,
  created_at text not null
);

create index if not exists idx_risk_flags_provider_status
  on risk_flags(provider_slug, status, last_seen_at);

create index if not exists idx_risk_flags_workspace_node_assertion
  on risk_flags(workspace_id, node_id, assertion_id, severity, status, last_seen_at);

create index if not exists idx_risk_flag_events_flag_created
  on risk_flag_events(risk_flag_id, created_at);

create index if not exists idx_evidence_packages_run
  on evidence_packages(run_id);
