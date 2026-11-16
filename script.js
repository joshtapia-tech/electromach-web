document.getElementById('year').textContent = new Date().getFullYear();
document.querySelectorAll('[data-service]').forEach((link) => link.addEventListener('click', () => { document.getElementById('service').value = link.dataset.service; }));
const slides = [...document.querySelectorAll('.hero-slide')];
const controls = [...document.querySelectorAll('[data-slide]')];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let currentSlide = 0;
let carousel;
function showSlide(index) {
  currentSlide = (index + slides.length) % slides.length;
  slides.forEach((slide, position) => { const active = position === currentSlide; slide.classList.toggle('is-active', active); slide.setAttribute('aria-hidden', String(!active)); });
  controls.forEach((control, position) => control.classList.toggle('is-active', position === currentSlide));
}
function startCarousel() { if (!reduceMotion) carousel = window.setInterval(() => showSlide(currentSlide + 1), 5500); }
controls.forEach((control) => control.addEventListener('click', () => { window.clearInterval(carousel); showSlide(Number(control.dataset.slide)); startCarousel(); }));
startCarousel();
let brief = '';
document.getElementById('brief').addEventListener('submit', (event) => { event.preventDefault(); brief = `Hola Electromach, soy ${document.getElementById('name').value.trim()}.\nServicio: ${document.getElementById('service').value}.\n\n${document.getElementById('message').value.trim()}`; document.getElementById('summary').textContent = brief; document.getElementById('result').hidden = false; });
document.getElementById('download').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([brief], { type: 'text/plain;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'consulta-electromach.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
