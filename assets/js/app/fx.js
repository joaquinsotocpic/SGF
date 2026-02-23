// FX helper (v1.17.1) - Soporta base CRC y secundaria USD con histórico (exchange_rates)
(function () {
  window.SGF = window.SGF || {};

  function getConfig(key, fallback) {
    try {
      const v = window.SGF.db?.scalar?.('SELECT value FROM config WHERE key=:k', { ':k': key });
      return (v === undefined || v === null || v === '') ? fallback : String(v);
    } catch {
      return fallback;
    }
  }

  function baseCurrency() { return getConfig('baseCurrency', 'CRC'); }
  function secondaryCurrency() { return getConfig('secondaryCurrency', 'USD'); }

  function defaultUsdToCrc() {
    const v = Number(getConfig('defaultUsdToCrc', '0'));
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  // Obtiene la mejor tasa USD->CRC para una fecha (<= fecha). Si no hay histórico, usa defaultUsdToCrc.
  function usdToCrc(dateIso) {
    const d = String(dateIso || '').slice(0, 10);
    if (!d) return defaultUsdToCrc() || 0;
    const r = window.SGF.db?.scalar?.(
      `SELECT rate
       FROM exchange_rates
       WHERE from_currency='USD' AND to_currency='CRC' AND rate_date<=:d
       ORDER BY rate_date DESC
       LIMIT 1`,
      { ':d': d }
    );
    const n = Number(r || 0);
    return (Number.isFinite(n) && n > 0) ? n : (defaultUsdToCrc() || 0);
  }

  // Conversión simple entre CRC y USD usando histórico USD->CRC (y su inversa).
  function rate(dateIso, from, to) {
    const f = String(from || '').toUpperCase();
    const t = String(to || '').toUpperCase();
    if (!f || !t || f === t) return 1;

    // Por diseño SGF: base CRC + secundaria USD.
    // Si cambias esto, hay que extender exchange_rates para múltiples pares.
    if ((f === 'USD' && t === 'CRC')) return usdToCrc(dateIso) || 0;
    if ((f === 'CRC' && t === 'USD')) {
      const r = usdToCrc(dateIso) || 0;
      return r > 0 ? (1 / r) : 0;
    }
    return 0; // no soportado
  }

  // Devuelve el último día del periodo YYYY-MM como ISO
  function periodEndDate(period) {
    const p = String(period || '');
    if (!/^\d{4}-\d{2}$/.test(p)) return '';
    const [y, m] = p.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m, 0)); // día 0 del mes siguiente = último del mes
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${dt.getUTCFullYear()}-${mm}-${dd}`;
  }

  window.SGF.fx = {
    baseCurrency,
    secondaryCurrency,
    defaultUsdToCrc,
    usdToCrc,
    rate,
    periodEndDate
  };
})();