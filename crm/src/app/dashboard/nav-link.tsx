"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);

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
