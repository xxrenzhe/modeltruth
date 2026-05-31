alter table audit_runs add column if not exists provider_slug text;

create index if not exists idx_audit_runs_provider_created
  on audit_runs(provider_slug, created_at);
