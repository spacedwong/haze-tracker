(() => {
  const { REGIONS, psiBand, pmBand, fetchLatest, checkAlerts, cap } = HazeCore;
  const $ = (sel) => document.querySelector(sel);
  const POLL_MS = 5 * 60 * 1000;
  const CACHE_KEY = 'haze:last';

  let settings = null;      // { enabled, region, threshold }
  let backgroundOn = false; // periodic background sync registered
  let lastFetch = 0;
  let deferredInstall = null;

  const fmtTime = (iso) =>
    iso
      ? new Date(iso).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Singapore' })
      : '–';
  const num = (v) => (Number.isFinite(v) ? v : '–');
  const supportsAlerts = () => 'Notification' in window && 'serviceWorker' in navigator;
  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  /* ---------- rendering ---------- */

  function render(data, stale) {
    const grid = $('#grid');
    grid.replaceChildren();
    for (const r of REGIONS) {
      const psi = data.psi24 ? data.psi24[r] : null;
      const pm = data.pm1 ? data.pm1[r] : null;
      const pb = psiBand(psi);
      const mb = pmBand(pm);

      const card = document.createElement('article');
      card.className = 'card';
      card.dataset.region = r;
      card.dataset.band = pb.key;
      card.setAttribute(
        'aria-label',
        `${cap(r)}: 24-hour PSI ${num(psi)}, ${pb.label}. 1-hour PM2.5 ${num(pm)} micrograms per cubic metre, ${mb.label}.`
      );
      card.innerHTML = `
        <h2>${cap(r)}</h2>
        <p class="big">${num(psi)}</p>
        <p class="cap">24-hr PSI</p>
        <span class="chip">${pb.label}</span>
        <hr class="sep">
        <div data-band="${mb.key}">
          <p class="mid">${num(pm)}</p>
          <p class="cap">1-hr PM2.5 (µg/m³)</p>
          <span class="chip">${mb.label}</span>
        </div>`;
      if (settings && settings.enabled && (settings.region === 'any' || settings.region === r)) {
        const bell = document.createElement('span');
        bell.className = 'bell';
        bell.textContent = `🔔 ≥ ${settings.threshold}`;
        card.append(bell);
      }
      grid.append(card);
    }
    const asOf = fmtTime(data.psiTime || data.pmTime);
    $('#updated').textContent = stale
      ? `Offline · showing data from ${asOf}`
      : `Data as of ${asOf} · checked ${fmtTime(data.fetchedAt)}`;
  }

  function showError(msg) {
    const el = $('#error');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  /* ---------- fetching ---------- */

  async function refresh() {
    const btn = $('#refresh');
    btn.classList.add('spin');
    try {
      let data = null;
      if (settings && settings.enabled && supportsAlerts() && Notification.permission === 'granted') {
        const reg = await navigator.serviceWorker.ready;
        data = await checkAlerts(reg); // fetches and notifies on an upward crossing
      }
      if (!data) data = await fetchLatest();
      lastFetch = Date.now();
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (_) {}
      render(data, false);
      showError('');
    } catch (err) {
      const cached = readCache();
      if (cached) render(cached, true);
      showError("Couldn't reach NEA data. Check your connection and try again.");
    } finally {
      btn.classList.remove('spin');
    }
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (_) { return null; }
  }

  /* ---------- alerts ---------- */

  async function registerBackground() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!('periodicSync' in reg)) return false;
      const perm = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (perm.state !== 'granted') return false;
      await reg.periodicSync.register('haze-check', { minInterval: 15 * 60 * 1000 });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function unregisterBackground() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if ('periodicSync' in reg) await reg.periodicSync.unregister('haze-check');
    } catch (_) {}
    backgroundOn = false;
  }

  function setStatus(msg, isErr) {
    const el = $('#alert-status');
    el.textContent = msg;
    el.classList.toggle('err', !!isErr);
  }

  function updateAlertUI() {
    const on = !!(settings && settings.enabled);
    $('#off').hidden = !on;
    $('#save').textContent = on ? 'Update alerts' : 'Turn on alerts';
    if (!on) {
      setStatus(
        supportsAlerts()
          ? 'Alerts are off.'
          : isIOS() && !isStandalone()
            ? 'On iPhone/iPad, add this app to your Home Screen first (iOS 16.4 or later), then open it from there to turn on alerts.'
            : "This browser doesn't support notifications.",
        false
      );
      return;
    }
    const where = settings.region === 'any' ? 'any region' : cap(settings.region);
    const how = backgroundOn
      ? 'Background checks are on; your browser decides how often they run.'
      : 'Checks run while the app is open or recently used. Your browser can’t run them in the background here, so alerts can be delayed or missed when the app is closed.';
    setStatus(`Alerts on: you'll be notified when 24-hour PSI in ${where} reaches ${settings.threshold}. ${how}`, false);
  }

  async function saveAlerts(event) {
    event.preventDefault();
    const threshold = parseInt($('#threshold').value, 10);
    if (!(threshold >= 1 && threshold <= 500)) {
      setStatus('Enter a PSI threshold between 1 and 500.', true);
      return;
    }
    if (!supportsAlerts()) { updateAlertUI(); return; }

    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setStatus('Notifications are blocked. Allow them in your browser or phone settings for this site, then try again.', true);
      return;
    }

    settings = { enabled: true, region: $('#region').value, threshold };
    await HazeStore.set('settings', settings);
    await HazeStore.set('state', {}); // fresh start: notify if already at/above the threshold
    backgroundOn = await registerBackground();
    updateAlertUI();
    await refresh();
  }

  async function turnOff() {
    settings = { ...(settings || {}), enabled: false };
    await HazeStore.set('settings', settings);
    await unregisterBackground();
    updateAlertUI();
    const cached = readCache();
    if (cached) render(cached, false);
  }

  async function sendTest() {
    if (!supportsAlerts()) { updateAlertUI(); return; }
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setStatus('Notifications are blocked. Allow them in your browser or phone settings for this site.', true);
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('Haze Tracker test', {
      body: 'Notifications are working.',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'haze-test',
    });
  }

  /* ---------- install ---------- */

  function setupInstall() {
    if (isStandalone()) return;
    const panel = $('#install');
    const text = $('#install-text');
    const btn = $('#install-btn');

    if (isIOS()) {
      panel.hidden = false;
      text.textContent = 'In Safari, tap the Share button, then “Add to Home Screen”. Open the app from your Home Screen to use alerts.';
    }
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstall = e;
      panel.hidden = false;
      text.textContent = 'Install Haze Tracker to open it like any other app.';
      btn.hidden = false;
    });
    btn.addEventListener('click', async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      btn.hidden = true;
    });
    window.addEventListener('appinstalled', () => { panel.hidden = true; });
  }

  /* ---------- init ---------- */

  async function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    try { settings = (await HazeStore.get('settings')) || null; } catch (_) { settings = null; }
    if (settings) {
      $('#region').value = settings.region;
      $('#threshold').value = settings.threshold;
    }
    if (settings && settings.enabled && 'serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.ready;
        backgroundOn = 'periodicSync' in reg && (await reg.periodicSync.getTags()).includes('haze-check');
      } catch (_) {}
    }
    updateAlertUI();

    const cached = readCache();
    if (cached) render(cached, true);
    refresh();

    $('#refresh').addEventListener('click', refresh);
    $('#alert-form').addEventListener('submit', saveAlerts);
    $('#off').addEventListener('click', turnOff);
    $('#test').addEventListener('click', sendTest);
    document.querySelectorAll('.quick button').forEach((b) =>
      b.addEventListener('click', () => { $('#threshold').value = b.dataset.t; })
    );

    setInterval(refresh, POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch > 60 * 1000) refresh();
    });
    window.addEventListener('online', refresh);
    setupInstall();
  }

  init();
})();
