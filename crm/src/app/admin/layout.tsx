import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { signOut } from "../dashboard/actions";

// 매니온 서비스 운영자 전용 영역. 매장 CRM(/dashboard)과 분리된 별도 레이아웃이며,
// 플랫폼 관리자(platform_admins)만 들어올 수 있다. 일반 사용자에게는 404 로 응답한다.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();

  return (
    <div className="flex min-h-full flex-1 flex-col bg-background">
      <header className="bg-navy text-white">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-8">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="flex items-center gap-2 text-[15px] font-bold">
              매니온 운영자
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white">PLATFORM ADMIN</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-navy-muted">
              <Link href="/admin" className="hover:text-white">대시보드</Link>
              <Link href="/admin/businesses" className="hover:text-white">사업장</Link>
              <Link href="/admin/audit" className="hover:text-white">감사 로그</Link>
            </nav>
          </div>
          <form action={signOut}>
            <button type="submit" className="text-sm text-navy-muted hover:text-white">로그아웃</button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-8">{children}</main>
    </div>
  );
}
