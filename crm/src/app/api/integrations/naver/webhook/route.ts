// 네이버예약 연동 자리(placeholder).
//
// 네이버예약 파트너 API는 사업자 등록 + 네이버 파트너센터의 심사/승인이 필요해서
// 지금 당장은 실제 연동을 붙일 수 없다. 대신 나중에 승인이 나면 이 라우트에서
// 네이버예약 웹훅(신규 예약/변경/취소 알림)을 받아 reservations 테이블에
// source: 'naver', external_id: <네이버 예약 ID> 로 upsert 하면 된다.
//
// DB 스키마(reservations.source, reservations.external_id)는 이미 준비되어 있으므로
// 실제 연동 시 이 파일의 TODO 부분만 채우면 된다.
import { NextResponse } from "next/server";

export async function POST() {
  // TODO: 네이버 파트너센터 API 승인 후
  // 1) 서명/시크릿 검증
  // 2) payload에서 예약자/시간/메뉴 정보를 파싱
  // 3) supabase(createAdminClient)로 customers/reservations upsert (source: 'naver')
  return NextResponse.json(
    { ok: false, message: "네이버예약 연동 준비중입니다." },
    { status: 501 }
  );
}
