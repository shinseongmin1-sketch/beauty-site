-- 무료체험/구독(009) 테스트: 중복 방지, 탈퇴 후 재가입, 전화번호 보조 신호, 만료 후 쓰기 차단, 007/008 직급 정책 유지

drop table if exists pg_temp.expire_n;
drop table if exists pg_temp.ids;
drop table if exists pg_temp.results;
create temp table results (name text, ok boolean, detail text);
grant all on results to public;

create or replace function pg_temp.sub_fail(p_name text, p_uid uuid, p_stmt text, p_state text default null)
returns void language plpgsql as $$
declare v_ok boolean := false; v_detail text := 'no error raised';
begin
  begin
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    set local role authenticated;
    execute p_stmt;
  exception when others then
    if p_state is null or sqlstate = p_state then v_ok := true; v_detail := sqlstate || ' ' || sqlerrm;
    else v_detail := 'wrong sqlstate ' || sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role; perform set_config('request.jwt.claim.sub', '', true);
  insert into results values (p_name, v_ok, v_detail);
end $$;

create or replace function pg_temp.sub_rows(p_name text, p_uid uuid, p_stmt text, p_rows int)
returns void language plpgsql as $$
declare v_ok boolean := false; v_detail text; v_n int;
begin
  begin
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    set local role authenticated;
    execute p_stmt;
    get diagnostics v_n = row_count;
    v_ok := (v_n = p_rows); v_detail := 'rows=' || v_n || ' expected=' || p_rows;
  exception when others then v_detail := sqlstate || ' ' || sqlerrm; end;
  reset role; perform set_config('request.jwt.claim.sub', '', true);
  insert into results values (p_name, v_ok, v_detail);
end $$;

-- 사용자로 사업장 생성 (셋업용, 결과 기록 없음). 실패해도 예외를 밖으로 던지지 않고 null 반환.
create or replace function pg_temp.sub_create(p_uid uuid, p_name text, p_hash text, p_phone_hash text default null)
returns uuid language plpgsql as $$
declare v uuid;
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
  v := public.create_my_business(p_name, '02-000', '서울', '대표', p_hash, '***', p_phone_hash);
  reset role; perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

-- 해시 대용 고정 값 (DB 는 64자리 hex 형식만 검사한다)
-- H1: 사업자번호 1111111111 의 해시 역할, H2: 다른 사업자번호, PH: 같은 전화번호
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-0000000000a1', 'a@sub.local', '{"full_name":"A대표"}'),
  ('a0000000-0000-0000-0000-0000000000a2', 'b@sub.local', '{"full_name":"B대표"}'),
  ('a0000000-0000-0000-0000-0000000000a3', 'c@sub.local', '{"full_name":"C대표"}'),
  ('a0000000-0000-0000-0000-0000000000a4', 'd@sub.local', '{"full_name":"D대표"}'),
  ('a0000000-0000-0000-0000-0000000000a5', 'm@sub.local', '{"full_name":"A관리자"}'),
  ('a0000000-0000-0000-0000-0000000000a6', 's@sub.local', '{"full_name":"A직원"}'),
  ('a0000000-0000-0000-0000-0000000000a7', 'l@sub.local', '{"full_name":"A연결직원"}'),
  ('a0000000-0000-0000-0000-0000000000e1', 'e1@sub.local', '{}'),
  ('a0000000-0000-0000-0000-0000000000e2', 'e2@sub.local', '{}'),
  ('a0000000-0000-0000-0000-0000000000e3', 'e3@sub.local', '{}'),
  ('a0000000-0000-0000-0000-0000000000e4', 'e4@sub.local', '{}'),
  ('a0000000-0000-0000-0000-0000000000f1', 'legacy@sub.local', '{"full_name":"기존대표"}'),
  ('a0000000-0000-0000-0000-0000000000f2', 'nonum@sub.local', '{}');

create temp table ids (k text primary key, v text);
grant all on ids to public;
insert into ids values ('bizA', pg_temp.sub_create('a0000000-0000-0000-0000-0000000000a1', 'A사업장', repeat('1', 64))::text);

