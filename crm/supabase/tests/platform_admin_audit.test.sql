-- 플랫폼 관리자 + 감사 로그(010) 테스트

drop table if exists pg_temp.pa_out;
drop table if exists pg_temp.ids;
drop table if exists pg_temp.results;
create temp table results (name text, ok boolean, detail text);
grant all on results to public;

create or replace function pg_temp.pa_fail(p_name text, p_uid uuid, p_stmt text, p_state text default null)
returns void language plpgsql as $$
declare v_ok boolean := false; v_detail text := 'no error raised';
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    set local role authenticated;
    execute p_stmt;
  exception when others then
    if p_state is null or sqlstate = p_state then v_ok := true; v_detail := sqlstate || ' ' || sqlerrm;
    else v_detail := 'wrong sqlstate ' || sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role; perform set_config('request.jwt.claim.sub', '', true);
  insert into results values (p_name, v_ok, v_detail);
end $$;

create or replace function pg_temp.pa_rows(p_name text, p_uid uuid, p_stmt text, p_rows int)
returns void language plpgsql as $$
declare v_ok boolean := false; v_detail text; v_n int;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    set local role authenticated;
    execute p_stmt;
    get diagnostics v_n = row_count;
    v_ok := (v_n = p_rows); v_detail := 'rows=' || v_n || ' expected=' || p_rows;
  exception when others then v_detail := sqlstate || ' ' || sqlerrm; end;
  reset role; perform set_config('request.jwt.claim.sub', '', true);
  insert into results values (p_name, v_ok, v_detail);
end $$;

-- service_role 로 실행하는 서버 함수 호출을 흉내: set role service_role (auth.uid() 는 null)
create or replace function pg_temp.pa_service(p_stmt text) returns void language plpgsql as $$
begin
  set local role service_role;
  execute p_stmt;
  reset role;
end $$;

create or replace function pg_temp.pa_service_fail(p_name text, p_stmt text, p_state text default null)
returns void language plpgsql as $$
declare v_ok boolean := false; v_detail text := 'no error raised';
begin
  begin
    set local role service_role;
    execute p_stmt;
  exception when others then
    if p_state is null or sqlstate = p_state then v_ok := true; v_detail := sqlstate || ' ' || sqlerrm;
    else v_detail := 'wrong sqlstate ' || sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role;
  insert into results values (p_name, v_ok, v_detail);
end $$;

