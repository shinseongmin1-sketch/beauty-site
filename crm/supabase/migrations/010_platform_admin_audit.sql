-- 010: 플랫폼 관리자(운영자) + 감사 로그 (+ 문의 테이블 구조)
--
-- 1) platform_admins: 매니온 서비스를 운영하는 "우리 측" 관리자. 매장 직급(profiles.role)과 완전히 분리된 별도 테이블.
--    - 브라우저 권한(anon/authenticated)에는 이 테이블의 읽기/쓰기 권한이 전혀 없다 → 일반 사용자가 스스로 얻을 방법이 없다.
--    - 등록/해제는 서버 전용 스크립트(service_role/DB 관리자)로만 한다 (scripts/platform-admin.mjs).
--    - 운영자 화면이 쓰는 데이터는 아래 admin_* 함수가 "호출자가 활성 플랫폼 관리자인지"를 DB 에서 매번 검사한 뒤
--      집계 값만 돌려준다. 고객 명단/전화번호/메모 등 매장의 개인정보는 반환하지 않는다. 매장 데이터를 수정/삭제하는 함수는 없다.
--
-- 2) audit_logs: 추가만 가능한(append-only) 감사 로그.
--    - 매장 데이터 변경(고객/예약/상담/매출/결제수단/담당자/설정/마케팅/구독 등)은 DB 트리거가 자동으로 기록한다.
--      → 화면을 우회한 API 직접 호출도 기록되고, 클라이언트가 로그를 위조/누락시킬 수 없다.
--    - 로그인/가입/내보내기/가져오기처럼 DB 가 볼 수 없는 이벤트는 서버 전용 함수(audit_log_server, service_role)로만 기록한다.
--    - 개인정보 방지: metadata 는 허용 목록 키 + "코드형 값"만 저장할 수 있다 (한글/공백/@/3자리 이상 숫자가 든 문자열은 거부).
--      resource_id(UUID)와 action 으로 "무엇을 했는지"만 남기고 이름·전화번호·메모 원문은 어디에도 저장하지 않는다.
--    - IP / User-Agent 컬럼은 구조만 준비하고 기본은 저장하지 않는다 (platform_settings 로 켤 수 있음). 보관기간(retain_until)도
--      구조만 준비: 법률 검토 전에는 임의의 기간을 확정하지 않는다.
--    - UPDATE/DELETE/TRUNCATE 는 트리거로 전부 차단 (일반 사용자·플랫폼 관리자·service_role 모두).
--
-- 되돌리기: 파일 하단 ROLLBACK 주석 참고.

-- ── 운영 설정값 추가 (개인정보 저장 여부/보관기간: 기본은 저장 안 함, 기간은 미확정) ──
insert into public.platform_settings (key, value) values
  ('audit_log_store_ip', 'false'::jsonb),
  ('audit_log_store_user_agent', 'false'::jsonb),
  ('audit_log_retention_months', 'null'::jsonb)
on conflict (key) do nothing;

-- ── 플랫폼 관리자 ─────────────────────────────────────────────────────
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;   -- 정책도 없음: 브라우저 권한으로는 존재 여부조차 볼 수 없다

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select pa.active from platform_admins pa where pa.user_id = auth.uid()), false)
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

create or replace function public.assert_platform_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'platform_admin_required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.assert_platform_admin() from public, anon, authenticated;

-- ── 감사 로그 ─────────────────────────────────────────────────────────
create table public.audit_logs (
  seq bigint generated always as identity,
  id uuid primary key default gen_random_uuid(),
  business_id uuid,                                  -- FK 없음: 사업장이 삭제돼도 로그는 남는다
  actor_user_id uuid,                                -- FK 없음: 계정이 삭제돼도 로그는 남는다. 로그인 실패 등 알 수 없는 경우 null
  actor_type text not null check (actor_type in ('owner', 'admin', 'staff', 'platform_admin', 'system')),
  action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
  resource_type text not null check (resource_type ~ '^[a-z_]+$'),
  resource_id uuid,
  result text not null check (result in ('success', 'failure', 'denied')),
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,                                   -- platform_settings.audit_log_store_ip 가 true 일 때만 저장
  user_agent text,                                   -- platform_settings.audit_log_store_user_agent 가 true 일 때만 저장
  retain_until timestamptz,                          -- 보관 만료일: 정책 확정 전에는 null (임의 기간 미지정)
  created_at timestamptz not null default now()
);
create index audit_logs_business_idx on public.audit_logs (business_id, seq desc);
create index audit_logs_actor_idx on public.audit_logs (actor_user_id, seq desc) where actor_user_id is not null;
create index audit_logs_action_idx on public.audit_logs (action, seq desc);

