-- 권한 상승 차단 테스트 (005 + 006 적용 상태에서 실행)
-- 각 케이스는 results 테이블에 PASS/FAIL 로 기록되고, 마지막에 FAIL 이 하나라도 있으면 예외로 끝난다.

drop table if exists pg_temp.results;
create temp table results (name text, ok boolean, detail text);
grant all on results to public;

-- 특정 사용자(uid)로 stmt 를 실행. 예외가 나야 PASS (expected_state 를 주면 SQLSTATE 도 검사)
create or replace function pg_temp.expect_fail(p_name text, p_uid uuid, p_stmt text, p_state text default null)
returns void language plpgsql as $$
declare v_ok boolean := false; v_detail text := 'no error raised';
begin
  begin
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    set local role authenticated;
    execute p_stmt;
  exception when others then
    if p_state is null or sqlstate = p_state then
      v_ok := true; v_detail := sqlstate || ' ' || sqlerrm;
    else
      v_detail := 'wrong sqlstate ' || sqlstate || ' ' || sqlerrm;
    end if;
  end;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  insert into results values (p_name, v_ok, v_detail);
end $$;

-- stmt 가 성공하고 영향받은 행 수가 p_rows 여야 PASS
create or replace function pg_temp.expect_rows(p_name text, p_uid uuid, p_stmt text, p_rows int)
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

-- 사용자로 함수/쿼리를 실행하고 첫 컬럼 값을 반환 (셋업용)
create or replace function pg_temp.as_user_scalar(p_uid uuid, p_stmt text) returns text
language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
  execute p_stmt into v;
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

-- ── 셋업: 사업장 A(u1 대표), 사업장 B(u2 대표), u3 = A 소속 직원 계정 ──
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'a-owner@test.local', '{"full_name":"A대표"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'b-owner@test.local', '{"full_name":"B대표"}'),
  ('00000000-0000-0000-0000-0000000000a3', 'a-staff@test.local', '{"full_name":"A직원"}');

drop table if exists pg_temp.ids;
create temp table ids (k text primary key, v text);
grant all on ids to public;

insert into ids values ('bizA', pg_temp.as_user_scalar('00000000-0000-0000-0000-0000000000a1', 'select public.create_my_business(''A매장'', ''02-111'', ''서울'', null, repeat(''a'', 64))'));
insert into ids values ('bizB', pg_temp.as_user_scalar('00000000-0000-0000-0000-0000000000b1', 'select public.create_my_business(''B매장'', null, null, null, repeat(''b'', 64))'));

-- u3 을 A 사업장의 직원(staff) 계정으로 연결 (운영에서는 초대 기능이 담당. 여기서는 슈퍼유저로 셋업)
update profiles set business_id = (select v::uuid from ids where k='bizA'), role = 'staff'
  where id = '00000000-0000-0000-0000-0000000000a3';
insert into staff (business_id, profile_id, name, role)
  values ((select v::uuid from ids where k='bizA'), '00000000-0000-0000-0000-0000000000a3', 'A직원', 'staff');

insert into results
select 'setup: A 대표 profile.role=owner, business 연결', role = 'owner' and business_id = (select v::uuid from ids where k='bizA'), role::text
from profiles where id = '00000000-0000-0000-0000-0000000000a1';

-- ── 1. profiles 권한 상승 시도 ─────────────────────────────────────────
select pg_temp.expect_fail('profiles: 내 role 을 owner 로 직접 변경',
  '00000000-0000-0000-0000-0000000000a3',
  $$update profiles set role = 'owner' where id = '00000000-0000-0000-0000-0000000000a3'$$, '42501');

select pg_temp.expect_fail('profiles: 내 business_id 를 다른 매장(B)으로 변경',
  '00000000-0000-0000-0000-0000000000a3',
  format($$update profiles set business_id = %L where id = %L$$, (select v from ids where k='bizB'), '00000000-0000-0000-0000-0000000000a3'), '42501');

select pg_temp.expect_fail('profiles: owner(A대표)가 business_id 를 B로 변경',
  '00000000-0000-0000-0000-0000000000a1',
  format($$update profiles set business_id = %L where id = %L$$, (select v from ids where k='bizB'), '00000000-0000-0000-0000-0000000000a1'), '42501');

select pg_temp.expect_rows('profiles: 이름/전화번호는 본인 것만 수정 가능',
  '00000000-0000-0000-0000-0000000000a3',
  $$update profiles set full_name = '새이름', phone = '010' where id = '00000000-0000-0000-0000-0000000000a3'$$, 1);

select pg_temp.expect_rows('profiles: 남(A대표)의 프로필 이름 수정은 0행',
  '00000000-0000-0000-0000-0000000000a3',
  $$update profiles set full_name = '해킹' where id = '00000000-0000-0000-0000-0000000000a1'$$, 0);

select pg_temp.expect_fail('profiles: 직접 INSERT 불가',
  '00000000-0000-0000-0000-0000000000a3',
  format($$insert into profiles (id, business_id, role) values (gen_random_uuid(), %L, 'owner')$$, (select v from ids where k='bizB')));

select pg_temp.expect_fail('profiles: 직접 DELETE 불가',
  '00000000-0000-0000-0000-0000000000a3',
  $$delete from profiles where id = '00000000-0000-0000-0000-0000000000a3'$$);

-- ── 2. businesses ─────────────────────────────────────────────────────
select pg_temp.expect_fail('businesses: 직접 INSERT 불가(create_my_business 만 허용)',
  '00000000-0000-0000-0000-0000000000a1',
  $$insert into businesses (owner_id, name) values ('00000000-0000-0000-0000-0000000000a1', '몰래만든매장')$$);

