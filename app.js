/* ==========================================================================
   ELOTITOS — app.js
   Todo el contenido editable (productos, precios, ingredientes, imágenes,
   datos del negocio, galería) vive en el CATÁLOGO. Se edita desde el panel
   de administrador (pie de página → "Administrador") y se publica con el
   archivo catalog.json. Este archivo normalmente no necesita tocarse.
   ========================================================================== */

/* ---------- Catálogo por defecto (si catalog.json no existe o no carga) ---------- */
const DEFAULT_CATALOG = {
  version: 2,
  // Contraseña inicial del administrador: Elotitos2026  → cámbiala en el panel (Seguridad)
  adminHash: 'c7f6069b2e0d40f9e393cad7f834e926eb22dfa95c6210058e3cf6d09d054171',
  business: {
    name: 'Elotitos',
    whatsapp: '522213698374',          // código de país (52) + número, solo dígitos
    location: '',
    mapsUrl: '',
    siteUrl: '',                       // dirección pública de tu página (https://…): cartel con QR y vista previa al compartir
    hours: '',
    schedule: null,                    // Ej. { 0:null, 1:['17:00','22:00'], ... }
    pickup: true,
    delivery: { enabled: false, fee: 0, note: '' },
    payments: ['Efectivo'],            // 'Transferencia' se activa con el interruptor “Pago por transferencia” del panel
    transfer: { bank: '', holder: '', account: '', concept: 'Pedido Elotitos' },
    ordersPaused: false,               // true = la página no recibe pedidos (interruptor “Recibiendo pedidos”)
    pauseMessage: '',                  // aviso que ve el cliente cuando los pedidos están pausados
    blockWhenClosed: false,            // true = no se aceptan pedidos fuera del horario
    socials: { instagram: '', tiktok: '', facebook: '' },
    // Datos que se muestran en el Aviso de privacidad y los Términos (se llenan en el panel)
    legal: { name: '', address: '', email: '' }
  },
  testimonials: [],                    // reseñas que tú eliges mostrar (panel → Reseñas)
  products: [
    { id: 'elote', name: 'Elote preparado', price: 30, category: 'elotes', tag: 'El favorito', available: true, spicy: true,
      description: 'Maíz tierno, mayonesa, queso, limoncito y el chile que tú elijas.',
      ingredients: ['Mayonesa', 'Queso', 'Limón', 'Sal'],
      image: 'assets/elote-card.webp' },
    { id: 'esquites', name: 'Esquites normal', price: 30, category: 'esquites', tag: 'Calientitos', available: true, spicy: true,
      description: 'Granos dulces y calientitos con todos sus acompañantes favoritos.',
      ingredients: ['Mayonesa', 'Queso', 'Limón', 'Crema', 'Sal'],
      image: 'assets/esquites-card.webp' },
    { id: 'esquites-grande', name: 'Esquites grande', price: 60, category: 'esquites', tag: 'Vaso grande', available: true, spicy: true,
      description: 'El mismo sabor en vaso grande, para cuando el antojo es de los grandes.',
      ingredients: ['Mayonesa', 'Queso', 'Limón', 'Crema', 'Sal'],
      image: 'assets/esquites-card.webp' }
  ],
  gallery: [
    { src: 'assets/gal-elote.svg', alt: 'Elote preparado con mayonesa, queso y chile en polvo' },
    { src: 'assets/gal-esquites.svg', alt: 'Vasito de esquites con queso, crema y limón' },
    { src: 'assets/gal-limon.svg', alt: 'Limones frescos' },
    { src: 'assets/gal-chile.svg', alt: 'Chiles rojos' },
    { src: 'assets/gal-queso.svg', alt: 'Queso' },
    { src: 'assets/gal-maiz.svg', alt: 'Mazorca de maíz tierno' }
  ]
};
const FALLBACK_IMG = { elotes: 'assets/elote.svg', esquites: 'assets/esquites.svg', otros: 'assets/elote.svg' };
const CATEGORY_LABEL = { elotes: 'Elotes', esquites: 'Esquites', otros: 'Otros' };

const STORAGE = {
  cart: 'elotitos-cart-v2', reviews: 'elotitos-reviews-v1', feedback: 'elotitos-feedback-v1',
  profile: 'elotitos-profile-v1', settings: 'elotitos-settings-v1',
  draft: 'elotitos-catalog-draft-v1', admin: 'elotitos-admin-session',
  catalogCache: 'elotitos-catalog-cache-v1'      // último menú publicado que vio este dispositivo (para mostrarlo al instante)
};
const readStore = (key, fallback) => {
  try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; }
  catch { return fallback; }
};
const saveStore = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
const isAdminSession = () => { try { return sessionStorage.getItem(STORAGE.admin) === '1'; } catch { return false; } };

/* ---------- Estado del catálogo ---------- */
const BUSINESS = {};
const PRODUCTS = {};
let catalog = null;