-- ── 1. A 사업장: 사업자번호 H1 → 3개월 무료체험 시작 ──────────────────────
insert into results select 'A: 무료체험(trial) 시작 + 시작/종료일 저장(종료 = 시작 + 3개월)',
  s.status = 'trial' and s.trial_source = 'signup' and s.trial_denied_reason is null
  and s.trial_ends_at = s.trial_started_at + interval '3 months', s.status::text
from subscriptions s where s.business_id = (select v::uuid from ids where k = 'bizA');
insert into results select 'A: 무료체험 이력(trial_history) 기록 (사업자번호 해시 + 사업장 연결)',
  (select count(*) from trial_history where business_number_hash = repeat('1', 64) and business_id = (select v::uuid from ids where k = 'bizA') and status = 'active') = 1, null;
insert into results select 'A: 사업장에 사업자번호는 해시/마스킹만 저장 (원문 컬럼 없음)',
  (select business_number_hash = repeat('1', 64) and business_number_masked = '***' from businesses where id = (select v::uuid from ids where k = 'bizA'))
  and not exists (select 1 from information_schema.columns where table_name in ('businesses', 'trial_history') and column_name ilike '%number%' and column_name not in ('business_number_hash', 'business_number_masked')), null;
insert into results select 'A: 지급 즉시 쓰기 가능 (business_is_writable)', public.business_is_writable((select v::uuid from ids where k = 'bizA')), null;

-- 사업자번호 필수 / 형식
select pg_temp.sub_fail('사업자번호 해시 없이 사업장 생성 → 차단', 'a0000000-0000-0000-0000-0000000000f2', $$select public.create_my_business('무번호매장')$$, '22023');
select pg_temp.sub_fail('사업자번호 해시 형식 오류 → 차단', 'a0000000-0000-0000-0000-0000000000f2', $$select public.create_my_business('형식오류', null, null, null, 'not-a-hash')$$, '22023');

-- ── 2. B 계정: 같은 사업자번호 → 무료체험 거부 ────────────────────────────
insert into ids values ('bizB', pg_temp.sub_create('a0000000-0000-0000-0000-0000000000a2', 'B사업장', repeat('1', 64))::text);
insert into results select 'B: 같은 사업자번호 → 무료체험 거부 (expired + 사유 기록), 사업장 자체는 생성',
  (select status = 'expired' and trial_denied_reason = 'business_number_used' and trial_started_at is null from subscriptions where business_id = (select v::uuid from ids where k = 'bizB'))
  and exists (select 1 from businesses where id = (select v::uuid from ids where k = 'bizB')), null;
insert into results select 'B: 거부돼도 이력은 1건 그대로 (재지급 없음)', (select count(*) from trial_history where business_number_hash = repeat('1', 64)) = 1, null;
insert into results select 'B: 쓰기 불가', not public.business_is_writable((select v::uuid from ids where k = 'bizB')), null;

