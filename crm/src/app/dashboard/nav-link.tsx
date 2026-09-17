"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
        active
          ? "bg-gradient-to-r from-brand-pink to-brand-purple text-white"
          : "text-foreground/80 hover:bg-black/5"
      }`}
    >
      {children}
    </Link>
  );
}
