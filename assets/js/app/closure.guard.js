// Cierre de mes guard (fuente única) - v1.11.1
// - Cachea reconciliations cerradas (account_id + period)
// - Expone helpers para validar operaciones sobre movimientos/splits
(function () {
  window.SGF = window.SGF || {};

  const _cache = {
    loaded: false,
    closedKeys: new Set(), // key = `${accountId}|${period}`
    loadedAt: 0
  };

  function key(accountId, period) {
    return `${Number(accountId)}|${String(period)}`;
  }

  function loadClosed() {
    _cache.closedKeys.clear();
    const rows = window.SGF.db.select(
      `SELECT account_id, period
         FROM reconciliations
        WHERE closed = 1`
    );
    for (const r of rows) {
      if (r.account_id != null && r.period) _cache.closedKeys.add(key(r.account_id, r.period));
    }
    _cache.loaded = true;
    _cache.loadedAt = Date.now();
  }

  function ensureLoaded() {
    if (!_cache.loaded) loadClosed();
  }

  function invalidate() {
    _cache.loaded = false;
    _cache.closedKeys.clear();
    _cache.loadedAt = 0;
  }

  function isClosed(accountId, period) {
    if (!accountId || !period) return false;
    ensureLoaded();
    return _cache.closedKeys.has(key(accountId, period));
  }

  function _accountsForMovement(mov) {
    if (!mov) return [];
    const a = [];
    if (mov.account_id != null) a.push(Number(mov.account_id));
    if (String(mov.type || '').toLowerCase() === 'transfer' && mov.account_to_id != null) {
      a.push(Number(mov.account_to_id));
    }
    return Array.from(new Set(a));
  }

  function _periodForMovement(mov) {
    if (!mov) return null;
    if (mov.period) return String(mov.period);
    // fallback: derivar desde fecha YYYY-MM-DD
    if (mov.date && typeof mov.date === 'string' && mov.date.length >= 7) return mov.date.slice(0, 7);
    return null;
  }

  function assertNotClosedForMovement(op, mov) {
    const period = _periodForMovement(mov);
    const accounts = _accountsForMovement(mov);

    for (const accId of accounts) {
      if (isClosed(accId, period)) {
        const msg = `Operación bloqueada: el mes ${period} está cerrado para la cuenta ${accId}.`;
        const err = new Error(msg);
        err.code = 'MONTH_CLOSED';
        err.meta = { op, period, accountId: accId };
        throw err;
      }
    }
  }

  // Para updates que cambian cuenta/periodo: validar tanto el "antes" como el "después"
  function assertNotClosedForChange(op, oldMov, newMov) {
    if (oldMov) assertNotClosedForMovement(op, oldMov);
    if (newMov) assertNotClosedForMovement(op, newMov);
  }

  // Para splits: usar el movimiento padre como fuente de cuenta/periodo
  function assertNotClosedForSplit(op, parentMovement) {
    assertNotClosedForMovement(op, parentMovement);
  }

  window.SGF.closureGuard = {
    invalidate,
    isClosed,
    assertNotClosedForMovement,
    assertNotClosedForChange,
    assertNotClosedForSplit
  };
})();