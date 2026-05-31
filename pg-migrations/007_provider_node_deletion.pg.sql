alter table provider_nodes add column if not exists deleted_at timestamptz;

create index if not exists idx_provider_nodes_status_deleted
  on provider_nodes(status, deleted_at);
