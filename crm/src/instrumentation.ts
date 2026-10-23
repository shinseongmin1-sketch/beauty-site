// 서버 시작 시 한 번 실행된다 (Next.js instrumentation).
// Vercel 서버의 기본 시간대는 UTC라서, "10:00" 같은 입력이 한국 시간 19:00으로 저장되고
// 오늘/이번 달 같은 날짜 계산도 한국 날짜와 어긋났다. 매장은 모두 한국에 있으므로
// 서버 전체의 시간대를 한국(Asia/Seoul)으로 고정한다. (Node는 실행 중 TZ 변경을 바로 반영한다)
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.env.TZ = "Asia/Seoul";
  }
}
