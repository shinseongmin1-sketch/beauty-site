import Link from "next/link";
import { format } from "date-fns";
import type { SubscriptionState } from "@/lib/subscription";

/** 무료체험/구독 상태 안내. 표시 여부와 무관하게 쓰기 차단은 서버 액션과 DB(RLS)가 수행한다. */
export function subscriptionLabel(state: SubscriptionState): string | null {
  if (state.status === "trial" && state.daysLeft !== null) return `무료체험 ${state.daysLeft}일 남음`;
  if (state.status === "expired" && state.expiredReason === "payment_failed") return "결제 필요";
  return null;
}

export function SubscriptionBanner({ state, canManageBilling }: { state: SubscriptionState; canManageBilling: boolean }) {
  let tone: "info" | "blocked" | null = null;
  let title = "";
  let message = "";
  let action: { href: string; label: string } | null = null;
  const payAction = canManageBilling ? { href: "/dashboard/billing", label: "결제하기" } : null;

  if (state.awaitingPayment) {
    tone = "info";
    message = "결제일이 되어 자동결제를 처리하고 있습니다. 결제가 확인되면 바로 이용할 수 있어요. 잠시 후 다시 확인해주세요.";
  } else if (state.status === "trial" && state.daysLeft !== null && state.daysLeft <= 14) {
    tone = "info";
    const ends = state.trialEndsAt ? format(new Date(state.trialEndsAt), "yyyy.MM.dd") : "";
    message = `무료체험이 ${state.daysLeft}일 남았습니다${ends ? ` (${ends}까지)` : ""}. ` +
      (state.hasPaymentMethod
        ? "체험 종료일에 등록된 카드로 자동결제되어 이어서 이용할 수 있어요."
        : "종료 후에도 기존 데이터 조회와 내보내기는 계속 사용할 수 있어요.");
    if (canManageBilling && !state.hasPaymentMethod) action = { href: "/dashboard/billing", label: "결제수단 등록" };
  } else if (state.status === "expired") {
    tone = "blocked";
    action = payAction;
    if (state.expiredReason === "payment_failed") {
      title = "결제가 필요합니다";
      message = "결제가 완료되지 않아 CRM 이용이 제한되었습니다. 기존 데이터 조회와 내보내기는 계속 사용할 수 있고, 결제하면 바로 다시 이용할 수 있습니다.";
    } else if (state.deniedReason === "business_number_used") {
      message =
        "이 사업자등록번호로는 이미 무료체험을 이용하셨습니다. 무료체험은 사업장당 최초 1회만 제공돼요. 기존 데이터 조회와 내보내기는 사용할 수 있고, 등록·수정·삭제는 유료 구독 후 이용할 수 있습니다.";
    } else if (state.deniedReason === "phone_limit") {
      message =
        "같은 전화번호로 등록된 무료체험 한도를 넘어 무료체험이 제공되지 않았습니다. 기존 데이터 조회와 내보내기는 사용할 수 있고, 등록·수정·삭제는 유료 구독 후 이용할 수 있습니다.";
    } else {
      message =
        "이용 기간이 종료되었습니다. 기존 데이터 조회와 내보내기는 계속 사용할 수 있고, 등록·수정·삭제는 유료 구독 후 이용할 수 있습니다.";
    }
  } else if (state.status === "suspended") {
    tone = "blocked";
    message = "이용이 정지된 사업장입니다. 조회는 가능하지만 등록·수정·삭제는 제한됩니다. 고객센터에 문의해주세요.";
  } else if (state.status === "canceled") {
    tone = state.writable ? "info" : "blocked";
    message = state.writable
      ? "구독이 해지되었습니다. 남은 이용 기간이 끝나면 등록·수정·삭제가 제한됩니다."
      : "구독이 해지되어 등록·수정·삭제가 제한됩니다. 조회와 내보내기는 계속 사용할 수 있어요.";
  }

  if (!tone) return null;

  return (
    <div
      role="status"
      data-subscription-banner={state.expiredReason ?? state.status}
      className={`mb-6 flex flex-col gap-3 rounded-xl px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
        tone === "blocked" ? "bg-red-50 text-red-600" : "bg-accent-soft text-accent"
      }`}
    >
      <div>
        {title && <p className="mb-0.5 font-bold">{title}</p>}
        <p>{message}</p>
      </div>
      {action && (
        <Link
          href={action.href}
          className={`shrink-0 rounded-lg px-4 py-2 text-center font-semibold text-white ${
            tone === "blocked" ? "bg-red-500 hover:bg-red-600" : "bg-accent hover:bg-accent-hover"
          }`}
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
