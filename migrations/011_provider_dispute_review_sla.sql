alter table provider_disputes add column review_due_at text;
alter table provider_disputes add column review_started_at text;

create index if not exists idx_provider_disputes_review_due
  on provider_disputes(status, review_due_at);
