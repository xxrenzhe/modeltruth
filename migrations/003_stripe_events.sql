create table if not exists stripe_events (
  id text primary key,
  type text not null,
  processed_at text not null,
  payload_hash text not null
);

create index if not exists idx_workspaces_stripe_customer
  on workspaces(stripe_customer_id);

create index if not exists idx_workspaces_stripe_subscription
  on workspaces(stripe_subscription_id);
