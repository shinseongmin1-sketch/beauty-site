// 백업/복원 스크립트 공용: PostgREST 로 테이블 전체를 빠짐없이 읽고, 복원 결과를 기본키로 대조한다.
// fetch 를 인자로 받는 순수 함수만 둔다 (tests/local/backup-tables.test.mjs 가 가짜 서버로 검증).

/** Content-Range 헤더("0-999/1234" 또는 "*\/0")에서 전체 행 수를 읽는다. */
export function totalFromContentRange(value) {
  const total = Number(String(value ?? "").split("/")[1]);
  return Number.isInteger(total) && total >= 0 ? total : null;
}

const keyOf = (row, pk) => JSON.stringify(pk.map((c) => row[c]));

/**
 * 테이블 전체를 기본키 순서로 끊어 읽는다.
 *  - 정렬을 기본키(유일값)로만 하므로 같은 created_at 행이 페이지 경계에서 중복/누락되지 않는다.
 *  - 매 요청에서 서버의 정확한 전체 행 수(count=exact)를 받아, 받은 행 수가 그와 같을 때까지 읽는다
 *    → 서버 Max Rows 가 pageSize 보다 작아도 중간에 멈추지 않는다.
 *  - 읽는 도중 전체 행 수가 바뀌거나(동시 쓰기), 받은 행 수가 다르거나, 기본키가 중복되면 예외 → 백업 중단.
 */
export async function fetchAllRows({ url, headers, table, pk, pageSize = 1000, fetchImpl = fetch }) {
  const order = pk.map((c) => `${c}.asc`).join(",");
  const rows = [];
  let expectedTotal = null;
  for (;;) {
    const from = rows.length;
    const res = await fetchImpl(`${url}/rest/v1/${table}?select=*&order=${order}`, {
      headers: { ...headers, Range: `${from}-${from + pageSize - 1}`, "Range-Unit": "items", Prefer: "count=exact" },
    });
    if (!res.ok) throw new Error(`${table} 조회 실패 (${res.status})`);
    const total = totalFromContentRange(res.headers.get("content-range"));
    if (total === null) throw new Error(`${table}: 전체 행 수(Content-Range)를 확인할 수 없습니다.`);
    if (expectedTotal === null) expectedTotal = total;
    else if (total !== expectedTotal) {
      throw new Error(`${table}: 백업 도중 행 수가 바뀌었습니다 (${expectedTotal} → ${total}). 쓰기가 없는 시간에 다시 실행하세요.`);
    }
    const part = await res.json();
    rows.push(...part);
    if (rows.length >= expectedTotal) break;
    if (part.length === 0) throw new Error(`${table}: ${expectedTotal}행 중 ${rows.length}행만 받았습니다 (응답이 비어 있음).`);
  }
  if (rows.length !== expectedTotal) {
    throw new Error(`${table}: 받은 행 수(${rows.length})가 서버 행 수(${expectedTotal})와 다릅니다.`);
  }
  const keys = new Set(rows.map((r) => keyOf(r, pk)));
  if (keys.size !== rows.length) throw new Error(`${table}: 기본키가 중복된 행을 받았습니다 (${rows.length - keys.size}건).`);
  return rows;
}

const quote = (v) => `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/**
 * 백업한 행들의 기본키가 대상 DB 에 모두 있는지 확인하고, 없는 행 수를 돌려준다.
 * (대상 DB 에 원래 다른 행이 있어도 "복원돼야 할 행이 빠졌는지"를 정확히 알 수 있다)
 */
export async function countMissingKeys({ url, headers, table, pk, rows, chunkSize = 100, fetchImpl = fetch }) {
  let missing = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const filter =
      pk.length === 1
        ? `${pk[0]}=in.(${chunk.map((r) => quote(r[pk[0]])).join(",")})`
        : `or=(${chunk.map((r) => `and(${pk.map((c) => `${c}.eq.${quote(r[c])}`).join(",")})`).join(",")})`;
    const res = await fetchImpl(`${url}/rest/v1/${table}?select=${pk.join(",")}&${filter}`, {
      headers: { ...headers, Range: `0-${chunkSize - 1}`, "Range-Unit": "items" },
    });
    if (!res.ok) throw new Error(`${table} 복원 대조 실패 (${res.status})`);
    const found = new Set((await res.json()).map((r) => keyOf(r, pk)));
    missing += chunk.filter((r) => !found.has(keyOf(r, pk))).length;
  }
  return missing;
}
