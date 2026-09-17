import { requireBusinessContext } from "@/lib/business";
import { NavLink } from "./nav-link";
import { signOut } from "./actions";

const NAV = [
  { href: "/dashboard", label: "홈" },
  { href: "/dashboard/reservations", label: "예약" },
  { href: "/dashboard/customers", label: "고객" },
  { href: "/dashboard/staff", label: "직원" },
  { href: "/dashboard/services", label: "시술/메뉴" },
  { href: "/dashboard/payments", label: "결제내역" },
  { href: "/dashboard/settings", label: "매장 설정" },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { business, profile } = await requireBusinessContext();

  return (
    <div className="flex min-h-full flex-1">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card p-4">
        <div className="mb-6 px-2">
          <p className="text-lg font-bold">{business.name}</p>
          <p className="text-xs text-muted">{profile.full_name ?? "관리자"}</p>
        </div>
        <nav className="flex-1 space-y-1">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <form action={signOut}>
          <button
            type="submit"
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-black/5"
          >
            로그아웃
          </button>
        </form>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
