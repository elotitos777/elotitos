/* ==========================================================================
   ELOTITOS — admin.js  (panel de administrador, se carga solo al pulsar
   "Administrador" en el pie de página o al abrir la página con #admin)
   ========================================================================== */
(function () {
  const App = window.ElotitosApp, UI = window.ElotitosUI;
  const { STORAGE, escapeHTML: esc, showToast } = App;
  const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  let working = null;          // copia editable (sin normalizar, para no alterar lo que se escribe)
  let activeTab = 'productos';
  let commitTimer = null;
  let attempts = 0, lockedUntil = 0;

  /* ---------- SHA-256 (con respaldo para páginas sin HTTPS) ---------- */
  function sha256Fallback(ascii) {
    const rr = (v, a) => (v >>> a) | (v << (32 - a));
    const K = [], H = [];
    let primes = 0, c = 2;
    const isPrime = n => { for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
    while (primes < 64) { if (isPrime(c)) { if (primes < 8) H[primes] = (Math.pow(c, .5) * 4294967296) | 0; K[primes++] = (Math.pow(c, 1 / 3) * 4294967296) | 0; } c++; }
    const bytes = Array.from(new TextEncoder().encode(ascii));
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (let i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bitLen >>> (i * 8)) & 255);
    for (let off = 0; off < bytes.length; off += 64) {
      const w = [];
      for (let i = 0; i < 16; i++) w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      for (let i = 16; i < 64; i++) { const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
      let [a, b, cc, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & b) ^ (a & cc) ^ (b & cc))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = cc; cc = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + cc) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
  }
  async function sha256(text) {
    try {
      if (window.crypto?.subtle) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch { /* usa el respaldo */ }
    return sha256Fallback(text);
  }

  /* ---------- Utilidades ---------- */
  /* Copia editable del catálogo. Los borradores de la versión 1 se normalizan una vez (así se aplica la migración de pagos). */
  const loadWorking = raw => {
    const copy = JSON.parse(JSON.stringify(raw));
    return (Number(copy.version) || 1) < 2 ? App.normalizeCatalog(copy) : copy;
  };
  /* publish.js y poster.js se cargan solo cuando se necesitan */
  const modules = {};
  function loadModule(file) {
    if (!modules[file]) modules[file] = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = file;
      script.onload = resolve;
      script.onerror = () => { delete modules[file]; reject(new Error(`No se pudo cargar ${file}.`)); };
      document.head.appendChild(script);
    });
    return modules[file];
  }
  async function mountModule(file, globalName, selector) {
    const target = document.querySelector(selector);
    if (!target) return;
    try {
      await loadModule(file);
      if (document.querySelector(selector) === target) window[globalName].mount(target, ctx);   // la pestaña pudo cambiar mientras cargaba
    } catch (error) { target.innerHTML = `<p class="adm-help">${esc(error.message)} Revisa tu conexión y vuelve a abrir esta pestaña.</p>`; }
  }
  const setPath = (obj, path, value) => {
    const keys = path.split('.');
    let ref = obj;
    keys.slice(0, -1).forEach(k => { if (ref[k] == null || typeof ref[k] !== 'object') ref[k] = {}; ref = ref[k]; });
    ref[keys[keys.length - 1]] = value;
  };
  function commit(now) {
    clearTimeout(commitTimer);
    const run = () => {
      const ok = App.saveStore(STORAGE.draft, working);
      App.setCatalog(working);
      if (!ok) showToast('Memoria llena: quita fotos pesadas o publica y borra el borrador.');
      setSaved(ok);
    };
    now ? run() : (commitTimer = setTimeout(run, 250));
  }
  function setSaved(ok = true) { setStatus(ok ? 'Guardado en este dispositivo · falta publicar para tus clientes' : 'No se pudo guardar'); }
  function setStatus(text) {
    const node = document.querySelector('#adm-status');
    if (node) node.textContent = text;
  }
  function resizeImage(file, max = 800) {
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type)) return reject(new Error('El archivo no es una imagen.'));
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        let data = canvas.toDataURL('image/webp', .82);
        if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', .82);
        resolve(data);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
      img.src = url;
    });
  }
  function makeModal(id, title, eyebrow) {
    let modal = document.getElementById(id);
    if (modal) return modal;
    modal = document.createElement('section');
    modal.className = 'modal admin-modal';
    modal.id = id; modal.hidden = true;
    modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', title);
    modal.innerHTML = `<div class="modal-header"><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></div><button class="modal-close" aria-label="Cerrar" type="button">×</button></div><div class="admin-body"></div>`;
    modal.querySelector('.modal-close').addEventListener('click', UI.closeLayers);
    document.body.appendChild(modal);
    UI.allDialogs.push(modal);
    return modal;
  }

  /* ---------- Login ---------- */
  function openLogin() {
    const modal = makeModal('admin-login', 'Acceso de administrador', 'Solo para el dueño');
    modal.classList.add('small-modal');
    modal.querySelector('.admin-body').innerHTML = `<form id="admin-login-form" autocomplete="off">
      <p class="adm-help">Entra para cambiar precios, ingredientes, descripciones e imágenes del menú.</p>
      <label class="form-label" for="admin-pass">Contraseña</label>
      <input id="admin-pass" type="password" autocomplete="current-password" required />
      <p class="form-status adm-error" aria-live="polite"></p>
      <button class="button button-primary custom-submit" type="submit">Entrar <span>↗</span></button>
    </form>`;
    modal.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      const status = modal.querySelector('.adm-error');
      const wait = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (wait > 0) { status.textContent = `Demasiados intentos. Espera ${wait} s.`; return; }
      const hash = await sha256(modal.querySelector('#admin-pass').value);
      const draft = App.readStore(STORAGE.draft, null);
      const valid = [App.getCatalog().adminHash, draft?.adminHash].filter(Boolean);
      if (!valid.includes(hash)) {
        attempts++;
        if (attempts >= 5) { lockedUntil = Date.now() + 30000; attempts = 0; }
        status.textContent = 'Contraseña incorrecta.';
        return;
      }
      attempts = 0;
      try { sessionStorage.setItem(STORAGE.admin, '1'); } catch { /* sin sesión persistente */ }
      working = loadWorking(draft || App.getCatalog());
      App.setCatalog(working);
      /* Si dejaste el token de GitHub guardado en este dispositivo, se abre con la contraseña que acabas de escribir */
      try { if (localStorage.getItem('elotitos-gh-vault-v1')) { await loadModule('publish.js'); await window.ElotitosPublish.unlock(modal.querySelector('#admin-pass').value); } } catch { /* sin token: se pedirá al publicar */ }
      if (hash === App.DEFAULT_CATALOG.adminHash) { activeTab = 'publicar'; showToast('Entraste con la contraseña inicial: cámbiala ahora.'); }
      showPanel();
    });
    UI.openLayer(modal);
  }

  /* ---------- Panel ---------- */
  function showPanel() {
    const modal = makeModal('admin-panel', 'Panel de administrador', 'Elotitos');
    modal.classList.add('admin-wide');
    modal.querySelector('.admin-body').innerHTML = `
      <div class="adm-tabs" role="tablist">
        <button type="button" data-tab="productos">Productos</button>
        <button type="button" data-tab="negocio">Negocio y pagos</button>
        <button type="button" data-tab="galeria">Galería</button>
        <button type="button" data-tab="resenas">Reseñas</button>
        <button type="button" data-tab="cartel">Cartel y QR</button>
        <button type="button" data-tab="publicar">Publicar y seguridad</button>
      </div>
      <div class="adm-quick" id="adm-quick" role="group" aria-label="Control rápido"></div>
      <p class="adm-status" id="adm-status" aria-live="polite">Los cambios se guardan solos en este dispositivo.</p>
      <div class="adm-content" id="adm-content"></div>`;
    if (!modal.dataset.bound) {
      modal.dataset.bound = '1';
      modal.addEventListener('input', onField);
      modal.addEventListener('change', onField);
      modal.addEventListener('click', onClick);
    }
    UI.openLayer(modal);
    renderQuick();
    renderTab(activeTab);
  }
  /* Control rápido: interruptores que se ven en todas las pestañas */
  function renderQuick() {
    const box = document.querySelector('#adm-quick');
    if (!box || !working) return;
    const b = working.business;
    const transferOn = (b.payments || []).includes('Transferencia');
    const ordersOn = b.ordersPaused !== true;
    const connected = !!App.readStore('elotitos-publish-v1', null)?.owner;
    box.innerHTML = `
      <label class="adm-switch"><input type="checkbox" role="switch" data-quick="transfer" ${transferOn ? 'checked' : ''} /><i aria-hidden="true"></i><span><b>Pago por transferencia</b><small>${transferOn ? 'Encendido: tus clientes pueden elegirlo' : 'Apagado: solo se ofrece efectivo'}</small></span></label>
      <label class="adm-switch"><input type="checkbox" role="switch" data-quick="orders" ${ordersOn ? 'checked' : ''} /><i aria-hidden="true"></i><span><b>Recibiendo pedidos</b><small>${ordersOn ? 'Encendido: tus clientes pueden pedir' : 'Pausado: nadie puede pedir ahora'}</small></span></label>
      <div class="adm-quick-publish">${connected ? '<button type="button" class="button button-primary" data-act="publish-now">Publicar ahora</button>' : '<button type="button" class="adm-link" data-act="goto-publish">¿Cómo publico mis cambios?</button>'}</div>`;
  }
  const tabsOf = () => document.querySelectorAll('#admin-panel .adm-tabs button');
  function renderTab(tab, keepScroll) {
    activeTab = tab;
    const box = document.querySelector('#adm-content');
    const top = keepScroll ? document.querySelector('#admin-panel').scrollTop : 0;
    const openIds = keepScroll && tab === 'productos' ? new Set([...box.querySelectorAll('details.adm-card[open]')].map(card => card.dataset.pid)) : null;
    tabsOf().forEach(b => { b.classList.toggle('active', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    box.innerHTML = { productos: tabProductos, negocio: tabNegocio, galeria: tabGaleria, resenas: tabResenas, cartel: tabCartel, publicar: tabPublicar }[tab]();
    if (openIds) box.querySelectorAll('details.adm-card').forEach(card => { card.open = openIds.has(card.dataset.pid); });
    box.querySelectorAll('img').forEach(img => img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true }));
    document.querySelector('#admin-panel').scrollTop = top;
    if (tab === 'publicar') mountModule('publish.js', 'ElotitosPublish', '#gh-box');
    if (tab === 'cartel') mountModule('poster.js', 'ElotitosPoster', '#poster-box');
  }

  const field = (label, path, value, attrs = '', hint = '') =>
    `<label class="adm-field"><span>${label}</span><input data-f="${path}" value="${esc(value ?? '')}" ${attrs} />${hint ? `<small>${hint}</small>` : ''}</label>`;
  const check = (label, path, on) => `<label class="adm-check"><input type="checkbox" data-f="${path}" ${on ? 'checked' : ''} /><span>${label}</span></label>`;

  function tabProductos() {
    const cards = working.products.map((p, i) => {
      const img = App.safeSrc(p.image);
      const extras = (p.extras || []).map((x, j) => `<div class="adm-extra-row">
          ${field('Nombre del extra', `products.${i}.extras.${j}.name`, x.name, 'maxlength="40" placeholder="Ej. Queso extra"')}
          ${field('Precio (MXN)', `products.${i}.extras.${j}.price`, x.price, 'type="number" min="0" step="1" inputmode="numeric"')}
          <button type="button" class="adm-danger" data-act="del-extra" data-i="${i}" data-j="${j}" aria-label="Quitar el extra ${esc(x.name)}">Quitar</button></div>`).join('');
      return `<details class="adm-card" data-pid="${esc(p.id)}" ${i === 0 ? 'open' : ''}>
        <summary><span class="adm-thumb">${img ? `<img src="${esc(img)}" alt="" />` : '🌽'}</span><b>${esc(p.name || 'Producto nuevo')}</b><em>$${esc(p.price)}</em>${p.available === false ? '<i class="adm-off">Agotado</i>' : ''}</summary>
        <div class="adm-grid">
          <div class="adm-photo">
            <div class="adm-photo-box">${img ? `<img src="${esc(img)}" alt="Imagen de ${esc(p.name)}" />` : '<span>Sin imagen propia<br><small>Se usa un dibujo</small></span>'}</div>
            <label class="button adm-upload">Subir foto<input type="file" accept="image/*" data-upload="${i}" hidden /></label>
            ${img ? `<button type="button" class="adm-link" data-act="clear-img" data-i="${i}">Quitar imagen</button>` : ''}
            <label class="adm-field"><span>o pega un enlace https://…</span><input data-f="products.${i}.image" value="${esc(String(p.image || '').startsWith('data:') ? '' : p.image || '')}" placeholder="https://…" /></label>
          </div>
          <div class="adm-fields">
            ${field('Nombre', `products.${i}.name`, p.name, 'maxlength="60"')}
            <div class="adm-row">
              ${field('Precio (MXN)', `products.${i}.price`, p.price, 'type="number" min="0" step="1" inputmode="numeric"')}
              <label class="adm-field"><span>Categoría</span><select data-f="products.${i}.category">${[['elotes', 'Elotes'], ['esquites', 'Esquites'], ['otros', 'Otros']].map(([v, l]) => `<option value="${v}" ${p.category === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            </div>
            <label class="adm-field"><span>Descripción</span><textarea data-f="products.${i}.description" rows="3" maxlength="200">${esc(p.description)}</textarea></label>
            <label class="adm-field"><span>Ingredientes</span><input data-f="products.${i}.ingredients" data-kind="list" value="${esc((p.ingredients || []).join(', '))}" /><small>Sepáralos con comas. El cliente podrá quitar los que no quiera.</small></label>
            ${field('Etiqueta (opcional)', `products.${i}.tag`, p.tag, 'maxlength="24" placeholder="Ej. El favorito"')}
            <div class="adm-extras"><strong>Extras con costo (opcional)</strong><small class="adm-help">Ej. “Queso extra +$10”. El cliente los marca al personalizar y se suman al total.</small>${extras}${(p.extras || []).length < 8 ? `<button type="button" class="adm-link" data-act="add-extra" data-i="${i}">+ Agregar un extra</button>` : ''}</div>
            <div class="adm-checks">${check('Disponible hoy', `products.${i}.available`, p.available !== false)}${check('Se puede pedir con chile', `products.${i}.spicy`, p.spicy !== false)}</div>
            <div class="adm-actions">
              <button type="button" class="adm-link" data-act="up" data-i="${i}" ${i === 0 ? 'disabled' : ''}>↑ Subir</button>
              <button type="button" class="adm-link" data-act="down" data-i="${i}" ${i === working.products.length - 1 ? 'disabled' : ''}>↓ Bajar</button>
              <button type="button" class="adm-danger" data-act="del-product" data-i="${i}">Eliminar producto</button>
            </div>
          </div>
        </div></details>`;
    }).join('');
    return `<div class="adm-intro"><p>Edita lo que quieras: la página del menú se actualiza al instante para que lo veas.</p><button type="button" class="button button-primary" data-act="add-product">+ Agregar producto</button></div>${cards || '<p class="adm-help">Todavía no hay productos.</p>'}`;
  }

  function tabNegocio() {
    const b = working.business, t = b.transfer || {}, d = b.delivery || {};
    const sch = b.schedule || {};
    const rows = DAY_ORDER.map(day => {
      const slot = sch[day];
      return `<div class="adm-day"><label class="adm-check"><input type="checkbox" data-sched="${day}" data-part="on" ${slot ? 'checked' : ''} /><span>${DAYS[day]}</span></label><input type="time" data-sched="${day}" data-part="open" value="${slot?.[0] || '17:00'}" /><span>a</span><input type="time" data-sched="${day}" data-part="close" value="${slot?.[1] || '22:00'}" /></div>`;
    }).join('');
    const transferOn = (b.payments || []).includes('Transferencia');
    return `<div class="adm-section"><h3>Pedidos por WhatsApp</h3>
        ${field('Tu WhatsApp (con lada del país)', 'business.whatsapp', b.whatsapp, 'inputmode="numeric" placeholder="522213698374"', 'Puedes escribir solo tus 10 dígitos; la página agrega el 52 de México. Ahí te llegan los pedidos.')}
      </div>
      <div class="adm-section"><h3>Recibir pedidos</h3>
        <p class="adm-help">El interruptor <b>“Recibiendo pedidos”</b> de arriba pausa todos los pedidos al instante (por ejemplo, si se acabó el maíz o cerraste antes). Después tienes que publicar el cambio.</p>
        ${field('Aviso para tus clientes cuando está pausado', 'business.pauseMessage', b.pauseMessage, 'maxlength="160" placeholder="Ej. Hoy ya no tenemos maíz. ¡Mañana volvemos!"')}
        <div class="adm-checks">${check('No recibir pedidos fuera de mi horario', 'business.blockWhenClosed', b.blockWhenClosed === true)}</div>
        <p class="adm-help">Necesita el horario del letrero “Abierto / Cerrado” (más abajo). Si no lo activas, fuera de horario el cliente solo ve un aviso y puede dejar su pedido.</p>
      </div>
      <div class="adm-section"><h3>Formas de pago</h3>
        <p class="adm-help"><b>Efectivo</b> siempre está disponible. La <b>transferencia</b> se enciende y se apaga con el interruptor <b>“Pago por transferencia”</b> de arriba (ahora está <b>${transferOn ? 'encendida' : 'apagada'}</b>).</p>
        <p class="adm-help">Estos datos se muestran al cliente solo cuando la transferencia está encendida. Con la transferencia apagada <b>no se publican</b>: se quedan guardados solo en este dispositivo.</p>
        <div class="adm-row">${field('Banco', 'business.transfer.bank', t.bank)}${field('A nombre de', 'business.transfer.holder', t.holder)}</div>
        <div class="adm-row">${field('CLABE, cuenta o tarjeta', 'business.transfer.account', t.account, 'inputmode="numeric"')}${field('Concepto', 'business.transfer.concept', t.concept)}</div>
      </div>
      <div class="adm-section"><h3>Entrega</h3>
        <div class="adm-checks">${check('Recoger en el puesto', 'business.pickup', b.pickup !== false)}${check('Entrega a domicilio', 'business.delivery.enabled', d.enabled)}</div>
        <div class="adm-row">${field('Costo de envío (MXN)', 'business.delivery.fee', d.fee ?? 0, 'type="number" min="0" inputmode="numeric"')}${field('Nota de entrega', 'business.delivery.note', d.note, 'placeholder="Ej. Solo en la colonia"')}</div>
      </div>
      <div class="adm-section"><h3>Ubicación y horario</h3>
        ${field('Dirección del puesto', 'business.location', b.location)}
        ${field('Enlace de Google Maps', 'business.mapsUrl', b.mapsUrl, 'placeholder="https://maps.app.goo.gl/…"')}
        ${field('Horario (texto que ve el cliente)', 'business.hours', b.hours, 'placeholder="Lun a Sáb 5:00 pm – 10:00 pm"')}
        <p class="adm-help">Horario para el letrero “Abierto / Cerrado” (opcional):</p><div class="adm-days">${rows}</div>
      </div>
      <div class="adm-section"><h3>Datos legales (Aviso de privacidad y Términos)</h3>
        <p class="adm-help">Estos datos aparecen en las páginas de privacidad y términos. Son los que la ley pide mostrar al cliente.</p>
        ${field('Tu nombre completo o razón social', 'business.legal.name', b.legal?.name, 'autocomplete="name"')}
        ${field('Domicilio del negocio', 'business.legal.address', b.legal?.address, '', 'Calle, número, colonia, ciudad y estado.')}
        ${field('Correo de contacto (opcional)', 'business.legal.email', b.legal?.email, 'type="email" inputmode="email"')}
      </div>
      <div class="adm-section"><h3>Redes sociales</h3>
        ${field('Instagram', 'business.socials.instagram', b.socials?.instagram, 'placeholder="https://instagram.com/…"')}
        ${field('TikTok', 'business.socials.tiktok', b.socials?.tiktok, 'placeholder="https://tiktok.com/@…"')}
        ${field('Facebook', 'business.socials.facebook', b.socials?.facebook, 'placeholder="https://facebook.com/…"')}
      </div>`;
  }

  function tabGaleria() {
    const items = working.gallery.map((g, i) => `<div class="adm-gitem"><img src="${esc(g.src)}" alt="" /><input data-f="gallery.${i}.alt" value="${esc(g.alt)}" aria-label="Descripción de la imagen" /><button type="button" class="adm-danger" data-act="del-gal" data-i="${i}">Quitar</button></div>`).join('');
    return `<div class="adm-intro"><p>Estas imágenes aparecen en la sección “Galería”. Sube tus propias fotos de elotes y esquites.</p>
      <label class="button button-primary adm-upload">+ Subir fotos<input type="file" accept="image/*" multiple data-upload-gallery hidden /></label></div>
      <div class="adm-gallery">${items || '<p class="adm-help">La galería está vacía (la sección se oculta).</p>'}</div>`;
  }

  function tabResenas() {
    const items = (working.testimonials || []).map((r, i) => `<div class="adm-card adm-review"><div class="adm-row">
        ${field('Nombre', `testimonials.${i}.name`, r.name, 'maxlength="40"')}
        <label class="adm-field"><span>Estrellas</span><select data-f="testimonials.${i}.rating">${[5, 4, 3, 2, 1].map(n => `<option value="${n}" ${Number(r.rating) === n ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('')}</select></label></div>
        <label class="adm-field"><span>Reseña</span><textarea data-f="testimonials.${i}.text" rows="3" maxlength="300">${esc(r.text)}</textarea></label>
        <div class="adm-actions"><button type="button" class="adm-danger" data-act="del-review" data-i="${i}">Quitar</button></div></div>`).join('');
    return `<div class="adm-intro"><p>Las reseñas que tus clientes te envían por WhatsApp llegan a ti. Aquí eliges cuáles mostrar en la página (pídeles permiso primero).</p>
      <button type="button" class="button button-primary" data-act="add-review">+ Agregar reseña</button></div>${items || '<p class="adm-help">Todavía no has agregado reseñas.</p>'}`;
  }

  /* Revisión rápida antes de publicar */
  function checklist() {
    const b = working.business, issues = [];
    if (!(b.legal?.name || '').trim()) issues.push('Falta tu nombre o razón social (Negocio y pagos → Datos legales).');
    if (!(b.legal?.address || b.location || '').trim()) issues.push('Falta el domicilio del negocio (Negocio y pagos → Datos legales).');
    if ((b.payments || []).includes('Transferencia') && !(b.transfer?.account || '').trim()) issues.push('Aceptas transferencia pero no has escrito tu cuenta o CLABE.');
    if (!App.normalizePhone(b.whatsapp)) issues.push('Falta tu número de WhatsApp.');
    if (b.ordersPaused) issues.push('Los pedidos están pausados: tus clientes no podrán pedir hasta que enciendas “Recibiendo pedidos”.');
    if (b.blockWhenClosed && !b.schedule) issues.push('Pediste no recibir pedidos fuera de horario, pero no has llenado el horario (Negocio y pagos → Ubicación y horario).');
    if (!App.cleanSiteUrl(b.siteUrl)) issues.push('Falta la dirección de tu página (pestaña Cartel y QR). Sirve para el QR y para que se vea bonita al compartirla.');
    if (!working.products.some(p => p.available !== false)) issues.push('No hay ningún producto disponible.');
    if (usingDefaultPassword()) issues.push('Sigues usando la contraseña inicial. Cámbiala abajo.');
    return issues.length
      ? `<div class="adm-warn"><b>Antes de publicar, revisa:</b><ul>${issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`
      : '<div class="adm-ok">✓ Todo listo: puedes publicar tu catalog.json.</div>';
  }
  const usingDefaultPassword = () => (working.adminHash || App.DEFAULT_CATALOG.adminHash) === App.DEFAULT_CATALOG.adminHash;

  const tabCartel = () => '<div id="poster-box"><p class="adm-help">Cargando…</p></div>';

  function tabPublicar() {
    return `${checklist()}<div class="adm-section"><h3>1. Publicar para tus clientes</h3>
        <p class="adm-help">Tus cambios ya se ven en <b>este dispositivo</b>. Para que los vean todos tus clientes hay que publicarlos.</p>
        <div id="gh-box"><p class="adm-help">Cargando…</p></div>
        <details class="adm-details"><summary>Publicar a mano (sin GitHub)</summary>
          <p class="adm-help">Descarga el archivo y reemplaza <code>catalog.json</code> en tu página (donde la tengas publicada). Las fotos que subiste viajan dentro del archivo.</p>
          <button type="button" class="button" data-act="download">Descargar catalog.json ↓</button></details></div>
      <div class="adm-section"><h3>2. Contraseña</h3>
        <div class="adm-row"><label class="adm-field"><span>Nueva contraseña</span><input id="new-pass" type="password" autocomplete="new-password" minlength="10" /></label><label class="adm-field"><span>Repetir contraseña</span><input id="new-pass2" type="password" autocomplete="new-password" /></label></div>
        <button type="button" class="button" data-act="change-pass">Cambiar contraseña</button><p class="form-status" id="pass-status" aria-live="polite"></p>
        <p class="adm-help">Después de cambiarla, descarga y publica <code>catalog.json</code> para que valga en todos tus dispositivos.</p></div>
      <div class="adm-section"><h3>3. Otras opciones</h3>
        <div class="adm-actions"><button type="button" class="adm-link" data-act="discard">Descartar mis cambios sin publicar</button><button type="button" class="adm-link" data-act="reset">Restaurar el menú original</button><button type="button" class="adm-danger" data-act="logout">Cerrar sesión</button></div></div>
      <p class="adm-note">Seguridad: esta página no tiene servidor, así que el acceso protege el panel pero lo que ven tus clientes solo cambia cuando tú publicas el archivo <code>catalog.json</code>. Nadie más puede cambiarte los precios.</p>`;
  }

  /* ---------- Eventos ---------- */
  async function onField(event) {
    const el = event.target;
    if (el.dataset.upload != null && event.type === 'change') {
      const file = el.files[0]; if (!file) return;
      try { working.products[Number(el.dataset.upload)].image = await resizeImage(file); commit(true); renderTab('productos', true); }
      catch (error) { showToast(error.message); }
      return;
    }
    if (el.hasAttribute('data-upload-gallery') && event.type === 'change') {
      for (const file of el.files) { try { working.gallery.push({ src: await resizeImage(file, 1000), alt: 'Elotitos' }); } catch (error) { showToast(error.message); } }
      commit(true); renderTab('galeria', true);
      return;
    }
    if (el.dataset.quick) {
      const b = working.business;
      if (el.dataset.quick === 'transfer') b.payments = el.checked ? ['Efectivo', 'Transferencia'] : ['Efectivo'];
      if (el.dataset.quick === 'orders') b.ordersPaused = !el.checked;     // el interruptor dice "Recibiendo pedidos"
      commit(true);
      renderQuick();
      if (activeTab === 'negocio' || activeTab === 'publicar') renderTab(activeTab, true);
      showToast(el.dataset.quick === 'transfer'
        ? (el.checked ? 'Transferencia encendida. Publica para que la vean tus clientes.' : 'Transferencia apagada: solo efectivo. Publica para que se aplique.')
        : (el.checked ? 'Pedidos encendidos. Publica para que se aplique.' : 'Pedidos pausados. Publica para que se aplique.'));
      return;
    }
    if (el.dataset.sched != null) {
      const schedule = {};
      document.querySelectorAll('#adm-content .adm-day').forEach(row => {
        const day = row.querySelector('[data-part="on"]').dataset.sched;
        if (row.querySelector('[data-part="on"]').checked) schedule[day] = [row.querySelector('[data-part="open"]').value || '17:00', row.querySelector('[data-part="close"]').value || '22:00'];
        else schedule[day] = null;
      });
      working.business.schedule = Object.values(schedule).some(Boolean) ? schedule : null;
      commit();
      return;
    }
    const path = el.dataset.f;
    if (!path) return;
    let value;
    if (el.type === 'checkbox') value = el.checked;
    else if (el.type === 'number') value = el.value === '' ? 0 : Number(el.value);
    else if (el.dataset.kind === 'list') value = el.value.split(/[,\n]/).map(x => x.trim()).filter(Boolean);
    else value = el.value;
    setPath(working, path, value);
    const match = path.match(/^products\.(\d+)\.(name|price|available)$/);
    if (match) {   // se actualiza solo el título de la tarjeta, sin redibujar (así no se pierde el cursor)
      const p = working.products[Number(match[1])];
      const summary = el.closest('.adm-card')?.querySelector('summary');
      if (summary) {
        summary.querySelector('b').textContent = p.name || 'Producto nuevo';
        summary.querySelector('em').textContent = `$${p.price}`;
        summary.querySelector('.adm-off')?.remove();
        if (p.available === false) summary.insertAdjacentHTML('beforeend', '<i class="adm-off">Agotado</i>');
      }
    }
    commit();
  }

  async function onClick(event) {
    const tab = event.target.closest('[data-tab]');
    if (tab) { renderTab(tab.dataset.tab); return; }
    const btn = event.target.closest('[data-act]');
    if (!btn) return;
    const i = Number(btn.dataset.i);
    const act = btn.dataset.act;
    if (act === 'add-product') {
      working.products.push({ id: `${App.slug('nuevo')}-${Date.now().toString(36)}`, name: 'Producto nuevo', price: 30, category: 'otros', tag: '', available: true, spicy: false, description: 'Describe tu producto aquí.', ingredients: [], image: '' });
      commit(true); renderTab('productos');
      document.querySelector('#adm-content .adm-card:last-of-type')?.setAttribute('open', '');
    }
    if (act === 'add-extra') { const product = working.products[i]; (product.extras = product.extras || []).push({ name: '', price: 10 }); commit(true); renderTab('productos', true); document.querySelector(`#adm-content details[data-pid="${CSS.escape(product.id)}"] .adm-extra-row:last-of-type input`)?.focus(); }
    if (act === 'del-extra') { working.products[i].extras.splice(Number(btn.dataset.j), 1); commit(true); renderTab('productos', true); }
    if (act === 'goto-publish') renderTab('publicar');
    if (act === 'publish-now') { try { await loadModule('publish.js'); await window.ElotitosPublish.publishNow(); } catch (error) { showToast(error.message); } }
    if (act === 'del-product' && confirm(`¿Eliminar "${working.products[i].name}" del menú?`)) { working.products.splice(i, 1); commit(true); renderTab('productos', true); }
    if (act === 'up' && i > 0) { [working.products[i - 1], working.products[i]] = [working.products[i], working.products[i - 1]]; commit(true); renderTab('productos', true); }
    if (act === 'down' && i < working.products.length - 1) { [working.products[i + 1], working.products[i]] = [working.products[i], working.products[i + 1]]; commit(true); renderTab('productos', true); }
    if (act === 'clear-img') { working.products[i].image = ''; commit(true); renderTab('productos', true); }
    if (act === 'add-review') { (working.testimonials = working.testimonials || []).push({ name: 'Cliente', rating: 5, text: '' }); commit(true); renderTab('resenas', true); }
    if (act === 'del-review') { working.testimonials.splice(i, 1); commit(true); renderTab('resenas', true); }
    if (act === 'del-gal') { working.gallery.splice(i, 1); commit(true); renderTab('galeria', true); }
    if (act === 'download') download();
    if (act === 'change-pass') await changePassword();
    if (act === 'discard' && confirm('¿Descartar los cambios sin publicar y volver a la versión publicada?')) {
      localStorage.removeItem(STORAGE.draft);
      working = App.normalizeCatalog((await App.fetchPublishedCatalog()) || App.DEFAULT_CATALOG);
      App.setCatalog(working); renderQuick(); renderTab('productos'); showToast('Listo: volviste a la versión publicada.');
    }
    if (act === 'reset' && confirm('¿Restaurar el menú original? Se perderán tus cambios sin publicar.')) {
      working = App.normalizeCatalog(App.DEFAULT_CATALOG); commit(true); renderQuick(); renderTab('productos'); showToast('Menú original restaurado.');
    }
    if (act === 'logout') logout();
  }

  function download() {
    const data = JSON.stringify(App.publicCatalog(working), null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'catalog.json';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast('catalog.json descargado. Súbelo a tu página para publicarlo.');
  }
  async function changePassword() {
    const status = document.querySelector('#pass-status');
    const a = document.querySelector('#new-pass').value, b = document.querySelector('#new-pass2').value;
    if (a.length < 10) { status.textContent = 'Usa al menos 10 caracteres (mejor una frase larga).'; return; }
    if (a !== b) { status.textContent = 'Las contraseñas no coinciden.'; return; }
    working.adminHash = await sha256(a);
    commit(true);
    try { if (localStorage.getItem('elotitos-gh-vault-v1')) { await loadModule('publish.js'); await window.ElotitosPublish.rekey(a); } } catch { /* el token se vuelve a conectar */ }
    document.querySelector('#new-pass').value = ''; document.querySelector('#new-pass2').value = '';
    status.textContent = 'Contraseña cambiada. Descarga y publica catalog.json para que valga en todos tus dispositivos.';
  }
  async function logout() {
    try { sessionStorage.removeItem(STORAGE.admin); } catch { /* nada */ }
    try { window.ElotitosPublish?.lock(); } catch { /* nada */ }
    UI.closeLayers();
    App.setCatalog((await App.fetchPublishedCatalog()) || App.DEFAULT_CATALOG);
    document.querySelector('.admin-banner')?.setAttribute('hidden', '');
    showToast('Sesión cerrada.');
  }

  /* Lo que necesitan publish.js y poster.js del panel */
  const ctx = {
    App, UI, esc, showToast, sha256, setStatus, commit, renderQuick,
    getWorking: () => working,
    goto: tab => renderTab(tab),
    refresh: () => renderTab(activeTab, true)
  };
  window.ElotitosAdminCtx = ctx;

  window.ElotitosAdmin = {
    open() {
      let active = false;
      try { active = sessionStorage.getItem(STORAGE.admin) === '1'; } catch { /* nada */ }
      if (active) { working = loadWorking(App.readStore(STORAGE.draft, null) || App.getCatalog()); showPanel(); }
      else openLogin();
    },
    _sha256: sha256, _sha256Fallback: sha256Fallback
  };
})();
