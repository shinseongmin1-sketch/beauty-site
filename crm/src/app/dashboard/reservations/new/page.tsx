import { redirect } from "next/navigation";

// 예약 등록은 이제 예약관리 화면의 모달에서 처리한다. 기존 경로로 들어오는
// 링크(대시보드 바로가기 등)를 위해 자리를 유지하고 리다이렉트만 해준다.
export default async function NewReservationRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  redirect(`/dashboard/reservations?new=1${date ? `&date=${date}` : ""}`);
}
