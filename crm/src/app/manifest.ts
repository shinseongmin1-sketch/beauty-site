import type { MetadataRoute } from "next";

// 스마트폰·태블릿에서 "홈 화면에 추가"하면 매니온 아이콘이 생기고,
// 누르면 주소창 없이 앱처럼 전체 화면으로 열리게 하는 설정 (/manifest.webmanifest 로 제공).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "매니온 예약관리",
    short_name: "매니온",
    description: "예약과 고객관리를 한곳에서",
    lang: "ko",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f6f8fc",
    theme_color: "#f6f8fc",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
