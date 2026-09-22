-- 고객 Import(011) 테스트: import_customers() 함수 단위 검증

drop table if exists pg_temp.ci_out;
drop table if exists pg_temp.results;
create temp table results (name text, ok boolean, detail text);
grant all on results to public;

create or replace function pg_temp.ci_fail(p_name text, p_uid uuid, p_rows jsonb, p_errlike text default null)
returns void language plpgsql as $$
declare v_ok boolean := false; v_detail text := 'no error raised';
begin
  begin
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    set local role authenticated;
    perform public.import_customers(p_rows);
  exception when others then
    if p_errlike is null or sqlerrm like p_errlike then v_ok := true; v_detail := sqlstate || ' ' || sqlerrm;
    else v_detail := 'unexpected: ' || sqlstate || ' ' || sqlerrm; end if;
  end;
  reset role; perform set_config('request.jwt.claim.sub', '', true);
  insert into results values (p_name, v_ok, v_detail);
end $$;

create temp table ci_out (k text primary key, v text);
grant all on ci_out to public;
create or replace function pg_temp.ci_val(p_key text, p_uid uuid, p_rows jsonb) returns void language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
  v := public.import_customers(p_rows);
  reset role; perform set_config('request.jwt.claim.sub', '', true);
  insert into ci_out values (p_key, v::text) on conflict (k) do update set v = excluded.v;
end $$;

-- ── 셋업: 사업장 X(대표 O, 관리자 M, 직원 S), 사업장 Y(대표 OY) ─────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000000-0000-0000-0000-000000000001', 'o@ci.local', '{"full_name":"대표"}'),
  ('d0000000-0000-0000-0000-000000000002', 'm@ci.local', '{"full_name":"관리자"}'),
  ('d0000000-0000-0000-0000-000000000003', 's@ci.local', '{"full_name":"직원"}'),
  ('d0000000-0000-0000-0000-000000000004', 'oy@ci.local', '{"full_name":"Y대표"}'),
  ('d0000000-0000-0000-0000-000000000005', 'u@ci.local', '{"full_name":"무소속"}');

