/* ELOTITOS — legal.js: rellena los datos del negocio en el Aviso de privacidad y los Términos.
   Lee catalog.json (los mismos datos que llenas en el panel de administrador). */
(async function () {
  const DEFAULT_PHONE = '522213698374';
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
  const read = key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
  let catalog = null;
  try { if (sessionStorage.getItem('elotitos-admin-session') === '1') catalog = read('elotitos-catalog-draft-v1'); } catch { /* nada */ }
  if (!catalog) {
    try { const response = await fetch(`catalog.json?v=${Math.floor(Date.now() / 60000)}`, { cache: 'no-store' }); if (response.ok) catalog = await response.json(); } catch { /* usa los valores por defecto */ }
  }
  if (!catalog) catalog = read('elotitos-catalog-cache-v1');
  const business = catalog?.business || {};
  const legal = business.legal || {};
  let phone = String(business.whatsapp || DEFAULT_PHONE).replace(/\D/g, '');
  if (phone.length === 10) phone = `52${phone}`;
  const pretty = /^52\d{10}$/.test(phone) ? `+52 ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}` : `+${phone}`;
  /* Misma regla que la página: la transferencia solo cuenta si está encendida (y en catálogos viejos, solo si tenían cuenta) */
  let transfer = Array.isArray(business.payments) && business.payments.includes('Transferencia');
  if ((Number(catalog?.version) || 1) < 2 && !String(business.transfer?.account || '').trim()) transfer = false;
  const values = {
    brand: business.name || 'Elotitos',
    name: legal.name || '',
    address: legal.address || business.location || '',
    email: legal.email || '',
    phone: pretty,
    delivery: business.delivery?.enabled ? 'sí' : '',
    transfer: transfer ? 'sí' : ''
  };
  document.querySelectorAll('[data-legal]').forEach(node => {
    const value = values[node.dataset.legal];
    if (value) { node.textContent = value; node.classList.remove('pending'); }
    else { node.textContent = node.dataset.fallback || '(pendiente de completar)'; node.classList.add('pending'); }
  });
  document.querySelectorAll('[data-if]').forEach(node => { node.hidden = !values[node.dataset.if]; });
  document.querySelectorAll('[data-ifnot]').forEach(node => { node.hidden = !!values[node.dataset.ifnot]; });
  document.querySelectorAll('[data-mailto]').forEach(node => { if (values.email) node.href = `mailto:${values.email}`; else node.hidden = true; });
  document.querySelectorAll('[data-wa]').forEach(node => { node.href = `https://wa.me/${phone}?text=${encodeURIComponent(node.dataset.wa)}`; node.target = '_blank'; node.rel = 'noopener'; });
})();
