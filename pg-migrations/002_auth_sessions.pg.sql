create table if not exists auth_magic_links (
  id text primary key,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null
);

create table if not exists auth_sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  workspace_id text not null references workspaces(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null,
  last_seen_at timestamptz not null
);

create index if not exists idx_auth_magic_links_token_hash
  on auth_magic_links(token_hash);

create index if not exists idx_auth_sessions_token_hash
  on auth_sessions(token_hash);

create index if not exists idx_auth_sessions_user_expires
  on auth_sessions(user_id, expires_at);
