// v1.29.1 - Reportes: Estado de Resultados (pie de tabla)
window.SGF = window.SGF || {};
window.SGF.modules = window.SGF.modules || {};

(function(){
  const E = window.SGF?.reports?.engine;
  const D = window.SGF?.reports?.data;

  const MONTHS = [
    { value: 'all', label: '(Todos)' },
    { value: '01', label: 'enero' }, { value: '02', label: 'febrero' }, { value: '03', label: 'marzo' },
    { value: '04', label: 'abril' }, { value: '05', label: 'mayo' }, { value: '06', label: 'junio' },
    { value: '07', label: 'julio' }, { value: '08', label: 'agosto' }, { value: '09', label: 'setiembre' },
    { value: '10', label: 'octubre' }, { value: '11', label: 'noviembre' }, { value: '12', label: 'diciembre' },
  ];

  function $(id){ return document.getElementById(id); }

  function fillSelect(el, items, value){
    if (!el) return;
    el.innerHTML = items.map(i => `<option value="${String(i.value)}">${String(i.label)}</option>`).join('');
    if (E?.setSelectValueIfExists) E.setSelectValueIfExists(el, value);
  }

  function loadAccounts(currency){
    // No filtrar por moneda; si quieres, luego lo hacemos opcional
    const rows = window.SGF.db.select(`
      SELECT a.id, a.name
      FROM accounts a
      WHERE a.active=1
      ORDER BY a.name
    `);
    const out = [{ value: 0, label: '(Todas)' }];
    for (const r of rows) out.push({ value: String(r.id), label: r.name });
    return out;
  }

  function loadYears(){
    const rows = window.SGF.db.select(`SELECT DISTINCT SUBSTR(date,1,4) AS y FROM movements WHERE COALESCE(is_opening,0)=0 ORDER BY y DESC`);
    const out = [{ value: 'all', label: '(Todos)' }];
    for (const r of rows) if (r.y) out.push({ value: String(r.y), label: String(r.y) });
    return out;
  }

  function loadCurrencies(){
    const rows = window.SGF.db.select(`SELECT DISTINCT COALESCE(currency,'CRC') AS c FROM movements ORDER BY c`);
    const out = [{ value: 'all', label: '(Todas)' }];
    for (const r of rows) if (r.c) out.push({ value: String(r.c), label: String(r.c) });
    return out;
  }

  function getRange(year, month){
    // Re-usa lógica simple: year/month -> label y whereSql
    let label = '(Todos)';
    let whereSql = '';
    const params = {};
    if (month && month !== 'all' && String(month).includes('-')) {
      label = month;
      whereSql = "m.period = :p";
      params[':p'] = String(month);
    } else if (year && year !== 'all') {
      label = year;
      whereSql = "SUBSTR(m.period,1,4) = :y";
      params[':y'] = String(year);
    }
    return { label, whereSql, params };
  }

  function onMount(){
    if (!window.SGF?.db) return;

    const STORE_KEY = 'reportes_estado_resultados';

    const yearEl = $('is-year');
    const monthEl = $('is-month');
    const curEl = $('is-currency');
    const accEl = $('is-account');
    const labelEl = $('is-range-label');
    const tbody = $('is-tbody');

    const saved = E?.loadFilters ? E.loadFilters(STORE_KEY) : null;

    fillSelect(curEl, loadCurrencies(), saved?.currency || 'all');
    fillSelect(accEl, loadAccounts(curEl.value), saved?.accountId ?? 0);
    fillSelect(yearEl, loadYears(), saved?.year || 'all');

    // month uses either 'all' or 'YYYY-MM'
    const monthItems = [{ value:'all', label:'(Todos)' }].concat(
      // build 12 months for current selected year
      MONTHS.slice(1).map(m => ({ value: `${yearEl.value === 'all' ? (new Date().getFullYear()) : yearEl.value}-${m.value}`, label: m.label }))
    );
    fillSelect(monthEl, monthItems, saved?.month || 'all');

    function saveState(){
      E?.saveFilters && E.saveFilters(STORE_KEY, {
        year: yearEl.value,
        month: monthEl.value,
        currency: curEl.value,
        accountId: accEl.value,
      });
    }

    function renderRows({ income, expense, net, currency, range }){
      if (!tbody) return;
      const fmt = (v)=> E?.fmtMoney ? E.fmtMoney(v, currency==='all'?'CRC':currency) : String(v);
      const cls = (v)=> E?.moneyClass ? E.moneyClass(v) : '';
      tbody.innerHTML = `
        <tr class="border-b hover:bg-slate-50 cursor-pointer" data-kind="pnl" data-type="income">
          <td class="py-2 px-3 font-medium">Ingresos</td>
          <td class="py-2 px-3 text-right tabular-nums ${cls(income)}">${fmt(income)}</td>
        </tr>
        <tr class="border-b hover:bg-slate-50 cursor-pointer" data-kind="pnl" data-type="expense">
          <td class="py-2 px-3 font-medium">Gastos</td>
          <td class="py-2 px-3 text-right tabular-nums ${cls(-expense)}">${fmt(-expense)}</td>
        </tr>
        <tr class="hover:bg-slate-50 cursor-pointer" data-kind="pnl" data-type="both">
          <td class="py-2 px-3 font-bold">Resultado Neto</td>
          <td class="py-2 px-3 text-right tabular-nums font-bold ${cls(net)}">${fmt(net)}</td>
        </tr>
        <tr class="bg-slate-50">
          <td class="py-2 px-3 font-semibold">Total</td>
          <td class="py-2 px-3 text-right tabular-nums font-semibold ${cls(net)}">${fmt(net)}</td>
        </tr>
      `;

      // delegated click drill
      tbody.querySelectorAll('tr[data-kind="pnl"][data-type]').forEach(tr=>{
        tr.addEventListener('click', ()=>{
          const typ = tr.getAttribute('data-type') || 'both';
          const rg = range.whereSql ? range : { whereSql:'', params:{} };
          window.SGF?.reports?.drill?.openFromQuery?.({
            subtitle: tr.querySelector('td')?.innerText?.trim() || 'Movimientos',
            rangeLabel: range.label,
            currency: (currency==='all'?'CRC':currency),
            scope: { kind: 'pnl', accountId: Number(accEl.value||0) },
            type: typ,
            range: rg,
          });
        });
      });
    }

    function refresh(){
      saveState();
      const norm = E?.normalizeRange ? E.normalizeRange({ year: yearEl.value, month: monthEl.value }) : { year: yearEl.value, month: monthEl.value };
      if (norm.year !== yearEl.value) yearEl.value = norm.year;
      if (norm.month !== monthEl.value) monthEl.value = norm.month;

      const range = getRange(yearEl.value, monthEl.value);
      labelEl.textContent = range.label;

      const db = window.SGF.db;
      const res = D?.queryIncomeExpense ? D.queryIncomeExpense({
        db,
        year: yearEl.value,
        month: monthEl.value,
        currency: curEl.value,
        accountId: Number(accEl.value||0),
      }) : { income:0, expense:0, net:0 };

      renderRows({ ...res, currency: curEl.value, range });
    }

    const deb = E?.debounce ? E.debounce(refresh, 80) : refresh;
    [yearEl, monthEl, curEl, accEl].forEach(el=>{
      if (!el) return;
      el.addEventListener('change', deb);
    });

    refresh();
  }

  window.SGF.modules.reportes_estado_resultados = { onMount };
})();
