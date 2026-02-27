// v1.29.1 - Reportes: Presupuesto vs Real (totales pie de tabla)
window.SGF = window.SGF || {};
window.SGF.modules = window.SGF.modules || {};

(function(){
  const E = window.SGF?.reports?.engine;
  const D = window.SGF?.reports?.data;

  const STORE_KEY = 'reportes_presupuesto_vs_real';

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

  function hasColumn(table, col){
    try{
      const rows = window.SGF.db.select(`PRAGMA table_info(${table})`);
      return (rows||[]).some(r => String(r.name||'').toLowerCase() === String(col).toLowerCase());
    }catch(_){ return false; }
  }

  function fillSelect(el, items, value){
    if (!el) return;
    el.innerHTML = (items||[]).map(i => `<option value="${String(i.value)}">${String(i.label)}</option>`).join('');
    if (E?.setSelectValueIfExists) E.setSelectValueIfExists(el, value);
    else el.value = value;
  }

  function loadCurrencies(){
    // prefer budgets currencies; fallback movements
    let rows = [];
    try { rows = window.SGF.db.select(`SELECT DISTINCT COALESCE(currency,'CRC') AS c FROM budgets ORDER BY c`); } catch(_){}
    if (!rows.length) rows = window.SGF.db.select(`SELECT DISTINCT COALESCE(currency,'CRC') AS c FROM movements ORDER BY c`);
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
    // years from movements (real) and budgets (plan)
    const years = new Set();
    try{
      const p = {};
      const where = [];
      if (currency && currency !== 'all'){ where.push("COALESCE(currency,'CRC')=:c"); p[':c']=currency; }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const br = window.SGF.db.select(`SELECT DISTINCT SUBSTR(period,1,4) AS y FROM budgets ${w} ORDER BY y DESC`, p) || [];
      for (const r of br) if (r.y) years.add(String(r.y));
    }catch(_){}
    try{
      const p = {};
      const where = ["COALESCE(is_opening,0)=0"];
      if (currency && currency !== 'all'){ where.push("COALESCE(currency,'CRC')=:c"); p[':c']=currency; }
      if (accountId && Number(accountId)>0){ where.push("account_id=:a"); p[':a']=Number(accountId); }
      const w = `WHERE ${where.join(' AND ')}`;
      const mr = window.SGF.db.select(`SELECT DISTINCT SUBSTR(period,1,4) AS y FROM movements ${w} ORDER BY y DESC`, p) || [];
      for (const r of mr) if (r.y) years.add(String(r.y));
    }catch(_){}
    const sorted = Array.from(years).sort((a,b)=> b.localeCompare(a));
    const out = [{ value:'all', label:'(Todos)' }];
    for (const y of sorted) out.push({ value:y, label:y });
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
      map.set(Number(r.id), { id:Number(r.id), name:r.name, parentId:r.parentId==null?null:Number(r.parentId), children:[], budget:0, actual:0 });
    }
    const roots=[];
    for (const n of map.values()){
      if (n.parentId && map.has(n.parentId)) map.get(n.parentId).children.push(n);
      else roots.push(n);
    }
    return { map, roots };
  }

  function rollup(node){
    let b = Number(node.budget||0);
    let a = Number(node.actual||0);
    for (const ch of (node.children||[])){
      rollup(ch);
      b += Number(ch.budget||0);
      a += Number(ch.actual||0);
    }
    node.budget = b;
    node.actual = a;
  }

  function sortTree(node, mode){
    const dirDesc = (x,y)=> (y - x);
    const dirAsc = (x,y)=> (x - y);
    const get = (n)=>{
      const b = Number(n.budget||0);
      const a = Number(n.actual||0);
      const v = b - a;
      const pct = b>0 ? (a/b*100) : 0;
      if (mode === 'real_desc') return { key: Math.abs(a), cmp: dirDesc };
      if (mode === 'var_asc') return { key: v, cmp: dirAsc };
      return { key: pct, cmp: dirDesc }; // pct_desc
    };
    const infoA = get(node);
    const cmp = infoA.cmp;
    (node.children||[]).sort((n1,n2)=>{
      const i1=get(n1), i2=get(n2);
      // use mode key
      return cmp(i1.key, i2.key);
    });
    for (const ch of (node.children||[])) sortTree(ch, mode);
  }

  function buildRange(year, month){
    let label='(Todos)';
    let whereSql=''; const params={};
    if (year !== 'all' && month !== 'all'){
      label = `${year}-${month}`;
      whereSql = "period = :p";
      params[':p'] = label;
    } else if (year !== 'all'){
      label = year;
      whereSql = "SUBSTR(period,1,4)=:y";
      params[':y'] = String(year);
    }
    return { label, whereSql, params };
  }

  function onMount(root){
    window.SGF?.pdf?.bind?.(root || document);
    if (!window.SGF?.db) return;


    const yearEl=$('bvr-year');
    const monthEl=$('bvr-month');
    const curEl=$('bvr-currency');
    const accEl=$('bvr-account');
    const ordEl=$('bvr-order');
    const labelEl=$('bvr-range-label');
    const tbody=$('bvr-tbody');

    const expandBtn=$('bvr-expand-btn');
    const collapseBtn=$('bvr-collapse-btn');

    const saved = E?.loadFilters ? E.loadFilters(STORE_KEY) : null;

    fillSelect(curEl, loadCurrencies(), saved?.currency || 'all');
    fillSelect(accEl, loadAccounts(), saved?.accountId ?? 0);
    fillSelect(yearEl, loadYears(curEl.value, accEl.value), saved?.year || 'all');
    fillSelect(monthEl, MONTHS, saved?.month || 'all');
    if (saved?.order) ordEl.value = saved.order;

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
        expanded: E?.serializeSet ? E.serializeSet(state.expanded) : Array.from(state.expanded),
      });
    }

    function render(treeRoots, currency, rangeLabel, totals){
      const code = (currency === 'all') ? 'CRC' : currency;
      const fmt = (v)=> E?.fmtMoney ? E.fmtMoney(v, code) : String(v);
      const mc = (v)=> E?.moneyClass ? E.moneyClass(v) : '';

      // denom for percentage: total budget (abs)
      let denomBudget = 0;
      for (const r of treeRoots) denomBudget += Math.abs(Number(r.budget||0));

      const rows=[];
      function row(node, level){
        const hasKids = (node.children||[]).length>0;
        const open = state.expanded.has(node.id);
        const pad = 8 + level*14;

        const b = Number(node.budget||0);
        const a = Number(node.actual||0);
        const diff = b - a;
        const pct = b>0 ? (a/b*100) : 0;
        const pctTxt = (b>0) ? `${pct.toFixed(2)}%` : '—';
        const pctCls = (b>0 && pct>100) ? 'text-rose-700' : 'text-slate-500';

        const caret = hasKids ? `
          <button type="button" class="bvr-toggle inline-flex items-center justify-center w-6 h-6 rounded-lg hover:bg-slate-100" data-id="${node.id}">
            <i data-lucide="${open?'chevron-down':'chevron-right'}" class="w-4 h-4"></i>
          </button>` : `<span class="inline-block w-6"></span>`;

        rows.push(`
          <tr class="border-b last:border-b-0 hover:bg-slate-50 bvr-row cursor-pointer" data-id="${node.id}" data-has-children="${hasKids?1:0}">
            <td class="py-2 px-2">
              <div class="flex items-center gap-2" style="padding-left:${pad}px">
                ${caret}
                <span class="font-medium">${esc(node.name)}</span>
              </div>
            </td>
            <td class="py-2 px-2 text-right tabular-nums"><span class="text-slate-900">${esc(fmt(b))}</span></td>
            <td class="py-2 px-2 text-right tabular-nums"><span class="${mc(-a)}">${esc(fmt(-a))}</span></td>
            <td class="py-2 px-2 text-right tabular-nums"><span class="${mc(diff)}">${esc(fmt(diff))}</span></td>
            <td class="py-2 px-2 text-right tabular-nums ${pctCls}">${pctTxt}</td>
          </tr>
        `);

        if (hasKids && open){
          for (const ch of node.children) row(ch, level+1);
        }
      }
      for (const r of treeRoots) row(r,0);


      const tb = Number(totals?.budget||0);
      const ta = Number(totals?.actual||0);
      const td = tb - ta;
      const tpct = tb>0 ? (ta/tb*100) : 0;
      const footerRow = `
        <tr class="bg-slate-50">
          <td class="py-2 px-2 font-semibold text-slate-800">Total</td>
          <td class="py-2 px-2 text-right tabular-nums font-semibold text-slate-900">${esc(fmt(tb))}</td>
          <td class="py-2 px-2 text-right tabular-nums font-semibold ${mc(-ta)}">${esc(fmt(-ta))}</td>
          <td class="py-2 px-2 text-right tabular-nums font-semibold ${mc(td)}">${esc(fmt(td))}</td>
          <td class="py-2 px-2 text-right tabular-nums text-slate-500">${tb>0 ? tpct.toFixed(2)+'%' : '—'}</td>
        </tr>
      `;

      tbody.innerHTML = (rows.length ? (rows.join('') + footerRow) : '') || `<tr><td class="py-4 px-3 text-slate-500" colspan="5">Sin datos.</td></tr>`;
      labelEl.textContent = rangeLabel;
      try { window.lucide?.createIcons?.(); } catch(_){}
    }

    function compute(){
      saveState();

      // normalize year if month selected and year=all
      if (monthEl.value !== 'all' && yearEl.value === 'all'){
        const years = loadYears(curEl.value, accEl.value).map(x=>x.value).filter(v=>v!=='all');
        if (years.length) yearEl.value = years[0];
      }

      const range = buildRange(yearEl.value, monthEl.value);
      const byId = D?.queryBudgetVsActual ? D.queryBudgetVsActual({
        db: window.SGF.db,
        year: yearEl.value,
        month: monthEl.value,
        currency: curEl.value,
        accountId: Number(accEl.value||0),
      }) : new Map();

      // Totales globales (sin duplicar padres)
      let totalBudget = 0, totalActual = 0;
      for (const v of byId.values()) { totalBudget += Number(v.budget||0); totalActual += Number(v.actual||0); }

      const { map, roots } = loadCategories();
      for (const n of map.values()){ n.budget=0; n.actual=0; }

      for (const [cid, obj] of byId.entries()){
        const id = Number(cid||0);
        if (id===0) continue;
        if (map.has(id)){
          map.get(id).budget += Number(obj.budget||0);
          map.get(id).actual += Number(obj.actual||0);
        }
      }

      for (const r of roots) rollup(r);

      // optional "Sin categoría" (only actual, budgets usually)
      const uncObj = byId.get(0);
      const unc = { id:0, name:'Sin categoría', parentId:null, children:[], budget:Number(uncObj?.budget||0), actual:Number(uncObj?.actual||0) };

      const treeRoots = [unc, ...roots].filter(n => Math.abs(Number(n.budget||0))>0 || Math.abs(Number(n.actual||0))>0 || (n.children && n.children.length));

      // sort
      for (const r of treeRoots) sortTree(r, ordEl.value);

      // cleanup expanded + calcular nodos expandibles
      const valid=new Set();
      const parents=new Set();
      const st=[...treeRoots];
      while (st.length){
        const n=st.pop(); valid.add(n.id);
        if (n.children && n.children.length) parents.add(n.id);
        for (const ch of (n.children||[])) st.push(ch);
      }
      state.__parents = parents;
      for (const id of Array.from(state.expanded)) if (!valid.has(id)) state.expanded.delete(id);

      render(treeRoots, curEl.value, range.label, { budget: totalBudget, actual: totalActual });
    }

    const deb = E?.debounce ? E.debounce(compute, 100) : compute;

    [yearEl, monthEl, curEl, accEl, ordEl].forEach(el => el && el.addEventListener('change', ()=>{
      if (el === curEl || el === accEl){
        fillSelect(yearEl, loadYears(curEl.value, accEl.value), yearEl.value);
      }
      deb();
    }));

    expandBtn && expandBtn.addEventListener('click', ()=>{
      // expand all nodes that have children: easiest via DOM toggles
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

    if (tbody){
      tbody.addEventListener('click', (e)=>{
        const btn = e.target.closest('.bvr-toggle');
        if (btn){
          e.preventDefault(); e.stopPropagation();
          const id=Number(btn.getAttribute('data-id'));
          if (state.expanded.has(id)) state.expanded.delete(id);
          else state.expanded.add(id);
          saveState();
          compute();
          return;
        }
        const row = e.target.closest('tr.bvr-row[data-id]');
        if (row){
          const cid=Number(row.getAttribute('data-id')||0);
          const hasKids = String(row.getAttribute('data-has-children')||'0') === '1';
          if (hasKids && cid !== 0) {
            if (state.expanded.has(cid)) state.expanded.delete(cid);
            else state.expanded.add(cid);
            saveState();
            compute();
            return;
          }
          const range = buildRange(yearEl.value, monthEl.value);
          window.SGF?.reports?.drill?.openFromQuery?.({
            subtitle: row.querySelector('span.font-medium')?.innerText || 'Movimientos',
            rangeLabel: range.label,
            currency: (curEl.value==='all'?'CRC':curEl.value),
            scope: { kind:'category', id: cid },
            type: 'expense',
            range: { whereSql: range.whereSql, params: range.params },
          });
        }
      });
    }

    compute();
  }

  window.SGF.modules.reportes_presupuesto_vs_real = { onMount };
})();
