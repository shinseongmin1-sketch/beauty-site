import { requireBusinessContext } from "@/lib/business";
import { NavLink } from "./nav-link";
import { DashboardHeader } from "./header";
import { signOut } from "./actions";
import {
  IconHome,
  IconCalendar,
  IconClock,
  IconUsers,
  IconUserGroup,
  IconTag,
  IconChart,
  IconSettings,
} from "./icons";

const NAV = [
  { href: "/dashboard", label: "홈", icon: <IconHome /> },
  { href: "/dashboard/reservations", label: "예약 관리", icon: <IconCalendar /> },
  { href: "/dashboard/schedule", label: "일정 관리", icon: <IconClock /> },
  { href: "/dashboard/customers", label: "고객 관리", icon: <IconUsers /> },
  { href: "/dashboard/staff", label: "직원 관리", icon: <IconUserGroup /> },
  { href: "/dashboard/services", label: "시술/메뉴", icon: <IconTag /> },
  { href: "/dashboard/payments", label: "매출/통계", icon: <IconChart /> },
  { href: "/dashboard/settings", label: "설정", icon: <IconSettings /> },
];

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { business, profile } = await requireBusinessContext();
  const displayName = profile.full_name || "관리자";
  const initial = displayName.trim().charAt(0) || "관";

  return (
    <div className="flex min-h-full flex-1">
      <aside className="flex w-60 shrink-0 flex-col bg-navy text-white">
        <div className="flex items-center gap-2.5 px-6 pb-5 pt-7">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent">
            <IconCalendar className="h-5 w-5 text-white" />
          </span>
          <div className="leading-tight">
            <p className="text-[15px] font-bold text-white">예약프로그램</p>
            <p className="text-[11px] text-navy-muted">간편한 예약, 더 나은 하루</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1.5 px-4 py-2">
          {NAV.map((item) => (
            <NavLink key={item.href} href={item.href} icon={item.icon}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/10 px-4 py-4">
          <div className="mb-3 flex items-center gap-2.5 rounded-xl px-2 py-1.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">
              {initial}
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-medium text-white">{displayName}</p>
              <p className="truncate text-[11px] text-navy-muted">{business.name}</p>
            </div>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="w-full rounded-xl px-3 py-2 text-left text-sm text-navy-muted transition-colors hover:bg-white/[0.06] hover:text-white"
            >
              로그아웃
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardHeader businessName={business.name} />
        <main className="flex-1 overflow-y-auto bg-background p-8">{children}</main>
      </div>
    </div>
  );
}