alter table public.audit_logs enable row level security;
revoke all on public.audit_logs from anon, authenticated;
-- 대표는 자기 사업장 로그만 조회 가능. ip/user_agent 는 운영자 전용이라 컬럼 자체를 열지 않는다. 쓰기 권한은 어떤 브라우저 권한에도 없다.
grant select (seq, id, business_id, actor_user_id, actor_type, action, resource_type, resource_id, result, metadata, created_at)
  on public.audit_logs to authenticated;
create policy audit_logs_owner_select on public.audit_logs
  for select to authenticated
  using (business_id is not null and business_id = public.current_business_id() and public.has_role(array['owner']::staff_role[]));

-- 위변조 방지: 어떤 역할도(플랫폼 관리자, service_role 포함) 수정/삭제/비우기 불가
create or replace function public.audit_logs_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs_are_append_only' using errcode = '42501';
end;
$$;
create trigger audit_logs_no_update_delete before update or delete on public.audit_logs
  for each row execute function public.audit_logs_immutable();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function public.audit_logs_immutable();

-- metadata 검사: 허용된 키 + 코드형 값만. (이름/전화번호/이메일/메모 같은 원문이 들어올 수 없게)
create or replace function public.audit_code_ok(s text)
returns boolean
language sql
immutable
as $$
  select s ~ '^[A-Za-z0-9_.:-]{1,60}$' and s !~ '[0-9]{3,}'
$$;

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
    'plan', 'trial_source', 'denied_reason', 'method'
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

-- 삽입 직전 검사: metadata 안전성 + IP/UA 저장 정책
create or replace function public.audit_logs_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.audit_metadata_is_safe(new.metadata) then
    raise exception 'audit_metadata_rejected' using errcode = '22023';
  end if;
  if coalesce((select (value)::text::boolean from platform_settings where key = 'audit_log_store_ip' and jsonb_typeof(value) = 'boolean'), false) is not true then
    new.ip_address := null;
  end if;
  if coalesce((select (value)::text::boolean from platform_settings where key = 'audit_log_store_user_agent' and jsonb_typeof(value) = 'boolean'), false) is not true then
    new.user_agent := null;
  else
    new.user_agent := left(new.user_agent, 200);
  end if;
  return new;
end;
$$;
create trigger audit_logs_guard before insert on public.audit_logs
  for each row execute function public.audit_logs_before_insert();

