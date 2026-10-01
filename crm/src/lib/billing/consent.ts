// 자동결제 동의 문구 버전. DB(subscriptions.auto_renew_consent_version)에는 이 식별자만 저장한다.
// 법률 검토로 최종 문구가 확정되면 화면 문구를 바꾸고 이 버전을 올린다 (이전 동의 기록은 이전 버전으로 남는다).
// 현재 문구는 법률 확정 전 초안이다.
export const AUTO_RENEW_CONSENT_VERSION = "draft-2026-09-30";
