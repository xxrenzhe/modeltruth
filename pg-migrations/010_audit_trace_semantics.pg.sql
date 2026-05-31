alter table audit_runs add column if not exists trace_id text;

create index if not exists idx_audit_runs_trace_id
  on audit_runs(trace_id);
