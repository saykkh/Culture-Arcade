-- LS전선 Way 오락실 PRD v0.4 Schema Migration
-- Entities: learning_versions, participants, participant_credentials,
--           participant_sessions, game_runs, game_progress, first_item_responses

create extension if not exists pgcrypto;

create table if not exists public.learning_versions (
  id text primary key,
  rule_version text not null,
  content_version text not null,
  published_at timestamptz not null default now(),
  constraint learning_versions_rule_content_unique unique (rule_version, content_version)
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  learning_version_id text not null references public.learning_versions(id),
  roster_ref text not null unique,
  nickname text,
  nickname_key text unique,
  available_from_date date not null,
  recommended_due_date date,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  first_played_at timestamptz,
  onboarding_completed_at timestamptz,
  due_date_at_completion date,
  created_at timestamptz not null default now(),
  constraint participants_due_after_start check (
    recommended_due_date is null or recommended_due_date >= available_from_date
  )
);

create table if not exists public.participant_credentials (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  lookup_digest text not null unique,
  generation integer not null check (generation >= 1),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists participant_credentials_one_active_idx
  on public.participant_credentials (participant_id)
  where revoked_at is null;

create table if not exists public.participant_sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  lookup_digest text not null unique,
  credential_generation integer not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists participant_sessions_participant_idx
  on public.participant_sessions (participant_id, credential_generation);

create table if not exists public.game_runs (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  game_id text not null check (game_id in ('typing', 'snake', 'shooter', 'runner')),
  mode text not null check (mode in ('standard', 'assisted')),
  rule_version text not null,
  content_version text not null,
  seed integer not null,
  status text not null check (status in ('started', 'finalized', 'abandoned')),
  attempt_kind text not null check (attempt_kind in ('first_attempt', 'retry_before_clear', 'retry_after_clear')),
  after_badge_at_start boolean not null default false,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finalized_at timestamptz,
  end_reason text,
  active_duration_ms integer check (active_duration_ms is null or active_duration_ms >= 0),
  score integer check (score is null or score >= 0),
  cleared boolean,
  action_summary jsonb,
  finalized_response jsonb
);

create index if not exists game_runs_participant_game_idx
  on public.game_runs (participant_id, game_id, started_at desc);

create table if not exists public.game_progress (
  participant_id uuid not null references public.participants(id) on delete cascade,
  game_id text not null check (game_id in ('typing', 'snake', 'shooter', 'runner')),
  standard_best_score integer,
  standard_best_achieved_at timestamptz,
  assisted_best_score integer,
  first_cleared_at timestamptz,
  last_started_at timestamptz,
  finalized_attempt_count integer not null default 0,
  primary key (participant_id, game_id)
);

create index if not exists game_progress_leaderboard_idx
  on public.game_progress (
    game_id,
    standard_best_score desc nulls last,
    standard_best_achieved_at asc nulls last,
    participant_id asc
  );

create table if not exists public.first_item_responses (
  participant_id uuid not null references public.participants(id) on delete cascade,
  content_version text not null,
  game_id text not null check (game_id in ('shooter')),
  item_id text not null,
  first_outcome text not null check (first_outcome in ('correct', 'wrong', 'timeout')),
  is_correct boolean,
  first_exposed_at timestamptz not null default now(),
  first_selected_at timestamptz,
  primary key (participant_id, content_version, game_id, item_id)
);

alter table public.learning_versions enable row level security;
alter table public.participants enable row level security;
alter table public.participant_credentials enable row level security;
alter table public.participant_sessions enable row level security;
alter table public.game_runs enable row level security;
alter table public.game_progress enable row level security;
alter table public.first_item_responses enable row level security;
