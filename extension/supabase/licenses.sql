-- Decibel Pro License Keys
-- Run this in your Supabase SQL editor to create the licenses table.

create table if not exists licenses (
  key text primary key,
  email text not null,
  tier text not null default 'pro',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  notes text
);

-- RLS: anon can only verify (select) by exact key match
alter table licenses enable row level security;

create policy "anon_verify_key"
  on licenses for select
  to anon
  using (true);

-- Index for fast lookups
create index if not exists idx_licenses_active on licenses (key) where active = true;

-- Example: insert a test key
-- insert into licenses (key, email, tier)
-- values ('DCBL-TEST-ABCD-1234', 'test@decibel.systems', 'pro');
