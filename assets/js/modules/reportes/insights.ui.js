// v1.26.0 - Reportes: Insights
window.SGF = window.SGF || {};
window.SGF.modules = window.SGF.modules || {};

(function(){
  const E = window.SGF?.reports?.engine;
  const D = window.SGF?.reports?.data;
  const STORE_KEY = 'reportes_insights';

  const MONTHS = [
    { value: 'all', label: '(Todos)' },
    { value: '01', label: 'enero' }, { value: '02', label: 'febrero' }, { value: '03', label: 'marzo' },
    { value: '04', label: 'abril' }, { value: '05', label: 'mayo' }, { value: '06', label: 'junio' },
    { value: '07', label: 'julio' }, { value: '08', label: 'agosto' }, { value: '09', label: 'setiembre' },
    { value: '10', label: 'octubre' }, { value: '11', label: 'noviembre' }, { value: '12', label: 'diciembre' },
  ];

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
    const out = [{ value:'all', label:'(Todos)' }];
    for (const r of rows) if (r.y) out.push({ value:String(r.y), label:String(r.y) });
    return out;
  }

  function onMount(){
    window.SGF?.pdf?.bind?.();
    if (!window.SGF?.db) return;
    const yearEl=$('ins-year');
    const monthEl=$('ins-month');
    const curEl=$('ins-currency');
    const accEl=$('ins-account');
    const typeEl=$('ins-type');
    const tbCat=$('ins-cat');
    const tbMer=$('ins-mer');

    const saved = E?.loadFilters ? E.loadFilters(STORE_KEY) : null;

    fillSelect(yearEl, loadYears(), saved?.year || 'all');
    fillSelect(monthEl, MONTHS, saved?.month || 'all');
    fillSelect(curEl, loadCurrencies(), saved?.currency || 'all');
    fillSelect(accEl, loadAccounts(), saved?.accountId ?? 0);
    if (saved?.type) typeEl.value = saved.type;

    function saveState(){
      E?.saveFilters && E.saveFilters(STORE_KEY, {
        year: yearEl.value,
        month: monthEl.value,
        currency: curEl.value,
        accountId: accEl.value,
        type: typeEl.value,
      });
    }

    function render(){
      saveState();
      const code = (curEl.value==='all'?'CRC':curEl.value);
      const fmt = (v)=> E?.fmtMoney ? E.fmtMoney(v, code) : String(v);
      const mc = (v)=> E?.moneyClass ? E.moneyClass(v) : '';

      const cats = D?.queryTopCategories ? D.queryTopCategories({
        db: window.SGF.db, year: yearEl.value, month: monthEl.value, currency: curEl.value, accountId: Number(accEl.value||0), type: typeEl.value, limit: 15
      }) : [];

      const mers = D?.queryTopMerchants ? D.queryTopMerchants({
        db: window.SGF.db, year: yearEl.value, month: monthEl.value, currency: curEl.value, accountId: Number(accEl.value||0), type: typeEl.value, limit: 15
      }) : [];

      tbCat.innerHTML = cats.map(r => `
        <tr class="border-b last:border-b-0 hover:bg-slate-50 cursor-pointer" data-kind="cat" data-id="${String(r.id)}">
          <td class="py-2 px-3">${esc(r.name)}</td>
          <td class="py-2 px-3 text-right tabular-nums"><span class="${mc(r.total)}">${esc(fmt(r.total))}</span></td>
        </tr>
      `).join('') || `<tr><td class="py-4 px-3 text-slate-500" colspan="2">Sin datos.</td></tr>`;

      tbMer.innerHTML = mers.map(r => `
        <tr class="border-b last:border-b-0">
          <td class="py-2 px-3">${esc(r.name)}</td>
          <td class="py-2 px-3 text-right tabular-nums"><span class="${mc(r.total)}">${esc(fmt(r.total))}</span></td>
        </tr>
      `).join('') || `<tr><td class="py-4 px-3 text-slate-500" colspan="2">Sin datos.</td></tr>`;

      // drill category
      tbCat.querySelectorAll('tr[data-kind="cat"][data-id]').forEach(tr=>{
        tr.addEventListener('click', ()=>{
          const id = Number(tr.getAttribute('data-id')||0);
          const rangeLabel = (monthEl.value!=='all' && yearEl.value!=='all') ? `${yearEl.value}-${monthEl.value}` : (yearEl.value!=='all'? yearEl.value : '(Todos)');
          const range = {};
          if (monthEl.value!=='all' && yearEl.value!=='all'){ range.whereSql = 'm.period = :p'; range.params={':p': `${yearEl.value}-${monthEl.value}`}; }
          else if (yearEl.value!=='all'){ range.whereSql='SUBSTR(m.period,1,4)=:y'; range.params={':y': yearEl.value}; }
          else { range.whereSql=''; range.params={}; }
          window.SGF?.reports?.drill?.openFromQuery?.({
            subtitle: tr.querySelector('td')?.innerText?.trim() || 'Movimientos',
            rangeLabel,
            currency: code,
            scope: { kind:'category', id },
            type: typeEl.value,
            range,
          });
        });
      });
    }

    const deb = E?.debounce ? E.debounce(render, 120) : render;
    [yearEl, monthEl, curEl, accEl, typeEl].forEach(el => el && el.addEventListener('change', deb));
    render();
  }

  window.SGF.modules.reportes_insights = { onMount };
})();
