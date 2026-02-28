// v1.06 - Movimientos CRUD real (SQLite + bóveda)

window.SGF = window.SGF || {};
window.SGF.modules = window.SGF.modules || {};

(function () {
  const TYPE_MAP_UI_TO_DB = {
    'Gasto': 'expense',
    'Ingreso': 'income',
    'Transferencia': 'transfer',
  };

  const TYPE_MAP_DB_TO_UI = {
    expense: 'Gasto',
    income: 'Ingreso',
    transfer: 'Transferencia',
  };

  // Normalizadores (evitan errores en Recurrentes)
  function normalizeType(uiOrDb) {
    const v = String(uiOrDb || '').trim();
    if (!v) return 'expense';
    // Ya viene en DB
    if (v === 'expense' || v === 'income' || v === 'transfer') return v;
    // Viene en UI
    return TYPE_MAP_UI_TO_DB[v] || 'expense';
  }

  function normalizeTypeUi(dbOrUi) {
    const v = String(dbOrUi || '').trim();
    if (!v) return 'Gasto';
    // Ya viene en UI
    if (v === 'Gasto' || v === 'Ingreso' || v === 'Transferencia') return v;
    return TYPE_MAP_DB_TO_UI[v] || 'Gasto';
  }

  function pad2(n) {
    const s = String(n);
    return s.length === 1 ? `0${s}` : s;
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function isoToCR(iso) {
    const fn = window.SGF?.format?.isoToCR;
    return typeof fn === 'function' ? fn(iso) : String(iso || '');
  }

  function crToISO(cr) {
    const fn = window.SGF?.format?.crToISO;
    return typeof fn === 'function' ? fn(cr) : String(cr || '');
  }

  function todayCR() {
    const fn = window.SGF?.format?.todayCR;
    return typeof fn === 'function' ? fn() : isoToCR(todayISO());
  }

  function escapeHtmlSafe(value) {
    const fn = window.SGF?.format?.escapeHtml;
    if (typeof fn === 'function') return fn(value);
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  // Date picker para CR (dd/mm/aaaa) usando flatpickr si está disponible.
  // Mantiene el input como texto para permitir escritura manual.
  function initCRDatePicker(inputEl) {
    if (!inputEl) return;
    // destruir instancia previa
    try {
      if (inputEl._sgfFp && typeof inputEl._sgfFp.destroy === 'function') {
        inputEl._sgfFp.destroy();
      }
    } catch (_) {}
    inputEl._sgfFp = null;

    if (typeof window.flatpickr !== 'function') return;
    try {
      const fp = window.flatpickr(inputEl, {
        dateFormat: 'd/m/Y',
        allowInput: true,
        locale: (window.flatpickr.l10ns && window.flatpickr.l10ns.es) ? window.flatpickr.l10ns.es : 'es',
        defaultDate: (inputEl.value || '').trim() || null,
        onChange: () => {
          // forzar actualización de periodo
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        },
      });
      inputEl._sgfFp = fp;
    } catch (e) {
      console.warn('No se pudo inicializar datepicker:', e);
    }
  }

  function isoToPeriod(dateStr) {
    return (dateStr || '').slice(0, 7);
  }

  function round2(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return NaN;
    return Math.round(num * 100) / 100;
  }

  
  // v1.25.0: helper para tasas / valores con 6 decimales (evita ReferenceError)
  function formatNumber6(n) {
    const num = Number(n || 0);
    try {
      return new Intl.NumberFormat('es-CR', {
        minimumFractionDigits: 6,
        maximumFractionDigits: 6,
      }).format(num);
    } catch (_) {
      try { return num.toFixed(6); } catch(_) { return String(n ?? ''); }
    }
  }

function formatMoney(amount, currency) {
    const n = Number(amount || 0);
    const cur = currency === 'USD' ? 'USD' : 'CRC';
    try {
      return new Intl.NumberFormat('es-CR', {
        style: 'currency',
        currency: cur,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
    } catch (_) {
      // fallback
      const fixed = (Math.round(n * 100) / 100).toFixed(2);
      return `${cur} ${fixed}`;
    }
  }

  function formatNumber2(amount) {
    const n = Number(amount || 0);
    try {
      return new Intl.NumberFormat('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    } catch (_) {
      return n.toFixed(2);
    }
  }

  function periodEs(period) {
    const fn = window.SGF?.format?.periodEs;
    if (typeof fn === 'function') return fn(period);
    const p = String(period || '');
    if (!/^\d{4}-\d{2}$/.test(p)) return p;
    const y = p.slice(0, 4);
    const m = Number(p.slice(5, 7));
    const meses = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
    ];
    const name = meses[m - 1] || p;
    return `${name} ${y}`;
  }

  // --- Cierre de mes (v1.11): bloqueos por conciliación cerrada ---
  // Regla: si existe reconciliations.closed=1 para (account_id, period), se bloquea
  // crear/editar/eliminar movimientos que afecten esa cuenta en ese periodo.
  let __sgfClosedReconSet = null;
  const __sgfClosedCache = new Map();

  function reconKey(accountId, period) {
    return `${Number(accountId) || 0}|${String(period || '')}`;
  }

  function getClosedReconSet() {
    if (__sgfClosedReconSet) return __sgfClosedReconSet;
    const rows = window.SGF.db.select(
      'SELECT account_id, period FROM reconciliations WHERE COALESCE(closed,0)=1'
    ) || [];
    __sgfClosedReconSet = new Set(rows.map(r => reconKey(r.account_id, r.period)));
    return __sgfClosedReconSet;
  }

  function invalidateClosures() {
    __sgfClosedReconSet = null;
    __sgfClosedCache.clear();
  }

  function isPeriodClosedForAccount(accountId, period) {
    const id = Number(accountId) || 0;
    const p = String(period || '').trim();
    if (!id || !p) return false;
    const key = reconKey(id, p);
    if (__sgfClosedCache.has(key)) return __sgfClosedCache.get(key);
    const v = getClosedReconSet().has(key);
    __sgfClosedCache.set(key, v);
    return v;
  }

  function lockInfoForMovement(m, accountsMetaById = null) {
    if (!m) return { locked: false, period: '', accounts: [] };
    const p = String(m.period || '').trim() || isoToPeriod(String(m.date || ''));
    const ids = [];
    const a1 = Number(m.account_id) || 0;
    const a2 = Number(m.account_to_id) || 0;
    if (a1 && isPeriodClosedForAccount(a1, p)) ids.push(a1);
    if (a2 && isPeriodClosedForAccount(a2, p)) ids.push(a2);

    const uniq = Array.from(new Set(ids));
    const names = (accountsMetaById && uniq.length)
      ? uniq.map(id => accountsMetaById.get(id)?.name || `Cuenta #${id}`)
      : uniq.map(id => `Cuenta #${id}`);

    return {
      locked: uniq.length > 0,
      period: p,
      accounts: uniq,
      accountNames: names,
    };
  }

  function buildLockedToast({ op, info }) {
    const perLabel = periodEs(info?.period);
    const acc = (info?.accountNames || []).join(', ');
    const base = `Mes cerrado (${perLabel}).`;
    if (op === 'delete') return `${base} No se puede eliminar este movimiento. Reabre la conciliación para: ${acc}.`;
    if (op === 'update') return `${base} No se puede editar este movimiento. Reabre la conciliación para: ${acc}.`;
    // create
    return `${base} No se pueden guardar movimientos en ese periodo. Reabre la conciliación para: ${acc}.`;
  }

  function assertNotClosedForOperation({ op, newMov = null, oldMov = null, accountsMetaById = null }) {
    // Update: si el movimiento original cae en mes cerrado, NO permitir moverlo.
    if (op === 'update' && oldMov) {
      const oldInfo = lockInfoForMovement(oldMov, accountsMetaById);
      if (oldInfo.locked) throw new Error(buildLockedToast({ op: 'update', info: oldInfo }));
    }
    // Delete: bloquea si cae en mes cerrado.
    if (op === 'delete' && oldMov) {
      const delInfo = lockInfoForMovement(oldMov, accountsMetaById);
      if (delInfo.locked) throw new Error(buildLockedToast({ op: 'delete', info: delInfo }));
    }
    // Create/Update: validar destino final.
    if (newMov) {
      const newInfo = lockInfoForMovement(newMov, accountsMetaById);
      if (newInfo.locked) throw new Error(buildLockedToast({ op: op === 'update' ? 'update' : 'create', info: newInfo }));
    }
  }

  function buildPeriodList({ monthsBack = 24, monthsForward = 12 } = {}) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + monthsForward, 1);
    const out = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      const p = `${cur.getFullYear()}-${pad2(cur.getMonth() + 1)}`;
      out.push(p);
      cur.setMonth(cur.getMonth() + 1);
    }
    // mostrar más reciente arriba
    return out.reverse();
  }

  function fillPeriodSelect(selectEl, selectedPeriod, { monthsBack = 24, monthsForward = 12, includeAll = false, allLabel = '(Todos)' } = {}) {
    if (!selectEl) return;
    const periods = buildPeriodList({ monthsBack, monthsForward });
    const uniq = new Set(periods);
    if (selectedPeriod && /^\d{4}-\d{2}$/.test(selectedPeriod) && !uniq.has(selectedPeriod)) {
      periods.unshift(selectedPeriod);
    }
    const opts = [];
    if (includeAll) opts.push(`<option value="">${allLabel}</option>`);
    opts.push(...periods.map(p => `<option value="${p}">${periodEs(p)}</option>`));
    selectEl.innerHTML = opts.join('');
    if (selectedPeriod) selectEl.value = selectedPeriod;
  }

  function daysInMonth(year, month1to12) {
    return new Date(year, month1to12, 0).getDate();
  }

  function alignDateToPeriod(dateISO, periodYYYYMM) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO || '')) return `${periodYYYYMM}-01`;
    const day = Number(dateISO.slice(8, 10)) || 1;
    const y = Number(periodYYYYMM.slice(0, 4));
    const m = Number(periodYYYYMM.slice(5, 7));
    const maxDay = daysInMonth(y, m);
    const d2 = pad2(Math.min(day, maxDay));
    return `${periodYYYYMM}-${d2}`;
  }

  function getAccounts() {
    return window.SGF.db.select(
      `SELECT a.id, a.name, a.currency, a.allow_negative, a.active,
              COALESCE(t.name,'') AS type_name
       FROM accounts a
       LEFT JOIN account_types t ON t.id=a.type_id
       WHERE a.active=1
       ORDER BY a.name COLLATE NOCASE`
    );
  }

  function getCategories() {
    return window.SGF.db.select(
      `SELECT id, name, parent_id, active FROM categories
       WHERE active=1
       ORDER BY name COLLATE NOCASE`
    );
  }

  // Construye etiquetas tipo "Padre > Hijo" para que en combos se entienda el árbol.
  function buildCategoryPathList(cats) {
    const byId = new Map(cats.map(c => [Number(c.id), c]));
    const memo = new Map();
    const norm = (v) => (v == null ? '' : String(v));

    function pathOf(id) {
      const nid = Number(id);
      if (!nid) return '';
      if (memo.has(nid)) return memo.get(nid);
      const n = byId.get(nid);
      if (!n) return '';
      const parentId = Number(n.parent_id || 0);
      const name = norm(n.name).trim();
      const p = parentId ? `${pathOf(parentId)} > ${name}` : name;
      memo.set(nid, p);
      return p;
    }

    const list = cats.map(c => ({ ...c, path: pathOf(c.id) }));
    list.sort((a, b) => (a.path || '').localeCompare((b.path || ''), 'es', { sensitivity: 'base' }));
    return list;
  }

  function isSplitActive() {
    const box = document.getElementById('mov-split-box');
    return !!(box && !box.classList.contains('hidden'));
  }

  function setAmountReadonly(readonly) {
    const amt = document.getElementById('mov-amount');
    if (!amt) return;
    amt.readOnly = !!readonly;
    amt.classList.toggle('bg-gray-100', !!readonly);
    amt.classList.toggle('cursor-not-allowed', !!readonly);
    if (!!readonly) {
      amt.setAttribute('aria-readonly', 'true');
    } else {
      amt.removeAttribute('aria-readonly');
    }
  }

  // Cuando Split está activo, el monto total se calcula automáticamente como la suma de filas.
  function recomputeAmountFromSplit() {
    if (!isSplitActive()) return;
    const rows = document.querySelectorAll('#mov-split-rows .mov-split-amt');
    let sum = 0;
    rows.forEach(inp => {
      const v = round2(inp?.value);
      if (Number.isFinite(v)) sum += Number(v || 0);
    });
    sum = round2(sum);
    const amt = document.getElementById('mov-amount');
    if (amt) amt.value = sum > 0 ? sum.toFixed(2) : '0.00';
  }

  function buildOptions(selectEl, items, { includeAll = false, allLabel = '(Todas)', emptyLabel = null } = {}) {
    if (!selectEl) return;
    const opts = [];
    if (includeAll) opts.push(`<option value="">${allLabel}</option>`);
    if (emptyLabel !== null) opts.push(`<option value="">${emptyLabel}</option>`);
    opts.push(
      ...items.map(it => `<option value="${it.id}">${it.name}${it.currency ? ` (${it.currency})` : ''}</option>`)
    );
    selectEl.innerHTML = opts.join('');
  }

  function getAccountBalance(accountId) {
    const id = Number(accountId);
    if (!id) return 0;

    // Nota: el "saldo inicial" ya se registra como movimiento (movements.is_opening=1)
    // y también se guarda en accounts.initial_balance. Para evitar duplicidad,
    // el saldo se calcula únicamente desde movements.
    const val = window.SGF.db.scalar(
      `SELECT COALESCE(SUM(
        CASE
          WHEN type='income' AND account_id=:id THEN amount
          WHEN type='expense' AND account_id=:id THEN -amount
          WHEN type='transfer' AND account_id=:id THEN -amount
          WHEN type='transfer' AND account_to_id=:id THEN COALESCE(amount_to, amount)
          ELSE 0
        END
      ),0) AS balance
      FROM movements`,
      { ':id': id }
    );
    return Number(val || 0);
  }

  function movementImpactForAccount(m, accountId) {
    const id = Number(accountId);
    if (!id) return 0;
    const amt = Number(m.amount || 0);
    if (!Number.isFinite(amt)) return 0;
    const credit = (m.amount_to == null ? amt : Number(m.amount_to || 0));
    if (m.type === 'income' && Number(m.account_id) === id) return +amt;
    if (m.type === 'expense' && Number(m.account_id) === id) return -amt;
    if (m.type === 'transfer') {
      if (Number(m.account_id) === id) return -amt;
      if (Number(m.account_to_id) === id) return +credit;
    }
    return 0;
  }

  function validateNoNegative({ newMov, oldMov = null, accountMeta }) {
    // Validar solo sobre cuenta origen (account_id) para expense/transfer
    if (!newMov || !newMov.account_id) return;
    const type = newMov.type;
    if (!(type === 'expense' || type === 'transfer')) return;

    const accId = Number(newMov.account_id);
    const meta = accountMeta.get(accId);
    if (!meta) return;
    if (Number(meta.allow_negative || 0) === 1) return;

    const current = getAccountBalance(accId);
    const oldImpact = oldMov ? movementImpactForAccount(oldMov, accId) : 0;
    const newImpact = movementImpactForAccount(newMov, accId);
    const projected = (current - oldImpact) + newImpact;
    if (projected < -0.00001) {
      const cur = meta.currency || 'CRC';
      const msg = `La cuenta no permite saldo negativo.\nSaldo disponible: ${formatMoney(current - oldImpact, cur)}\nSaldo proyectado: ${formatMoney(projected, cur)}`;
      throw new Error(msg);
    }
  }

  function parseMovFromModal() {
    const typeUi = document.getElementById('mov-type')?.value || 'Gasto';
    const dateCr = (document.getElementById('mov-date')?.value || '').trim();
    const parsedIso = crToISO(dateCr);
    const date = parsedIso || todayISO();
    if (dateCr && !parsedIso) {
      throw new Error('Fecha inválida. Usa formato dd/mm/aaaa.');
    }
    const periodInput = (document.getElementById('mov-period')?.value || '').trim();
    let period = periodInput || isoToPeriod(date);
    let finalDate = date;
    // coherencia: si el usuario eligió periodo, ajustamos la fecha al mismo mes
    if (periodInput && isoToPeriod(date) !== periodInput) {
      finalDate = alignDateToPeriod(date, periodInput);
      period = periodInput;
      const dateEl = document.getElementById('mov-date');
      if (dateEl) dateEl.value = isoToCR(finalDate);
    }

    const type = TYPE_MAP_UI_TO_DB[typeUi] || 'expense';
    const account_id = Number(document.getElementById('mov-account')?.value || 0);
    const account_to_id = Number(document.getElementById('mov-account-to')?.value || 0) || null;
    let amount = round2(document.getElementById('mov-amount')?.value);

    // v1.16: FX
    const accounts = getAccounts();
    const accById = new Map(accounts.map(a => [Number(a.id), a]));
    const fromCur = (accById.get(account_id)?.currency || 'CRC');
    const toCur = account_to_id ? (accById.get(Number(account_to_id))?.currency || 'CRC') : null;

    const fxRateEl = document.getElementById('mov-fx-rate');
    const amountToEl = document.getElementById('mov-amount-to');
    const baseCur = window.SGF.fx?.baseCurrency?.() || 'CRC';

    let currency = fromCur; // la moneda del movimiento sigue la cuenta origen
    let fx_rate = 1;
    let amount_to = null;

    if (type === 'transfer' && account_to_id) {
      if (toCur && toCur !== fromCur) {
        fx_rate = Number(fxRateEl?.value || 0);
        if (!Number.isFinite(fx_rate) || fx_rate <= 0) {
          const suggested = window.SGF.fx?.rate?.(finalDate, fromCur, toCur) || 0;
          fx_rate = Number(suggested || 0);
        }
        if (!Number.isFinite(fx_rate) || fx_rate <= 0) {
          throw new Error('Transferencia multi-moneda requiere tipo de cambio válido.');
        }
        amount_to = round2(Number(amount || 0) * fx_rate);
        if (amountToEl) amountToEl.value = Number(amount_to || 0).toFixed(2);
      } else {
        fx_rate = 1;
        amount_to = round2(amount);
        if (amountToEl) amountToEl.value = Number(amount_to || 0).toFixed(2);
      }
    }

    let base_amount = 0;

    const description = (document.getElementById('mov-desc')?.value || '').trim();
    const reference_url = (document.getElementById('mov-ref')?.value || '').trim();
    const attachments_text = (document.getElementById('mov-att')?.value || '').trim();

    const splitBox = document.getElementById('mov-split-box');
    const isSplit = splitBox && !splitBox.classList.contains('hidden');

    const category_id = isSplit ? null : (Number(document.getElementById('mov-category-single')?.value || 0) || null);

    const splits = [];
    if (isSplit) {
      document.querySelectorAll('#mov-split-rows tr').forEach(tr => {
        const cat = Number(tr.querySelector('.mov-split-cat')?.value || 0);
        const amt = round2(tr.querySelector('.mov-split-amt')?.value);
        if (cat && Number.isFinite(amt)) splits.push({ category_id: cat, amount: amt });
      });

      // Monto total se calcula automáticamente por la suma del split
      const sum = round2(splits.reduce((a, s) => a + Number(s.amount || 0), 0));
      amount = sum;
      const amtEl = document.getElementById('mov-amount');
      if (amtEl) amtEl.value = sum.toFixed(2);
    }

    
    // Recalcular montos derivados (v1.16)
    if (type === 'transfer' && account_to_id) {
      if (toCur && toCur !== fromCur) {
        amount_to = round2(Number(amount || 0) * Number(fx_rate || 0));
        const amountToEl2 = document.getElementById('mov-amount-to');
        if (amountToEl2) amountToEl2.value = Number(amount_to || 0).toFixed(2);
      } else {
        amount_to = round2(amount);
      }
    }
    const toBase = (currency === baseCur) ? 1 : (window.SGF.fx?.rate?.(finalDate, currency, baseCur) || 0);
    base_amount = round2(Number(amount || 0) * Number(toBase || 0));

return {
      type,
      date: finalDate,
      period,
      account_id,
      account_to_id,
      category_id,
      amount,
      currency,
      fx_rate,
      amount_to,
      base_amount,
      description,
      reference_url,
      attachments_text,
      is_split: isSplit ? 1 : 0,
      splits,
    };
  }

  function validateMov(m) {
    if (!m.account_id) throw new Error('Cuenta origen es requerida.');
    if (!m.date) throw new Error('Fecha es requerida.');
    if (!m.period) throw new Error('Periodo contable es requerido.');

    if (!Number.isFinite(m.amount)) throw new Error('Monto inválido.');
    if (m.amount <= 0) throw new Error('Monto debe ser mayor a 0.');

    if (m.type === 'transfer') {
      if (!m.account_to_id) throw new Error('Cuenta destino es requerida para transferencias.');
      // v1.16: transferencia multi-moneda requiere FX si monedas difieren
      const fromCur = window.SGF.db.scalar('SELECT currency FROM accounts WHERE id=:id', {':id': m.account_id}) || 'CRC';
      const toCur = window.SGF.db.scalar('SELECT currency FROM accounts WHERE id=:id', {':id': m.account_to_id}) || 'CRC';
      if (String(fromCur) !== String(toCur)) {
        if (!Number.isFinite(Number(m.fx_rate)) || Number(m.fx_rate) <= 0) {
          throw new Error('Transferencia multi-moneda requiere tipo de cambio.');
        }
        if (!Number.isFinite(Number(m.amount_to)) || Number(m.amount_to) <= 0) {
          throw new Error('Monto destino inválido (verifica tipo de cambio).');
        }
      }
      if (Number(m.account_to_id) === Number(m.account_id)) throw new Error('Cuenta destino debe ser distinta a cuenta origen.');
    }

    if (m.is_split) {
      if (!m.splits.length) throw new Error('Split activo: agrega al menos una fila.');
      const sum = round2(m.splits.reduce((a, s) => a + Number(s.amount || 0), 0));
      if (Math.abs(sum - m.amount) > 0.009) {
        throw new Error(`Split inválido: la suma (${sum.toFixed(2)}) debe coincidir con el monto (${m.amount.toFixed(2)}).`);
      }
    }
  }

  function fetchMovement(id) {
    const rows = window.SGF.db.select('SELECT * FROM movements WHERE id=:id', { ':id': Number(id) });
    return rows[0] || null;
  }

  function fetchSplits(movementId) {
    return window.SGF.db.select(
      'SELECT id, movement_id, category_id, amount FROM movement_splits WHERE movement_id=:id ORDER BY id',
      { ':id': Number(movementId) }
    );
  }

  function upsertMovement({ movementId = null } = {}) {
    const db = window.SGF.db;
    const now = new Date().toISOString();

    const accounts = getAccounts();
    const accountMeta = new Map(accounts.map(a => [Number(a.id), a]));

    const m = parseMovFromModal();
    validateMov(m);

    const old = movementId ? fetchMovement(movementId) : null;

    // v1.11: bloquear por conciliación cerrada
    assertNotClosedForOperation({
      op: movementId ? 'update' : 'create',
      newMov: m,
      oldMov: old,
      accountsMetaById: accountMeta,
    });
    validateNoNegative({ newMov: m, oldMov: old, accountMeta });

    if (movementId) {
      db.run(
        `UPDATE movements
         SET type=:t, date=:d, period=:p, account_id=:a, account_to_id=:to, category_id=:c,
             amount=:amt, currency=:cur, fx_rate=:fx, amount_to=:amt_to, base_amount=:base,
             description=:desc, reference_url=:ref, attachments_text=:att,
             is_split=:is_split, updated_at=:u
         WHERE id=:id`,
        {
          ':t': m.type,
          ':d': m.date,
          ':p': m.period,
          ':a': m.account_id,
          ':to': m.account_to_id,
          ':c': m.category_id,
            ':amt': m.amount,
            ':cur': m.currency || 'CRC',
            ':fx': Number(m.fx_rate || 1),
            ':amt_to': (m.amount_to == null ? null : Number(m.amount_to)),
            ':base': Number(m.base_amount || 0),
          ':desc': m.description || null,
          ':ref': m.reference_url || null,
          ':att': m.attachments_text || null,
          ':is_split': m.is_split,
          ':u': now,
          ':id': Number(movementId),
        }
      );

      // splits
      db.run('DELETE FROM movement_splits WHERE movement_id=:id', { ':id': Number(movementId) });
      if (m.is_split) {
        const stmt = window.SGF.sqlDb.prepare(
          'INSERT INTO movement_splits(movement_id,category_id,amount,created_at) VALUES (:m,:c,:a,:cr)'
        );
        m.splits.forEach(s => {
          stmt.bind({ ':m': Number(movementId), ':c': Number(s.category_id), ':a': Number(s.amount), ':cr': now });
          stmt.step();
          stmt.reset();
        });
        stmt.free();
      }
    } else {
      window.SGF.sqlDb.run('BEGIN');
      try {
        window.SGF.sqlDb.run(
          `INSERT INTO movements(type,date,period,account_id,account_to_id,category_id,amount,currency,fx_rate,amount_to,base_amount,description,reference_url,attachments_text,is_split,created_at)
           VALUES (:t,:d,:p,:a,:to,:c,:amt,:cur,:fx,:amt_to,:base,:desc,:ref,:att,:is_split,:cr)`,
          {
            ':t': m.type,
            ':d': m.date,
            ':p': m.period,
            ':a': m.account_id,
            ':to': m.account_to_id,
            ':c': m.category_id,
            ':amt': m.amount,
          ':cur': m.currency || 'CRC',
          ':fx': Number(m.fx_rate || 1),
          ':amt_to': (m.amount_to == null ? null : Number(m.amount_to)),
          ':base': Number(m.base_amount || 0),
            ':desc': m.description || null,
            ':ref': m.reference_url || null,
            ':att': m.attachments_text || null,
            ':is_split': m.is_split,
            ':cr': now,
          }
        );
        const newId = Number(db.scalar('SELECT last_insert_rowid() AS id') || 0);
        if (m.is_split && newId) {
          const stmt = window.SGF.sqlDb.prepare(
            'INSERT INTO movement_splits(movement_id,category_id,amount,created_at) VALUES (:m,:c,:a,:cr)'
          );
          m.splits.forEach(s => {
            stmt.bind({ ':m': newId, ':c': Number(s.category_id), ':a': Number(s.amount), ':cr': now });
            stmt.step();
            stmt.reset();
          });
          stmt.free();
        }
        window.SGF.sqlDb.run('COMMIT');
      } catch (e) {
        window.SGF.sqlDb.run('ROLLBACK');
        throw e;
      }
    }

    // persistir
    return window.SGF.db.save();
  }

  function deleteMovement(id) {
    const db = window.SGF.db;
    // v1.11: bloquear por conciliación cerrada
    const accounts = getAccounts();
    const meta = new Map(accounts.map(a => [Number(a.id), a]));
    const old = fetchMovement(id);
    assertNotClosedForOperation({ op: 'delete', oldMov: old, accountsMetaById: meta });
    db.run('DELETE FROM movements WHERE id=:id', { ':id': Number(id) });
    return db.save();
  }

  function readFilters() {
    const year = document.getElementById('mov-year-f')?.value || '';
    const month = document.getElementById('mov-month-f')?.value || '';
    const period = document.getElementById('mov-period-f')?.value || '';
    const typeUi = document.getElementById('mov-type-f')?.value || '';
    const accountId = document.getElementById('mov-account-f')?.value || '';
    const categoryId = document.getElementById('mov-category-f')?.value || '';
    const q = (document.getElementById('mov-q')?.value || '').trim();
    const groupBy = document.getElementById('mov-groupby-f')?.value || '';

    const type = typeUi ? (TYPE_MAP_UI_TO_DB[typeUi] || '') : '';

    // Normalización Año↔Mes↔Periodo
    let finalPeriod = period;
    let finalYear = year;
    let finalMonth = month;
    if (finalPeriod) {
      finalYear = finalPeriod.slice(0, 4);
      finalMonth = finalPeriod.slice(5, 7);
    } else {
      if (finalYear && finalMonth) finalPeriod = `${finalYear}-${finalMonth}`;
    }

    return { year: finalYear, month: finalMonth, period: finalPeriod, type, accountId, categoryId, q, groupBy };
  }

  function queryMovements(filters) {
    const where = [];
    const params = {};

    if (filters.period) {
      where.push('m.period = :p');
      params[':p'] = filters.period;
    } else {
      if (filters.year) {
        where.push("substr(m.date,1,4)=:y");
        params[':y'] = filters.year;
      }
      if (filters.month) {
        where.push("substr(m.date,6,2)=:mo");
        params[':mo'] = filters.month;
      }
    }

    if (filters.type) {
      where.push('m.type = :t');
      params[':t'] = filters.type;
    }

    if (filters.accountId) {
      where.push('(m.account_id = :acc OR m.account_to_id = :acc)');
      params[':acc'] = Number(filters.accountId);
    }

    if (filters.categoryId) {
      // coincide por categoría directa o por split
      where.push('(m.category_id = :cat OR EXISTS (SELECT 1 FROM movement_splits s WHERE s.movement_id=m.id AND s.category_id=:cat))');
      params[':cat'] = Number(filters.categoryId);
    }

    if (filters.q) {
      where.push(`(
        COALESCE(m.description,'') LIKE :q
        OR COALESCE(a1.name,'') LIKE :q
        OR COALESCE(a2.name,'') LIKE :q
        OR COALESCE(c.name,'') LIKE :q
      )`);
      params[':q'] = `%${filters.q}%`;
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    if (!filters.groupBy) {
      return window.SGF.db.select(
        `SELECT m.*, 
                a1.name AS account_name, a1.currency AS account_currency,
                a2.name AS account_to_name, a2.currency AS account_to_currency,
                c.name AS category_name
         FROM movements m
         LEFT JOIN accounts a1 ON a1.id=m.account_id
         LEFT JOIN accounts a2 ON a2.id=m.account_to_id
         LEFT JOIN categories c ON c.id=m.category_id
         ${whereSql}
         ORDER BY m.date DESC, m.id DESC`,
        params
      );
    }

    if (filters.groupBy === 'period') {
      return window.SGF.db.select(
        `SELECT m.period AS grp, COUNT(*) AS qty, SUM(m.amount) AS total
         FROM movements m
         ${whereSql}
         GROUP BY m.period
         ORDER BY m.period DESC`,
        params
      ).map(r => ({ kind: 'group', groupBy: 'period', ...r }));
    }

    if (filters.groupBy === 'account') {
      return window.SGF.db.select(
        `SELECT a1.id AS acc_id, a1.name AS grp, a1.currency AS currency, COUNT(*) AS qty, SUM(m.amount) AS total
         FROM movements m
         LEFT JOIN accounts a1 ON a1.id=m.account_id
         ${whereSql}
         GROUP BY a1.id, a1.name, a1.currency
         ORDER BY a1.name COLLATE NOCASE`,
        params
      ).map(r => ({ kind: 'group', groupBy: 'account', ...r }));
    }

    if (filters.groupBy === 'category') {
      return window.SGF.db.select(
        `SELECT COALESCE(c.name,'(Sin categoría)') AS grp, COUNT(*) AS qty, SUM(m.amount) AS total
         FROM movements m
         LEFT JOIN categories c ON c.id=m.category_id
         ${whereSql}
         GROUP BY COALESCE(c.name,'(Sin categoría)')
         ORDER BY grp COLLATE NOCASE`,
        params
      ).map(r => ({ kind: 'group', groupBy: 'category', ...r }));
    }

    return [];
  }

  function renderMovTable(rows, { groupBy = '' } = {}) {
    const tbody = document.getElementById('mov-table-body');
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = `
        <tr><td class="p-6 text-gray-500" colspan="10">Sin movimientos para los filtros seleccionados.</td></tr>
      `;
      return;
    }

    const html = rows.map(r => {
      if (r.kind === 'group') {
        const label = r.grp;
        const qty = Number(r.qty || 0);
        const total = Number(r.total || 0);
        return `
          <tr class="border-b bg-gray-50">
            <td class="p-3">
              <span class="text-xs text-gray-500">Grupo</span>
            </td>
            <td class="p-3 text-xs text-gray-400">-</td>
            <td class="p-3 text-sm">-</td>
            <td class="p-3 text-sm">${groupBy === 'period' ? periodEs(label) : '-'}</td>
            <td class="p-3"><span class="px-2 py-0.5 rounded text-xs font-bold bg-gray-200 text-gray-700">${groupBy}</span></td>
            <td class="p-3 text-sm">${groupBy === 'account' ? label : '-'}</td>
            <td class="p-3 text-sm">-</td>
            <td class="p-3 text-sm">${groupBy === 'category' ? label : '-'}</td>
            <td class="p-3 text-sm text-gray-500">${qty} movimientos</td>
            <td class="p-3 text-sm font-semibold">${formatNumber2(total)}</td>
          </tr>
        `;
      }

      const lock = lockInfoForMovement(r);
      const isLocked = !!lock.locked;

      const typeUi = TYPE_MAP_DB_TO_UI[r.type] || r.type;
      const badge = typeUi === 'Gasto'
        ? 'bg-red-50 text-red-700'
        : typeUi === 'Ingreso'
          ? 'bg-green-50 text-green-700'
          : 'bg-blue-50 text-blue-700';

      const catLabel = r.is_split ? 'Split' : (r.category_name || '-');
      const curFrom = (r.currency || r.account_currency || 'CRC');
      const curTo = (r.account_to_currency || curFrom);
      const isFxTransfer = (String(r.type||'') === 'transfer') && (curFrom !== curTo) && (r.amount_to !== null && r.amount_to !== undefined);
      const amtTxt = isFxTransfer
        ? `<div class="leading-tight" title="FX ${formatNumber6 ? formatNumber6(r.fx_rate||0) : (r.fx_rate||0)}">${formatMoney(r.amount || 0, curFrom)} <span class="text-gray-400">→</span> ${formatMoney(r.amount_to || 0, curTo)}</div>`
        : `${formatMoney(r.amount || 0, curFrom)}`;

      const closedBadge = isLocked
        ? `<span class="ml-2 px-2 py-0.5 rounded bg-gray-200 text-gray-700 text-xs font-bold" title="Conciliación cerrada">Mes cerrado</span>`
        : '';

      const editBtn = isLocked
        ? `<button type="button" class="text-gray-400 p-1 rounded cursor-not-allowed" disabled title="Mes cerrado: no editable">
             <i data-lucide="edit" class="w-4 h-4"></i>
           </button>`
        : `<button type="button" class="text-blue-600 hover:bg-blue-50 p-1 rounded" data-action="mov-edit" data-id="${r.id}" title="Editar">
             <i data-lucide="edit" class="w-4 h-4"></i>
           </button>`;

      const delBtn = isLocked
        ? `<button type="button" class="text-gray-400 p-1 rounded cursor-not-allowed" disabled title="Mes cerrado: no eliminable">
             <i data-lucide="trash" class="w-4 h-4"></i>
           </button>`
        : `<button type="button" class="text-red-600 hover:bg-red-50 p-1 rounded" data-action="mov-del" data-id="${r.id}" title="Eliminar">
             <i data-lucide="trash" class="w-4 h-4"></i>
           </button>`;

      return `
        <tr class="border-b hover:bg-gray-50 ${isLocked ? 'bg-gray-50/60' : ''}">
          <td class="p-3">
            <div class="flex gap-1">
              ${editBtn}
              ${delBtn}
            </div>
          </td>
          <td class="p-3 text-xs text-gray-400">#${r.id}</td>
          <td class="p-3 text-sm">${isoToCR(r.date)}</td>
          <td class="p-3 text-sm" title="${r.period}">${periodEs(r.period)}${closedBadge}</td>
          <td class="p-3"><span class="px-2 py-0.5 rounded text-xs font-bold ${badge}">${typeUi}</span></td>
          <td class="p-3 text-sm">${escapeHtmlSafe(r.account_name || '-')}</td>
          <td class="p-3 text-sm">${escapeHtmlSafe(r.account_to_name || '-')}</td>
          <td class="p-3 text-sm">${escapeHtmlSafe(catLabel)}</td>
          <td class="p-3 text-sm">${escapeHtmlSafe(r.description || '')}</td>
          <td class="p-3 text-sm font-semibold">${amtTxt}</td>
        </tr>
      `;
    }).join('');

    tbody.innerHTML = html;
    window.lucide?.createIcons?.();
  }

  function refreshMovimientos() {
    const f = readFilters();
    const rows = queryMovements(f);
    renderMovTable(rows, { groupBy: f.groupBy });
  }

  function wireFilters() {
    const yearSel = document.getElementById('mov-year-f');
    const monthSel = document.getElementById('mov-month-f');
    const periodEl = document.getElementById('mov-period-f');
    const typeSel = document.getElementById('mov-type-f');
    const accSel = document.getElementById('mov-account-f');
    const catSel = document.getElementById('mov-category-f');
    const groupSel = document.getElementById('mov-groupby-f');
    const qEl = document.getElementById('mov-q');

    if (yearSel && !yearSel.dataset.wired) {
      const yNow = new Date().getFullYear();
      const years = [];
      for (let y = yNow; y >= yNow - 5; y--) years.push({ id: String(y), name: String(y) });
      yearSel.innerHTML = [`<option value="">(Todos)</option>`, ...years.map(y => `<option value="${y.id}">${escapeHtmlSafe(y.name)}</option>`)].join('');
      yearSel.dataset.wired = '1';
    }
    if (monthSel && !monthSel.dataset.wired) {
      monthSel.innerHTML = [`<option value="">(Todos)</option>`, ...Array.from({ length: 12 }, (_, i) => {
        const m = pad2(i + 1);
        return `<option value="${m}">${m}</option>`;
      })].join('');
      monthSel.dataset.wired = '1';
    }
    if (typeSel && !typeSel.dataset.wired) {
      typeSel.innerHTML = [
        `<option value="">(Todos)</option>`,
        `<option>Gasto</option>`,
        `<option>Ingreso</option>`,
        `<option>Transferencia</option>`,
      ].join('');
      typeSel.dataset.wired = '1';
    }

    // Periodo contable (combo en español, rango configurable)
    if (periodEl && !periodEl.dataset.wired) {
      fillPeriodSelect(periodEl, '', { includeAll: true, allLabel: '(Todos)', monthsBack: 24, monthsForward: 0 });
      periodEl.dataset.wired = '1';
    }

    // cargar cuentas/categorías reales
    const accounts = getAccounts();
    buildOptions(accSel, accounts.map(a => ({ id: a.id, name: a.name, currency: a.currency })), { includeAll: true, allLabel: '(Todas)' });
    const cats = getCategories();
    const catPathList = buildCategoryPathList(cats);
    buildOptions(catSel, catPathList.map(c => ({ id: c.id, name: c.path })), { includeAll: true, allLabel: '(Todas)' });

    const debounce = (fn, ms) => {
      let t;
      return () => { clearTimeout(t); t = setTimeout(fn, ms); };
    };
    const refreshDebounced = debounce(refreshMovimientos, 200);

    yearSel?.addEventListener('change', () => {
      // si cambia año y hay periodo, limpiar periodo
      if (periodEl) periodEl.value = '';
      refreshMovimientos();
    });
    monthSel?.addEventListener('change', () => {
      if (periodEl) periodEl.value = '';
      refreshMovimientos();
    });
    periodEl?.addEventListener('change', () => {
      if (periodEl.value) {
        if (yearSel) yearSel.value = periodEl.value.slice(0, 4);
        if (monthSel) monthSel.value = periodEl.value.slice(5, 7);
      }
      refreshMovimientos();
    });
    typeSel?.addEventListener('change', refreshMovimientos);
    accSel?.addEventListener('change', refreshMovimientos);
    catSel?.addEventListener('change', refreshMovimientos);
    groupSel?.addEventListener('change', refreshMovimientos);
    qEl?.addEventListener('input', refreshDebounced);
  }

  function setupMovModalDynamic() {
    // Este método lo invoca modal.js al abrir mov_new.
    const accSel = document.getElementById('mov-account');
    const toSel = document.getElementById('mov-account-to');
    const catSel = document.getElementById('mov-category-single');
    const typeSel = document.getElementById('mov-type');
    const dateEl = document.getElementById('mov-date');
    const periodEl = document.getElementById('mov-period');
    const amountEl = document.getElementById('mov-amount');
    const balEl = document.getElementById('mov-account-balance');
    const curEl = document.getElementById('mov-currency');
    const destGroup = document.getElementById('mov-dest-group');

    // v1.16: FX multi-moneda (transferencias entre cuentas con distinta moneda)
    const fxBox = document.getElementById('mov-fx-box');
    const fxRateEl = document.getElementById('mov-fx-rate');
    const fxHintEl = document.getElementById('mov-fx-hint');
    const amountToEl = document.getElementById('mov-amount-to');

    if (!accSel || !catSel || !typeSel) return false;

    const ctx = window.SGF.modalContext || {};
    const movementId = ctx.movementId || null;
    let loadedMovement = null;

    const accounts = getAccounts();
    const accountMetaById = new Map(accounts.map(a => [Number(a.id), a]));
    const cats = getCategories();
    const catPathList = buildCategoryPathList(cats);

    // v1.11: UI bloqueo por cierre
    const modalBody = document.getElementById('modal-body');
    const modalSave = document.getElementById('modal-save');
    let hardLocked = false;
    let lastSoftLocked = false;

    function setSaveDisabled(disabled, title = '') {
      if (!modalSave) return;
      modalSave.disabled = !!disabled;
      modalSave.classList.toggle('opacity-50', !!disabled);
      modalSave.classList.toggle('cursor-not-allowed', !!disabled);
      modalSave.title = title || '';
    }

    function ensureLockBanner(msg) {
      if (!modalBody) return;
      let box = modalBody.querySelector('.sgf-locked-banner');
      if (!msg) {
        box?.remove();
        return;
      }
      if (!box) {
        box = document.createElement('div');
        box.className = 'sgf-locked-banner mb-3 px-3 py-2 rounded-lg bg-gray-100 text-gray-800 text-sm border flex items-start gap-2';
        box.innerHTML = `<i data-lucide="lock" class="w-4 h-4 mt-0.5"></i><div class="sgf-locked-text"></div>`;
        modalBody.prepend(box);
        window.lucide?.createIcons?.();
      }
      const txt = box.querySelector('.sgf-locked-text');
      if (txt) txt.textContent = msg;
    }

    function setHardLock(info) {
      hardLocked = true;
      const msg = buildLockedToast({ op: 'update', info });
      ensureLockBanner(msg);
      setSaveDisabled(true, msg);
      // deshabilitar controles dentro del cuerpo del modal
      modalBody?.querySelectorAll('input,select,textarea,button').forEach(el => {
        // permitir copiar texto si se desea, pero evitar cambios
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.readOnly = true;
        }
        el.setAttribute('disabled', 'disabled');
        el.classList.add('bg-gray-100', 'cursor-not-allowed');
      });
      toast(msg);
    }

    function computeSoftLockInfoFromForm() {
      const typeUi = (typeSel?.value || 'Gasto');
      const typeDb = TYPE_MAP_UI_TO_DB[typeUi] || 'expense';
      const p = String(periodEl?.value || '').trim();
      const a1 = Number(accSel?.value || 0);
      const a2 = (typeDb === 'transfer') ? Number(toSel?.value || 0) : 0;
      const m = { period: p, account_id: a1, account_to_id: a2 };
      return lockInfoForMovement(m, accountMetaById);
    }

    function applySoftLockFromForm() {
      if (hardLocked) return;
      const info = computeSoftLockInfoFromForm();
      if (info.locked) {
        const msg = buildLockedToast({ op: movementId ? 'update' : 'create', info });
        ensureLockBanner(msg);
        setSaveDisabled(true, msg);
        if (!lastSoftLocked) toast(msg);
        lastSoftLocked = true;
      } else {
        ensureLockBanner('');
        setSaveDisabled(false, '');
        lastSoftLocked = false;
      }
    }

    // opciones
    buildOptions(accSel, accounts.map(a => ({ id: a.id, name: (a.type_name ? `${a.type_name} > ${a.name}` : a.name), currency: a.currency })), { emptyLabel: '(Seleccione)' });
    buildOptions(toSel, accounts.map(a => ({ id: a.id, name: (a.type_name ? `${a.type_name} > ${a.name}` : a.name), currency: a.currency })), { emptyLabel: '(Seleccione)' });
    buildOptions(
      catSel,
      [{ id: '', name: '(Opcional)' }, ...catPathList.map(c => ({ id: c.id, name: c.path }))],
      { includeAll: false, emptyLabel: null }
    );

    // default fecha/periodo (UI CR)
    if (dateEl && !dateEl.value) dateEl.value = todayCR();
    const dateIsoForPeriod = crToISO(dateEl?.value || '') || todayISO();
    const defPeriod = isoToPeriod(dateIsoForPeriod);
    // llenar combo de periodo en español
    fillPeriodSelect(periodEl, (periodEl?.value || defPeriod));
    if (periodEl && !periodEl.value) periodEl.value = defPeriod;

    function syncDest() {
      const isTransfer = (typeSel.value || '').toLowerCase().includes('transfer');
      destGroup?.classList.toggle('hidden', !isTransfer);
    }

    function syncMeta() {
      const accId = Number(accSel.value || 0);
      const acc = accounts.find(a => Number(a.id) === accId);
      const cur = acc?.currency || 'CRC';
      if (curEl) curEl.value = cur;
      if (balEl) balEl.textContent = formatMoney(getAccountBalance(accId), cur);

      // cuando no es transferencia, limpiar destino
      if (destGroup?.classList.contains('hidden') && toSel) toSel.value = '';
      syncFx();
    }

    function syncFx() {
      if (!fxBox || !fxRateEl || !amountToEl) return;

      const isTransfer = (String(typeSel?.value || '').toLowerCase().includes('transfer'));
      const accId = Number(accSel?.value || 0);
      const toId = Number(toSel?.value || 0);

      if (!isTransfer || !accId || !toId) {
        fxBox.classList.add('hidden');
        fxRateEl.value = '';
        amountToEl.value = '0.00';
        return;
      }

      const fromCur = (accountMetaById.get(accId)?.currency || 'CRC');
      const toCur = (accountMetaById.get(toId)?.currency || 'CRC');

      if (fromCur === toCur) {
        fxBox.classList.add('hidden');
        fxRateEl.value = '';
        // destino igual a origen
        const amt = round2(document.getElementById('mov-amount')?.value);
        amountToEl.value = Number(amt || 0).toFixed(2);
        return;
      }

      fxBox.classList.remove('hidden');

      // sugerir tasa (origen -> destino) usando histórico USD<->CRC
      const dateIso = crToISO(dateEl?.value || '') || (new Date()).toISOString().slice(0,10);
      const suggested = window.SGF.fx?.rate?.(dateIso, fromCur, toCur) || 0;

      if (suggested > 0 && (!fxRateEl.value || Number(fxRateEl.value) <= 0)) {
        fxRateEl.value = Number(suggested).toFixed(4);
      }
      if (fxHintEl) fxHintEl.textContent = `Sugerido para ${isoToCR(dateIso)}: ${fromCur} → ${toCur}`;

      const amt = Number(round2(document.getElementById('mov-amount')?.value) || 0);
      const r = Number(fxRateEl.value || 0);
      amountToEl.value = Number(amt * (r || 0)).toFixed(2);
    }


    typeSel.addEventListener('change', () => {
      syncDest();
      syncMeta();
      applySoftLockFromForm();
    });
    accSel.addEventListener('change', () => {
      syncMeta();
      applySoftLockFromForm();
    });
    toSel?.addEventListener('change', () => { applySoftLockFromForm(); syncFx(); });
    amountEl?.addEventListener('input', () => { syncFx(); applySoftLockFromForm(); });
    fxRateEl?.addEventListener('input', () => { syncFx(); applySoftLockFromForm(); });

    dateEl?.addEventListener('change', () => {
      const iso = crToISO(dateEl.value);
      if (!iso) return;
      const p = isoToPeriod(iso);
      if (periodEl) {
        fillPeriodSelect(periodEl, p);
        periodEl.value = p;
      }
      applySoftLockFromForm();
    });

    // Si cambia periodo, alinear fecha al mismo mes para evitar desfase (enero guardando febrero)
    periodEl?.addEventListener('change', () => {
      const p = String(periodEl.value || '');
      if (!/^\d{4}-\d{2}$/.test(p) || !dateEl) return;
      const curIso = crToISO(dateEl.value) || todayISO();
      const aligned = alignDateToPeriod(curIso, p);
      dateEl.value = isoToCR(aligned);
      applySoftLockFromForm();
    });

    // Split: poblar combos en filas cuando aparezcan
    const splitBox = document.getElementById('mov-split-box');
    const splitRows = document.getElementById('mov-split-rows');
    const splitAdd = document.getElementById('mov-split-add');
    const splitToggle = document.getElementById('mov-split-toggle');
    const singleCat = document.getElementById('mov-category-single');

    function createSplitRow() {
      if (!splitRows) return null;
      const tr = document.createElement('tr');
      tr.className = 'border-b';
      tr.innerHTML = `
        <td class="p-2">
          <select class="mov-split-cat w-full p-2 border rounded-lg text-sm"></select>
        </td>
        <td class="p-2">
          <input type="number" step="0.01" class="mov-split-amt w-full p-2 border rounded-lg text-sm" placeholder="0.00" />
        </td>
        <td class="p-2">
          <button type="button" class="mov-split-del text-red-600 hover:bg-red-50 p-1 rounded" title="Eliminar fila">
            <i data-lucide="trash" class="w-4 h-4"></i>
          </button>
        </td>
      `;
      tr.querySelector('.mov-split-del')?.addEventListener('click', () => {
        tr.remove();
        recomputeAmountFromSplit();
      });
      splitRows.appendChild(tr);
      if (window.lucide?.createIcons) window.lucide.createIcons();
      return tr;
    }

    function fillSplitRow(tr) {
      const sel = tr.querySelector('.mov-split-cat');
      if (!sel) return;
      sel.innerHTML = catPathList.map(c => `<option value="${c.id}">${escapeHtmlSafe(c.path)}</option>`).join('');
    }

    function addRowIfNeeded() {
      if (!splitRows) return;
      if (splitRows.children.length === 0) {
        const tr = createSplitRow();
        if (tr) fillSplitRow(tr);
      }
      // poblar selects
      splitRows.querySelectorAll('tr').forEach(fillSplitRow);
    }

    // Split: wiring por delegación global (wireSplitDelegation) para evitar pérdida/duplicación de handlers
    // (no registrar listeners directos aquí)

    // Edit mode: cargar datos
    if (movementId) {
      const m = fetchMovement(movementId);
      if (m) {
        loadedMovement = m;
        // titulo
        const titleEl = document.getElementById('modal-title');
        if (titleEl) titleEl.textContent = 'Editar Movimiento';

        typeSel.value = TYPE_MAP_DB_TO_UI[m.type] || 'Gasto';
        if (dateEl) dateEl.value = isoToCR(m.date);
        if (periodEl) {
          fillPeriodSelect(periodEl, m.period);
          periodEl.value = m.period;
        }
        if (amountEl) amountEl.value = Number(m.amount || 0).toFixed(2);
        document.getElementById('mov-desc').value = m.description || '';
        document.getElementById('mov-ref').value = m.reference_url || '';
        document.getElementById('mov-att').value = m.attachments_text || '';

        accSel.value = String(m.account_id);
        syncDest();
        if (toSel) toSel.value = m.account_to_id ? String(m.account_to_id) : '';

        if (Number(m.is_split || 0) === 1) {
          // activar split
          if (splitBox?.classList.contains('hidden')) splitToggle?.click();
          const splits = fetchSplits(movementId);
          // limpiar filas actuales
          if (splitRows) splitRows.innerHTML = '';
          splits.forEach(s => {
            const tr = createSplitRow();
            if (!tr) return;
            fillSplitRow(tr);
            tr.querySelector('.mov-split-cat').value = String(s.category_id);
            tr.querySelector('.mov-split-amt').value = Number(s.amount || 0).toFixed(2);
          });
          // monto total calculado por split
          setAmountReadonly(true);
          recomputeAmountFromSplit();
        } else {
          // categoría simple
          catSel.innerHTML = `<option value="">(Opcional)</option>` + catPathList.map(c => `<option value="${c.id}">${escapeHtmlSafe(c.path)}</option>`).join('');
          catSel.value = m.category_id ? String(m.category_id) : '';
          setAmountReadonly(false);
        }
      }
    } else {
      // defaults
      catSel.innerHTML = `<option value="">(Opcional)</option>` + catPathList.map(c => `<option value="${c.id}">${escapeHtmlSafe(c.path)}</option>`).join('');
    }

    // Date picker (dd/mm/aaaa) para Nuevo/Editar
    initCRDatePicker(dateEl);

    // init
    syncDest();
    syncMeta();
    // Ensure split delegation is wired.  When the movimientos module is mounted, the
    // global delegation should already be attached, but if the modal is opened
    // from outside the movimientos section or the delegation was not yet bound,
    // calling this again will bind it.  wireSplitDelegation() internally
    // tracks whether it has been applied and will no‑op on subsequent calls.
    try {
      if (typeof wireSplitDelegation === 'function') {
        wireSplitDelegation();
      }
    } catch (_) {}

    // v1.11: aplicar bloqueo por cierre (hard lock en edición, soft lock en nuevo/edición)
    try {
      if (movementId && loadedMovement) {
        const info = lockInfoForMovement(loadedMovement, accountMetaById);
        if (info.locked) {
          setHardLock(info);
        } else {
          applySoftLockFromForm();
        }
      } else {
        applySoftLockFromForm();
      }
    } catch (_) {}
    return true;
  }

  function wireTableActions() {
    // Delegación para edit/delete
    if (document.body.dataset.movWired) return;
    document.body.dataset.movWired = '1';
    document.addEventListener('click', async (e) => {
      const btn = e.target?.closest?.('button[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      if (action === 'mov-edit') {
        const id = Number(btn.getAttribute('data-id'));
        openModal('mov_new', { movementId: id });
      }
      if (action === 'mov-del') {
        const id = Number(btn.getAttribute('data-id'));

        // v1.11: bloqueo por cierre antes de pedir confirmación
        try {
          const accounts = getAccounts();
          const meta = new Map(accounts.map(a => [Number(a.id), a]));
          const m = fetchMovement(id);
          const info = lockInfoForMovement(m, meta);
          if (info.locked) {
            toast(buildLockedToast({ op: 'delete', info }));
            return;
          }
        } catch (_) {}

        const ok = await window.SGF.uiConfirm?.({
          title: 'Eliminar movimiento',
          message: '¿Eliminar este movimiento? Esta acción es irreversible.',
          confirmText: 'Eliminar',
          cancelText: 'Cancelar',
          danger: true,
        });
        if (ok) {
          try {
            await deleteMovement(id);
            refreshMovimientos();
            toast('Movimiento eliminado');
          } catch (err) {
            console.error(err);
            let msg = err?.message || 'No se pudo eliminar.';
            if (String(msg || '').includes('MONTH_CLOSED')) {
              try {
                const accounts = getAccounts();
                const meta = new Map(accounts.map(a => [Number(a.id), a]));
                const m = fetchMovement(id);
                const info = lockInfoForMovement(m, meta);
                msg = buildLockedToast({ op: 'delete', info });
              } catch (_) {
                msg = 'Operación bloqueada: el mes está cerrado por conciliación.';
              }
            }
            toast(msg);
          }
        }
      }
    }, true);
  }

  // Delegación global para Split: asegura que "Activar Split" y "Agregar fila" funcionen
  // incluso si el wiring del modal no corre por timing/re-render.
  function wireSplitDelegation() {
    if (document.body.dataset.movSplitWired) return;
    document.body.dataset.movSplitWired = '1';

    document.addEventListener('click', (e) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;

      const toggle = el.closest('#mov-split-toggle');
      if (toggle) {
        e.preventDefault();
        const box = document.getElementById('mov-split-box');
        const rows = document.getElementById('mov-split-rows');
        const singleCat = document.getElementById('mov-category-single');
        if (!box) return;

        const willShow = box.classList.contains('hidden');
        box.classList.toggle('hidden');

        // Split ON => el monto total se calcula automáticamente por sumatoria
        setAmountReadonly(willShow);

        if (singleCat) {
          singleCat.disabled = willShow;
          singleCat.classList.toggle('bg-gray-100', willShow);
          singleCat.classList.toggle('cursor-not-allowed', willShow);
          if (willShow) singleCat.value = '';
        }

        if (willShow && rows) {
          const cats = buildCategoryPathList(getCategories());
          const ensureRow = () => {
            const tr = document.createElement('tr');
            tr.className = 'border-b';
            tr.innerHTML = `
              <td class="p-2"><select class="mov-split-cat w-full p-2 border rounded-lg text-sm"></select></td>
              <td class="p-2"><input type="number" step="0.01" class="mov-split-amt w-full p-2 border rounded-lg text-sm" placeholder="0.00" /></td>
              <td class="p-2">
                <button type="button" class="mov-split-del text-red-600 hover:bg-red-50 p-1 rounded" title="Eliminar fila">
                  <i data-lucide="trash" class="w-4 h-4"></i>
                </button>
              </td>`;
            tr.querySelector('.mov-split-del')?.addEventListener('click', () => {
              tr.remove();
              recomputeAmountFromSplit();
            });
            rows.appendChild(tr);
            const sel = tr.querySelector('.mov-split-cat');
            if (sel) sel.innerHTML = cats.map(c => `<option value="${c.id}">${escapeHtmlSafe(c.path)}</option>`).join('');

            // UX: si el usuario ya digitó un monto, precargarlo en la primera fila
            const amtEl = tr.querySelector('.mov-split-amt');
            const movAmt = Number(document.getElementById('mov-amount')?.value || 0);
            if (amtEl && movAmt > 0) amtEl.value = movAmt.toFixed(2);
            window.lucide?.createIcons?.();
          };

          if (rows.children.length === 0) ensureRow();
          rows.querySelectorAll('tr').forEach(tr => {
            const sel = tr.querySelector('.mov-split-cat');
            if (sel && !sel.children.length) {
              sel.innerHTML = cats.map(c => `<option value="${c.id}">${escapeHtmlSafe(c.path)}</option>`).join('');
            }
          });

          recomputeAmountFromSplit();
        }

        // Split OFF => devolver edición manual del monto
        if (!willShow) {
          // no recalculamos al desactivar; el usuario puede editar monto manualmente
        }
        return;
      }

      const add = el.closest('#mov-split-add');
      if (add) {
        e.preventDefault();
        const rows = document.getElementById('mov-split-rows');
        if (!rows) return;
        const cats = buildCategoryPathList(getCategories());
        const tr = document.createElement('tr');
        tr.className = 'border-b';
        tr.innerHTML = `
          <td class="p-2"><select class="mov-split-cat w-full p-2 border rounded-lg text-sm"></select></td>
          <td class="p-2"><input type="number" step="0.01" class="mov-split-amt w-full p-2 border rounded-lg text-sm" placeholder="0.00" /></td>
          <td class="p-2">
            <button type="button" class="mov-split-del text-red-600 hover:bg-red-50 p-1 rounded" title="Eliminar fila">
              <i data-lucide="trash" class="w-4 h-4"></i>
            </button>
          </td>`;
        tr.querySelector('.mov-split-del')?.addEventListener('click', () => {
          tr.remove();
          recomputeAmountFromSplit();
        });
        rows.appendChild(tr);
        const sel = tr.querySelector('.mov-split-cat');
        if (sel) sel.innerHTML = cats.map(c => `<option value="${c.id}">${escapeHtmlSafe(c.path)}</option>`).join('');
        window.lucide?.createIcons?.();
        recomputeAmountFromSplit();
        return;
      }
    }, true);

    // Recalcular monto total cuando el usuario cambia montos de split
    document.addEventListener('input', (e) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el) return;
      if (el.classList.contains('mov-split-amt')) {
        recomputeAmountFromSplit();
      }
    }, true);
  }

  // Handler modal Guardar
  window.SGF.modalHandlers = window.SGF.modalHandlers || {};
  window.SGF.modalHandlers.mov_new = async (ctx) => {
    const movementId = ctx?.movementId || null;
    try {
      await upsertMovement({ movementId });
      closeModal();
      refreshMovimientos();
      toast(movementId ? 'Movimiento actualizado' : 'Movimiento guardado');
    } catch (err) {
      console.error(err);
      let msg = (err && err.message) ? err.message : 'No se pudo guardar el movimiento.';
      // Si falló por trigger DB (MONTH_CLOSED), reconstruir mensaje claro
      if (String(msg || '').includes('MONTH_CLOSED')) {
        try {
          const accounts = getAccounts();
          const accountMeta = new Map(accounts.map(a => [Number(a.id), a]));
          const m = parseMovFromModal();
          const old = movementId ? fetchMovement(movementId) : null;
          const info = lockInfoForMovement((movementId ? old : m) || m, accountMeta);
          const op = movementId ? 'update' : 'create';
          msg = buildLockedToast({ op, info });
        } catch (_) {
          msg = 'Operación bloqueada: el mes está cerrado por conciliación.';
        }
      }
      toast(msg);
    }
  };

  // --- Recurrentes (v1.07.0) ---
  function getRecurringTemplates({ onlyActive = false } = {}) {
    const where = onlyActive ? 'WHERE r.active=1' : '';
    return window.SGF.db.select(`
      SELECT r.*, a.name AS account_name, a.currency AS account_currency,
             at.name AS account_to_name
      FROM recurring_movements r
      LEFT JOIN accounts a ON a.id=r.account_id
      LEFT JOIN accounts at ON at.id=r.account_to_id
      ${where}
      ORDER BY r.active DESC, r.name COLLATE NOCASE
    `);
  }

  function renderRecurringTable() {
    const tbody = document.getElementById('rec-table-body');
    if (!tbody) return;
    const rows = getRecurringTemplates();
    if (!rows.length) {
      tbody.innerHTML = `<tr><td class="p-3 text-sm text-gray-500" colspan="7">Sin plantillas.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const typeUi = normalizeTypeUi(r.type || 'expense');
      const badge = typeUi === 'Gasto' ? 'bg-red-50 text-red-700' : (typeUi === 'Ingreso' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700');
      const cur = r.account_currency || 'CRC';
      const acc = r.account_name || '-';
      const accTo = r.account_to_name ? ` → ${r.account_to_name}` : '';
      return `
        <tr class="border-b hover:bg-gray-50">
          <td class="p-2">
            <div class="flex gap-1">
              <button type="button" class="text-blue-600 hover:bg-blue-50 p-1 rounded" data-action="rec-edit" data-id="${r.id}" title="Editar">
                <i data-lucide="edit" class="w-4 h-4"></i>
              </button>
              <button type="button" class="text-red-600 hover:bg-red-50 p-1 rounded" data-action="rec-del" data-id="${r.id}" title="Eliminar">
                <i data-lucide="trash" class="w-4 h-4"></i>
              </button>
            </div>
          </td>
          <td class="p-2 font-medium">${escapeHtmlSafe(r.name || '')}</td>
          <td class="p-2"><span class="px-2 py-0.5 rounded text-xs font-bold ${badge}">${typeUi}</span></td>
          <td class="p-2">${escapeHtmlSafe(acc)}${escapeHtmlSafe(accTo)}</td>
          <td class="p-2">${Number(r.day || 1)}</td>
          <td class="p-2 font-semibold">${formatMoney(Number(r.amount || 0), cur)}</td>
          <td class="p-2">${Number(r.active || 0) ? 'Sí' : 'No'}</td>
        </tr>
      `;
    }).join('');
    window.lucide?.createIcons?.();
  }

  function clearRecForm() {
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('rec-id', '');
    set('rec-name', '');
    set('rec-type', 'Gasto');
    set('rec-day', '1');
    set('rec-amount', '');
    set('rec-desc', '');
    const active = document.getElementById('rec-active');
    if (active) active.checked = true;
    const cat = document.getElementById('rec-category');
    if (cat) cat.value = '';
    const acc = document.getElementById('rec-account');
    if (acc && acc.options.length) acc.selectedIndex = 0;
    const accTo = document.getElementById('rec-account-to');
    if (accTo) accTo.value = '';
    syncRecDestVisibility();
  }

  function syncRecDestVisibility() {
    const typeSel = document.getElementById('rec-type');
    const destGroup = document.getElementById('rec-dest-group');
    const isTransfer = (typeSel?.value || '').toLowerCase().includes('transfer');
    destGroup?.classList.toggle('hidden', !isTransfer);
    if (!isTransfer) {
      const accTo = document.getElementById('rec-account-to');
      if (accTo) accTo.value = '';
    }
  }

  function readRecForm() {
    const id = Number(document.getElementById('rec-id')?.value || 0) || null;
    const name = (document.getElementById('rec-name')?.value || '').trim();
    const typeUi = document.getElementById('rec-type')?.value || 'Gasto';
    const type = normalizeType(typeUi);
    const day = Number(document.getElementById('rec-day')?.value || 1);
    const account_id = Number(document.getElementById('rec-account')?.value || 0);
    const account_to_id = Number(document.getElementById('rec-account-to')?.value || 0) || null;
    const category_id = Number(document.getElementById('rec-category')?.value || 0) || null;
    const amount = round2(Number(document.getElementById('rec-amount')?.value || 0));
    const description = (document.getElementById('rec-desc')?.value || '').trim();
    const active = (document.getElementById('rec-active')?.checked ? 1 : 0);

    if (!name) throw new Error('Nombre requerido.');
    if (!account_id) throw new Error('Cuenta origen requerida.');
    if (!Number.isFinite(day) || day < 1 || day > 31) throw new Error('Día inválido (1-31).');
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Monto inválido.');
    if (type === 'transfer') {
      if (!account_to_id) throw new Error('Cuenta destino requerida para transferencias.');
      if (account_to_id === account_id) throw new Error('Cuenta destino debe ser distinta.');
    }

    return { id, name, type, day, account_id, account_to_id, category_id, amount, description, active };
  }

  async function upsertRecurringTemplate() {
    const r = readRecForm();
    const now = new Date().toISOString();
    if (r.id) {
      window.SGF.db.run(`
        UPDATE recurring_movements
        SET name=:n, type=:t, account_id=:a, account_to_id=:ato, category_id=:c,
            amount=:m, description=:d, day=:day, frequency='mensual', active=:ac, updated_at=:u
        WHERE id=:id
      `, {
        ':n': r.name, ':t': r.type, ':a': r.account_id, ':ato': r.account_to_id,
        ':c': r.category_id, ':m': r.amount, ':d': r.description || null,
        ':day': r.day, ':ac': r.active, ':u': now, ':id': r.id
      });
    } else {
      window.SGF.db.run(`
        INSERT INTO recurring_movements(name,type,account_id,account_to_id,category_id,amount,description,day,frequency,created_at,active)
        VALUES (:n,:t,:a,:ato,:c,:m,:d,:day,'mensual',:u,:ac)
      `, {
        ':n': r.name, ':t': r.type, ':a': r.account_id, ':ato': r.account_to_id,
        ':c': r.category_id, ':m': r.amount, ':d': r.description || null,
        ':day': r.day, ':u': now, ':ac': r.active
      });
    }
    await window.SGF.db.save();
    renderRecurringTable();
    clearRecForm();
    toast('Plantilla guardada.');
  }

  async function deleteRecurringTemplate(id) {
    const ok = await window.SGF.uiConfirm?.({
      title: 'Eliminar plantilla recurrente',
      message: '¿Eliminar esta plantilla? Esto no elimina movimientos ya generados.',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    window.SGF.db.run('DELETE FROM recurring_movements WHERE id=:id', { ':id': Number(id) });
    await window.SGF.db.save();
    renderRecurringTable();
    toast('Plantilla eliminada.');
  }

  function clampDay(period, day) {
    const y = Number(period.slice(0, 4));
    const m = Number(period.slice(5, 7));
    const last = new Date(y, m, 0).getDate();
    return Math.min(Math.max(1, Number(day) || 1), last);
  }async function generateRecurringForPeriod(period) {
  const p = String(period || '').trim();
  if (!/^\d{4}-\d{2}$/.test(p)) throw new Error('Periodo inválido.');

  const templates = getRecurringTemplates({ onlyActive: true });
  if (!templates.length) {
    toast('No hay plantillas activas.');
    return;
  }

  const accounts = getAccounts();
  const accountMetaById = new Map(accounts.map(a => [Number(a.id), a]));

  // Balance proyectado (para validar saldos no-negativos durante la generación)
  const meta = new Map();
  accounts.forEach(a => {
    meta.set(Number(a.id), {
      allow_negative: Number(a.allow_negative || 0),
      currency: a.currency || 'CRC',
      balance: Number(getAccountBalance(a.id) || 0),
    });
  });

  const baseCur = window.SGF.fx?.baseCurrency?.() || 'CRC';
  const now = new Date().toISOString();

  function computeFxFor(m) {
    const dateIso = String(m.date || '').slice(0, 10);
    const fromCur = (accountMetaById.get(Number(m.account_id))?.currency) || 'CRC';
    const toCur = m.account_to_id ? ((accountMetaById.get(Number(m.account_to_id))?.currency) || fromCur) : null;

    const cur = fromCur;
    let fx = 1;
    let amtTo = null;

    if (m.type === 'transfer' && m.account_to_id) {
      if (toCur && toCur !== cur) {
        fx = Number(window.SGF.fx?.rate?.(dateIso, cur, toCur) || 0);
        if (!Number.isFinite(fx) || fx <= 0) {
          const e = new Error(`Falta tipo de cambio para ${cur}→${toCur} en ${dateIso}.`);
          e.code = 'FX_MISSING';
          throw e;
        }
        amtTo = round2(Number(m.amount || 0) * fx);
      } else {
        fx = 1;
        amtTo = round2(Number(m.amount || 0));
      }
    }

    const toBase = (cur === baseCur) ? 1 : Number(window.SGF.fx?.rate?.(dateIso, cur, baseCur) || 0);
    const baseAmt = round2(Number(m.amount || 0) * Number(toBase || 0));

    return { currency: cur, fx_rate: fx, amount_to: amtTo, base_amount: baseAmt, to_currency: toCur || cur };
  }

  let created = 0, skipped = 0, blockedSaldo = 0, blockedCierre = 0, blockedFx = 0;

  for (const r of templates) {
    // evitar duplicados por (recurring_id, generated_period)
    const exists = Number(window.SGF.db.scalar(
      'SELECT COUNT(*) AS c FROM movements WHERE recurring_id=:rid AND generated_period=:p',
      { ':rid': r.id, ':p': p }
    ) || 0);
    if (exists > 0) { skipped++; continue; }

    const dd = pad2(clampDay(p, r.day));
    const date = `${p}-${dd}`;

    const m = {
      type: r.type,
      date,
      period: p,
      account_id: Number(r.account_id),
      account_to_id: r.account_to_id ? Number(r.account_to_id) : null,
      category_id: r.category_id ? Number(r.category_id) : null,
      amount: round2(Number(r.amount || 0)),
      description: (r.description || r.name || '').trim(),
      reference_url: null,
      attachments_text: null,
      is_split: 0,
    };

    // v1.11: bloquear por conciliación cerrada
    try {
      const info = lockInfoForMovement(m, accountMetaById);
      if (info.locked) { blockedCierre++; continue; }
    } catch (_) {}

    // Validar saldo no-negativo (proyectado)
    const metaA = meta.get(Number(m.account_id));
    if (metaA && (m.type === 'expense' || m.type === 'transfer') && !Number(metaA.allow_negative || 0)) {
      const projected = round2(Number(metaA.balance || 0) - Number(m.amount || 0));
      if (projected < -0.00001) { blockedSaldo++; continue; }
    }

    let fx;
    try {
      fx = computeFxFor(m);
    } catch (e) {
      if (String(e?.code || '').includes('FX_MISSING') || String(e?.message || '').includes('Falta tipo de cambio')) {
        blockedFx++;
        continue;
      }
      throw e;
    }

    try {
      window.SGF.db.run(`
        INSERT INTO movements(type,date,period,account_id,account_to_id,category_id,amount,currency,fx_rate,amount_to,base_amount,description,reference_url,attachments_text,is_split,is_opening,recurring_id,generated_period,created_at,updated_at)
        VALUES (:t,:d,:p,:a,:ato,:c,:m,:cur,:fx,:amt_to,:base,:desc,NULL,NULL,0,0,:rid,:gp,:now,NULL)
      `, {
        ':t': m.type,
        ':d': m.date,
        ':p': m.period,
        ':a': m.account_id,
        ':ato': m.account_to_id,
        ':c': m.category_id,
        ':m': m.amount,
        ':cur': fx.currency,
        ':fx': Number(fx.fx_rate || 1),
        ':amt_to': (fx.amount_to == null ? null : Number(fx.amount_to)),
        ':base': Number(fx.base_amount || 0),
        ':desc': m.description || null,
        ':rid': r.id,
        ':gp': p,
        ':now': now,
      });

      // actualizar balances proyectados
      if (metaA) {
        if (m.type === 'expense' || m.type === 'transfer') metaA.balance = round2(Number(metaA.balance || 0) - Number(m.amount || 0));
        if (m.type === 'income') metaA.balance = round2(Number(metaA.balance || 0) + Number(m.amount || 0));
      }
      if (m.type === 'transfer' && m.account_to_id) {
        const metaTo = meta.get(Number(m.account_to_id));
        const credit = (fx.amount_to == null ? Number(m.amount || 0) : Number(fx.amount_to || 0));
        if (metaTo) metaTo.balance = round2(Number(metaTo.balance || 0) + credit);
      }

      created++;
    } catch (e) {
      const msg = String(e?.message || e || '');
      if (msg.includes('MONTH_CLOSED')) { blockedCierre++; continue; }
      // constraint (duplicado)
      if (msg.toLowerCase().includes('constraint') || msg.toLowerCase().includes('unique')) { skipped++; continue; }
      console.error(e);
      skipped++;
    }
  }

  await window.SGF.db.save();
  refreshMovimientos();
  toast(`Recurrentes: generados ${created}, omitidos ${skipped}, bloqueados saldo ${blockedSaldo}, bloqueados cierre ${blockedCierre}, bloqueados FX ${blockedFx}.`);
}

  // Inicializar modal recurrentes al abrir
  function setupRecModalDynamic() {
    const accSel = document.getElementById('rec-account');
    const toSel = document.getElementById('rec-account-to');
    const catSel = document.getElementById('rec-category');
    const typeSel = document.getElementById('rec-type');
    const genPeriod = document.getElementById('rec-gen-period');

    const accounts = getAccounts();
    buildOptions(accSel, accounts.map(a => ({ id: a.id, name: (a.type_name ? `${a.type_name} > ${a.name}` : a.name), currency: a.currency })), { emptyLabel: '(Seleccione)' });
    buildOptions(toSel, accounts.map(a => ({ id: a.id, name: (a.type_name ? `${a.type_name} > ${a.name}` : a.name), currency: a.currency })), { emptyLabel: '(Seleccione)' });
    const cats = getCategories();
    const catPathList = buildCategoryPathList(cats);
    buildOptions(catSel, [{ id: '', name: '(Opcional)' }, ...catPathList.map(c => ({ id: c.id, name: c.path }))], { emptyLabel: null });

    fillPeriodSelect(genPeriod, isoToPeriod(todayISO()), { monthsBack: 24, monthsForward: 12, includeAll: false });

    typeSel?.addEventListener('change', syncRecDestVisibility);
    syncRecDestVisibility();

    document.getElementById('rec-new')?.addEventListener('click', (e) => {
      e.preventDefault();
      clearRecForm();
      toast('Formulario listo.');
    });

    document.getElementById('rec-gen-btn')?.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await generateRecurringForPeriod(genPeriod?.value);
      } catch (err) {
        toast(err?.message || 'No se pudo generar.');
      }
    });

    const tbody = document.getElementById('rec-table-body');
    if (tbody && !tbody.dataset.wired) {
      tbody.dataset.wired = '1';
      tbody.addEventListener('click', async (e) => {
        const btn = e.target?.closest?.('button[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const id = Number(btn.getAttribute('data-id') || 0);
        if (!id) return;
        if (action === 'rec-edit') {
          const r = window.SGF.db.select('SELECT * FROM recurring_movements WHERE id=:id', { ':id': id })[0];
          if (!r) return;
          document.getElementById('rec-id').value = r.id;
          document.getElementById('rec-name').value = r.name || '';
          document.getElementById('rec-type').value = normalizeTypeUi(r.type || 'expense');
          document.getElementById('rec-day').value = String(r.day || 1);
          document.getElementById('rec-account').value = String(r.account_id || '');
          document.getElementById('rec-account-to').value = r.account_to_id ? String(r.account_to_id) : '';
          document.getElementById('rec-category').value = r.category_id ? String(r.category_id) : '';
          document.getElementById('rec-amount').value = Number(r.amount || 0).toFixed(2);
          document.getElementById('rec-desc').value = r.description || '';
          document.getElementById('rec-active').checked = Number(r.active || 0) === 1;
          syncRecDestVisibility();
          toast('Editando plantilla.');
        }
        if (action === 'rec-del') {
          await deleteRecurringTemplate(id);
        }
      }, true);
    }

    renderRecurringTable();
    // defaults
    if (!document.getElementById('rec-day')?.value) document.getElementById('rec-day').value = '1';
    if (!document.getElementById('rec-type')?.value) document.getElementById('rec-type').value = 'Gasto';
    if (document.getElementById('rec-active')) document.getElementById('rec-active').checked = true;
    window.lucide?.createIcons?.();
  }

  window.SGF.modalHandlers.mov_rec = async () => {
    await upsertRecurringTemplate();
  };

  window.SGF.modules.movimientos = {
    setupMovModalDynamic,
    setupRecModalDynamic,
    invalidateClosures,
    refreshMovimientos,
    onMount() {
      // Asegurar sesión abierta
      wireFilters();
      wireTableActions();
      wireSplitDelegation();
      refreshMovimientos();
    }
  };
})();
