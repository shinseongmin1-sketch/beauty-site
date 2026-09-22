import { cache } from "react";
import { format } from "date-fns";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * 플랫폼 관리자(매니온 운영자) 전용 화면의 가드.
 *  - 매장 직급(profiles.role)과 완전히 별개: DB 의 platform_admins 테이블(활성 여부 포함)만 본다.
 *  - 여기서의 검사는 "화면 접근" 용이고, 운영자 화면이 쓰는 데이터는 DB 함수(admin_*)가 호출자가 활성 플랫폼 관리자인지
 *    다시 검사한다. 즉 이 가드를 우회해도 일반 사용자는 운영자 데이터를 받을 수 없다.
 *  - 일반 사용자에게는 페이지 존재 자체를 드러내지 않도록 404 로 응답한다.
 */
export const requirePlatformAdmin = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/admin");

  const { data: isAdmin } = await supabase.rpc("is_platform_admin");
  if (isAdmin !== true) notFound();

  return { supabase, user };
});

export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  trial: "무료체험 중",
  expired: "체험 종료",
  active: "유료 이용",
  canceled: "해지",
  suspended: "이용 정지",
  none: "구독 없음",
};

export const formatDateTime = (v: string | null | undefined) => (v ? format(new Date(v), "yyyy.MM.dd HH:mm") : "-");
export const formatDate = (v: string | null | undefined) => (v ? format(new Date(v), "yyyy.MM.dd") : "-");
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const AUDIT_ACTOR_LABEL: Record<string, string> = {
  owner: "대표",
  admin: "관리자",
  staff: "직원",
  platform_admin: "운영자",
  system: "시스템",
};
