-- 직급별 접근 제어(007) 테스트: 대표(owner) / 관리자(manager) / 직원(staff) × 테이블별 조회·등록·수정·삭제
-- + 다른 사업장 접근. 실제 PostgreSQL RLS 를 authenticated 역할로 실행해 검증한다.

drop table if exists pg_temp.results;
create temp table results (name text, ok boolean, detail text);
grant all on results to public;

create or replace function pg_temp.rba_fail(p_name text, p_uid uuid, p_stmt text)
returns void language plpgsql as $$
declare v_ok boolean := false; v_detail text := 'no error raised';
begin
  begin
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    set local role authenticated;
    execute p_stmt;
  exception when others then
    v_ok := true; v_detail := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  insert into results values (p_name, v_ok, v_detail);
end $$;

create or replace function pg_temp.rba_rows(p_name text, p_uid uuid, p_stmt text, p_rows int)
returns void language plpgsql as $$
declare v_ok boolean := false; v_detail text; v_n int;
begin
  begin
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    set local role authenticated;
    execute p_stmt;
    get diagnostics v_n = row_count;
    v_ok := (v_n = p_rows);
    v_detail := 'rows=' || v_n || ' expected=' || p_rows;
  exception when others then
    v_detail := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  insert into results values (p_name, v_ok, v_detail);
end $$;

-- rows>0 (조회 가능) 확인용
create or replace function pg_temp.rba_some(p_name text, p_uid uuid, p_stmt text)
returns void language plpgsql as $$
declare v_ok boolean := false; v_detail text; v_n int;
begin
  begin
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    set local role authenticated;
    execute p_stmt;
    get diagnostics v_n = row_count;
    v_ok := (v_n > 0);
    v_detail := 'rows=' || v_n;
  exception when others then
    v_detail := sqlstate || ' ' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  insert into results values (p_name, v_ok, v_detail);
end $$;

-- ── 셋업 (슈퍼유저) ────────────────────────────────────────────────────
-- 사용자: O=대표, M=관리자, S=직원 (모두 사업장 X), Y=다른 사업장 대표
insert into auth.users (id, email, raw_user_meta_data) values
  ('30000000-0000-0000-0000-000000000001', 'x-owner@rba.local',   '{"full_name":"X대표"}'),
  ('30000000-0000-0000-0000-000000000002', 'x-manager@rba.local', '{"full_name":"X관리자"}'),
  ('30000000-0000-0000-0000-000000000003', 'x-staff@rba.local',   '{"full_name":"X직원"}'),
  ('30000000-0000-0000-0000-000000000004', 'y-owner@rba.local',   '{"full_name":"Y대표"}');

insert into businesses (id, owner_id, name) values
  ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'X매장'),
  ('10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', 'Y매장');

insert into subscriptions (business_id, status, trial_source, trial_started_at, trial_ends_at)
  select b.id, 'trial', 'signup', now(), now() + interval '3 months' from businesses b
  where not exists (select 1 from subscriptions s where s.business_id = b.id);

update profiles set business_id = '10000000-0000-0000-0000-000000000001', role = 'owner'   where id = '30000000-0000-0000-0000-000000000001';
update profiles set business_id = '10000000-0000-0000-0000-000000000001', role = 'manager' where id = '30000000-0000-0000-0000-000000000002';
update profiles set business_id = '10000000-0000-0000-0000-000000000001', role = 'staff'   where id = '30000000-0000-0000-0000-000000000003';
update profiles set business_id = '10000000-0000-0000-0000-000000000002', role = 'owner'   where id = '30000000-0000-0000-0000-000000000004';

insert into staff (id, business_id, profile_id, name, role) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'X대표', 'owner'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'X관리자', 'manager'),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'X직원', 'staff'),
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', null, '라벨직원-삭제용', 'staff'),
  ('40000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', null, 'Y직원', 'staff');

-- 사업장 X 데이터 (삭제 테스트용으로 행위자별 1개씩)
insert into customers (id, business_id, name) values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'X고객-직원삭제시도'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'X고객-관리자삭제'),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'X고객-대표삭제'),
  ('50000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'Y고객');
insert into reservations (id, business_id, customer_id, start_time, end_time) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', now(), now() + interval '1 hour'),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', now(), now() + interval '1 hour'),
  ('60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', now(), now() + interval '1 hour'),
  ('60000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000009', now(), now() + interval '1 hour');
