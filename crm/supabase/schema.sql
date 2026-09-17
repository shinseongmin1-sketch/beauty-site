-- beauty-site 예약/CRM 프로그램 DB 스키마
-- Supabase 프로젝트의 SQL Editor에 이 파일 전체를 붙여넣고 실행하세요.

create extension if not exists "pgcrypto";

create type staff_role as enum ('owner', 'manager', 'staff');
create type reservation_status as enum ('pending', 'confirmed', 'completed', 'cancelled', 'no_show');
create type reservation_source as enum ('internal', 'naver');
create type payment_status as enum ('ready', 'paid', 'failed', 'cancelled', 'partial_cancelled');

-- 매장(업체) 정보
create table businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  address text,
  business_hours jsonb,
  naver_booking_id text, -- 네이버예약 업체 ID (연동 전까지는 비워둠)
  toss_client_key text,  -- 매장별 토스페이먼츠 client key (선택, 없으면 공용 테스트 키 사용)
  created_at timestamptz not null default now()
);

-- auth.users 1:1 확장 프로필. 회원가입 시 트리거로 자동 생성됨.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  business_id uuid references businesses(id) on delete set null,
  role staff_role not null default 'owner',
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

-- 매장 직원 (로그인 계정과 연결될 수도, 안 될 수도 있음)
create table staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  name text not null,
  phone text,
  role staff_role not null default 'staff',
  color text not null default '#c44dff',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 손님(고객)
create table customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  phone text,
  memo text,
  created_at timestamptz not null default now()
);

-- 시술/서비스 메뉴
create table services (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  duration_minutes int not null default 60,
  price int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 예약
create table reservations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  staff_id uuid references staff(id) on delete set null,
  service_id uuid references services(id) on delete set null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  status reservation_status not null default 'pending',
  source reservation_source not null default 'internal', -- 네이버예약 연동 시 'naver'
  external_id text, -- 네이버예약 등 외부 시스템의 예약 ID (연동용, 지금은 미사용)
  memo text,
  created_at timestamptz not null default now()
);

create index reservations_business_start_idx on reservations (business_id, start_time);

-- 결제 내역 (토스페이먼츠 연동)
create table payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  reservation_id uuid references reservations(id) on delete set null,
  amount int not null,
  method text,
  status payment_status not null default 'ready',
  toss_payment_key text,
  toss_order_id text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- ── Row Level Security ──────────────────────────────────────────────
-- 원칙: 한 계정(auth.users)은 자신이 속한 매장(business_id)의 데이터만
-- 읽고 쓸 수 있다. 매장 소유자는 businesses 테이블에 대한 권한을 추가로 가진다.

alter table businesses enable row level security;
alter table profiles enable row level security;
alter table staff enable row level security;
alter table customers enable row level security;
alter table services enable row level security;
alter table reservations enable row level security;
alter table payments enable row level security;

create or replace function current_business_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select business_id from profiles where id = auth.uid()
$$;

create policy "businesses_select" on businesses
  for select using (owner_id = auth.uid() or id = current_business_id());
create policy "businesses_insert" on businesses
  for insert with check (owner_id = auth.uid());
create policy "businesses_update" on businesses
  for update using (owner_id = auth.uid());

create policy "profiles_select" on profiles
  for select using (id = auth.uid() or business_id = current_business_id());
create policy "profiles_insert_self" on profiles
  for insert with check (id = auth.uid());
create policy "profiles_update_self" on profiles
  for update using (id = auth.uid());

create policy "staff_rw" on staff
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "customers_rw" on customers
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "services_rw" on services
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "reservations_rw" on reservations
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "payments_rw" on payments
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

-- 회원가입하면 auth.users에 row가 생기는데, 이때 profiles row를 자동 생성.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
