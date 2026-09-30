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
        {/* 모바일에서는 1줄: 로고 + 로그아웃, 2줄: 메뉴. md 이상은 기존처럼 한 줄 */}
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-8 md:h-14 md:flex-nowrap md:py-0">
          <Link href="/admin" className="order-1 flex items-center gap-2 text-[15px] font-bold">
            매니온 운영자
            <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white">PLATFORM ADMIN</span>
          </Link>
          <nav className="order-3 flex w-full items-center gap-4 text-sm text-navy-muted md:order-2 md:w-auto md:flex-1">
            <Link href="/admin" className="hover:text-white">대시보드</Link>
            <Link href="/admin/businesses" className="hover:text-white">사업장</Link>
            <Link href="/admin/audit" className="hover:text-white">감사 로그</Link>
          </nav>
          <form action={signOut} className="order-2 md:order-3">
            <button type="submit" className="text-sm text-navy-muted hover:text-white">로그아웃</button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6 md:p-8">{children}</main>
    </div>
  );
}