const clone = value => JSON.parse(JSON.stringify(value));
const slug = text => String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'producto';
function safeSrc(value) {
  const src = String(value || '').trim();
  return /^(assets\/|\.\/assets\/|https:\/\/|data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,)/i.test(src) ? src : '';
}
/* México: 10 dígitos -> se antepone 52; 521 + 10 dígitos -> 52 + 10 dígitos (formato que acepta wa.me) */
function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `52${digits}`;
  if (digits.length === 13 && digits.startsWith('521')) return `52${digits.slice(3)}`;
  return digits;
}
/* Dirección pública de la página: solo https. Acepta "midominio.com" y quita "index.html", ?x=… y #x */
function cleanSiteUrl(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || !url.hostname.includes('.')) return '';
    let path = url.pathname.replace(/\/{2,}/g, '/').replace(/index\.html?$/i, '');
    if (!path.endsWith('/')) path += '/';
    return `${url.origin}${path}`;
  } catch { return ''; }
}
const PAYMENT_METHODS = ['Efectivo', 'Transferencia'];
function normalizeCatalog(raw) {
  const base = clone(DEFAULT_CATALOG);
  const source = raw && typeof raw === 'object' ? raw : {};
  const sourceVersion = Number(source.version) || 1;
  const business = { ...base.business, ...(source.business || {}) };
  business.delivery = { ...base.business.delivery, ...(source.business?.delivery || {}) };
  business.transfer = { ...base.business.transfer, ...(source.business?.transfer || {}) };
  business.socials = { ...base.business.socials, ...(source.business?.socials || {}) };
  business.legal = { ...base.business.legal, ...(source.business?.legal || {}) };
  business.whatsapp = normalizePhone(business.whatsapp);
  /* Pagos: el efectivo siempre está; la transferencia solo si el administrador la activó.
     Los catálogos de la versión 1 la traían encendida por defecto: si nunca capturaron una cuenta, se toma como apagada. */
  let payments = Array.isArray(business.payments) ? business.payments.filter(method => PAYMENT_METHODS.includes(method)) : [];
  if (sourceVersion < 2 && !String(business.transfer.account || '').trim()) payments = payments.filter(method => method !== 'Transferencia');
  business.payments = payments.includes('Transferencia') ? ['Efectivo', 'Transferencia'] : ['Efectivo'];
  business.ordersPaused = business.ordersPaused === true;
  business.pauseMessage = String(business.pauseMessage || '').trim().slice(0, 160);
  business.blockWhenClosed = business.blockWhenClosed === true;
  business.siteUrl = cleanSiteUrl(business.siteUrl);
  const products = (Array.isArray(source.products) ? source.products : base.products).map((item, index) => ({
    id: String(item.id || `${slug(item.name || 'producto')}-${index}`),
    name: String(item.name || 'Producto').slice(0, 60),
    price: Math.max(0, Number(item.price) || 0),
    category: ['elotes', 'esquites', 'otros'].includes(item.category) ? item.category : 'otros',
    tag: String(item.tag || '').slice(0, 24),
    available: item.available !== false,
    spicy: item.spicy !== false,
    description: String(item.description || '').slice(0, 200),
    ingredients: (Array.isArray(item.ingredients) ? item.ingredients : []).map(x => String(x).trim()).filter(Boolean).slice(0, 14),
    /* Extras con costo, ej. { name: 'Queso extra', price: 10 }: se suman al precio del producto */
    extras: (Array.isArray(item.extras) ? item.extras : []).map(extra => ({ name: String(extra?.name || '').trim().slice(0, 40), price: Math.max(0, Number(extra?.price) || 0) })).filter(extra => extra.name).slice(0, 8),
    image: safeSrc(item.image)
  }));
  const gallery = (Array.isArray(source.gallery) ? source.gallery : base.gallery)
    .map(item => ({ src: safeSrc(item.src), alt: String(item.alt || 'Elotitos').slice(0, 120) })).filter(item => item.src);
  const testimonials = (Array.isArray(source.testimonials) ? source.testimonials : []).map(item => ({
    name: String(item.name || 'Cliente').slice(0, 40), rating: Math.min(5, Math.max(1, Math.round(Number(item.rating) || 5))), text: String(item.text || '').slice(0, 300)
  })).filter(item => item.text);
  return { version: 2, updatedAt: String(source.updatedAt || '').slice(0, 40), adminHash: source.adminHash || base.adminHash, business, products, gallery, testimonials };
}
/* Lo que sale a internet: con la transferencia apagada, los datos bancarios se quedan solo en el dispositivo del dueño */
function publicCatalog(raw) {
  const clean = normalizeCatalog(raw);
  if (!clean.business.payments.includes('Transferencia')) clean.business.transfer = { ...clean.business.transfer, bank: '', holder: '', account: '' };
  return clean;
}
function applyCatalog(raw) {
  catalog = normalizeCatalog(raw);
  Object.keys(BUSINESS).forEach(key => delete BUSINESS[key]);
  Object.assign(BUSINESS, catalog.business);
  Object.keys(PRODUCTS).forEach(key => delete PRODUCTS[key]);
  catalog.products.forEach(product => { PRODUCTS[product.id] = product; });
}
/* El "?v=" cambia cada minuto: así ninguna caché intermedia (CDN, operador móvil) se queda con un catálogo viejo */
async function fetchPublishedCatalog() {
  try {
    const response = await fetch(`catalog.json?v=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      const text = JSON.stringify(data);
      if (text.length < 400000) { try { localStorage.setItem(STORAGE.catalogCache, text); } catch { /* sin espacio */ } }
      return data;
    }
    if (response.status === 404) { try { localStorage.removeItem(STORAGE.catalogCache); } catch { /* nada */ } }
  } catch { /* sin conexión: se usa lo último que se vio */ }
  return null;
}
async function loadCatalog() {
  if (isAdminSession()) {
    const draft = readStore(STORAGE.draft, null);
    if (draft) return draft;
  }
  return (await fetchPublishedCatalog()) || readStore(STORAGE.catalogCache, null) || DEFAULT_CATALOG;
}

const ICON_CORN = '<svg width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true"><path fill="#F2B01E" d="M12 2c-3.3 0-5.5 3.6-5.5 8.6 0 4 2.1 7.4 5.5 7.4s5.5-3.4 5.5-7.4C17.5 5.6 15.3 2 12 2Z"/><path fill="#A9C23F" d="M4 12c-.5 4.2 3.2 8.4 8 10-4.2-3.4-5.4-6.4-8-10Zm16 0c.5 4.2-3.2 8.4-8 10 4.2-3.4 5.4-6.4 8-10Z"/></svg>';
const ICON_CHAT = '<svg width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M4 5h16v11H9l-5 4Z"/></svg>';

let cart = readStore(STORAGE.cart, []);
let selectedRating = 0;
let customProductId = null;
let toastTimer;
let activeFilter = 'todos';

const overlay = document.querySelector('#overlay');
const cartPanel = document.querySelector('.cart-panel');
const customModal = document.querySelector('#custom-modal');
const settingsModal = document.querySelector('#settings-modal');
const checkoutModal = document.querySelector('#checkout-modal');
const toast = document.querySelector('.toast');
const allDialogs = [cartPanel, customModal, settingsModal, checkoutModal];

function escapeHTML(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]); }
const money = value => `$${Number(value).toLocaleString('es-MX')} MXN`;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2900);
}

/* ---------- Capas (carrito, modales) ---------- */
let lastFocus = null;
const pageRegions = () => document.querySelectorAll('body > header, body > main, body > footer, body > .announcement, body > .skip-link');
function setPageInert(value) { pageRegions().forEach(region => { try { region.inert = value; } catch { /* navegador sin inert */ } }); }
function openLayer(target) {
  if (!document.body.classList.contains('panel-open')) lastFocus = document.activeElement;
  setPageInert(true);
  allDialogs.forEach(dialog => {
    dialog.classList.remove('open', 'active');
    if (dialog !== target) dialog.setAttribute('aria-hidden', 'true');
  });
  overlay.hidden = false;
  document.body.classList.add('panel-open');
  target.setAttribute('aria-hidden', 'false');
  if (target === cartPanel) target.classList.add('open');
  else { target.hidden = false; requestAnimationFrame(() => target.classList.add('active')); }
  const focusable = target.querySelector('button:not(:disabled), input:not(:disabled), textarea, select, a[href]');
  setTimeout(() => focusable?.focus(), 60);
}
function closeLayers() {
  allDialogs.forEach(dialog => {
    dialog.classList.remove('open', 'active');
    dialog.setAttribute('aria-hidden', 'true');
    if (dialog !== cartPanel) setTimeout(() => { if (!dialog.classList.contains('active')) dialog.hidden = true; }, 230);
  });
  document.querySelectorAll('.admin-modal').forEach(modal => { modal.classList.remove('active'); setTimeout(() => { if (!modal.classList.contains('active')) modal.hidden = true; }, 230); });
  overlay.hidden = true;
  document.body.classList.remove('panel-open');
  setPageInert(false);
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus?.({ preventScroll: true });
  lastFocus = null;
}
window.ElotitosUI = { openLayer, closeLayers, allDialogs };

const cartOpeners = document.querySelectorAll('.cart-trigger, .cart-bar');
cartOpeners.forEach(button => button.addEventListener('click', () => { renderCart(); openLayer(cartPanel); }));
document.querySelectorAll('.close-panel,.modal-close').forEach(button => button.addEventListener('click', closeLayers));
overlay.addEventListener('click', closeLayers);
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeLayers(); });
document.querySelectorAll('.settings-trigger').forEach(button => button.addEventListener('click', () => { closeMobileMenu(); applySettings(readStore(STORAGE.settings, {})); openLayer(settingsModal); }));

function closeMobileMenu() {
  const nav = document.querySelector('.mobile-nav');
  const trigger = document.querySelector('.mobile-menu-trigger');
  nav.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
}
document.querySelectorAll('.mobile-menu-trigger').forEach(button => button.addEventListener('click', () => {
  const nav = document.querySelector('.mobile-nav');
  const expanded = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!expanded));
  nav.hidden = expanded;
}));
document.querySelectorAll('.mobile-nav a').forEach(link => link.addEventListener('click', closeMobileMenu));

/* ---------- Menú dinámico ---------- */
const productGrid = document.querySelector('#product-grid');
const menuTabs = document.querySelector('#menu-tabs');
function imageFor(product) { return safeSrc(product.image) || FALLBACK_IMG[product.category] || FALLBACK_IMG.otros; }
function renderMenu() {
  const list = catalog.products;
  const categories = ['elotes', 'esquites', 'otros'].filter(cat => list.some(p => p.category === cat));
  if (activeFilter !== 'todos' && !categories.includes(activeFilter)) activeFilter = 'todos';
  menuTabs.innerHTML = `<button class="menu-tab ${activeFilter === 'todos' ? 'active' : ''}" data-filter="todos" role="tab" aria-selected="${activeFilter === 'todos'}">Todo <span>${String(list.length).padStart(2, '0')}</span></button>` +
    categories.map(cat => `<button class="menu-tab ${activeFilter === cat ? 'active' : ''}" data-filter="${cat}" role="tab" aria-selected="${activeFilter === cat}">${CATEGORY_LABEL[cat]}</button>`).join('');
  if (!list.length) { productGrid.innerHTML = '<p class="menu-empty">Pronto agregaremos productos al menú.</p>'; return; }
  productGrid.innerHTML = list.map(product => {
    const cutout = /-card\.webp$/.test(imageFor(product));
    const kind = product.category === 'esquites' ? 'product-image-cup' : 'product-image-corn';
    const grande = /grande/i.test(product.name) ? ' is-grande' : ' is-normal';
    const ingredients = (product.ingredients.length ? `<p class="product-ingredients"><b>Lleva:</b> ${product.ingredients.map(escapeHTML).join(' · ')}</p>` : '') +
      (product.extras.length ? `<p class="product-ingredients"><b>Extras:</b> ${product.extras.map(extra => `${escapeHTML(extra.name)} +$${extra.price}`).join(' · ')}</p>` : '');
    const hidden = activeFilter !== 'todos' && product.category !== activeFilter ? ' hidden' : '';
    return `<article class="product-card${product.available ? '' : ' is-soldout'}" data-category="${product.category}" data-id="${escapeHTML(product.id)}"${hidden}>
      <div class="product-image ${kind}${cutout ? grande : ' is-photo'}">
        ${product.tag ? `<span class="product-tag">${escapeHTML(product.tag)}</span>` : ''}
        ${product.available ? '' : '<span class="soldout-badge">Agotado</span>'}
        <img src="${escapeHTML(imageFor(product))}" data-fallback="${FALLBACK_IMG[product.category] || FALLBACK_IMG.otros}" width="480" height="600" alt="${escapeHTML(product.name)}" loading="lazy" decoding="async" />
        ${product.available ? `<button class="button product-quick-add" data-add="${escapeHTML(product.id)}" aria-label="Agregar ${escapeHTML(product.name)}">+</button>` : ''}
      </div>
      <div class="product-info">
        <div class="product-title-row"><h3>${escapeHTML(product.name)}</h3><span class="product-price">$${product.price}</span></div>
        <p class="product-desc">${escapeHTML(product.description)}</p>${ingredients}
        <div class="product-meta"><span><small>${product.spicy ? 'Picante a tu gusto' : 'Listo para disfrutar'}</small></span>${product.available ? `<button class="button" data-customize="${escapeHTML(product.id)}">Personalizar <span>↗</span></button>` : '<small>No disponible hoy</small>'}</div>
      </div>
    </article>`;
  }).join('');
  productGrid.querySelectorAll('img').forEach(img => img.addEventListener('error', () => {
    const fallback = img.dataset.fallback;
    if (fallback && !img.src.endsWith(fallback)) { img.closest('.product-image')?.classList.add('is-photo'); img.src = fallback; }
  }, { once: true }));
  renderOrderGate();
}
menuTabs.addEventListener('click', event => {
  const tab = event.target.closest('.menu-tab');
  if (!tab) return;
  activeFilter = tab.dataset.filter;
  menuTabs.querySelectorAll('.menu-tab').forEach(item => { item.classList.toggle('active', item === tab); item.setAttribute('aria-selected', String(item === tab)); });
  productGrid.querySelectorAll('.product-card').forEach(card => { card.hidden = activeFilter !== 'todos' && card.dataset.category !== activeFilter; card.classList.add('in'); });
});
productGrid.addEventListener('click', event => {
  const add = event.target.closest('[data-add]');
  const customize = event.target.closest('[data-customize]');
  if (add) addToCart(add.dataset.add);
  if (customize) openCustomizer(customize.dataset.customize);
});

/* ---------- Galería ---------- */
function renderGallery() {
  const root = document.querySelector('#gallery-grid');
  const section = document.querySelector('#galeria');
  if (!root) return;
  section.hidden = !catalog.gallery.length;
  root.innerHTML = catalog.gallery.map((item, index) =>
    `<figure class="gallery-item gi-${index % 6}"><img src="${escapeHTML(item.src)}" alt="${escapeHTML(item.alt)}" loading="lazy" decoding="async" /></figure>`).join('');
}

/* ---------- Carrito ---------- */
const sumPrices = list => list.reduce((sum, entry) => sum + entry.price, 0);
function addToCart(productId, options = null) {
  const product = PRODUCTS[productId];
  if (!product || !product.available) return;
  const gate = orderGate();
  if (!gate.ok) { showToast(gate.message); return; }
  const selection = options ?? { spice: product.spicy ? 'Sin chile' : '', toppings: [...product.ingredients], extras: [], note: '' };
  const extras = (selection.extras || []).map(extra => ({ name: extra.name, price: extra.price }));
  /* "price" es el precio de UNA pieza ya con sus extras */
  cart.push({ key: `${product.id}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, id: product.id, name: product.name, price: product.price + sumPrices(extras), spice: selection.spice, toppings: selection.toppings, extras, note: selection.note, quantity: 1 });
  saveStore(STORAGE.cart, cart);
  renderCart();
  showToast(`${product.name} agregado a tu pedido ✳`);
}
/* Pone el carrito al día con el catálogo (precios, extras, productos que ya no están). Devuelve qué cambió. */
function syncCartWithCatalog() {
  const removed = cart.filter(item => !PRODUCTS[item.id]?.available).map(item => item.name);
  let repriced = false;
  cart = cart.filter(item => PRODUCTS[item.id]?.available).map(item => {
    const product = PRODUCTS[item.id];
    const extras = (item.extras || []).map(extra => product.extras.find(current => current.name === extra.name)).filter(Boolean).map(extra => ({ name: extra.name, price: extra.price }));
    const price = product.price + sumPrices(extras);
    if (price !== item.price) repriced = true;
    return { ...item, name: product.name, price, extras };
  });
  saveStore(STORAGE.cart, cart);
  return { removed: [...new Set(removed)], repriced };
}
const customForm = document.querySelector('#custom-form');
const customSubmit = document.querySelector('#custom-submit');
const selectedExtras = (product, form) => form.getAll('extra').map(index => product.extras[Number(index)]).filter(Boolean);
function updateCustomTotal() {
  const product = PRODUCTS[customProductId];
  if (!product) return;
  customSubmit.innerHTML = `Agregar al antojo · ${money(product.price + sumPrices(selectedExtras(product, new FormData(customForm))))} <span>↗</span>`;
}
function openCustomizer(productId) {
  const product = PRODUCTS[productId];
  if (!product) return;
  const gate = orderGate();
  if (!gate.ok) { showToast(gate.message); return; }
  customProductId = productId;
  document.querySelector('#custom-title').textContent = 'Arma tu antojo';
  document.querySelector('#custom-product-summary').innerHTML = `<b>${escapeHTML(product.name)}</b><span>$${product.price} MXN</span>`;
  customForm.reset();
  document.querySelector('#spice-field').hidden = !product.spicy;
  document.querySelector('#topping-field').hidden = !product.ingredients.length;
  document.querySelector('#topping-options').innerHTML = product.ingredients.map(name =>
    `<label><input type="checkbox" name="topping" value="${escapeHTML(name)}" checked /><span>${escapeHTML(name)}</span></label>`).join('');
  document.querySelector('#extras-field').hidden = !product.extras.length;
  document.querySelector('#extras-options').innerHTML = product.extras.map((extra, index) =>
    `<label><input type="checkbox" name="extra" value="${index}" /><span>${escapeHTML(extra.name)} <b>+$${extra.price}</b></span></label>`).join('');
  document.querySelector('#order-note').value = '';
  updateCustomTotal();
  openLayer(customModal);
}
customForm.addEventListener('change', updateCustomTotal);
customForm.addEventListener('submit', event => {
  event.preventDefault();
  const product = PRODUCTS[customProductId];
  if (!product) return;
  const form = new FormData(customForm);
  addToCart(customProductId, {
    spice: product.spicy ? (form.get('spice') || 'Sin chile') : '',
    toppings: form.getAll('topping'),
    extras: selectedExtras(product, form),
    note: document.querySelector('#order-note').value.trim()
  });
  closeLayers();
});

