"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({
  href,
  icon,
  children,
  exact,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = href === "/dashboard" || exact ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors ${
        active
          ? "bg-accent text-white"
          : "text-navy-muted hover:bg-white/[0.06] hover:text-white"
      }`}
    >
      <span className="shrink-0 [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
      {children}
    </Link>
  );
}

// 예약관리 / 고객관리처럼 여러 하위 메뉴를 묶는 그룹. 그룹명 자체도
// 링크라서 클릭하면 대표 화면(예: 예약관리 목록)으로 이동한다.
export function NavGroup({
  href,
  icon,
  label,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const groupActive = pathname.startsWith(href);

  return (
    <div className="space-y-0.5">
      <Link
        href={href}
        className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors ${
          groupActive ? "text-white" : "text-navy-muted hover:text-white"
        }`}
      >
        <span className="shrink-0 [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
        {label}
      </Link>
      <div className="space-y-0.5 border-l border-white/10 pl-3.5">{children}</div>
    </div>
  );
}

export function SubNavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href;

  return (
    <Link
      href={href}
      className={`block rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
        active
          ? "bg-accent text-white"
          : "text-navy-muted hover:bg-white/[0.06] hover:text-white"
      }`}
    >
      {children}
    </Link>
  );
}
