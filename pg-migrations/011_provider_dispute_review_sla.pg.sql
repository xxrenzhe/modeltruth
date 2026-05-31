alter table provider_disputes add column if not exists review_due_at timestamptz;
alter table provider_disputes add column if not exists review_started_at timestamptz;

create index if not exists idx_provider_disputes_review_due
  on provider_disputes(status, review_due_at);
