// 예약관리 CRM 앱 주소 (crm/ 폴더, 별도 Vercel 프로젝트로 배포).
const CRM_APP_URL = 'https://beauty-site-crm.vercel.app';

document.querySelectorAll('[data-crm-link="login"]').forEach(a => {
  a.href = `${CRM_APP_URL}/login`;
});
document.querySelectorAll('[data-crm-link="signup"]').forEach(a => {
  a.href = `${CRM_APP_URL}/signup`;
});

// 스크롤 시 헤더 그림자
window.addEventListener('scroll', () => {
  document.getElementById('header').classList.toggle('scrolled', window.scrollY > 10);
});

// 모바일 메뉴
function toggleMenu() {
  document.getElementById('mobileMenu').classList.toggle('open');
}

document.querySelectorAll('.mobile-menu a').forEach(a => {
  a.addEventListener('click', () => document.getElementById('mobileMenu').classList.remove('open'));
});

// FAQ 아코디언
function toggleFaq(el) {
  const wasOpen = el.classList.contains('open');
  el.parentElement.querySelectorAll('.faq-item.open').forEach(item => item.classList.remove('open'));
  if (!wasOpen) el.classList.add('open');
}

// 요금제 가격 (부가세 포함 최종 결제금액 기준). 화면의 가격 표시는 이 데이터를 기준으로 채운다.
// 공급가액·부가세는 결제/주문 화면에서 "공급가액 100,000원 + 부가세 10,000원 = 총 110,000원" 형태로 보여줄 때 쓴다.
const PRICING_PLANS = {
  monthly: { name: '월간 이용권', total: 10000, supply: 9091, vat: 909, periodMonths: 1, unit: '월' },
  yearly: { name: '연간 이용권', total: 110000, supply: 100000, vat: 10000, periodMonths: 12, unit: '년' },
};

const formatWon = (n) => `${n.toLocaleString('ko-KR')}원`;

/** 결제/주문 화면용 금액 내역 문자열 */
function priceBreakdown(planKey) {
  const p = PRICING_PLANS[planKey];
  return `공급가액 ${formatWon(p.supply)} + 부가세 ${formatWon(p.vat)} = 총 ${formatWon(p.total)}`;
}

document.querySelectorAll('.pricing-card[data-plan]').forEach(card => {
  const plan = PRICING_PLANS[card.dataset.plan];
  if (!plan) return;
  card.querySelector('.price-amount').textContent = plan.total.toLocaleString('ko-KR');
  if (card.dataset.plan === 'yearly') {
    const monthlyYearTotal = PRICING_PLANS.monthly.total * 12;
    const equiv = card.querySelector('.plan-monthly-equiv');
    const saving = card.querySelector('.plan-saving');
    if (equiv) equiv.textContent = `월 환산 약 ${formatWon(Math.round(plan.total / 12))}`;
    if (saving) saving.innerHTML = `월간 12개월(${formatWon(monthlyYearTotal)}) 대비 <b>${formatWon(monthlyYearTotal - plan.total)} 절약</b>`;
  }
});

// 스크롤 등장 애니메이션
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = 'translateY(0)';
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.tile, .step, .pricing-card, .industry-item').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(24px)';
  el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
  observer.observe(el);
});
