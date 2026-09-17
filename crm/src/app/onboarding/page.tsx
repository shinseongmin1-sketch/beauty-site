import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createBusiness } from "./actions";

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("business_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.business_id) {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">매장 정보를 입력해주세요</h1>
          <p className="mt-2 text-sm text-muted">
            마지막 단계예요. 매장 정보를 등록하면 바로 예약관리를 시작할 수 있어요.
          </p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>
        )}

        <form action={createBusiness} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">매장 이름</label>
            <input
              type="text"
              name="name"
              required
              className="w-full rounded-lg border border-border px-3 py-2 outline-none focus:border-accent"
              placeholder="예: 뷰티살롱 강남점"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">전화번호</label>
            <input
              type="tel"
              name="phone"
              className="w-full rounded-lg border border-border px-3 py-2 outline-none focus:border-accent"
              placeholder="02-1234-5678"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">주소</label>
            <input
              type="text"
              name="address"
              className="w-full rounded-lg border border-border px-3 py-2 outline-none focus:border-accent"
              placeholder="서울특별시 강남구 ..."
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-accent hover:bg-accent-hover py-2.5 font-semibold text-white transition-colors"
          >
            시작하기
          </button>
        </form>
      </div>
    </div>
  );
}
