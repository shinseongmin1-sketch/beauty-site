/**
 * Supabase Auth 오류를 사용자에게 보여줄 한국어 안내로 바꾼다.
 * 영문 원문(내부 오류 문구)은 화면에 노출하지 않고 서버 로그에만 남긴다.
 */
export function signUpErrorMessage(error: { code?: string; message?: string; status?: number } | null | undefined): string {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();

  if (code === "email_address_invalid" || message.includes("is invalid") || message.includes("invalid email")) {
    return "사용할 수 없는 이메일 주소입니다. 실제로 사용하는 이메일을 입력해주세요.";
  }
  if (code === "user_already_exists" || code === "email_exists" || message.includes("already registered") || message.includes("already been registered")) {
    return "이미 가입된 이메일입니다. 로그인하거나 다른 이메일을 사용해주세요.";
  }
  if (code === "weak_password" || message.includes("password should") || message.includes("weak password")) {
    return "비밀번호가 너무 약합니다. 더 길고 추측하기 어려운 비밀번호를 사용해주세요.";
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || error?.status === 429 || message.includes("rate limit")) {
    return "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
  }
  if (code === "signup_disabled") {
    return "현재 신규 가입을 받고 있지 않습니다. 잠시 후 다시 시도해주세요.";
  }
  return "가입 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요.";
}