select pg_temp.expect_fail('businesses: owner_id 변경 불가',
  '00000000-0000-0000-0000-0000000000a1',
  format($$update businesses set owner_id = %L where id = %L$$, '00000000-0000-0000-0000-0000000000b1', (select v from ids where k='bizA')), '42501');

select pg_temp.expect_fail('businesses: 직접 DELETE 불가',
  '00000000-0000-0000-0000-0000000000a1',
  format($$delete from businesses where id = %L$$, (select v from ids where k='bizA')));

select pg_temp.expect_rows('businesses: 대표는 자기 매장 이름 수정 가능',
  '00000000-0000-0000-0000-0000000000a1',
  format($$update businesses set name = 'A매장(수정)' where id = %L$$, (select v from ids where k='bizA')), 1);

select pg_temp.expect_rows('businesses: 직원(A직원)은 매장 정보 수정 0행',
  '00000000-0000-0000-0000-0000000000a3',
  format($$update businesses set name = '해킹' where id = %L$$, (select v from ids where k='bizA')), 0);

select pg_temp.expect_rows('businesses: A대표가 B매장 수정 시도는 0행',
  '00000000-0000-0000-0000-0000000000a1',
  format($$update businesses set name = '해킹' where id = %L$$, (select v from ids where k='bizB')), 0);

-- ── 3. create_my_business ─────────────────────────────────────────────
select pg_temp.expect_fail('create_my_business: 이미 매장이 있으면 재생성 불가',
  '00000000-0000-0000-0000-0000000000a1',
  $$select public.create_my_business('두번째')$$, '23505');

select pg_temp.expect_fail('create_my_business: 로그인 없이 호출 불가',
  '00000000-0000-0000-0000-000000000000',
  $$select public.create_my_business('무명')$$);

-- ── 4. staff ──────────────────────────────────────────────────────────
select pg_temp.expect_fail('staff: role=owner 로 INSERT 불가',
  '00000000-0000-0000-0000-0000000000a3',
  format($$insert into staff (business_id, name, role) values (%L, '가짜대표', 'owner')$$, (select v from ids where k='bizA')), '42501');

select pg_temp.expect_fail('staff: profile_id 를 지정해 INSERT 불가',
  '00000000-0000-0000-0000-0000000000a1',
  format($$insert into staff (business_id, profile_id, name) values (%L, %L, '연결시도')$$, (select v from ids where k='bizA'), '00000000-0000-0000-0000-0000000000b1'), '42501');

select pg_temp.expect_fail('staff: 연결된 직원의 role 을 직접 UPDATE 불가',
  '00000000-0000-0000-0000-0000000000a1',
  format($$update staff set role = 'manager' where profile_id = %L$$, '00000000-0000-0000-0000-0000000000a3'), '42501');

select pg_temp.expect_fail('staff: profile_id 변경 불가',
  '00000000-0000-0000-0000-0000000000a1',
  format($$update staff set profile_id = %L where profile_id = %L$$, '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a3'), '42501');

select pg_temp.expect_rows('staff: 연결 없는 담당자(라벨)는 role 없이 이름 수정 가능',
  '00000000-0000-0000-0000-0000000000a1',
  format($$update staff set name = 'A직원(수정)', color = '#000000' where profile_id = %L$$, '00000000-0000-0000-0000-0000000000a3'), 1);

-- ── 5. set_member_role ────────────────────────────────────────────────
select pg_temp.expect_fail('set_member_role: 직원(staff)은 호출 불가',
  '00000000-0000-0000-0000-0000000000a3',
  format($$select public.set_member_role((select id from staff where profile_id = %L), 'manager')$$, '00000000-0000-0000-0000-0000000000a3'), '42501');

select pg_temp.expect_fail('set_member_role: owner 등급 부여 불가',
  '00000000-0000-0000-0000-0000000000a1',
  format($$select public.set_member_role((select id from staff where profile_id = %L), 'owner')$$, '00000000-0000-0000-0000-0000000000a3'), '42501');

select pg_temp.expect_fail('set_member_role: 다른 사업장(B) 직원 대상은 not_found',
  '00000000-0000-0000-0000-0000000000b1',
  format($$select public.set_member_role((select id from staff where profile_id = %L), 'manager')$$, '00000000-0000-0000-0000-0000000000a3'), 'P0002');

select pg_temp.expect_fail('set_member_role: 대표 본인 등급 변경 불가',
  '00000000-0000-0000-0000-0000000000a1',
  format($$select public.set_member_role((select id from staff where profile_id = %L), 'staff')$$, '00000000-0000-0000-0000-0000000000a1'), '42501');

select pg_temp.expect_rows('set_member_role: 대표는 자기 사업장 직원 등급 변경 가능',
  '00000000-0000-0000-0000-0000000000a1',
  format($$select public.set_member_role((select id from staff where profile_id = %L), 'manager')$$, '00000000-0000-0000-0000-0000000000a3'), 1);

insert into results
select 'set_member_role 결과: staff.role 과 profiles.role 이 함께 manager',
  (select role from staff where profile_id = '00000000-0000-0000-0000-0000000000a3') = 'manager'
  and (select role from profiles where id = '00000000-0000-0000-0000-0000000000a3') = 'manager', null;

-- ── 결과 ──────────────────────────────────────────────────────────────
select case when ok then 'PASS' else 'FAIL' end as result, name, detail from results order by ok, name;

do $$ begin
  if exists (select 1 from results where not ok) then
    raise exception 'PRIVILEGE ESCALATION TESTS FAILED: % of % cases', (select count(*) from results where not ok), (select count(*) from results);
  end if;
end $$;
