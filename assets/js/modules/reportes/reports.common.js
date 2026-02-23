// v1.19.15 - Base común de Reportes
// Utilidades compartidas entre reportes para mantener consistencia UI/formatos.

window.SGF = window.SGF || {};
window.SGF.reports = window.SGF.reports || {};

(function(ns){
  function moneyClass(v, kind){
    // kind: 'saldo' | 'ingreso' | 'gasto' | 'ahorro' | 'monto'
    const n = Number(v || 0);
    if (!isFinite(n) || n === 0) return 'text-slate-700';
    if (kind === 'gasto') return 'text-rose-700';
    if (kind === 'ingreso') return 'text-emerald-700';
    // saldo/ahorro/monto: por signo
    return n > 0 ? 'text-emerald-700' : 'text-rose-700';
  }

  function fmtMoney(v, currency){
    const n = Number(v || 0);
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    // Mantener estilo SGF (coma decimal)
    const s = abs.toLocaleString('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const cur = currency ? (currency === 'CRC' ? '₡' : currency + ' ') : '';
    return `${sign}${cur}${s}`;
  }

  function caretButtonHtml(expanded){
    // Mismo estilo que Categorías: botón 7x7 con borde + chevron.
    // Usamos SVG inline para no depender de lucide runtime.
    const icon = expanded
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
    return `<button class="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700" data-act="toggle">${icon}</button>`;
  }

  function caretSpacerHtml(){
    return `<span class="inline-flex items-center justify-center w-7 h-7"></span>`;
  }

  function firstCellHtml({ level=0, hasChildren=false, expanded=false, label='', bold=false }){
    const pad = 8 + (level * 20);
    const caret = hasChildren ? caretButtonHtml(expanded) : caretSpacerHtml();
    const w = bold ? 'font-semibold' : 'font-medium';
    return `
      <td class="py-3">
        <div class="flex items-center gap-2" style="padding-left:${pad}px">
          ${caret}
          <span class="${w} text-slate-900 leading-none">${escapeHtml(label)}</span>
        </div>
      </td>`;
  }

  function escapeHtml(s){
    return String(s ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  ns.moneyClass = moneyClass;
  ns.fmtMoney = fmtMoney;
  ns.firstCellHtml = firstCellHtml;
  ns.escapeHtml = escapeHtml;
})(window.SGF.reports);
