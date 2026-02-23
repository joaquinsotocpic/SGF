// v1.20.9 - Motor común de Reportes (fmt + persistencia + utilidades)
window.SGF = window.SGF || {};
window.SGF.reports = window.SGF.reports || {};
window.SGF.reports.engine = window.SGF.reports.engine || {};

(function(ns){
  function $(id){ return document.getElementById(id); }

  function debounce(fn, wait=120){
    let t=null;
    return function(...args){
      clearTimeout(t);
      t=setTimeout(()=>fn.apply(this,args), wait);
    };
  }

  function createReportState({ key, defaults }){
    const base = Object.assign({}, defaults || {});
    const st = { key: key || 'report', ...base };
    return st;
  }

  function readCommonFilters({ prefix }){
    const p = prefix || '';
    const get = (s)=> $(p ? `${p}-${s}` : s);
    const year = get('year')?.value || 'all';
    const month = get('month')?.value || 'all';
    const currency = get('currency')?.value || 'CRC';
    const accountId = Number(get('account')?.value || 0);
    const type = get('type')?.value || 'expense';
    const order = get('order')?.value || 'desc';
    return { year, month, currency, accountId, type, order };
  }

  function normalizeRange({ year, month }){
    // Si hay mes, forzar año coherente (en SGF el mes viene "YYYY-MM")
    if (month && month !== 'all' && String(month).includes('-')) {
      const y = String(month).slice(0,4);
      return { year: y, month };
    }
    return { year, month };
  }

  function applyOrdering(rows, order){
    const dir = (order || 'desc') === 'asc' ? 1 : -1;
    return (rows || []).slice().sort((a,b)=> (Number(a.total||0)-Number(b.total||0))*dir);
  }

  function wireExpandControls({ expandBtnId, collapseBtnId, onExpand, onCollapse }){
    const exp = $(expandBtnId);
    const col = $(collapseBtnId);
    if (exp) exp.addEventListener('click', (e)=>{ e.preventDefault(); onExpand && onExpand(); });
    if (col) col.addEventListener('click', (e)=>{ e.preventDefault(); onCollapse && onCollapse(); });
  }

  function wireDelegatedToggles({ tbody, toggleSelector, getKey, onToggle }){
    if (!tbody || !toggleSelector) return;
    if (tbody.__repDelegatedToggles) return;
    tbody.__repDelegatedToggles = true;
    tbody.addEventListener('click', (e)=>{
      const btn = e.target.closest(toggleSelector);
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const key = getKey ? getKey(btn) : null;
      if (key === null || key === undefined) return;
      onToggle && onToggle(key, btn);
    });
  }

  function wireDelegatedRows({ tbody, rowSelector, onRowClick }){
    if (!tbody || !rowSelector) return;
    if (tbody.__repDelegatedRows) return;
    tbody.__repDelegatedRows = true;
    tbody.addEventListener('click', (e)=>{
      const row = e.target.closest(rowSelector);
      if (!row) return;
      // ignore if click came from a toggle inside the row
      if (e.target.closest('.rcat-toggle') || e.target.closest('.racc-toggle')) return;
      onRowClick && onRowClick(row, e);
    });
  }

  
  function moneyClass(v){
    const n = Number(v||0);
    if (n > 0) return 'text-emerald-700';
    if (n < 0) return 'text-rose-700';
    return 'text-slate-900';
  }

  function fmtMoney(n, currency){
    const code = (currency || 'CRC').toUpperCase();
    const num = Number(n || 0);
    const localeMap = { CRC: 'es-CR', USD: 'en-US', EUR: 'es-ES', GBP: 'en-GB' };
    const locale = localeMap[code] || 'es-CR';
    try {
      try {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: code,
          currencyDisplay: 'narrowSymbol',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(num);
      } catch (_) {
        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: code,
          currencyDisplay: 'symbol',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(num);
      }
    } catch (_) {
      const sign = num < 0 ? '-' : '';
      const abs = Math.abs(num);
      const formatted = abs.toFixed(2).replace('.', ',');
      const sym = (code === 'CRC') ? '₡' : (code === 'USD') ? '$' : (code + ' ');
      return sign + sym + formatted;
    }
  }

  function storageKey(key){ return `SGF_REPORT_${key}`; }

  function saveFilters(key, obj){
    try { localStorage.setItem(storageKey(key), JSON.stringify(obj || {})); } catch(_){}
  }

  function loadFilters(key){
    try {
      const raw = localStorage.getItem(storageKey(key));
      if (!raw) return null;
      return JSON.parse(raw);
    } catch(_){ return null; }
  }

  function serializeSet(set){
    try { return Array.from(set || []); } catch(_) { return []; }
  }

  function deserializeSet(arr, castFn){
    const s = new Set();
    if (!Array.isArray(arr)) return s;
    for (const v of arr) s.add(castFn ? castFn(v) : v);
    return s;
  }

  function setSelectValueIfExists(el, value){
    if (!el) return;
    const v = value == null ? '' : String(value);
    const opt = Array.from(el.options || []).some(o => String(o.value) === v);
    if (opt) el.value = v;
  }

ns.$ = $;
  ns.debounce = debounce;
  ns.createReportState = createReportState;
  ns.readCommonFilters = readCommonFilters;
  ns.normalizeRange = normalizeRange;
  ns.applyOrdering = applyOrdering;
  ns.wireExpandControls = wireExpandControls;
  ns.wireDelegatedToggles = wireDelegatedToggles;
  ns.wireDelegatedRows = wireDelegatedRows;
  ns.moneyClass = moneyClass;
  ns.fmtMoney = fmtMoney;
  ns.saveFilters = saveFilters;
  ns.loadFilters = loadFilters;
  ns.setSelectValueIfExists = setSelectValueIfExists;
  ns.serializeSet = serializeSet;
  ns.deserializeSet = deserializeSet;

  // --- Ayuda por reporte (modal común) ---
  const HELP_CONTENT = {
    resumen_categorias: {
      title: 'Resumen por categorías',
      html: `
        <p class="text-sm text-slate-600">Muestra el total y la participación por categoría, con jerarquía (padre/hijos) y drilldown.</p>
        <ul class="list-disc pl-5 text-sm text-slate-700 mt-3 space-y-1">
          <li><b>Objetivo:</b> identificar en qué se va el dinero (o de dónde viene).</li>
          <li><b>Filtros:</b> Año, Mes, Moneda, Cuenta, Tipo y Orden.</li>
          <li><b>Acciones:</b> Expandir/Contraer y click en una fila para ver movimientos.</li>
        </ul>`
    },
    resumen_cuentas: {
      title: 'Resumen por cuentas',
      html: `
        <p class="text-sm text-slate-600">Consolida movimientos por cuenta y permite ver jerarquía y movimientos (drilldown).</p>
        <ul class="list-disc pl-5 text-sm text-slate-700 mt-3 space-y-1">
          <li><b>Objetivo:</b> entender movimientos por cuenta y su composición.</li>
          <li><b>Filtros:</b> Año, Mes, Moneda, Tipo y Orden.</li>
          <li><b>Acciones:</b> Expandir/Contraer y click para ver movimientos.</li>
        </ul>`
    },
    estado_resultados: {
      title: 'Estado de Resultados',
      html: `
        <p class="text-sm text-slate-600">Resumen de Ingresos, Gastos y Resultado Neto para un rango.</p>
        <ul class="list-disc pl-5 text-sm text-slate-700 mt-3 space-y-1">
          <li><b>Objetivo:</b> saber si el mes (o el año) cerró en positivo o negativo.</li>
          <li><b>Acciones:</b> click en Ingresos/Gastos/Neto para ver movimientos.</li>
        </ul>`
    },
    flujo_caja: {
      title: 'Flujo de Caja',
      html: `
        <p class="text-sm text-slate-600">Muestra entradas/salidas y el neto del periodo, considerando transferencias y (si aplica) ahorros.</p>
        <ul class="list-disc pl-5 text-sm text-slate-700 mt-3 space-y-1">
          <li><b>Objetivo:</b> entender el flujo real de dinero en el periodo.</li>
          <li><b>Acciones:</b> click en filas para ver movimientos asociados.</li>
        </ul>`
    },
    presupuesto_vs_real: {
      title: 'Presupuesto vs Real',
      html: `
        <p class="text-sm text-slate-600">Compara presupuesto vs gasto real por categoría, con jerarquía y % de ejecución.</p>
        <ul class="list-disc pl-5 text-sm text-slate-700 mt-3 space-y-1">
          <li><b>Objetivo:</b> controlar desviaciones (te pasaste / vas bien).</li>
          <li><b>Acciones:</b> click en categoría para ver movimientos reales.</li>
        </ul>`
    },
    tendencias_12m: {
      title: 'Tendencias (12 meses)',
      html: `
        <p class="text-sm text-slate-600">Serie mensual por Categoría o Cuenta para los últimos 12 meses del periodo final.</p>
        <ul class="list-disc pl-5 text-sm text-slate-700 mt-3 space-y-1">
          <li><b>Objetivo:</b> ver patrones y cambios a lo largo del tiempo.</li>
          <li><b>Acciones:</b> click en fila para ver movimientos del rango completo.</li>
        </ul>`
    },
    insights: {
      title: 'Insights',
      html: `
        <p class="text-sm text-slate-600">Top categorías y top comercios (descripción) según filtros.</p>
        <ul class="list-disc pl-5 text-sm text-slate-700 mt-3 space-y-1">
          <li><b>Objetivo:</b> detectar rápidamente los mayores gastos/ingresos.</li>
          <li><b>Acciones:</b> click en categoría para drilldown.</li>
        </ul>`
    },
    comparativo_mes: {
      title: 'Comparativo Mes a Mes',
      html: `
        <p class="text-sm text-slate-600">Comparación por mes (últimos 12): ingresos, gastos y neto.</p>
        <ul class="list-disc pl-5 text-sm text-slate-700 mt-3 space-y-1">
          <li><b>Objetivo:</b> ver evolución mensual y estacionalidad.</li>
          <li><b>Acciones:</b> click en un mes para drilldown del periodo.</li>
        </ul>`
    },
    balance_cuentas: {
      title: 'Balance por Cuenta / Saldo por Mes',
      html: `
        <p class="text-sm text-slate-600">Saldo inicial + flujos del mes + saldo final, por cuenta o por meses para una cuenta.</p>
        <ul class="list-disc pl-5 text-sm text-slate-700 mt-3 space-y-1">
          <li><b>Objetivo:</b> cuadrar saldos y entender variaciones.</li>
          <li><b>Vista:</b> Cuentas (mes) o Meses (cuenta).</li>
          <li><b>Acciones:</b> click en fila para ver movimientos del mes.</li>
        </ul>`
    },
  };

  function ensureHelpModal(){
    let modal = document.getElementById('sgf-help-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'sgf-help-modal';
    modal.className = 'fixed inset-0 z-[9999] hidden';
    modal.innerHTML = `
      <div class="absolute inset-0 bg-black/40 sgf-help-backdrop"></div>
      <div class="absolute inset-0 flex items-center justify-center p-4">
        <div class="w-full max-w-xl rounded-2xl bg-white shadow-xl border">
          <div class="flex items-start justify-between gap-3 p-4 border-b">
            <div>
              <div id="sgf-help-title" class="text-lg font-semibold text-slate-900">Ayuda</div>
            </div>
            <button type="button" class="sgf-help-close p-2 rounded-xl hover:bg-slate-100">
              <i data-lucide="x" class="w-5 h-5"></i>
            </button>
          </div>
          <div id="sgf-help-body" class="p-4"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => { modal.classList.add('hidden'); };
    modal.querySelector('.sgf-help-backdrop')?.addEventListener('click', close);
    modal.querySelector('.sgf-help-close')?.addEventListener('click', close);

    return modal;
  }

  function openHelp(key){
    const def = HELP_CONTENT[String(key||'')] || { title: 'Ayuda', html: '<p class="text-sm text-slate-600">Sin contenido de ayuda.</p>' };
    const modal = ensureHelpModal();
    modal.querySelector('#sgf-help-title').textContent = def.title || 'Ayuda';
    modal.querySelector('#sgf-help-body').innerHTML = def.html || '';
    modal.classList.remove('hidden');
    try { window.lucide?.createIcons?.(); } catch(_){}
  }
  ns.openHelp = openHelp;

  // Delegación: cualquier botón con data-rep-help abre el modal.
  if (!window.SGF.__helpDelegated){
    window.SGF.__helpDelegated = true;
    document.addEventListener('click', (e)=>{
      const btn = e.target.closest('[data-rep-help]');
      if (!btn) return;
      e.preventDefault();
      openHelp(btn.getAttribute('data-rep-help'));
    });
  }

})(window.SGF.reports.engine);