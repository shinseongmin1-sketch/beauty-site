// 화면에서 받은 날짜("2026-10-22")와 시각("10:00")을 한국 시간 기준 시점으로 바꾼다.
// 서버 시간대 설정과 상관없이 항상 같은 결과가 나오도록 +09:00을 명시한다. (한국은 서머타임 없음)
export function kstDateTime(date: string, time = "00:00"): Date {
  return new Date(`${date}T${time}:00+09:00`);
}
