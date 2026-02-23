window.SGF = window.SGF || {};
window.SGF.modules = window.SGF.modules || {};
window.SGF.modalHandlers = window.SGF.modalHandlers || {};

(function () {
  const pad2 = (n) => String(n).padStart(2, '0');

  function toast(msg) {
    window.SGF?.ui?.toast?.(msg) || window.toast?.(msg);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function fmtMoney(n, cur) {
    const val = Number(n || 0);
    const num = (() => {
      try {
        return new Intl.NumberFormat('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
      } catch (_) {
        return val.toFixed(2);
      }
    })();
    if (cur === 'USD') return `$${num}`;
    if (cur === 'CRC') return `₡${num}`;
    return `${num} ${cur || ''}`.trim();
  }

  function periodEs(period) {
    const fn = window.SGF?.format?.periodEs;
    if (typeof fn === 'function') return fn(period);
    const p = String(period || '');
    if (p === '0000-00') return 'Recurrente';
    if (!/^\d{4}-\d{2}$/.test(p)) return p;
    const y = p.slice(0, 4);
    const m = Number(p.slice(5, 7));
    const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
    return `${meses[m - 1] || p} ${y}`;
  }

  function buildPeriodList({ monthsBack = 24, monthsForward = 12 } = {}) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + monthsForward, 1);
    const out = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      out.push(`${cur.getFullYear()}-${pad2(cur.getMonth() + 1)}`);
      cur.setMonth(cur.getMonth() + 1);
    }
    return out.reverse();
  }

  function fillPeriodSelect(selectEl, selectedPeriod, { includeAll = false, allLabel = '(Todos)' } = {}) {
    if (!selectEl) return;
    const periods = buildPeriodList({ monthsBack: 24, monthsForward: 12 });
    const uniq = new Set(periods);
    if (selectedPeriod && /^\d{4}-\d{2}$/.test(selectedPeriod) && !uniq.has(selectedPeriod)) periods.unshift(selectedPeriod);
    const opts = [];
    if (includeAll) opts.push(`<option value="">${allLabel}</option>`);
    opts.push(...periods.map(p => `<option value="${p}">${periodEs(p)}</option>`));
    selectEl.innerHTML = opts.join('');
    if (selectedPeriod) selectEl.value = selectedPeriod;
  }

  function getCategories() {
    return window.SGF.db.select(
      `SELECT id, name, parent_id, active FROM categories
       WHERE active=1
       ORDER BY name COLLATE NOCASE`
    );
  }

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
    return cats.map(c => ({ ...c, path: pathOf(c.id) || String(c.name || '') }));
  }

  function categorySubtreeIds(rootId, cats) {
    const rid = Number(rootId || 0);
    if (!rid) return [];
    const childrenByParent = new Map();
    cats.forEach(c => {
      const pid = Number(c.parent_id || 0);
      if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
      childrenByParent.get(pid).push(Number(c.id));
    });
    const out = [];
    const stack = [rid];
    const seen = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      const kids = childrenByParent.get(id) || [];
      kids.forEach(k => stack.push(k));
    }
    return out;
  }

  function readFilters() {
    return {
      period: document.getElementById('bud-period-f')?.value || '',
      type: document.getElementById('bud-type-f')?.value || '',
      categoryId: document.getElementById('bud-cat-f')?.value || '',
      currency: document.getElementById('bud-cur-f')?.value || '',
      active: document.getElementById('bud-active-f')?.value || '',
      q: (document.getElementById('bud-q')?.value || '').trim().toLowerCase(),
      showRecurring: !!document.getElementById('bud-show-rec')?.checked,
      onlyOver: !!document.getElementById('bud-only-over')?.checked,
    };
  }

  function loadBudgetsRaw({ showRecurring }) {
    const where = [];
    const params = {};
    if (!showRecurring) {
      where.push('(b.is_recurring=0 AND b.period != "0000-00")');
    }
    const sql = `
      SELECT b.*, c.name AS category_name, c.parent_id AS category_parent
      FROM budgets b
      LEFT JOIN categories c ON c.id=b.category_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY (CASE WHEN b.period='0000-00' THEN 0 ELSE 1 END) DESC,
               b.period DESC, b.type, b.currency, c.name COLLATE NOCASE
    `;
    return window.SGF.db.select(sql, params);
  }

  function resolveEffectiveBudgets(period, allBudgets) {
    // Devuelve lista para un periodo: específicos + recurrentes como fallback cuando no exista específico.
    const rec = allBudgets.filter(b => Number(b.is_recurring) === 1 || b.period === '0000-00');
    const spec = allBudgets.filter(b => b.period === period && Number(b.is_recurring) === 0);
    const keyOf = (b) => `${b.type}|${b.currency}|${Number(b.category_id)}`;
    const specKeys = new Set(spec.map(keyOf));
    const out = [...spec];
    rec.forEach(r => {
      if (!specKeys.has(keyOf(r))) {
        // No mutar el registro base (recurrente). Solo marcamos que se usa como fallback
        // para el periodo consultado y usamos ese periodo para cálculos (consumido / %).
        out.push({ ...r, _is_fallback: 1, _source_period: r.period, _effective_period: period });
      }
    });
    return out;
  }

  function computeConsumedForBudget(b, catsAll) {
    // Consumido por periodo y categoría (incluye hijos), usando movements y movement_splits.
    const period = String(b?._effective_period || b?.period || '');
    if (!period || period === '0000-00') return 0;
    const ids = categorySubtreeIds(b.category_id, catsAll);
    if (!ids.length) return 0;
    const inClause = ids.map((_, i) => `:c${i}`).join(',');
    const params = { ':p': period, ':t': b.type, };
    ids.forEach((id, i) => { params[`:c${i}`] = id; });

    // splits
    const s = window.SGF.db.scalar(
      `SELECT COALESCE(SUM(s.amount * CASE WHEN m.amount!=0 THEN (m.base_amount / m.amount) ELSE 0 END),0)
       FROM movements m
       JOIN movement_splits s ON s.movement_id=m.id
       WHERE m.period=:p AND m.type=:t AND m.is_split=1
         AND s.category_id IN (${inClause})`,
      params
    );
    // no-split
    const n = window.SGF.db.scalar(
      `SELECT COALESCE(SUM(m.base_amount),0)
       FROM movements m
       WHERE m.period=:p AND m.type=:t AND COALESCE(m.is_split,0)=0
         AND m.category_id IN (${inClause})`,
      params
    );
    const baseSum = Number(s || 0) + Number(n || 0);
    const baseCur = window.SGF.fx?.baseCurrency?.() || 'CRC';
    const secCur = window.SGF.fx?.secondaryCurrency?.() || 'USD';
    const budCur = String(b?.currency || baseCur).toUpperCase();

    if (budCur === String(secCur).toUpperCase() && baseCur === 'CRC' && secCur === 'USD') {
      const end = window.SGF.fx?.periodEndDate?.(period) || (period + '-01');
      const r = window.SGF.fx?.usdToCrc?.(end) || 0;
      return r > 0 ? (baseSum / r) : 0;
    }
    return baseSum;
  }

  function renderTable() {
    const tbody = document.getElementById('bud-table-body');
    if (!tbody) return;

    const filters = readFilters();
    const cats = buildCategoryPathList(getCategories()).sort((a,b)=>String(a.path||'').localeCompare(String(b.path||''),'es',{sensitivity:'base'}));
    const catsAll = cats;

    // construir lista efectiva según periodo seleccionado
    const all = loadBudgetsRaw({ showRecurring: true });
    const list = filters.period ? resolveEffectiveBudgets(filters.period, all) : all;

    const rows = list.filter(b => {
      if (filters.type && b.type !== filters.type) return false;
      if (filters.currency && b.currency !== filters.currency) return false;
      if (filters.active !== '' && String(b.active) !== String(filters.active)) return false;
      if (filters.categoryId && String(b.category_id) !== String(filters.categoryId)) return false;
      if (!filters.showRecurring && (Number(b.is_recurring) === 1 || b.period === '0000-00')) return false;
      return true;
    }).map(b => {
      const cat = cats.find(c => Number(c.id) === Number(b.category_id));
      const catLabel = cat?.path || b.category_name || '-';
      const used = computeConsumedForBudget(b, catsAll);
      const pct = b.amount > 0 ? Math.round((used / Number(b.amount)) * 100) : 0;
      return { ...b, catLabel, used, pct };
    }).filter(b => {
      if (filters.onlyOver) return Number(b.used) > Number(b.amount);
      return true;
    }).filter(b => {
      if (!filters.q) return true;
      return String(b.catLabel || '').toLowerCase().includes(filters.q);
    });

    tbody.innerHTML = rows.map(r => {
      const pct = Math.max(0, Math.min(999, Number(r.pct || 0)));
      const pctBar = Math.max(0, Math.min(100, pct));
      const typeUi = r.type === 'income' ? 'Ingreso' : 'Gasto';
      const typeBadge = r.type === 'income' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700';
      const recurringBadge = (Number(r.is_recurring) === 1 || r.period === '0000-00')
        ? '<span class="px-2 py-0.5 rounded bg-purple-100 text-purple-700 text-xs font-bold">Sí</span>'
        : (r._is_fallback ? '<span class="px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 text-xs font-bold">Fallback</span>' : '-');
      const activeBadge = Number(r.active) === 1
        ? '<span class="px-2 py-0.5 rounded bg-green-100 text-green-700 text-xs font-bold">Activo</span>'
        : '<span class="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-bold">Inactivo</span>';
      const periodLabel = r._is_fallback ? periodEs(filters.period) : (r.period === '0000-00' ? 'Recurrente' : periodEs(r.period));
      const periodTitle = r._is_fallback ? `${filters.period} (fallback de ${r._source_period || '0000-00'})` : r.period;
      return `
        <tr class="border-b hover:bg-gray-50">
          <td class="p-3">
            <div class="flex gap-1">
              <button type="button" class="text-blue-600 hover:bg-blue-50 p-1 rounded" data-action="bud-edit" data-id="${r.id}"><i data-lucide="edit" class="w-4 h-4"></i></button>
              ${r._is_fallback ? '' : `<button type="button" class="text-red-600 hover:bg-red-50 p-1 rounded" data-action="bud-del" data-id="${r.id}"><i data-lucide="trash" class="w-4 h-4"></i></button>`}
            </div>
          </td>
          <td class="p-3 text-xs text-gray-400">#${r.id}</td>
          <td class="p-3 text-sm" title="${periodTitle}">${periodLabel}</td>
          <td class="p-3"><span class="px-2 py-0.5 rounded text-xs font-bold ${typeBadge}">${typeUi}</span></td>
          <td class="p-3 text-sm">${r.catLabel}</td>
          <td class="p-3 text-sm font-semibold">${fmtMoney(r.amount, r.currency)}</td>
          <td class="p-3 text-sm">${fmtMoney(r.used, r.currency)}</td>
          <td class="p-3">
            <div class="flex items-center gap-2">
              <div class="w-28 bg-gray-200 rounded-full h-2 overflow-hidden">
                <div class="h-2 bg-blue-600" style="width:${pctBar}%"></div>
              </div>
              <span class="text-xs font-semibold text-gray-600">${pct}%</span>
            </div>
          </td>
          <td class="p-3 text-sm">${recurringBadge}</td>
          <td class="p-3 text-sm">${activeBadge}</td>
        </tr>
      `;
    }).join('');

    window.lucide?.createIcons?.();
  }

  function wireFilters() {
    const ids = ['bud-period-f','bud-type-f','bud-cat-f','bud-cur-f','bud-active-f','bud-q','bud-show-rec','bud-only-over'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const ev = (el.tagName === 'INPUT' && el.type === 'text') ? 'input' : 'change';
      el.addEventListener(ev, () => renderTable());
    });

    document.getElementById('bud-apply-rec')?.addEventListener('click', () => {
      (async () => {
        try {
          const period = document.getElementById('bud-period-f')?.value || '';
          if (!period) throw new Error('Selecciona un periodo para aplicar recurrentes.');

          const prev = previewRecurringApply(period);
          const toCreate = prev.toCreate || [];
          const skipped = prev.skipped || [];

          if (toCreate.length === 0) {
            toast(`No hay presupuestos recurrentes por aplicar en ${periodEs(period)}.`);
            return;
          }

          const sample = toCreate.slice(0, 8).map(x => `• ${x.label}`).join('\n');
          const more = toCreate.length > 8 ? `\n…y ${toCreate.length - 8} más` : '';
          const msg =
            `Periodo: ${periodEs(period)}\n` +
            `Se crearán: ${toCreate.length}\n` +
            `Se omitirán (ya existen): ${skipped.length}\n\n` +
            `Ejemplos:\n${sample}${more}`;

          const ok = await window.SGF.uiConfirm({
            title: 'Aplicar presupuestos recurrentes',
            message: msg,
            confirmText: 'Aplicar',
            cancelText: 'Cancelar',
          });
          if (!ok) return;

          const res = applyRecurringToPeriod(period) || { created: 0, skipped: 0 };
          toast(`Recurrentes aplicados: ${res.created} creados, ${res.skipped} omitidos.`);
          renderTable();
        } catch (e) {
          toast(e?.message || 'No se pudo aplicar recurrente.');
        }
      })();
    });

    // Delegación para editar/eliminar (solo una vez)
    if (!document._sgfBudDelegation) {
      document._sgfBudDelegation = true;
      document.addEventListener('click', (ev) => {
        const btn = ev.target?.closest?.('[data-action="bud-edit"],[data-action="bud-del"]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const id = Number(btn.getAttribute('data-id') || 0);
        if (!id) return;
        if (action === 'bud-edit') return openModal('bud_new', { id });
        if (action === 'bud-del') return deleteBudget(id);
      }, true);
    }
  }

  function fillCategorySelects() {
    const cats = buildCategoryPathList(getCategories()).sort((a,b)=>String(a.path||'').localeCompare(String(b.path||''),'es',{sensitivity:'base'}));
    const selF = document.getElementById('bud-cat-f');
    if (selF) {
      const cur = selF.value;
      selF.innerHTML = `<option value="">(Todas)</option>` + cats.map(c => `<option value="${c.id}">${c.path}</option>`).join('');
      if (cur) selF.value = cur;
    }
  }

  function applyRecurringToPeriod(period) {
    const db = window.SGF.sqlDb;
    if (!db) return;
    const rec = window.SGF.db.select('SELECT * FROM budgets WHERE (is_recurring=1 OR period="0000-00")');
    const now = nowIso();
    let created = 0;
    let skipped = 0;
    rec.forEach(r => {
      const exists = window.SGF.db.scalar(
        `SELECT COUNT(*) AS c FROM budgets WHERE period=:p AND type=:t AND category_id=:c AND currency=:cur AND is_recurring=0`,
        { ':p': period, ':t': r.type, ':c': r.category_id, ':cur': r.currency }
      );
      if (Number(exists || 0) > 0) { skipped++; return; }
      db.run(
        `INSERT INTO budgets(period,type,category_id,currency,amount,is_recurring,active,created_at)
         VALUES (:p,:t,:c,:cur,:a,0,:act,:dt)`,
        { ':p': period, ':t': r.type, ':c': r.category_id, ':cur': r.currency, ':a': r.amount, ':act': r.active, ':dt': now }
      );
      created++;
    });
    window.SGF.db.save?.();
    return { created, skipped };
  }

  function previewRecurringApply(period) {
    const cats = buildCategoryPathList(getCategories()).sort((a,b)=>String(a.path||'').localeCompare(String(b.path||''),'es',{sensitivity:'base'}));
    const catById = new Map(cats.map(c => [Number(c.id), c]));
    const rec = window.SGF.db.select('SELECT * FROM budgets WHERE (is_recurring=1 OR period="0000-00")');
    const toCreate = [];
    const skipped = [];
    rec.forEach(r => {
      const exists = window.SGF.db.scalar(
        `SELECT COUNT(*) AS c FROM budgets WHERE period=:p AND type=:t AND category_id=:c AND currency=:cur AND is_recurring=0`,
        { ':p': period, ':t': r.type, ':c': r.category_id, ':cur': r.currency }
      );
      const cat = catById.get(Number(r.category_id))?.path || r.category_id;
      const typeUi = r.type === 'income' ? 'Ingreso' : 'Gasto';
      const label = `${typeUi} | ${String(r.currency)} | ${cat}`;
      const item = { id: Number(r.id), label };
      if (Number(exists || 0) > 0) skipped.push(item);
      else toCreate.push(item);
    });
    return { toCreate, skipped };
  }

  async function deleteBudget(id) {
    // Usar confirm modal interno (evita window.confirm que puede estar bloqueado)
    const ok = await window.SGF.uiConfirm({
      title: 'Eliminar presupuesto',
      message: '¿Deseas eliminar este presupuesto? Esta acción es irreversible.',
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      danger: true,
    });
    if (!ok) return;
    try {
      window.SGF.sqlDb.run('DELETE FROM budgets WHERE id=:id', { ':id': id });
      await window.SGF.db.save?.();
      renderTable();
      toast('Presupuesto eliminado.');
    } catch (e) {
      toast(e?.message || 'No se pudo eliminar.');
    }
  }

  function setupBudgetModalDynamic() {
    // llenar selects y si viene id, cargar datos
    const cats = buildCategoryPathList(getCategories()).sort((a,b)=>String(a.path||'').localeCompare(String(b.path||''),'es',{sensitivity:'base'}));
    const periodSel = document.getElementById('bud-period');
    fillPeriodSelect(periodSel, '', { includeAll: false });
    const catSel = document.getElementById('bud-cat');
    if (catSel) catSel.innerHTML = cats.map(c => `<option value="${c.id}">${c.path}</option>`).join('');

    const ctx = window.SGF.modalContext || {};
    const id = Number(ctx.id || 0);
    if (id) {
      const b = window.SGF.db.select('SELECT * FROM budgets WHERE id=:id', { ':id': id })?.[0];
      if (b) {
        document.getElementById('bud-id').value = String(b.id);
        if (b.period && b.period !== '0000-00') periodSel.value = b.period;
        if (b.period === '0000-00' || Number(b.is_recurring) === 1) {
          // para recurrente: dejamos periodo en el actual pero marcamos checkbox
          document.getElementById('bud-rec').checked = true;
        }
        document.getElementById('bud-type').value = b.type;
        document.getElementById('bud-cat').value = String(b.category_id);
        document.getElementById('bud-cur').value = b.currency;
        document.getElementById('bud-amount').value = Number(b.amount || 0).toFixed(2);
        document.getElementById('bud-active').checked = Number(b.active) === 1;
        // ajustar título
        document.getElementById('modal-title').textContent = 'Editar Presupuesto';
      }
    } else {
      document.getElementById('modal-title').textContent = 'Nuevo Presupuesto';
      // periodo por defecto: actual
      const now = new Date();
      const p = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
      periodSel.value = p;
    }
  }

  window.SGF.modalHandlers.bud_new = async () => {
    const db = window.SGF.sqlDb;
    if (!db) throw new Error('DB no disponible.');

    const id = Number(document.getElementById('bud-id')?.value || 0);
    const isRec = !!document.getElementById('bud-rec')?.checked;
    const period = isRec ? '0000-00' : (document.getElementById('bud-period')?.value || '');
    const type = document.getElementById('bud-type')?.value || 'expense';
    const categoryId = Number(document.getElementById('bud-cat')?.value || 0);
    const currency = document.getElementById('bud-cur')?.value || 'CRC';
    const amount = Number(document.getElementById('bud-amount')?.value || 0);
    const active = document.getElementById('bud-active')?.checked ? 1 : 0;

    if (!period) throw new Error('Periodo es requerido.');
    if (!categoryId) throw new Error('Categoría es requerida.');
    if (!(amount > 0)) throw new Error('Monto debe ser mayor a 0.');

    const t = nowIso();
    if (id) {
      db.run(
        `UPDATE budgets
         SET period=:p, type=:t, category_id=:c, currency=:cur, amount=:a, is_recurring=:r, active=:act, updated_at=:u
         WHERE id=:id`,
        { ':p': period, ':t': type, ':c': categoryId, ':cur': currency, ':a': amount, ':r': isRec ? 1 : 0, ':act': active, ':u': t, ':id': id }
      );
      toast('Presupuesto actualizado.');
    } else {
      db.run(
        `INSERT INTO budgets(period,type,category_id,currency,amount,is_recurring,active,created_at)
         VALUES (:p,:t,:c,:cur,:a,:r,:act,:dt)`,
        { ':p': period, ':t': type, ':c': categoryId, ':cur': currency, ':a': amount, ':r': isRec ? 1 : 0, ':act': active, ':dt': t }
      );
      toast('Presupuesto guardado.');
    }
    await window.SGF.db.save?.();
    window.closeModal?.();
    renderTable();
  };

  function onMount() {
    // Periodo filter select
    fillPeriodSelect(document.getElementById('bud-period-f'), '', { includeAll: true });
    fillCategorySelects();
    wireFilters();
    renderTable();
  }

  window.SGF.modules.presupuestos = {
    onMount,
    setupBudgetModalDynamic,
  };
})();
