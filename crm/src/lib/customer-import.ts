// 고객 CSV Import/Export 공용 상수와 순수 검증 함수.
// DB 접근이 필요한 부분(등급/태그 존재 확인, 기존 고객 매칭)은 여기 넣지 않고
// 호출하는 서버 액션(import-actions.ts)에서 처리한다 — 이 파일은 항상 같은 입력에
// 같은 결과를 내는 순수 함수만 둔다.
import { CsvStructureError, decodeCsv, looksLikeFormula } from "./csv";

// Export 가 쓰는 순서와 이름이 곧 Import 가 인식하는 헤더다. "정확히 일치하는 헤더만 허용" —
// Export → (필요하면 수정) → Import 왕복이 기본 시나리오다.
export const CSV_HEADERS = ["이름", "연락처", "메모", "고객등급", "고객태그", "등록일"] as const;
const REQUIRED_HEADERS = ["이름"] as const;
// "등록일"은 CSV_HEADERS 에 포함돼 있어 헤더 검사는 통과하지만(왕복 시나리오),
// 시스템이 채우는 값이라 아래 파싱에서 이 컬럼의 셀 값은 읽지 않는다(가져오기 대상 아님).

export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024; // 2MB
export const MAX_IMPORT_ROWS = 2000;
const ACCEPTED_MIME_TYPES = new Set(["", "text/csv", "application/csv", "application/vnd.ms-excel", "text/plain"]);

export interface ParsedImportRow {
  rowNumber: number; // 1부터, 헤더 다음 줄이 1
  name: string;
  phone: string | null; // 원본 표기(정규화는 DB 함수가 한다). null = 입력 없음
  memo: string | null;
  gradeName: string | null;
  tagNames: string[];
  errors: string[];
}

export interface ParsedImportFile {
  rows: ParsedImportRow[];
}

/** 파일 자체를 시도하기도 전에 걸러내는 오류(형식/크기/행수). 성공하면 null. */
export function checkFileEnvelope(file: { size: number; type: string; name: string }): string | null {
  if (!file.name.toLowerCase().endsWith(".csv")) return "CSV 파일(.csv)만 업로드할 수 있습니다.";
  if (!ACCEPTED_MIME_TYPES.has(file.type)) return "CSV 파일 형식이 아닙니다.";
  if (file.size === 0) return "빈 파일입니다.";
  if (file.size > MAX_IMPORT_FILE_BYTES) return `파일 크기는 ${MAX_IMPORT_FILE_BYTES / 1024 / 1024}MB 이하만 가능합니다.`;
  return null;
}

function normalizePhoneDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 11 ? digits : null;
}

/** CSV 텍스트를 구조 검사 + 헤더 검사 + 행별 형식 검사까지 수행한다 (등급/태그 존재 여부는 제외). */
export function parseImportCsv(text: string): { fatalError: string } | ParsedImportFile {
  let table: string[][];
  try {
    table = decodeCsv(text);
  } catch (e) {
    if (e instanceof CsvStructureError) return { fatalError: `CSV 형식이 올바르지 않습니다: ${e.message}` };
    return { fatalError: "CSV 형식이 올바르지 않습니다." };
  }
  if (table.length === 0) return { fatalError: "빈 파일입니다." };

  const header = table[0].map((h) => h.trim());
  const missing = REQUIRED_HEADERS.filter((h) => !header.includes(h));
  if (missing.length > 0) return { fatalError: `필수 컬럼이 없습니다: ${missing.join(", ")}` };
  const unknown = header.filter((h) => !(CSV_HEADERS as readonly string[]).includes(h));
  if (unknown.length > 0) {
    return { fatalError: `알 수 없는 컬럼입니다: ${unknown.join(", ")} (컬럼명을 정확히 맞춰주세요. 이 프로그램에서 내보낸 CSV 형식을 사용해주세요.)` };
  }
  const dupHeader = header.filter((h, i) => header.indexOf(h) !== i);
  if (dupHeader.length > 0) return { fatalError: `컬럼이 중복되었습니다: ${[...new Set(dupHeader)].join(", ")}` };

  const dataRows = table.slice(1);
  if (dataRows.length === 0) return { fatalError: "가져올 데이터가 없습니다." };
  if (dataRows.length > MAX_IMPORT_ROWS) return { fatalError: `한 번에 최대 ${MAX_IMPORT_ROWS}행까지 가져올 수 있습니다. (${dataRows.length}행)` };

  const idx = (name: string) => header.indexOf(name);
  const iName = idx("이름");
  const iPhone = idx("연락처");
  const iMemo = idx("메모");
  const iGrade = idx("고객등급");
  const iTags = idx("고객태그");

  const rows: ParsedImportRow[] = dataRows.map((cells, i) => {
    const rowNumber = i + 1;
    const errors: string[] = [];
    const get = (colIdx: number) => (colIdx === -1 ? "" : (cells[colIdx] ?? "").trim());

    if (cells.length !== header.length) errors.push("컬럼 수가 헤더와 일치하지 않습니다.");

    const name = get(iName);
    if (!name) errors.push("이름이 비어 있습니다.");
    else if (looksLikeFormula(name)) errors.push("이름에 허용되지 않는 문자(수식 형식)가 있습니다.");

    const phoneRaw = get(iPhone);
    let phone: string | null = null;
    if (phoneRaw) {
      if (normalizePhoneDigits(phoneRaw) === null) errors.push("연락처 형식이 올바르지 않습니다.");
      else phone = phoneRaw;
    }

    const memoRaw = get(iMemo);
    if (memoRaw && looksLikeFormula(memoRaw)) errors.push("메모에 허용되지 않는 문자(수식 형식)가 있습니다.");
    const memo = memoRaw || null;

    const gradeRaw = get(iGrade);
    if (gradeRaw && looksLikeFormula(gradeRaw)) errors.push("고객등급에 허용되지 않는 문자(수식 형식)가 있습니다.");
    const gradeName = gradeRaw || null;

    const tagsRaw = get(iTags);
    const tagNames = tagsRaw
      .split(";")
      .map((t) => t.trim())
      .filter(Boolean);
    for (const t of tagNames) if (looksLikeFormula(t)) errors.push(`고객태그(${t})에 허용되지 않는 문자(수식 형식)가 있습니다.`);

    return { rowNumber, name, phone, memo, gradeName, tagNames, errors };
  });

  // 같은 파일 안에서 전화번호가 중복되면 어느 값을 기준으로 삼을지 애매하므로 자동 처리하지 않고 오류로 표시한다.
  const seen = new Map<string, number[]>();
  rows.forEach((r) => {
    if (!r.phone) return;
    const digits = normalizePhoneDigits(r.phone);
    if (!digits) return;
    seen.set(digits, [...(seen.get(digits) ?? []), r.rowNumber]);
  });
  for (const [, rowNumbers] of seen) {
    if (rowNumbers.length > 1) {
      for (const r of rows) if (rowNumbers.includes(r.rowNumber)) r.errors.push(`같은 파일 안에 동일한 연락처가 ${rowNumbers.length}번 있습니다. (${rowNumbers.join(", ")}행)`);
    }
  }

  return { rows };
}
