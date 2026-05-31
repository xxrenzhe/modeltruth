create table if not exists workspace_members (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text references users(id) on delete set null,
  email text not null,
  role text not null default 'member',
  status text not null default 'invited',
  invited_by_user_id text references users(id) on delete set null,
  invited_at timestamptz not null,
  joined_at timestamptz,
  updated_at timestamptz not null,
  unique(workspace_id, email)
);

insert into workspace_members (
  id, workspace_id, user_id, email, role, status, invited_by_user_id, invited_at, joined_at, updated_at
)
select
  'owner-' || w.id,
  w.id,
  u.id,
  u.email,
  'owner',
  'active',
  u.id,
  w.created_at,
  w.created_at,
  w.updated_at
from workspaces w
join users u on u.id = w.owner_id
on conflict (workspace_id, email) do nothing;

create index if not exists idx_workspace_members_workspace_status
  on workspace_members(workspace_id, status);

create index if not exists idx_workspace_members_email_status
  on workspace_members(email, status);
