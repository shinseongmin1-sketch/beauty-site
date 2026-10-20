import type { NextConfig } from "next";

// 모든 화면에 붙이는 보안 헤더.
// - 다른 사이트가 CRM 화면을 몰래 틀(iframe) 안에 넣어 클릭을 유도하는 공격(클릭재킹)을 막는다.
// - 브라우저가 파일 형식을 임의로 추측해 실행하지 않게 한다.
// - 결제 완료 주소 같은 내부 주소(쿼리 포함)가 외부 사이트로 전달되지 않게 한다.
// - 카메라·마이크·위치 권한은 쓰지 않으므로 아예 막는다.
// 토스 결제창은 CRM 화면 안에 토스 화면을 넣는 방식이라 frame-ancestors 제한과 무관하다.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    // 고객 CSV Import 는 서버 액션으로 파일을 받는다. 기본 1MB 로는 2MB 파일 정책과 안 맞아 올린다.
    // Next 의 bodySizeLimit 은 10진수 MB(2mb=2,000,000바이트)로 해석되고 multipart 오버헤드도 포함되므로,
    // 실제 파일 크기 한도(lib/customer-import.ts 의 MAX_IMPORT_FILE_BYTES=2×1024×1024)보다 여유 있게 잡아서
    // "파일이 커서" 라는 친절한 오류가 Next 의 raw 한도가 아니라 항상 우리 검사에서 먼저 나오게 한다.
    serverActions: {
      bodySizeLimit: "3mb",
    },
  },
};

export default nextConfig;
