/* Data fetching, PSI bands and alert logic. Shared by the page and the service worker. */
(function (g) {
  const API = {
    psi: 'https://api-open.data.gov.sg/v2/real-time/api/psi',
    pm25: 'https://api-open.data.gov.sg/v2/real-time/api/pm25',
  };
  const REGIONS = ['north', 'west', 'central', 'east', 'south'];

  // NEA 24-hour PSI bands.
  function psiBand(v) {
    if (v == null) return { key: 'na', label: 'No data' };
    if (v <= 50) return { key: 'good', label: 'Good' };
    if (v <= 100) return { key: 'moderate', label: 'Moderate' };
    if (v <= 200) return { key: 'unhealthy', label: 'Unhealthy' };
    if (v <= 300) return { key: 'very', label: 'Very unhealthy' };
    return { key: 'hazardous', label: 'Hazardous' };
  }

  // NEA 1-hour PM2.5 bands (µg/m³).
  function pmBand(v) {
    if (v == null) return { key: 'na', label: 'No data' };
    if (v <= 55) return { key: 'good', label: 'Normal' };
    if (v <= 150) return { key: 'moderate', label: 'Elevated' };
    if (v <= 250) return { key: 'unhealthy', label: 'High' };
    return { key: 'very', label: 'Very high' };
  }

  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json.code !== 0 || !json.data || !json.data.items || !json.data.items.length) {
      throw new Error(json.errorMsg || 'Unexpected response');
    }
    return json.data.items[0];
  }

  // Fetch both feeds; tolerate one failing so the other can still be shown.
  async function fetchLatest() {
    const [psi, pm] = await Promise.allSettled([getJSON(API.psi), getJSON(API.pm25)]);
    if (psi.status === 'rejected' && pm.status === 'rejected') throw psi.reason;
    return {
      psi24: psi.status === 'fulfilled' ? psi.value.readings.psi_twenty_four_hourly : null,
      psiTime: psi.status === 'fulfilled' ? psi.value.timestamp : null,
      pm1: pm.status === 'fulfilled' ? pm.value.readings.pm25_one_hourly : null,
      pmTime: pm.status === 'fulfilled' ? pm.value.timestamp : null,
      fetchedAt: Date.now(),
    };
  }

  // Value + region to compare against the threshold ("any" = highest region).
  function watchedValue(psi24, region) {
    if (!psi24) return { value: null, region };
    if (region !== 'any') return { value: psi24[region] ?? null, region };
    let best = { value: null, region: null };
    for (const r of REGIONS) {
      const v = psi24[r];
      if (v != null && (best.value == null || v > best.value)) best = { value: v, region: r };
    }
    return best;
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  async function showAlert(reg, { value, region, threshold }) {
    const band = psiBand(value);
    await reg.showNotification('Haze alert: PSI ' + value + ' (' + band.label + ')', {
      body: cap(region) + ' Singapore 24-hour PSI is ' + value + ', at or above your threshold of ' + threshold + '.',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'haze-alert',
      renotify: true,
      data: { url: './' },
    });
  }

  /**
   * Fetch, compare with the saved threshold, and notify on an upward crossing.
   * `reg` is a ServiceWorkerRegistration. Returns the fetched data (or null if no alerts configured).
   */
  async function checkAlerts(reg) {
    const settings = await HazeStore.get('settings');
    if (!settings || !settings.enabled) return null;
    const data = await fetchLatest();
    const { value, region } = watchedValue(data.psi24, settings.region);
    if (value == null) return data;
    const state = (await HazeStore.get('state')) || {};
    const above = value >= settings.threshold;
    if (above && !state.above) {
      await showAlert(reg, { value, region, threshold: settings.threshold });
    }
    await HazeStore.set('state', { above, value, checkedAt: Date.now() });
    return data;
  }

  g.HazeCore = { REGIONS, psiBand, pmBand, fetchLatest, watchedValue, showAlert, checkAlerts, cap };
})(self);
