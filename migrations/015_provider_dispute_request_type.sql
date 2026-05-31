alter table provider_disputes add column request_type text not null default 'correction';

create index if not exists idx_provider_disputes_request_type
  on provider_disputes(provider_slug, request_type, status);
