/* ==========================================================================
   ELOTITOS — publish.js   ·   Publicar con un toque en GitHub Pages
   Se carga solo cuando abres "Publicar y seguridad" o pulsas "Publicar ahora" en el panel.

   Cómo funciona: usa la API de GitHub (api.github.com) con un token de acceso limitado a UN
   repositorio (permiso "Contents: Read and write") para guardar ahí catalog.json y tus fotos.
   El token solo se envía a api.github.com; nunca a otro sitio. Se guarda únicamente en esta
   pestaña, o —si tú lo eliges— cifrado con tu contraseña de administrador (AES-GCM + PBKDF2).
   ========================================================================== */
(function () {
  const API = 'https://api.github.com';
  const CFG_KEY = 'elotitos-publish-v1';        // { owner, repo, branch, folder }  (no es secreto)
  const SESSION_KEY = 'elotitos-gh-token';      // sessionStorage: token en claro, solo mientras dura la sesión
  const VAULT_KEY = 'elotitos-gh-vault-v1';     // localStorage: token cifrado con la contraseña del administrador
  const enc = new TextEncoder(), dec = new TextDecoder();
  const ctx = () => window.ElotitosAdminCtx;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let running = false;

  /* ---------- Base64 ---------- */
  const toB64 = bytes => {
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(text);
  };
  const fromB64 = text => {
    const raw = atob(String(text).replace(/\s/g, ''));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  };

  /* ---------- Configuración y token ---------- */
  function readCfg() {
    const cfg = ctx().App.readStore(CFG_KEY, null);
    if (!cfg || !cfg.owner || !cfg.repo) return null;
    return { owner: String(cfg.owner), repo: String(cfg.repo), branch: String(cfg.branch || 'main'), folder: String(cfg.folder || '') };
  }
  const saveCfg = cfg => ctx().App.saveStore(CFG_KEY, cfg);
  const getToken = () => { try { return sessionStorage.getItem(SESSION_KEY) || ''; } catch { return ''; } };
  const setToken = token => { try { token ? sessionStorage.setItem(SESSION_KEY, token) : sessionStorage.removeItem(SESSION_KEY); } catch { /* sin sesión */ } };
  const canVault = () => !!(window.crypto && crypto.subtle);

  async function vaultKey(password, salt) {
    const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function storeVault(token, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await vaultKey(password, salt), enc.encode(token));
    localStorage.setItem(VAULT_KEY, JSON.stringify({ v: 1, salt: toB64(salt), iv: toB64(iv), data: toB64(new Uint8Array(data)) }));
  }
  async function openVault(password) {
    try {
      const vault = JSON.parse(localStorage.getItem(VAULT_KEY));
      const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(vault.iv) }, await vaultKey(password, fromB64(vault.salt)), fromB64(vault.data));
      return dec.decode(data);
    } catch { return ''; }
  }
  /* Al iniciar sesión: si hay un token guardado, se abre con la contraseña que acabas de escribir */
  async function unlock(password) {
    if (!canVault() || !localStorage.getItem(VAULT_KEY)) return false;
    const token = await openVault(password);
    if (token) setToken(token);
    return !!token;
  }
  /* Al cambiar la contraseña: el token guardado se vuelve a cifrar con la nueva */
  async function rekey(newPassword) {
    const token = getToken();
    if (!token || !canVault()) { try { localStorage.removeItem(VAULT_KEY); } catch { /* nada */ } return false; }
    await storeVault(token, newPassword);
    return true;
  }
  const lock = () => setToken('');

  /* ---------- API de GitHub ---------- */
  class GhError extends Error { constructor(status, message, data) { super(message); this.status = status; this.data = data || null; } }
  function explain(status, data) {
    const detail = data && data.message ? ` (${data.message})` : '';
    if (status === 401) return 'GitHub no aceptó el token: está mal copiado o ya venció. Crea uno nuevo y conéctalo otra vez.';
    if (status === 403) return /rate limit|abuse|secondary/i.test((data && data.message) || '')
      ? 'GitHub pide esperar un momento por demasiados intentos. Prueba de nuevo en un minuto.'
      : 'El token no tiene permiso para guardar en este repositorio. Al crearlo, en “Repository permissions” elige Contents → Read and write.';
    if (status === 404) return 'No encontramos ese repositorio (o la rama), o el token no tiene acceso a él. Revisa el nombre y que el token incluya ese repositorio.';
    if (status === 409 || status === 422) return `GitHub rechazó el cambio${detail}. Inténtalo otra vez.`;
    if (status >= 500) return 'GitHub tiene problemas en este momento. Inténtalo en unos minutos.';
    return `GitHub respondió con un error${detail}.`;
  }
  async function gh(path, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${getToken()}` };
    if (body) headers['Content-Type'] = 'application/json';
    let response;
    try { response = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' }); }
    catch { throw new GhError(0, 'No hay conexión con GitHub. Revisa tu internet e inténtalo de nuevo.'); }
    let data = null;
    try { data = await response.json(); } catch { /* sin cuerpo */ }
    if (!response.ok) throw new GhError(response.status, explain(response.status, data), data);
    return data;
  }
  const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
  const repoPath = cfg => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
  const fullPath = (cfg, rel) => (cfg.folder ? `${cfg.folder}/` : '') + rel;
  const contentsPath = (cfg, rel, withRef) => `${repoPath(cfg)}/contents/${encodePath(fullPath(cfg, rel))}${withRef ? `?ref=${encodeURIComponent(cfg.branch)}` : ''}`;

  async function getFile(cfg, rel) {
    try {
      const data = await gh(contentsPath(cfg, rel, true));
      if (Array.isArray(data)) return null;
      return { sha: data.sha, text: data.encoding === 'base64' ? dec.decode(fromB64(data.content || '')) : '' };
    } catch (error) { if (error.status === 404) return null; throw error; }
  }
  /* Crea o reemplaza un archivo. Si GitHub dice que el "sha" cambió (409/422), lo vuelve a pedir y reintenta. */
  async function putFile(cfg, rel, makeContent, message) {
    let current = await getFile(cfg, rel);
    for (let attempt = 0; ; attempt++) {
      const body = { message, content: makeContent(current), branch: cfg.branch };
      if (current) body.sha = current.sha;
      try { return await gh(contentsPath(cfg, rel, false), { method: 'PUT', body }); }
      catch (error) {
        if ((error.status === 409 || error.status === 422) && attempt < 2) { current = await getFile(cfg, rel); continue; }
        throw error;
      }
    }
  }

  /* ---------- Fotos: de "data:" dentro del catálogo a archivos assets/u/<huella>.<ext> ---------- */
  async function externalizeImages(catalog) {
    const files = new Map();
    const convert = async value => {
      const match = /^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/i.exec(value || '');
      if (!match) return value;
      const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
      const path = `assets/u/${(await ctx().sha256(match[2])).slice(0, 16)}.${ext}`;
      files.set(path, match[2]);
      return path;
    };
    for (const product of catalog.products) product.image = await convert(product.image);
    for (const item of catalog.gallery) item.src = await convert(item.src);
    return files;
  }

  /* ---------- Vista previa al compartir (canonical, og:image) ---------- */
  const MARK = /<!-- site-url:start -->[\s\S]*?<!-- site-url:end -->/;
  const attr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function siteBlock(file, siteUrl) {
    if (file === '404.html') return `<!-- site-url:start -->\n  <base href="${attr(siteUrl)}" />\n  <!-- site-url:end -->`;
    const image = `${siteUrl}assets/og-image.jpg`;
    return `<!-- site-url:start -->\n  <link rel="canonical" href="${attr(siteUrl)}" />\n  <meta property="og:url" content="${attr(siteUrl)}" />\n  <meta property="og:image" content="${attr(image)}" />\n  <meta property="og:image:width" content="1200" />\n  <meta property="og:image:height" content="630" />\n  <meta name="twitter:image" content="${attr(image)}" />\n  <!-- site-url:end -->`;
  }
  async function patchSitePage(cfg, file, siteUrl) {
    const current = await getFile(cfg, file);
    if (!current || !current.text || !MARK.test(current.text)) return false;
    const next = current.text.replace(MARK, () => siteBlock(file, siteUrl));
    if (next === current.text) return false;
    if (!/<\/html>\s*$/i.test(next) || next.length < current.text.length * 0.5) return false;   // seguro contra archivos dañados
    await putFile(cfg, file, latest => {
      const text = latest && latest.text ? latest.text : current.text;
      return toB64(enc.encode(MARK.test(text) ? text.replace(MARK, () => siteBlock(file, siteUrl)) : next));
    }, 'Elotitos: dirección de la página para compartir');
    return true;
  }

  /* ---------- Esperar a que GitHub Pages muestre la nueva versión ---------- */
  async function waitUntilLive(updatedAt, siteUrl, progress) {
    let sameSite = false;
    try { sameSite = !!siteUrl && new URL(siteUrl).origin === location.origin; } catch { /* nada */ }
    if (!sameSite) return null;
    for (let i = 1; i <= 18; i++) {                         // hasta ~3 minutos
      await sleep(10000);
      try {
        const response = await fetch(`catalog.json?live=${Date.now()}`, { cache: 'no-store' });
        if (response.ok && (await response.json()).updatedAt === updatedAt) return true;
      } catch { /* sigue esperando */ }
      progress(`Subido ✓ · esperando a que GitHub lo muestre (${i * 10} s)…`);
    }
    return false;
  }

  /* ---------- Publicar ---------- */
  async function publish(progress) {
    const c = ctx(), App = c.App;
    const cfg = readCfg();
    if (!cfg) throw new Error('Primero conecta tu repositorio de GitHub (pestaña Publicar y seguridad).');
    if (!getToken()) { const error = new Error('Pega tu token de GitHub para publicar.'); error.code = 'need-token'; throw error; }

    progress('Revisando la conexión con GitHub…');
    const info = await gh(repoPath(cfg));
    if (info.permissions && info.permissions.push === false) throw new Error('El token solo puede leer este repositorio. Crea otro con el permiso Contents → Read and write.');

    const catalog = App.publicCatalog(c.getWorking());
    catalog.updatedAt = new Date().toISOString();
    const images = await externalizeImages(catalog);

    let existing = new Set();
    if (images.size) {
      try { const list = await gh(contentsPath(cfg, 'assets/u', true)); if (Array.isArray(list)) existing = new Set(list.map(file => file.name)); }
      catch (error) { if (error.status !== 404) throw error; }
    }
    const pending = [...images].filter(([path]) => !existing.has(path.split('/').pop()));
    let done = 0;
    for (const [path, base64] of pending) {                  // uno por uno: GitHub no admite dos cambios a la vez en la misma rama
      progress(`Subiendo foto ${++done} de ${pending.length}…`);
      await putFile(cfg, path, () => base64, `Elotitos: foto ${path.split('/').pop()}`);
    }

    progress('Subiendo tu menú y precios…');
    const json = `${JSON.stringify(catalog, null, 2)}\n`;
    await putFile(cfg, 'catalog.json', () => toB64(enc.encode(json)), 'Elotitos: actualizar menú y precios');

    let patched = false;
    const siteUrl = catalog.business.siteUrl;
    if (siteUrl) {
      progress('Actualizando la vista previa para compartir…');
      try { patched = (await patchSitePage(cfg, 'index.html', siteUrl)) | (await patchSitePage(cfg, '404.html', siteUrl)); } catch { /* no es crítico */ }
    }
    return { updatedAt: catalog.updatedAt, siteUrl, photos: pending.length, patched: !!patched };
  }

  async function publishNow() {
    const c = ctx();
    if (running) return;
    const cfg = readCfg();
    if (!cfg || !getToken()) {
      c.goto('publicar');
      c.showToast(cfg ? 'Pega tu token de GitHub para publicar.' : 'Conecta primero tu repositorio de GitHub.');
      return;
    }
    running = true;
    const show = text => { c.setStatus(text); const node = document.querySelector('#gh-progress'); if (node) node.textContent = text; };
    document.querySelectorAll('[data-gh="publish"],[data-act="publish-now"]').forEach(button => { button.disabled = true; });
    try {
      const result = await publish(show);
      const time = new Date().toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit' });
      show(`✓ Publicado a las ${time}. GitHub tarda de 1 a 2 minutos en mostrarlo a todos.`);
      c.showToast('Publicado ✓ Tus clientes lo verán en 1–2 minutos.');
      const live = await waitUntilLive(result.updatedAt, result.siteUrl, show);
      if (live === true) { show('✓ Ya está en línea: tus clientes ven los cambios.'); c.showToast('✓ Ya está en línea.'); }
      else if (live === false) show('Subido ✓ pero GitHub aún no lo muestra. Espera unos minutos y recarga tu página.');
    } catch (error) {
      if (error.status === 401) { setToken(''); try { localStorage.removeItem(VAULT_KEY); } catch { /* nada */ } }
      show(error.message || 'No se pudo publicar.');
      c.showToast(error.message || 'No se pudo publicar.');
      if (error.status === 401 || error.code === 'need-token') { c.renderQuick(); if (document.querySelector('#gh-box')) c.refresh(); }
    } finally {
      running = false;
      document.querySelectorAll('[data-gh="publish"],[data-act="publish-now"]').forEach(button => { button.disabled = false; });
    }
  }

  /* ---------- Pantalla de conexión ---------- */
  function parseRepo(text) {
    const clean = String(text || '').trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
    const [owner, repo] = clean.split('/');
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner || '') || !/^[A-Za-z0-9._-]{1,100}$/.test(repo || '')) return null;
    return { owner, repo };
  }
  function guessRepo() {
    const match = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname);
    if (!match) return '';
    const first = location.pathname.split('/').filter(Boolean)[0];
    return `${match[1]}/${first && !/\.[a-z0-9]+$/i.test(first) ? first : `${match[1]}.github.io`}`;
  }
  const cleanName = (text, pattern) => String(text || '').trim().replace(/^\/+|\/+$/g, '').replace(pattern, '');

  function render(box) {
    const c = ctx(), esc = c.esc;
    const cfg = readCfg(), token = getToken();
    const defaultPassword = (c.getWorking().adminHash || c.App.DEFAULT_CATALOG.adminHash) === c.App.DEFAULT_CATALOG.adminHash;
    if (cfg && token && !box.dataset.edit) {
      box.innerHTML = `<div class="gh-connected">
          <p class="gh-line"><span class="gh-dot" aria-hidden="true"></span><span><b>Conectado a GitHub</b><br><code>${esc(cfg.owner)}/${esc(cfg.repo)}</code> · rama <code>${esc(cfg.branch)}</code>${cfg.folder ? ` · carpeta <code>${esc(cfg.folder)}</code>` : ''}</span></p>
          <button type="button" class="button button-primary" data-gh="publish">Publicar ahora</button>
          <div class="adm-actions"><button type="button" class="adm-link" data-gh="edit">Cambiar conexión</button><button type="button" class="adm-link" data-gh="disconnect">Desconectar y olvidar el token</button></div>
          <p class="adm-help" id="gh-progress" role="status" aria-live="polite"></p>
        </div>`;
      return;
    }
    const guess = cfg ? `${cfg.owner}/${cfg.repo}` : guessRepo();
    const vaultOk = canVault() && !defaultPassword;
    box.innerHTML = `<details class="adm-details" open><summary>${cfg ? 'Pegar el token de GitHub' : 'Publicar con un toque (recomendado)'}</summary>
        <p class="adm-help">Conecta tu repositorio de GitHub una sola vez y después publicas con un botón, sin subir archivos a mano. Los pasos están en <code>GUIA-PUBLICAR.txt</code>.</p>
        <label class="adm-field"><span>Tu repositorio de GitHub</span><input id="gh-repo" value="${esc(guess)}" placeholder="tu-usuario/elotitos" autocomplete="off" autocapitalize="off" spellcheck="false" /><small>Escribe usuario/repositorio o pega el enlace de GitHub.</small></label>
        <label class="adm-field"><span>Token de acceso</span><input id="gh-token" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false" /><small>Un token con permiso solo para ese repositorio (Contents: Read and write). No lo compartas.</small></label>
        ${vaultOk ? `<label class="adm-check"><input type="checkbox" id="gh-remember" checked /><span>Recordarlo en este dispositivo (se guarda cifrado con tu contraseña de administrador)</span></label>
        <label class="adm-field" id="gh-pass-row"><span>Tu contraseña de administrador</span><input id="gh-pass" type="password" autocomplete="current-password" /><small>Solo se usa para cifrar el token en este dispositivo. No se guarda.</small></label>`
          : `<p class="adm-help">${defaultPassword ? 'Para poder recordar el token, primero cambia la contraseña inicial (más abajo). Mientras tanto se usa solo en esta sesión.' : 'El token se usará solo en esta sesión.'}</p>`}
        <details class="adm-details"><summary>Opciones avanzadas</summary>
          <div class="adm-row"><label class="adm-field"><span>Rama</span><input id="gh-branch" value="${esc(cfg ? cfg.branch : '')}" placeholder="(la principal)" autocomplete="off" autocapitalize="off" spellcheck="false" /></label>
          <label class="adm-field"><span>Carpeta del sitio</span><input id="gh-folder" value="${esc(cfg ? cfg.folder : '')}" placeholder="(la raíz)" autocomplete="off" autocapitalize="off" spellcheck="false" /></label></div>
          <p class="adm-help">Déjalos vacíos si tus archivos están en la raíz del repositorio. Si publicas desde la carpeta <code>docs</code>, escribe <code>docs</code>.</p></details>
        <button type="button" class="button button-primary" data-gh="connect">Conectar</button>
        ${cfg ? '<button type="button" class="adm-link" data-gh="cancel-edit">Cancelar</button>' : ''}
        <p class="adm-help" id="gh-progress" role="status" aria-live="polite"></p></details>`;
  }

  async function connect(box) {
    const c = ctx();
    const progress = text => { const node = box.querySelector('#gh-progress'); if (node) node.textContent = text; };
    const parsed = parseRepo(box.querySelector('#gh-repo').value);
    const token = box.querySelector('#gh-token').value.trim() || getToken();
    if (!parsed) { progress('Escribe el repositorio como usuario/repositorio (por ejemplo, juan/elotitos).'); return; }
    if (!token) { progress('Pega tu token de acceso de GitHub.'); return; }
    const remember = !!box.querySelector('#gh-remember')?.checked;
    const password = box.querySelector('#gh-pass')?.value || '';
    if (remember) {
      const expected = c.getWorking().adminHash || c.App.DEFAULT_CATALOG.adminHash;
      if (!password || (await c.sha256(password)) !== expected) { progress('Escribe tu contraseña de administrador para guardar el token cifrado (o quita la casilla “Recordarlo”).'); return; }
    }
    const folder = cleanName(box.querySelector('#gh-folder').value, /[^A-Za-z0-9._/-]/g);
    const cfg = { ...parsed, branch: cleanName(box.querySelector('#gh-branch').value, /[^A-Za-z0-9._/-]/g), folder };
    progress('Probando la conexión…');
    const previous = getToken();
    setToken(token);
    try {
      const info = await gh(repoPath(cfg));
      if (info.permissions && info.permissions.push === false) throw new Error('Ese token solo puede leer el repositorio. Crea uno con el permiso Contents → Read and write.');
      cfg.branch = cfg.branch || info.default_branch || 'main';
      await gh(`${repoPath(cfg)}/branches/${encodePath(cfg.branch)}`);
      if (!(await getFile(cfg, 'index.html'))) throw new Error(`No encontramos tu página (index.html) en la rama “${cfg.branch}”${cfg.folder ? ` y la carpeta “${cfg.folder}”` : ''}. Sube primero los archivos de tu página (mira GUIA-PUBLICAR.txt).`);
    } catch (error) {
      setToken(previous);
      progress(error.message);
      return;
    }
    saveCfg(cfg);
    try {
      if (remember) await storeVault(token, password); else localStorage.removeItem(VAULT_KEY);
    } catch { progress('Conectado, pero no se pudo guardar el token cifrado: lo pedirás en cada sesión.'); }
    delete box.dataset.edit;
    c.renderQuick();
    render(box);
    c.showToast('Conectado a GitHub ✓');
  }

  function disconnect(box) {
    try { localStorage.removeItem(CFG_KEY); localStorage.removeItem(VAULT_KEY); } catch { /* nada */ }
    setToken('');
    delete box.dataset.edit;
    ctx().renderQuick();
    render(box);
    ctx().showToast('Desconectado: se olvidó el token en este dispositivo.');
  }

  function mount(box) {
    render(box);
    box.addEventListener('click', event => {
      const button = event.target.closest('[data-gh]');
      if (!button) return;
      const action = button.dataset.gh;
      if (action === 'connect') connect(box);
      if (action === 'publish') publishNow();
      if (action === 'disconnect') disconnect(box);
      if (action === 'edit') { box.dataset.edit = '1'; render(box); box.querySelector('#gh-token')?.focus(); }
      if (action === 'cancel-edit') { delete box.dataset.edit; render(box); }
    });
    box.addEventListener('change', event => {
      if (event.target.id === 'gh-remember') { const row = box.querySelector('#gh-pass-row'); if (row) row.hidden = !event.target.checked; }
    });
  }

  window.ElotitosPublish = { mount, publishNow, unlock, rekey, lock, _test: { parseRepo, siteBlock, externalizeImages, guessRepo } };
})();
