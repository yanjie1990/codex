alter table if exists users
  add column if not exists is_whitelisted boolean not null default false;

create table if not exists users (
  id text primary key,
  email text,
  name text,
  avatar_url text,
  provider text,
  provider_user_id text,
  stripe_customer_id text,
  is_whitelisted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_provider_identity_idx
  on users (provider, provider_user_id)
  where provider is not null and provider_user_id is not null;

create table if not exists subscriptions (
  user_id text primary key references users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text,
  plan text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists api_keys (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  status text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists api_keys_user_id_idx on api_keys (user_id);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists sessions_user_id_idx on sessions (user_id);

create table if not exists oauth_states (
  state text primary key,
  created_at timestamptz not null default now()
);

create table if not exists usage_events (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  api_key_id text references api_keys(id) on delete set null,
  action text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_action_idx
  on usage_events (user_id, action, created_at desc);
