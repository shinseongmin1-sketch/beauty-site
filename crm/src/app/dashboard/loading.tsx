// 대시보드 하위 아무 페이지로 이동해도 뜨는 공용 로딩 스켈레톤.
// 서버에서 새 화면을 만드는 동안 클릭한 그 순간 바로 뭔가 바뀌어 보이도록
// 하는 용도 — Next.js가 이 파일을 자동으로 Suspense fallback으로 써준다.
function Block({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-2xl bg-border/60 ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Block className="h-7 w-56" />
        <Block className="h-4 w-72" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Block key={i} className="h-[104px]" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        <Block className="h-[420px]" />
        <div className="space-y-6">
          <Block className="h-[72px]" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Block key={i} className="h-[86px]" />
            ))}
          </div>
          <Block className="h-[220px]" />
        </div>
      </div>
    </div>
  );
}
