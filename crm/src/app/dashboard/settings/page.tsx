import { requireBusinessContext } from "@/lib/business";
import { requireAccess } from "@/lib/permissions";
import { updateBusiness } from "./actions";

export default async function SettingsPage() {
  const { business, profile } = await requireBusinessContext();
  requireAccess(profile.role, "settings");

  return (
    <div className="max-w-xl space-y-8">
      <h1 className="text-[26px] font-bold text-foreground">매장 설정</h1>

      <form action={updateBusiness} className="space-y-4 rounded-2xl border border-border bg-card p-6">
        <h2 className="font-semibold">기본 정보</h2>
        <div>
          <label className="mb-1 block text-sm font-medium">매장 이름</label>
          <input
            name="name"
            required
            defaultValue={business.name}
            className="w-full rounded-lg border border-border px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">전화번호</label>
          <input
            name="phone"
            defaultValue={business.phone ?? ""}
            className="w-full rounded-lg border border-border px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">주소</label>
          <input
            name="address"
            defaultValue={business.address ?? ""}
            className="w-full rounded-lg border border-border px-3 py-2"
          />
        </div>

        <h2 className="pt-2 font-semibold">결제 연동 (토스페이먼츠)</h2>
        <div>
          <label className="mb-1 block text-sm font-medium">토스페이먼츠 Client Key (선택)</label>
          <input
            name="toss_client_key"
            defaultValue={business.toss_client_key ?? ""}
            placeholder="비워두면 공용 테스트 키로 결제 테스트가 진행됩니다"
            className="w-full rounded-lg border border-border px-3 py-2 font-mono text-sm"
          />
          <p className="mt-1 text-xs text-muted">
            토스페이먼츠 가맹점 심사가 끝난 뒤 발급받은 실제 Client Key를 입력하면 실결제로 전환됩니다.
          </p>
        </div>

        <h2 className="pt-2 font-semibold">네이버예약 연동 (준비중)</h2>
        <div>
          <label className="mb-1 block text-sm font-medium">네이버예약 업체 ID</label>
          <input
            name="naver_booking_id"
            defaultValue={business.naver_booking_id ?? ""}
            placeholder="네이버 파트너센터 승인 후 입력"
            className="w-full rounded-lg border border-border px-3 py-2 font-mono text-sm"
          />
          <p className="mt-1 text-xs text-muted">
            네이버예약 연동은 네이버 파트너센터의 사업자 심사·API 승인이 필요합니다. 지금은 예약
            데이터에 &ldquo;예약 경로(source)&rdquo; 필드를 미리 준비해두어, 승인 후 네이버예약에서
            들어오는 예약을 이 시스템에 자동으로 반영할 수 있도록 구조만 만들어 둔 상태입니다.
          </p>
        </div>

        <button
          type="submit"
          className="rounded-lg bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-medium text-white"
        >
          저장
        </button>
      </form>
    </div>
  );
}
