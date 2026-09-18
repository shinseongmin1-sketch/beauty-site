-- CRM 확장: 예약그룹 / 예약타입 / 상담관리
-- Supabase 프로젝트의 SQL Editor에 이 파일 전체를 붙여넣고 실행하세요.
-- (기존 schema.sql을 이미 실행한 프로젝트에 추가로 적용하는 마이그레이션입니다.)

-- ── 예약그룹 (신규고객 / 기존고객 / VIP 등, 매장이 자유롭게 관리) ──────────
create table reservation_groups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now()
);

-- ── 예약타입 (전화예약 / 온라인예약 / 방문예약 등, 매장이 자유롭게 관리) ───
create table reservation_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  description text,
  color text not null default '#3b73e8',
  created_at timestamptz not null default now()
);

-- 예약에 그룹/타입을 연결 (없어도 예약은 등록 가능하도록 nullable)
-- content: "예약내용"(자유 입력, 예: 남성 커트) - 기존 memo("고객 메모")와는 별개 컬럼.
alter table reservations
  add column group_id uuid references reservation_groups(id) on delete set null,
  add column reservation_type_id uuid references reservation_types(id) on delete set null,
  add column content text;

-- ── 상담관리 ──────────────────────────────────────────────────────────
create table consultations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  staff_id uuid references staff(id) on delete set null,
  consult_date date not null default current_date,
  type text not null default '기타',
  content text,
  result text not null default '상담중',
  next_consult_date date,
  memo text,
  created_at timestamptz not null default now()
);

create index consultations_business_date_idx on consultations (business_id, consult_date desc);
create index consultations_customer_idx on consultations (customer_id);

-- ── RLS ──────────────────────────────────────────────────────────────
alter table reservation_groups enable row level security;
alter table reservation_types enable row level security;
alter table consultations enable row level security;

create policy "reservation_groups_rw" on reservation_groups
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "reservation_types_rw" on reservation_types
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "consultations_rw" on consultations
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

-- ── 이미 매장을 만든 계정을 위한 기본 데이터 채우기 ────────────────────────
-- (신규 가입자는 onboarding에서 바로 생성됨. 기존 매장에는 여기서 한 번 넣어줌)
insert into reservation_groups (business_id, name, description)
select b.id, g.name, g.description
from businesses b
cross join (values
  ('신규고객', '처음 방문하는 고객'),
  ('기존고객', '재방문 고객'),
  ('VIP', 'VIP 고객 예약'),
  ('회원', '멤버십 회원'),
  ('비회원', '비회원 고객')
) as g(name, description)
where not exists (
  select 1 from reservation_groups rg where rg.business_id = b.id
);

insert into reservation_types (business_id, name, description, color)
select b.id, t.name, t.description, t.color
from businesses b
cross join (values
  ('전화예약', '전화로 접수한 예약', '#3b73e8'),
  ('온라인예약', '홈페이지/앱으로 접수한 예약', '#8b5cf6'),
  ('방문예약', '매장에 직접 방문해서 접수한 예약', '#16a34a'),
  ('네이버예약', '네이버예약으로 접수한 예약', '#16a34a'),
  ('카카오예약', '카카오톡으로 접수한 예약', '#eab308'),
  ('기타', '그 외 방식으로 접수한 예약', '#718096')
) as t(name, description, color)
where not exists (
  select 1 from reservation_types rt where rt.business_id = b.id
);