-- ── 3. 무료체험 중 A: 등록/수정 가능, 직급 정책(007) 유지 ────────────────────
update profiles set business_id = (select v::uuid from ids where k = 'bizA'), role = 'manager' where id = 'a0000000-0000-0000-0000-0000000000a5';
update profiles set business_id = (select v::uuid from ids where k = 'bizA'), role = 'staff'   where id = 'a0000000-0000-0000-0000-0000000000a6';
update profiles set business_id = (select v::uuid from ids where k = 'bizA'), role = 'staff'   where id = 'a0000000-0000-0000-0000-0000000000a7';
insert into staff (id, business_id, profile_id, name, role) select 'a1000000-0000-0000-0000-000000000005', v::uuid, 'a0000000-0000-0000-0000-0000000000a5', 'A관리자', 'manager' from ids where k = 'bizA';
insert into staff (id, business_id, profile_id, name, role) select 'a1000000-0000-0000-0000-000000000006', v::uuid, 'a0000000-0000-0000-0000-0000000000a6', 'A직원', 'staff' from ids where k = 'bizA';
insert into staff (id, business_id, profile_id, name, role) select 'a1000000-0000-0000-0000-000000000007', v::uuid, 'a0000000-0000-0000-0000-0000000000a7', 'A연결직원', 'staff' from ids where k = 'bizA';
insert into staff (id, business_id, name, role) select 'a1000000-0000-0000-0000-000000000008', v::uuid, '초대대기라벨', 'staff' from ids where k = 'bizA';
insert into customers (id, business_id, name) select 'a2000000-0000-0000-0000-000000000001', v::uuid, 'A고객' from ids where k = 'bizA';
insert into customers (id, business_id, name) select 'a2000000-0000-0000-0000-000000000002', v::uuid, 'A고객-삭제용' from ids where k = 'bizA';
insert into reservations (id, business_id, customer_id, start_time, end_time) select 'a3000000-0000-0000-0000-000000000001', v::uuid, 'a2000000-0000-0000-0000-000000000001', now(), now() + interval '1 hour' from ids where k = 'bizA';
insert into consultations (id, business_id, customer_id) select 'a4000000-0000-0000-0000-000000000001', v::uuid, 'a2000000-0000-0000-0000-000000000001' from ids where k = 'bizA';
insert into payments (id, business_id, amount, gross_amount, status) select 'a5000000-0000-0000-0000-000000000001', v::uuid, 1000, 1000, 'paid' from ids where k = 'bizA';

select pg_temp.sub_rows('체험 중: 대표 고객 등록 가능', 'a0000000-0000-0000-0000-0000000000a1', format($$insert into customers (business_id, name) values (%L, '체험중고객')$$, (select v from ids where k='bizA')), 1);
select pg_temp.sub_rows('체험 중: 직원 예약 등록 가능', 'a0000000-0000-0000-0000-0000000000a6', format($$insert into reservations (business_id, start_time, end_time) values (%L, now(), now())$$, (select v from ids where k='bizA')), 1);
select pg_temp.sub_rows('체험 중: 직원 상담 등록 가능', 'a0000000-0000-0000-0000-0000000000a6', format($$insert into consultations (business_id, customer_id) values (%L, 'a2000000-0000-0000-0000-000000000001')$$, (select v from ids where k='bizA')), 1);
select pg_temp.sub_rows('체험 중: 관리자 매출 등록 가능', 'a0000000-0000-0000-0000-0000000000a5', format($$insert into payments (business_id, amount, gross_amount, status) values (%L, 5, 5, 'paid')$$, (select v from ids where k='bizA')), 1);
select pg_temp.sub_rows('체험 중: 대표 매장 설정 변경 가능', 'a0000000-0000-0000-0000-0000000000a1', format($$update businesses set name = 'A사업장(수정)' where id = %L$$, (select v from ids where k='bizA')), 1);
select pg_temp.sub_rows('체험 중(007 유지): 직원 매출 조회는 여전히 0행', 'a0000000-0000-0000-0000-0000000000a6', 'select * from payments', 0);
select pg_temp.sub_rows('체험 중(007 유지): 직원 고객 삭제는 여전히 0행', 'a0000000-0000-0000-0000-0000000000a6', $$delete from customers where id = 'a2000000-0000-0000-0000-000000000002'$$, 0);
select pg_temp.sub_fail('체험 중(007 유지): 관리자 마케팅 기록 생성은 여전히 불가', 'a0000000-0000-0000-0000-0000000000a5', format($$insert into marketing_messages (business_id, target_description, message) values (%L, 'x', 'x')$$, (select v from ids where k='bizA')));

