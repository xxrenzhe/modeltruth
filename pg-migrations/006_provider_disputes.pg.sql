create table if not exists provider_disputes (
  id text primary key,
  provider_slug text not null,
  run_id text,
  contact_email text not null,
  statement text not null,
  evidence_url text,
  status text not null default 'under_review',
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists idx_provider_disputes_provider_status
  on provider_disputes(provider_slug, status);
