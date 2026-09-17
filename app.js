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

// 요금제 결제주기 토글 (월간/연간)
const billingToggle = document.getElementById('billingToggle');
if (billingToggle) {
  const cycleLabel = { monthly: '/월', year: '/월 · 연간 결제' };

  billingToggle.querySelectorAll('.billing-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cycle = btn.dataset.cycle;
      billingToggle.querySelectorAll('.billing-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      document.querySelectorAll('.pricing-card').forEach(card => {
        const price = Number(card.dataset[cycle]);
        card.querySelector('.price-amount').textContent = price.toLocaleString('ko-KR');
        card.querySelector('.plan-price small').textContent = cycleLabel[cycle];

        const note = card.querySelector('.plan-billing-note');
        if (cycle === 'monthly') {
          note.textContent = '';
        } else {
          const total = price * 12;
          note.textContent = `연 ${total.toLocaleString('ko-KR')}원 결제 (12개월)`;
        }
      });
    });
  });
}

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
