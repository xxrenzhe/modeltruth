alter table audit_runs add column trace_id text;

create index if not exists idx_audit_runs_trace_id
  on audit_runs(trace_id);