function cartTotal() { return cart.reduce((sum, item) => sum + item.price * item.quantity, 0); }
function renderCart() {
  const itemsRoot = document.querySelector('#cart-items');
  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartCount = document.querySelector('.cart-count');
  cartCount.textContent = totalItems;
  cartCount.setAttribute('aria-label', `${totalItems} productos`);
  const bar = document.querySelector('.cart-bar');
  if (bar) {
    bar.hidden = !totalItems;
    bar.querySelector('[data-bar-count]').textContent = `${totalItems} ${totalItems === 1 ? 'producto' : 'productos'}`;
    bar.querySelector('[data-bar-total]').textContent = money(cartTotal());
  }
  document.body.classList.toggle('has-cart-bar', totalItems > 0);
  if (!totalItems) {
    itemsRoot.innerHTML = `<div class="cart-empty"><span>${ICON_CORN}</span><b>Tu carrito está esperando</b><small>Elige un antojito para empezar.</small><button class="button button-primary cart-go-menu">Ver el menú <span>↗</span></button></div>`;
    document.querySelector('.cart-footer').hidden = true;
    itemsRoot.querySelector('.cart-go-menu').addEventListener('click', () => { closeLayers(); document.querySelector('#menu').scrollIntoView({ behavior: 'smooth' }); });
    return;
  }
  itemsRoot.innerHTML = cart.map(item => {
    const choices = [item.spice, ...(item.toppings || []), ...(item.extras || []).map(extra => `+ ${extra.name} ($${extra.price})`), item.note].filter(Boolean).join(' · ');
    return `<article class="cart-item"><span class="cart-item-name">${escapeHTML(item.name)}</span><span class="cart-item-price">$${item.price * item.quantity}</span><span class="cart-item-custom">${escapeHTML(choices)}</span><div class="cart-item-controls"><button type="button" data-qty="-1" data-key="${item.key}" aria-label="Quitar uno">−</button><span>${item.quantity}</span><button type="button" data-qty="1" data-key="${item.key}" aria-label="Agregar uno">+</button><button type="button" data-remove="${item.key}">Quitar</button></div></article>`;
  }).join('');
  document.querySelector('#cart-total').textContent = money(cartTotal());
  document.querySelector('.cart-footer').hidden = false;
  itemsRoot.querySelectorAll('[data-qty]').forEach(button => button.addEventListener('click', () => updateQuantity(button.dataset.key, Number(button.dataset.qty))));
  itemsRoot.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => { cart = cart.filter(item => item.key !== button.dataset.remove); saveStore(STORAGE.cart, cart); renderCart(); }));
}
function updateQuantity(key, increment) {
  const item = cart.find(row => row.key === key);
  if (!item) return;
  item.quantity += increment;
  if (item.quantity <= 0) cart = cart.filter(row => row.key !== key);
  saveStore(STORAGE.cart, cart);
  renderCart();
}

