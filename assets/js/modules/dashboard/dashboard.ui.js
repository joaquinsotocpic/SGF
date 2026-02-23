// v1.18.9 - Dashboard KPIs (auto-aplica; Año/Mes "Todos")
window.SGF = window.SGF || {};
window.SGF.modules = window.SGF.modules || {};

(function () {
  const MONTHS = [
    { value: '01', label: 'enero' }, { value: '02', label: 'febrero' }, { value: '03', label: 'marzo' },
    { value: '04', label: 'abril' }, { value: '05', label: 'mayo' }, { value: '06', label: 'junio' },
    { value: '07', label: 'julio' }, { value: '08', label: 'agosto' }, { value: '09', label: 'septiembre' },
    { value: '10', label: 'octubre' }, { value: '11', label: 'noviembre' }, { value: '12', label: 'diciembre' },
  ];

  function formatMoney(amount, currency) {
    const n = Number(amount || 0);
    const cur = currency === 'USD' ? 'USD' : 'CRC';
    const fmt = window.SGF?.format?.money;
    if (typeof fmt === 'function') return fmt(n, cur);
    try {
      return new Intl.NumberFormat('es-CR', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n);
    } catch {
      return `${cur} ${n.toFixed(2)}`;
    }
  }

  function buildOptions(selectEl, items, { includeAll = true, allLabel = '(Todos)', allValue = 'all' } = {}) {
    if (!selectEl) return;
    const opts = [];
    if (includeAll) opts.push(`<option value="${allValue}">${allLabel}</option>`);
    for (const it of (items || [])) {
      opts.push(`<option value="${String(it.value)}">${String(it.label)}</option>`);
    }
    selectEl.innerHTML = opts.join('');
  }

  function dbAll(sql, params) {
    try { return window.SGF.db.all(sql, params || {}); } catch { return []; }
  }
  function dbScalar(sql, params) {
    try { return window.SGF.db.scalar(sql, params || {}); } catch { return 0; }
  }

  function getYears() {
    const rows = dbAll(
      `SELECT DISTINCT SUBSTR(period,1,4) AS y
       FROM movements
       WHERE period IS NOT NULL AND LENGTH(period) >= 7
       ORDER BY y DESC`
    );
    return rows.map(r => String(r.y)).filter(Boolean);
  }

  function getMaxPeriod({ year, currency, accountId }) {
    const where = [];
    const p = {};
    if (currency) { where.push(`currency = :cur`); p[':cur'] = currency; }
    if (year && year !== 'all') { where.push(`SUBSTR(period,1,4) = :y`); p[':y'] = year; }
    if (accountId && Number(accountId) > 0) {
      where.push(`(account_id = :aid OR account_to_id = :aid)`);
      p[':aid'] = Number(accountId);
    }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const maxp = dbScalar(`SELECT MAX(period) FROM movements ${w}`, p);
    return String(maxp || '');
  }

  function getRangeFilter({ year, month }) {
    // returns { whereSql, params, label, endPeriod }
    const params = {};
    let whereSql = '';
    let label = 'Historial';
    let endPeriod = '';

    if (year === 'all' && month === 'all') {
      label = 'Historial';
      return { whereSql, params, label, endPeriod };
    }

    if (year !== 'all' && month === 'all') {
      whereSql = `SUBSTR(period,1,4) = :y`;
      params[':y'] = String(year);
      label = `Año ${year}`;
      return { whereSql, params, label, endPeriod };
    }

    if (year !== 'all' && month !== 'all') {
      const per = `${year}-${month}`;
      whereSql = `period = :p`;
      params[':p'] = per;
      label = `${MONTHS.find(m => m.value === month)?.label || month} ${year}`;
      endPeriod = per;
      return { whereSql, params, label, endPeriod };
    }

    // month selected but year=all: no soportado (normalizamos)
    return { whereSql, params, label, endPeriod };
  }

  function getEndPeriod({ year, month, currency, accountId }) {
    // endPeriod for saldo neto
    if (year !== 'all' && month !== 'all') return `${year}-${month}`;

    const maxp = getMaxPeriod({ year, currency, accountId });
    if (maxp) return maxp;

    // fallback
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function setKpi(name, value, currency) {
    const el = document.querySelector(`[data-kpi="${name}"]`);
    if (el) el.textContent = formatMoney(value, currency);
  }

  function loadAccounts(currency) {
    const rows = dbAll(
      `SELECT a.id, a.name AS account_name, a.currency, t.name AS type_name
       FROM accounts a
       LEFT JOIN account_types t ON t.id = a.type_id
       WHERE a.active = 1 AND a.currency = :cur
       ORDER BY COALESCE(t.name,''), a.name`,
      { ':cur': currency }
    );
    return rows.map(r => ({
      id: r.id,
      label: `${(r.type_name || 'Cuenta')} > ${r.account_name} (${r.currency || currency})`,
    }));
  }

  function computeKpis({ year, month, currency, accountId }) {
    const range = getRangeFilter({ year, month });
    const w = [];
    const p = {};

    if (range.whereSql) w.push(range.whereSql), Object.assign(p, range.params);
    w.push(`currency = :cur`); p[':cur'] = currency;

    // filtro cuenta (rango)
    if (Number(accountId) > 0) {
      w.push(`(account_id = :aid OR account_to_id = :aid)`);
      p[':aid'] = Number(accountId);
    }

    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';

    const income = dbScalar(`SELECT COALESCE(SUM(amount),0) FROM movements ${where} AND type='income'`, p);
    const expense = dbScalar(`SELECT COALESCE(SUM(amount),0) FROM movements ${where} AND type='expense'`, p);

    // Ahorros: is_savings=1 y savings_kind
    const dep = dbScalar(`SELECT COALESCE(SUM(amount),0) FROM movements ${where} AND is_savings=1 AND savings_kind='deposit'`, p);
    const wit = dbScalar(`SELECT COALESCE(SUM(amount),0) FROM movements ${where} AND is_savings=1 AND savings_kind='withdraw'`, p);
    const savings = Number(dep || 0) - Number(wit || 0);

    // Saldo neto: al cierre del endPeriod
    const endPeriod = getEndPeriod({ year, month, currency, accountId });
    const wn = [];
    const pn = { ':cur': currency, ':end': endPeriod };

    // cuenta (saldo) y period <= end
    wn.push(`currency = :cur`);
    wn.push(`period <= :end`);
    if (Number(accountId) > 0) {
      wn.push(`(account_id = :aid OR account_to_id = :aid)`);
      pn[':aid'] = Number(accountId);
    }

    const whereNet = `WHERE ${wn.join(' AND ')}`;

    const net = dbScalar(
      `SELECT COALESCE(SUM(
        CASE
          WHEN type='income' AND account_id IS NOT NULL THEN amount
          WHEN type='expense' AND account_id IS NOT NULL THEN -amount
          WHEN type='transfer' AND account_id IS NOT NULL THEN -amount
          WHEN type='transfer' AND account_to_id IS NOT NULL THEN COALESCE(amount_to, amount)
          ELSE 0
        END
      ),0) AS net
      FROM movements
      ${whereNet}`,
      pn
    );

    return { income, expense, savings, net, rangeLabel: range.label, endPeriod };
  }

  function normalizeMonthYear(yearEl, monthEl) {
    if (!yearEl || !monthEl) return;
    if (monthEl.value !== 'all' && yearEl.value === 'all') {
      // si elige mes, forzar año actual (mejor que query ambiguo)
      const d = new Date();
      yearEl.value = String(d.getFullYear());
    }
  }

  function debounce(fn, ms) {
    let t = null;
    return function () {
      clearTimeout(t);
      const args = arguments;
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function init() {
    const yearEl = document.getElementById('dash-year');
    const monthEl = document.getElementById('dash-month');
    const curEl = document.getElementById('dash-currency');
    const accEl = document.getElementById('dash-account');

    // build filters
    const years = getYears();
    buildOptions(yearEl, years.map(y => ({ value: y, label: y })), { includeAll: true });
    buildOptions(monthEl, MONTHS, { includeAll: true });
    if (yearEl) yearEl.value = 'all';
    if (monthEl) monthEl.value = 'all';

    // accounts initial
    const fillAccounts = () => {
      const cur = curEl?.value || 'CRC';
      const accs = loadAccounts(cur);
      buildOptions(accEl, accs.map(a => ({ value: String(a.id), label: a.label })), { includeAll: true, allLabel: '(Todas)', allValue: '0' });
      if (accEl) accEl.value = '0';
    };
    fillAccounts();

    const refresh = debounce(() => {
      if (!yearEl || !monthEl || !curEl || !accEl) return;
      normalizeMonthYear(yearEl, monthEl);

      const year = yearEl.value || 'all';
      const month = monthEl.value || 'all';
      const currency = curEl.value || 'CRC';
      const accountId = accEl.value || '0';

      // si cambia moneda, recargar cuentas y mantener "todas"
      // (solo cuando se invoca desde cambio moneda)
      const k = computeKpis({ year, month, currency, accountId });

      setKpi('in', k.income, currency);
      setKpi('out', k.expense, currency);
      setKpi('sav', k.savings, currency);
      setKpi('net', k.net, currency);

      const netSub = document.getElementById('dash-net-sub');
      if (netSub) {
        netSub.textContent = (year === 'all' && month === 'all')
          ? `Al cierre del último periodo (${k.endPeriod}).`
          : `Al cierre del periodo (${k.endPeriod}).`;
      }
    }, 60);

    if (yearEl) yearEl.addEventListener('change', refresh);
    if (monthEl) monthEl.addEventListener('change', refresh);
    if (accEl) accEl.addEventListener('change', refresh);
    if (curEl) curEl.addEventListener('change', () => {
      fillAccounts();
      refresh();
    });

    refresh();
  }

  window.SGF.modules.dashboard = {
    onMount() {
      // En algunos flujos el HTML se inyecta y tarda un tick en estar disponible.
      setTimeout(init, 0);
    }
  };
})();