-- ── 4. 구독 테이블 직접 변경 시도 (체험 연장/조작) ─────────────────────────
select pg_temp.sub_fail('대표가 체험 종료일을 직접 연장 → 차단', 'a0000000-0000-0000-0000-0000000000a1', $$update subscriptions set trial_ends_at = now() + interval '10 years'$$);
select pg_temp.sub_fail('대표가 구독 상태를 active 로 직접 변경 → 차단', 'a0000000-0000-0000-0000-0000000000a1', $$update subscriptions set status = 'active'$$);
select pg_temp.sub_fail('구독 행 직접 생성 → 차단', 'a0000000-0000-0000-0000-0000000000a1', $$insert into subscriptions (business_id, status) values (gen_random_uuid(), 'active')$$);
select pg_temp.sub_fail('구독 행 직접 삭제 → 차단', 'a0000000-0000-0000-0000-0000000000a1', $$delete from subscriptions$$);
select pg_temp.sub_fail('무료체험 이력(trial_history) 조회 자체가 불가', 'a0000000-0000-0000-0000-0000000000a1', $$select * from trial_history$$);
select pg_temp.sub_fail('무료체험 이력 직접 삭제 시도(재가입 우회) → 차단', 'a0000000-0000-0000-0000-0000000000a1', $$delete from trial_history$$);
select pg_temp.sub_fail('운영 설정(platform_settings) 조회 불가', 'a0000000-0000-0000-0000-0000000000a1', $$select * from platform_settings$$);
select pg_temp.sub_rows('직원도 자기 사업장 구독 상태는 조회 가능(안내 배너용)', 'a0000000-0000-0000-0000-0000000000a6', 'select * from subscriptions', 1);
select pg_temp.sub_rows('다른 사업장(D 등)은 A 구독을 볼 수 없다 (자기 것 1건만)', 'a0000000-0000-0000-0000-0000000000a2', 'select * from subscriptions', 1);

-- ── 5. 체험 종료 (DB 시각 기준) ────────────────────────────────────────
update subscriptions set trial_ends_at = now() - interval '1 day', trial_started_at = now() - interval '3 months' - interval '1 day'
  where business_id = (select v::uuid from ids where k = 'bizA');
update trial_history set trial_ends_at = now() - interval '1 day', trial_started_at = now() - interval '3 months' - interval '1 day' where business_number_hash = repeat('1', 64);
insert into results select '체험 종료: 저장된 status 가 아직 trial 이어도 DB 는 쓰기 불가로 판단 (시각 기준)',
  not public.business_is_writable((select v::uuid from ids where k = 'bizA'))
  and (select status = 'trial' from subscriptions where business_id = (select v::uuid from ids where k = 'bizA')), null;

-- 조회는 허용 (Export 는 조회 기반)
select pg_temp.sub_rows('종료 후: 대표 고객 조회 가능', 'a0000000-0000-0000-0000-0000000000a1', 'select * from customers', 3);
select pg_temp.sub_rows('종료 후: 대표 예약/상담/매출 조회 가능', 'a0000000-0000-0000-0000-0000000000a1', 'select id from reservations union all select id from consultations union all select id from payments', 6);
select pg_temp.sub_rows('종료 후: 직원 고객/예약/상담 조회 가능', 'a0000000-0000-0000-0000-0000000000a6', 'select id from customers union all select id from reservations union all select id from consultations', 7);
select pg_temp.sub_rows('종료 후: 담당자·사업장 정보 조회 가능', 'a0000000-0000-0000-0000-0000000000a1', 'select id from staff union all select id from businesses', 6);
-- 프로필(계정) 정보 수정은 허용
select pg_temp.sub_rows('종료 후: 본인 이름/전화번호 수정(계정 정보)은 허용', 'a0000000-0000-0000-0000-0000000000a6', $$update profiles set full_name = '직원새이름' where id = 'a0000000-0000-0000-0000-0000000000a6'$$, 1);

