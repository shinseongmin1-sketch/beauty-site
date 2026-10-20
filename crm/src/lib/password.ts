// 비밀번호 작성 규칙 (가입·초대 수락·재설정 공통).
// 개인정보의 안전성 확보조치 기준에 따라 추측하기 쉬운 비밀번호를 막는다: 8자 이상, 영문과 숫자를 모두 포함.
export const PASSWORD_RULE_TEXT = "8자 이상, 영문과 숫자를 모두 포함";
export const PASSWORD_MIN_LENGTH = 8;
// bcrypt(Supabase Auth)는 72바이트까지만 사용하므로 그 이상은 받지 않는다.
const PASSWORD_MAX_BYTES = 72;

/** 규칙에 맞으면 null, 아니면 화면에 보여줄 한국어 안내를 돌려준다. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `비밀번호는 ${PASSWORD_RULE_TEXT}해야 합니다.`;
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) return "비밀번호가 너무 깁니다. 72자 이하로 입력해주세요.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return `비밀번호는 ${PASSWORD_RULE_TEXT}해야 합니다.`;
  return null;
}
