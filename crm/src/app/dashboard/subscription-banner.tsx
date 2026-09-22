import { format } from "date-fns";
import type { SubscriptionState } from "@/lib/subscription";

/** 무료체험/구독 상태 안내. 표시 여부와 무관하게 쓰기 차단은 서버 액션과 DB(RLS)가 수행한다. */
export function subscriptionLabel(state: SubscriptionState): string | null {
  if (state.status === "trial" && state.daysLeft !== null) return `무료체험 ${state.daysLeft}일 남음`;
  return null;
}

export function SubscriptionBanner({ state }: { state: SubscriptionState }) {
  let tone: "info" | "blocked" | null = null;
  let message = "";

  if (state.status === "trial" && state.daysLeft !== null && state.daysLeft <= 14) {
    tone = "info";
    const ends = state.trialEndsAt ? format(new Date(state.trialEndsAt), "yyyy.MM.dd") : "";
    message = `무료체험이 ${state.daysLeft}일 남았습니다${ends ? ` (${ends}까지)` : ""}. 종료 후에도 기존 데이터 조회와 내보내기는 계속 사용할 수 있어요.`;
  } else if (state.status === "expired") {
    tone = "blocked";
    if (state.deniedReason === "business_number_used") {
      message =
        "이 사업자등록번호로는 이미 무료체험을 이용하셨습니다. 무료체험은 사업장당 최초 1회만 제공돼요. 기존 데이터 조회와 내보내기는 사용할 수 있고, 등록·수정·삭제는 유료 구독 후 이용할 수 있습니다.";
    } else if (state.deniedReason === "phone_limit") {
      message =
        "같은 전화번호로 등록된 무료체험 한도를 넘어 무료체험이 제공되지 않았습니다. 기존 데이터 조회와 내보내기는 사용할 수 있고, 등록·수정·삭제는 유료 구독 후 이용할 수 있습니다.";
    } else {
      message =
        "무료체험이 종료되었습니다. 기존 데이터 조회와 내보내기는 계속 사용할 수 있고, 등록·수정·삭제는 유료 구독 후 이용할 수 있습니다.";
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
      className={`mb-6 rounded-xl px-4 py-3 text-sm ${
        tone === "blocked" ? "bg-red-50 text-red-600" : "bg-accent-soft text-accent"
      }`}
    >
      {message}
    </div>
  );
}
