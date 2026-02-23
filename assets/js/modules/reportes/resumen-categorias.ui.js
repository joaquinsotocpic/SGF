// v1.29.1 - Reportes: Resumen por categorías (totales pie de tabla)
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

  const STORE_KEY = 'reportes_resumen_categorias';

  function $(id){ return document.getElementById(id); }
  function esc(s){ return (window.SGF?.reports?.escapeHtml ? window.SGF.reports.escapeHtml(String(s ?? '')) : String(s ?? '')); }

  function fillSelect(el, items, value){
    if (!el) return;
    el.innerHTML = (items||[]).map(i => `<option value="${String(i.value)}">${String(i.label)}</option>`).join('');
    if (E?.setSelectValueIfExists) E.setSelectValueIfExists(el, value);
    else el.value = value;
  }

  function hasColumn(table, col){
    try{
      const rows = window.SGF.db.select(`PRAGMA table_info(${table})`);
      return (rows||[]).some(r => String(r.name||'').toLowerCase() === String(col).toLowerCase());
    }catch(_){
      return false;
    }
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
    const out = [{ value:'all', label:'(Todas)' }];
    for (const r of rows) out.push({ value:String(r.id), label:r.name });
    return out;
  }

  function loadYears(currency, accountId){
    const where = ["COALESCE(is_opening,0)=0"];
    const p = {};
    if (currency && currency !== 'all'){ where.push("COALESCE(currency,'CRC') = :c"); p[':c']=currency; }
    if (accountId && accountId !== 'all'){ where.push("account_id = :a"); p[':a']=Number(accountId); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = window.SGF.db.select(`SELECT DISTINCT SUBSTR(period,1,4) AS y FROM movements ${w} ORDER BY y DESC`, p);
    const out = [{ value:'all', label:'(Todos)' }];
    for (const r of rows) if (r.y) out.push({ value:String(r.y), label:String(r.y) });
    return out;
  }

  function loadCategories(){
    const where = hasColumn('categories','is_deleted') ? 'WHERE COALESCE(is_deleted,0)=0' : '';
    const rows = window.SGF.db.select(`
      SELECT id, name, parent_id AS parentId
      FROM categories
      ${where}
      ORDER BY name
    `);

    const map = new Map();
    for (const r of rows){
      map.set(Number(r.id), { id:Number(r.id), name:r.name, parentId: r.parentId==null?null:Number(r.parentId), children:[], total:0 });
    }
    // build children
    const roots = [];
    for (const n of map.values()){
      if (n.parentId && map.has(n.parentId)) map.get(n.parentId).children.push(n);
      else roots.push(n);
    }
    return { map, roots };
  }

  function rollup(node){
    let sum = Number(node.total||0);
    for (const ch of (node.children||[])) sum += rollup(ch);
    node.total = sum;
    return sum;
  }

  function sortTree(node, order){
    const dir = (order === 'asc') ? 1 : -1;
    (node.children||[]).sort((a,b)=> (Math.abs(Number(a.total||0)) - Math.abs(Number(b.total||0))) * dir);
    for (const ch of (node.children||[])) sortTree(ch, order);
  }

  function buildRange(year, month){
    let label='(Todos)';
    let whereSql='';
    const params={};
    if (month && month !== 'all' && year && year !== 'all'){
      label = `${year}-${month}`;
      whereSql = "period = :p";
      params[':p'] = label;
    } else if (year && year !== 'all'){
      label = year;
      whereSql = "SUBSTR(period,1,4)=:y";
      params[':y'] = String(year);
    }
    return { label, whereSql, params };
  }

  function render({ roots, expanded, denom, currency, order, totalRaw }){
    const tbody = $('rcat-tbody');
    if (!tbody) return;

    const fmt = (v)=> E?.fmtMoney ? E.fmtMoney(v, currency==='all'?'CRC':currency) : String(v);
    const cls = (v)=> E?.moneyClass ? E.moneyClass(v) : '';

    const rowsHtml=[];
    function row(node, level){
      const hasKids = (node.children||[]).length>0;
      const isOpen = expanded.has(node.id);
      const pad = 8 + level*14;

      const pct = denom>0 ? (Math.abs(Number(node.total||0))/denom*100) : 0;
      const caret = hasKids ? `
        <button type="button" class="rcat-toggle inline-flex items-center justify-center w-6 h-6 rounded-lg hover:bg-slate-100" data-id="${node.id}">
          <i data-lucide="${isOpen?'chevron-down':'chevron-right'}" class="w-4 h-4"></i>
        </button>` : `<span class="inline-block w-6"></span>`;

      rowsHtml.push(`
        <tr class="border-b last:border-b-0 hover:bg-slate-50 rcat-row cursor-pointer" data-id="${node.id}" data-has-children="${hasKids?1:0}">
          <td class="py-2 px-2">
            <div class="flex items-center gap-2" style="padding-left:${pad}px">
              ${caret}
              <span class="font-medium">${esc(node.name)}</span>
            </div>
          </td>
          <td class="py-2 px-2 text-right tabular-nums">
            <span class="${cls(node.total)}">${esc(fmt(node.total))}</span>
          </td>
          <td class="py-2 px-2 text-right tabular-nums text-slate-500 whitespace-nowrap">${pct.toFixed(2)}%</td>
        </tr>
      `);

      if (hasKids && isOpen){
        for (const ch of node.children) row(ch, level+1);
      }
    }

    for (const r of roots) row(r, 0);


    // Total (sin duplicar padres): usar totalRaw
    const totalRow = `
      <tr class="bg-slate-50">
        <td class="py-2 px-2 font-semibold text-slate-800">Total</td>
        <td class="py-2 px-2 text-right tabular-nums font-semibold ${cls(totalRaw)}">${esc(fmt(totalRaw))}</td>
        <td class="py-2 px-2 text-right tabular-nums text-slate-500">100.00%</td>
      </tr>
    `;



    tbody.innerHTML = (rowsHtml.length ? (rowsHtml.join('') + totalRow) : '') || `
      <tr><td class="py-4 px-3 text-slate-500" colspan="3">Sin datos.</td></tr>
    `;

    try { window.lucide?.createIcons?.(); } catch(_){}
  }

  function onMount(){
    if (!window.SGF?.db) return;

    const yearEl=$('rcat-year');
    const monthEl=$('rcat-month');
    const curEl=$('rcat-currency');
    const accEl=$('rcat-account');
    const ordEl=$('rcat-order');
    const typEl=$('rcat-type');
    const labelEl=$('rcat-range-label');

    const expandBtn=$('rcat-expand-btn');
    const collapseBtn=$('rcat-collapse-btn');

    const saved = E?.loadFilters ? E.loadFilters(STORE_KEY) : null;

    // init selects
    fillSelect(curEl, loadCurrencies(), saved?.currency || 'all');
    fillSelect(accEl, loadAccounts(), saved?.accountId ?? 'all');
    fillSelect(yearEl, loadYears(curEl.value, accEl.value), saved?.year || 'all');
    fillSelect(monthEl, MONTHS, saved?.month || 'all');
    fillSelect(ordEl, [
      { value:'desc', label:'Monto (mayor → menor)' },
      { value:'asc', label:'Monto (menor → mayor)' },
    ], saved?.order || 'desc');
    fillSelect(typEl, [
      { value:'expense', label:'Gastos' },
      { value:'income', label:'Ingresos' },
      { value:'both', label:'Ambos (Ingresos + Gastos)' },
    ], saved?.type || 'expense');

    // state
    const state = {
      expanded: (Array.isArray(saved?.expanded) ? (E?.deserializeSet ? E.deserializeSet(saved.expanded, v=>Number(v)) : new Set(saved.expanded.map(Number))) : new Set()),
    };

    function saveState(){
      E?.saveFilters && E.saveFilters(STORE_KEY, {
        year: yearEl.value,
        month: monthEl.value,
        currency: curEl.value,
        accountId: accEl.value,
        order: ordEl.value,
        type: typEl.value,
        expanded: E?.serializeSet ? E.serializeSet(state.expanded) : Array.from(state.expanded),
      });
    }

    function refreshCombos(preserve){
      // years depend on currency+account
      const years = loadYears(curEl.value, accEl.value);
      fillSelect(yearEl, years, preserve ? yearEl.value : (saved?.year || 'all'));
      fillSelect(monthEl, MONTHS, preserve ? monthEl.value : (saved?.month || 'all'));
    }

    function compute(){
      saveState();

      // normalize: if month selected but year=all, use latest year available
      if (monthEl.value !== 'all' && yearEl.value === 'all'){
        const years = loadYears(curEl.value, accEl.value).map(x=>x.value).filter(v=>v!=='all');
        if (years.length) yearEl.value = years[0];
      }

      const range = buildRange(yearEl.value, monthEl.value);
      labelEl.textContent = range.label;

      const byId = D?.queryCategoryTotals ? D.queryCategoryTotals({
        db: window.SGF.db,
        year: yearEl.value,
        month: monthEl.value,
        currency: curEl.value,
        accountId: accEl.value === 'all' ? 0 : Number(accEl.value),
        type: typEl.value,
      }) : new Map();

      const { map, roots } = loadCategories();

      // assign base totals
      for (const n of map.values()) n.total = 0;
      for (const [cid, amt] of byId.entries()){
        if (cid === 0) continue;
        if (map.has(cid)) map.get(cid).total += Number(amt||0);
      }
      // rollup
      for (const r of roots) rollup(r);

      const unc = { id:0, name:'Sin categoría', parentId:null, children:[], total:Number(byId.get(0)||0) };
      const treeRoots = [unc, ...roots].filter(n => Math.abs(Number(n.total||0))>0 || (n.children && n.children.length));

      // sort
      for (const r of treeRoots) sortTree(r, ordEl.value);

      // denom as abs sum of raw (not rollup): unc + abs of each byId (cid!=0)
      let denom = Math.abs(Number(byId.get(0)||0));
      let totalRaw = Number(byId.get(0)||0);
      for (const [cid, amt] of byId.entries()) {
        if (cid !== 0) denom += Math.abs(Number(amt||0));
        if (cid !== 0) totalRaw += Number(amt||0);
      }

      // cleanup expanded invalid + calcular nodos expandibles
      const valid = new Set();
      const parents = new Set();
      const stack=[...treeRoots];
      while (stack.length){
        const n=stack.pop();
        valid.add(n.id);
        if (n.children && n.children.length) parents.add(n.id);
        for (const ch of (n.children||[])) stack.push(ch);
      }
      state.__parents = parents;
      for (const id of Array.from(state.expanded)) if (!valid.has(id)) state.expanded.delete(id);

      render({ roots: treeRoots, expanded: state.expanded, denom, totalRaw, currency: curEl.value, order: ordEl.value });
    }

    // wiring
    const deb = E?.debounce ? E.debounce(compute, 90) : compute;
    [yearEl, monthEl, curEl, accEl, ordEl, typEl].forEach(el => el && el.addEventListener('change', ()=>{
      if (el === curEl || el === accEl) refreshCombos(true);
      deb();
    }));

    // expand/collapse buttons
    expandBtn && expandBtn.addEventListener('click', ()=>{
      // expand all nodes with children
      const tbody = $('rcat-tbody');
      const parents = state.__parents ? Array.from(state.__parents) : [];
      for (const id of parents) state.expanded.add(id);
      saveState();
      compute();
    });
    collapseBtn && collapseBtn.addEventListener('click', ()=>{
      state.expanded.clear();
      saveState();
      compute();
    });

    // delegated toggle + drill
    const tbody = $('rcat-tbody');
    if (tbody){
      tbody.addEventListener('click', (e)=>{
        const btn = e.target.closest('.rcat-toggle');
        if (btn){
          e.preventDefault(); e.stopPropagation();
          const id = Number(btn.getAttribute('data-id'));
          if (state.expanded.has(id)) state.expanded.delete(id);
          else state.expanded.add(id);
          saveState();
          compute();
          return;
        }
        const row = e.target.closest('tr.rcat-row[data-id]');
        if (row){
          const cid = Number(row.getAttribute('data-id')||0);
          const hasKids = String(row.getAttribute('data-has-children')||'0') === '1';
          if (hasKids && cid !== 0) {
            // toggle expand
            if (state.expanded.has(cid)) state.expanded.delete(cid);
            else state.expanded.add(cid);
            saveState();
            compute();
            return;
          }
          const range = buildRange(yearEl.value, monthEl.value);
          window.SGF?.reports?.drill?.openFromQuery?.({
            subtitle: cid===0 ? 'Sin categoría' : (row.querySelector('span.font-medium')?.innerText || 'Categoría'),
            rangeLabel: range.label,
            currency: curEl.value==='all'?'CRC':curEl.value,
            scope: { kind:'category', id: cid },
            type: typEl.value,
            range: { whereSql: range.whereSql, params: range.params },
          });
        }
      });
    }

    compute();
  }

  window.SGF.modules.reportes_resumen_categorias = { onMount };
})();
