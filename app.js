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
    e.preventDefault();
    const target = document.querySelector(a.getAttribute('href'));
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('mobileMenu').classList.remove('open');
  });
});

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