-- 쓰기는 차단: 등록/수정/삭제 × 직급
select pg_temp.sub_fail('종료 후: 대표 고객 등록 → 차단', 'a0000000-0000-0000-0000-0000000000a1', format($$insert into customers (business_id, name) values (%L, '만료후고객')$$, (select v from ids where k='bizA')));
select pg_temp.sub_rows('종료 후: 대표 고객 수정 → 차단(0행)', 'a0000000-0000-0000-0000-0000000000a1', $$update customers set memo = '수정' where id = 'a2000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.sub_rows('종료 후: 대표 고객 삭제 → 차단(0행)', 'a0000000-0000-0000-0000-0000000000a1', $$delete from customers where id = 'a2000000-0000-0000-0000-000000000002'$$, 0);
select pg_temp.sub_fail('종료 후: 직원 예약 등록 → 차단', 'a0000000-0000-0000-0000-0000000000a6', format($$insert into reservations (business_id, start_time, end_time) values (%L, now(), now())$$, (select v from ids where k='bizA')));
select pg_temp.sub_rows('종료 후: 직원 예약 수정 → 차단(0행)', 'a0000000-0000-0000-0000-0000000000a6', $$update reservations set memo = '수정' where id = 'a3000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.sub_fail('종료 후: 직원 상담 등록 → 차단', 'a0000000-0000-0000-0000-0000000000a6', format($$insert into consultations (business_id, customer_id) values (%L, 'a2000000-0000-0000-0000-000000000001')$$, (select v from ids where k='bizA')));
select pg_temp.sub_rows('종료 후: 직원 상담 수정 → 차단(0행)', 'a0000000-0000-0000-0000-0000000000a6', $$update consultations set result = '상담완료' where id = 'a4000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.sub_fail('종료 후: 관리자 매출 등록 → 차단', 'a0000000-0000-0000-0000-0000000000a5', format($$insert into payments (business_id, amount, gross_amount, status) values (%L, 5, 5, 'paid')$$, (select v from ids where k='bizA')));
select pg_temp.sub_rows('종료 후: 관리자 매출 수정 → 차단(0행)', 'a0000000-0000-0000-0000-0000000000a5', $$update payments set amount = 1 where id = 'a5000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.sub_rows('종료 후: 관리자 매출 삭제 → 차단(0행)', 'a0000000-0000-0000-0000-0000000000a5', $$delete from payments where id = 'a5000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.sub_fail('종료 후: 관리자 결제수단 추가 → 차단', 'a0000000-0000-0000-0000-0000000000a5', format($$insert into payment_methods (business_id, name) values (%L, '간편결제')$$, (select v from ids where k='bizA')));
select pg_temp.sub_fail('종료 후: 관리자 시술/메뉴 추가 → 차단', 'a0000000-0000-0000-0000-0000000000a5', format($$insert into services (business_id, name) values (%L, '펌')$$, (select v from ids where k='bizA')));
select pg_temp.sub_fail('종료 후: 관리자 담당자 추가 → 차단', 'a0000000-0000-0000-0000-0000000000a5', format($$insert into staff (business_id, name, role) values (%L, '신입', 'staff')$$, (select v from ids where k='bizA')));
select pg_temp.sub_rows('종료 후: 관리자 담당자 수정 → 차단(0행)', 'a0000000-0000-0000-0000-0000000000a5', $$update staff set title = '실장' where id = 'a1000000-0000-0000-0000-000000000008'$$, 0);
select pg_temp.sub_rows('종료 후: 관리자 담당자 삭제 → 차단(0행)', 'a0000000-0000-0000-0000-0000000000a5', $$delete from staff where id = 'a1000000-0000-0000-0000-000000000008'$$, 0);
select pg_temp.sub_rows('종료 후: 대표 매장 설정 변경 → 차단(0행)', 'a0000000-0000-0000-0000-0000000000a1', format($$update businesses set name = '만료후변경' where id = %L$$, (select v from ids where k='bizA')), 0);
select pg_temp.sub_rows('종료 후: 대표 알림 설정 변경 → 차단(0행)', 'a0000000-0000-0000-0000-0000000000a1', $$update notification_settings set channel = 'kakao'$$, 0);
select pg_temp.sub_fail('종료 후: 대표 마케팅 기록 생성 → 차단', 'a0000000-0000-0000-0000-0000000000a1', format($$insert into marketing_messages (business_id, target_description, message) values (%L, 'x', 'x')$$, (select v from ids where k='bizA')));
select pg_temp.sub_fail('종료 후: 고객 태그 등록 → 차단', 'a0000000-0000-0000-0000-0000000000a5', format($$insert into customer_tags (business_id, name) values (%L, '태그')$$, (select v from ids where k='bizA')));
select pg_temp.sub_fail('종료 후: 예약그룹 등록 → 차단', 'a0000000-0000-0000-0000-0000000000a5', format($$insert into reservation_groups (business_id, name) values (%L, '그룹')$$, (select v from ids where k='bizA')));

-- 함수 경로(RLS 를 우회하는 definer)도 차단 / 보안 조치는 허용
select pg_temp.sub_fail('종료 후: 직급 변경 함수 → 차단(subscription_inactive)', 'a0000000-0000-0000-0000-0000000000a1', $$select public.set_member_role('a1000000-0000-0000-0000-000000000006', 'manager')$$, '42501');
select pg_temp.sub_fail('종료 후: 직원 초대 생성 → 차단(subscription_inactive)', 'a0000000-0000-0000-0000-0000000000a1', $$select public.create_staff_invitation('a1000000-0000-0000-0000-000000000008', 'x@example.com', repeat('c', 64))$$, '42501');
select pg_temp.sub_rows('종료 후: 초대 취소는 허용(보안 조치)', 'a0000000-0000-0000-0000-0000000000a1', $$select public.revoke_staff_invitation('a1000000-0000-0000-0000-000000000008')$$, 1);
select pg_temp.sub_rows('종료 후: 직원 계정 연결 해제는 허용(접근 회수)', 'a0000000-0000-0000-0000-0000000000a1', $$select public.unlink_staff_account('a1000000-0000-0000-0000-000000000007')$$, 1);
select pg_temp.sub_fail('종료 후: 새 사업장 생성으로 우회 불가 (이미 사업장 있음)', 'a0000000-0000-0000-0000-0000000000a1', $$select public.create_my_business('우회', null, null, null, repeat('9', 64))$$, '23505');

-- 만료 반영 함수
select pg_temp.sub_rows('종료 후: 대표 로그인 후 만료 반영(sync) 호출 가능', 'a0000000-0000-0000-0000-0000000000a1', 'select public.sync_my_subscription()', 1);
insert into results select 'sync: status trial → expired, 이력은 ended 로 반영',
  (select status = 'expired' from subscriptions where business_id = (select v::uuid from ids where k = 'bizA'))
  and (select status = 'ended' from trial_history where business_number_hash = repeat('1', 64)), null;

-- ── 6. 유료 구독/정지/취소 (결제 연동 시 service_role 이 채울 상태) ─────────
update subscriptions set status = 'active', plan = 'basic', billing_cycle = 'monthly', current_period_start = now(), current_period_end = now() + interval '1 month'
  where business_id = (select v::uuid from ids where k = 'bizA');
select pg_temp.sub_rows('active(유료): 대표 고객 등록 가능', 'a0000000-0000-0000-0000-0000000000a1', format($$insert into customers (business_id, name) values (%L, '유료고객')$$, (select v from ids where k='bizA')), 1);
update subscriptions set status = 'suspended', suspended_at = now(), suspended_reason = '시험' where business_id = (select v::uuid from ids where k = 'bizA');
select pg_temp.sub_fail('suspended(정지): 대표 고객 등록 → 차단', 'a0000000-0000-0000-0000-0000000000a1', format($$insert into customers (business_id, name) values (%L, '정지고객')$$, (select v from ids where k='bizA')));
select pg_temp.sub_rows('suspended(정지): 조회는 가능', 'a0000000-0000-0000-0000-0000000000a1', 'select * from customers', 4);
update subscriptions set status = 'canceled', canceled_at = now(), current_period_end = null where business_id = (select v::uuid from ids where k = 'bizA');
select pg_temp.sub_fail('canceled(기간 없음): 고객 등록 → 차단', 'a0000000-0000-0000-0000-0000000000a1', format($$insert into customers (business_id, name) values (%L, '취소고객')$$, (select v from ids where k='bizA')));
update subscriptions set current_period_end = now() + interval '5 days' where business_id = (select v::uuid from ids where k = 'bizA');
select pg_temp.sub_rows('canceled(남은 유료 기간 있음): 기간 종료 전까지 등록 가능', 'a0000000-0000-0000-0000-0000000000a1', format($$insert into customers (business_id, name) values (%L, '취소전고객')$$, (select v from ids where k='bizA')), 1);

-- ── 7. A 계정 탈퇴 → 같은 사업자번호 C 가입 → 무료체험 거부 ───────────────
delete from auth.users where id = 'a0000000-0000-0000-0000-0000000000a1';
insert into results select 'A 탈퇴: 사업장/구독은 삭제되고, 무료체험 이력은 남는다 (business_id 만 비워짐)',
  not exists (select 1 from businesses where id = (select v::uuid from ids where k = 'bizA'))
  and (select count(*) from trial_history where business_number_hash = repeat('1', 64) and business_id is null) = 1, null;
insert into ids values ('bizC', pg_temp.sub_create('a0000000-0000-0000-0000-0000000000a3', 'C사업장', repeat('1', 64))::text);
insert into results select 'C: A 탈퇴 후 같은 사업자번호로 가입 → 무료체험 거부',
  (select status = 'expired' and trial_denied_reason = 'business_number_used' from subscriptions where business_id = (select v::uuid from ids where k = 'bizC'))
  and (select count(*) from trial_history where business_number_hash = repeat('1', 64)) = 1, null;

-- ── 8. 다른 사업자번호 D → 무료체험 가능 ──────────────────────────────────
insert into ids values ('bizD', pg_temp.sub_create('a0000000-0000-0000-0000-0000000000a4', 'D사업장', repeat('2', 64))::text);
insert into results select 'D: 다른 사업자번호 → 무료체험 지급',
  (select status = 'trial' and trial_denied_reason is null from subscriptions where business_id = (select v::uuid from ids where k = 'bizD')), null;
select pg_temp.sub_rows('D: 체험 중 고객 등록 가능', 'a0000000-0000-0000-0000-0000000000a4', format($$insert into customers (business_id, name) values (%L, 'D고객')$$, (select v from ids where k='bizD')), 1);
select pg_temp.sub_fail('B/C(체험 거부): 고객 등록 → 차단', 'a0000000-0000-0000-0000-0000000000a2', format($$insert into customers (business_id, name) values (%L, 'B고객')$$, (select v from ids where k='bizB')));
select pg_temp.sub_fail('C(체험 거부): 고객 등록 → 차단', 'a0000000-0000-0000-0000-0000000000a3', format($$insert into customers (business_id, name) values (%L, 'C고객')$$, (select v from ids where k='bizC')));
select pg_temp.sub_rows('C(체험 거부): 조회는 가능 (로그인·조회 허용)', 'a0000000-0000-0000-0000-0000000000a3', 'select * from businesses', 1);
select pg_temp.sub_rows('D → 다른 사업장(B) 고객 등록/조회 불가: 조회 0행', 'a0000000-0000-0000-0000-0000000000a4', format($$select * from customers where business_id = %L$$, (select v from ids where k='bizB')), 0);
select pg_temp.sub_fail('D → B 사업장 소속으로 고객 등록 → 차단', 'a0000000-0000-0000-0000-0000000000a4', format($$insert into customers (business_id, name) values (%L, '침입')$$, (select v from ids where k='bizB')));

-- ── 9. 전화번호 = 보조 신호 (같은 전화번호로 여러 사업자번호) ────────────────
insert into ids values ('e1', pg_temp.sub_create('a0000000-0000-0000-0000-0000000000e1', 'E1', repeat('3', 64), repeat('c', 64))::text);
insert into ids values ('e2', pg_temp.sub_create('a0000000-0000-0000-0000-0000000000e2', 'E2', repeat('4', 64), repeat('c', 64))::text);
insert into ids values ('e3', pg_temp.sub_create('a0000000-0000-0000-0000-0000000000e3', 'E3', repeat('5', 64), repeat('c', 64))::text);
insert into ids values ('e4', pg_temp.sub_create('a0000000-0000-0000-0000-0000000000e4', 'E4', repeat('6', 64), repeat('c', 64))::text);
insert into results select '전화번호 보조 신호: 같은 번호로 3곳까지는 체험 지급(다른 사업자번호 = 별도 사업장), 재사용 플래그 기록',
  (select count(*) from subscriptions where business_id in (select v::uuid from ids where k in ('e1','e2','e3')) and status = 'trial') = 3
  and (select array_agg(phone_seen_before order by created_at, id) is not null from trial_history where phone_hash = repeat('c', 64))
  and (select count(*) from trial_history where phone_hash = repeat('c', 64) and phone_seen_before) = 2, null;
insert into results select '전화번호 보조 신호: 한도(3) 초과 4번째는 체험 거부(phone_limit)',
  (select status = 'expired' and trial_denied_reason = 'phone_limit' from subscriptions where business_id = (select v::uuid from ids where k = 'e4')), null;
insert into results select '전화번호가 없으면 사업자번호만으로 판단 (phone_hash null 허용)',
  exists (select 1 from trial_history where business_number_hash = repeat('2', 64) and phone_hash is null), null;

-- ── 10. 기존 사업장(백필) 사업자번호 사후 등록 ─────────────────────────────
insert into businesses (id, owner_id, name) values ('a6000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000f1', '기존사업장');
update profiles set business_id = 'a6000000-0000-0000-0000-000000000001', role = 'owner' where id = 'a0000000-0000-0000-0000-0000000000f1';
insert into subscriptions (business_id, status, trial_source, trial_started_at, trial_ends_at) values ('a6000000-0000-0000-0000-000000000001', 'trial', 'legacy_backfill', now(), now() + interval '3 months');
insert into trial_history (business_id, source, trial_started_at, trial_ends_at) values ('a6000000-0000-0000-0000-000000000001', 'legacy_backfill', now(), now() + interval '3 months');
select pg_temp.sub_fail('기존 사업장: 이미 다른 사업장이 쓴 사업자번호는 등록 불가(in_use)', 'a0000000-0000-0000-0000-0000000000f1', $$select public.set_business_number(repeat('2', 64), '***')$$, '23505');
select pg_temp.sub_rows('기존 사업장: 새 사업자번호 등록 성공', 'a0000000-0000-0000-0000-0000000000f1', $$select public.set_business_number(repeat('7', 64), '777-**-***77')$$, 1);
insert into results select '사후 등록: 사업장과 이력 행에 해시가 채워진다',
  (select business_number_hash = repeat('7', 64) from businesses where id = 'a6000000-0000-0000-0000-000000000001')
  and exists (select 1 from trial_history where business_id = 'a6000000-0000-0000-0000-000000000001' and business_number_hash = repeat('7', 64)), null;
select pg_temp.sub_fail('사후 등록: 한 번 등록하면 변경 불가', 'a0000000-0000-0000-0000-0000000000f1', $$select public.set_business_number(repeat('8', 64), '***')$$, '23505');
select pg_temp.sub_fail('사업자번호 등록은 대표만 (직원 불가)', 'a0000000-0000-0000-0000-0000000000a6', $$select public.set_business_number(repeat('8', 64), '***')$$);

-- ── 11. 일괄 만료 함수 ────────────────────────────────────────────────
update subscriptions set trial_ends_at = now() - interval '1 minute' where business_id = (select v::uuid from ids where k = 'bizD');
create temp table expire_n as select public.expire_due_trials() as n;
insert into results select 'expire_due_trials(): 종료된 체험을 일괄 expired 로 반영', (select n from expire_n) >= 1
  and (select status = 'expired' from subscriptions where business_id = (select v::uuid from ids where k = 'bizD')), null;
select pg_temp.sub_fail('expire_due_trials 는 브라우저 권한으로 호출 불가', 'a0000000-0000-0000-0000-0000000000a4', $$select public.expire_due_trials()$$);

select case when ok then 'PASS' else 'FAIL' end as result, name, detail from results order by ok, name;
