/* ==========================================================================
   ELOTITOS — poster.js   ·   Cartel con código QR para imprimir y pegar en tu puesto
   Se carga solo cuando abres la pestaña "Cartel y QR" del panel de administrador.
   El QR se genera aquí mismo, en tu navegador (no se envía nada a ningún servicio).
   ========================================================================== */
(function () {
  const ctx = () => window.ElotitosAdminCtx;
  const COLORS = { bg: '#14110F', line: '#3A2F27', corn: '#F2B01E', cream: '#F6EEDF', soft: '#CDBFA9', paper: '#FFF8EA' };
  const MARK_EAR = 'M20.8 5.5c-6.4 0-11.1 6.8-11.1 16.8 0 7.6 4.1 13.4 11.1 13.4s11.1-5.8 11.1-13.4c0-10-4.7-16.8-11.1-16.8Z';
  const MARK_LINES = 'M11.2 18.3c-4.3 3.5-3.4 12.8 4.1 16.4m13.4-16.4c4.3 3.5 3.4 12.8-4.1 16.4M16 11.7l9.6 20.2M12.7 17.2l11.1 18.1m-1-29.1 8.9 18.2m-17-17 13.6 27.8';
  const SERIF = 'Fraunces, Georgia, serif', SANS = '"DM Sans", Arial, sans-serif';
  let qrScript = null;

  const loadQr = () => qrScript || (qrScript = new Promise((resolve, reject) => {
    if (window.qrcode) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'assets/vendor/qrcode.js';
    script.onload = resolve;
    script.onerror = () => { qrScript = null; reject(new Error('No se pudo cargar el generador de QR.')); };
    document.head.appendChild(script);
  }));
  const loadFonts = () => Promise.all([
    document.fonts.load(`700 100px ${SERIF}`), document.fonts.load(`400 30px ${SANS}`), document.fonts.load(`500 30px ${SANS}`), document.fonts.load(`700 30px ${SANS}`)
  ]).catch(() => null);

  function makeQr(url) {
    const qr = window.qrcode(0, 'Q');         // corrección de errores "Q": aguanta manchas y dobleces
    qr.addData(url, 'Byte');
    qr.make();
    return qr;
  }

  /* ---------- Dibujo ---------- */
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  /* Dibuja el QR dentro de un cuadrado de lado "size" (incluye 4 módulos de margen en blanco) */
  function drawQr(g, qr, x, y, size) {
    const n = qr.getModuleCount();
    const scale = g.getTransform().a || 1;                       // píxeles reales por unidad de dibujo
    const cell = Math.max(1, Math.floor(size * scale / (n + 8))) / scale;   // cada módulo mide un número entero de píxeles: bordes nítidos
    const used = cell * (n + 8);
    const ox = Math.round((x + (size - used) / 2) * scale) / scale, oy = Math.round((y + (size - used) / 2) * scale) / scale;
    g.fillStyle = COLORS.bg;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(ox + (c + 4) * cell, oy + (r + 4) * cell, cell, cell);
  }
  function drawMark(g, x, y, size) {
    g.save(); g.translate(x, y); g.scale(size / 42, size / 42);
    g.fillStyle = COLORS.corn; g.fill(new Path2D(MARK_EAR));
    g.strokeStyle = COLORS.bg; g.lineWidth = 1.8; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke(new Path2D(MARK_LINES));
    g.restore();
  }
  function fitSize(g, text, weight, family, maxSize, maxWidth) {
    let size = maxSize;
    g.font = `${weight} ${size}px ${family}`;
    while (g.measureText(text).width > maxWidth && size > 10) { size -= 2; g.font = `${weight} ${size}px ${family}`; }
    return size;
  }
  function wrapLines(g, text, maxWidth) {
    const lines = []; let line = '';
    for (const word of text.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (g.measureText(test).width > maxWidth && line) { lines.push(line); line = word; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  function spaced(g, text, cx, y, gap) {          // texto con espacio entre letras, centrado
    const chars = [...text], align = g.textAlign;
    g.textAlign = 'left';                         // cada letra se coloca por su borde izquierdo (si no, las letras angostas quedan chuecas)
    const widths = chars.map(ch => g.measureText(ch).width);
    let x = cx - (widths.reduce((a, b) => a + b, 0) + gap * (chars.length - 1)) / 2;
    chars.forEach((ch, i) => { g.fillText(ch, x, y); x += widths[i] + gap; });
    g.textAlign = align;
  }
  const prettyUrl = url => url.replace(/^https:\/\//, '').replace(/\/$/, '');
  function prettyPhone(App, value) {
    const phone = App.normalizePhone(value);
    return /^52\d{10}$/.test(phone) ? `+52 ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}` : (phone ? `+${phone}` : '');
  }

  /* Cartel vertical (proporción carta/A4). Se dibuja en una cuadrícula de 1000 × 1414 y se escala. */
  function drawPoster(canvas, qr, url, info) {
    const W = 1000, H = 1414, g = canvas.getContext('2d');
    g.setTransform(canvas.width / W, 0, 0, canvas.width / W, 0, 0);
    g.textBaseline = 'alphabetic'; g.textAlign = 'center';
    g.fillStyle = COLORS.bg; g.fillRect(0, 0, W, H);
    g.fillStyle = COLORS.corn; g.fillRect(0, 0, W, 16);
    g.strokeStyle = COLORS.line; g.lineWidth = 3; roundRect(g, 34, 46, W - 68, H - 92, 36); g.stroke();

    const brand = (info.name || 'Elotitos').toLowerCase();
    g.font = `700 64px ${SERIF}`;
    const brandWidth = g.measureText(brand).width + 78;
    drawMark(g, (W - brandWidth) / 2, 82, 62);
    g.fillStyle = COLORS.cream; g.textAlign = 'left'; g.fillText(brand, (W - brandWidth) / 2 + 78, 132);
    g.textAlign = 'center';

    g.fillStyle = COLORS.corn; g.font = `700 24px ${SANS}`; spaced(g, 'PIDE POR WHATSAPP', W / 2, 205, 5);

    const lines = [['¡Pide tus elotes', COLORS.cream], ['y esquites', COLORS.cream], ['desde tu celular!', COLORS.corn]];
    const size = Math.min(...lines.map(([text]) => fitSize(g, text, 700, SERIF, 90, 820)));
    const step = size * 1.1, firstLine = 304;
    g.font = `700 ${size}px ${SERIF}`;
    lines.forEach(([text, color], i) => { g.fillStyle = color; g.fillText(text, W / 2, firstLine + i * step); });

    g.fillStyle = COLORS.soft; g.font = `400 30px ${SANS}`;
    const intro = wrapLines(g, 'Escanea el código con la cámara de tu celular, arma tu antojo y mándanos tu pedido por WhatsApp.', 780);
    const introTop = firstLine + 2 * step + 64;
    intro.forEach((line, i) => g.fillText(line, W / 2, introTop + i * 42));
    const introEnd = introTop + (intro.length - 1) * 42;

    /* La parte de abajo se acomoda de abajo hacia arriba, para que nada se encime aunque falten datos del negocio */
    const footer = [prettyPhone(info.App, info.whatsapp) && `WhatsApp ${prettyPhone(info.App, info.whatsapp)}`, info.location].filter(Boolean).join('   ·   ');
    const footerY = H - 84;
    const urlY = footer ? footerY - 58 : footerY - 28;
    const labelY = urlY - 50;
    const cardBottom = labelY - 60;
    const cardSize = Math.min(520, cardBottom - (introEnd + 38));
    const cardY = cardBottom - cardSize;
    g.fillStyle = COLORS.paper; roundRect(g, (W - cardSize) / 2, cardY, cardSize, cardSize, 34); g.fill();
    drawQr(g, qr, (W - cardSize) / 2 + 10, cardY + 10, cardSize - 20);

    g.fillStyle = COLORS.corn; g.font = `700 32px ${SANS}`; g.fillText('Escanea y pide aquí', W / 2, labelY);
    const label = prettyUrl(url);
    g.fillStyle = COLORS.cream; g.font = `500 ${fitSize(g, label, 500, SANS, 30, 800)}px ${SANS}`; g.fillText(label, W / 2, urlY);
    if (footer) { g.fillStyle = COLORS.soft; g.font = `400 ${fitSize(g, footer, 400, SANS, 26, 820)}px ${SANS}`; g.fillText(footer, W / 2, footerY); }
  }

  /* Cuadrado para stickers, vasos o publicaciones (1000 × 1000 escalado) */
  function drawSquare(canvas, qr, url, info) {
    const W = 1000, g = canvas.getContext('2d');
    g.setTransform(canvas.width / W, 0, 0, canvas.width / W, 0, 0);
    g.textBaseline = 'alphabetic'; g.textAlign = 'center';
    g.fillStyle = COLORS.bg; g.fillRect(0, 0, W, W);
    g.fillStyle = COLORS.corn; g.fillRect(0, 0, W, 14);
    const brand = (info.name || 'Elotitos').toLowerCase();
    g.font = `700 56px ${SERIF}`;
    const brandWidth = g.measureText(brand).width + 68;
    drawMark(g, (W - brandWidth) / 2, 52, 54);
    g.fillStyle = COLORS.cream; g.textAlign = 'left'; g.fillText(brand, (W - brandWidth) / 2 + 68, 98);
    g.textAlign = 'center';
    const card = 640;
    g.fillStyle = COLORS.paper; roundRect(g, (W - card) / 2, 140, card, card, 36); g.fill();
    drawQr(g, qr, (W - card) / 2 + 12, 152, card - 24);
    g.fillStyle = COLORS.corn; g.font = `700 54px ${SERIF}`; g.fillText('Escanea y pide', W / 2, 140 + card + 78);
    const label = prettyUrl(url);
    g.fillStyle = COLORS.cream; g.font = `500 ${fitSize(g, label, 500, SANS, 30, 820)}px ${SANS}`; g.fillText(label, W / 2, 140 + card + 130);
  }

  /* Solo el código QR, sobre fondo claro */
  function drawPlain(canvas, qr) {
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = COLORS.paper; g.fillRect(0, 0, canvas.width, canvas.height);
    drawQr(g, qr, 0, 0, canvas.width);
  }

  /* ---------- Panel ---------- */
  const detectUrl = c => {
    if (location.protocol !== 'https:' || /^\d+\.\d+\.\d+\.\d+$/.test(location.hostname)) return '';
    return c.App.cleanSiteUrl(location.origin + location.pathname);
  };

  function markup(c) {
    const esc = c.esc, b = c.getWorking().business;
    const detected = detectUrl(c);
    return `<div class="adm-section"><h3>Dirección de tu página</h3>
        <p class="adm-help">Es lo que se escribe en el navegador para ver tu página. Con ella se hace el código QR y la vista previa al compartir el enlace por WhatsApp o Facebook.</p>
        <label class="adm-field"><span>Dirección (empieza con https://)</span><input id="poster-url" data-f="business.siteUrl" value="${esc(b.siteUrl || '')}" placeholder="https://tu-usuario.github.io/elotitos/" inputmode="url" autocapitalize="off" spellcheck="false" /></label>
        ${detected ? `<button type="button" class="adm-link" data-poster="use-current" ${detected === c.App.cleanSiteUrl(b.siteUrl) ? 'hidden' : ''}>Usar la dirección de esta página: ${esc(detected)}</button>` : ''}
        <p class="adm-help" id="poster-status" role="status" aria-live="polite"></p></div>
      <div class="adm-section" id="poster-section"><h3>Tu cartel con QR</h3>
        <div class="poster-preview"><canvas id="poster-canvas" width="500" height="707" role="img" aria-label="Vista previa del cartel con el código QR"></canvas></div>
        <div class="adm-actions poster-actions">
          <button type="button" class="button button-primary" data-poster="dl-poster">Descargar cartel (carta / A4)</button>
          <button type="button" class="button" data-poster="dl-square">Cuadrado (stickers, vasos)</button>
          <button type="button" class="button" data-poster="dl-qr">Solo el QR</button></div>
        <div class="adm-actions"><button type="button" class="adm-link" data-poster="copy">Copiar enlace</button><button type="button" class="adm-link" data-poster="share">Compartir mi página por WhatsApp</button></div>
        <p class="adm-help">Imprímelo en hoja carta o A4 y pégalo en tu puesto. Antes de imprimir muchas copias, prueba el QR con la cámara de tu celular.</p></div>`;
  }

  function info(c) {
    const b = c.getWorking().business;
    return { App: c.App, name: b.name, whatsapp: b.whatsapp, location: b.location };
  }
  const currentUrl = (c, box) => c.App.cleanSiteUrl(box.querySelector('#poster-url').value);

  async function build(kind, c, box, width) {
    const url = currentUrl(c, box);
    if (!url) throw new Error('Escribe primero la dirección de tu página (https://…).');
    await Promise.all([loadQr(), loadFonts()]);
    const qr = makeQr(url);
    const canvas = document.createElement('canvas');
    if (kind === 'poster') { canvas.width = width; canvas.height = Math.round(width * 1414 / 1000); drawPoster(canvas, qr, url, info(c)); }
    else if (kind === 'square') { canvas.width = canvas.height = width; drawSquare(canvas, qr, url, info(c)); }
    else { canvas.width = canvas.height = width; drawPlain(canvas, qr); }
    return canvas;
  }
  function download(canvas, filename) {
    canvas.toBlob(blob => {
      if (!blob) { ctx().showToast('No se pudo crear la imagen.'); return; }
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href; link.download = filename;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 4000);
    }, 'image/png');
  }

  async function refresh(box) {
    const c = ctx();
    const url = currentUrl(c, box);
    const raw = box.querySelector('#poster-url').value.trim();
    const status = box.querySelector('#poster-status');
    const section = box.querySelector('#poster-section');
    const current = box.querySelector('[data-poster="use-current"]');
    if (current) current.hidden = currentUrl(c, box) === detectUrl(c);
    section.hidden = !url;
    if (!url) { status.textContent = raw ? 'Esa dirección no sirve todavía: debe empezar con https:// y ser la de tu página publicada.' : 'Escribe la dirección de tu página para crear tu cartel.'; return; }
    status.textContent = `✓ El QR llevará a: ${url}`;
    try {
      const preview = await build('poster', c, box, 500);
      const target = box.querySelector('#poster-canvas');
      target.getContext('2d').drawImage(preview, 0, 0);
    } catch (error) { status.textContent = error.message; }
  }

  function mount(box) {
    const c = ctx();
    box.innerHTML = markup(c);
    let timer = null;
    const later = () => { clearTimeout(timer); timer = setTimeout(() => refresh(box), 220); };
    box.addEventListener('input', event => { if (event.target.id === 'poster-url') later(); });
    box.addEventListener('click', async event => {
      const button = event.target.closest('[data-poster]');
      if (!button) return;
      const action = button.dataset.poster;
      const url = currentUrl(c, box);
      try {
        if (action === 'use-current') {
          const input = box.querySelector('#poster-url');
          input.value = detectUrl(c);
          input.dispatchEvent(new Event('input', { bubbles: true }));      // el panel lo guarda como cualquier otro campo
          input.dispatchEvent(new Event('change', { bubbles: true }));
          later();
        }
        if (action === 'dl-poster') download(await build('poster', c, box, 2480), 'elotitos-cartel-qr-carta.png');
        if (action === 'dl-square') download(await build('square', c, box, 1600), 'elotitos-qr-cuadrado.png');
        if (action === 'dl-qr') download(await build('plain', c, box, 1024), 'elotitos-qr.png');
        if (action === 'copy' && url) { await navigator.clipboard.writeText(url); c.showToast('Enlace copiado.'); }
        if (action === 'share' && url) window.open(`https://wa.me/?text=${encodeURIComponent(`Pide tus elotes y esquites en ${c.getWorking().business.name || 'Elotitos'}: ${url}`)}`, '_blank', 'noopener');
      } catch (error) { c.showToast(error.message || 'No se pudo completar la acción.'); }
    });
    refresh(box);
  }

  window.ElotitosPoster = { mount, _test: { makeQr, build } };
})();
