create table if not exists workspace_privacy_settings (
  workspace_id text primary key references workspaces(id) on delete cascade,
  save_full_responses boolean not null default false,
  updated_at timestamptz not null
);

insert into workspace_privacy_settings (workspace_id, save_full_responses, updated_at)
select id, false, updated_at from workspaces
on conflict (workspace_id) do nothing;
