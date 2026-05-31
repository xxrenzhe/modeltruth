create table if not exists provider_subscriptions (
  id text primary key,
  provider_slug text not null,
  email text not null,
  notification_type text not null default 'risk_trend',
  status text not null default 'active',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique(provider_slug, email, notification_type)
);

create index if not exists idx_provider_subscriptions_provider_status
  on provider_subscriptions(provider_slug, status);
