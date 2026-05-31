create table if not exists model_registry (
  id text primary key,
  provider text not null,
  model_id text not null,
  family text not null,
  status text not null default 'experimental',
  supports_reasoning_usage integer not null default 0,
  supports_streaming integer not null default 1,
  max_context_tokens integer,
  baseline_suite_version text not null default 'fingerprint-calibration@1.0.0',
  last_calibrated_at text,
  created_at text not null,
  updated_at text not null,
  unique(provider, model_id)
);

create table if not exists model_calibrations (
  id text primary key,
  model_registry_id text not null references model_registry(id) on delete cascade,
  provider text not null,
  model_id text not null,
  suite_id text not null,
  suite_version text not null,
  status text not null,
  metrics_json text not null default '{}',
  evidence_summary_json text not null default '{}',
  calibrated_at text not null,
  created_at text not null
);

create index if not exists idx_model_registry_provider_model
  on model_registry(provider, model_id);

create index if not exists idx_model_calibrations_model_time
  on model_calibrations(provider, model_id, calibrated_at);
