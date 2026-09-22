-- 011: 고객 Import/Export
--
-- Export 는 기존 RLS(customers_select, 사업장 격리)와 서버 액션의 requireAccess 만으로 충분해서
-- DB 변경이 필요 없다. audit_log_server() 의 허용 action 목록에도 customer.export/customer.import
-- 는 이미 010 에서 등록돼 있다.
--
-- 이 마이그레이션이 하는 일은 두 가지뿐이다.
--   1) audit_logs.metadata 허용 키에 success_count/error_count 추가 (010 의 화이트리스트에 키만 추가, 다른 정책은 그대로).
--   2) import_customers(jsonb): 고객 일괄 등록/갱신을 "하나의 DB 함수 호출 = 하나의 트랜잭션"으로 처리.
--      - auth.uid() 로 직접 business_id/직급을 확인한다 (클라이언트가 보낸 business_id 는 받지 않음 → 다른 사업장 대상 지정이 원천 불가).
--      - assert_business_writable() 로 007/009 의 기존 쓰기 제한을 그대로 따른다.
--      - 대표/관리자만 (007 과 동일 기준).
--      - 전화번호 정규화·중복 판정을 이 함수 안에서 서버가 직접 계산한다 (클라이언트가 "이 고객을 갱신하라"고
--        지정하는 customer_id 파라미터 자체가 없음 → IDOR 경로가 없다).
--      - 등급/태그는 반드시 해당 사업장에 이미 존재해야 하며, 없으면 자동 생성하지 않고 전체 요청을 실패시킨다.
--      - 행 하나라도 오류면 예외를 던져 함수 전체(=트랜잭션 전체)가 롤백된다 (부분 반영 없음).
--      - 같은 사업장에 대한 동시 Import 는 advisory lock 으로 직렬화해, 같은 전화번호의 신규 고객이
--        동시 요청으로 중복 생성되는 것을 막는다 (트랜잭션 종료 시 자동 해제, 스키마 변경 없음).
--      - 빈 값은 "기존 값 유지"로 처리한다 (이름/메모/등급 갱신 시 CSV 가 비어 있으면 기존 값을 지우지 않음).
--      - 태그는 기존 태그를 삭제하지 않고 CSV 에 지정된 태그만 추가한다.
--
-- 되돌리기: 파일 하단 ROLLBACK 주석 참고.

create or replace function public.audit_metadata_is_safe(m jsonb)
returns boolean
language plpgsql
immutable
as $$
declare
  k text;
  v jsonb;
  e jsonb;
  allowed text[] := array[
    'reason', 'changed_fields', 'count', 'row_count', 'format', 'source', 'channel',
    'status_from', 'status_to', 'role_from', 'role_to', 'invited_role', 'error_code',
    'plan', 'trial_source', 'denied_reason', 'method', 'success_count', 'error_count'
  ];
