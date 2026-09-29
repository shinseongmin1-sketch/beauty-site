import Link from "next/link";
import { requestPasswordReset } from "./actions";

const ERROR_MESSAGES: Record<string, string> = {
  required: "이메일을 입력해주세요.",
  expired: "재설정 링크가 만료되었거나 이미 사용되었습니다. 다시 요청해주세요.",
  invalid: "유효하지 않은 재설정 링크입니다. 다시 요청해주세요.",
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error: errorCode, message } = await searchParams;
  // 오류는 정해진 코드만 받아 문구로 바꾼다 (URL 로 임의 문구를 띄울 수 없게).
  const error = errorCode ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.invalid) : undefined;

  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">
            <span className="text-navy">비밀번호</span> 재설정
          </h1>
          <p className="mt-2 text-sm text-muted">가입하신 이메일로 재설정 링크를 보내드립니다.</p>
        </div>

        {message && (
          <p className="rounded-lg bg-status-mint-bg px-4 py-3 text-sm text-status-mint-text">
            {message}
          </p>
        )}
        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
        )}

        <form action={requestPasswordReset} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">이메일</label>
            <input
              type="email"
              name="email"
              required
              className="w-full rounded-lg border border-border px-3 py-2 outline-none focus:border-accent"
              placeholder="owner@example.com"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-accent hover:bg-accent-hover py-2.5 font-semibold text-white transition-colors"
          >
            재설정 링크 받기
          </button>
        </form>

        <p className="text-center text-sm text-muted">
          <Link href="/login" className="font-medium text-accent hover:underline">
            로그인으로 돌아가기
          </Link>
        </p>
      </div>
    </div>
  );
}
