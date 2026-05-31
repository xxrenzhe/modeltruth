create table if not exists waitlist_signups (
  id text primary key,
  email text not null unique,
  role text,
  company text,
  source text not null default 'homepage',
  status text not null default 'active',
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_waitlist_signups_status_created
  on waitlist_signups(status, created_at);
