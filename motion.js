/* ===== Elotitos · motion.js v2 — ligero. No modifica app.js ===== */
(function () {
  var d = document, root = d.documentElement;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.classList.add('js-motion');
  var fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  function calm() { return d.body.classList.contains('reduced-motion'); }
  function ready(f) { d.readyState !== 'loading' ? f() : d.addEventListener('DOMContentLoaded', f); }

  ready(function () {
    /* 1. Aparecer al hacer scroll */
    var sel = '.section-heading,.menu-toolbar,.product-card,.menu-aside,.custom-copy,.custom-steps>div,.custom-illustration,.visit-card,.community-intro,.feedback-card,.reviews-heading,.review-list,.footer-main';
    var els = [].slice.call(d.querySelectorAll(sel));
    if ('IntersectionObserver' in window) {
      els.forEach(function (el) {
        el.setAttribute('data-reveal', '');
        var i = el.parentElement ? [].indexOf.call(el.parentElement.children, el) : 0;
        el.style.setProperty('--d', Math.min(i, 4) * 0.09 + 's');
      });
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
      }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
      els.forEach(function (el) { io.observe(el); });
      // por si un filtro del menú vuelve a mostrar tarjetas
      d.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.menu-tab')) {
          setTimeout(function () { d.querySelectorAll('.product-card').forEach(function (c) { c.classList.add('in'); }); }, 30);
        }
      });
    }

    /* 2. Barra de progreso y header (una sola lectura por cuadro) */
    var bar = d.createElement('div'); bar.className = 'scroll-progress'; d.body.appendChild(bar);
    var hdr = d.querySelector('.site-header'), ticking = false, scrolled = false;
    function onScroll() {
      ticking = false;
      var h = root.scrollHeight - innerHeight;
      bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, scrollY / h) : 0) + ')';
      var s = scrollY > 20;
      if (hdr && s !== scrolled) { scrolled = s; hdr.classList.toggle('scrolled', s); }
    }
    addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
    onScroll();

    /* 3. Pausar las animaciones del hero cuando no se ve */
    var hero = d.querySelector('.hero');
    if (hero && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        hero.classList.toggle('is-away', !es[0].isIntersecting);
      }, { threshold: 0 }).observe(hero);
    }

    /* 4. Parallax suave del hero con el mouse (solo escritorio) */
    if (hero && fine) {
      var frame = d.querySelector('.hero-image-frame'), notes = d.querySelectorAll('.floating-note');
      var px = 0, py = 0, pending = false;
      function paint() {
        pending = false;
        if (calm()) return;
        if (frame) frame.style.translate = (px * 14) + 'px ' + (py * 10) + 'px';
        notes.forEach(function (n, i) { n.style.transform = 'translate(' + (-px * (i ? 26 : 18)) + 'px,' + (-py * (i ? 18 : 12)) + 'px)'; });
      }
      hero.addEventListener('pointermove', function (e) {
        var r = hero.getBoundingClientRect();
        px = (e.clientX - r.left) / r.width - 0.5; py = (e.clientY - r.top) / r.height - 0.5;
        if (!pending) { pending = true; requestAnimationFrame(paint); }
      }, { passive: true });
      hero.addEventListener('pointerleave', function () { px = 0; py = 0; if (!pending) { pending = true; requestAnimationFrame(paint); } });
    }

    /* 5. Inclinación 3D de las tarjetas (solo escritorio) */
    if (fine) {
      d.querySelectorAll('.product-card').forEach(function (c) {
        var raf = 0, tx = '';
        c.addEventListener('pointermove', function (e) {
          if (calm()) return;
          var r = c.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
          tx = 'perspective(900px) rotateX(' + (-y * 6) + 'deg) rotateY(' + (x * 8) + 'deg) translateY(-4px)';
          if (!raf) raf = requestAnimationFrame(function () { raf = 0; c.style.transform = tx; });
        }, { passive: true });
        c.addEventListener('pointerleave', function () { c.style.transform = ''; });
      });
    }

    /* 6. Rebote del carrito cuando cambia el contador */
    var cnt = d.querySelector('.cart-count'), ct = d.querySelector('.cart-trigger');
    if (cnt && ct) {
      new MutationObserver(function () { ct.classList.remove('bump'); void ct.offsetWidth; ct.classList.add('bump'); })
        .observe(cnt, { childList: true, characterData: true, subtree: true });
    }
  });
})();