/* ---------- Horario: abierto / cerrado ---------- */
const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const toMinutes = value => { const [h, m] = value.split(':').map(Number); return h * 60 + (m || 0); };
const formatTime = value => { const [h, m] = value.split(':').map(Number); const hour12 = ((h + 11) % 12) + 1; return `${hour12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'am' : 'pm'}`; };
/* El letrero Abierto/Cerrado siempre usa la hora de México, sin importar dónde esté el cliente */
function mxNow() {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
    const get = type => parts.find(part => part.type === type)?.value;
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    if (day < 0) return new Date();
    return { getDay: () => day, getHours: () => Number(get('hour')) % 24, getMinutes: () => Number(get('minute')) };
  } catch { return new Date(); }
}
function getOpenState(now = mxNow()) {
  if (!BUSINESS.schedule) return null;
  const today = BUSINESS.schedule[now.getDay()];
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (today && minutes >= toMinutes(today[0]) && minutes < toMinutes(today[1])) return { open: true, text: `Abierto ahora · hasta las ${formatTime(today[1])}` };
  if (today && minutes < toMinutes(today[0])) return { open: false, text: `Cerrado · abrimos hoy a las ${formatTime(today[0])}` };
  for (let i = 1; i <= 7; i++) {
    const day = (now.getDay() + i) % 7;
    const slot = BUSINESS.schedule[day];
    if (slot) return { open: false, text: `Cerrado · abrimos ${i === 1 ? 'mañana' : 'el ' + DAY_NAMES[day]} a las ${formatTime(slot[0])}` };
  }
  return { open: false, text: 'Cerrado por ahora' };
}
function renderOpenState() {
  const state = getOpenState();
  document.querySelectorAll('[data-open-status-sep]').forEach(node => { node.hidden = !state; });
  document.querySelectorAll('[data-open-status]').forEach(node => {
    node.hidden = !state;
    if (!state) return;
    node.textContent = state.text;
    node.classList.toggle('is-open', state.open);
    node.classList.toggle('is-closed', !state.open);
  });
}

