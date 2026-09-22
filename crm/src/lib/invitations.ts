import crypto from "node:crypto";

/**
 * 직원 초대 토큰: 256비트 난수. 원본은 초대 링크에만 담기고 DB 에는 sha256 해시만 저장된다
 * (DB 가 유출돼도 링크를 만들 수 없고, 대표/관리자도 저장된 값으로 링크를 복원할 수 없다).
 */
export function generateInviteToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** DB 함수가 던지는 오류 코드(메시지)를 사용자에게 보여줄 한국어 안내로 바꾼다. 내부 오류 문구는 노출하지 않는다. */
export function inviteErrorMessage(err: { message?: string; code?: string } | null | undefined): string {
  const m = err?.message ?? "";
  if (m.includes("email_taken")) return "이미 가입된 이메일입니다. 다른 이메일로 초대해주세요.";
  if (m.includes("email_pending")) return "다른 담당자에게 이미 초대가 진행 중인 이메일입니다.";
  if (m.includes("invalid_email")) return "이메일 형식이 올바르지 않습니다.";
  if (m.includes("already_linked")) return "이미 로그인 계정이 연결된 담당자입니다.";
  if (m.includes("manager_can_invite_staff_only")) return "관리자 권한 담당자의 계정은 대표만 초대·해제할 수 있습니다.";
  if (m.includes("cannot_invite_owner") || m.includes("cannot_unlink_owner_or_self")) return "대표 계정에는 사용할 수 없는 기능입니다.";
  if (m.includes("not_linked")) return "로그인 계정이 연결되어 있지 않은 담당자입니다.";
  if (m.includes("subscription_inactive")) return "무료체험이 종료되어 새로 등록하거나 변경할 수 없습니다.";
  if (m.includes("forbidden") || err?.code === "42501") return "이 작업을 할 권한이 없습니다.";
  if (m.includes("not_found") || err?.code === "P0002") return "담당자를 찾을 수 없습니다.";
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}
