(function(){
  const path = window.location.pathname || "/";
  const split = path.split("/web/");
  const jfRoot = split.length > 1 ? split[0] : "";

  const api = p => `${jfRoot}/Plugins/JMSFusion/${p}`;
  const esc = s => (s ?? "").toString().replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
  const cls = v => v ? 'ok' : 'warn';

  function showMessage(view, text, kind = '') {
    const el = view.querySelector('#msg');
    if (!el) return;
    el.className = 'fieldDescription ' + kind;
    el.textContent = text;
    clearTimeout(el.__t);
    el.__t = setTimeout(() => { el.textContent = ''; el.className = 'fieldDescription'; }, 2500);
  }

  async function loadConfig(view) {
    const r = await fetch(api('Configuration'));
    if (!r.ok) throw new Error('Failed to load config: ' + r.status);
    const cfg = await r.json();
    view.querySelector('#scriptDir').value = cfg.scriptDirectory || '';
    view.querySelector('#playerSub').value = cfg.playerSubdir || 'modules/player';
    const fg = view.querySelector('#forceGlobal');
    if (fg) fg.checked = !!cfg.forceGlobalUserSettings;
    return cfg;
  }

  async function saveConfig(view) {
    const body = {
      scriptDirectory: view.querySelector('#scriptDir').value.trim(),
      playerSubdir: view.querySelector('#playerSub').value.trim(),
      forceGlobalUserSettings: !!view.querySelector('#forceGlobal')?.checked
    };
    const r = await fetch(api('Configuration'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('Save failed: ' + r.status + ' - ' + await r.text());
  }

  async function getStatus() {
    const r = await fetch(api('Status'));
    if (!r.ok) throw new Error('Failed to get status: ' + r.status);
    return await r.json();
  }

  function renderStatus(view, s) {
    const el = view.querySelector('#status');
    if (!el) return;
    el.innerHTML = `
      <div><b>Configured:</b> <span class="${cls(s.configured)}">${s.configured}</span></div>
      <div><b>DirectoryExists:</b> <span class="${cls(s.directoryExists)}">${s.directoryExists}</span></div>
      <div><b>MainJsExists:</b> <span class="${cls(s.mainJsExists)}">${s.mainJsExists}</span></div>
      <div><b>PlayerJsExists:</b> <span class="${cls(s.playerJsExists)}">${s.playerJsExists}</span></div>
      <div><b>UsingEmbedded:</b> <span class="${cls(s.usingEmbedded)}">${s.usingEmbedded}</span></div>
      <div><b>PlayerPath:</b> <small>${esc(s.playerPath)}</small></div>
    `;
  }

  async function showStatus(view) { renderStatus(view, await getStatus()); }

  async function showSnippet(view) {
    const r = await fetch(api('Snippet'));
    if (!r.ok) throw new Error('Failed to get snippet: ' + r.status);
    const html = await r.text();
    const box = view.querySelector('#snippet');
    if (box) box.innerHTML = html;
  }

  async function getEnv() {
    const r = await fetch(api('Env'));
    if (!r.ok) throw new Error('Failed to get env: ' + r.status);
    return await r.json();
  }

  function boolBadge(v) { return `<span class="${cls(!!v)}">${v ? 'writable' : 'not writable'}</span>`; }

  function renderEnv(view, env) {
    view.querySelector('#envUser').textContent = env.user || '?';
    view.querySelector('#envWebRoot').textContent = env.webRoot || '(not found)';
    view.querySelector('#envIdx').innerHTML = (env.files?.indexHtml?.exists ? 'found' : 'not found') + ` / ${boolBadge(env.files?.indexHtml?.writable)}`;
    view.querySelector('#envGz').innerHTML  = (env.files?.indexGz?.exists ? 'found' : 'not found') + ` / ${boolBadge(env.files?.indexGz?.writable)}`;
    view.querySelector('#envBr').innerHTML  = (env.files?.indexBr?.exists ? 'found' : 'not found') + ` / ${boolBadge(env.files?.indexBr?.writable)}`;

    const aclEl = view.querySelector('#envAcl');
    if (aclEl) aclEl.textContent = (env.acl?.primary || '(not computed)') +
                                   (env.acl?.alternative ? `\n\n# Alternative:\n${env.acl.alternative}` : '');
  }

  async function refreshEnv(view) {
    renderEnv(view, await getEnv());
    showMessage(view, 'Web path & permissions updated', 'ok');
  }

  function renderInMem(view, ok) {
    const el = view.querySelector('#inmem');
    if (!el) return;
    if (ok) {
      el.innerHTML = `✅ <b>In-memory injection is active.</b><br>
                      <span class="ok">You don’t need to patch; physical write is not required.</span>`;
      el.className = 'fieldDescription ok';
    } else {
      el.innerHTML = `ℹ️ <b>In-memory injection not detected.</b><br>
                      <span class="warn">You can use <b>Patch</b> to persist the snippet into <code>index.html</code>.</span>`;
      el.className = 'fieldDescription warn';
    }
  }

  async function checkInMemory(view) {
    try {
      const url = `${jfRoot}/web/?_jms_check=${Date.now()}`;
      const r = await fetch(url, { cache: 'no-store', headers: { 'X-JMS-Check': '1' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const txt = await r.text();
      const ok = /<!--\s*SL-INJECT BEGIN\s*-->/.test(txt);
      renderInMem(view, ok);
      return ok;
    } catch (e) {
      renderInMem(view, false);
      return false;
    }
  }

  async function doPatch(view, kind) {
    const ep = kind === 'patch' ? 'Patch' : 'Unpatch';
    const r = await fetch(api(ep), { method: 'POST' });
    if (!r.ok) throw new Error(`${ep} failed: ` + r.status);
    showMessage(view, (kind === 'patch' ? 'Patched.' : 'Unpatched.'), 'ok');
    await checkInMemory(view);
    await showStatus(view);
  }

  function authHeaders() {
  try {
    const token = window.ApiClient?.accessToken?.() || window.ApiClient?._accessToken;
    if (token) return { 'X-Emby-Token': token };
  } catch {}
  return {};
}

  async function initView(view) {
    if (view.__jms_initialized) return;
    view.__jms_initialized = true;

    view.querySelector('#saveBtn')?.addEventListener('click', async () => {
      try {
        await saveConfig(view);
        showMessage(view, 'Settings saved', 'ok');
        await Promise.all([showStatus(view), showSnippet(view), refreshEnv(view)]);
        await checkInMemory(view);
      } catch (e) {
        console.error(e);
        showMessage(view, e.message || String(e), 'err');
      }
    });

    view.querySelector('#publishGlobalBtn')?.addEventListener('click', async () => {
  try {
    const snapshot = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      snapshot[key] = localStorage.getItem(key);
    }

    const r = await fetch(api('UserSettings/Publish'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ global: snapshot })
    });

    if (!r.ok) throw new Error('Publish failed');

    const chk = await fetch('/Plugins/JMSFusion/UserSettings', { cache: 'no-store' });
const j = await chk.json();
console.log('[JMSFusion] UserSettings after publish:', j);

    showMessage(view, 'Global settings published successfully', 'ok');
  } catch (e) {
    showMessage(view, e.message || String(e), 'err');
  }
});

    view.querySelector('#refreshEnvBtn')?.addEventListener('click', async () => {
      try { await refreshEnv(view); }
      catch (e) { showMessage(view, e.message || String(e), 'err'); }
    });

    view.querySelector('#copyAclBtn')?.addEventListener('click', () => {
      const box = document.querySelector('#envAcl');
      const toCopy = box?.textContent || '';
      if (!toCopy.trim()) {
        showMessage(view, 'Nothing to copy', 'warn');
        return;
      }
      navigator.clipboard.writeText(toCopy)
        .then(() => showMessage(view, 'Commands copied', 'ok'))
        .catch(err => showMessage(view, 'Copy failed: ' + err, 'err'));
    });

    view.querySelector('#patchBtn')?.addEventListener('click', async () => {
      try { await doPatch(view, 'patch'); }
      catch (e) { showMessage(view, e.message || String(e), 'err'); }
    });

    view.querySelector('#unpatchBtn')?.addEventListener('click', async () => {
      try { await doPatch(view, 'unpatch'); }
      catch (e) { showMessage(view, e.message || String(e), 'err'); }
    });

    try { await loadConfig(view); }
    catch (e) { showMessage(view, 'Config load failed: ' + (e.message || String(e)), 'err'); }

    try {
      await Promise.all([showStatus(view), showSnippet(view), refreshEnv(view)]);
      await checkInMemory(view);
    } catch (e) {
      console.error(e);
    }
  }

  function handlePageEvents(e) {
    let view = e.detail?.view || e.target || null;
    if (view && (view.id === 'JMSFusionConfigPage' || view.querySelector?.('#JMSFusionConfigPage'))) {
      const page = view.id === 'JMSFusionConfigPage' ? view : view.querySelector('#JMSFusionConfigPage');
      if (page) setTimeout(() => initView(page), 50);
    }
  }

  document.addEventListener('viewshow', handlePageEvents);
  document.addEventListener('pageshow', handlePageEvents);
  document.addEventListener('DOMContentLoaded', function() {
    const existingView = document.getElementById('JMSFusionConfigPage');
    if (existingView) setTimeout(() => initView(existingView), 50);
  });

  const immediateCheck = document.getElementById('JMSFusionConfigPage');
  if (immediateCheck) setTimeout(() => initView(immediateCheck), 50);
})();
