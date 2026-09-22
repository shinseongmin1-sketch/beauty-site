"use server";

import { requireBusinessContext } from "@/lib/business";
import { canAccess } from "@/lib/permissions";
import { logDataExport } from "@/lib/audit";
import { encodeCsv } from "@/lib/csv";
import { CSV_HEADERS } from "@/lib/customer-import";

export type ExportCustomersResult = { ok: true; csv: string; filename: string } | { ok: false; error: string };

/**
 * 고객 목록을 CSV 로 내보낸다. 화면에 이미 그려진 목록을 그대로 믿지 않고 서버가 DB 에서
 * 다시 조회한다(사업장 격리를 서버가 보장). 체험 종료 후에도 조회/내보내기는 허용되므로
 * requireWritable() 은 호출하지 않는다.
 *
 * 이 액션은 값을 반환해 클라이언트가 Blob 다운로드를 트리거하는 방식이라, 권한이 없을 때도
 * redirect() 대신 { ok:false } 를 돌려준다(모달/버튼을 그대로 둔 채 오류만 보여주기 위함).
 */
export async function exportCustomersCsv(filters: {
  gradeId?: string | null;
  tagId?: string | null;
}): Promise<ExportCustomersResult> {
  const { supabase, business, profile } = await requireBusinessContext();

  if (!canAccess(profile.role, "dataExport")) {
    return { ok: false, error: "고객 데이터 내보내기 권한이 없습니다. 대표 또는 관리자에게 문의해주세요." };
  }

  // 태그는 다대다 관계라 select 조인 필터의 동작이 불확실하므로, 대상 고객 id 를 먼저 명시적으로 구한다.
  let allowedIds: string[] | null = null;
  if (filters.tagId) {
    const { data: links, error: linkError } = await supabase
      .from("customer_tag_links")
      .select("customer_id")
      .eq("business_id", business.id)
      .eq("tag_id", filters.tagId);
    if (linkError) {
      console.error("[customers] export tag filter failed", linkError.code);
      return { ok: false, error: "고객 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." };
    }
    allowedIds = (links ?? []).map((l) => l.customer_id);
    if (allowedIds.length === 0) {
      await logDataExport({ businessId: business.id, userId: profile.id, role: profile.role }, "customer", { format: "csv", rowCount: 0 });
      const stamp = new Date().toISOString().slice(0, 10);
      return { ok: true, csv: encodeCsv([[...CSV_HEADERS]]), filename: `customers-${stamp}.csv` };
    }
  }

  let query = supabase
    .from("customers")
    .select("name, phone, memo, created_at, grade:customer_grades(name), customer_tag_links(tag:customer_tags(name))")
    .eq("business_id", business.id)
    .order("created_at", { ascending: false });

  if (filters.gradeId) query = query.eq("grade_id", filters.gradeId);
  if (allowedIds) query = query.in("id", allowedIds);

  const { data, error } = await query.returns<
    {
      name: string;
      phone: string | null;
      memo: string | null;
      created_at: string;
      grade: { name: string } | null;
      customer_tag_links: { tag: { name: string } | null }[];
    }[]
  >();

  if (error) {
    console.error("[customers] export query failed", error.code);
    await logDataExport({ businessId: business.id, userId: profile.id, role: profile.role }, "customer", {
      format: "csv",
      rowCount: 0,
      result: "failure",
    });
    return { ok: false, error: "고객 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해주세요." };
  }

  const rows = data ?? [];

  const table: string[][] = [
    [...CSV_HEADERS],
    ...rows.map((c) => [
      c.name,
      c.phone ?? "",
      c.memo ?? "",
      c.grade?.name ?? "",
      c.customer_tag_links.map((l) => l.tag?.name).filter(Boolean).join(";"),
      c.created_at.slice(0, 10),
    ]),
  ];

  await logDataExport({ businessId: business.id, userId: profile.id, role: profile.role }, "customer", {
    format: "csv",
    rowCount: rows.length,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return { ok: true, csv: encodeCsv(table), filename: `customers-${stamp}.csv` };
}
