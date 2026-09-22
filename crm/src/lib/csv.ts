// 최소 CSV 인코더/디코더 (RFC4180 수준). 컬럼이 몇 개 안 되는 고객 Import/Export 전용이라
// 외부 라이브러리 없이 직접 구현한다.
//
// 인코딩: 쉼표/따옴표/개행이 든 값은 큰따옴표로 감싸고 내부 따옴표는 두 배로 이스케이프한다.
//   CSV formula injection 방지: 값이 =,+,-,@ 로 시작하면 앞에 작은따옴표(')를 붙여 Excel/Sheets 가
//   수식이 아닌 순수 텍스트로 읽도록 만든다(OWASP CSV Injection 권고 방식).
// 디코딩: 따옴표 안의 쉼표/개행을 올바르게 처리하는 상태 기반 파서. UTF-8 BOM 은 무시한다.
//   구조가 깨진 CSV(닫히지 않은 따옴표)는 예외를 던진다 — 호출자가 "파일 형식 오류"로 안내해야 한다.

const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/** 내보내기 시 셀 값이 수식으로 해석되지 않도록 위험한 접두문자를 무력화한다. */
export function neutralizeFormula(value: string): string {
  return FORMULA_PREFIXES.some((p) => value.startsWith(p)) ? `'${value}` : value;
}

/** 가져오기 시 셀 값이 수식 형태인지 검사한다 (신뢰할 수 없는 CSV로부터 값을 저장하기 전 검사용). */
export function looksLikeFormula(value: string): boolean {
  return FORMULA_PREFIXES.some((p) => value.startsWith(p));
}

function encodeCell(raw: string): string {
  const value = neutralizeFormula(raw);
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function encodeCsv(rows: string[][]): string {
  return rows.map((row) => row.map(encodeCell).join(",")).join("\r\n") + "\r\n";
}

export class CsvStructureError extends Error {}

/** CSV 텍스트를 문자열 2차원 배열로 파싱한다. 완전히 빈 줄(필드가 전부 빈 문자열)은 건너뛴다. */
export function decodeCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // UTF-8 BOM 제거
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let sawAnyChar = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((v) => v !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    sawAnyChar = true;
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
      continue;
    }
    if (c === '"' && cell === "") {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      endCell();
    } else if (c === "\r") {
      // 개행은 \n 에서만 처리 (\r\n, \n 모두 지원)
    } else if (c === "\n") {
      endRow();
    } else {
      cell += c;
    }
  }
  if (inQuotes) throw new CsvStructureError("닫히지 않은 따옴표가 있습니다.");
  if (sawAnyChar && (cell !== "" || row.length > 0)) endRow();
  return rows;
}
