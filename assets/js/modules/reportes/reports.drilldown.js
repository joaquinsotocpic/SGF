// v1.29.0 - Reportes: Drill-down común (totales + chips filtros)
window.SGF = window.SGF || {};
window.SGF.reports = window.SGF.reports || {};
window.SGF.reports.drill = window.SGF.reports.drill || {};

(function(ns){
  const R = window.SGF.reports;
  const D = window.SGF.reports.data;

  function esc(s){ return R.escapeHtml ? R.escapeHtml(String(s ?? '')) : String(s ?? ''); }

  function fill({ subtitle, rangeLabel, currency, rows, chips }) {
    const sub = document.getElementById('repdr-subtitle');
    const rng = document.getElementById('repdr-range');
    const tb = document.getElementById('repdr-tbody');
    const foot = document.getElementById('repdr-foot');
    const totalEl = document.getElementById('repdr-total');
    const countEl = document.getElementById('repdr-count');
    const chipsEl = document.getElementById('repdr-chips');
    if (sub) sub.textContent = subtitle || 'Movimientos';
    if (rng) rng.textContent = rangeLabel || '—';

    const chipList = Array.isArray(chips) ? chips.filter(Boolean) : [];
    if (chipsEl) {
      chipsEl.innerHTML = chipList.map(c => `<span class="inline-flex items-center px-2 py-1 rounded-lg border text-xs text-slate-600 bg-white">${esc(c)}</span>`).join('');
    }


    const fmt = (v)=> (R.fmtMoney ? R.fmtMoney(Number(v||0), currency) : String(v||0));
    const cls = (v)=> (R.moneyClass ? R.moneyClass(Number(v||0), 'saldo') : '');

    const list = rows || [];
    if (!tb) return;

    tb.innerHTML = list.map(r => `
      <tr class="border-b last:border-b-0">
        <td class="py-2 px-3 whitespace-nowrap">${esc(r.date || '')}</td>
        <td class="py-2 px-3">${esc(r.description || '')}</td>
        <td class="py-2 px-3">${esc(r.detail || '')}</td>
        <td class="py-2 px-3 text-right tabular-nums ${cls(r.amount)}">${esc(fmt(r.amount))}</td>
      </tr>
    `).join('') || `<tr><td class="py-3 px-3 text-slate-500" colspan="4">Sin movimientos.</td></tr>`;


    const total = list.reduce((a,r)=> a + Number(r.amount||0), 0);
    if (totalEl) totalEl.textContent = fmt(total);
    if (countEl) countEl.textContent = `${list.length} movimiento(s)`;

    if (foot) foot.textContent = `Total: ${fmt(total)} · ${list.length} movimiento(s)`;
  }

  function openFromQuery({ subtitle, rangeLabel, currency, scope, type, range }) {

    const chips = [];
    if (type) {
      const t = String(type);
      chips.push(t === 'income' ? 'Tipo: Ingresos' : t === 'expense' ? 'Tipo: Gastos' : 'Tipo: Ambos');
    }
    if (currency) chips.push(`Moneda: ${String(currency)}`);
    try {
      const db = window.SGF?.db;
      if (db && scope && scope.kind === 'account' && Number(scope.id||0) > 0) {
        const r = db.select('SELECT name FROM accounts WHERE id=:id LIMIT 1', {':id': Number(scope.id)});
        if (r && r[0] && r[0].name) chips.push(`Cuenta: ${r[0].name}`);
      }
      if (db && scope && scope.kind === 'category' && Number(scope.id||0) > 0) {
        const r = db.select('SELECT name FROM categories WHERE id=:id LIMIT 1', {':id': Number(scope.id)});
        if (r && r[0] && r[0].name) chips.push(`Categoría: ${r[0].name}`);
      }
    } catch(_){}

    const rows = (D && D.listMovements) ? D.listMovements({ scope, range, currency, type }) : [];
    window.openModal?.('rep_drill', {});
    // openModal injects html; now fill
    fill({ subtitle, rangeLabel, currency, rows, chips });
    try { window.lucide?.createIcons?.(); } catch(_){}
  }

  ns.fill = fill;
  ns.openFromQuery = openFromQuery;
})(window.SGF.reports.drill);