drop table if exists pg_temp.ids;
create temp table ids (k text primary key, v text);
grant all on ids to public;
create or replace function pg_temp.ci_create(p_uid uuid, p_name text, p_hash text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
  v := public.create_my_business(p_name, null, null, '대표', p_hash, '***', null);
  reset role; perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

insert into ids values ('X', pg_temp.ci_create('d0000000-0000-0000-0000-000000000001', 'X사업장', md5('ci-x')||md5('ci-x2'))::text);
insert into ids values ('Y', pg_temp.ci_create('d0000000-0000-0000-0000-000000000004', 'Y사업장', md5('ci-y')||md5('ci-y2'))::text);
update profiles set business_id = (select v::uuid from ids where k='X'), role = 'manager' where id = 'd0000000-0000-0000-0000-000000000002';
update profiles set business_id = (select v::uuid from ids where k='X'), role = 'staff'   where id = 'd0000000-0000-0000-0000-000000000003';
insert into staff (business_id, profile_id, name, role) select v::uuid, 'd0000000-0000-0000-0000-000000000002', '관리자', 'manager' from ids where k='X';
insert into staff (business_id, profile_id, name, role) select v::uuid, 'd0000000-0000-0000-0000-000000000003', '직원', 'staff' from ids where k='X';
insert into customer_grades (id, business_id, name) select 'd1000000-0000-0000-0000-000000000001', v::uuid, 'VIP' from ids where k='X';
insert into customer_tags (id, business_id, name) select 'd2000000-0000-0000-0000-000000000001', v::uuid, '단골' from ids where k='X';
insert into customer_tags (id, business_id, name) select 'd2000000-0000-0000-0000-000000000002', v::uuid, '신규' from ids where k='X';

-- ── 권한 ──────────────────────────────────────────────────────────────
select pg_temp.ci_fail('직원: import_customers 호출 → 차단(권한)', 'd0000000-0000-0000-0000-000000000003',
  '[{"name":"직원시도"}]'::jsonb, 'forbidden');
select pg_temp.ci_fail('무소속: import_customers 호출 → 차단', 'd0000000-0000-0000-0000-000000000005',
  '[{"name":"무소속시도"}]'::jsonb, 'forbidden');
select pg_temp.ci_fail('Y 사업장이 X 소속 태그 이름을 써도 Y 기준으로만 검사(태그 없음) → 차단',
  'd0000000-0000-0000-0000-000000000004', '[{"name":"Y고객","tag_names":["단골"]}]'::jsonb, '%unknown_tag%');

-- ── 기본 검증 ─────────────────────────────────────────────────────────
select pg_temp.ci_fail('이름 없는 행 → 차단', 'd0000000-0000-0000-0000-000000000001', '[{"name":""}]'::jsonb, '%name_required%');
select pg_temp.ci_fail('전화번호 형식 오류(5자리) → 차단', 'd0000000-0000-0000-0000-000000000001', '[{"name":"a","phone":"12345"}]'::jsonb, '%phone_format%');
select pg_temp.ci_fail('존재하지 않는 등급 → 차단(자동 생성 안 함)', 'd0000000-0000-0000-0000-000000000001', '[{"name":"a","grade_name":"없는등급"}]'::jsonb, '%unknown_grade%');
select pg_temp.ci_fail('존재하지 않는 태그 → 차단(자동 생성 안 함)', 'd0000000-0000-0000-0000-000000000001', '[{"name":"a","tag_names":["없는태그"]}]'::jsonb, '%unknown_tag%');
select pg_temp.ci_fail('빈 배열 → 차단', 'd0000000-0000-0000-0000-000000000001', '[]'::jsonb, '%no_rows%');
select pg_temp.ci_fail('2000행 초과 → 차단', 'd0000000-0000-0000-0000-000000000001',
  (select jsonb_agg(jsonb_build_object('name', 'n' || g)) from generate_series(1, 2001) g), '%too_many_rows%');
select pg_temp.ci_fail('같은 파일 안에서 전화번호 중복 → 차단', 'd0000000-0000-0000-0000-000000000001',
  '[{"name":"a","phone":"010-1111-2222"},{"name":"b","phone":"01011112222"}]'::jsonb, '%duplicate_phone_in_file%');

-- ── 정상 삽입 (대표) + 등급/태그 ─────────────────────────────────────────
select pg_temp.ci_val('r1', 'd0000000-0000-0000-0000-000000000001',
  '[{"name":"김신규","phone":"010-3333-4444","memo":"첫방문","grade_name":"VIP","tag_names":["단골","신규"]}]'::jsonb);
insert into results select '신규 고객 1건 삽입(inserted=1,updated=0)', (select v from ci_out where k='r1')::jsonb = '{"inserted":1,"updated":0}'::jsonb, (select v from ci_out where k='r1');
insert into results select '삽입된 고객의 등급/태그/메모가 정확히 반영',
  (select c.grade_id = 'd1000000-0000-0000-0000-000000000001' and c.memo = '첫방문' and c.name = '김신규'
   from customers c where c.phone = '010-3333-4444' and c.business_id = (select v::uuid from ids where k='X'))
  and (select count(*) from customers c join customer_tag_links l on l.customer_id = c.id
       where c.phone = '010-3333-4444' and l.tag_id in ('d2000000-0000-0000-0000-000000000001','d2000000-0000-0000-0000-000000000002')) = 2, null;

-- ── 관리자도 삽입 가능(007 기준 대표/관리자 동일) ─────────────────────────
select pg_temp.ci_val('r2', 'd0000000-0000-0000-0000-000000000002', '[{"name":"관리자등록","phone":"010-5555-6666"}]'::jsonb);
insert into results select '관리자도 Import 가능', (select v from ci_out where k='r2')::jsonb = '{"inserted":1,"updated":0}'::jsonb, null;

-- ── 전화번호 정규화 + 표기 다른 같은 번호 = 같은 고객(업데이트) ───────────
select pg_temp.ci_val('r3', 'd0000000-0000-0000-0000-000000000001', '[{"name":"김신규","phone":"01033334444","memo":"두번째메모"}]'::jsonb);
insert into results select '표기만 다른 같은 전화번호는 기존 고객으로 인식(신규 생성 아님, updated=1)', (select v from ci_out where k='r3')::jsonb = '{"inserted":0,"updated":1}'::jsonb, (select v from ci_out where k='r3');
insert into results select '표기가 다른 전화번호로 갱신해도 phone 컬럼은 최신 CSV 표기로 갱신',
  (select phone = '01033334444' from customers where memo = '두번째메모' and business_id = (select v::uuid from ids where k='X')), null;

-- ── 빈 값 = 기존 값 유지 (이름/메모/등급 삭제되지 않음), 태그는 추가만 ────
select pg_temp.ci_val('r4', 'd0000000-0000-0000-0000-000000000001', '[{"name":"김신규","phone":"010-3333-4444"}]'::jsonb);
insert into results select '전화번호만 있고 나머지가 빈 CSV 행으로 갱신해도 기존 메모/등급/태그가 그대로 유지됨(빈 값=삭제 아님)',
  (select memo = '두번째메모' and grade_id = 'd1000000-0000-0000-0000-000000000001' from customers where phone = '010-3333-4444' and business_id = (select v::uuid from ids where k='X'))
  and (select count(*) from customers c join customer_tag_links l on l.customer_id = c.id where c.phone = '010-3333-4444') = 2, null;
select pg_temp.ci_val('r5', 'd0000000-0000-0000-0000-000000000001', '[{"name":"김신규","phone":"010-3333-4444","tag_names":["신규"]}]'::jsonb);
insert into results select 'CSV 에 태그 1개만 다시 지정해도 기존 태그가 삭제되지 않고 유지(추가만, on conflict do nothing)',
  (select count(*) from customers c join customer_tag_links l on l.customer_id = c.id where c.phone = '010-3333-4444') = 2, null;

-- ── 전화번호 없는 고객: 이름이 같아도 항상 신규 등록 ──────────────────────
select pg_temp.ci_val('r6', 'd0000000-0000-0000-0000-000000000001', '[{"name":"전화번호없음"},{"name":"전화번호없음"}]'::jsonb);
insert into results select '전화번호 없는 고객은 이름이 같아도 매번 신규 등록(자동 병합 안 함)', (select v from ci_out where k='r6')::jsonb = '{"inserted":2,"updated":0}'::jsonb, (select v from ci_out where k='r6');
insert into results select '실제로 서로 다른 두 행이 생성됨', (select count(*) from customers where name = '전화번호없음' and business_id = (select v::uuid from ids where k='X')) = 2, null;

-- ── 원자성: 100건 중 1건만 오류여도 전부 롤백 ─────────────────────────────
insert into results select 'Import 전 X 사업장 고객 수 스냅샷', true, (select count(*)::text from customers where business_id = (select v::uuid from ids where k='X'));
select pg_temp.ci_fail('99건 정상 + 1건 오류(존재하지 않는 등급) → 전체 롤백',
  'd0000000-0000-0000-0000-000000000001',
  (select jsonb_agg(jsonb_build_object('name', '원자성고객' || g, 'phone', '010-9' || lpad(g::text, 6, '0')))
     || jsonb_build_array(jsonb_build_object('name', '오류행', 'grade_name', '존재안함'))
   from generate_series(1, 99) g), '%unknown_grade%');
insert into results select '원자성: 오류로 실패한 Import 는 단 1건도 반영되지 않음',
  not exists (select 1 from customers where name like '원자성고객%'), null;

-- ── 다른 사업장 데이터로 오염 불가 (business_id 를 클라이언트가 지정할 방법이 없음) ──
select pg_temp.ci_val('r7', 'd0000000-0000-0000-0000-000000000004', '[{"name":"Y고객","phone":"010-7777-8888"}]'::jsonb);
insert into results select 'Y 대표가 Import 한 고객은 Y 사업장에만 생성되고 X 에는 영향 없음',
  (select business_id from customers where phone = '010-7777-8888') = (select v::uuid from ids where k='Y')
  and not exists (select 1 from customers where phone = '010-7777-8888' and business_id = (select v::uuid from ids where k='X')), null;
-- p_rows 에 business_id/customer_id 유사 필드를 억지로 끼워 넣어도 함수가 그런 인자를 아예 받지 않으므로 무시된다
select pg_temp.ci_val('r8', 'd0000000-0000-0000-0000-000000000004',
  jsonb_build_array(jsonb_build_object('name', '위조시도', 'phone', '010-7777-9999',
    'business_id', (select v from ids where k='X'), 'customer_id', 'd1000000-0000-0000-0000-000000000001')));
insert into results select '알 수 없는 필드(business_id 등)를 끼워 넣어도 무시되고 호출자의 사업장(Y)에만 생성됨',
  (select business_id from customers where phone = '010-7777-9999') = (select v::uuid from ids where k='Y'), null;

-- ── 체험 종료 후 Import 차단 (009 유지) ────────────────────────────────
update subscriptions set status = 'expired', trial_started_at = now() - interval '100 days', trial_ends_at = now() - interval '1 day', current_period_end = null
  where business_id = (select v::uuid from ids where k='X');
select pg_temp.ci_fail('체험 종료 후: 대표도 Import 차단(subscription_inactive)', 'd0000000-0000-0000-0000-000000000001',
  '[{"name":"만료후고객"}]'::jsonb, '%subscription_inactive%');
insert into results select '체험 종료 후 시도한 고객은 생성되지 않음', not exists (select 1 from customers where name = '만료후고객'), null;

-- ── 동시성: advisory lock 으로 같은 세션 내 두 번 호출해도(직렬) 중복 생성 없음 ──
-- (진짜 동시 접속 경쟁은 SQL 테스트로 재현할 수 없어 실제 동시성은 통합 테스트에서 별도 검증한다.
--  여기서는 "같은 전화번호를 두 번 연속 Import 하면 두 번째는 update 로 처리된다"만 확인한다.)
select pg_temp.ci_val('r9a', 'd0000000-0000-0000-0000-000000000004', '[{"name":"동시성후보","phone":"010-2222-1111"}]'::jsonb);
select pg_temp.ci_val('r9b', 'd0000000-0000-0000-0000-000000000004', '[{"name":"동시성후보","phone":"010-2222-1111"}]'::jsonb);
insert into results select '연속 Import: 두 번째 호출은 신규가 아니라 업데이트로 처리(중복 생성 없음)',
  (select v from ci_out where k='r9a')::jsonb = '{"inserted":1,"updated":0}'::jsonb
  and (select v from ci_out where k='r9b')::jsonb = '{"inserted":0,"updated":1}'::jsonb
  and (select count(*) from customers where phone = '010-2222-1111' and business_id = (select v::uuid from ids where k='Y')) = 1, null;

select case when ok then 'PASS' else 'FAIL' end as result, name, detail from results order by ok, name;
