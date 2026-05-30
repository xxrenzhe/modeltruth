create index if not exists idx_jobs_status_run_after
  on jobs(status, run_after);

create index if not exists idx_provider_nodes_workspace_status
  on provider_nodes(workspace_id, status);

create index if not exists idx_audit_runs_node_created
  on audit_runs(node_id, created_at);
