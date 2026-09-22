"use server";

import { requireBusinessContext } from "@/lib/business";
import { canAccess } from "@/lib/permissions";
import { logDataImport } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { checkFileEnvelope, parseImportCsv, type ParsedImportRow } from "@/lib/customer-import";

// 고객 CSV 가져오기: "검증(미리보기)" 과 "커밋(실제 반영)" 을 완전히 분리된 두 서버 액션으로 둔다.
//   - 둘 다 매번 같은 파일을 처음부터 다시 파싱·검증한다. 미리보기 결과를 클라이언트가
//     조작해서 커밋에 밀어 넣을 수 없다(커밋은 파일만 받고, 등급/태그 존재 여부·중복 등을 서버가 다시 확인).
//   - 실제 DB 반영은 DB 함수 import_customers() 하나로 끝난다(단일 트랜잭션, 부분 반영 없음).
//     그 함수가 auth.uid() 로 사업장/직급을 직접 확인하므로, 여기서 만드는 요청 본문에는
//     business_id 나 "이 고객을 수정하라"는 customer_id 를 아예 넣지 않는다 — 다른 사업장을
//     대상으로 지정할 방법 자체가 없다.
//   - 파일은 어디에도 저장하지 않는다(메모리에서만 읽고 응답 후 버려짐).
//   - 권한이 없거나 체험이 종료된 경우 redirect() 대신 { ok:false } 를 돌려준다
//     (모달을 열어둔 채로 오류 메시지만 보여주기 위함 — 다른 쓰기 액션들의 redirect 패턴과 의도적으로 다름).

export interface PreviewRow {
  rowNumber: number;
  name: string;
  phoneMasked: string | null;
  status: "new" | "update" | "error";
  errors: string[];
}

export type ImportPreviewResult =
  | { ok: true; totalRows: number; newCount: number; updateCount: number; errorCount: number; rows: PreviewRow[] }
  | { ok: false; error: string };

export type ImportCommitResult = { ok: true; inserted: number; updated: number } | { ok: false; error: string };

function maskForPreview(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return phone;
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

/** 사업장의 등급/태그 이름 집합을 (소문자 정규화해) 가져온다. Import 는 이 목록에 없는 이름을 자동 생성하지 않는다. */
async function loadCatalog(supabase: Awaited<ReturnType<typeof requireBusinessContext>>["supabase"], businessId: string) {
  const [{ data: grades }, { data: tags }] = await Promise.all([
    supabase.from("customer_grades").select("name").eq("business_id", businessId),
    supabase.from("customer_tags").select("name").eq("business_id", businessId),
  ]);
  return {
    gradeNames: new Set((grades ?? []).map((g) => g.name.toLowerCase())),
    tagNames: new Set((tags ?? []).map((t) => t.name.toLowerCase())),
  };
}

function validateAgainstCatalog(row: ParsedImportRow, catalog: { gradeNames: Set<string>; tagNames: Set<string> }): string[] {
  const errors: string[] = [];
  if (row.gradeName && !catalog.gradeNames.has(row.gradeName.toLowerCase())) {
    errors.push(`존재하지 않는 고객등급입니다: ${row.gradeName} (매장 설정에 먼저 등급을 만들어주세요)`);
  }
  for (const t of row.tagNames) {
    if (!catalog.tagNames.has(t.toLowerCase())) errors.push(`존재하지 않는 고객태그입니다: ${t} (매장 설정에 먼저 태그를 만들어주세요)`);
  }
  return errors;
}

async function readAndParse(formData: FormData): Promise<{ fatalError: string } | { rows: ParsedImportRow[] }> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { fatalError: "파일을 선택해주세요." };
  const envelopeError = checkFileEnvelope(file);
  if (envelopeError) return { fatalError: envelopeError };

  let text: string;
  try {
    text = await file.text();
  } catch {
    return { fatalError: "파일을 읽지 못했습니다." };
  }
  return parseImportCsv(text);
}

