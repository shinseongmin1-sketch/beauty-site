import type { PaymentStatus, ReservationStatus } from "@/lib/types";

export interface StatusBadge {
  label: string;
  bg: string;
  text: string;
  dot: string;
  border: string;
}

// Tailwind는 클래스명을 소스 코드에 "글자 그대로" 있어야 인식하므로,
// 문자열 조합(bg- -> border- 치환 등)으로 만들지 않고 전부 리터럴로 나열한다.
const BLUE: Omit<StatusBadge, "label"> = {
  bg: "bg-status-blue-bg",
  text: "text-status-blue-text",
  dot: "bg-status-blue-text",
  border: "border-status-blue-text",
};
const MINT: Omit<StatusBadge, "label"> = {
  bg: "bg-status-mint-bg",
  text: "text-status-mint-text",
  dot: "bg-status-mint-text",
  border: "border-status-mint-text",
};
const ORANGE: Omit<StatusBadge, "label"> = {
  bg: "bg-status-orange-bg",
  text: "text-status-orange-text",
  dot: "bg-status-orange-text",
  border: "border-status-orange-text",
};
const GRAY: Omit<StatusBadge, "label"> = {
  bg: "bg-status-gray-bg",
  text: "text-status-gray-text",
  dot: "bg-status-gray-text",
  border: "border-status-gray-text",
};

/**
 * 예약 목록/캘린더에서 쓰는 상태 뱃지. DB 상태값 그대로가 아니라,
 * "진행중"처럼 지금 이 순간 시술 중인지(now가 start~end 사이인지)까지
 * 함께 고려해서 사람이 보기 좋은 라벨/색을 계산한다.
 */
export function getScheduleBadge(
  status: ReservationStatus,
  startTime: string | Date,
  endTime: string | Date,
  now: Date = new Date()
): StatusBadge {
  if (status === "cancelled" || status === "no_show") {
    return { label: "취소", ...GRAY };
  }
  if (status === "pending") {
    return { label: "대기", ...ORANGE };
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  if (now >= start && now <= end) {
    return { label: "진행중", ...MINT };
  }

  return { label: "예약완료", ...BLUE };
}

/** 목록형 화면(예약 관리 테이블 등)에서 쓰는, 시간과 무관한 단순 상태 뱃지. */
export function getStatusBadge(status: ReservationStatus): StatusBadge {
  switch (status) {
    case "pending":
      return { label: "대기", ...ORANGE };
    case "confirmed":
      return { label: "예약완료", ...BLUE };
    case "completed":
      return { label: "방문완료", ...MINT };
    case "cancelled":
      return { label: "취소", ...GRAY };
    case "no_show":
      return { label: "노쇼", ...GRAY };
  }
}

export function getConsultationResultBadge(result: string): StatusBadge {
  if (result === "상담완료") return { label: result, ...BLUE };
  if (result === "보류") return { label: result, ...ORANGE };
  return { label: result || "상담중", ...MINT };
}

export function getPaymentBadge(status: PaymentStatus): StatusBadge {
  switch (status) {
    case "ready":
      return { label: "결제대기", ...ORANGE };
    case "paid":
      return { label: "결제완료", ...BLUE };
    case "failed":
      return { label: "결제실패", ...GRAY };
    case "cancelled":
      return { label: "결제취소", ...GRAY };
    case "partial_cancelled":
      return { label: "부분취소", ...ORANGE };
  }
}