-- 내부 기록 함수: 트리거/다른 definer 함수만 사용한다 (어떤 브라우저 권한에도 실행 권한 없음)
create or replace function public.audit_write(
  p_business uuid, p_actor_user uuid, p_actor_type text, p_action text, p_resource_type text,
  p_resource_id uuid, p_result text, p_metadata jsonb default '{}'::jsonb,
  p_ip inet default null, p_ua text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_logs (business_id, actor_user_id, actor_type, action, resource_type, resource_id, result, metadata, ip_address, user_agent)
  values (p_business, p_actor_user, p_actor_type, p_action, p_resource_type, p_resource_id, p_result, coalesce(p_metadata, '{}'::jsonb), p_ip, p_ua);
end;
$$;
revoke all on function public.audit_write(uuid, uuid, text, text, text, uuid, text, jsonb, inet, text) from public, anon, authenticated;

-- 현재 요청자의 로그용 직급 이름 (owner / admin(=manager) / staff), 없으면 null
create or replace function public.audit_actor_type()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case p.role when 'owner' then 'owner' when 'manager' then 'admin' when 'staff' then 'staff' end
  from profiles p where p.id = auth.uid()
$$;
revoke all on function public.audit_actor_type() from public, anon, authenticated;

-- ── 서버 전용 기록 함수 (로그인/가입/내보내기/가져오기/마케팅 발송 등 DB 가 볼 수 없는 이벤트) ──
create or replace function public.audit_log_server(
  p_business uuid, p_actor_user uuid, p_actor_type text, p_action text, p_resource_type text,
  p_resource_id uuid, p_result text, p_metadata jsonb default '{}'::jsonb,
  p_ip text default null, p_ua text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip inet;
begin
  if not (p_action = any (array[
    'auth.login', 'auth.logout', 'auth.signup',
    'customer.export', 'reservation.export', 'consultation.export', 'payment.export',
    'customer.import', 'marketing.send'
  ])) then
    raise exception 'audit_action_not_allowed' using errcode = '22023';
  end if;
  if p_actor_type not in ('owner', 'admin', 'staff', 'platform_admin', 'system') then
    raise exception 'audit_actor_type_invalid' using errcode = '22023';
  end if;
  begin
    v_ip := nullif(btrim(coalesce(p_ip, '')), '')::inet;
  exception when others then
    v_ip := null;
  end;
  perform public.audit_write(p_business, p_actor_user, p_actor_type, p_action, p_resource_type, p_resource_id, p_result, p_metadata, v_ip, p_ua);
end;
$$;
revoke all on function public.audit_log_server(uuid, uuid, text, text, text, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.audit_log_server(uuid, uuid, text, text, text, uuid, text, jsonb, text, text) to service_role;

-- ── 자동 기록 트리거: 매장 데이터 변경 ────────────────────────────────────
-- 인자: (resource_type, 사업장 컬럼명, [생성 시 action 이름 덮어쓰기])
-- 변경된 "컬럼 이름"만 metadata 에 남기고 값은 남기지 않는다. 로그 기록 실패가 본 작업을 막지는 않는다(경고만).
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res text := tg_argv[0];
  v_bcol text := tg_argv[1];
  v_create text := coalesce(nullif(tg_argv[2], ''), 'create');
  v_new jsonb;
  v_old jsonb;
  v_row jsonb;
  v_id uuid;
  v_biz uuid;
  v_uid uuid := auth.uid();
  v_type text;
  v_fields text[];
  v_meta jsonb := '{}'::jsonb;
begin
  begin
    if tg_op in ('INSERT', 'UPDATE') then v_new := to_jsonb(new); end if;
    if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
    v_row := coalesce(v_new, v_old);
    v_id := nullif(v_row ->> 'id', '')::uuid;
    v_biz := nullif(v_row ->> v_bcol, '')::uuid;

    -- 사업장 생성 트랜잭션 안에서 만들어지는 기본 데이터(대표 담당자/기본 결제수단/알림설정)는 기록하지 않는다
    if tg_op = 'INSERT' and tg_table_name in ('staff', 'payment_methods', 'notification_settings')
       and exists (select 1 from businesses b where b.id = v_biz and b.created_at = now()) then
      return null;
    end if;
    -- 사업장 삭제(탈퇴)로 연쇄 삭제되는 하위 행은 기록하지 않는다 (사업장 삭제 1건만 남김)
    if tg_op = 'DELETE' and v_res <> 'business' and not exists (select 1 from businesses b where b.id = v_biz) then
      return null;
    end if;

    if tg_op = 'UPDATE' then
      select array_agg(k order by k) into v_fields
      from jsonb_object_keys(v_new) as k
      where k not in ('updated_at', 'created_at') and (v_new -> k) is distinct from (v_old -> k);
      if v_fields is null then return null; end if;
      v_meta := jsonb_build_object('changed_fields', to_jsonb(v_fields));
    end if;
    if v_res = 'marketing' and tg_op = 'INSERT' then
      v_meta := jsonb_build_object('channel', v_row ->> 'channel');
    end if;

    v_type := case when v_uid is null then 'system' else coalesce(public.audit_actor_type(), 'system') end;
    perform public.audit_write(
      v_biz, v_uid, v_type,
      v_res || '.' || case tg_op when 'INSERT' then v_create when 'UPDATE' then 'update' else 'delete' end,
      v_res, v_id, 'success', v_meta
    );
  exception when others then
    raise warning 'audit_row_change failed: %', sqlerrm;
  end;
  return null;
end;
$$;

create trigger audit_customers after insert or update or delete on public.customers
  for each row execute function public.audit_row_change('customer', 'business_id');
create trigger audit_reservations after insert or update or delete on public.reservations
  for each row execute function public.audit_row_change('reservation', 'business_id');
create trigger audit_consultations after insert or update or delete on public.consultations
  for each row execute function public.audit_row_change('consultation', 'business_id');
create trigger audit_payments after insert or update or delete on public.payments
  for each row execute function public.audit_row_change('payment', 'business_id');
create trigger audit_payment_methods after insert or update or delete on public.payment_methods
  for each row execute function public.audit_row_change('payment_method', 'business_id');
create trigger audit_staff after insert or update or delete on public.staff
  for each row execute function public.audit_row_change('staff', 'business_id');
create trigger audit_notification_settings after update on public.notification_settings
  for each row execute function public.audit_row_change('notification_settings', 'business_id');
create trigger audit_businesses after insert or update or delete on public.businesses
  for each row execute function public.audit_row_change('business', 'id');
create trigger audit_marketing after insert on public.marketing_messages
  for each row execute function public.audit_row_change('marketing', 'business_id', 'draft_create');

-- 구독/무료체험 상태: 시작 / 거부 / 종료 / 상태 변경
create or replace function public.audit_subscription_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_type text := case when auth.uid() is null then 'system' else coalesce(public.audit_actor_type(), 'system') end;
begin
  begin
    if tg_op = 'INSERT' then
      if new.status = 'trial' then
        perform public.audit_write(new.business_id, v_uid, v_type, 'trial.start', 'subscription', new.id, 'success',
          jsonb_build_object('trial_source', new.trial_source));
      elsif new.trial_denied_reason is not null then
        perform public.audit_write(new.business_id, v_uid, v_type, 'trial.denied', 'subscription', new.id, 'denied',
          jsonb_build_object('denied_reason', new.trial_denied_reason));
      else
        perform public.audit_write(new.business_id, v_uid, v_type, 'subscription.status_change', 'subscription', new.id, 'success',
          jsonb_build_object('status_to', new.status::text));
      end if;
    elsif new.status is distinct from old.status then
      if old.status = 'trial' and new.status = 'expired' then
        perform public.audit_write(new.business_id, null, 'system', 'trial.end', 'subscription', new.id, 'success', '{}'::jsonb);
      else
        perform public.audit_write(new.business_id, v_uid, v_type, 'subscription.status_change', 'subscription', new.id, 'success',
          jsonb_build_object('status_from', old.status::text, 'status_to', new.status::text));
      end if;
    end if;
  exception when others then
    raise warning 'audit_subscription_change failed: %', sqlerrm;
  end;
  return null;
end;
$$;
create trigger audit_subscriptions after insert or update on public.subscriptions
  for each row execute function public.audit_subscription_change();

-- 직원 권한 변경 / 연결 해제 (profiles 변경을 관찰: 함수 정의를 바꾸지 않고 기록)
create or replace function public.audit_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_type text := case when auth.uid() is null then 'system' else coalesce(public.audit_actor_type(), 'system') end;
begin
  begin
    if old.business_id is not null and new.business_id is null then
      perform public.audit_write(old.business_id, v_uid, v_type, 'staff.unlink', 'profile', new.id, 'success', '{}'::jsonb);
    elsif old.business_id is not null and new.business_id = old.business_id and new.role is distinct from old.role then
      perform public.audit_write(new.business_id, v_uid, v_type, 'staff.role_change', 'profile', new.id, 'success',
        jsonb_build_object('role_from', old.role::text, 'role_to', new.role::text));
    end if;
  exception when others then
    raise warning 'audit_profile_change failed: %', sqlerrm;
  end;
  return null;
end;
$$;
create trigger audit_profiles after update of role, business_id on public.profiles
  for each row execute function public.audit_profile_change();

-- 직원 초대 / 초대 취소 / 초대 수락
create or replace function public.audit_invitation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_type text := case when auth.uid() is null then 'system' else coalesce(public.audit_actor_type(), 'system') end;
  v_accepted_type text;
begin
  begin
    if tg_op = 'INSERT' then
      perform public.audit_write(new.business_id, v_uid, v_type, 'staff.invite', 'staff_invitation', new.id, 'success',
        jsonb_build_object('invited_role', new.role::text));
    else
      if old.revoked_at is null and new.revoked_at is not null then
        perform public.audit_write(new.business_id, v_uid, v_type, 'staff.invite_revoke', 'staff_invitation', new.id, 'success', '{}'::jsonb);
      end if;
      if old.accepted_at is null and new.accepted_at is not null then
        select case p.role when 'owner' then 'owner' when 'manager' then 'admin' else 'staff' end into v_accepted_type
        from profiles p where p.id = new.accepted_profile_id;
        perform public.audit_write(new.business_id, new.accepted_profile_id, coalesce(v_accepted_type, 'staff'), 'staff.invite_accept',
          'staff_invitation', new.id, 'success', '{}'::jsonb);
      end if;
    end if;
  exception when others then
    raise warning 'audit_invitation_change failed: %', sqlerrm;
  end;
  return null;
end;
$$;
create trigger audit_invitations after insert or update on public.staff_invitations
  for each row execute function public.audit_invitation_change();

-- 플랫폼 관리자 등록/해제 자체도 기록
create or replace function public.audit_platform_admin_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if tg_op = 'INSERT' and new.active then
      perform public.audit_write(null, coalesce(auth.uid(), null), 'system', 'platform_admin.grant', 'platform_admin', new.user_id, 'success', '{}'::jsonb);
    elsif tg_op = 'UPDATE' and new.active is distinct from old.active then
      perform public.audit_write(null, coalesce(auth.uid(), null), 'system',
        case when new.active then 'platform_admin.grant' else 'platform_admin.revoke' end, 'platform_admin', new.user_id, 'success', '{}'::jsonb);
    end if;
  exception when others then
    raise warning 'audit_platform_admin_change failed: %', sqlerrm;
  end;
  return null;
end;
$$;
create trigger audit_platform_admins after insert or update on public.platform_admins
  for each row execute function public.audit_platform_admin_change();

-- ── 문의 (구조만: 고객센터 화면은 별도 작업. 체험 종료/정지 사업장도 문의는 할 수 있어야 하므로 구독 차단 정책을 걸지 않는다) ──
create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  category text not null default 'general' check (category in ('general', 'billing', 'bug', 'feature', 'remote_support')),
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 5000),
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  answer text,
  answered_at timestamptz,
  answered_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index inquiries_created_idx on public.inquiries (created_at desc);
alter table public.inquiries enable row level security;
revoke all on public.inquiries from anon, authenticated;
grant select, insert on public.inquiries to authenticated;
create policy inquiries_select_own on public.inquiries for select to authenticated using (user_id = auth.uid());
create policy inquiries_insert_own on public.inquiries for insert to authenticated
  with check (user_id = auth.uid() and business_id = public.current_business_id());

-- ── 운영자 전용 조회 함수 (호출자가 활성 플랫폼 관리자여야만 동작 / 집계·비식별 값만 반환) ──
create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  perform public.assert_platform_admin();
  with eff as (
    select b.id, b.name, b.created_at, s.trial_started_at, s.trial_ends_at, s.trial_denied_reason,
           case when s.status = 'trial' and s.trial_ends_at <= now() then 'expired' else coalesce(s.status::text, 'none') end as st
    from businesses b left join subscriptions s on s.business_id = b.id
  )
  select jsonb_build_object(
    'total', (select count(*) from eff),
    'trial', (select count(*) from eff where st = 'trial'),
    'expired', (select count(*) from eff where st = 'expired'),
    'expired_denied', (select count(*) from eff where st = 'expired' and trial_denied_reason is not null),
    'active', (select count(*) from eff where st = 'active'),
    'canceled', (select count(*) from eff where st = 'canceled'),
    'suspended', (select count(*) from eff where st = 'suspended'),
    'recent_signups', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select id, name, created_at, st as status from eff order by created_at desc limit 10) x),
    'recent_trial_starts', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select id, name, trial_started_at from eff where trial_started_at is not null order by trial_started_at desc limit 10) x),
    'recent_trial_ends', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select id, name, trial_ends_at from eff
        where st = 'expired' and trial_denied_reason is null and trial_ends_at is not null order by trial_ends_at desc limit 10) x),
    'recent_inquiries', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select i.id, i.title, i.category, i.status, i.created_at, i.business_id from inquiries i order by i.created_at desc limit 10) x)
  ) into r;
  return r;
