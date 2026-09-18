import { requireBusinessContext } from "@/lib/business";
import { canAccess } from "@/lib/permissions";
import { NavLink, NavGroup, SubNavLink } from "./nav-link";
import { DashboardHeader } from "./header";
import { signOut } from "./actions";
import {
  IconHome,
  IconCalendar,
  IconClock,
  IconUsers,
  IconTag,
  IconChart,
  IconSettings,
  IconMessage,
} from "./icons";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { business, profile } = await requireBusinessContext();
  const displayName = profile.full_name || "관리자";
  const initial = displayName.trim().charAt(0) || "관";
  const role = profile.role;

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
          <NavLink href="/dashboard" icon={<IconHome />} exact>
            대시보드
          </NavLink>

          {canAccess(role, "reservations") && (
            <NavGroup href="/dashboard/reservations" icon={<IconCalendar />} label="예약관리">
              <SubNavLink href="/dashboard/reservations">예약관리</SubNavLink>
              <SubNavLink href="/dashboard/reservations/search">예약고객 검색</SubNavLink>
              <SubNavLink href="/dashboard/reservations/groups">예약그룹</SubNavLink>
              <SubNavLink href="/dashboard/reservations/types">예약타입</SubNavLink>
              {canAccess(role, "staffAdmin") && <SubNavLink href="/dashboard/staff">담당자</SubNavLink>}
            </NavGroup>
          )}

          <NavLink href="/dashboard/schedule" icon={<IconClock />}>
            일정 관리
          </NavLink>

          {canAccess(role, "customers") && (
            <NavGroup href="/dashboard/customers" icon={<IconUsers />} label="고객관리">
              <SubNavLink href="/dashboard/customers">고객조회</SubNavLink>
              {canAccess(role, "revisit") && <SubNavLink href="/dashboard/customers/revisit">재방문 관리</SubNavLink>}
              <SubNavLink href="/dashboard/consultations">상담관리</SubNavLink>
              <SubNavLink href="/dashboard/customers/history">고객이력</SubNavLink>
            </NavGroup>
          )}

          <NavLink href="/dashboard/services" icon={<IconTag />}>
            시술/메뉴
          </NavLink>

          {canAccess(role, "sales") && (
            <NavGroup href="/dashboard/sales" icon={<IconChart />} label="매출관리">
              <SubNavLink href="/dashboard/sales">매출현황</SubNavLink>
              <SubNavLink href="/dashboard/sales/new">매출등록</SubNavLink>
              <SubNavLink href="/dashboard/sales/history">매출내역</SubNavLink>
              <SubNavLink href="/dashboard/sales/methods">결제방법</SubNavLink>
            </NavGroup>
          )}

          {canAccess(role, "marketing") && (
            <NavGroup href="/dashboard/marketing" icon={<IconMessage />} label="마케팅">
              <SubNavLink href="/dashboard/marketing">문자/알림</SubNavLink>
            </NavGroup>
          )}

          {canAccess(role, "settings") && (
            <NavGroup href="/dashboard/settings" icon={<IconSettings />} label="설정">
              <SubNavLink href="/dashboard/settings/notifications">알림 설정</SubNavLink>
              <SubNavLink href="/dashboard/staff">직원/권한 관리</SubNavLink>
              <SubNavLink href="/dashboard/settings">기본 설정</SubNavLink>
              <SubNavLink href="/dashboard/settings/items">항목 관리</SubNavLink>
            </NavGroup>
          )}
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
