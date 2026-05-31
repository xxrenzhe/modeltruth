create table if not exists workspace_privacy_settings (
  workspace_id text primary key references workspaces(id) on delete cascade,
  save_full_responses integer not null default 0,
  updated_at text not null
);

insert or ignore into workspace_privacy_settings (workspace_id, save_full_responses, updated_at)
select id, 0, updated_at from workspaces;
