create table if not exists byo_probes (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  region text not null,
  token_hash text not null unique,
  status text not null default 'pending',
  last_seen_at text,
  version text,
  created_at text not null,
  updated_at text not null
);

create index if not exists idx_byo_probes_workspace_status
  on byo_probes(workspace_id, status);

create index if not exists idx_byo_probes_token_hash
  on byo_probes(token_hash);
