// 로그인·회원가입 등 계정 화면에서 매니온 소개 홈페이지로 돌아가는 링크.
// 데스크톱 앱에서는 외부 주소라 기본 브라우저로 열린다 (desktop-app/main.js).
export const HOMEPAGE_URL = "https://manion.kr";

export function HomeLink() {
  return (
    <a
      href={HOMEPAGE_URL}
      className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-foreground"
    >
      <span aria-hidden="true">←</span> 매니온 홈으로
    </a>
  );
}
