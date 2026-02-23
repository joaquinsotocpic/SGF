// v1.27.0 - Reportes: Comparativo Mes a Mes
window.SGF = window.SGF || {};
window.SGF.modules = window.SGF.modules || {};

(function(){
  const E = window.SGF?.reports?.engine;
  const D = window.SGF?.reports?.data;
  const STORE_KEY = 'reportes_comparativo_mes';

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
    if (!out.length){ const y=String(new Date().getFullYear()); out.push({value:y,label:y}); }
    return out;
  }
  function monthLabel(ym){
    const [y,m] = String(ym).split('-');
    return `${m}/${String(y).slice(2)}`;
  }

  function onMount(){
    if (!window.SGF?.db) return;
    const yearEl=$('mom-year');
    const monthEl=$('mom-month');
    const curEl=$('mom-currency');
    const accEl=$('mom-account');
    const tbody=$('mom-tbody');
    const rangeEl=$('mom-range');

    const saved = E?.loadFilters ? E.loadFilters(STORE_KEY) : null;

    fillSelect(curEl, loadCurrencies(), saved?.currency || 'all');
    fillSelect(accEl, loadAccounts(), saved?.accountId ?? 0);
    const years=loadYears();
    fillSelect(yearEl, years, saved?.year || years[0].value);
    const now=new Date();
    monthEl.value = saved?.month || String(now.getMonth()+1).padStart(2,'0');

    function saveState(){
      E?.saveFilters && E.saveFilters(STORE_KEY, {
        year: yearEl.value, month: monthEl.value,
        currency: curEl.value, accountId: accEl.value,
      });
    }

    function render(){
      saveState();
      const endPeriod = `${yearEl.value}-${monthEl.value}`;
      const res = D?.queryMoMSummary ? D.queryMoMSummary({
        db: window.SGF.db, endPeriod, months: 12,
        currency: curEl.value, accountId: Number(accEl.value||0),
      }) : { periods:[], rows:[] };

      const code = (curEl.value==='all'?'CRC':curEl.value);
      const fmt = (v)=> E?.fmtMoney ? E.fmtMoney(v, code) : String(v);
      const mc = (v)=> E?.moneyClass ? E.moneyClass(v) : '';

      const p1=res.periods?.[0]||''; const p2=res.periods?.[res.periods.length-1]||'';
      rangeEl.textContent = p1 && p2 ? `${p1} → ${p2}` : '—';

      tbody.innerHTML = (res.rows||[]).map(r=>{
        return `
          <tr class="border-b last:border-b-0 hover:bg-slate-50 cursor-pointer mom-row" data-p="${esc(r.period)}">
            <td class="py-2 px-3 font-medium">${esc(monthLabel(r.period))}</td>
            <td class="py-2 px-3 text-right tabular-nums"><span class="${mc(r.income)}">${esc(fmt(r.income))}</span></td>
            <td class="py-2 px-3 text-right tabular-nums"><span class="${mc(-r.expense)}">${esc(fmt(-r.expense))}</span></td>
            <td class="py-2 px-3 text-right tabular-nums font-semibold"><span class="${mc(r.net)}">${esc(fmt(r.net))}</span></td>
          </tr>
        `;
      }).join('') || `<tr><td class="py-4 px-3 text-slate-500" colspan="4">Sin datos.</td></tr>`;

      // drill: click month -> open drill for both income+expense
      tbody.querySelectorAll('tr.mom-row[data-p]').forEach(tr=>{
        tr.addEventListener('click', ()=>{
          const p = tr.getAttribute('data-p');
          window.SGF?.reports?.drill?.openFromQuery?.({
            subtitle: `Movimientos ${p}`,
            rangeLabel: p,
            currency: code,
            scope: { kind:'account', id: Number(accEl.value||0) },
            type: 'both',
            range: { whereSql: 'm.period = :p', params: { ':p': p } },
          });
        });
      });
    }

    const deb = E?.debounce ? E.debounce(render, 120) : render;
    [yearEl, monthEl, curEl, accEl].forEach(el => el && el.addEventListener('change', deb));
    render();
  }

  window.SGF.modules.reportes_comparativo_mes = { onMount };
})();