end;
$$;

create or replace function public.admin_list_businesses(
  p_query text default null,
  p_status text default null,
  p_from date default null,
  p_to date default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid, name text, representative_name text, created_at timestamptz,
  status text, trial_ends_at timestamptz, total_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  perform public.assert_platform_admin();
  if v_q is not null then
    v_q := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
  select e.id, e.name, e.representative_name, e.created_at, e.st, e.trial_ends_at, count(*) over ()
  from (
    select b.id, b.name, b.representative_name, b.created_at, s.trial_ends_at,
           case when s.status = 'trial' and s.trial_ends_at <= now() then 'expired' else coalesce(s.status::text, 'none') end as st
    from businesses b left join subscriptions s on s.business_id = b.id
  ) e
  where (v_q is null or e.name ilike v_q escape '\' or coalesce(e.representative_name, '') ilike v_q escape '\')
    and (p_status is null or e.st = p_status)
    and (p_from is null or e.created_at >= p_from)
    and (p_to is null or e.created_at < (p_to + 1))
  order by e.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_business_detail(p_business uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  perform public.assert_platform_admin();
  select jsonb_build_object(
    'id', b.id,
    'name', b.name,
    'representative_name', b.representative_name,
    'business_number_masked', b.business_number_masked,
    'created_at', b.created_at,
    'status', case when s.status = 'trial' and s.trial_ends_at <= now() then 'expired' else coalesce(s.status::text, 'none') end,
    'trial_started_at', s.trial_started_at,
    'trial_ends_at', s.trial_ends_at,
    'trial_denied_reason', s.trial_denied_reason,
    'staff_count', (select count(*) from staff where business_id = b.id),
    'customer_count', (select count(*) from customers where business_id = b.id),
    'reservation_count', (select count(*) from reservations where business_id = b.id),
    'payment_count', (select count(*) from payments where business_id = b.id),
    'last_activity_at', (select max(a.created_at) from audit_logs a
                         where a.business_id = b.id and a.actor_type in ('owner', 'admin', 'staff'))
  ) into r
  from businesses b left join subscriptions s on s.business_id = b.id
  where b.id = p_business;
  if r is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  -- 운영자가 사업장 상세를 열람한 사실도 기록 (목록/대시보드 조회는 로그 폭증을 피하려고 기록하지 않음)
  perform public.audit_write(p_business, auth.uid(), 'platform_admin', 'platform.business_view', 'business', p_business, 'success', '{}'::jsonb);
  return r;
end;
$$;

create or replace function public.admin_recent_audit_logs(
  p_business uuid default null,
  p_action text default null,
  p_limit int default 50
)
returns table (
  seq bigint, created_at timestamptz, business_id uuid, business_name text, actor_type text,
  action text, resource_type text, resource_id uuid, result text, metadata jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.assert_platform_admin();
  return query
  select a.seq, a.created_at, a.business_id, b.name, a.actor_type, a.action, a.resource_type, a.resource_id, a.result, a.metadata
  from audit_logs a left join businesses b on b.id = a.business_id
  where (p_business is null or a.business_id = p_business)
    and (p_action is null or a.action = p_action)
  order by a.seq desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

revoke all on function public.admin_dashboard() from public, anon;
revoke all on function public.admin_list_businesses(text, text, date, date, int, int) from public, anon;
revoke all on function public.admin_business_detail(uuid) from public, anon;
revoke all on function public.admin_recent_audit_logs(uuid, text, int) from public, anon;
grant execute on function public.admin_dashboard() to authenticated;
grant execute on function public.admin_list_businesses(text, text, date, date, int, int) to authenticated;
grant execute on function public.admin_business_detail(uuid) to authenticated;
grant execute on function public.admin_recent_audit_logs(uuid, text, int) to authenticated;

-- ROLLBACK (필요 시 수동 실행, 역순):
--   drop function public.admin_recent_audit_logs(uuid, text, int), public.admin_business_detail(uuid),
--     public.admin_list_businesses(text, text, date, date, int, int), public.admin_dashboard();
--   drop table public.inquiries;
--   drop trigger audit_platform_admins on public.platform_admins; drop trigger audit_invitations on public.staff_invitations;
--   drop trigger audit_profiles on public.profiles; drop trigger audit_subscriptions on public.subscriptions;
--   drop trigger audit_marketing on public.marketing_messages; drop trigger audit_businesses on public.businesses;
--   drop trigger audit_notification_settings on public.notification_settings; drop trigger audit_staff on public.staff;
--   drop trigger audit_payment_methods on public.payment_methods; drop trigger audit_payments on public.payments;
--   drop trigger audit_consultations on public.consultations; drop trigger audit_reservations on public.reservations;
--   drop trigger audit_customers on public.customers;
--   drop function public.audit_platform_admin_change(), public.audit_invitation_change(), public.audit_profile_change(),
--     public.audit_subscription_change(), public.audit_row_change(), public.audit_log_server(uuid, uuid, text, text, text, uuid, text, jsonb, text, text),
--     public.audit_actor_type(), public.audit_write(uuid, uuid, text, text, text, uuid, text, jsonb, inet, text),
--     public.audit_logs_before_insert(), public.audit_metadata_is_safe(jsonb), public.audit_code_ok(text);
--   (audit_logs 는 append-only 라 삭제 전에 트리거를 먼저 제거: drop trigger audit_logs_no_update_delete on public.audit_logs; drop trigger audit_logs_no_truncate on public.audit_logs;)
--   drop table public.audit_logs; drop function public.audit_logs_immutable();
--   drop function public.assert_platform_admin(), public.is_platform_admin(); drop table public.platform_admins;
--   delete from public.platform_settings where key in ('audit_log_store_ip', 'audit_log_store_user_agent', 'audit_log_retention_months');