begin
  if m is null or jsonb_typeof(m) <> 'object' or length(m::text) > 1000 then return false; end if;
  for k, v in select key, value from jsonb_each(m) loop
    if not (k = any (allowed)) then return false; end if;
    case jsonb_typeof(v)
      when 'string' then
        if not public.audit_code_ok(v #>> '{}') then return false; end if;
      when 'number' then null;
      when 'boolean' then null;
      when 'array' then
        if jsonb_array_length(v) > 30 then return false; end if;
        for e in select value from jsonb_array_elements(v) loop
          if jsonb_typeof(e) <> 'string' or not public.audit_code_ok(e #>> '{}') then return false; end if;
        end loop;
      else return false;
    end case;
  end loop;
  return true;
end;
$$;

create or replace function public.import_customers(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_business uuid;
  v_role staff_role;
  v_count int;
  v_row jsonb;
  v_row_num int := 0;
  v_name text;
  v_phone_raw text;
  v_phone text;      -- 정규화된 숫자열(8~11자리) 또는 null
  v_memo text;
  v_grade_name text;
  v_grade_id uuid;
  v_tag_names text[];
  v_tag_missing text;
  v_seen_phones text[] := '{}';
  v_existing_id uuid;
  v_inserted int := 0;
  v_updated int := 0;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;

  select business_id, role into v_business, v_role from profiles where id = v_uid;
  if v_business is null or v_role not in ('owner', 'manager') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform public.assert_business_writable(v_business);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'invalid_rows' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count = 0 then raise exception 'no_rows' using errcode = '22023'; end if;
  if v_count > 2000 then raise exception 'too_many_rows' using errcode = '22023'; end if;

  -- 같은 사업장에 대한 Import 를 직렬화한다: 두 명이 거의 동시에 같은 CSV 를 올려도
  -- 이 트랜잭션이 끝날 때까지 다른 import_customers 호출이 기다리므로, 같은 전화번호가
  -- 두 번 새로 생성되는 경쟁 상태가 생기지 않는다. (스키마 변경 없이 세션 종료 시 자동 해제)
  perform pg_advisory_xact_lock(hashtext(v_business::text));

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_row_num := v_row_num + 1;

    v_name := nullif(btrim(coalesce(v_row ->> 'name', '')), '');
    v_phone_raw := nullif(btrim(coalesce(v_row ->> 'phone', '')), '');
    v_phone := nullif(regexp_replace(coalesce(v_phone_raw, ''), '\D', '', 'g'), '');
    v_memo := nullif(btrim(coalesce(v_row ->> 'memo', '')), '');
    v_grade_name := nullif(btrim(coalesce(v_row ->> 'grade_name', '')), '');
    select array_agg(t) into v_tag_names
    from (
      select distinct nullif(btrim(x), '') as t
      from jsonb_array_elements_text(coalesce(v_row -> 'tag_names', '[]'::jsonb)) as x
    ) s
    where t is not null;

    if v_name is null then
      raise exception 'row_invalid:%:name_required', v_row_num using errcode = '22023';
    end if;
    if v_phone_raw is not null and (v_phone is null or length(v_phone) not between 8 and 11) then
      raise exception 'row_invalid:%:phone_format', v_row_num using errcode = '22023';
    end if;
    if v_phone is not null then
      if v_phone = any (v_seen_phones) then
        raise exception 'row_invalid:%:duplicate_phone_in_file', v_row_num using errcode = '22023';
      end if;
      v_seen_phones := array_append(v_seen_phones, v_phone);
    end if;

    v_grade_id := null;
    if v_grade_name is not null then
      select id into v_grade_id from customer_grades where business_id = v_business and lower(name) = lower(v_grade_name);
      if v_grade_id is null then
        raise exception 'row_invalid:%:unknown_grade', v_row_num using errcode = '22023';
      end if;
    end if;

    if v_tag_names is not null and array_length(v_tag_names, 1) > 0 then
      select t into v_tag_missing
      from unnest(v_tag_names) t
      where not exists (select 1 from customer_tags ct where ct.business_id = v_business and lower(ct.name) = lower(t))
      limit 1;
      if v_tag_missing is not null then
        raise exception 'row_invalid:%:unknown_tag', v_row_num using errcode = '22023';
      end if;
    end if;

    v_existing_id := null;
    if v_phone is not null then
      select c.id into v_existing_id
      from customers c
      where c.business_id = v_business
        and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_phone
      limit 1;
    end if;

    if v_existing_id is not null then
      -- 빈 값은 "기존 값 유지": coalesce(새 값, 기존 값). 태그는 삭제하지 않고 추가만.
      update customers set
        name = coalesce(v_name, name),
        phone = coalesce(v_phone_raw, phone),
        memo = coalesce(v_memo, memo),
        grade_id = coalesce(v_grade_id, grade_id)
      where id = v_existing_id;
      v_updated := v_updated + 1;
    else
      insert into customers (business_id, name, phone, memo, grade_id)
      values (v_business, v_name, v_phone_raw, v_memo, v_grade_id)
      returning id into v_existing_id;
      v_inserted := v_inserted + 1;
    end if;

    if v_tag_names is not null and array_length(v_tag_names, 1) > 0 then
      insert into customer_tag_links (business_id, customer_id, tag_id)
      select v_business, v_existing_id, ct.id
      from customer_tags ct
      where ct.business_id = v_business and lower(ct.name) = any (select lower(x) from unnest(v_tag_names) x)
      on conflict do nothing;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end;
$$;

revoke all on function public.import_customers(jsonb) from public, anon;
grant execute on function public.import_customers(jsonb) to authenticated;

-- ROLLBACK (필요 시 수동 실행):
--   drop function public.import_customers(jsonb);
--   (audit_metadata_is_safe 는 010 의 정의로 되돌리려면 success_count/error_count 를 allowed 배열에서 제거하고 재정의)
