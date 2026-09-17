import Link from "next/link";
import { signUp } from "./actions";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">30일 무료체험 시작</h1>
          <p className="mt-2 text-sm text-muted">
            카드 등록 없이 바로 예약관리 프로그램을 사용해보세요.
          </p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
        )}

        <form action={signUp} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">이름</label>
            <input
              type="text"
              name="full_name"
              required
              className="w-full rounded-lg border border-border px-3 py-2 outline-none focus:border-brand-purple"
              placeholder="홍길동"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">이메일</label>
            <input
              type="email"
              name="email"
              required
              className="w-full rounded-lg border border-border px-3 py-2 outline-none focus:border-brand-purple"
              placeholder="owner@example.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">비밀번호</label>
            <input
              type="password"
              name="password"
              required
              minLength={6}
              className="w-full rounded-lg border border-border px-3 py-2 outline-none focus:border-brand-purple"
              placeholder="6자 이상"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-gradient-to-r from-brand-pink to-brand-purple py-2.5 font-semibold text-white transition hover:opacity-90"
          >
            무료체험 시작하기
          </button>
        </form>

        <p className="text-center text-sm text-muted">
          이미 계정이 있으신가요?{" "}
          <Link href="/login" className="font-medium text-brand-purple hover:underline">
            로그인
          </Link>
        </p>
      </div>
    </div>
  );
}