/* ---------- ¿Se pueden hacer pedidos ahora? ---------- */
/* Se pausan con el interruptor “Recibiendo pedidos” del panel, o solos fuera de horario si el administrador lo pidió. */
function orderGate() {
  if (BUSINESS.ordersPaused) return { ok: false, reason: 'paused', message: BUSINESS.pauseMessage || 'Por ahora no estamos recibiendo pedidos. ¡Vuelve pronto!' };
  if (BUSINESS.blockWhenClosed) {
    const state = getOpenState();
    if (state && !state.open) return { ok: false, reason: 'closed', message: `${state.text}. Fuera de horario no recibimos pedidos.` };
  }
  return { ok: true, reason: '', message: '' };
}
function renderOrderGate() {
  const gate = orderGate();
  const banner = document.querySelector('#order-gate');
  if (banner) { banner.hidden = gate.ok; banner.textContent = gate.message; banner.dataset.reason = gate.reason; }
  const note = document.querySelector('#cart-gate-note');
  if (note) { note.hidden = gate.ok; note.textContent = gate.message; }
  const checkout = document.querySelector('.checkout-button');
  if (checkout) checkout.disabled = !gate.ok;
  document.querySelectorAll('[data-add],[data-customize]').forEach(button => { button.disabled = !gate.ok; button.setAttribute('aria-disabled', String(!gate.ok)); });
  document.body.classList.toggle('orders-blocked', !gate.ok);
}

