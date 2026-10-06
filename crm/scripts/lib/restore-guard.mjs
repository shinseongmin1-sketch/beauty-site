// restore.mjs 복원 대상 확인 (순수 함수 — tests/local/restore-guard.test.mjs 가 검증).
// 환경변수를 빠뜨려 .env.test 의 보존용 테스트 프로젝트나 운영 프로젝트에 복원하는 사고를 막는다.

// 지우면 안 되는 데이터가 있는 테스트 프로젝트. --confirm 만으로는 복원하지 않고 --allow-protected-target=<ref> 를 따로 요구한다.
export const PROTECTED_TEST_REFS = ["gmnwgwtlrzlkbegalxff"];

const REF_RE = /^[a-z0-9]{20}$/;

/**
 * @param {{ targetRef: string, confirm?: unknown, allowProtected?: unknown, prodRef?: string | null, backupSourceRef?: string | null }} p
 * @returns {{ ok: true, warning?: string } | { ok: false, error: string }}
 */
export function checkRestoreTarget({ targetRef, confirm, allowProtected, prodRef = null, backupSourceRef = null }) {
  if (typeof confirm !== "string" || confirm === "") {
    return { ok: false, error: `--confirm=<복원 대상 프로젝트 ref> 가 필요합니다. 현재 대상: ${targetRef}` };
  }
  if (!REF_RE.test(confirm)) {
    return { ok: false, error: `--confirm 값이 프로젝트 ref 형식(영소문자·숫자 20자)이 아닙니다. 현재 대상: ${targetRef}` };
  }
  if (confirm !== targetRef) {
    return { ok: false, error: `--confirm=${confirm} 이(가) 실제 복원 대상(${targetRef})과 다릅니다. 환경변수(SUPABASE_TEST_*)를 확인하세요.` };
  }
  if (prodRef && targetRef === prodRef) {
    return { ok: false, error: `복원 대상(${targetRef})이 운영 프로젝트입니다. 운영 DB 에는 복원하지 않습니다.` };
  }
  if (backupSourceRef && targetRef === backupSourceRef) {
    return { ok: false, error: `복원 대상(${targetRef})이 이 백업을 만든 원본 프로젝트입니다. 원본에는 복원하지 않습니다.` };
  }
  if (PROTECTED_TEST_REFS.includes(targetRef)) {
    if (allowProtected !== targetRef) {
      return {
        ok: false,
        error: `복원 대상(${targetRef})은 보존 중인 테스트 프로젝트입니다. 정말 이 프로젝트에 복원하려면 --allow-protected-target=${targetRef} 를 함께 지정하세요.`,
      };
    }
    return { ok: true, warning: `⚠ 보존 중인 테스트 프로젝트(${targetRef})에 복원합니다 (--allow-protected-target 지정됨).` };
  }
  return { ok: true };
}
