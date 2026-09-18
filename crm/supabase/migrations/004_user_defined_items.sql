-- 업종에 상관없이 쓸 수 있도록: 예시성 기본값 제거 + 사용자 정의 항목에 "사용 안 함" 지원
-- + 상담유형/결제방법을 하드코딩 상수에서 매장별로 관리 가능한 테이블로 전환.
-- Supabase 프로젝트의 SQL Editor에 이 파일 전체를 붙여넣고 실행하세요.
-- (001~003 마이그레이션 이후에 적용합니다.)

-- ── 0. 이미 시드되어 있던 "예시용" 기본값 제거 ──────────────────────────
-- 사용자가 이름을 그대로 바꾸지 않은, 프로그램이 자동 생성했던 항목만 지운다.
-- (참조 중인 예약/고객이 있어도 FK가 on delete set null 이라 데이터는 안전하게 "미지정"이 된다.)
delete from reservation_groups where name in ('신규고객', '기존고객', 'VIP', '회원', '비회원');
delete from reservation_types where name in ('전화예약', '온라인예약', '방문예약', '네이버예약', '카카오예약', '기타');
delete from customer_grades where name in ('일반', '우수', 'VIP', 'VVIP');
delete from customer_tags where name in ('신규', '단골', 'VIP', '생일', '재방문 필요', '주의', '미방문');

-- ── 1. 예약그룹 / 예약타입: "사용 안 함" 지원 ───────────────────────────
alter table reservation_groups add column active boolean not null default true;
alter table reservation_types add column active boolean not null default true;

-- ── 2. 상담유형: 하드코딩 상수 → 매장별 관리 테이블 ─────────────────────
create table consultation_types (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table consultations add column type_id uuid references consultation_types(id) on delete set null;
-- 기존 type(text) 컬럼은 과거 기록 조회용으로만 남겨두고 필수값에서 해제한다.
alter table consultations alter column type drop not null;
alter table consultations alter column type drop default;

alter table consultation_types enable row level security;
create policy "consultation_types_rw" on consultation_types
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

-- ── 3. 결제방법: 하드코딩 상수 → 매장별 관리 테이블 ─────────────────────
-- 시스템 최소값(카드/현금/계좌이체)만 기본 제공하고, "기타"는 필요하면 직접 추가하게 한다.
create table payment_methods (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table payments add column method_id uuid references payment_methods(id) on delete set null;

alter table payment_methods enable row level security;
create policy "payment_methods_rw" on payment_methods
  for all using (business_id = current_business_id())
  with check (business_id = current_business_id());

insert into payment_methods (business_id, name)
select b.id, m.name
from businesses b
cross join (values ('카드'), ('현금'), ('계좌이체')) as m(name)
where not exists (select 1 from payment_methods pm where pm.business_id = b.id);

-- 기존 매출 기록의 method(text) 값을 새 payment_methods와 이름으로 매칭해 연결해준다.
update payments p
set method_id = pm.id
from payment_methods pm
where pm.business_id = p.business_id
  and pm.name = p.method
  and p.method_id is null;

-- ── 4. 알림 설정: 항목별 발송 시점 / 메시지 문구 ────────────────────────
alter table notification_settings
  add column reservation_created_message text default '예약이 등록되었습니다.',
  add column reservation_updated_message text default '예약이 변경되었습니다.',
  add column reservation_cancelled_message text default '예약이 취소되었습니다.',
  add column reservation_reminder_message text default '예약 하루 전입니다. 잊지 말고 방문해주세요.',
  add column reservation_reminder_timing text default '1day';
