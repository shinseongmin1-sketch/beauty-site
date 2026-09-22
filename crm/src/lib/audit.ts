import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/server";
import type { StaffRole } from "@/lib/types";

// 감사 로그 (서버 전용).
//
//  - 매장 데이터 변경(고객/예약/상담/매출/결제수단/담당자/설정/마케팅/구독 …)은 DB 트리거가 자동으로 기록한다.
//    → 여기서 다시 기록하지 않는다 (화면을 우회한 API 직접 호출도 DB 가 기록).
//  - DB 가 볼 수 없는 이벤트(로그인/가입/로그아웃/내보내기/가져오기)만 이 파일의 logAudit() 로 기록한다.
//    브라우저에서는 호출할 수 없고(서버 전용 service_role 함수), DB 가 허용된 action 만 받는다.
//  - 개인정보 원문은 로그에 넣지 않는다: metadata 는 DB 가 "허용된 키 + 코드형 값"만 받도록 강제한다
//    (이름/전화번호/이메일/메모 등을 넣으면 DB 가 거부). 대상은 resource_id(UUID)로만 표시한다.
//  - 기록 실패가 본 작업(로그인 등)을 막지 않도록 예외는 삼키고 서버 로그에만 남긴다.

export type AuditActorType = "owner" | "admin" | "staff" | "platform_admin" | "system";

export type ServerAuditAction =
  | "auth.login"
  | "auth.logout"
  | "auth.signup"
  | "customer.export"
  | "reservation.export"
  | "consultation.export"
  | "payment.export"
  | "customer.import"
  | "marketing.send";

type MetaValue = string | number | boolean | string[];

export interface AuditEvent {
  businessId?: string | null;
  actorUserId?: string | null;
  actorType: AuditActorType;
  action: ServerAuditAction;
  resourceType: string;
  resourceId?: string | null;
  result: "success" | "failure" | "denied";
  metadata?: Record<string, MetaValue>;
}

/** profiles.role → 로그용 직급 이름 (manager = admin) */
export function actorTypeFromRole(role: StaffRole | null | undefined): AuditActorType {
  return role === "manager" ? "admin" : role === "staff" ? "staff" : "owner";
}

/** 인증 오류 코드를 로그용 코드로 정리 (코드형이 아니면 unknown) */
export function safeErrorCode(code: string | undefined | null): string {
  return code && /^[a-z_]{1,50}$/.test(code) ? code : "unknown";
}

export async function logAudit(event: AuditEvent): Promise<void> {
  try {
    const h = await headers();
    const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
    const ua = h.get("user-agent");
    const admin = await createAdminClient();
    const { error } = await admin.rpc("audit_log_server", {
      p_business: event.businessId ?? null,
      p_actor_user: event.actorUserId ?? null,
      p_actor_type: event.actorType,
      p_action: event.action,
      p_resource_type: event.resourceType,
      p_resource_id: event.resourceId ?? null,
      p_result: event.result,
      p_metadata: event.metadata ?? {},
      // IP/User-Agent 는 넘기기만 한다. 저장할지는 DB 설정(platform_settings)이 결정하며 기본은 저장하지 않는다.
      p_ip: ip,
      p_ua: ua,
    });
    if (error) console.error("[audit] log failed", { action: event.action, code: error.code });
  } catch (e) {
    console.error("[audit] log threw", event.action, e instanceof Error ? e.message : e);
  }
}

// ── 내보내기 / 가져오기 ────────────────────────────────────────────────
// 나중에 만들 고객·예약·상담·매출 Export/Import 는 파일을 만들어 내려주기 "전에" 반드시 아래 함수로 기록한다.
// 남기는 것은 누가/어느 사업장/무엇을/몇 건/어떤 형식인지뿐이며, 내용(개인정보)은 남기지 않는다.

export type ExportResource = "customer" | "reservation" | "consultation" | "payment";

export async function logDataExport(
  ctx: { businessId: string; userId: string; role: StaffRole },
  resource: ExportResource,
  opts: { format: "csv" | "xlsx"; rowCount: number; result?: "success" | "failure" }
) {
  await logAudit({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: actorTypeFromRole(ctx.role),
    action: `${resource}.export`,
    resourceType: resource,
    result: opts.result ?? "success",
    metadata: { format: opts.format, row_count: opts.rowCount },
  });
}

export async function logDataImport(
  ctx: { businessId: string; userId: string; role: StaffRole },
  opts: {
    format: "csv" | "xlsx";
    rowCount: number;
    successCount?: number;
    errorCount?: number;
    result?: "success" | "failure";
  }
) {
  const metadata: Record<string, MetaValue> = { format: opts.format, row_count: opts.rowCount };
  if (opts.successCount !== undefined) metadata.success_count = opts.successCount;
  if (opts.errorCount !== undefined) metadata.error_count = opts.errorCount;

  await logAudit({
    businessId: ctx.businessId,
    actorUserId: ctx.userId,
    actorType: actorTypeFromRole(ctx.role),
    action: "customer.import",
    resourceType: "customer",
    result: opts.result ?? "success",
    metadata,
  });
}
