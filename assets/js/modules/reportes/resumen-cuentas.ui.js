window.SGF = window.SGF || {};
window.SGF.modules = window.SGF.modules || {};

(function () {
  const E = window.SGF?.reports?.engine;
  const MONTHS = [
    { value: 'all', label: '(Todos)' },
    { value: '01', label: 'enero' }, { value: '02', label: 'febrero' }, { value: '03', label: 'marzo' },
    { value: '04', label: 'abril' }, { value: '05', label: 'mayo' }, { value: '06', label: 'junio' },
    { value: '07', label: 'julio' }, { value: '08', label: 'agosto' }, { value: '09', label: 'septiembre' },
    { value: '10', label: 'octubre' }, { value: '11', label: 'noviembre' }, { value: '12', label: 'diciembre' },
  ];

  function dbAll(sql, params = {}) {
    return window.SGF?.db?.select?.(sql, params) || [];
  }
  function dbScalar(sql, params = {}) {
    const rows = dbAll(sql, params);
    if (!rows || !rows.length) return 0;
    const k = Object.keys(rows[0] || {})[0];
    return rows[0]?.[k] ?? 0;
  }

  function debounce(fn, wait = 120) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function escapeHtml(s) {
    return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  }

  function fmtMoney(amount, currency) {
    const n = Number(amount || 0);
    const cur = currency === 'USD' ? 'USD' : 'CRC';
    const fmt = window.SGF?.format?.money;
    if (typeof fmt === 'function') return fmt(n, cur);
    try {
      return new Intl.NumberFormat('es-CR', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(n);
    } catch (_) {
      return String(n.toFixed(2));
    }
  }

  function moneyClass(v, kind) {
    const n = Number(v || 0);
    if (!isFinite(n) || n === 0) return 'text-slate-700';
    if (kind === 'gasto') return 'text-rose-700';
    if (kind === 'ingreso') return 'text-emerald-700';
    return n > 0 ? 'text-emerald-700' : 'text-rose-700';
  }

  function getRangeFilter(year, month) {
    // period stored as 'YYYY-MM'
    if (year === 'all' && month === 'all') return { where: '', params: {}, label: 'Todo' };

    if (month === 'all') {
      const y = String(year);
      return {
        where: ' AND m.period BETWEEN :p1 AND :p2 ',
        params: { ':p1': `${y}-01`, ':p2': `${y}-12` },
        label: `Año ${y}`,
      };
    }

    // Si hay mes, normalizar año (si viene all, usar último año con data para ese mes)
    let y = year;
    if (y === 'all') {
      const yy = dbScalar(
        `SELECT MAX(CAST(substr(period,1,4) AS INT)) AS y FROM movements WHERE substr(period,6,2)=:mm`,
        { ':mm': String(month).padStart(2, '0') }
      );
      y = yy ? String(yy) : String(new Date().getFullYear());
    } else {
      y = String(y);
    }

    const mm = String(month).padStart(2, '0');
    return {
      where: ' AND m.period = :p ',
      params: { ':p': `${y}-${mm}` },
      label: `${MONTHS.find(x => x.value === mm)?.label || mm} ${y}`,
    };
  }

  function getEndPeriod(year, month) {
    if (year === 'all' && month === 'all') {
      return dbScalar('SELECT MAX(period) AS p FROM movements', {}) || '';
    }
    if (month === 'all') {
      const y = String(year === 'all' ? new Date().getFullYear() : year);
      return `${y}-12`;
    }
    let y = year;
    if (y === 'all') {
      const yy = dbScalar(
        `SELECT MAX(CAST(substr(period,1,4) AS INT)) AS y FROM movements WHERE substr(period,6,2)=:mm`,
        { ':mm': String(month).padStart(2, '0') }
      );
      y = yy ? String(yy) : String(new Date().getFullYear());
    } else y = String(y);
    const mm = String(month).padStart(2, '0');
    return `${y}-${mm}`;
  }

  function loadYears() {
    const rows = dbAll(`SELECT DISTINCT substr(period,1,4) AS y FROM movements ORDER BY y DESC`);
    return rows.map(r => String(r.y)).filter(Boolean);
  }

  function loadCurrencies() {
    const rows = dbAll(`SELECT DISTINCT currency AS c FROM accounts ORDER BY c`);
    const list = rows.map(r => String(r.c)).filter(Boolean);
    return list.length ? list : ['CRC'];
  }

  function loadAccounts(currency) {
    const rows = dbAll(
      `SELECT a.id, a.name, COALESCE(NULLIF(a.currency,''), :c) AS currency, COALESCE(at.name,'Sin tipo') AS typeName
       FROM accounts a
       LEFT JOIN account_types at ON at.id = a.type_id
       WHERE a.active=1
       ORDER BY typeName, a.name`,
      { ':c': currency }
    );
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      currency: r.currency,
      typeName: r.typeName || 'Sin tipo',
      rowLabel: `${r.name} (${r.currency})`,
    }));
  }

  function computeRow({ year, month, currency, accountId }) {
    const { where, params, label } = getRangeFilter(year, month);
    const endPeriod = getEndPeriod(year, month);

    const income = dbScalar(
      `SELECT COALESCE(SUM(m.amount),0) AS v
       FROM movements m
       WHERE m.type='income' AND m.account_id=:aid AND m.currency=:cur ${where}`,
      { ...params, ':aid': accountId, ':cur': currency }
    );

    const expense = dbScalar(
      `SELECT COALESCE(SUM(m.amount),0) AS v
       FROM movements m
       WHERE m.type='expense' AND m.account_id=:aid AND m.currency=:cur ${where}`,
      { ...params, ':aid': accountId, ':cur': currency }
    );

    // Ahorros: solo entradas/salidas de transfer con is_savings=1. Dirección correcta.
    const isSavingsAccount = dbScalar(
      `SELECT CASE WHEN LOWER(COALESCE(at.name,'')) LIKE '%ahorro%' THEN 1 ELSE 0 END AS ok
       FROM accounts a LEFT JOIN account_types at ON at.id=a.type_id
       WHERE a.id=:aid`,
      { ':aid': accountId }
    ) === 1;

    let savings = 0;
    if (isSavingsAccount) {
      const dep = dbScalar(
        `SELECT COALESCE(SUM(COALESCE(m.amount_to, m.amount)),0) AS v
         FROM movements m
         WHERE m.type='transfer' AND COALESCE(m.is_savings,0)=1 AND m.account_to_id=:aid AND m.currency=:cur ${where}`,
        { ...params, ':aid': accountId, ':cur': currency }
      );
      const wit = dbScalar(
        `SELECT COALESCE(SUM(m.amount),0) AS v
         FROM movements m
         WHERE m.type='transfer' AND COALESCE(m.is_savings,0)=1 AND m.account_id=:aid AND m.currency=:cur ${where}`,
        { ...params, ':aid': accountId, ':cur': currency }
      );
      savings = Number(dep || 0) - Number(wit || 0);
    }

    // Saldo neto al cierre del periodo (acumulado)
    let net = 0;
    if (endPeriod) {
      net = dbScalar(
        `SELECT COALESCE(SUM(
          CASE
            WHEN m.type='income' AND m.account_id=:aid THEN m.amount
            WHEN m.type='expense' AND m.account_id=:aid THEN -m.amount
            WHEN m.type='transfer' AND m.account_id=:aid THEN -m.amount
            WHEN m.type='transfer' AND m.account_to_id=:aid THEN COALESCE(m.amount_to, m.amount)
            ELSE 0
          END
        ),0) AS v
        FROM movements m
        WHERE m.currency=:cur AND m.period <= :pEnd AND (m.account_id=:aid OR m.account_to_id=:aid)`,
        { ':aid': accountId, ':cur': currency, ':pEnd': endPeriod }
      );
    }

    return { income: Number(income||0), expense: Number(expense||0), savings: Number(savings||0), net: Number(net||0), rangeLabel: label };
  }

  function renderHierarchy({ tbody, rows, currency, expandedTypes, order = 'desc', expandAll = false, tipo = 'expense' }) {
    const groups = new Map();
    for (const r of rows) {
      const k = String(r.typeName || 'Sin tipo').trim();
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }

    const groupArr = Array.from(groups.entries()).map(([typeName, list]) => {
      const totNet = list.reduce((a,b)=>a+Number(b.net||0),0);
      let metric = 0;
      if (tipo === 'expense') metric = Math.abs(list.reduce((s,x)=>s+Number(x.expense||0),0));
      else if (tipo === 'income') metric = Math.abs(list.reduce((s,x)=>s+Number(x.income||0),0));
      else metric = Math.abs(list.reduce((s,x)=>s+(Number(x.income||0)-Number(x.expense||0)),0));
      return { typeName, list, metric, totNet };
    });
    groupArr.sort((a,b)=> (order==='asc' ? a.metric-b.metric : b.metric-a.metric) || a.typeName.localeCompare(b.typeName));

    if (expandAll) {
      expandedTypes.clear();
      for (const g of groupArr) expandedTypes.add(g.typeName);
    }

    const html = [];
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-500">Sin datos</td></tr>`;
      return;
    }

    for (const g of groupArr) {
      const typeName = String(g.typeName || 'Sin tipo').trim();
      const list = g.list;

      const isExp = expandedTypes.has(typeName);
      const childArr = [...list].sort((a,b)=>{
        const ma = (tipo==='expense') ? Math.abs(Number(a.expense||0)) : (tipo==='income') ? Math.abs(Number(a.income||0)) : Math.abs(Number(a.income||0)-Number(a.expense||0));
        const mb = (tipo==='expense') ? Math.abs(Number(b.expense||0)) : (tipo==='income') ? Math.abs(Number(b.income||0)) : Math.abs(Number(b.income||0)-Number(b.expense||0));
        return (order==='asc' ? ma-mb : mb-ma) || String(a.rowLabel||'').localeCompare(String(b.rowLabel||''));
      });
      const caret = `<button type="button" class="racc-toggle inline-flex items-center justify-center w-7 h-7 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 mr-2" data-key="${encodeURIComponent(typeName)}" title="${isExp ? 'Contraer' : 'Expandir'}">
        <i data-lucide="${isExp ? 'chevron-down' : 'chevron-right'}" class="w-4 h-4"></i>
      </button>`;

      const totNet = g.totNet;
      const totInc = list.reduce((a,b)=>a+Number(b.income||0),0);
      const totExp = list.reduce((a,b)=>a+Number(b.expense||0),0);
      const totSav = list.reduce((a,b)=>a+Number(b.savings||0),0);

      html.push(`
        <tr class="border-b hover:bg-slate-50 cursor-pointer" data-kind="parent" data-key="${encodeURIComponent(typeName)}">
          <td class="py-3 px-3 font-semibold text-slate-900">
            <div class="flex items-center gap-2">${caret}<span class="leading-none">${escapeHtml(typeName)}</span></div>
          </td>
          <td class="py-3 px-3 text-right tabular-nums font-semibold ${moneyClass(totNet,'saldo')}">${fmtMoney(totNet, currency)}</td>
          <td class="py-3 px-3 text-right tabular-nums font-semibold ${moneyClass(totInc,'ingreso')}">${fmtMoney(totInc, currency)}</td>
          <td class="py-3 px-3 text-right tabular-nums font-semibold ${moneyClass(totExp,'gasto')}">${fmtMoney(totExp, currency)}</td>
          <td class="py-3 px-3 text-right tabular-nums font-semibold ${moneyClass(totSav,'ahorro')}">${fmtMoney(totSav, currency)}</td>
        </tr>
      `);

      if (isExp) {
        for (const r of childArr) {
          html.push(`
            <tr class="border-b last:border-b-0 hover:bg-slate-50" data-kind="child" data-account-id="${r.accountId}" data-key="${encodeURIComponent(typeName)}">
              <td class="py-3 px-3">
                <div class="flex items-center gap-2" style="padding-left: 24px;">
                  <span class="inline-block w-7 h-7 mr-2"></span>
                  <span class="text-slate-800 leading-none">${escapeHtml(r.rowLabel)}</span>
                </div>
              </td>
              <td class="py-3 px-3 text-right tabular-nums ${moneyClass(r.net,'saldo')}">${fmtMoney(r.net, currency)}</td>
              <td class="py-3 px-3 text-right tabular-nums ${moneyClass(r.income,'ingreso')}">${fmtMoney(r.income, currency)}</td>
              <td class="py-3 px-3 text-right tabular-nums ${moneyClass(r.expense,'gasto')}">${fmtMoney(r.expense, currency)}</td>
              <td class="py-3 px-3 text-right tabular-nums ${moneyClass(r.savings,'ahorro')}">${fmtMoney(r.savings, currency)}</td>
            </tr>
          `);
        }
      }
    }

    tbody.innerHTML = html.join('');

    // Drill-down: click en cuenta (hijo)
    tbody.querySelectorAll('tr[data-kind="child"][data-account-id]').forEach(tr => {
      tr.classList.add('cursor-pointer');
      tr.addEventListener('click', (e)=>{
        e.stopPropagation();
        const aid = Number(tr.getAttribute('data-account-id')||0);
        if (!aid) return;
        const ctx = window.SGF.__repAccCtx || {};
        window.SGF?.reports?.drill?.openFromQuery?.({
          subtitle: tr.querySelector('td')?.innerText?.trim() || 'Movimientos',
          rangeLabel: ctx.rangeLabel || '—',
          currency: ctx.currency || 'CRC',
          scope: { kind: 'account', id: aid },
          type: ctx.tipo || 'both',
          range: ctx.range || {},
        });
      });
    });
    // bind toggles
    tbody.querySelectorAll('.racc-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const t = decodeURIComponent(btn.getAttribute('data-key') || '') || '';
        if (!t) return;
        if (expandedTypes.has(t)) expandedTypes.delete(t);
        else expandedTypes.add(t);
        
        if (window.SGF.__repAccState) window.SGF.__repAccState.expandAll = false;
        window.SGF.__repAccSaveState && window.SGF.__repAccSaveState();
        window.SGF.__repAccRender && window.SGF.__repAccRender();
      });
    });
    // clicking parent row toggles too
    tbody.querySelectorAll('tr[data-kind="parent"]').forEach(tr => {
      tr.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const t = (decodeURIComponent(tr.getAttribute('data-key') || '') || '').trim();
        if (!t) return;
        if (expandedTypes.has(t)) expandedTypes.delete(t);
        else expandedTypes.add(t);
        
        if (window.SGF.__repAccState) window.SGF.__repAccState.expandAll = false;
        window.SGF.__repAccSaveState && window.SGF.__repAccSaveState();
        window.SGF.__repAccRender && window.SGF.__repAccRender();
      });
    });

    try { window.lucide && window.lucide.createIcons && window.lucide.createIcons(); } catch(_) {}
  }

  function onMount() {
    const STORE_KEY = 'reportes_resumen_cuentas';
    const yearEl = document.getElementById('rep-year');
    const monthEl = document.getElementById('rep-month');
    const curEl = document.getElementById('rep-currency');
    const accEl = document.getElementById('rep-account');
    const tbody = document.getElementById('rep-accounts-tbody');
    let orderEl = document.getElementById('rep-order');
    let typEl = document.getElementById('rep-type');
    let expandBtn = document.getElementById('rep-expand-btn');
    let collapseBtn = document.getElementById('rep-collapse-btn');
    const rangeLabelEl = document.getElementById('rep-range-label');

    function ensureExtraFilters(){
      // Si el HTML no fue actualizado (copias parciales / cache), inyecta los filtros faltantes.
      const grid = accEl && accEl.closest('.grid');
      if (!grid) return;

      if (!document.getElementById('rep-order')) {
        grid.insertAdjacentHTML('beforeend', `
          <div class="md:col-span-4">
            <label class="block text-sm font-medium text-slate-700 mb-1">Orden</label>
            <select id="rep-order" class="w-full p-2 rounded-xl border">
              <option value="desc">Monto (mayor → menor)</option>
              <option value="asc">Monto (menor → mayor)</option>
            </select>
          </div>
        `);
      }

      if (!document.getElementById('rep-expand-btn') || !document.getElementById('rep-collapse-btn')) {
        grid.insertAdjacentHTML('beforeend', `
          <div class="md:col-span-4 flex items-center gap-2 mt-2 md:mt-0">
            <button id="rep-expand-btn" type="button" class="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 text-sm">Expandir</button>
            <button id="rep-collapse-btn" type="button" class="px-3 py-2 rounded-xl border bg-white hover:bg-slate-50 text-sm">Contraer</button>
          </div>
        `);
      }

      if (!document.getElementById('rep-type')) {
        grid.insertAdjacentHTML('beforeend', `
          <div class="md:col-span-4">
            <label class="block text-sm font-medium text-slate-700 mb-1">Tipo</label>
            <select id="rep-type" class="w-full p-2 rounded-xl border">
              <option value="expense">Gastos</option>
              <option value="income">Ingresos</option>
              <option value="both">Ambos (Ingresos + Gastos)</option>
            </select>
          </div>
        `);
      }

      // rebind refs
      orderEl = document.getElementById('rep-order');
      typEl = document.getElementById('rep-type');
      expandBtn = document.getElementById('rep-expand-btn');
      collapseBtn = document.getElementById('rep-collapse-btn');
      __typEl = typEl; __orderEl = orderEl;
    }


    if (!yearEl || !monthEl || !curEl || !accEl || !tbody) return;

    ensureExtraFilters();
    __typEl = typEl; __orderEl = orderEl;

    // Populate selects
    const years = loadYears();
    yearEl.innerHTML = `<option value="all">(Todos)</option>` + years.map(y => `<option value="${y}">${y}</option>`).join('');
    monthEl.innerHTML = MONTHS.map(m => `<option value="${m.value}">${m.label}</option>`).join('');

    const currencies = loadCurrencies();
    curEl.innerHTML = currencies.map(c => `<option value="${c}">${c}</option>`).join('');
    if (!curEl.value && currencies.length) curEl.value = currencies[0];

    function refreshAccounts() {
      const currency = curEl.value || currencies[0] || 'CRC';
      const accs = loadAccounts(currency);
      accEl.innerHTML = `<option value="0">(Todas)</option>` + accs.map(a => `<option value="${a.id}">${escapeHtml(a.rowLabel)}</option>`).join('');
    }

    refreshAccounts();
    if (typEl && !typEl.value) typEl.value = 'expense';

    const expandedTypes = window.SGF.__repAccInitExpanded ? new Set(Array.from(window.SGF.__repAccInitExpanded)) : new Set(); // CONTRAÍDO por defecto

    const refresh = (E?.debounce || debounce)(() => {
      const f0 = (E?.readCommonFilters ? E.readCommonFilters({ prefix: 'rep' }) : null);
      const currency = f0 ? f0.currency : (curEl.value || 'CRC');
      refreshAccounts();

      const yearRaw = f0 ? f0.year : (yearEl.value || 'all');
      const monthRaw = f0 ? f0.month : (monthEl.value || 'all');
      const norm = (E?.normalizeRange ? E.normalizeRange({ year: yearRaw, month: monthRaw }) : { year: yearRaw, month: monthRaw });
      const year = norm.year;
      const month = norm.month;
      const tipo = f0 ? f0.type : ((typEl && typEl.value) ? typEl.value : 'expense');
      const order = f0 ? f0.order : ((orderEl && orderEl.value) ? orderEl.value : 'desc');
      const range = { year, month };
      let labelRange = (month && month !== 'all') ? month : ((year && year !== 'all') ? year : '(Todos)');

      const accountId = Number(accEl.value || 0);

      const list = loadAccounts(currency);
      const selected = accountId > 0 ? list.filter(a => String(a.id) === String(accountId)) : list;

      const rows = [];
    let grandTotal = 0;

      function rowMetric(r){
        if (tipo === 'expense') return Math.abs(Number(r.expense||0));
        if (tipo === 'income') return Math.abs(Number(r.income||0));
        // both
        return Math.abs(Number(r.income||0) - Number(r.expense||0));
      }
      function groupMetric(list){
        if (tipo === 'expense') return Math.abs(list.reduce((s,x)=>s+Number(x.expense||0),0));
        if (tipo === 'income') return Math.abs(list.reduce((s,x)=>s+Number(x.income||0),0));
        const signed = list.reduce((s,x)=>s+(Number(x.income||0)-Number(x.expense||0)),0);
        return Math.abs(signed);
      }

      for (const a of selected) {
        const r = computeRow({ year, month, currency, accountId: a.id });
        labelRange = r.rangeLabel;
        rows.push({ accountId: a.id, id: a.id, typeName: a.typeName, rowLabel: a.rowLabel, net: r.net, income: r.income, expense: r.expense, savings: r.savings });
      }

      // Orden dentro de cada tipo por ABS(Saldo)
      const dir = (order === 'asc') ? 1 : -1;
      const byType = new Map();
      for (const r of rows) {
        const k = String(r.typeName || 'Sin tipo').trim();
        if (!byType.has(k)) byType.set(k, []);
        byType.get(k).push(r);
      }
      for (const list of byType.values()) {
        list.sort((a,b) => (rowMetric(a) - rowMetric(b)) * dir || String(a.rowLabel||'').localeCompare(String(b.rowLabel||'')));
      }

      // Ordenar tipos por ABS(total saldo) (respeta "Orden" también)
      const orderedTypes = Array.from(byType.entries()).sort((a,b) => {
        const ta = groupMetric(a[1]);
        const tb = groupMetric(b[1]);
        return (ta - tb) * dir;
      });

      const orderedRows = [];
      for (const [, list] of orderedTypes) orderedRows.push(...list);
      // Expandir/contraer: controlado por expandedTypes (botones)

      window.SGF.__repAccState = { tbody, orderedRows, currency, expandedTypes, order: order, expandAll: false, tipo, range, rangeLabel: labelRange, allKeys: orderedTypes.map(x=>String(x[0]).trim()) };
      window.SGF.__repAccRender = () => {
        const s = window.SGF.__repAccState;
        if (!s) return;
        window.SGF.__repAccCtx = { rangeLabel: s.rangeLabel, currency: s.currency, tipo: s.tipo, range: s.range };
        renderHierarchy({ tbody: s.tbody, rows: s.orderedRows, currency: s.currency, expandedTypes: s.expandedTypes, order: s.order, expandAll: false, tipo: s.tipo });
      };
      window.SGF.__repAccRender();

      if (rangeLabelEl) rangeLabelEl.textContent = labelRange || '—';

    }, 80);

    yearEl.addEventListener('change', refresh);
    monthEl.addEventListener('change', refresh);
    curEl.addEventListener('change', refresh);
    accEl.addEventListener('change', refresh);
    orderEl && orderEl.addEventListener('change', refresh);

    expandBtn && expandBtn.addEventListener('click', () => {
      if (!window.SGF.__repAccState) return;
      window.SGF.__repAccState.expandAll = true;
      saveState();
        window.SGF.__repAccRender && window.SGF.__repAccRender();
      try { window.lucide && window.lucide.createIcons && window.lucide.createIcons(); } catch(_){}
    });
    collapseBtn && collapseBtn.addEventListener('click', () => {
      if (!window.SGF.__repAccState) return;
      window.SGF.__repAccState.expandAll = false;
      window.SGF.__repAccState.expandedTypes && window.SGF.__repAccState.expandedTypes.clear();
      saveState();
        window.SGF.__repAccRender && window.SGF.__repAccRender();
      try { window.lucide && window.lucide.createIcons && window.lucide.createIcons(); } catch(_){}
    });
    typEl && typEl.addEventListener('change', refresh);

    // Motor común: expandir/contraer + toggle (delegación) + drilldown
    E && E.wireExpandControls({
      expandBtnId: 'rep-expand-btn',
      collapseBtnId: 'rep-collapse-btn',
      onExpand: () => {
        const s = window.SGF.__repAccState;
        if (!s) return;
        s.expandedTypes.clear();
        for (const k of (s.allKeys || [])) s.expandedTypes.add(String(k));
        saveState();
        window.SGF.__repAccRender && window.SGF.__repAccRender();
        try { window.lucide?.createIcons?.(); } catch(_){}
      },
      onCollapse: () => {
        const s = window.SGF.__repAccState;
        if (!s) return;
        s.expandedTypes.clear();
        saveState();
        window.SGF.__repAccRender && window.SGF.__repAccRender();
        try { window.lucide?.createIcons?.(); } catch(_){}
      },
    });


    E && E.wireDelegatedToggles({
      tbody,
      toggleSelector: '.racc-toggle, tr[data-kind="parent"][data-key]',
      getKey: (el) => (decodeURIComponent(el.getAttribute('data-key') || '') || '').trim(),
      onToggle: (key) => {
        const s = window.SGF.__repAccState;
        if (!s || !key) return;
        if (s.expandedTypes.has(key)) s.expandedTypes.delete(key);
        else s.expandedTypes.add(key);
        saveState();
        window.SGF.__repAccRender && window.SGF.__repAccRender();
        try { window.lucide?.createIcons?.(); } catch(_){}
      }
    });

    E && E.wireDelegatedRows({
      tbody,
      rowSelector: 'tr[data-kind="child"][data-account-id]',
      onRowClick: (row) => {
        const s = window.SGF.__repAccState;
        if (!s) return;
        const aid = Number(row.getAttribute('data-account-id') || 0);
        if (!aid) return;
        window.SGF?.reports?.drill?.openFromQuery?.({
          subtitle: row.querySelector('td')?.innerText?.trim() || 'Movimientos',
          rangeLabel: s.rangeLabel || '—',
          currency: s.currency || 'CRC',
          scope: { kind: 'account', id: aid },
          type: s.tipo || 'both',
          range: s.range || {},
        });
      }
    });


    function repAccApplyExpand(mode){
      const s = window.SGF.__repAccState;
      if (!s) return;
      if (mode === 'expand') {
        s.expandedTypes.clear();
        for (const k of (s.allKeys || [])) s.expandedTypes.add(String(k));
      } else {
        s.expandedTypes.clear();
      }
      saveState();
        window.SGF.__repAccRender && window.SGF.__repAccRender();
      try { window.lucide?.createIcons?.(); } catch(_){}
    }
    expandBtn && expandBtn.addEventListener('click', () => repAccApplyExpand('expand'));
    collapseBtn && collapseBtn.addEventListener('click', () => repAccApplyExpand('collapse'));

    if (tbody && !tbody.__repAccDelegatedClick) {
      tbody.__repAccDelegatedClick = true;
      tbody.addEventListener('click', (e) => {
        const s = window.SGF.__repAccState;
        if (!s) return;

        const toggle = e.target.closest('.racc-toggle') || e.target.closest('tr[data-kind="parent"][data-key]');
        if (toggle) {
          e.preventDefault();
          e.stopPropagation();
          const key = (decodeURIComponent(toggle.getAttribute('data-key') || '') || '').trim();
          if (!key) return;
          if (s.expandedTypes.has(key)) s.expandedTypes.delete(key);
          else s.expandedTypes.add(key);
          saveState();
        window.SGF.__repAccRender && window.SGF.__repAccRender();
          try { window.lucide?.createIcons?.(); } catch(_){}
          return;
        }

        const child = e.target.closest('tr[data-kind="child"][data-account-id]');
        if (child) {
          const aid = Number(child.getAttribute('data-account-id')||0);
          if (!aid) return;
          window.SGF?.reports?.drill?.openFromQuery?.({
            subtitle: child.querySelector('td')?.innerText?.trim() || 'Movimientos',
            rangeLabel: s.rangeLabel || '—',
            currency: s.currency || 'CRC',
            scope: { kind: 'account', id: aid },
            type: s.tipo || 'both',
            range: s.range || {},
          });
        }
      });
    }

    

    // Persistencia de filtros
    const saved = E?.loadFilters ? E.loadFilters(STORE_KEY) : null;
    if (saved){
      E.setSelectValueIfExists && E.setSelectValueIfExists(yearEl, saved.year);
      E.setSelectValueIfExists && E.setSelectValueIfExists(monthEl, saved.month);
      E.setSelectValueIfExists && E.setSelectValueIfExists(curEl, saved.currency);
      E.setSelectValueIfExists && E.setSelectValueIfExists(accEl, saved.accountId);
      E.setSelectValueIfExists && E.setSelectValueIfExists(typEl, saved.type);
      E.setSelectValueIfExists && E.setSelectValueIfExists(orderEl, saved.order);
    }

    function saveState(){
      try{
        const s = window.SGF.__repAccState;
        const expandedTypes = s?.expandedTypes ? (E?.serializeSet ? E.serializeSet(s.expandedTypes) : Array.from(s.expandedTypes)) : undefined;
        E?.saveFilters && E.saveFilters(STORE_KEY, {
          year: yearEl?.value,
          month: monthEl?.value,
          currency: curEl?.value,
          accountId: accEl?.value,
          type: typEl?.value,
          order: orderEl?.value,
          expandedTypes,
        });
      }catch(_){}
    }

    // expose to renderHierarchy
    window.SGF.__repAccSaveState = saveState;


    refresh();
  }

  window.SGF.modules.reportes_resumen_cuentas = { onMount };
})();