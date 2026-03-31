-- Agent write queue: stores tool calls from remote agents for local sync
-- Pattern: same as voice_inbox — Supabase as queue, synced_at marks processed items

create table if not exists agent_queue (
  id              uuid primary key default gen_random_uuid(),
  project_id      text not null,
  facade          text not null,
  action          text not null,
  arguments       jsonb not null default '{}',
  created_by      text not null,
  created_at      timestamptz not null default now(),
  synced_at       timestamptz,
  sync_result     jsonb,
  sync_error      text,
  provenance_ref  text
);

-- Fast lookup for unsynced items per project
create index if not exists idx_agent_queue_unsynced
  on agent_queue (project_id, created_at)
  where synced_at is null;

-- General project timeline queries
create index if not exists idx_agent_queue_project
  on agent_queue (project_id, created_at);

-- RLS
alter table agent_queue enable row level security;

create policy "Service key full access"
  on agent_queue for all
  using (true)
  with check (true);

create policy "Anon insert only"
  on agent_queue for insert
  to anon
  with check (true);

create policy "Anon select own"
  on agent_queue for select
  to anon
  using (true);
