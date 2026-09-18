-- 고객 등급/태그, 매출관리 확장, 담당자 직책, 알림 설정, 마케팅 발송 로그
-- Supabase 프로젝트의 SQL Editor에 이 파일 전체를 붙여넣고 실행하세요.
-- (002_crm_extensions.sql 이후에 적용하는 마이그레이션입니다.)

-- ── 고객 등급 ────────────────────────────────────────────────────────
create table customer_grades (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table customers add column grade_id uuid references customer_grades(id) on delete set null;

-- ── 고객 태그 (다대다) ───────────────────────────────────────────────
create table customer_tags (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table customer_tag_links (
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  tag_id uuid not null references customer_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (customer_id, tag_id)
);

-- ── 매출관리: 기존 payments 테이블 확장 (새 테이블 만들지 않고 재사용) ──
-- gross_amount: 할인 전 결제금액, discount_amount: 할인금액, amount: 최종결제금액(기존 컬럼 그대로 사용)
alter table payments
  add column customer_id uuid references customers(id) on delete set null,
  add column staff_id uuid references staff(id) on delete set null,
  add column service_id uuid references services(id) on delete set null,
  add column gross_amount int default 0,
  add column discount_amount int not null default 0,
  add column memo text;

update payments set gross_amount = amount where gross_amount is null;
alter table payments alter column gross_amount set not null;

create index payments_customer_idx on payments (customer_id);

-- ── 담당자 직책 (권한 role과 별개의 자유 입력 필드) ─────────────────────
alter table staff add column title text;

-- ── 알림 설정 (실제 발송 연동 없이 설정값만 저장) ───────────────────────
create table notification_settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references businesses(id) on delete cascade,
  reservation_created boolean not null default true,
  reservation_updated boolean not null default true,
  reservation_cancelled boolean not null default true,
  reservation_reminder boolean not null default true,
  channel text not null default 'sms', -- 'sms' | 'kakao'
  updated_at timestamptz not null default now()
);

-- ── 마케팅 발송 로그 (실제 발송 없이 초안/대상만 기록) ──────────────────
create table marketing_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  target_description text not null,
  message text not null,
  channel text not null default 'sms', -- 'sms' | 'kakao'
  status text not null default 'draft', -- 'draft' (실제 발송 연동 전까지는 항상 draft)
  created_at timestamptz not null default now()
);

-- ── RLS ──────────────────────────────────────────────────────────────
alter table customer_grades enable row level security;
alter table customer_tags enable row level security;
alter table customer_tag_links enable row level security;
alter table notification_settings enable row level security;
alter table marketing_messages enable row level security;

create policy "customer_grades_rw" on customer_grades
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "customer_tags_rw" on customer_tags
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "customer_tag_links_rw" on customer_tag_links
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "notification_settings_rw" on notification_settings
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

create policy "marketing_messages_rw" on marketing_messages
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

-- ── 이미 있는 매장에 기본값 채우기 ──────────────────────────────────────
insert into customer_grades (business_id, name)
select b.id, g.name
from businesses b
cross join (values ('일반'), ('우수'), ('VIP'), ('VVIP')) as g(name)
where not exists (select 1 from customer_grades cg where cg.business_id = b.id);

insert into customer_tags (business_id, name)
select b.id, t.name
from businesses b
cross join (values ('신규'), ('단골'), ('VIP'), ('생일'), ('재방문 필요'), ('주의'), ('미방문')) as t(name)
where not exists (select 1 from customer_tags ct where ct.business_id = b.id);

insert into notification_settings (business_id)
select b.id from businesses b
where not exists (select 1 from notification_settings ns where ns.business_id = b.id);
