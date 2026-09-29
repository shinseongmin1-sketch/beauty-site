import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasValidRecoveryCookie } from "@/lib/recovery";
import { updatePassword } from "./actions";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // 재설정 링크를 통과한 세션(recovery 표시 쿠키)만 허용한다. 일반 로그인 세션만으로는 쓸 수 없다.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !(await hasValidRecoveryCookie(user.id))) {
    redirect("/forgot-password?error=expired");
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">
            <span className="text-navy">새 비밀번호</span> 설정
          </h1>
          <p className="mt-2 text-sm text-muted">새로 사용할 비밀번호를 입력해주세요.</p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
        )}

        <form action={updatePassword} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">새 비밀번호</label>
            <input
              type="password"
              name="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-lg border border-border px-3 py-2 outline-none focus:border-accent"
              placeholder="8자 이상"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">비밀번호 확인</label>
            <input
              type="password"
              name="password_confirm"
              required
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-lg border border-border px-3 py-2 outline-none focus:border-accent"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-accent hover:bg-accent-hover py-2.5 font-semibold text-white transition-colors"
          >
            비밀번호 변경
          </button>
        </form>
      </div>
    </div>
  );
}
