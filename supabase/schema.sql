create extension if not exists pgcrypto;

create table if not exists public.madar_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique check (username = lower(username)),
  name text not null,
  role text not null check (role in ('المدير','سيلز')),
  initials text not null default '',
  color text not null default '#58d6a3',
  password_salt text not null,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists madar_one_active_manager on public.madar_users(role) where role='المدير' and active=true;

create table if not exists public.madar_leads (
  id text primary key,
  payload jsonb not null,
  owner_id uuid references public.madar_users(id) on delete set null,
  whatsapp_number text not null check (whatsapp_number ~ '^[0-9]{10,15}$'),
  created_at timestamptz not null default now()
);
create index if not exists madar_leads_owner_idx on public.madar_leads(owner_id);
create index if not exists madar_leads_whatsapp_idx on public.madar_leads(whatsapp_number);

create table if not exists public.madar_activities (
  id text primary key,
  payload jsonb not null,
  user_id uuid references public.madar_users(id) on delete set null,
  lead_id text references public.madar_leads(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists madar_activities_user_idx on public.madar_activities(user_id,created_at desc);

create table if not exists public.madar_offers (
  id text primary key,
  payload jsonb not null,
  owner_id uuid references public.madar_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.madar_projects (
  id text primary key,
  payload jsonb not null,
  owner_id uuid references public.madar_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.madar_settings (
  id smallint primary key check (id=1),
  target numeric not null default 250000,
  banner boolean not null default true
);
create table if not exists public.madar_login_attempts (
  key text primary key,
  failures integer not null default 0,
  window_started timestamptz not null default now(),
  locked_until timestamptz
);

alter table public.madar_users enable row level security;
alter table public.madar_leads enable row level security;
alter table public.madar_activities enable row level security;
alter table public.madar_offers enable row level security;
alter table public.madar_projects enable row level security;
alter table public.madar_settings enable row level security;
alter table public.madar_login_attempts enable row level security;

revoke all on public.madar_users, public.madar_leads, public.madar_activities,
  public.madar_offers, public.madar_projects, public.madar_settings,
  public.madar_login_attempts from anon, authenticated;
grant all on public.madar_users, public.madar_leads, public.madar_activities,
  public.madar_offers, public.madar_projects, public.madar_settings,
  public.madar_login_attempts to service_role;