insert into consultations (id, business_id, customer_id) values
  ('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001'),
  ('70000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000009');
insert into payments (id, business_id, amount, gross_amount, status) values
  ('80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1000, 1000, 'paid'),
  ('80000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 2000, 2000, 'paid');
insert into payment_methods (id, business_id, name) values
  ('81000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '카드'),
  ('81000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', '카드');
insert into notification_settings (business_id) values ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002');
insert into marketing_messages (id, business_id, target_description, message) values
  ('82000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '전체', '안녕');
insert into services (id, business_id, name) values ('83000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '커트');
insert into reservation_groups (id, business_id, name) values ('84000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '그룹');
insert into reservation_types (id, business_id, name) values ('85000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '타입');
insert into consultation_types (id, business_id, name) values ('86000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '상담유형');
insert into customer_grades (id, business_id, name) values ('87000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '등급');
insert into customer_tags (id, business_id, name) values ('88000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '태그');

-- ── 직원(staff, S) ───────────────────────────────────────────────────
select pg_temp.rba_some('직원: 고객 조회', '30000000-0000-0000-0000-000000000003', 'select * from customers');
select pg_temp.rba_rows('직원: 고객 등록', '30000000-0000-0000-0000-000000000003', $$insert into customers (business_id, name) values ('10000000-0000-0000-0000-000000000001', '직원이등록')$$, 1);
select pg_temp.rba_rows('직원: 고객 수정', '30000000-0000-0000-0000-000000000003', $$update customers set memo = '수정' where id = '50000000-0000-0000-0000-000000000001'$$, 1);
select pg_temp.rba_rows('직원: 고객 삭제 → 차단(0행)', '30000000-0000-0000-0000-000000000003', $$delete from customers where id = '50000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.rba_some('직원: 예약 조회', '30000000-0000-0000-0000-000000000003', 'select * from reservations');
select pg_temp.rba_rows('직원: 예약 등록', '30000000-0000-0000-0000-000000000003', $$insert into reservations (business_id, start_time, end_time) values ('10000000-0000-0000-0000-000000000001', now(), now())$$, 1);
select pg_temp.rba_rows('직원: 예약 수정', '30000000-0000-0000-0000-000000000003', $$update reservations set memo = '수정' where id = '60000000-0000-0000-0000-000000000001'$$, 1);
select pg_temp.rba_rows('직원: 예약 삭제 → 차단(0행)', '30000000-0000-0000-0000-000000000003', $$delete from reservations where id = '60000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.rba_some('직원: 상담 조회', '30000000-0000-0000-0000-000000000003', 'select * from consultations');
select pg_temp.rba_rows('직원: 상담 등록', '30000000-0000-0000-0000-000000000003', $$insert into consultations (business_id, customer_id) values ('10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001')$$, 1);
select pg_temp.rba_rows('직원: 상담 수정', '30000000-0000-0000-0000-000000000003', $$update consultations set result = '상담완료' where id = '70000000-0000-0000-0000-000000000001'$$, 1);
select pg_temp.rba_rows('직원: 상담 삭제 → 차단(0행)', '30000000-0000-0000-0000-000000000003', $$delete from consultations where id = '70000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.rba_rows('직원: 매출 조회 → 0행(숨김)', '30000000-0000-0000-0000-000000000003', 'select * from payments', 0);
select pg_temp.rba_fail('직원: 매출 등록 → 차단', '30000000-0000-0000-0000-000000000003', $$insert into payments (business_id, amount, gross_amount, status) values ('10000000-0000-0000-0000-000000000001', 1, 1, 'paid')$$);
select pg_temp.rba_rows('직원: 매출 수정 → 차단(0행)', '30000000-0000-0000-0000-000000000003', $$update payments set amount = 1 where id = '80000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.rba_rows('직원: 매출 삭제 → 차단(0행)', '30000000-0000-0000-0000-000000000003', $$delete from payments where id = '80000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.rba_rows('직원: 결제수단 조회 → 0행', '30000000-0000-0000-0000-000000000003', 'select * from payment_methods', 0);
select pg_temp.rba_fail('직원: 결제수단 추가 → 차단', '30000000-0000-0000-0000-000000000003', $$insert into payment_methods (business_id, name) values ('10000000-0000-0000-0000-000000000001', '직원이만듦')$$);
select pg_temp.rba_rows('직원: 결제수단 수정 → 차단(0행)', '30000000-0000-0000-0000-000000000003', $$update payment_methods set name = '해킹' where id = '81000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.rba_rows('직원: 결제수단 삭제 → 차단(0행)', '30000000-0000-0000-0000-000000000003', $$delete from payment_methods where id = '81000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.rba_rows('직원: 알림설정 조회 → 0행', '30000000-0000-0000-0000-000000000003', 'select * from notification_settings', 0);
select pg_temp.rba_rows('직원: 알림설정 변경 → 차단(0행)', '30000000-0000-0000-0000-000000000003', $$update notification_settings set channel = 'kakao'$$, 0);
select pg_temp.rba_fail('직원: 마케팅 기록 생성 → 차단', '30000000-0000-0000-0000-000000000003', $$insert into marketing_messages (business_id, target_description, message) values ('10000000-0000-0000-0000-000000000001', 'x', 'x')$$);
select pg_temp.rba_rows('직원: 마케팅 기록 조회 → 0행', '30000000-0000-0000-0000-000000000003', 'select * from marketing_messages', 0);
select pg_temp.rba_some('직원: 담당자 목록 조회(선택 목록에 필요)', '30000000-0000-0000-0000-000000000003', 'select * from staff');
select pg_temp.rba_fail('직원: 담당자 추가 → 차단', '30000000-0000-0000-0000-000000000003', $$insert into staff (business_id, name, role) values ('10000000-0000-0000-0000-000000000001', '직원이추가', 'staff')$$);
select pg_temp.rba_rows('직원: 담당자 수정 → 차단(0행)', '30000000-0000-0000-0000-000000000003', $$update staff set name = '해킹' where id = '40000000-0000-0000-0000-000000000004'$$, 0);
select pg_temp.rba_rows('직원: 담당자 삭제 → 차단(0행)', '30000000-0000-0000-0000-000000000003', $$delete from staff where id = '40000000-0000-0000-0000-000000000004'$$, 0);
select pg_temp.rba_some('직원: 시술/메뉴 조회', '30000000-0000-0000-0000-000000000003', 'select * from services');
select pg_temp.rba_fail('직원: 시술/메뉴 추가 → 차단', '30000000-0000-0000-0000-000000000003', $$insert into services (business_id, name) values ('10000000-0000-0000-0000-000000000001', '직원이추가')$$);
select pg_temp.rba_rows('직원: 시술/메뉴 수정 → 차단(0행)', '30000000-0000-0000-0000-000000000003', $$update services set price = 1 where id = '83000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.rba_rows('직원: 시술/메뉴 삭제 → 차단(0행)', '30000000-0000-0000-0000-000000000003', $$delete from services where id = '83000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.rba_fail('직원: 예약그룹 추가 → 차단', '30000000-0000-0000-0000-000000000003', $$insert into reservation_groups (business_id, name) values ('10000000-0000-0000-0000-000000000001', 'x')$$);
select pg_temp.rba_rows('직원: 예약타입 삭제 → 차단(0행)', '30000000-0000-0000-0000-000000000003', $$delete from reservation_types where id = '85000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.rba_rows('직원: 고객등급 수정 → 차단(0행)', '30000000-0000-0000-0000-000000000003', $$update customer_grades set name = 'x' where id = '87000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.rba_fail('직원: 고객태그 추가 → 차단', '30000000-0000-0000-0000-000000000003', $$insert into customer_tags (business_id, name) values ('10000000-0000-0000-0000-000000000001', 'x')$$);
select pg_temp.rba_rows('직원: 고객에 태그 연결(고객 수정의 일부) 허용', '30000000-0000-0000-0000-000000000003', $$insert into customer_tag_links (business_id, customer_id, tag_id) values ('10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '88000000-0000-0000-0000-000000000001')$$, 1);
select pg_temp.rba_rows('직원: 사업장 정보 변경 → 차단(0행)', '30000000-0000-0000-0000-000000000003', $$update businesses set name = '해킹' where id = '10000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.rba_fail('직원: 자기 role 을 owner 로 → 차단', '30000000-0000-0000-0000-000000000003', $$update profiles set role = 'owner' where id = '30000000-0000-0000-0000-000000000003'$$);
select pg_temp.rba_fail('직원: 직급 변경 함수 호출 → 차단', '30000000-0000-0000-0000-000000000003', $$select public.set_member_role('40000000-0000-0000-0000-000000000004', 'manager')$$);

-- 직원 → 다른 사업장(Y)
select pg_temp.rba_rows('직원: 다른 사업장 고객 조회 → 0행', '30000000-0000-0000-0000-000000000003', $$select * from customers where business_id = '10000000-0000-0000-0000-000000000002'$$, 0);
select pg_temp.rba_fail('직원: 다른 사업장 소속으로 고객 등록 → 차단', '30000000-0000-0000-0000-000000000003', $$insert into customers (business_id, name) values ('10000000-0000-0000-0000-000000000002', '침입')$$);
select pg_temp.rba_rows('직원: 다른 사업장 고객 수정 → 0행', '30000000-0000-0000-0000-000000000003', $$update customers set name = '해킹' where id = '50000000-0000-0000-0000-000000000009'$$, 0);
select pg_temp.rba_rows('직원: 다른 사업장 예약 삭제 → 0행', '30000000-0000-0000-0000-000000000003', $$delete from reservations where id = '60000000-0000-0000-0000-000000000009'$$, 0);
select pg_temp.rba_rows('직원: 다른 사업장 매출 조회 → 0행', '30000000-0000-0000-0000-000000000003', $$select * from payments where business_id = '10000000-0000-0000-0000-000000000002'$$, 0);

-- ── 관리자(manager, M) ───────────────────────────────────────────────
select pg_temp.rba_rows('관리자: 고객 삭제 허용', '30000000-0000-0000-0000-000000000002', $$delete from customers where id = '50000000-0000-0000-0000-000000000002'$$, 1);
select pg_temp.rba_rows('관리자: 예약 삭제 허용', '30000000-0000-0000-0000-000000000002', $$delete from reservations where id = '60000000-0000-0000-0000-000000000002'$$, 1);
select pg_temp.rba_rows('관리자: 상담 삭제 허용', '30000000-0000-0000-0000-000000000002', $$delete from consultations where id = '70000000-0000-0000-0000-000000000002'$$, 1);
select pg_temp.rba_some('관리자: 매출 조회 허용', '30000000-0000-0000-0000-000000000002', 'select * from payments');
select pg_temp.rba_rows('관리자: 매출 등록 허용', '30000000-0000-0000-0000-000000000002', $$insert into payments (business_id, amount, gross_amount, status) values ('10000000-0000-0000-0000-000000000001', 5, 5, 'paid')$$, 1);
select pg_temp.rba_rows('관리자: 결제수단 추가 허용', '30000000-0000-0000-0000-000000000002', $$insert into payment_methods (business_id, name) values ('10000000-0000-0000-0000-000000000001', '간편결제')$$, 1);
select pg_temp.rba_rows('관리자: 시술/메뉴 추가 허용', '30000000-0000-0000-0000-000000000002', $$insert into services (business_id, name) values ('10000000-0000-0000-0000-000000000001', '펌')$$, 1);
select pg_temp.rba_rows('관리자: 담당자 추가 허용', '30000000-0000-0000-0000-000000000002', $$insert into staff (business_id, name, role) values ('10000000-0000-0000-0000-000000000001', '신입', 'staff')$$, 1);
select pg_temp.rba_rows('관리자: 담당자(라벨) 삭제 허용', '30000000-0000-0000-0000-000000000002', $$delete from staff where id = '40000000-0000-0000-0000-000000000004'$$, 1);
select pg_temp.rba_rows('관리자: 대표 담당자 행 삭제 → 차단(0행)', '30000000-0000-0000-0000-000000000002', $$delete from staff where id = '40000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.rba_rows('관리자: 알림설정 조회 → 0행 (대표 전용)', '30000000-0000-0000-0000-000000000002', 'select * from notification_settings', 0);
select pg_temp.rba_rows('관리자: 알림설정 변경 → 차단(0행)', '30000000-0000-0000-0000-000000000002', $$update notification_settings set channel = 'kakao'$$, 0);
select pg_temp.rba_fail('관리자: 마케팅 기록 생성 → 차단 (대표 전용)', '30000000-0000-0000-0000-000000000002', $$insert into marketing_messages (business_id, target_description, message) values ('10000000-0000-0000-0000-000000000001', 'x', 'x')$$);
select pg_temp.rba_rows('관리자: 사업장 정보 변경 → 차단(0행)', '30000000-0000-0000-0000-000000000002', $$update businesses set name = '해킹' where id = '10000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.rba_fail('관리자: 직급 변경 함수 → 차단 (대표 전용)', '30000000-0000-0000-0000-000000000002', $$select public.set_member_role('40000000-0000-0000-0000-000000000003', 'manager')$$);
select pg_temp.rba_rows('관리자: 다른 사업장 고객 삭제 → 0행', '30000000-0000-0000-0000-000000000002', $$delete from customers where id = '50000000-0000-0000-0000-000000000009'$$, 0);

-- ── 대표(owner, O) ───────────────────────────────────────────────────
select pg_temp.rba_rows('대표: 고객 삭제 허용', '30000000-0000-0000-0000-000000000001', $$delete from customers where id = '50000000-0000-0000-0000-000000000003'$$, 1);
select pg_temp.rba_rows('대표: 알림설정 변경 허용', '30000000-0000-0000-0000-000000000001', $$update notification_settings set channel = 'kakao'$$, 1);
select pg_temp.rba_rows('대표: 마케팅 기록 생성 허용', '30000000-0000-0000-0000-000000000001', $$insert into marketing_messages (business_id, target_description, message) values ('10000000-0000-0000-0000-000000000001', '전체', '공지')$$, 1);
select pg_temp.rba_rows('대표: 사업장 정보 변경 허용', '30000000-0000-0000-0000-000000000001', $$update businesses set name = 'X매장(수정)' where id = '10000000-0000-0000-0000-000000000001'$$, 1);
select pg_temp.rba_rows('대표: 직급 변경 허용', '30000000-0000-0000-0000-000000000001', $$select public.set_member_role('40000000-0000-0000-0000-000000000003', 'staff')$$, 1);
select pg_temp.rba_rows('대표: 자기(대표) 담당자 행 삭제 → 차단(0행)', '30000000-0000-0000-0000-000000000001', $$delete from staff where id = '40000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.rba_rows('대표: 다른 사업장(Y) 고객 삭제 → 0행', '30000000-0000-0000-0000-000000000001', $$delete from customers where id = '50000000-0000-0000-0000-000000000009'$$, 0);

-- ── 사후 확인: 차단된 삭제/변경이 실제로 데이터를 안 바꿨는지 ─────────────
insert into results select '사후확인: 직원 삭제 시도 대상(고객/예약/상담/매출/결제수단/담당자/시술)이 모두 그대로',
  (select count(*) from customers where id = '50000000-0000-0000-0000-000000000001') = 1
  and (select count(*) from reservations where id = '60000000-0000-0000-0000-000000000001') = 1
  and (select count(*) from consultations where id = '70000000-0000-0000-0000-000000000001') = 1
  and (select amount from payments where id = '80000000-0000-0000-0000-000000000001') = 1000
  and (select count(*) from payment_methods where id = '81000000-0000-0000-0000-000000000001') = 1
  and (select count(*) from services where id = '83000000-0000-0000-0000-000000000001') = 1
  and (select count(*) from staff where id = '40000000-0000-0000-0000-000000000001') = 1, null;
insert into results select '사후확인: 다른 사업장(Y) 데이터 그대로',
  (select count(*) from customers where id = '50000000-0000-0000-0000-000000000009' and name = 'Y고객') = 1
  and (select count(*) from reservations where id = '60000000-0000-0000-0000-000000000009') = 1
  and (select count(*) from payments where id = '80000000-0000-0000-0000-000000000009') = 1, null;
insert into results select '사후확인: 직원 프로필 role 은 그대로 staff',
  (select role from profiles where id = '30000000-0000-0000-0000-000000000003') = 'staff', null;

-- ── 결과 ──────────────────────────────────────────────────────────────
select case when ok then 'PASS' else 'FAIL' end as result, name, detail from results order by ok, name;