export async function validateCustomerImportCsv(formData: FormData): Promise<ImportPreviewResult> {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  if (!canAccess(profile.role, "dataImport")) {
    return { ok: false, error: "고객 데이터 가져오기 권한이 없습니다. 대표 또는 관리자에게 문의해주세요." };
  }
  if (!subscription.writable) {
    return { ok: false, error: "무료체험이 종료되어 고객 데이터를 가져올 수 없습니다. 기존 데이터 조회와 내보내기는 계속 사용할 수 있어요." };
  }

  const parsed = await readAndParse(formData);
  if ("fatalError" in parsed) return { ok: false, error: parsed.fatalError };

  const catalog = await loadCatalog(supabase, business.id);
  const phones = parsed.rows.map((r) => r.phone).filter((p): p is string => Boolean(p)).map((p) => p.replace(/\D/g, ""));
  const { data: existing } = phones.length
    ? await supabase.from("customers").select("phone").eq("business_id", business.id)
    : { data: [] };
  const existingDigits = new Set((existing ?? []).map((c) => (c.phone ?? "").replace(/\D/g, "")).filter(Boolean));

  const previewRows: PreviewRow[] = parsed.rows.map((row) => {
    const catalogErrors = validateAgainstCatalog(row, catalog);
    const errors = [...row.errors, ...catalogErrors];
    const digits = row.phone?.replace(/\D/g, "") ?? null;
    const status: PreviewRow["status"] = errors.length > 0 ? "error" : digits && existingDigits.has(digits) ? "update" : "new";
    return { rowNumber: row.rowNumber, name: row.name, phoneMasked: maskForPreview(row.phone), status, errors };
  });

  return {
    ok: true,
    totalRows: previewRows.length,
    newCount: previewRows.filter((r) => r.status === "new").length,
    updateCount: previewRows.filter((r) => r.status === "update").length,
    errorCount: previewRows.filter((r) => r.status === "error").length,
    rows: previewRows,
  };
}

export async function commitCustomerImportCsv(formData: FormData): Promise<ImportCommitResult> {
  const { supabase, business, profile, subscription } = await requireBusinessContext();
  if (!canAccess(profile.role, "dataImport")) {
    return { ok: false, error: "고객 데이터 가져오기 권한이 없습니다. 대표 또는 관리자에게 문의해주세요." };
  }
  if (!subscription.writable) {
    return { ok: false, error: "무료체험이 종료되어 고객 데이터를 가져올 수 없습니다." };
  }

  const parsed = await readAndParse(formData);
  if ("fatalError" in parsed) return { ok: false, error: parsed.fatalError };

  const catalog = await loadCatalog(supabase, business.id);
  const rowErrors = parsed.rows.flatMap((row) => [...row.errors, ...validateAgainstCatalog(row, catalog)]);
  if (rowErrors.length > 0) {
    // 미리보기 이후 데이터가 바뀌었거나(등급/태그 삭제 등), 미리보기를 건너뛰고 바로 커밋을 호출한 경우.
    // 오류가 하나라도 있으면 아무것도 반영하지 않는다.
    return { ok: false, error: "검증되지 않은 내용이 있어 가져오기를 중단했습니다. 미리보기를 다시 확인해주세요." };
  }

  const payload = parsed.rows.map((row) => ({
    name: row.name,
    phone: row.phone,
    memo: row.memo,
    grade_name: row.gradeName,
    tag_names: row.tagNames,
  }));

  const { data, error } = await supabase.rpc("import_customers", { p_rows: payload });

  if (error) {
    console.error("[customers] import failed", { code: error.code });
    await logDataImport({ businessId: business.id, userId: profile.id, role: profile.role }, {
      format: "csv",
      rowCount: payload.length,
      result: "failure",
    });
    const friendly = error.message?.includes("subscription_inactive")
      ? "무료체험이 종료되어 고객 데이터를 가져올 수 없습니다."
      : "가져오기에 실패했습니다. 데이터는 반영되지 않았습니다. 잠시 후 다시 시도해주세요.";
    return { ok: false, error: friendly };
  }

  const result = data as { inserted: number; updated: number };
  await logDataImport({ businessId: business.id, userId: profile.id, role: profile.role }, {
    format: "csv",
    rowCount: payload.length,
    successCount: result.inserted + result.updated,
    errorCount: 0,
  });

  revalidatePath("/dashboard/customers");
  return { ok: true, inserted: result.inserted, updated: result.updated };
}
