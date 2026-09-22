import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
