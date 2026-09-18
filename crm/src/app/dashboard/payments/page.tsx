import { redirect } from "next/navigation";

// 매출/통계 메뉴는 "매출관리(매출현황/매출등록/매출내역)" 그룹으로 개편되었다.
// 기존 링크(대시보드 카드 등)를 위해 자리를 유지하고 리다이렉트만 해준다.
export default async function PaymentsRedirectPage() {
  redirect("/dashboard/sales");
}