-- 사용자로 사업장 생성 (셋업)
create or replace function pg_temp.pa_create(p_uid uuid, p_name text, p_hash text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
  v := public.create_my_business(p_name, '02-000', '서울', '대표', p_hash, '***', null);
  reset role; perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

-- 사용자로 문장 실행 (셋업/행위, 결과 기록 없음)
create or replace function pg_temp.pa_do(p_uid uuid, p_stmt text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
  execute p_stmt;
  reset role; perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- 사용자로 실행한 첫 컬럼(text) 결과 저장
create temp table pa_out (k text primary key, v text);
grant all on pa_out to public;
create or replace function pg_temp.pa_val(p_key text, p_uid uuid, p_stmt text) returns void language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  set local role authenticated;
  execute p_stmt into v;
  reset role; perform set_config('request.jwt.claim.sub', '', true);
  insert into pa_out values (p_key, v) on conflict (k) do update set v = excluded.v;
end $$;

-- 감사 로그 존재 확인
create or replace function pg_temp.pa_log(p_action text, p_biz uuid, p_actor_type text, p_actor uuid default null, p_resource uuid default null, p_result text default 'success')
returns boolean language sql as $$
  select exists (select 1 from audit_logs where action = p_action
    and business_id is not distinct from p_biz and actor_type = p_actor_type and result = p_result
    and (p_actor is null or actor_user_id = p_actor) and (p_resource is null or resource_id = p_resource))
$$;

-- ── 셋업 ──────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-0000-0000-0000000000a1', 'oa@pa.local', '{"full_name":"A대표"}'),
  ('c0000000-0000-0000-0000-0000000000a2', 'ob@pa.local', '{"full_name":"B대표"}'),
  ('c0000000-0000-0000-0000-0000000000a3', 'ma@pa.local', '{"full_name":"A관리자"}'),
  ('c0000000-0000-0000-0000-0000000000a4', 'sa@pa.local', '{"full_name":"A직원"}'),
  ('c0000000-0000-0000-0000-0000000000a5', 'pa@pa.local', '{"full_name":"운영자"}'),
  ('c0000000-0000-0000-0000-0000000000a6', 'u@pa.local',  '{"full_name":"무소속"}'),
  ('c0000000-0000-0000-0000-0000000000a7', 'inv@pa.local','{"full_name":"초대직원"}'),
  ('c0000000-0000-0000-0000-0000000000a8', 'ob2@pa.local','{"full_name":"B2대표"}');

create temp table ids (k text primary key, v text);
grant all on ids to public;
insert into ids values ('A', pg_temp.pa_create('c0000000-0000-0000-0000-0000000000a1', 'A사업장', (md5('pa-1')||md5('pa-1x')))::text);
insert into ids values ('B', pg_temp.pa_create('c0000000-0000-0000-0000-0000000000a2', 'B사업장', (md5('pa-2')||md5('pa-2x')))::text);
insert into ids values ('B2', pg_temp.pa_create('c0000000-0000-0000-0000-0000000000a8', 'A중복사업장', (md5('pa-1')||md5('pa-1x')))::text);

-- 이 파일은 통째로 한 트랜잭션이라 now() 가 모두 같다. 실제 서비스에서는 요청마다 트랜잭션이 달라서, 생성 시각을 과거로 옮겨 같은 상황을 만든다.
update businesses set created_at = created_at - interval '2 days';
update profiles set business_id = (select v::uuid from ids where k = 'A'), role = 'manager' where id = 'c0000000-0000-0000-0000-0000000000a3';
update profiles set business_id = (select v::uuid from ids where k = 'A'), role = 'staff'   where id = 'c0000000-0000-0000-0000-0000000000a4';
insert into staff (id, business_id, profile_id, name, role) select 'c1000000-0000-0000-0000-000000000003', v::uuid, 'c0000000-0000-0000-0000-0000000000a3', 'A관리자', 'manager' from ids where k = 'A';
insert into staff (id, business_id, profile_id, name, role) select 'c1000000-0000-0000-0000-000000000004', v::uuid, 'c0000000-0000-0000-0000-0000000000a4', 'A직원', 'staff' from ids where k = 'A';
insert into staff (id, business_id, name, role) select 'c1000000-0000-0000-0000-000000000005', v::uuid, '초대대기라벨', 'staff' from ids where k = 'A';
insert into platform_admins (user_id) values ('c0000000-0000-0000-0000-0000000000a5');

-- ── 1. 플랫폼 관리자 식별 / 스스로 얻을 수 없음 ────────────────────────────
select pg_temp.pa_val('is_pa', 'c0000000-0000-0000-0000-0000000000a5', 'select public.is_platform_admin()::text');
select pg_temp.pa_val('is_oa', 'c0000000-0000-0000-0000-0000000000a1', 'select public.is_platform_admin()::text');
insert into results select '플랫폼 관리자만 is_platform_admin() = true (대표는 false)', (select v from pa_out where k = 'is_pa') = 'true' and (select v from pa_out where k = 'is_oa') = 'false', null;
select pg_temp.pa_fail('일반 사용자: platform_admins 조회 불가', 'c0000000-0000-0000-0000-0000000000a1', 'select * from platform_admins');
select pg_temp.pa_fail('일반 사용자(대표): platform_admins 에 자기 등록 → 차단', 'c0000000-0000-0000-0000-0000000000a1', $$insert into platform_admins (user_id) values ('c0000000-0000-0000-0000-0000000000a1')$$);
select pg_temp.pa_fail('일반 사용자(무소속): platform_admins 에 자기 등록 → 차단', 'c0000000-0000-0000-0000-0000000000a6', $$insert into platform_admins (user_id) values ('c0000000-0000-0000-0000-0000000000a6')$$);
select pg_temp.pa_fail('일반 사용자: 운영자 계정의 active 변경 시도 → 차단', 'c0000000-0000-0000-0000-0000000000a1', $$update platform_admins set active = false$$);
select pg_temp.pa_fail('직원: platform_admins 등록 시도 → 차단', 'c0000000-0000-0000-0000-0000000000a4', $$insert into platform_admins (user_id) values ('c0000000-0000-0000-0000-0000000000a4')$$);
select pg_temp.pa_fail('대표: profiles.role 을 바꿔 운영자가 되려는 시도 → 차단(권한 컬럼)', 'c0000000-0000-0000-0000-0000000000a1', $$update profiles set role = 'owner', business_id = null where id = 'c0000000-0000-0000-0000-0000000000a1'$$);
insert into results select '운영자 여부는 profiles.role 과 무관 (운영자의 profiles 에는 사업장/직급이 없고, 대표의 role 로는 통과 못 함)',
  (select business_id is null from profiles where id = 'c0000000-0000-0000-0000-0000000000a5')
  and not exists (select 1 from platform_admins where user_id = 'c0000000-0000-0000-0000-0000000000a1'), null;

-- ── 2. 운영자 전용 함수: 일반 사용자 차단 ────────────────────────────────
select pg_temp.pa_fail('대표: admin_dashboard 호출 → 차단', 'c0000000-0000-0000-0000-0000000000a1', 'select public.admin_dashboard()', '42501');
select pg_temp.pa_fail('직원: admin_list_businesses 호출 → 차단', 'c0000000-0000-0000-0000-0000000000a4', $$select * from public.admin_list_businesses()$$, '42501');
select pg_temp.pa_fail('관리자: admin_business_detail 호출 → 차단', 'c0000000-0000-0000-0000-0000000000a3', format($$select public.admin_business_detail(%L)$$, (select v from ids where k='A')), '42501');
select pg_temp.pa_fail('무소속 사용자: admin_recent_audit_logs 호출 → 차단', 'c0000000-0000-0000-0000-0000000000a6', $$select * from public.admin_recent_audit_logs()$$, '42501');
select pg_temp.pa_fail('로그인 없이(uid 없음) admin_dashboard 호출 → 차단', null, 'select public.admin_dashboard()', '42501');
update platform_admins set active = false where user_id = 'c0000000-0000-0000-0000-0000000000a5';
select pg_temp.pa_fail('비활성화된 운영자: admin_dashboard → 차단', 'c0000000-0000-0000-0000-0000000000a5', 'select public.admin_dashboard()', '42501');
update platform_admins set active = true where user_id = 'c0000000-0000-0000-0000-0000000000a5';
insert into results select '운영자 등록/해제도 감사 로그(platform_admin.grant / revoke)로 기록됨',
  pg_temp.pa_log('platform_admin.grant', null, 'system', null, 'c0000000-0000-0000-0000-0000000000a5')
  and pg_temp.pa_log('platform_admin.revoke', null, 'system', null, 'c0000000-0000-0000-0000-0000000000a5'), null;

-- ── 3. 운영자는 일반 사업장 권한으로 데이터를 우회할 수 없음 ─────────────────
insert into customers (id, business_id, name, phone, memo) select 'c2000000-0000-0000-0000-000000000001', v::uuid, 'A고객-비밀이름', '010-1111-2222', '비밀메모' from ids where k = 'A';
insert into customers (id, business_id, name) select 'c2000000-0000-0000-0000-000000000002', v::uuid, 'B고객' from ids where k = 'B';
select pg_temp.pa_rows('운영자: 일반 테이블(고객) 직접 조회 → 0행 (사업장 권한 없음)', 'c0000000-0000-0000-0000-0000000000a5', 'select * from customers', 0);
select pg_temp.pa_rows('운영자: 예약/상담/매출 직접 조회 → 0행', 'c0000000-0000-0000-0000-0000000000a5', 'select id from reservations union all select id from consultations union all select id from payments', 0);
select pg_temp.pa_rows('운영자: 사업장(businesses) 직접 조회 → 0행', 'c0000000-0000-0000-0000-0000000000a5', 'select * from businesses', 0);
select pg_temp.pa_fail('운영자: 고객 직접 등록 → 차단', 'c0000000-0000-0000-0000-0000000000a5', format($$insert into customers (business_id, name) values (%L, '운영자침입')$$, (select v from ids where k='A')));
select pg_temp.pa_rows('운영자: 고객 직접 수정 → 0행', 'c0000000-0000-0000-0000-0000000000a5', $$update customers set name = '해킹' where id = 'c2000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.pa_rows('운영자: 고객 직접 삭제 → 0행', 'c0000000-0000-0000-0000-0000000000a5', $$delete from customers where id = 'c2000000-0000-0000-0000-000000000001'$$, 0);
select pg_temp.pa_rows('운영자: 감사 로그 테이블 직접 조회 → 0행 (RLS: 매장 대표만)', 'c0000000-0000-0000-0000-0000000000a5', 'select id from audit_logs', 0);
select pg_temp.pa_rows('운영자: 문의 테이블 직접 조회 → 0행 (운영자 함수로만)', 'c0000000-0000-0000-0000-0000000000a5', 'select * from inquiries', 0);
select pg_temp.pa_fail('운영자: 다른 사업장 직급 변경 함수 → 차단(사업장 소속 아님)', 'c0000000-0000-0000-0000-0000000000a5', $$select public.set_member_role('c1000000-0000-0000-0000-000000000004', 'manager')$$);
select pg_temp.pa_fail('운영자: 직원 초대 생성 함수 → 차단(사업장 소속 아님)', 'c0000000-0000-0000-0000-0000000000a5', $$select public.create_staff_invitation('c1000000-0000-0000-0000-000000000005', 'x@example.com', (md5('pa-c')||md5('pa-cx')))$$);
select pg_temp.pa_fail('운영자: 다른 사업장 구독 조회 → 0행 아님(차단/빈 결과 확인)', 'c0000000-0000-0000-0000-0000000000a5', $$select public.set_business_number((md5('pa-9')||md5('pa-9x')), '***')$$);

-- ── 4. 운영자 대시보드 / 목록 / 상세 ─────────────────────────────────────
select pg_temp.pa_val('dash', 'c0000000-0000-0000-0000-0000000000a5', 'select public.admin_dashboard()::text');
insert into results select '대시보드: 전체 사업장 수 = 실제 businesses 수',
  ((select v from pa_out where k = 'dash')::jsonb ->> 'total')::int = (select count(*) from businesses), null;
insert into results select '대시보드: 상태별 수(체험/만료/유료/취소/정지)가 실제 구독 상태와 일치',
  ((select v from pa_out where k = 'dash')::jsonb ->> 'trial')::int = (select count(*) from subscriptions where status = 'trial' and trial_ends_at > now())
  and ((select v from pa_out where k = 'dash')::jsonb ->> 'expired')::int = (select count(*) from subscriptions where status = 'expired' or (status = 'trial' and trial_ends_at <= now()))
  and ((select v from pa_out where k = 'dash')::jsonb ->> 'active')::int = 0
  and ((select v from pa_out where k = 'dash')::jsonb ->> 'suspended')::int = 0
  and ((select v from pa_out where k = 'dash')::jsonb ->> 'expired_denied')::int = (select count(*) from subscriptions where status = 'expired' and trial_denied_reason is not null), null;
insert into results select '대시보드: 최근 가입/체험 시작 목록 포함, 체험 시작 목록에는 체험 지급된 사업장만',
  jsonb_array_length((select v from pa_out where k = 'dash')::jsonb -> 'recent_signups') = 3
  and jsonb_array_length((select v from pa_out where k = 'dash')::jsonb -> 'recent_trial_starts') = 2, null;
insert into results select '대시보드 응답에 고객 이름/전화번호/메모가 없다',
  position('A고객-비밀이름' in (select v from pa_out where k = 'dash')) = 0 and position('010-1111-2222' in (select v from pa_out where k = 'dash')) = 0 and position('비밀메모' in (select v from pa_out where k = 'dash')) = 0, null;

select pg_temp.pa_val('list_name', 'c0000000-0000-0000-0000-0000000000a5', $$select count(*)::text from public.admin_list_businesses('A사업')$$);
select pg_temp.pa_val('list_rep', 'c0000000-0000-0000-0000-0000000000a5', $$select count(*)::text from public.admin_list_businesses('대표')$$);
select pg_temp.pa_val('list_num', 'c0000000-0000-0000-0000-0000000000a5', $$select count(*)::text from public.admin_list_businesses('111')$$);
select pg_temp.pa_val('list_masked', 'c0000000-0000-0000-0000-0000000000a5', $$select count(*)::text from public.admin_list_businesses('***')$$);
select pg_temp.pa_val('list_wild', 'c0000000-0000-0000-0000-0000000000a5', $$select count(*)::text from public.admin_list_businesses('%')$$);
select pg_temp.pa_val('list_status', 'c0000000-0000-0000-0000-0000000000a5', $$select count(*)::text from public.admin_list_businesses(null, 'trial')$$);
select pg_temp.pa_val('list_denied', 'c0000000-0000-0000-0000-0000000000a5', $$select count(*)::text from public.admin_list_businesses(null, 'expired')$$);
select pg_temp.pa_val('list_future', 'c0000000-0000-0000-0000-0000000000a5', $$select count(*)::text from public.admin_list_businesses(null, null, current_date + 1, null)$$);
select pg_temp.pa_val('list_today', 'c0000000-0000-0000-0000-0000000000a5', $$select count(*)::text from public.admin_list_businesses(null, null, current_date - 3, current_date - 1)$$);
select pg_temp.pa_val('list_limit', 'c0000000-0000-0000-0000-0000000000a5', $$select count(*)::text from public.admin_list_businesses(null, null, null, null, 1)$$);
insert into results select '사업장 검색: 사업장명/대표자명으로 검색됨, 상태·가입일 필터 동작',
  (select v from pa_out where k = 'list_name')::int = 1 and (select v from pa_out where k = 'list_rep')::int = 3
  and (select v from pa_out where k = 'list_status')::int = 2 and (select v from pa_out where k = 'list_denied')::int = 1
  and (select v from pa_out where k = 'list_future')::int = 0 and (select v from pa_out where k = 'list_today')::int = 3
  and (select v from pa_out where k = 'list_limit')::int = 1, null;
insert into results select '사업자번호(숫자/마스킹)로는 검색되지 않는다 + % 와일드카드는 문자 그대로 취급',
  (select v from pa_out where k = 'list_num')::int = 0 and (select v from pa_out where k = 'list_masked')::int = 0 and (select v from pa_out where k = 'list_wild')::int = 0, null;

select pg_temp.pa_val('detail', 'c0000000-0000-0000-0000-0000000000a5', format($$select public.admin_business_detail(%L)::text$$, (select v from ids where k='A')));
insert into results select '사업장 상세: 이름/대표자/상태/체험일/직원·고객·예약·매출 건수/마지막 활동',
  ((select v from pa_out where k = 'detail')::jsonb ->> 'name') = 'A사업장'
  and ((select v from pa_out where k = 'detail')::jsonb ->> 'representative_name') = '대표'
  and ((select v from pa_out where k = 'detail')::jsonb ->> 'status') = 'trial'
  and ((select v from pa_out where k = 'detail')::jsonb ->> 'staff_count')::int = (select count(*) from staff where business_id = (select v::uuid from ids where k='A'))
  and ((select v from pa_out where k = 'detail')::jsonb ->> 'customer_count')::int = 1
  and ((select v from pa_out where k = 'detail')::jsonb ->> 'reservation_count')::int = 0
  and ((select v from pa_out where k = 'detail')::jsonb ->> 'payment_count')::int = 0
  and (select v from pa_out where k = 'detail')::jsonb ? 'trial_started_at' and (select v from pa_out where k = 'detail')::jsonb ? 'trial_ends_at'
  and (select v from pa_out where k = 'detail')::jsonb ? 'last_activity_at' and (select v from pa_out where k = 'detail')::jsonb ? 'created_at', null;
insert into results select '사업장 상세에 고객 이름/전화번호/메모/직원 이름이 없다 (건수만)',
  position('A고객-비밀이름' in (select v from pa_out where k = 'detail')) = 0 and position('010-1111-2222' in (select v from pa_out where k = 'detail')) = 0
  and position('비밀메모' in (select v from pa_out where k = 'detail')) = 0 and position('A직원' in (select v from pa_out where k = 'detail')) = 0
  and position((md5('pa-1')||md5('pa-1x')) in (select v from pa_out where k = 'detail')) = 0, null;
insert into results select '운영자의 사업장 상세 열람은 platform_admin 로그(platform.business_view)로 기록됨',
  pg_temp.pa_log('platform.business_view', (select v::uuid from ids where k='A'), 'platform_admin', 'c0000000-0000-0000-0000-0000000000a5'), null;
select pg_temp.pa_fail('존재하지 않는 사업장 상세 → not_found', 'c0000000-0000-0000-0000-0000000000a5', $$select public.admin_business_detail(gen_random_uuid())$$, 'P0002');

-- ── 5. 자동 감사 기록 (트리거) ────────────────────────────────────────────
-- 사업장 생성 / 무료체험
insert into results select '사업장 생성 → business.create (actor=owner) + trial.start(actor=owner)',
  pg_temp.pa_log('business.create', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1', (select v::uuid from ids where k='A'))
  and pg_temp.pa_log('trial.start', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1'), null;
insert into results select '같은 사업자번호로 생성된 사업장 → trial.denied (result=denied)', pg_temp.pa_log('trial.denied', (select v::uuid from ids where k='B2'), 'owner', null, null, 'denied'), null;
insert into results select '사업장 생성 시 자동으로 만들어지는 기본 데이터(대표 담당자/기본 결제수단/알림설정)는 로그로 남기지 않는다',
  not exists (select 1 from audit_logs where business_id = (select v::uuid from ids where k='A') and action in ('staff.create', 'payment_method.create', 'notification_settings.create') and actor_type = 'owner'), null;

-- 대표: 고객/예약/상담/매출
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', format($$insert into customers (id, business_id, name, phone, memo) values ('c2000000-0000-0000-0000-000000000011', %L, '대표가만든고객', '010-3333-4444', '대표메모')$$, (select v from ids where k='A')));
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', $$update customers set memo = '수정된비밀메모', phone = '010-9999-9999' where id = 'c2000000-0000-0000-0000-000000000011'$$);
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', format($$insert into reservations (id, business_id, customer_id, start_time, end_time) values ('c3000000-0000-0000-0000-000000000001', %L, 'c2000000-0000-0000-0000-000000000011', now(), now() + interval '1 hour')$$, (select v from ids where k='A')));
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', $$update reservations set status = 'confirmed' where id = 'c3000000-0000-0000-0000-000000000001'$$);
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', format($$insert into consultations (id, business_id, customer_id, content) values ('c4000000-0000-0000-0000-000000000001', %L, 'c2000000-0000-0000-0000-000000000011', '상담비밀내용')$$, (select v from ids where k='A')));
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', format($$insert into payments (id, business_id, amount, gross_amount, status) values ('c5000000-0000-0000-0000-000000000001', %L, 50000, 50000, 'paid')$$, (select v from ids where k='A')));
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', $$update payments set amount = 40000 where id = 'c5000000-0000-0000-0000-000000000001'$$);
insert into results select '대표(A): 고객 생성/수정 → customer.create / customer.update (actor=owner, resource_id 기록)',
  pg_temp.pa_log('customer.create', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1', 'c2000000-0000-0000-0000-000000000011')
  and pg_temp.pa_log('customer.update', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1', 'c2000000-0000-0000-0000-000000000011'), null;
insert into results select '대표(A): 예약/상담/매출 생성·수정이 기록됨',
  pg_temp.pa_log('reservation.create', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1', 'c3000000-0000-0000-0000-000000000001')
  and pg_temp.pa_log('reservation.update', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1', 'c3000000-0000-0000-0000-000000000001')
  and pg_temp.pa_log('consultation.create', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1', 'c4000000-0000-0000-0000-000000000001')
  and pg_temp.pa_log('payment.create', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1', 'c5000000-0000-0000-0000-000000000001')
  and pg_temp.pa_log('payment.update', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1', 'c5000000-0000-0000-0000-000000000001'), null;
insert into results select '수정 로그에는 "바뀐 컬럼 이름"만 있고 값(이름/전화번호/메모/금액)은 없다',
  (select metadata -> 'changed_fields' from audit_logs where action = 'customer.update' and resource_id = 'c2000000-0000-0000-0000-000000000011') @> '["memo","phone"]'::jsonb
  and not exists (select 1 from audit_logs where metadata::text like '%비밀%' or metadata::text like '%010-%' or metadata::text like '%대표가만든%' or metadata::text like '%40000%' or metadata::text like '%50000%'), null;

-- 직원: 허용된 작업이 직원 로그로 기록 / 직원의 삭제 시도(차단됨)는 로그 없음
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a4', format($$insert into reservations (id, business_id, customer_id, start_time, end_time) values ('c3000000-0000-0000-0000-000000000002', %L, 'c2000000-0000-0000-0000-000000000011', now(), now())$$, (select v from ids where k='A')));
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a4', $$update customers set memo = '직원이 수정' where id = 'c2000000-0000-0000-0000-000000000011'$$);
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a4', format($$insert into consultations (id, business_id, customer_id) values ('c4000000-0000-0000-0000-000000000002', %L, 'c2000000-0000-0000-0000-000000000011')$$, (select v from ids where k='A')));
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a4', $$delete from customers where id = 'c2000000-0000-0000-0000-000000000011'$$);
insert into results select '직원(A): 예약/상담 생성과 고객 수정이 actor=staff 로 기록됨',
  pg_temp.pa_log('reservation.create', (select v::uuid from ids where k='A'), 'staff', 'c0000000-0000-0000-0000-0000000000a4', 'c3000000-0000-0000-0000-000000000002')
  and pg_temp.pa_log('consultation.create', (select v::uuid from ids where k='A'), 'staff', 'c0000000-0000-0000-0000-0000000000a4', 'c4000000-0000-0000-0000-000000000002')
  and pg_temp.pa_log('customer.update', (select v::uuid from ids where k='A'), 'staff', 'c0000000-0000-0000-0000-0000000000a4', 'c2000000-0000-0000-0000-000000000011'), null;
insert into results select '직원의 고객 삭제 시도(RLS 로 0행)는 삭제되지 않았으므로 customer.delete 로그도 없다',
  exists (select 1 from customers where id = 'c2000000-0000-0000-0000-000000000011')
  and not exists (select 1 from audit_logs where action = 'customer.delete' and actor_type = 'staff'), null;

-- 관리자
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a3', format($$insert into payments (id, business_id, amount, gross_amount, status) values ('c5000000-0000-0000-0000-000000000002', %L, 1, 1, 'paid')$$, (select v from ids where k='A')));
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a3', $$delete from consultations where id = 'c4000000-0000-0000-0000-000000000002'$$);
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a3', $$delete from reservations where id = 'c3000000-0000-0000-0000-000000000002'$$);
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a3', $$delete from payments where id = 'c5000000-0000-0000-0000-000000000002'$$);
insert into customers (id, business_id, name) select 'c2000000-0000-0000-0000-000000000012', v::uuid, '삭제될고객' from ids where k = 'A';
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a3', $$delete from customers where id = 'c2000000-0000-0000-0000-000000000012'$$);
insert into results select '관리자(A): 매출 생성/삭제, 예약·상담·고객 삭제가 actor=admin 으로 기록됨 (resource_id 만 남김)',
  pg_temp.pa_log('payment.create', (select v::uuid from ids where k='A'), 'admin', 'c0000000-0000-0000-0000-0000000000a3', 'c5000000-0000-0000-0000-000000000002')
  and pg_temp.pa_log('payment.delete', (select v::uuid from ids where k='A'), 'admin', 'c0000000-0000-0000-0000-0000000000a3', 'c5000000-0000-0000-0000-000000000002')
  and pg_temp.pa_log('consultation.delete', (select v::uuid from ids where k='A'), 'admin', 'c0000000-0000-0000-0000-0000000000a3', 'c4000000-0000-0000-0000-000000000002')
  and pg_temp.pa_log('reservation.delete', (select v::uuid from ids where k='A'), 'admin', 'c0000000-0000-0000-0000-0000000000a3', 'c3000000-0000-0000-0000-000000000002')
  and pg_temp.pa_log('customer.delete', (select v::uuid from ids where k='A'), 'admin', 'c0000000-0000-0000-0000-0000000000a3', 'c2000000-0000-0000-0000-000000000012'), null;
insert into results select '삭제 로그의 metadata 는 비어 있다 (삭제된 고객 정보 없음)',
  (select metadata from audit_logs where action = 'customer.delete' and resource_id = 'c2000000-0000-0000-0000-000000000012') = '{}'::jsonb
  and not exists (select 1 from audit_logs where metadata::text like '%삭제될고객%'), null;

-- 결제수단 / 담당자 / 설정 / 마케팅
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a3', format($$insert into payment_methods (id, business_id, name) values ('c6000000-0000-0000-0000-000000000001', %L, '간편결제')$$, (select v from ids where k='A')));
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a3', $$update payment_methods set name = '간편결제2' where id = 'c6000000-0000-0000-0000-000000000001'$$);
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a3', $$delete from payment_methods where id = 'c6000000-0000-0000-0000-000000000001'$$);
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a3', $$update staff set title = '실장' where id = 'c1000000-0000-0000-0000-000000000005'$$);
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', format($$update businesses set name = 'A사업장(수정)', address = '부산' where id = %L$$, (select v from ids where k='A')));
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', $$update notification_settings set channel = 'kakao' where business_id = (select business_id from profiles where id = 'c0000000-0000-0000-0000-0000000000a1')$$);
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', format($$insert into marketing_messages (id, business_id, target_description, message, channel) values ('c7000000-0000-0000-0000-000000000001', %L, '전체 고객', '이벤트 안내 메시지', 'sms')$$, (select v from ids where k='A')));
insert into results select '결제수단 추가/수정/삭제 → payment_method.create/update/delete (actor=admin)',
  pg_temp.pa_log('payment_method.create', (select v::uuid from ids where k='A'), 'admin', null, 'c6000000-0000-0000-0000-000000000001')
  and pg_temp.pa_log('payment_method.update', (select v::uuid from ids where k='A'), 'admin', null, 'c6000000-0000-0000-0000-000000000001')
  and pg_temp.pa_log('payment_method.delete', (select v::uuid from ids where k='A'), 'admin', null, 'c6000000-0000-0000-0000-000000000001'), null;
insert into results select '사업장 설정 변경 → business.update (변경된 컬럼 이름만), 알림설정 변경 → notification_settings.update, 담당자 수정 → staff.update',
  pg_temp.pa_log('business.update', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1', (select v::uuid from ids where k='A'))
  and (select metadata -> 'changed_fields' from audit_logs where action = 'business.update' and resource_id = (select v::uuid from ids where k='A') order by seq desc limit 1) @> '["address","name"]'::jsonb
  and pg_temp.pa_log('notification_settings.update', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1')
  and pg_temp.pa_log('staff.update', (select v::uuid from ids where k='A'), 'admin', 'c0000000-0000-0000-0000-0000000000a3', 'c1000000-0000-0000-0000-000000000005'), null;
insert into results select '마케팅 발송(초안 생성) → marketing.draft_create (채널만 기록, 대상/메시지 내용은 기록 안 함)',
  pg_temp.pa_log('marketing.draft_create', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1', 'c7000000-0000-0000-0000-000000000001')
  and (select metadata from audit_logs where action = 'marketing.draft_create') = '{"channel":"sms"}'::jsonb
  and not exists (select 1 from audit_logs where metadata::text like '%이벤트%' or metadata::text like '%전체 고객%'), null;

-- 직원 초대 / 권한 변경 / 연결 해제 / 수락
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', $$select public.create_staff_invitation('c1000000-0000-0000-0000-000000000005', 'inv@pa.local2', (md5('pa-a')||md5('pa-ax')))$$);
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', $$select public.set_member_role('c1000000-0000-0000-0000-000000000004', 'manager')$$);
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', $$select public.set_member_role('c1000000-0000-0000-0000-000000000004', 'staff')$$);
insert into results select '직원 초대 → staff.invite (초대 직급만 기록, 이메일 없음)',
  pg_temp.pa_log('staff.invite', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1')
  and (select metadata from audit_logs where action = 'staff.invite') = '{"invited_role":"staff"}'::jsonb
  and not exists (select 1 from audit_logs where metadata::text like '%pa.local%'), null;
insert into results select '직원 권한 변경 → staff.role_change (role_from/role_to)',
  exists (select 1 from audit_logs where action = 'staff.role_change' and actor_type = 'owner' and metadata = '{"role_from":"staff","role_to":"manager"}'::jsonb and resource_id = 'c0000000-0000-0000-0000-0000000000a4')
  and exists (select 1 from audit_logs where action = 'staff.role_change' and metadata = '{"role_from":"manager","role_to":"staff"}'::jsonb), null;
insert into auth.users (id, email, raw_user_meta_data) values ('c0000000-0000-0000-0000-0000000000b1', 'inv@pa.local2', '{"full_name":"초대직원"}');
create temp table fin as select public.finalize_staff_invitation((md5('pa-a')||md5('pa-ax')), 'c0000000-0000-0000-0000-0000000000b1') as sid;
insert into results select '초대 수락 → staff.invite_accept (actor=수락한 신규 직원)',
  pg_temp.pa_log('staff.invite_accept', (select v::uuid from ids where k='A'), 'staff', 'c0000000-0000-0000-0000-0000000000b1'), null;
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', $$select public.unlink_staff_account('c1000000-0000-0000-0000-000000000005')$$);
insert into results select '직원 연결 해제 → staff.unlink', pg_temp.pa_log('staff.unlink', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000b1'), null;
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', format($$select public.create_staff_invitation('c1000000-0000-0000-0000-000000000005', 'again@pa.local2', (md5('pa-b')||md5('pa-bx')))$$));
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', $$select public.revoke_staff_invitation('c1000000-0000-0000-0000-000000000005')$$);
insert into results select '초대 취소 → staff.invite_revoke', pg_temp.pa_log('staff.invite_revoke', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1'), null;

-- 구독 상태: 체험 종료 / 상태 변경
update subscriptions set trial_ends_at = now() - interval '1 day', trial_started_at = now() - interval '100 days' where business_id = (select v::uuid from ids where k='A');
select pg_temp.pa_do('c0000000-0000-0000-0000-0000000000a1', 'select public.sync_my_subscription()');
insert into results select '체험 종료 → trial.end (actor=system)', pg_temp.pa_log('trial.end', (select v::uuid from ids where k='A'), 'system'), null;
update subscriptions set status = 'active', current_period_end = now() + interval '30 days' where business_id = (select v::uuid from ids where k='A');
insert into results select '구독 상태 변경 → subscription.status_change (status_from/status_to)',
  exists (select 1 from audit_logs where action = 'subscription.status_change' and metadata = '{"status_from":"expired","status_to":"active"}'::jsonb), null;

-- 조회는 기록하지 않는다
select count(*) as n into temp table log_count_before from audit_logs;
select pg_temp.pa_rows('대표: 고객/예약/매출 조회', 'c0000000-0000-0000-0000-0000000000a1', 'select id from customers union all select id from reservations union all select id from payments', 4);
insert into results select '단순 조회는 로그를 남기지 않는다 (로그 폭증 방지)', (select n from log_count_before) = (select count(*) from audit_logs), null;

-- ── 6. 위변조 방지 ────────────────────────────────────────────────────
select pg_temp.pa_fail('대표: 자기 사업장 로그 수정 → 차단', 'c0000000-0000-0000-0000-0000000000a1', $$update audit_logs set result = 'failure'$$);
select pg_temp.pa_fail('대표: 자기 사업장 로그 삭제 → 차단', 'c0000000-0000-0000-0000-0000000000a1', $$delete from audit_logs$$);
select pg_temp.pa_fail('직원: 로그 수정 → 차단', 'c0000000-0000-0000-0000-0000000000a4', $$update audit_logs set action = 'customer.read'$$);
select pg_temp.pa_fail('직원: 로그 삭제 → 차단', 'c0000000-0000-0000-0000-0000000000a4', $$delete from audit_logs where actor_type = 'staff'$$);
select pg_temp.pa_fail('관리자: 로그 수정/삭제 → 차단', 'c0000000-0000-0000-0000-0000000000a3', $$delete from audit_logs where actor_type = 'admin'$$);
select pg_temp.pa_fail('운영자: 로그 수정 → 차단', 'c0000000-0000-0000-0000-0000000000a5', $$update audit_logs set result = 'failure'$$);
select pg_temp.pa_fail('운영자: 로그 삭제 → 차단', 'c0000000-0000-0000-0000-0000000000a5', $$delete from audit_logs$$);
select pg_temp.pa_fail('대표: 로그 직접 INSERT(위조) → 차단', 'c0000000-0000-0000-0000-0000000000a1', format($$insert into audit_logs (business_id, actor_type, action, resource_type, result) values (%L, 'owner', 'customer.delete', 'customer', 'success')$$, (select v from ids where k='A')));
select pg_temp.pa_fail('대표: audit_write 직접 호출(위조) → 차단', 'c0000000-0000-0000-0000-0000000000a1', format($$select public.audit_write(%L, null, 'owner', 'customer.delete', 'customer', null, 'success')$$, (select v from ids where k='A')));
select pg_temp.pa_fail('대표: audit_log_server 직접 호출(위조) → 차단', 'c0000000-0000-0000-0000-0000000000a1', format($$select public.audit_log_server(%L, null, 'owner', 'customer.export', 'customer', null, 'success')$$, (select v from ids where k='A')));
select pg_temp.pa_service_fail('service_role 도 로그 수정 불가', $$update audit_logs set result = 'failure'$$, '42501');
select pg_temp.pa_service_fail('service_role 도 로그 삭제 불가', $$delete from audit_logs$$, '42501');
select pg_temp.pa_service_fail('service_role 도 로그 비우기(TRUNCATE) 불가', $$truncate audit_logs$$, '42501');
do $$ begin
  begin update audit_logs set result = 'failure'; insert into results values ('DB 관리자(슈퍼유저)의 UPDATE 도 트리거가 차단', false, 'no error'); exception when others then insert into results values ('DB 관리자(슈퍼유저)의 UPDATE 도 트리거가 차단', sqlstate = '42501', sqlerrm); end;
  begin delete from audit_logs; insert into results values ('DB 관리자(슈퍼유저)의 DELETE 도 트리거가 차단', false, 'no error'); exception when others then insert into results values ('DB 관리자(슈퍼유저)의 DELETE 도 트리거가 차단', sqlstate = '42501', sqlerrm); end;
end $$;

-- ── 7. 로그 조회 권한 / 사업장 격리 ─────────────────────────────────────
select pg_temp.pa_val('oa_logs', 'c0000000-0000-0000-0000-0000000000a1', 'select count(*)::text from audit_logs');
select pg_temp.pa_val('oa_other', 'c0000000-0000-0000-0000-0000000000a1', format($$select count(*)::text from audit_logs where business_id <> %L$$, (select v from ids where k='A')));
insert into results select '대표(A): 자기 사업장 로그만 조회 (다른 사업장 로그 0건)',
  (select v from pa_out where k = 'oa_logs')::int = (select count(*) from audit_logs where business_id = (select v::uuid from ids where k='A'))
  and (select v from pa_out where k = 'oa_logs')::int > 10 and (select v from pa_out where k = 'oa_other')::int = 0, null;
select pg_temp.pa_val('ob_logs', 'c0000000-0000-0000-0000-0000000000a2', 'select count(*)::text from audit_logs');
select pg_temp.pa_val('ob_a', 'c0000000-0000-0000-0000-0000000000a2', format($$select count(*)::text from audit_logs where business_id = %L$$, (select v from ids where k='A')));
insert into results select 'B 사업장(대표): A 의 로그를 볼 수 없다 (필터로 지정해도 0건), B 로그만 조회',
  (select v from pa_out where k = 'ob_a')::int = 0
  and (select v from pa_out where k = 'ob_logs')::int = (select count(*) from audit_logs where business_id = (select v::uuid from ids where k='B')), null;
select pg_temp.pa_rows('직원(A): 감사 로그 조회 불가(0건)', 'c0000000-0000-0000-0000-0000000000a4', 'select id from audit_logs', 0);
select pg_temp.pa_rows('관리자(A): 감사 로그 조회 불가(0건, 대표 전용)', 'c0000000-0000-0000-0000-0000000000a3', 'select id from audit_logs', 0);
select pg_temp.pa_fail('대표: IP/User-Agent 컬럼은 조회 불가 (운영자 전용)', 'c0000000-0000-0000-0000-0000000000a1', 'select ip_address from audit_logs');
select pg_temp.pa_fail('대표: user_agent 컬럼 조회 불가', 'c0000000-0000-0000-0000-0000000000a1', 'select user_agent from audit_logs');
select pg_temp.pa_rows('무소속 사용자: 감사 로그 조회 0건', 'c0000000-0000-0000-0000-0000000000a6', 'select id from audit_logs', 0);

-- 운영자 로그 조회 함수 (ip/ua 컬럼 없음, 개인정보 없음)
select pg_temp.pa_val('adm_logs', 'c0000000-0000-0000-0000-0000000000a5', $$select count(*)::text from public.admin_recent_audit_logs(null, null, 500)$$);
select pg_temp.pa_val('adm_logs_a', 'c0000000-0000-0000-0000-0000000000a5', format($$select count(*)::text from public.admin_recent_audit_logs(%L, 'customer.create', 50)$$, (select v from ids where k='A')));
insert into results select '운영자: 운영자 함수로 로그 조회 (사업장/액션 필터), 로그에 개인정보 없음',
  (select v from pa_out where k = 'adm_logs')::int > 20 and (select v from pa_out where k = 'adm_logs_a')::int >= 1
  and not exists (select 1 from audit_logs where metadata::text ~ '[가-힣]' or metadata::text ~ '[0-9]{3,}-[0-9]{3,}' or metadata::text like '%@%'), null;

-- ── 8. metadata 개인정보 차단 ──────────────────────────────────────────
do $$
declare
  t record;
  ok boolean;
begin
  for t in select * from (values
    ('name 키 거부', '{"name":"홍길동"}'::jsonb, false),
    ('phone 키 거부', '{"phone":"01011112222"}'::jsonb, false),
    ('memo 키 거부', '{"memo":"비밀"}'::jsonb, false),
    ('허용 키라도 한글 값 거부', '{"reason":"홍길동"}'::jsonb, false),
    ('허용 키라도 전화번호 형태 거부', '{"reason":"010-1234-5678"}'::jsonb, false),
    ('허용 키라도 이메일 형태 거부', '{"reason":"a@b.com"}'::jsonb, false),
    ('공백 포함 문장 거부', '{"reason":"hong gil dong"}'::jsonb, false),
    ('중첩 객체 거부', '{"reason":{"a":"b"}}'::jsonb, false),
    ('배열 안의 한글 거부', '{"changed_fields":["memo","이름"]}'::jsonb, false),
    ('배열 항목 30개 초과 거부', ('{"changed_fields":' || (select jsonb_agg('f' || x)::text from generate_series(1, 31) x) || '}')::jsonb, false),
    ('전체 길이 1000자 초과 거부', ('{"reason":"' || repeat('a', 900) || '"}')::jsonb, false),
    ('빈 metadata 허용', '{}'::jsonb, true),
    ('changed_fields 컬럼 이름 배열 허용', '{"changed_fields":["memo","phone"]}'::jsonb, true),
    ('숫자/불리언 허용', '{"row_count":120,"count":3}'::jsonb, true),
    ('코드형 문자열 허용', '{"reason":"invalid_credentials","format":"csv"}'::jsonb, true)
  ) as x(name, meta, expected) loop
    begin
      perform public.audit_write(null, null, 'system', 'auth.login', 'auth', null, 'failure', t.meta);
      ok := true;
    exception when others then
      ok := false;
    end;
    insert into results values ('metadata 검사: ' || t.name, ok = t.expected, case when ok then 'accepted' else 'rejected' end);
  end loop;
end $$;

-- IP / User-Agent: 기본은 저장하지 않음, 설정을 켜면 저장 (UA 는 200자로 제한)
select public.audit_write(null, null, 'system', 'auth.login', 'auth', null, 'failure', '{}'::jsonb, '203.0.113.7'::inet, 'TestAgent/1.0');
insert into results select 'IP/User-Agent: 기본 설정에서는 저장하지 않는다 (구조만 준비)',
  (select ip_address is null and user_agent is null from audit_logs order by seq desc limit 1), null;
update platform_settings set value = 'true'::jsonb where key in ('audit_log_store_ip', 'audit_log_store_user_agent');
select public.audit_write(null, null, 'system', 'auth.login', 'auth', null, 'failure', '{}'::jsonb, '203.0.113.7'::inet, repeat('u', 500));
insert into results select 'IP/User-Agent: 설정을 켜면 저장되고 UA 는 200자로 잘린다',
  (select host(ip_address) = '203.0.113.7' and length(user_agent) = 200 from audit_logs order by seq desc limit 1), null;
update platform_settings set value = 'false'::jsonb where key in ('audit_log_store_ip', 'audit_log_store_user_agent');
insert into results select '보관기간은 미확정: 설정값 null, 로그의 retain_until 도 비어 있다 (임의 기간 미지정)',
  (select value = 'null'::jsonb from platform_settings where key = 'audit_log_retention_months')
  and not exists (select 1 from audit_logs where retain_until is not null), null;

-- ── 9. 서버 전용 기록 (로그인/가입/내보내기/가져오기) ─────────────────────
select pg_temp.pa_service(format($$select public.audit_log_server(%L, 'c0000000-0000-0000-0000-0000000000a1', 'owner', 'customer.export', 'customer', null, 'success', '{"format":"csv","row_count":120}'::jsonb, '198.51.100.1', 'ua')$$, (select v from ids where k='A')));
select pg_temp.pa_service($$select public.audit_log_server(null, null, 'system', 'auth.login', 'auth', null, 'failure', '{"reason":"invalid_credentials"}'::jsonb, 'not-an-ip', null)$$);
select pg_temp.pa_service(format($$select public.audit_log_server(%L, 'c0000000-0000-0000-0000-0000000000a1', 'owner', 'customer.import', 'customer', null, 'success', '{"format":"xlsx","row_count":50}'::jsonb)$$, (select v from ids where k='A')));
insert into results select '서버 전용 기록: customer.export(개수/형식만) / auth.login 실패 / customer.import 가 기록됨, 잘못된 IP 는 null',
  pg_temp.pa_log('customer.export', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1')
  and (select metadata from audit_logs where action = 'customer.export') = '{"format":"csv","row_count":120}'::jsonb
  and pg_temp.pa_log('customer.import', (select v::uuid from ids where k='A'), 'owner', 'c0000000-0000-0000-0000-0000000000a1')
  and exists (select 1 from audit_logs where action = 'auth.login' and result = 'failure' and actor_user_id is null and actor_type = 'system' and ip_address is null), null;
select pg_temp.pa_service_fail('서버 기록: 허용되지 않은 action 은 거부', $$select public.audit_log_server(null, null, 'system', 'customer.delete', 'customer', null, 'success')$$, '22023');
select pg_temp.pa_service_fail('서버 기록: 잘못된 actor_type 은 거부', $$select public.audit_log_server(null, null, 'superhero', 'auth.login', 'auth', null, 'success')$$, '22023');
select pg_temp.pa_service_fail('서버 기록: 개인정보가 든 metadata 는 거부', $$select public.audit_log_server(null, null, 'system', 'customer.export', 'customer', null, 'success', '{"name":"홍길동"}'::jsonb)$$, '22023');

-- ── 10. 탈퇴(사업장 삭제): 로그는 남고 연쇄 삭제 노이즈는 없다 ─────────────
insert into customers (id, business_id, name) select 'c2000000-0000-0000-0000-000000000021', v::uuid, 'B고객1' from ids where k = 'B';
insert into customers (id, business_id, name) select 'c2000000-0000-0000-0000-000000000022', v::uuid, 'B고객2' from ids where k = 'B';
delete from auth.users where id = 'c0000000-0000-0000-0000-0000000000a2';
insert into results select 'B 탈퇴: business.delete 1건이 남고, 연쇄 삭제된 고객/직원 등은 개별 삭제 로그를 남기지 않는다',
  (select count(*) from audit_logs where action = 'business.delete' and business_id = (select v::uuid from ids where k='B')) = 1
  and not exists (select 1 from audit_logs where business_id = (select v::uuid from ids where k='B') and action like '%.delete' and action <> 'business.delete')
  and exists (select 1 from audit_logs where business_id = (select v::uuid from ids where k='B') and action = 'business.create'), null;

-- ── 11. 문의 (구조): 체험 종료 후에도 가능, 자기 것만 조회 ───────────────
update subscriptions set status = 'expired', current_period_end = null where business_id = (select v::uuid from ids where k='A');
select pg_temp.pa_rows('체험 종료 사업장도 문의 등록 가능 (구독 차단 대상 아님)', 'c0000000-0000-0000-0000-0000000000a1', format($$insert into inquiries (business_id, user_id, title, body) values (%L, 'c0000000-0000-0000-0000-0000000000a1', '결제 문의', '유료 전환은 어떻게 하나요?')$$, (select v from ids where k='A')), 1);
select pg_temp.pa_fail('다른 사업장 이름으로 문의 등록 → 차단', 'c0000000-0000-0000-0000-0000000000a4', format($$insert into inquiries (business_id, user_id, title, body) values (%L, 'c0000000-0000-0000-0000-0000000000a1', 'x', 'x')$$, (select v from ids where k='A')));
select pg_temp.pa_rows('직원은 대표의 문의를 볼 수 없다 (본인 문의만)', 'c0000000-0000-0000-0000-0000000000a4', 'select * from inquiries', 0);
select pg_temp.pa_rows('대표는 자기 문의 조회 가능', 'c0000000-0000-0000-0000-0000000000a1', 'select * from inquiries', 1);
select pg_temp.pa_fail('사용자는 문의 답변/상태를 직접 수정할 수 없다', 'c0000000-0000-0000-0000-0000000000a1', $$update inquiries set status = 'answered', answer = '자체답변'$$);
select pg_temp.pa_val('dash2', 'c0000000-0000-0000-0000-0000000000a5', 'select public.admin_dashboard()::text');
insert into results select '운영자 대시보드의 최근 문의에 표시 (제목/상태만, 본문 없음)',
  jsonb_array_length((select v from pa_out where k = 'dash2')::jsonb -> 'recent_inquiries') = 1
  and position('유료 전환은 어떻게' in (select v from pa_out where k = 'dash2')) = 0, null;

select case when ok then 'PASS' else 'FAIL' end as result, name, detail from results order by ok, name;