/* ---------- Pedido por WhatsApp ---------- */
const checkoutForm = document.querySelector('#checkout-form');
const waPhone = () => (BUSINESS.whatsapp || '').replace(/\D/g, '');
function currentFulfillment() { return checkoutForm.querySelector('[name="fulfillment"]:checked')?.value || 'pickup'; }
function currentPayment() { return checkoutForm.querySelector('[name="payment"]:checked')?.value || 'Efectivo'; }
function renderTransferInfo() {
  const box = checkoutForm.querySelector('#transfer-info');
  const t = BUSINESS.transfer || {};
  const rows = [['Banco', t.bank], ['A nombre de', t.holder], ['CLABE / cuenta / tarjeta', t.account], ['Concepto', t.concept]].filter(([, v]) => v);
  box.hidden = currentPayment() !== 'Transferencia';
  if (box.hidden) return;
  box.innerHTML = rows.length
    ? `<b>Datos para tu transferencia</b>${rows.map(([k, v]) => `<div><span>${k}</span><strong>${escapeHTML(v)}</strong></div>`).join('')}${t.account ? '<button type="button" class="copy-account">Copiar cuenta</button>' : ''}<small>Haz tu transferencia y envía el comprobante por WhatsApp junto con tu pedido.</small>`
    : '<b>Pago por transferencia</b><small>Te enviaremos los datos de la cuenta por WhatsApp al confirmar tu pedido.</small>';
  box.querySelector('.copy-account')?.addEventListener('click', () => { navigator.clipboard?.writeText(t.account).then(() => showToast('Cuenta copiada')).catch(() => showToast('No se pudo copiar')); });
}
function updateCheckoutView() {
  const delivery = currentFulfillment() === 'delivery';
  checkoutForm.querySelector('#delivery-fields').hidden = !delivery;
  checkoutForm.querySelector('#checkout-address').required = delivery;
  const fee = delivery ? (BUSINESS.delivery.fee || 0) : 0;
  const subtotal = cartTotal();
  checkoutForm.querySelector('#checkout-summary').innerHTML =
    `<div><span>Subtotal</span><b>${money(subtotal)}</b></div>` +
    (delivery ? `<div><span>Envío</span><b>${fee ? money(fee) : 'Sin costo'}</b></div>` : '') +
    `<div class="checkout-total"><span>Total</span><b>${money(subtotal + fee)}</b></div>`;
  checkoutForm.querySelector('#schedule-field').hidden = checkoutForm.querySelector('[name="when"]:checked').value !== 'later';
  checkoutForm.querySelector('#cash-field').hidden = currentPayment() !== 'Efectivo';
  renderTransferInfo();
}
function openCheckout() {
  if (!cart.length) { showToast('Agrega algo a tu pedido primero.'); return; }
  const gate = orderGate();
  if (!gate.ok) { showToast(gate.message); return; }
  const profile = readStore(STORAGE.profile, {});
  const optionsRoot = checkoutForm.querySelector('#fulfillment-options');
  const options = [];
  if (BUSINESS.pickup !== false) options.push(['pickup', 'Paso por mi pedido']);
  if (BUSINESS.delivery?.enabled) options.push(['delivery', `A domicilio${BUSINESS.delivery.fee ? ` (+$${BUSINESS.delivery.fee})` : ''}`]);
  if (!options.length) options.push(['pickup', 'Paso por mi pedido']);
  optionsRoot.innerHTML = options.map(([value, label], index) => `<label><input type="radio" name="fulfillment" value="${value}" ${index === 0 ? 'checked' : ''} /><span>${label}</span></label>`).join('');
  optionsRoot.querySelectorAll('input').forEach(input => input.addEventListener('change', updateCheckoutView));
  const payments = BUSINESS.payments?.length ? BUSINESS.payments : ['Efectivo'];
  const icons = { Efectivo: '💵', Transferencia: '🏦' };
  const paymentRoot = checkoutForm.querySelector('#payment-options');
  paymentRoot.innerHTML = payments.map((method, index) =>
    `<label class="pay-option"><input type="radio" name="payment" value="${escapeHTML(method)}" ${index === 0 ? 'checked' : ''} /><span><i aria-hidden="true">${icons[method] || '💳'}</i><b>${escapeHTML(method)}</b></span></label>`).join('');
  paymentRoot.querySelectorAll('input').forEach(input => input.addEventListener('change', updateCheckoutView));
  checkoutForm.querySelector('#checkout-name').value = profile.name || '';
  checkoutForm.querySelector('#checkout-address').value = profile.address || '';
  checkoutForm.querySelector('#checkout-note').value = '';
  checkoutForm.querySelector('#checkout-cash').value = '';
  checkoutForm.querySelector('[name="when"][value="now"]').checked = true;
  checkoutForm.querySelector('#delivery-note').textContent = BUSINESS.delivery?.note || '';
  const state = getOpenState();
  const statusNode = checkoutForm.querySelector('#checkout-open-note');
  statusNode.hidden = !state || state.open;
  if (state && !state.open) statusNode.textContent = `${state.text}. Puedes dejar tu pedido y te lo confirmamos al abrir.`;
  checkoutForm.querySelector('.form-status').textContent = '';
  updateCheckoutView();
  openLayer(checkoutModal);
}
document.querySelector('.checkout-button').addEventListener('click', openCheckout);
checkoutForm.querySelectorAll('[name="when"]').forEach(input => input.addEventListener('change', updateCheckoutView));

function buildOrderMessage(data) {
  const delivery = data.fulfillment === 'delivery';
  const fee = delivery ? (BUSINESS.delivery.fee || 0) : 0;
  const transfer = data.payment === 'Transferencia';
  const lines = cart.map(item => {
    const choices = [item.spice, ...(item.toppings || [])].filter(Boolean).join(', ');
    const extras = (item.extras || []).length ? `Extras: ${item.extras.map(extra => `${extra.name} (+$${extra.price})`).join(', ')}` : '';
    const detail = [choices, extras].filter(Boolean).join(' · ');
    return `• ${item.quantity} × ${item.name} ($${item.price * item.quantity})${detail ? ` — ${detail}` : ''}${item.note ? ` (${item.note})` : ''}`;
  });
  const rows = [
    `*Nuevo pedido — ${BUSINESS.name}*`,
    '',
    `*Cliente:* ${data.name}`,
    `*Entrega:* ${delivery ? 'A domicilio' : 'Recoger en el puesto'}`,
    delivery ? `*Dirección:* ${data.address}` : null,
    `*Hora:* ${data.when === 'later' && data.time ? formatTime(data.time) : 'Lo antes posible'}`,
    `*Pago:* ${data.payment}${data.payment === 'Efectivo' && data.cash ? ` (paga con $${data.cash})` : ''}${transfer ? ' (enviaré mi comprobante por aquí)' : ''}`,
    '',
    '*Pedido:*',
    ...lines,
    '',
    `Subtotal: ${money(cartTotal())}`,
    delivery ? `Envío: ${fee ? money(fee) : 'Sin costo'}` : null,
    `*Total: ${money(cartTotal() + fee)}*`,
    data.note ? `\n*Notas:* ${data.note}` : null
  ];
  return rows.filter(row => row !== null).join('\n');
}
checkoutForm.addEventListener('submit', event => {
  event.preventDefault();
  const gate = orderGate();     // por si cambió mientras el cliente llenaba el formulario
  if (!gate.ok) { checkoutForm.querySelector('.form-status').textContent = gate.message; return; }
  const form = new FormData(checkoutForm);
  const data = {
    name: String(form.get('name') || '').trim(),
    fulfillment: form.get('fulfillment') || 'pickup',
    address: String(form.get('address') || '').trim(),
    when: form.get('when') || 'now',
    time: String(form.get('time') || ''),
    payment: String(form.get('payment') || 'Efectivo'),
    cash: String(form.get('cash') || '').trim(),
    note: String(form.get('note') || '').trim()
  };
  if (data.when === 'later' && !data.time) { checkoutForm.querySelector('.form-status').textContent = 'Elige a qué hora pasas por tu pedido.'; return; }
  saveStore(STORAGE.profile, { ...readStore(STORAGE.profile, {}), name: data.name, address: data.address });
  const message = buildOrderMessage(data);
  const phone = waPhone();
  if (!phone) {
    navigator.clipboard?.writeText(message).catch(() => {});
    checkoutForm.querySelector('.form-status').textContent = 'Todavía no hay WhatsApp configurado; copiamos el pedido.';
    return;
  }
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  const opened = window.open(url, '_blank', 'noopener');
  if (!opened) location.href = url;   // algunos navegadores móviles bloquean ventanas nuevas
  cart = []; saveStore(STORAGE.cart, cart); renderCart(); closeLayers();
  showToast('¡Pedido listo! Solo envía el mensaje en WhatsApp ✳');
});

