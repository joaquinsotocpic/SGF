// v1.29.1 - Reportes: Flujo de Caja (pie de tabla)
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

  const STORE_KEY = 'reportes_flujo_caja';
  function $(id){ return document.getElementById(id); }

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
    const rows = window.SGF.db.select(`
      SELECT a.id, a.name
      FROM accounts a
      WHERE a.active=1
      ORDER BY a.name
    `);
    const out = [{ value:0, label:'(Todas)' }];
    for (const r of rows) out.push({ value:String(r.id), label:r.name });
    return out;
  }

  function loadYears(currency, accountId){
    const where = ["COALESCE(is_opening,0)=0"];
    const p = {};
    if (currency && currency !== 'all'){ where.push("COALESCE(currency,'CRC') = :c"); p[':c']=currency; }
    if (accountId && Number(accountId)>0){ where.push("(account_id = :a OR account_to_id = :a)"); p[':a']=Number(accountId); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = window.SGF.db.select(`SELECT DISTINCT SUBSTR(period,1,4) AS y FROM movements ${w} ORDER BY y DESC`, p);
    const out = [{ value:'all', label:'(Todos)' }];
    for (const r of rows) if (r.y) out.push({ value:String(r.y), label:String(r.y) });
    return out;
  }

  function getRange(year, month){
    let label='(Todos)';
    let whereSql=''; const params={};
    if (month && month !== 'all' && year && year !== 'all'){
      label = `${year}-${month}`;
      whereSql = "m.period = :p";
      params[':p'] = label;
    } else if (year && year !== 'all'){
      label = year;
      whereSql = "SUBSTR(m.period,1,4) = :y";
      params[':y'] = String(year);
    }
    return { label, whereSql, params };
  }

  function onMount(){
    window.SGF?.pdf?.bind?.();
    if (!window.SGF?.db) return;

    const yearEl=$('cf-year');
    const monthEl=$('cf-month');
    const curEl=$('cf-currency');
    const accEl=$('cf-account');
    const labelEl=$('cf-range-label');
    const tbody=$('cf-tbody');

    const saved = E?.loadFilters ? E.loadFilters(STORE_KEY) : null;

    fillSelect(curEl, loadCurrencies(), saved?.currency || 'all');
    fillSelect(accEl, loadAccounts(), saved?.accountId ?? 0);
    fillSelect(yearEl, loadYears(curEl.value, accEl.value), saved?.year || 'all');
    fillSelect(monthEl, MONTHS, saved?.month || 'all');

    function saveState(){
      E?.saveFilters && E.saveFilters(STORE_KEY, {
        year: yearEl.value,
        month: monthEl.value,
        currency: curEl.value,
        accountId: accEl.value,
      });
    }

    function render(res){
      if (!tbody) return;
      const code = (curEl.value==='all'?'CRC':curEl.value);
      const fmt = (v)=> E?.fmtMoney ? E.fmtMoney(v, code) : String(v);
      const cls = (v)=> E?.moneyClass ? E.moneyClass(v) : '';

      const tNet = Number(res.transferIn||0) - Number(res.transferOut||0);
      const sNet = Number(res.savingsIn||0) - Number(res.savingsOut||0);

      tbody.innerHTML = `
        <tr class="border-b hover:bg-slate-50 cursor-pointer" data-kind="pnl" data-type="income">
          <td class="py-2 px-3 font-medium">Ingresos</td>
          <td class="py-2 px-3 text-right tabular-nums ${cls(res.income)}">${fmt(res.income)}</td>
        </tr>
        <tr class="border-b hover:bg-slate-50 cursor-pointer" data-kind="pnl" data-type="expense">
          <td class="py-2 px-3 font-medium">Gastos</td>
          <td class="py-2 px-3 text-right tabular-nums ${cls(-res.expense)}">${fmt(-res.expense)}</td>
        </tr>
        <tr class="border-b hover:bg-slate-50 cursor-pointer" data-kind="cf" data-type="transfer">
          <td class="py-2 px-3 font-medium">Transferencias (neto)</td>
          <td class="py-2 px-3 text-right tabular-nums ${cls(tNet)}">${fmt(tNet)}</td>
        </tr>
        <tr class="border-b hover:bg-slate-50 cursor-pointer" data-kind="cf" data-type="savings">
          <td class="py-2 px-3 font-medium">Ahorros (neto)</td>
          <td class="py-2 px-3 text-right tabular-nums ${cls(sNet)}">${fmt(sNet)}</td>
        </tr>
        <tr class="hover:bg-slate-50 cursor-pointer" data-kind="cf" data-type="both">
          <td class="py-2 px-3 font-bold">Flujo Neto</td>
          <td class="py-2 px-3 text-right tabular-nums font-bold ${cls(res.net)}">${fmt(res.net)}</td>
        </tr>
        <tr class="bg-slate-50">
          <td class="py-2 px-3 font-semibold">Total</td>
          <td class="py-2 px-3 text-right tabular-nums font-semibold ${cls(res.net)}">${fmt(res.net)}</td>
        </tr>
      `;

      const range = getRange(yearEl.value, monthEl.value);

      // Drill-down (reusa listMovements; para transfer/savings abrimos ambos)
      tbody.querySelectorAll('tr[data-kind]').forEach(tr=>{
        tr.addEventListener('click', ()=>{
          const kind = tr.getAttribute('data-kind');
          const type = tr.getAttribute('data-type') || 'both';
          if (kind === 'pnl'){
            window.SGF?.reports?.drill?.openFromQuery?.({
              subtitle: tr.querySelector('td')?.innerText?.trim() || 'Movimientos',
              rangeLabel: range.label,
              currency: code,
              scope: { kind: 'pnl', accountId: Number(accEl.value||0) },
              type,
              range,
            });
          } else {
            // Transferencias/Ahorros: mostramos transfers (type both) filtrando por cuenta; drilldown genérico por cuenta (transfer se ve como +/-)
            window.SGF?.reports?.drill?.openFromQuery?.({
              subtitle: tr.querySelector('td')?.innerText?.trim() || 'Movimientos',
              rangeLabel: range.label,
              currency: code,
              scope: { kind: 'account', id: Number(accEl.value||0) },
              type: 'both',
              range,
            });
          }
        });
      });
    }

    function refresh(){
      saveState();
      // normalize year<->month
      const norm = E?.normalizeRange ? E.normalizeRange({ year: yearEl.value, month: (monthEl.value==='all'?'all':`${yearEl.value}-${monthEl.value}`) }) : { year: yearEl.value, month: monthEl.value };
      // monthEl uses MM only here; keep

      const range = getRange(yearEl.value, monthEl.value);
      labelEl.textContent = range.label;

      const res = D?.queryCashFlow ? D.queryCashFlow({
        db: window.SGF.db,
        year: yearEl.value,
        month: monthEl.value,
        currency: curEl.value,
        accountId: Number(accEl.value||0),
      }) : { income:0, expense:0, transferIn:0, transferOut:0, savingsIn:0, savingsOut:0, net:0 };

      render(res);
    }

    const deb = E?.debounce ? E.debounce(refresh, 90) : refresh;
    [yearEl, monthEl, curEl, accEl].forEach(el => el && el.addEventListener('change', ()=>{
      if (el === curEl || el === accEl){
        fillSelect(yearEl, loadYears(curEl.value, accEl.value), yearEl.value);
      }
      deb();
    }));

    refresh();
  }

  window.SGF.modules.reportes_flujo_caja = { onMount };
})();
