// 스크롤 시 헤더 그림자
window.addEventListener('scroll', () => {
  document.getElementById('header').classList.toggle('scrolled', window.scrollY > 10);
});

// 모바일 메뉴
function toggleMenu() {
  document.getElementById('mobileMenu').classList.toggle('open');
}

// FAQ 토글
function toggleFaq(el) {
  el.classList.toggle('open');
}

// 폼 제출
function submitForm(e) {
  e.preventDefault();
  const btn = e.target.querySelector('.btn-submit');
  btn.textContent = '신청 완료! 곧 연락드리겠습니다 😊';
  btn.style.background = 'linear-gradient(135deg, #059669, #10b981)';
  btn.disabled = true;
}

// 부드러운 스크롤
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const href = a.getAttribute('href');
    if (href.length <= 1) return;
    e.preventDefault();
    const target = document.querySelector(href);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('mobileMenu').classList.remove('open');
  });
});

// 요금제 결제주기 토글
const billingToggle = document.getElementById('billingToggle');
if (billingToggle) {
  const cycleLabel = { monthly: '/월', half: '/월 · 6개월권', year: '/월 · 1년권' };
  const cycleTotalMonths = { monthly: 1, half: 6, year: 12 };

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
          const total = price * cycleTotalMonths[cycle];
          note.textContent = `총 ${total.toLocaleString('ko-KR')}원 결제 (${cycleTotalMonths[cycle]}개월)`;
        }
      });
    });
  });
}

// 카드 스크롤 애니메이션
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity = '1';
      entry.target.style.transform = entry.target.style.transform.replace('translateY(30px)', 'translateY(0)');
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.feature-card, .review-card, .pricing-card').forEach(el => {
  el.style.opacity = '0';
  el.style.transform = 'translateY(30px)';
  el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
  observer.observe(el);
});
