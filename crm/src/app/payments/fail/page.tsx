import Link from "next/link";

export default async function PaymentFailPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; message?: string }>;
}) {
  const { code, message } = await searchParams;

  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-2xl text-red-500">
          ✕
        </div>
        <h1 className="text-xl font-bold">결제가 취소되었습니다</h1>
        <p className="text-sm text-muted">
          {message ?? "결제가 진행되지 않았습니다."} {code ? `(${code})` : ""}
        </p>
        <Link
          href="/dashboard/reservations"
          className="inline-block rounded-lg bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-medium text-white"
        >
          예약 목록으로 돌아가기
        </Link>
      </div>
    </div>
  );
}
