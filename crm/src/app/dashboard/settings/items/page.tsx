import Link from "next/link";
import { requireBusinessContext } from "@/lib/business";
import { requireAccess } from "@/lib/permissions";
import { IconLayers, IconTag, IconUsers, IconMessage, IconWallet } from "../../icons";

const ITEMS = [
  {
    href: "/dashboard/reservations/groups",
    icon: IconLayers,
    title: "예약그룹",
    description: "예약을 구분하기 위한 그룹 (신규고객, VIP 등 매장에 맞게 직접 추가)",
  },
  {
    href: "/dashboard/reservations/types",
    icon: IconTag,
    title: "예약타입",
    description: "예약이 어떤 경로로 들어왔는지 구분하는 타입",
  },
  {
    href: "/dashboard/customers/grades",
    icon: IconUsers,
    title: "고객등급",
    description: "고객을 등급별로 구분 (VIP, 단골 등 매장에 맞게 직접 추가)",
  },
  {
    href: "/dashboard/customers/tags",
    icon: IconUsers,
    title: "고객태그",
    description: "고객 한 명에게 여러 개를 동시에 붙일 수 있는 태그",
  },
  {
    href: "/dashboard/consultations/types",
    icon: IconMessage,
    title: "상담유형",
    description: "상담 내용을 구분하는 유형",
  },
  {
    href: "/dashboard/services",
    icon: IconTag,
    title: "서비스/메뉴",
    description: "매장에서 제공하는 시술/상품 메뉴",
  },
  {
    href: "/dashboard/sales/methods",
    icon: IconWallet,
    title: "결제방법",
    description: "카드/현금/계좌이체는 기본 제공, 필요하면 직접 추가",
  },
];

export default async function ItemManagementPage() {
  const { profile } = await requireBusinessContext();
  requireAccess(profile.role, "settings");

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-[26px] font-bold text-foreground">항목 관리</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          시스템은 기본값을 강제하지 않습니다. 매장 운영에 필요한 분류를 이곳에서 직접 추가/수정/사용 중지할 수
          있습니다.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-background"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
              <item.icon className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-foreground">{item.title}</span>
              <span className="mt-0.5 block text-xs text-muted">{item.description}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
