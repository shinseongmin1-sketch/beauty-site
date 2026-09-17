import Link from "next/link";
import { signIn } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>;
}) {
  const { error, message, next } = await searchParams;

  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">
            <span className="text-navy">
              예약관리
            </span>{" "}
            로그인
          </h1>
          <p className="mt-2 text-sm text-muted">매장 관리자 계정으로 로그인하세요.</p>
        </div>

        {message && (
          <p className="rounded-lg bg-status-mint-bg px-4 py-3 text-sm text-status-mint-text">
            {message}
          </p>
        )}
        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
        )}

        <form action={signIn} className="space-y-4">
          <input type="hidden" name="next" value={next ?? "/dashboard"} />
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
          <div>
            <label className="mb-1 block text-sm font-medium">비밀번호</label>
            <input
              type="password"
              name="password"
              required
              className="w-full rounded-lg border border-border px-3 py-2 outline-none focus:border-accent"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-accent hover:bg-accent-hover py-2.5 font-semibold text-white transition-colors"
          >
            로그인
          </button>
        </form>

        <p className="text-center text-sm text-muted">
          계정이 없으신가요?{" "}
          <Link href="/signup" className="font-medium text-accent hover:underline">
            30일 무료체험 시작
          </Link>
        </p>
      </div>
    </div>
  );
}
