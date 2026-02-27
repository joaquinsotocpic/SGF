// v1.28.1 - Reportes: Balance por Cuenta / Saldo por Mes (default al último periodo con datos)
window.SGF = window.SGF || {};
window.SGF.modules = window.SGF.modules || {};

(function(){
  const E = window.SGF?.reports?.engine;
  const D = window.SGF?.reports?.data;
  const STORE_KEY = 'reportes_balance_cuentas';

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
    const rows = window.SGF.db.select(`SELECT DISTINCT COALESCE(currency,'CRC') AS c FROM accounts WHERE active=1 ORDER BY c`);
    const out = [{ value:'all', label:'(Todas)' }];
    for (const r of rows) if (r.c) out.push({ value:String(r.c), label:String(r.c) });
    return out;
  }
  function loadAccounts(currency){
    const p = {};
    const w = (currency && currency !== 'all') ? "WHERE active=1 AND currency=:c" : "WHERE active=1";
    if (currency && currency !== 'all') p[':c']=currency;
    const rows = window.SGF.db.select(`SELECT id, name FROM accounts ${w} ORDER BY name`, p);
    const out = [{ value:0, label:'(Todas)' }];
    for (const r of rows) out.push({ value:String(r.id), label:String(r.name||'Cuenta') });
    return out;
  }
  function loadYears(){
    const rows = window.SGF.db.select(`SELECT DISTINCT SUBSTR(period,1,4) AS y FROM movements ORDER BY y DESC`);
    const out = [];
    for (const r of rows) if (r.y) out.push({ value:String(r.y), label:String(r.y) });
    if (!out.length){ const y=String(new Date().getFullYear()); out.push({value:y,label:y}); }
    return out;
  }

  function getLastPeriod(){
    try{
      const r = window.SGF.db.select(`SELECT MAX(period) AS p FROM movements`);
      const p = String((r && r[0] && (r[0].p || r[0].P)) || '').trim();
      return p && p.length>=7 ? p.slice(0,7) : '';
    } catch(_){ return ''; }
  }

  function periodLabel(year, month){ return `${year}-${String(month).padStart(2,'0')}`; }

  function onMount(){
    window.SGF?.pdf?.bind?.();
    if (!window.SGF?.db) return;

    const viewEl=$('bal-view');
    const yearEl=$('bal-year');
    const monthEl=$('bal-month');
    const curEl=$('bal-currency');
    const accEl=$('bal-account');
    const rangeEl=$('bal-range');
    const tbody=$('bal-tbody');

    const saved = E?.loadFilters ? E.loadFilters(STORE_KEY) : null;

    const years = loadYears();
    fillSelect(yearEl, years, saved?.year || years[0].value);

    const lastP = getLastPeriod();
    if (lastP && !(saved?.year) && !(saved?.month)) {
      const parts = lastP.split('-');
      yearEl.value = parts[0];
      monthEl.value = parts[1];
    } else {
      const now = new Date();
      monthEl.value = saved?.month || String(now.getMonth()+1).padStart(2,'0');
    }

    fillSelect(curEl, loadCurrencies(), saved?.currency || 'all');
    fillSelect(accEl, loadAccounts(curEl.value), saved?.accountId ?? 0);

    if (saved?.view) viewEl.value = saved.view;

    function saveState(){
      E?.saveFilters && E.saveFilters(STORE_KEY, {
        view: viewEl.value,
        year: yearEl.value,
        month: monthEl.value,
        currency: curEl.value,
        accountId: accEl.value,
      });
    }

    function renderRows(rows, currency, label, viewMode){
      const code = (currency==='all') ? 'CRC' : currency;
      const fmt = (v)=> E?.fmtMoney ? E.fmtMoney(v, code) : String(v);
      const mc = (v)=> E?.moneyClass ? E.moneyClass(v) : '';
      rangeEl.textContent = label;

      tbody.innerHTML = (rows||[]).map(r=>{
        const name = (viewMode==='by_month') ? r.period : r.name;
        const init = Number(r.init||0);
        const inc = Number(r.income||0);
        const exp = -Number(r.expense||0);
        const trn = Number(r.transfer_net||0);
        const svn = Number(r.savings_net||0);
        const end = Number(r.end||0);

        return `
          <tr class="border-b last:border-b-0 hover:bg-slate-50 cursor-pointer bal-row" data-period="${esc(r.period||'')}" data-account="${String(r.accountId||0)}">
            <td class="py-2 px-3 font-medium">${esc(name || '—')}</td>
            <td class="py-2 px-3 text-right tabular-nums"><span class="${mc(init)}">${esc(fmt(init))}</span></td>
            <td class="py-2 px-3 text-right tabular-nums"><span class="${mc(inc)}">${esc(fmt(inc))}</span></td>
            <td class="py-2 px-3 text-right tabular-nums"><span class="${mc(exp)}">${esc(fmt(exp))}</span></td>
            <td class="py-2 px-3 text-right tabular-nums"><span class="${mc(trn)}">${esc(fmt(trn))}</span></td>
            <td class="py-2 px-3 text-right tabular-nums"><span class="${mc(svn)}">${esc(fmt(svn))}</span></td>
            <td class="py-2 px-3 text-right tabular-nums font-semibold"><span class="${mc(end)}">${esc(fmt(end))}</span></td>
          </tr>
        `;
      }).join('') || `<tr><td class="py-4 px-3 text-slate-500" colspan="7">Sin datos.</td></tr>`;

      // drilldown: click row => drill movements for that period and account
      tbody.querySelectorAll('tr.bal-row').forEach(tr=>{
        tr.addEventListener('click', ()=>{
          const period = tr.getAttribute('data-period');
          const aid = Number(tr.getAttribute('data-account')||0);
          const subtitle = tr.querySelector('td')?.innerText?.trim() || 'Movimientos';
          window.SGF?.reports?.drill?.openFromQuery?.({
            subtitle,
            rangeLabel: period || label,
            currency: code,
            scope: { kind:'account', id: aid || Number(accEl.value||0) },
            type: 'both',
            range: period ? { whereSql: 'm.period = :p', params: { ':p': period } } : {},
          });
        });
      });
    }

    function compute(){
      saveState();

      const period = periodLabel(yearEl.value, monthEl.value);
      const viewMode = viewEl.value;

      // enforce account selection for by_month
      if (viewMode === 'by_month' && Number(accEl.value||0) === 0){
        // auto pick first real account if exists
        const opts = Array.from(accEl.options || []).map(o=>o.value).filter(v=>Number(v)>0);
        if (opts.length) accEl.value = opts[0];
      }

      if (viewMode === 'by_month'){
        const res = D?.querySaldoPorMes ? D.querySaldoPorMes({
          db: window.SGF.db,
          endPeriod: period,
          months: 12,
          currency: curEl.value,
          accountId: Number(accEl.value||0),
        }) : { periods:[], rows:[] };

        // attach period into each row
        const rows = (res.rows||[]).map(r=>({ ...r, period: r.period }));
        renderRows(rows, curEl.value, `${res.periods?.[0]||''} → ${res.periods?.[res.periods.length-1]||''}`, 'by_month');
        return;
      }

      // by_account
      const rows = D?.queryBalanceByAccount ? D.queryBalanceByAccount({
        db: window.SGF.db,
        period,
        currency: curEl.value,
        accountId: Number(accEl.value||0),
      }).map(r=>({ ...r, period })) : [];

      renderRows(rows, curEl.value, period, 'by_account');
    }

    const deb = E?.debounce ? E.debounce(compute, 120) : compute;
    [viewEl, yearEl, monthEl, curEl, accEl].forEach(el => el && el.addEventListener('change', ()=>{
      if (el === curEl){
        fillSelect(accEl, loadAccounts(curEl.value), accEl.value);
      }
      deb();
    }));

    compute();
  }

  window.SGF.modules.reportes_balance_cuentas = { onMount };
})();