/* ---------- Reseñas y comentarios ---------- */
document.querySelectorAll('.rating-picker button').forEach(button => button.addEventListener('click', () => {
  selectedRating = Number(button.dataset.rating);
  document.querySelectorAll('.rating-picker button').forEach(star => { star.classList.toggle('selected', Number(star.dataset.rating) <= selectedRating); star.textContent = Number(star.dataset.rating) <= selectedRating ? '★' : '☆'; star.setAttribute('aria-checked', String(Number(star.dataset.rating) === selectedRating)); });
}));
const reviewForm = document.querySelector('#review-form');
function sendToOwner(text, statusNode, doneMessage) {
  const phone = waPhone();
  if (!phone) { statusNode.textContent = 'Por ahora no podemos recibir mensajes por aquí. Inténtalo más tarde.'; return false; }
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  const opened = window.open(url, '_blank', 'noopener');
  if (!opened) location.href = url;
  statusNode.textContent = doneMessage;
  return true;
}
reviewForm.addEventListener('submit', event => {
  event.preventDefault();
  const status = reviewForm.querySelector('.form-status');
  if (!selectedRating) { status.textContent = 'Elige una calificación para continuar.'; return; }
  const name = document.querySelector('#review-name').value.trim() || 'Un cliente';
  const text = `*Reseña para ${BUSINESS.name}*\n${'★'.repeat(selectedRating)}${'☆'.repeat(5 - selectedRating)}\n${document.querySelector('#review-message').value.trim()}\n— ${name}`;
  if (!sendToOwner(text, status, '¡Gracias! Se abrió WhatsApp para enviarnos tu reseña.')) return;
  reviewForm.reset(); selectedRating = 0;
  document.querySelectorAll('.rating-picker button').forEach(star => { star.classList.remove('selected'); star.textContent = '☆'; });
});
document.querySelectorAll('.feedback-tab').forEach(tab => tab.addEventListener('click', () => {
  document.querySelectorAll('.feedback-tab').forEach(item => { item.classList.toggle('active', item === tab); item.setAttribute('aria-selected', String(item === tab)); });
  const isReview = tab.dataset.panel === 'review';
  reviewForm.hidden = !isReview;
  document.querySelector('#feedback-form').hidden = isReview;
}));
document.querySelector('#feedback-form').addEventListener('submit', event => {
  event.preventDefault();
  const form = event.currentTarget;
  const type = document.querySelector('#feedback-type').value;
  const label = type === 'queja' ? 'Queja / algo que mejorar' : 'Idea o sugerencia';
  const name = document.querySelector('#feedback-name').value.trim();
  const text = `*${label}*${name ? ` de ${name}` : ''}:\n${document.querySelector('#feedback-message').value.trim()}`;
  if (sendToOwner(text, form.querySelector('.form-status'), '¡Gracias! Se abrió WhatsApp para enviarnos tu mensaje.')) form.reset();
});
function renderReviews() {
  const reviews = catalog?.testimonials || [];
  document.querySelector('#review-count').textContent = `${reviews.length} ${reviews.length === 1 ? 'reseña' : 'reseñas'}`;
  const root = document.querySelector('#review-list');
  if (!reviews.length) {
    root.innerHTML = `<div class="empty-reviews"><span>${ICON_CHAT}</span><p>Aquí verás lo que dicen nuestros clientes.<br /><small>Cuéntanos qué te pareció tu antojo.</small></p><a href="#contacto">Escribir una reseña ↓</a></div>`;
    return;
  }
  root.innerHTML = reviews.map(review => `<article class="review-card"><span class="review-author">${escapeHTML(review.name)}</span><span class="review-stars" aria-label="${review.rating} de 5 estrellas">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</span><p>${escapeHTML(review.text)}</p></article>`).join('');
}

/* ---------- Accesibilidad ---------- */
const settingsControls = { 'large-text-toggle': 'largeText', 'contrast-toggle': 'highContrast', 'motion-toggle': 'reducedMotion' };
function applySettings(settings) {
  document.body.classList.toggle('large-text', !!settings.largeText);
  document.body.classList.toggle('high-contrast', !!settings.highContrast);
  document.body.classList.toggle('reduced-motion', !!settings.reducedMotion);
  Object.entries(settingsControls).forEach(([id, key]) => { const control = document.getElementById(id); if (control) control.checked = !!settings[key]; });
}
applySettings(readStore(STORAGE.settings, {}));
Object.entries(settingsControls).forEach(([id, key]) => document.getElementById(id).addEventListener('change', event => {
  const settings = readStore(STORAGE.settings, {});
  settings[key] = event.target.checked;
  saveStore(STORAGE.settings, settings);
  applySettings(settings);
}));

document.querySelector('#clear-data')?.addEventListener('click', () => {
  ['cart', 'profile', 'settings', 'reviews', 'feedback'].forEach(key => { try { localStorage.removeItem(STORAGE[key]); } catch { /* nada */ } });
  cart = []; renderCart(); applySettings({}); closeLayers();
  showToast('Listo: borramos tus datos de este dispositivo.');
});

