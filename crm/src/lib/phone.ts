// 검색 결과/예약 카드 등 목록 화면에서 고객 연락처 뒷자리를 가리기 위한 헬퍼.
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "-";
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length < 7) return phone;
  const middleLen = digits.length === 11 ? 4 : 3;
  const front = digits.slice(0, digits.length - middleLen - 4);
  const last = digits.slice(-4);
  return `${front}-${"*".repeat(middleLen)}-${last}`;
}

// 예약 id(uuid)를 사람이 부르기 쉬운 짧은 예약번호로 변환.
export function reservationCode(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}
