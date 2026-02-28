// v1.10 Conciliación completa
// - Resumen mensual por cuenta/periodo
// - Detalle: marcar movimientos conciliados, cerrar/reabrir, export CSV

window.SGF = window.SGF || {};
window.SGF.modules = window.SGF.modules || {};


function escHtml(value) {
  const fn = window.SGF?.format?.escapeHtml;
  if (typeof fn === 'function') return fn(value);
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}


(function () {
  const PERIOD_RANGE_MONTHS = 24;

  const esMonths = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

  function pad2(n) { return String(n).padStart(2, '0'); }
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  }
  function isoToPeriod(iso) { return String(iso || '').slice(0, 7); }
  function periodToLabel(period) {
    const [y,m] = String(period || '').split('-');
    const mi = Number(m||'1')-1;
    return `${esMonths[Math.max(0,Math.min(11,mi))]} ${y}`;
  }
  function lastDayOfPeriod(period) {
    const [y,m] = String(period).split('-').map(Number);
    const dt = new Date(y, (m||1), 0);
    return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}-${pad2(dt.getDate())}`;
  }
  function firstDayOfPeriod(period) {
    const [y,m] = String(period).split('-').map(Number);
    return `${y}-${pad2(m||1)}-01`;
  }
  function round2(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  function formatMoney(amount, currency) {
    const cur = currency || 'CRC';
    try {
      const nf = new Intl.NumberFormat('es-CR', { style: 'currency', currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return nf.format(Number(amount || 0));
    } catch (_) {
      return `${cur} ${Number(amount||0).toFixed(2)}`;
    }
  }

  function buildPeriodOptions(selectEl, { includeAll = false } = {}) {
    if (!selectEl) return;
    const opts = [];
    if (includeAll) opts.push(`<option value="">(Todos)</option>`);

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 0; i < PERIOD_RANGE_MONTHS; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() - i, 1);
      const p = `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;
      opts.push(`<option value="${p}">${periodToLabel(p)}</option>`);
    }
    selectEl.innerHTML = opts.join('');
  }

  function getAccounts() {
    const rows = window.SGF.db.select(
      `SELECT a.id, a.name, a.currency, a.allow_negative,
              COALESCE(t.name,'') AS type_name
       FROM accounts a
       LEFT JOIN account_types t ON t.id=a.type_id
       WHERE COALESCE(a.active,1)=1
       ORDER BY a.name COLLATE NOCASE`,
      {}
    );
    return rows || [];
  }

  function buildAccountOptions(selectEl, { includeAll = false } = {}) {
    if (!selectEl) return;
    const acc = getAccounts();
    const opts = [];
    if (includeAll) opts.push(`<option value="">(Todas)</option>`);
    acc.forEach(a => {
      opts.push(`<option value="${a.id}">${escHtml(a.type_name ? (a.type_name + ' > ' + a.name) : a.name)} (${escHtml(a.currency)})</option>`);
    });
    selectEl.innerHTML = opts.join('');
  }

  function getAccountMetaMap() {
    const map = new Map();
    getAccounts().forEach(a => map.set(Number(a.id), a));
    return map;
  }

  function getBalanceAtPeriodEnd(accountId, period) {
    const id = Number(accountId);
    if (!id || !period) return 0;
    const end = lastDayOfPeriod(period);
    const val = window.SGF.db.scalar(
      `SELECT COALESCE(SUM(
        CASE
          WHEN type='income' AND account_id=:id AND date<=:end THEN amount
          WHEN type='expense' AND account_id=:id AND date<=:end THEN -amount
          WHEN type='transfer' AND account_id=:id AND date<=:end THEN -amount
          WHEN type='transfer' AND account_to_id=:id AND date<=:end THEN COALESCE(amount_to, amount)
          ELSE 0
        END
      ),0) AS balance
      FROM movements`,
      { ':id': id, ':end': end }
    );
    return Number(val || 0);
  }

  function listMovementsForRecon(accountId, period) {
    const id = Number(accountId);
    if (!id || !period) return [];
    const start = firstDayOfPeriod(period);
    const end = lastDayOfPeriod(period);
    const rows = window.SGF.db.select(
      `SELECT id, type, date, description, amount, amount_to, currency, fx_rate, account_id, account_to_id
       FROM movements
       WHERE date BETWEEN :start AND :end
         AND (account_id=:id OR account_to_id=:id)
         AND COALESCE(is_opening,0)=0
       ORDER BY date ASC, id ASC`,
      { ':start': start, ':end': end, ':id': id }
    ) || [];
    return rows.map(r => {
      const amt = Number(r.amount || 0);
      const credit = (r.amount_to == null ? amt : Number(r.amount_to || 0));
      let signed = 0;
      if (r.type === 'income' && Number(r.account_id) === id) signed = +amt;
      else if (r.type === 'expense' && Number(r.account_id) === id) signed = -amt;
      else if (r.type === 'transfer') {
        if (Number(r.account_id) === id) signed = -amt;
        else if (Number(r.account_to_id) === id) signed = +credit;
      }
      return { ...r, signed_amount: signed };
    });
  }

  function ensureReconExists({ accountId, period }) {
    const accId = Number(accountId);
    const per = String(period || '').trim();
    if (!accId || !per) throw new Error('Selecciona cuenta y periodo.');

    const existing = window.SGF.db.one(
      `SELECT * FROM reconciliations WHERE account_id=:a AND period=:p`,
      { ':a': accId, ':p': per }
    );
    if (existing) return existing;

    const now = new Date().toISOString();
    window.SGF.db.run(
      `INSERT INTO reconciliations(account_id, period, bank_ending, closed, created_at)
       VALUES(:a, :p, 0, 0, :now)`,
      { ':a': accId, ':p': per, ':now': now }
    );
    const id = window.SGF.db.scalar('SELECT last_insert_rowid()');
    return window.SGF.db.one('SELECT * FROM reconciliations WHERE id=:id', { ':id': id });
  }

  function pendingCount(reconId, accountId, period) {
    const movs = listMovementsForRecon(accountId, period);
    if (!movs.length) return 0;
    const okSet = new Set(
      (window.SGF.db.select(
        `SELECT movement_id FROM reconciliation_items WHERE reconciliation_id=:rid AND is_ok=1`,
        { ':rid': Number(reconId) }
      ) || []).map(x => Number(x.movement_id))
    );
    return movs.filter(m => !okSet.has(Number(m.id))).length;
  }

  function exportReconCSV({ recon, account, movements }) {
    const header = ['Fecha','Descripción','Monto','Conciliado'];
    const lines = [header.join(',')];
    movements.forEach(m => {
      const dateCR = window.SGF?.format?.isoToCR ? window.SGF.format.isoToCR(m.date) : m.date;
      const desc = String(m.description || '').replaceAll('"', '""');
      const amt = Number(m.signed_amount || 0).toFixed(2);
      const ok = m.is_ok ? 'SI' : 'NO';
      lines.push(`"${dateCR}","${desc}","${amt}","${ok}"`);
    });
    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const per = recon.period || 'periodo';
    a.download = `SGF_Conciliacion_${account.name}_${per}.csv`.replaceAll(' ', '_');
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  
  // Exportar desde filtros (Cuenta + Periodo) - v1.14
  function exportFromFilters() {
    const accId = Number(document.getElementById('rec-f-account')?.value || 0);
    const per = String(document.getElementById('rec-f-period')?.value || '').trim();
    if (!accId || !/^\d{4}-\d{2}$/.test(per)) {
      toast('Selecciona Cuenta y Periodo para exportar.');
      return;
    }
    // Asegurar conciliación existente (si no existe, se crea con saldo banco 0)
    let recon = window.SGF.db.one('SELECT * FROM reconciliations WHERE account_id=:a AND period=:p', { ':a': accId, ':p': per });
    if (!recon) {
      const now = new Date().toISOString();
      window.SGF.db.run(
        'INSERT INTO reconciliations(account_id,period,bank_ending,closed,created_at,updated_at) VALUES (:a,:p,0,0,:t,NULL)',
        { ':a': accId, ':p': per, ':t': now }
      );
      recon = window.SGF.db.one('SELECT * FROM reconciliations WHERE account_id=:a AND period=:p', { ':a': accId, ':p': per });
    }
    const acc = window.SGF.db.one('SELECT id, name, currency FROM accounts WHERE id=:id', { ':id': accId });
    const movs = listMovementsForRecon(accId, per);
    const okSet = new Set((window.SGF.db.select(
      'SELECT movement_id FROM reconciliation_items WHERE reconciliation_id=:rid AND is_ok=1',
      { ':rid': Number(recon.id) }
    ) || []).map(x => Number(x.movement_id)));
    movs.forEach(m => m.is_ok = okSet.has(Number(m.id)));
    exportReconCSV({ recon, account: acc, movements: movs });
  }

// -------- Summary View --------
  function renderSummary() {
    const tbody = document.getElementById('rec-table-body');
    if (!tbody) return;

    const fAcc = document.getElementById('rec-f-account')?.value || '';
    const fPer = document.getElementById('rec-f-period')?.value || '';
    const fStatus = document.getElementById('rec-f-status')?.value || '';

    const where = ['1=1'];
    const p = {};
    if (fAcc) { where.push('r.account_id=:a'); p[':a'] = Number(fAcc); }
    if (fPer) { where.push('r.period=:p'); p[':p'] = fPer; }
    if (fStatus === 'open') where.push('COALESCE(r.closed,0)=0');
    if (fStatus === 'closed') where.push('COALESCE(r.closed,0)=1');

    const rows = window.SGF.db.select(
      `SELECT r.id, r.account_id, r.period, r.bank_ending, r.closed,
              a.name AS account_name, a.currency AS currency
       FROM reconciliations r
       JOIN accounts a ON a.id = r.account_id
       WHERE ${where.join(' AND ')}
       ORDER BY r.period DESC, a.name COLLATE NOCASE ASC`,
      p
    ) || [];

    tbody.innerHTML = rows.map(r => {
      const sgf = getBalanceAtPeriodEnd(r.account_id, r.period);
      const diff = round2(Number(r.bank_ending || 0) - sgf);
      const pend = pendingCount(r.id, r.account_id, r.period);
      const cur = r.currency || 'CRC';
      return `
        <tr class="border-b hover:bg-gray-50">
          <td class="p-3">
            <div class="flex gap-1">
              <button class="text-blue-600 hover:bg-blue-50 p-1 rounded" data-recon-open="${r.id}" title="Ver detalle"><i data-lucide="eye" class="w-4 h-4"></i></button>
              <button class="text-gray-600 hover:bg-gray-100 p-1 rounded" data-recon-export="${r.id}" title="Exportar CSV"><i data-lucide="download" class="w-4 h-4"></i></button>
            </div>
          </td>
          <td class="p-3 text-xs text-gray-400">#${r.id}</td>
          <td class="p-3 text-sm">${escHtml(r.account_name)}</td>
          <td class="p-3 text-sm">${periodToLabel(r.period)} <span class="text-xs text-gray-400">(${r.period})</span></td>
          <td class="p-3 text-sm font-semibold">${formatMoney(r.bank_ending, cur)}</td>
          <td class="p-3 text-sm font-semibold">${formatMoney(sgf, cur)}</td>
          <td class="p-3 text-sm ${diff===0?'text-green-700':'text-red-700'} font-bold">${formatMoney(diff, cur)}</td>
          <td class="p-3">${pend ? `<span class="px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 text-xs font-bold">${pend} pendientes</span>` : '<span class="px-2 py-0.5 rounded bg-green-100 text-green-700 text-xs font-bold">OK</span>'}</td>
          <td class="p-3">${Number(r.closed||0) ? '<span class="px-2 py-0.5 rounded bg-gray-200 text-gray-700 text-xs font-bold">Cerrado</span>' : '<span class="px-2 py-0.5 rounded bg-blue-100 text-blue-700 text-xs font-bold">Abierto</span>'}</td>
        </tr>
      `;
    }).join('');

    window.lucide?.createIcons?.();
  }

  function wireSummaryEventsOnce() {
    if (window.__sgfReconSummaryWired) return;
    window.__sgfReconSummaryWired = true;
    document.addEventListener('click', async (ev) => {
      const btnOpen = ev.target.closest('[data-recon-open]');
      if (btnOpen) {
        ev.preventDefault();
        const id = Number(btnOpen.getAttribute('data-recon-open'));
        window.openModal('recon_detail', { id });
        return;
      }
      const btnExport = ev.target.closest('[data-recon-export]');
      if (btnExport) {
        ev.preventDefault();
        const id = Number(btnExport.getAttribute('data-recon-export'));
        const recon = window.SGF.db.one('SELECT * FROM reconciliations WHERE id=:id', { ':id': id });
        if (!recon) return;
        const acc = window.SGF.db.one('SELECT id, name, currency FROM accounts WHERE id=:id', { ':id': recon.account_id });
        const movs = listMovementsForRecon(recon.account_id, recon.period);
        const okSet = new Set((window.SGF.db.select('SELECT movement_id FROM reconciliation_items WHERE reconciliation_id=:rid AND is_ok=1', { ':rid': id }) || []).map(x => Number(x.movement_id)));
        movs.forEach(m => m.is_ok = okSet.has(Number(m.id)));
        exportReconCSV({ recon, account: acc, movements: movs });
      }
    }, true);
  }

  // -------- Detail Modal --------
  function setupReconModalDynamic() {
    const ctx = window.SGF.modalContext || {};
    const reconIdEl = document.getElementById('recon-id');
    const accSel = document.getElementById('recon-account');
    const perSel = document.getElementById('recon-period');
    const bankInp = document.getElementById('recon-bank');
    const sgfInp = document.getElementById('recon-sgf');
    const diffInp = document.getElementById('recon-diff');
    const statusEl = document.getElementById('recon-status');
    const onlyPending = document.getElementById('recon-only-pending');

    buildAccountOptions(accSel, { includeAll: false });
    buildPeriodOptions(perSel, { includeAll: false });
    // default period: current
    const curPer = isoToPeriod(todayISO());
    if (perSel && !perSel.value) perSel.value = curPer;

    let currentRecon = null;
    let currentAcc = null;
    let accountMeta = getAccountMetaMap();

    function computeAndPaintDiff() {
      if (!currentAcc) return;
      const cur = currentAcc.currency || 'CRC';
      const bank = round2(bankInp?.value);
      const sgf = round2(Number(sgfInp?.value || 0));
      const diff = round2(bank - sgf);
      if (diffInp) diffInp.value = diff.toFixed(2);
      // paint via classes on input parent? simple: set text color
      if (diffInp) {
        diffInp.classList.toggle('text-green-700', diff === 0);
        diffInp.classList.toggle('text-red-700', diff !== 0);
      }
      // also show formatted as title
      if (diffInp) diffInp.title = formatMoney(diff, cur);
    }

    function renderMovements() {
      const body = document.getElementById('recon-mov-body');
      if (!body || !currentRecon || !currentAcc) return;

      const movs = listMovementsForRecon(currentRecon.account_id, currentRecon.period);
      const okSet = new Set((window.SGF.db.select(
        'SELECT movement_id FROM reconciliation_items WHERE reconciliation_id=:rid AND is_ok=1',
        { ':rid': Number(currentRecon.id) }
      ) || []).map(x => Number(x.movement_id)));

      const cur = currentAcc.currency || 'CRC';
      const showOnlyPending = !!onlyPending?.checked;

      const rows = movs.map(m => {
        const isOk = okSet.has(Number(m.id));
        if (showOnlyPending && isOk) return '';
        const dateCR = window.SGF?.format?.isoToCR ? window.SGF.format.isoToCR(m.date) : m.date;
        const desc = (m.description || '').trim() || '(Sin descripción)';
        const signed = Number(m.signed_amount || 0);
        return `
          <tr class="border-b ${isOk ? 'bg-green-50/40' : ''}">
            <td class="p-3"><input class="recon-ok" type="checkbox" data-movid="${m.id}" ${isOk ? 'checked' : ''} ${Number(currentRecon.closed||0)?'disabled':''} /></td>
            <td class="p-3">${dateCR}</td>
            <td class="p-3">${escHtml(desc)}</td>
            <td class="p-3 text-right font-semibold ${signed<0?'text-red-700':'text-green-700'}">${formatMoney(signed, cur)}</td>
          </tr>
        `;
      }).filter(Boolean);

      body.innerHTML = rows.length ? rows.join('') : `
        <tr><td colspan="4" class="p-6 text-center text-gray-500">No hay movimientos para este periodo.</td></tr>
      `;
    }

    function refreshHeader() {
      if (!currentRecon || !statusEl) return;
      const closed = Number(currentRecon.closed || 0) === 1;
      statusEl.textContent = closed ? 'CERRADO' : 'ABIERTO';
      statusEl.className = closed
        ? 'px-2 py-1 rounded bg-gray-200 text-gray-700 text-xs font-bold'
        : 'px-2 py-1 rounded bg-blue-100 text-blue-700 text-xs font-bold';
      document.getElementById('recon-close')?.classList.toggle('hidden', closed);
      document.getElementById('recon-open')?.classList.toggle('hidden', !closed);
    }

    function loadFromCtxOrCreate() {
      if (ctx.id) {
        currentRecon = window.SGF.db.one('SELECT * FROM reconciliations WHERE id=:id', { ':id': Number(ctx.id) });
        if (!currentRecon) throw new Error('Conciliación no encontrada.');
        if (reconIdEl) reconIdEl.value = String(currentRecon.id);
        if (accSel) accSel.value = String(currentRecon.account_id);
        if (perSel) perSel.value = String(currentRecon.period);
      } else {
        // new: ensure record exists based on current selections
        const rec = ensureReconExists({ accountId: accSel?.value, period: perSel?.value });
        currentRecon = rec;
        if (reconIdEl) reconIdEl.value = String(rec.id);
        ctx.id = rec.id;
      }

      currentAcc = accountMeta.get(Number(currentRecon.account_id));
      if (bankInp) bankInp.value = Number(currentRecon.bank_ending || 0).toFixed(2);

      const sgf = getBalanceAtPeriodEnd(currentRecon.account_id, currentRecon.period);
      if (sgfInp) sgfInp.value = Number(sgf || 0).toFixed(2);
      refreshHeader();
      computeAndPaintDiff();
      renderMovements();
    }

    function saveBankBalance() {
      if (!currentRecon) {
        currentRecon = ensureReconExists({ accountId: accSel?.value, period: perSel?.value });
        ctx.id = currentRecon.id;
        if (reconIdEl) reconIdEl.value = String(currentRecon.id);
      }
      const now = new Date().toISOString();
      const bank = round2(bankInp?.value);
      
try {
  window.SGF.db.run(
    'UPDATE reconciliations SET bank_ending=:b, updated_at=:u WHERE id=:id',
    { ':b': bank, ':u': now, ':id': Number(currentRecon.id) }
  );
  window.SGF.db.save();
} catch (e) {
  const msg = String(e?.message || e || '');
  if (msg.includes('RECON_CLOSED')) toast('Conciliación cerrada: no se puede cambiar el saldo banco.');
  else toast('No se pudo guardar la conciliación.');
  return;
}
      currentRecon = window.SGF.db.one('SELECT * FROM reconciliations WHERE id=:id', { ':id': Number(currentRecon.id) });
      toast('Conciliación guardada.');
      renderSummary();
      computeAndPaintDiff();
    }

    // Expose current save function so the modal Save button always works even if
    // modalHandlers wiring is overwritten elsewhere.
    window.SGF.__reconSave = saveBankBalance;

    // Wiring changes
    function onChangeKeyFields() {
      try {
        // when account or period changes, load existing or create new
        const rec = ensureReconExists({ accountId: accSel?.value, period: perSel?.value });
        currentRecon = rec;
        ctx.id = rec.id;
        if (reconIdEl) reconIdEl.value = String(rec.id);
        currentAcc = accountMeta.get(Number(rec.account_id));
        if (bankInp) bankInp.value = Number(rec.bank_ending || 0).toFixed(2);
        const sgf = getBalanceAtPeriodEnd(rec.account_id, rec.period);
        if (sgfInp) sgfInp.value = Number(sgf||0).toFixed(2);
        refreshHeader();
        computeAndPaintDiff();
        renderMovements();
        renderSummary();
      } catch (e) {
        console.warn(e);
      }
    }

    accSel?.addEventListener('change', onChangeKeyFields);
    perSel?.addEventListener('change', onChangeKeyFields);
    bankInp?.addEventListener('input', computeAndPaintDiff);
    onlyPending?.addEventListener('change', renderMovements);

    // Button actions
    document.getElementById('recon-export')?.addEventListener('click', () => {
      if (!currentRecon || !currentAcc) return;
      const movs = listMovementsForRecon(currentRecon.account_id, currentRecon.period);
      const okSet = new Set((window.SGF.db.select('SELECT movement_id FROM reconciliation_items WHERE reconciliation_id=:rid AND is_ok=1', { ':rid': Number(currentRecon.id) }) || []).map(x => Number(x.movement_id)));
      movs.forEach(m => m.is_ok = okSet.has(Number(m.id)));
      exportReconCSV({ recon: currentRecon, account: currentAcc, movements: movs });
    });

    document.getElementById('recon-close')?.addEventListener('click', async () => {
      if (!currentRecon) return;
      const ok = await window.SGF.uiConfirm({
        title: 'Cerrar mes',
        message: 'Al cerrar, se bloquearán los checks de conciliación y también crear/editar/eliminar movimientos de esta cuenta en este periodo.',
        confirmText: 'Cerrar',
        confirmClass: 'bg-gray-900 text-white'
      });
      if (!ok) return;
      const now = new Date().toISOString();
      window.SGF.db.run('UPDATE reconciliations SET closed=1, updated_at=:u WHERE id=:id', { ':u': now, ':id': Number(currentRecon.id) });
      window.SGF.db.save();
      currentRecon = window.SGF.db.one('SELECT * FROM reconciliations WHERE id=:id', { ':id': Number(currentRecon.id) });

       // v1.11: invalidar cache de cierres en Movimientos
       try {
         window.SGF?.closureGuard?.invalidate?.();
         window.SGF?.modules?.movimientos?.invalidateClosures?.();
         window.SGF?.modules?.movimientos?.refreshMovimientos?.();
       } catch (_) {}

      refreshHeader();
      renderMovements();
      renderSummary();
      toast('Mes cerrado.');
    });

    document.getElementById('recon-open')?.addEventListener('click', async () => {
      if (!currentRecon) return;
      const ok = await window.SGF.uiConfirm({
        title: 'Reabrir mes',
        message: 'Esto permitirá modificar nuevamente los checks de conciliación y desbloquear movimientos de esta cuenta en este periodo.',
        confirmText: 'Reabrir',
        confirmClass: 'bg-blue-600 text-white'
      });
      if (!ok) return;
      const now = new Date().toISOString();
      window.SGF.db.run('UPDATE reconciliations SET closed=0, updated_at=:u WHERE id=:id', { ':u': now, ':id': Number(currentRecon.id) });
      window.SGF.db.save();
      currentRecon = window.SGF.db.one('SELECT * FROM reconciliations WHERE id=:id', { ':id': Number(currentRecon.id) });

      try {
        window.SGF?.closureGuard?.invalidate?.();
      } catch (_) {}

       // v1.11: invalidar cache de cierres en Movimientos
       try {
         window.SGF?.closureGuard?.invalidate?.();
         window.SGF?.modules?.movimientos?.invalidateClosures?.();
         window.SGF?.modules?.movimientos?.refreshMovimientos?.();
       } catch (_) {}

      refreshHeader();
      renderMovements();
      renderSummary();
      toast('Mes reabierto.');
    });

    // Checkbox delegation (inside modal)
    // Importante: el listener se registra solo una vez, por lo tanto NO puede
    // depender de variables cerradas (currentRecon/currentAcc) que cambian entre aperturas.
    // En su lugar, lee el estado actual desde el DOM en cada evento.
    const overlay = document.getElementById('modal-overlay');
    if (overlay && !overlay.__sgfReconBound) {
      overlay.__sgfReconBound = true;
      overlay.addEventListener('change', (ev) => {
        const cb = ev.target;
        if (!(cb instanceof HTMLInputElement)) return;
        if (!cb.classList.contains('recon-ok')) return;

        const reconId = Number(document.getElementById('recon-id')?.value || 0);
        if (!reconId) return;
        const recon = window.SGF.db.one('SELECT * FROM reconciliations WHERE id=:id', { ':id': reconId });
        if (!recon) return;
        if (Number(recon.closed || 0) === 1) return;

        const movId = Number(cb.getAttribute('data-movid'));
        const isOk = cb.checked ? 1 : 0;
        const now = new Date().toISOString();

try {
  window.SGF.db.run(
    `INSERT INTO reconciliation_items(reconciliation_id, movement_id, is_ok, created_at)
     VALUES(:r,:m,:ok,:now)
     ON CONFLICT(reconciliation_id, movement_id)
     DO UPDATE SET is_ok=excluded.is_ok`,
    { ':r': reconId, ':m': movId, ':ok': isOk, ':now': now }
  );
  window.SGF.db.save();
} catch (e) {
  const msg = String(e?.message || e || '');
  if (msg.includes('RECON_CLOSED')) toast('Conciliación cerrada: no se puede modificar el OK.');
  else toast('No se pudo actualizar el OK.');
  cb.checked = !cb.checked;
  return;
}

        const row = cb.closest('tr');
        if (row) {
          row.classList.toggle('bg-green-50/40', !!cb.checked);
          const onlyPendingNow = !!document.getElementById('recon-only-pending')?.checked;
          if (onlyPendingNow && cb.checked) row.remove();
        }
        renderSummary();
      });
    }

    // initial load
    try {
      // If modal opened by "Nueva conciliación" without ctx.id, keep current selectors.
      if (accSel && !accSel.value) {
        const first = getAccounts()[0];
        if (first) accSel.value = String(first.id);
      }
      loadFromCtxOrCreate();
    } catch (e) {
      console.error(e);
      toast(e?.message || 'No se pudo cargar conciliación.');
    }

    // Modal Save handler se registra una vez de forma global (ver abajo).
  }

  // Register Save handler once (uses the latest save function exposed by the modal)
  window.SGF.modalHandlers = window.SGF.modalHandlers || {};
  if (!window.SGF.modalHandlers.recon_detail) {
    window.SGF.modalHandlers.recon_detail = async () => {
      if (typeof window.SGF.__reconSave === 'function') {
        window.SGF.__reconSave();
      } else {
        toast('No se pudo guardar: conciliación no inicializada.');
      }
    };
  }

  // -------- Mount --------
  function onMount() {
    try {
      buildAccountOptions(document.getElementById('rec-f-account'), { includeAll: true });
      buildPeriodOptions(document.getElementById('rec-f-period'), { includeAll: true });
      // default period empty
      const fPer = document.getElementById('rec-f-period');
      if (fPer) fPer.value = '';
      const fStatus = document.getElementById('rec-f-status');
      if (fStatus) fStatus.value = '';

      document.getElementById('rec-f-account')?.addEventListener('change', renderSummary);
      document.getElementById('rec-f-period')?.addEventListener('change', renderSummary);
      document.getElementById('rec-f-status')?.addEventListener('change', renderSummary);

      wireSummaryEventsOnce();
      renderSummary();
    } catch (e) {
      console.error(e);
    }
  }

  window.SGF.modules.conciliacion = {
    onMount,
    setupReconModalDynamic,
    exportFromFilters,
  };
})();