/* ---------- Datos del negocio en la página ---------- */
let openTimer = null;
function fillBusinessInfo() {
  document.querySelector('#business-location').textContent = BUSINESS.location || 'Punto de venta por anunciar';
  document.querySelector('#business-hours').textContent = BUSINESS.hours || 'Horario por anunciar';
  const socials = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook' };
  document.querySelectorAll('.social-link').forEach(link => {
    const platform = Object.keys(socials).find(key => link.textContent.trim().startsWith(socials[key]));
    const url = platform && BUSINESS.socials?.[platform];
    if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `${socials[platform]} de ${BUSINESS.name}`); link.onclick = null; }
    else { link.href = '#contacto'; link.removeAttribute('target'); link.onclick = event => { event.preventDefault(); document.querySelector('#contacto').scrollIntoView({ behavior: 'smooth' }); showToast('Pronto anunciaremos nuestras redes sociales.'); }; }
  });
  document.querySelector('#year').textContent = new Date().getFullYear();
  const mapsLink = document.querySelector('#maps-link');
  if (mapsLink) { mapsLink.hidden = !BUSINESS.mapsUrl; if (BUSINESS.mapsUrl) mapsLink.href = BUSINESS.mapsUrl; }
  const phone = waPhone();
  let fab = document.querySelector('.wa-fab');
  if (phone && !fab) {
    fab = document.createElement('a');
    fab.className = 'wa-fab';
    fab.target = '_blank'; fab.rel = 'noopener';
    fab.setAttribute('aria-label', 'Escríbenos por WhatsApp');
    fab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3Z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-.9.8c-1-.4-2-1.4-2.4-2.4l.8-.9-1-2Z"/></svg><span>WhatsApp</span>';
    document.body.appendChild(fab);
  }
  if (fab) { fab.hidden = !phone; fab.href = `https://wa.me/${phone}?text=${encodeURIComponent(`Hola, tengo una duda sobre ${BUSINESS.name}.`)}`; }
  let schema = document.querySelector('#schema-ld');
  if (!schema) { schema = document.createElement('script'); schema.type = 'application/ld+json'; schema.id = 'schema-ld'; document.head.appendChild(schema); }
  schema.textContent = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'FoodEstablishment', name: BUSINESS.name, servesCuisine: 'Mexicana', priceRange: '$',
    ...(phone ? { telephone: `+${phone}` } : {}),
    ...(BUSINESS.location ? { address: { '@type': 'PostalAddress', streetAddress: BUSINESS.location, addressCountry: 'MX' } } : {}),
    ...(BUSINESS.mapsUrl ? { hasMap: BUSINESS.mapsUrl } : {})
  }).replace(/</g, '\\u003c');
  renderOpenState();
  if (!openTimer) openTimer = setInterval(() => { renderOpenState(); renderOrderGate(); }, 60000);
}
/* El texto bajo "Pagar mi pedido" depende de las formas de pago activas */
function renderCartFootnote() {
  const note = document.querySelector('#cart-footnote');
  if (!note) return;
  note.textContent = BUSINESS.payments?.includes('Transferencia')
    ? 'Elige efectivo o transferencia y envía tu pedido por WhatsApp.'
    : 'Pagas en efectivo al recibir o recoger. Envía tu pedido por WhatsApp.';
}

function renderAll({ sync = true } = {}) {
  renderMenu();
  renderGallery();
  fillBusinessInfo();
  const result = sync ? syncCartWithCatalog() : { removed: [], repriced: false };
  renderCart();
  renderReviews();
  renderCartFootnote();
  renderOrderGate();
  if (result.removed.length) showToast(`Quitamos de tu pedido: ${result.removed.join(', ')} (ya no está disponible).`);
  else if (result.repriced && !isAdminSession()) showToast('Actualizamos los precios de tu pedido.');
  document.querySelector('.admin-banner')?.toggleAttribute('hidden', !isAdminSession());
}
/* Lo que cambie el administrador se aplica al instante en su dispositivo */
let catalogReady = Promise.resolve();
window.ElotitosApp = {
  DEFAULT_CATALOG, STORAGE, normalizeCatalog, publicCatalog, safeSrc, escapeHTML, showToast, slug, readStore, saveStore, fetchPublishedCatalog,
  normalizePhone, cleanSiteUrl, getCatalog: () => clone(catalog),
  get ready() { return catalogReady; },
  setCatalog(raw) { applyCatalog(raw); renderAll(); return clone(catalog); }
};

/* ---------- Instalar como app, compartir, service worker ---------- */
let installPrompt = null;
const installButton = document.querySelector('#install-app');
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; installButton.textContent = 'Instalar'; });
installButton.addEventListener('click', async () => {
  if (!installPrompt) { showToast('En Chrome, abre ⋮ y elige “Instalar aplicación” o “Añadir a pantalla de inicio”.'); return; }
  installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  if (choice.outcome === 'accepted') showToast('Elotitos se está instalando ✳');
  installPrompt = null;
});
window.addEventListener('appinstalled', () => showToast('¡Listo! Ya tienes Elotitos en tu pantalla de inicio.'));
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
const shareButton = document.querySelector('#share-site');
if (shareButton) shareButton.addEventListener('click', async () => {
  if (location.protocol === 'file:') { showToast('Primero publica la página para tener un enlace que compartir.'); return; }
  const data = { title: `${BUSINESS.name} — antojos que alegran`, text: `Pide tus elotes y esquites en ${BUSINESS.name}`, url: BUSINESS.siteUrl || location.href.split('#')[0] };
  try {
    if (navigator.share) await navigator.share(data);
    else { await navigator.clipboard.writeText(data.url); showToast('Enlace copiado. ¡Compártelo!'); }
  } catch { /* el usuario canceló */ }
});

/* ---------- Administrador: se carga solo cuando se necesita ---------- */
let adminLoading = null;
function loadAdmin() {
  if (window.ElotitosAdmin) return Promise.resolve();
  if (!adminLoading) adminLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'admin.js';
    script.onload = resolve;
    script.onerror = () => { adminLoading = null; reject(new Error('No se pudo cargar admin.js')); };
    document.head.appendChild(script);
  });
  return adminLoading;
}
async function openAdmin() {
  closeMobileMenu();
  try {
    /* Se espera al catálogo publicado (máx. 5 s) para no validar la contraseña contra el menú de ejemplo */
    await Promise.all([loadAdmin(), Promise.race([catalogReady, new Promise(resolve => setTimeout(resolve, 5000))])]);
    window.ElotitosAdmin.open();
  } catch { showToast('No se pudo abrir el panel. Revisa tu conexión.'); }
}
document.querySelectorAll('.admin-trigger').forEach(button => button.addEventListener('click', event => { event.preventDefault(); openAdmin(); }));
document.querySelector('.admin-banner-open')?.addEventListener('click', openAdmin);

/* ---------- Arranque ---------- */
applyCatalog(DEFAULT_CATALOG);      // valores seguros mientras llega el menú real (todavía no se dibuja nada)
const knownCatalog = isAdminSession() ? null : readStore(STORAGE.catalogCache, null);
if (knownCatalog) { applyCatalog(knownCatalog); renderAll(); }      // quien ya nos visitó ve el menú al instante
catalogReady = loadCatalog().then(raw => { applyCatalog(raw); renderAll(); });
if (location.hash === '#admin') openAdmin();
