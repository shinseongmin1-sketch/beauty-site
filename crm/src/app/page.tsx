import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// 루트 접속 시 로그인 여부에 따라 대시보드/로그인으로 보낸다.
// (마케팅 랜딩 페이지는 별도의 beauty-site 정적 사이트가 담당)
export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/dashboard" : "/login");
}
