// v1.25.0 - Reportes: Tendencias 12 meses
window.SGF = window.SGF || {};
window.SGF.modules = window.SGF.modules || {};

(function(){
  const E = window.SGF?.reports?.engine;
  const D = window.SGF?.reports?.data;
  const STORE_KEY = 'reportes_tendencias_12m';

  function $(id){ return document.getElementById(id); }
  function esc(s){
    const x = String(s ?? '');
    return x.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  }

  function fillSelect(el, items, value){
    if (!el) return;
    el.innerHTML = (items||[]).map(i => `<option value="${String(i.value)}">${String(i.label)}</option>`).join('');
    if (E?.setSelectValueIfExists) E.setSelectValueIfExists(el, value);
    else el.value = value;
  }

  function loadCurrencies(){
    const rows = window.SGF.db.select(`SELECT DISTINCT COALESCE(currency,'CRC') AS c FROM movements ORDER BY c`);
    const out = [{ value:'all', label:'(Todas)' }];
    for (const r of rows) if (r.c) out.push({ value:String(r.c), label:String(r.c) });
    return out;
  }

  function loadAccounts(){
    const rows = window.SGF.db.select(`SELECT id, name FROM accounts WHERE active=1 ORDER BY name`);
    const out = [{ value:0, label:'(Todas)' }];
    for (const r of rows) out.push({ value:String(r.id), label:String(r.name||'Cuenta') });
    return out;
  }

  function loadYears(){
    const rows = window.SGF.db.select(`SELECT DISTINCT SUBSTR(period,1,4) AS y FROM movements ORDER BY y DESC`);
    const out = [];
    for (const r of rows) if (r.y) out.push({ value:String(r.y), label:String(r.y) });
    // fallback
    if (!out.length){
      const y = String(new Date().getFullYear());
      out.push({ value:y, label:y });
    }
    return out;
  }

  function monthLabel(ym){
    const [y,m] = String(ym).split('-');
    return `${m}/${String(y).slice(2)}`;
  }

  function onMount(){
    if (!window.SGF?.db) return;

    const groupEl=$('tr-group');
    const typeEl=$('tr-type');
    const yearEl=$('tr-year');
    const monthEl=$('tr-month');
    const curEl=$('tr-currency');
    const accEl=$('tr-account');
    const thead=$('tr-thead');
    const tbody=$('tr-tbody');
    const rangeEl=$('tr-range-label');

    const saved = E?.loadFilters ? E.loadFilters(STORE_KEY) : null;

    fillSelect(groupEl, [{value:'category',label:'Categoría'},{value:'account',label:'Cuenta'}], saved?.groupBy || 'category');
    fillSelect(typeEl, [{value:'expense',label:'Gastos'},{value:'income',label:'Ingresos'},{value:'both',label:'Ambos'}], saved?.type || 'expense');
    fillSelect(curEl, loadCurrencies(), saved?.currency || 'all');
    fillSelect(accEl, loadAccounts(), saved?.accountId ?? 0);

    const years = loadYears();
    fillSelect(yearEl, years, saved?.year || years[0].value);

    // default end month = current month
    const now = new Date();
    const defMonth = String(now.getMonth()+1).padStart(2,'0');
    monthEl.value = saved?.month || defMonth;

    function saveState(){
      E?.saveFilters && E.saveFilters(STORE_KEY, {
        groupBy: groupEl.value,
        type: typeEl.value,
        year: yearEl.value,
        month: monthEl.value,
        currency: curEl.value,
        accountId: accEl.value,
      });
    }

    function compute(){
      saveState();

      // if grouping by account, ignore account filter (keep UI but pass 0)
      const groupBy = groupEl.value;
      const accountId = (groupBy === 'account') ? 0 : Number(accEl.value||0);

      const endPeriod = `${yearEl.value}-${monthEl.value}`;
      const res = D?.queryTrend12m ? D.queryTrend12m({
        db: window.SGF.db,
        endPeriod,
        months: 12,
        currency: curEl.value,
        accountId,
        type: typeEl.value,
        groupBy,
      }) : { periods: [], rows: [] };

      const code = (curEl.value==='all'?'CRC':curEl.value);
      const fmt = (v)=> E?.fmtMoney ? E.fmtMoney(v, code) : String(v);
      const mc = (v)=> E?.moneyClass ? E.moneyClass(v) : '';

      // header
      const headCols = ['<th class="text-left py-2 px-3 sticky left-0 bg-slate-50 z-10">Grupo</th>']
        .concat((res.periods||[]).map(p=> `<th class="text-right py-2 px-2 whitespace-nowrap">${esc(monthLabel(p))}</th>`))
        .concat(['<th class="text-right py-2 px-3">Total</th>']);
      thead.innerHTML = `<tr>${headCols.join('')}</tr>`;

      const p1 = res.periods?.[0] || '';
      const p2 = res.periods?.[res.periods.length-1] || '';
      rangeEl.textContent = p1 && p2 ? `${p1} → ${p2}` : '—';

      // rows
      const rows = (res.rows||[]).slice(0,25);
      tbody.innerHTML = rows.map(r=>{
        const cells = [`<td class="py-2 px-3 sticky left-0 bg-white z-10"><span class="font-medium">${esc(r.name)}</span></td>`]
          .concat((r.totals||[]).map(v=> `<td class="py-2 px-2 text-right tabular-nums"><span class="${mc(v)}">${esc(fmt(v))}</span></td>`))
          .concat([`<td class="py-2 px-3 text-right tabular-nums font-semibold"><span class="${mc(r.total)}">${esc(fmt(r.total))}</span></td>`]);

        return `<tr class="border-b hover:bg-slate-50 cursor-pointer tr-row" data-g="${esc(groupBy)}" data-id="${String(r.id)}">${cells.join('')}</tr>`;
      }).join('') || `<tr><td class="py-4 px-3 text-slate-500" colspan="99">Sin datos.</td></tr>`;

      // drilldown
      tbody.querySelectorAll('tr.tr-row').forEach(tr=>{
        tr.addEventListener('click', ()=>{
          const gid = Number(tr.getAttribute('data-id')||0);
          const g = tr.getAttribute('data-g') || 'category';
          const range = { whereSql: 'm.period BETWEEN :p1 AND :p2', params: { ':p1': p1, ':p2': p2 } };
          const subtitle = tr.querySelector('span.font-medium')?.innerText || 'Movimientos';
          const scope = (g==='account') ? { kind:'account', id: gid } : { kind:'category', id: gid };
          window.SGF?.reports?.drill?.openFromQuery?.({
            subtitle,
            rangeLabel: `${p1} → ${p2}`,
            currency: code,
            scope,
            type: typeEl.value,
            range,
          });
        });
      });
    }

    const deb = E?.debounce ? E.debounce(compute, 120) : compute;
    [groupEl,typeEl,yearEl,monthEl,curEl,accEl].forEach(el => el && el.addEventListener('change', deb));

    compute();
  }

  window.SGF.modules.reportes_tendencias_12m = { onMount };
})();
