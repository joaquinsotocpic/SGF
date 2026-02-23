// Ahorros + Metas (v1.08.1)
// - Ahorro se modela como movimiento transfer con is_savings=1 y savings_kind=deposit|withdraw
// - Retiro puede referenciar un depósito vía savings_ref_id para controlar disponible por depósito

(function () {
  window.SGF = window.SGF || {};
  window.SGF.modules = window.SGF.modules || {};
  window.SGF.modalHandlers = window.SGF.modalHandlers || {};

  const fmt = window.SGF.format || {};
  const pad2 = fmt.pad2 || ((n) => (String(n).length === 1 ? `0${n}` : String(n)));
  const isoToCR = fmt.isoToCR || ((s) => s);
  const crToISO = fmt.crToISO || (() => null);
  const periodEs = fmt.periodEs || ((p) => p);

  
  // ---- Cierre de mes (blindaje UX) ----
  function isMonthClosedError(err) {
    const msg = String(err && (err.code || err.message || err) || '');
    return msg.includes('MONTH_CLOSED') || (err && err.code === 'MONTH_CLOSED');
  }

  function toastMonthClosed(err) {
    const meta = err && err.meta ? err.meta : null;
    const period = meta && meta.period ? meta.period : null;
    const accId = meta && meta.accountId ? meta.accountId : null;
    const label = (period ? `El mes ${period}` : 'Este mes') + (accId ? ` para la cuenta ${accId}` : '');
    toast(`Operación bloqueada: ${label} está cerrado por conciliación.`);
  }

  function guardAssertNotClosedForChange(op, oldMov, newMov) {
    try {
      if (window.SGF.closureGuard && window.SGF.closureGuard.assertNotClosedForChange) {
        window.SGF.closureGuard.assertNotClosedForChange(op, oldMov, newMov);
      }
    } catch (e) {
      // rethrow para que el caller maneje toast consistente
      throw e;
    }
  }

  function dbSelectMovementById(id) {
    return window.SGF.db.select('SELECT * FROM movements WHERE id=:id LIMIT 1', { ':id': Number(id) })[0] || null;
  }

function nowIso() {
    return new Date().toISOString();
  }

  function todayISO() {
    return fmt.todayISO ? fmt.todayISO() : new Date().toISOString().slice(0, 10);
  }

  function isoToPeriod(iso) {
    const s = String(iso || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    return s.slice(0, 7);
  }

  function round2(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100) / 100;
  }

  function formatNumber(n) {
    const v = Number(n || 0);
    try {
      return new Intl.NumberFormat('es-CR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
    } catch (_) {
      return v.toFixed(2);
    }
  }

  function formatMoney(amount, currency) {
    const n = Number(amount || 0);
    const sym = currency === 'USD' ? '$' : '₡';
    return `${sym}${formatNumber(n)}`;
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

  function fillPeriodSelect(selectEl, selectedPeriod, { includeAll = false, allLabel = '(Todos)', monthsBack = 24, monthsForward = 12 } = {}) {
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
    if (selectedPeriod != null) selectEl.value = selectedPeriod;
  }

  function buildCategoryPathList(cats) {
    const byId = new Map((cats || []).map(c => [Number(c.id), c]));
    const memo = new Map();

    function pathOf(id) {
      const nid = Number(id);
      if (!nid) return '';
      if (memo.has(nid)) return memo.get(nid);
      const n = byId.get(nid);
      if (!n) return '';
      const parentId = Number(n.parent_id || 0);
      const name = String(n.name || '').trim();
      const p = parentId ? `${pathOf(parentId)} > ${name}` : name;
      memo.set(nid, p);
      return p;
    }

    const list = (cats || []).map(c => ({ ...c, path: pathOf(c.id) }));
    list.sort((a, b) => (a.path || '').localeCompare((b.path || ''), 'es', { sensitivity: 'base' }));
    return list;
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
      `SELECT id, name, parent_id, active
       FROM categories
       WHERE active=1
       ORDER BY name COLLATE NOCASE`
    );
  }

  function getGoals() {
    return window.SGF.db.select(
      `SELECT id, name, currency, target, active, created_at
       FROM savings_goals
       ORDER BY active DESC, name COLLATE NOCASE`
    );
  }

  function movementCurrencyForSavings(m) {
    // Depósito: la moneda relevante es la cuenta destino (ahorros)
    // Retiro: la moneda relevante es la cuenta origen (ahorros)
    const kind = String(m?.savings_kind || 'deposit');
    if (kind === 'withdraw') return String(m?.account_currency || 'CRC');
    return String(m?.account_to_currency || m?.account_currency || 'CRC');
  }

  function computeGoalProgress(goals, savingsRows) {
    const map = new Map();
    (goals || []).forEach(g => {
      map.set(Number(g.id), { saved: 0, currency: String(g.currency || 'CRC'), target: Number(g.target || 0) });
    });
    (savingsRows || []).forEach(m => {
      const gid = Number(m.goal_id || 0);
      if (!gid || !map.has(gid)) return;
      const goal = map.get(gid);
      const cur = movementCurrencyForSavings(m);
      if (cur !== goal.currency) return; // mantener integridad por moneda
      const isWithdraw = String(m.savings_kind) === 'withdraw';
      const amt = isWithdraw
        ? Number(m.amount || 0)
        : (m.amount_to == null ? Number(m.amount || 0) : Number(m.amount_to || 0));
      if (!Number.isFinite(amt) || amt === 0) return;
      const delta = isWithdraw ? -amt : amt;
      goal.saved = round2(Number(goal.saved || 0) + delta);
    });
    return map;
  }

  function getSavingsMovements() {
    return window.SGF.db.select(
      `SELECT m.*, 
              a.name AS account_name, a.currency AS account_currency,
              at.name AS account_to_name, at.currency AS account_to_currency,
              c.name AS category_name,
              g.name AS goal_name
       FROM movements m
       LEFT JOIN accounts a ON a.id=m.account_id
       LEFT JOIN accounts at ON at.id=m.account_to_id
       LEFT JOIN categories c ON c.id=m.category_id
       LEFT JOIN savings_goals g ON g.id=m.goal_id
       WHERE COALESCE(m.is_savings,0)=1
       ORDER BY m.date DESC, m.id DESC`
    );
  }

  function getAccountBalance(accountId) {
    const id = Number(accountId);
    if (!id) return 0;
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

  function getSavingsAccountId(currency, accounts) {
    const cur = String(currency || 'CRC');
    const list = (accounts || getAccounts()).filter(a => String(a.currency) === cur);
    // preferir por nombre
    const preferredName = cur === 'USD' ? 'Ahorros Dólares' : 'Ahorros Colones';
    const byPref = list.find(a => String(a.name) === preferredName);
    if (byPref) return Number(byPref.id);
    // preferir tipo Ahorros
    const byType = list.find(a => String(a.type_name) === 'Ahorros' || String(a.name).toLowerCase().startsWith('ahorros'));
    if (byType) return Number(byType.id);
    return Number(list[0]?.id || 0);
  }

  function calcDepositRemaining(depositId) {
    const dep = window.SGF.db.select(
      "SELECT id, amount, amount_to FROM movements WHERE id=:id AND COALESCE(is_savings,0)=1 AND savings_kind='deposit' LIMIT 1",
      { ':id': Number(depositId) }
    )[0];
    if (!dep) return 0;
    const used = window.SGF.db.scalar(
      "SELECT COALESCE(SUM(amount),0) AS s FROM movements WHERE COALESCE(is_savings,0)=1 AND savings_kind='withdraw' AND savings_ref_id=:id",
      { ':id': Number(depositId) }
    );
    const depAmt = (dep.amount_to == null ? Number(dep.amount || 0) : Number(dep.amount_to || 0));
    return round2(depAmt - Number(used || 0));
  }

  // --------- Render UI ---------

  const state = {
    accounts: [],
    categories: [],
    goals: [],
    savings: [],
  };

  function buildOptions(selectEl, items, { includeAll = false, allLabel = '(Todas)', emptyLabel = null, labelKey = 'name' } = {}) {
    if (!selectEl) return;
    const opts = [];
    if (includeAll) opts.push(`<option value="">${allLabel}</option>`);
    if (emptyLabel !== null) opts.push(`<option value="">${emptyLabel}</option>`);
    opts.push(...(items || []).map(it => `<option value="${it.id}">${it[labelKey] ?? it.name}</option>`));
    selectEl.innerHTML = opts.join('');
  }

  function renderGoalsQuick() {
    const root = document.getElementById('sav-goals-quick');
    if (!root) return;
    const goals = state.goals || [];
    if (!goals.length) {
      root.innerHTML = `<div class="text-sm text-gray-500">No hay metas. Usa <b>Metas</b> para crear una.</div>`;
      return;
    }

    const progressByGoal = computeGoalProgress(goals, state.savings);

    root.innerHTML = goals.map(g => {
      const cur = g.currency || 'CRC';
      const prog = progressByGoal.get(Number(g.id))?.saved || 0;
      const target = Number(g.target || 0);
      const pct = target > 0 ? Math.max(0, Math.min(100, (prog / target) * 100)) : 0;
      const badge = cur === 'USD' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700';
      return `
        <div class="p-4 bg-gray-50 border rounded-xl">
          <div class="flex items-center justify-between gap-3">
            <p class="font-semibold truncate">${escapeHtml(g.name)}</p>
            <span class="text-xs px-2 py-0.5 rounded ${badge} font-bold">${escapeHtml(cur)}</span>
          </div>
          <p class="text-sm text-gray-500 mt-1">Progreso: ${formatNumber(prog)} / ${formatNumber(target)}</p>
          <div class="w-full bg-gray-200 rounded-full h-2 mt-2 overflow-hidden">
            <div class="h-2 bg-blue-600" style="width:${pct}%"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderSavingsTable(rows) {
    const tbody = document.getElementById('sav-table-body');
    if (!tbody) return;
    const list = rows || [];

    tbody.innerHTML = list.map(r => {
      const kind = String(r.savings_kind) === 'withdraw' ? 'Retiro' : 'Depósito';
      const kindCls = kind === 'Depósito' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700';
      const isWithdraw = String(r.savings_kind) === 'withdraw';
      const cur = isWithdraw
        ? (r.account_currency || r.account_to_currency || 'CRC')
        : (r.account_to_currency || r.account_currency || 'CRC');
      const dateCr = isoToCR(r.date);
      const cat = r.category_name || '-';
      const from = r.account_name || '-';
      const to = r.account_to_name || '-';
      const goal = r.goal_name || '-';
      const desc = r.description || '-';
      const amtNum = isWithdraw
        ? Number(r.amount || 0)
        : (r.amount_to == null ? Number(r.amount || 0) : Number(r.amount_to || 0));
      const amount = formatMoney(amtNum, cur);
      const showWithdraw = String(r.savings_kind) === 'deposit';
      return `
        <tr class="border-b hover:bg-gray-50">
          <td class="p-3">
            <div class="flex gap-1">
              <button class="text-blue-600 hover:bg-blue-50 p-1 rounded" onclick="window.SGF.modules.ahorros.openSavingsEdit(${Number(r.id)})" title="Editar">
                <i data-lucide="edit" class="w-4 h-4"></i>
              </button>
              ${showWithdraw ? `
              <button class="text-amber-600 hover:bg-amber-50 p-1 rounded" onclick="window.SGF.modules.ahorros.openSavingsWithdraw(${Number(r.id)})" title="Retirar">
                <i data-lucide="arrow-down-left" class="w-4 h-4"></i>
              </button>` : ''}
              <button class="text-red-600 hover:bg-red-50 p-1 rounded" onclick="window.SGF.modules.ahorros.deleteSavings(${Number(r.id)})" title="Eliminar">
                <i data-lucide="trash" class="w-4 h-4"></i>
              </button>
            </div>
          </td>
          <td class="p-3 text-xs text-gray-400">#${Number(r.id)}</td>
          <td class="p-3 text-sm">${escapeHtml(dateCr)}</td>
          <td class="p-3 text-sm">${escapeHtml(periodEs(r.period))}</td>
          <td class="p-3"><span class="px-2 py-0.5 rounded text-xs font-bold ${kindCls}">${kind}</span></td>
          <td class="p-3 text-sm">${escapeHtml(cat)}</td>
          <td class="p-3 text-sm">${escapeHtml(from)}</td>
          <td class="p-3 text-sm">${escapeHtml(to)}</td>
          <td class="p-3 text-sm">${escapeHtml(goal)}</td>
          <td class="p-3 text-sm">${escapeHtml(desc)}</td>
          <td class="p-3 text-sm font-semibold">${escapeHtml(amount)}</td>
        </tr>
      `;
    }).join('');

    window.lucide?.createIcons?.();
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function readFilters() {
    const year = document.getElementById('sav-year-f')?.value || '';
    const month = document.getElementById('sav-month-f')?.value || '';
    const period = document.getElementById('sav-period-f')?.value || '';
    const kind = document.getElementById('sav-kind-f')?.value || '';
    const account = document.getElementById('sav-account-f')?.value || '';
    const category = document.getElementById('sav-category-f')?.value || '';
    const goal = document.getElementById('sav-goal-f')?.value || '';
    const currency = document.getElementById('sav-currency-f')?.value || '';
    const q = (document.getElementById('sav-q')?.value || '').trim().toLowerCase();
    return { year, month, period, kind, account, category, goal, currency, q };
  }

  function applyFiltersAndRender() {
    const f = readFilters();
    let rows = [...(state.savings || [])];

    if (f.period) rows = rows.filter(r => String(r.period) === f.period);
    if (f.year) rows = rows.filter(r => String(r.period || '').slice(0, 4) === f.year);
    if (f.month) rows = rows.filter(r => String(r.period || '').slice(5, 7) === f.month);
    if (f.kind) rows = rows.filter(r => String(r.savings_kind) === f.kind);
    if (f.account) {
      const aid = Number(f.account);
      rows = rows.filter(r => Number(r.account_id) === aid || Number(r.account_to_id) === aid);
    }
    if (f.category) rows = rows.filter(r => String(r.category_id || '') === String(f.category));
    if (f.goal) rows = rows.filter(r => String(r.goal_id || '') === String(f.goal));
    if (f.currency) {
      rows = rows.filter(r => String(r.account_currency || r.account_to_currency || '') === f.currency);
    }
    if (f.q) {
      rows = rows.filter(r => {
        const hay = [r.description, r.account_name, r.account_to_name, r.category_name, r.goal_name]
          .filter(Boolean)
          .join(' | ')
          .toLowerCase();
        return hay.includes(f.q);
      });
    }

    renderSavingsTable(rows);
    renderGoalsQuick();
  }

  function setupFilters() {
    // ids
    const yearEl = document.getElementById('sav-year-f');
    const monthEl = document.getElementById('sav-month-f');
    const periodEl = document.getElementById('sav-period-f');
    const kindEl = document.getElementById('sav-kind-f');
    const accEl = document.getElementById('sav-account-f');
    const catEl = document.getElementById('sav-category-f');
    const goalEl = document.getElementById('sav-goal-f');
    const curEl = document.getElementById('sav-currency-f');
    const qEl = document.getElementById('sav-q');
    if (!yearEl || yearEl.dataset.bound === '1') return;

    // Years & months from periods
    const periods = buildPeriodList({ monthsBack: 24, monthsForward: 12 }).reverse();
    const years = Array.from(new Set(periods.map(p => p.slice(0, 4)))).sort((a, b) => b.localeCompare(a));
    yearEl.innerHTML = [`<option value="">(Todos)</option>`, ...years.map(y => `<option value="${y}">${y}</option>`)].join('');
    monthEl.innerHTML = [`<option value="">(Todos)</option>`, ...Array.from({ length: 12 }, (_, i) => {
      const m = pad2(i + 1);
      return `<option value="${m}">${m}</option>`;
    })].join('');

    fillPeriodSelect(periodEl, '', { includeAll: true, allLabel: '(Todos)' });

    kindEl.innerHTML = [
      `<option value="">(Todos)</option>`,
      `<option value="deposit">Depósito</option>`,
      `<option value="withdraw">Retiro</option>`,
    ].join('');

    // Account filter
    const accOpts = [`<option value="">(Todas)</option>`].concat(
      state.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.currency)})</option>`)
    );
    accEl.innerHTML = accOpts.join('');

    // Category filter: show paths
    const catPaths = buildCategoryPathList(state.categories);
    const catOpts = [`<option value="">(Todas)</option>`, `<option value="__none__">(Sin categoría)</option>`].concat(
      catPaths.map(c => `<option value="${c.id}">${escapeHtml(c.path)}</option>`)
    );
    catEl.innerHTML = catOpts.join('');

    // Goals
    const goalOpts = [`<option value="">(Todas)</option>`, `<option value="__none__">(Sin meta)</option>`].concat(
      state.goals.map(g => `<option value="${g.id}">${escapeHtml(g.name)} (${escapeHtml(g.currency)})</option>`)
    );
    goalEl.innerHTML = goalOpts.join('');

    // Currency
    curEl.innerHTML = [`<option value="">(Todas)</option>`, `<option value="CRC">CRC</option>`, `<option value="USD">USD</option>`].join('');

    const onChange = () => {
      // Normalización Año ↔ Mes ↔ Periodo (si hay periodo, set year/month)
      if (periodEl.value) {
        yearEl.value = periodEl.value.slice(0, 4);
        monthEl.value = periodEl.value.slice(5, 7);
      } else if (yearEl.value && monthEl.value) {
        // si año+mes, forzar periodo
        const p = `${yearEl.value}-${monthEl.value}`;
        if (Array.from(periodEl.options).some(o => o.value === p)) periodEl.value = p;
      }
      applyFiltersAndRender();
    };

    [yearEl, monthEl, periodEl, kindEl, accEl, catEl, goalEl, curEl].forEach(el => el.addEventListener('change', onChange));
    if (qEl) {
      let t;
      qEl.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(applyFiltersAndRender, 150);
      });
    }

    yearEl.dataset.bound = '1';
  }

  // --------- Modal: Ahorro ---------

  function setupSavingsModalDynamic(_retry=0) {
    // Si no está en DOM, no hacer nada
    const kindEl = document.getElementById('sav-kind');
    const fromEl = document.getElementById('sav-from-account');
    const toEl = document.getElementById('sav-to-account');
    // El modal se inyecta al DOM al abrirse; en el primer open puede no estar listo aún.
    if (!kindEl || !fromEl) {
      if (_retry < 10) {
        setTimeout(() => setupSavingsModalDynamic(_retry + 1), 0);
      }
      return false;
    }
    
// Si el módulo aún no ha refrescado (primer render), cargar data aquí mismo.
// Esto evita que el primer open muestre combos vacíos.
if (!Array.isArray(state.accounts) || state.accounts.length === 0 ||
    !Array.isArray(state.categories) || state.categories.length === 0 ||
    !Array.isArray(state.goals) || !Array.isArray(state.savings)) {
  try {
    state.accounts = getAccounts();
    state.categories = getCategories();
    state.goals = getGoals();
    state.savings = getSavingsMovements();
  } catch (e) {
    // si falla, seguimos; el retry o siguiente open podría tener data
  }
}

if (kindEl.dataset.bound === '1') return true;

    const ctx = window.SGF.modalContext || {};
    const idHidden = document.getElementById('sav-id');
    const dateEl = document.getElementById('sav-date');
    const periodEl = document.getElementById('sav-period');
    const currencyEl = document.getElementById('sav-currency');
    const fromBalEl = document.getElementById('sav-from-balance');
    const toFixedEl = document.getElementById('sav-to-fixed');
    const toFixedGroup = document.getElementById('sav-to-fixed-group');
    const toGroup = document.getElementById('sav-to-group');
    const refGroup = document.getElementById('sav-ref-group');
    const refEl = document.getElementById('sav-ref-deposit');
    const refRemainingEl = document.getElementById('sav-ref-remaining');
    const catEl = document.getElementById('sav-category');
    const goalEl = document.getElementById('sav-goal');
    const amountEl = document.getElementById('sav-amount');
    const descEl = document.getElementById('sav-desc');

    // Periodos
    fillPeriodSelect(periodEl, isoToPeriod(todayISO()), { includeAll: false });

    // Categories (paths)
    const catPaths = buildCategoryPathList(state.categories);
    catEl.innerHTML = [`<option value="">(Sin categoría)</option>`].concat(
      catPaths.map(c => `<option value="${c.id}">${escapeHtml(c.path)}</option>`)
    ).join('');

    // Goals
    goalEl.innerHTML = [`<option value="">(Sin meta)</option>`].concat(
      state.goals.filter(g => Number(g.active || 0) === 1).map(g => `<option value="${g.id}">${escapeHtml(g.name)} (${escapeHtml(g.currency)})</option>`)
    ).join('');

    // Accounts (para depósito, excluir cuentas de ahorro destino si es mismo?)
    const accOpts = state.accounts.map(a => {
      const label = (a.type_name ? `${a.type_name} > ${a.name}` : a.name);
      return `<option value="${a.id}">${escapeHtml(label)} (${escapeHtml(a.currency)})</option>`;
    });
    fromEl.innerHTML = accOpts.join('');
    toEl.innerHTML = [`<option value="">(Seleccione)</option>`].concat(accOpts).join('');

    // Depósitos disponibles para referencia de retiro
    function refreshDepositRefs(currency) {
      const deps = state.savings
        .filter(m => String(m.savings_kind) === 'deposit')
        .filter(m => {
          const cur = m.account_to_currency || m.account_currency || 'CRC';
          return !currency || cur === currency;
        })
        .map(m => ({ id: m.id, label: `#${m.id} ${isoToCR(m.date)} - ${formatMoney(m.amount, m.account_to_currency || m.account_currency || 'CRC')} (${escapeHtml(m.description || 'Depósito')})` }));

      refEl.innerHTML = [`<option value="">(Sin referencia)</option>`].concat(
        deps.map(d => `<option value="${d.id}">${d.label}</option>`)
      ).join('');
    }

    function syncMetaFromFromAccount() {
      const fromId = Number(fromEl.value);
      const acc = state.accounts.find(a => Number(a.id) === fromId);
      const cur = acc?.currency || 'CRC';
      const bal = getAccountBalance(fromId);
      if (fromBalEl) fromBalEl.textContent = formatMoney(bal, cur);
      if (currencyEl) currencyEl.value = cur;
      const savId = getSavingsAccountId(cur, state.accounts);
      const savName = state.accounts.find(a => Number(a.id) === savId)?.name || '';
      if (toFixedEl) toFixedEl.value = savName;
      refreshDepositRefs(cur);
    }

    function syncWithdrawMeta() {
      // En retiro: cuenta origen es ahorros según moneda (derivada por depósito ref o por cuenta destino elegida)
      const refId = Number(refEl.value || 0);
      let cur = currencyEl?.value || 'CRC';
      if (refId) {
        const dep = state.savings.find(m => Number(m.id) === refId);
        cur = dep?.account_to_currency || dep?.account_currency || cur;
      }
      const savId = getSavingsAccountId(cur, state.accounts);
      const savName = state.accounts.find(a => Number(a.id) === savId)?.name || '';
      // bloquear from select mostrando ahorro
      fromEl.value = String(savId || '');
      const bal = getAccountBalance(savId);
      if (fromBalEl) fromBalEl.textContent = formatMoney(bal, cur);
      if (currencyEl) currencyEl.value = cur;
      if (toFixedEl) toFixedEl.value = savName;

      // restante de depósito si aplica
      if (refRemainingEl) {
        const rem = refId ? calcDepositRemaining(refId) : 0;
        refRemainingEl.textContent = `${formatNumber(rem)}`;
      }
    }

    function syncMode() {
      const isWithdraw = String(kindEl.value) === 'withdraw';
      toFixedGroup?.classList.toggle('hidden', isWithdraw);
      toGroup?.classList.toggle('hidden', !isWithdraw);
      refGroup?.classList.toggle('hidden', !isWithdraw);
      if (isWithdraw) {
        // en retiro: 'Cuenta origen' se usa como cuenta de ahorros (readonly lógico)
        fromEl.disabled = true;
        fromEl.classList.add('bg-gray-100', 'cursor-not-allowed');
        syncWithdrawMeta();
      } else {
        fromEl.disabled = false;
        fromEl.classList.remove('bg-gray-100', 'cursor-not-allowed');
        syncMetaFromFromAccount();
      }
    }

    // Defaults + edición
    const editId = Number(ctx?.id || 0);
    if (idHidden) idHidden.value = editId ? String(editId) : '';

    // valores iniciales
    if (dateEl && !dateEl.value) dateEl.value = fmt.todayCR ? fmt.todayCR() : isoToCR(todayISO());

    refreshDepositRefs();

    if (editId) {
      const m = window.SGF.db.select('SELECT * FROM movements WHERE id=:id LIMIT 1', { ':id': editId })[0];
      if (m) {
        kindEl.value = String(m.savings_kind || 'deposit');
        if (dateEl) dateEl.value = isoToCR(m.date);
        if (periodEl) periodEl.value = m.period || isoToPeriod(m.date);
        if (amountEl) amountEl.value = Number(m.amount || 0).toFixed(2);
        if (descEl) descEl.value = m.description || '';
        if (catEl) catEl.value = m.category_id ? String(m.category_id) : '';
        if (goalEl) goalEl.value = m.goal_id ? String(m.goal_id) : '';
        if (String(m.savings_kind) === 'deposit') {
          fromEl.value = String(m.account_id);
        } else {
          // retiro
          if (refEl) refEl.value = m.savings_ref_id ? String(m.savings_ref_id) : '';
          // destino
          if (toEl) toEl.value = m.account_to_id ? String(m.account_to_id) : '';
        }
      }
    } else if (ctx?.kind) {
      kindEl.value = String(ctx.kind);
      if (String(ctx.kind) === 'withdraw' && ctx?.refDepositId) {
        if (refEl) refEl.value = String(ctx.refDepositId);
      }
    }

    // Events
    kindEl.addEventListener('change', syncMode);
    fromEl.addEventListener('change', () => {
      if (String(kindEl.value) === 'deposit') syncMetaFromFromAccount();
    });
    refEl?.addEventListener('change', syncWithdrawMeta);

    // Flatpickr (si está disponible)
    try {
      if (window.flatpickr && dateEl && !dateEl._flatpickr) {
        window.flatpickr(dateEl, { dateFormat: 'd/m/Y', allowInput: true });
      }
    } catch (_) {}

    syncMode();
    kindEl.dataset.bound = '1';
    return true;
  }

  async function saveSavingsFromModal() {
    const id = Number(document.getElementById('sav-id')?.value || 0);
    const kind = String(document.getElementById('sav-kind')?.value || 'deposit');
    const dateCr = String(document.getElementById('sav-date')?.value || '').trim();
    const dateIso = crToISO(dateCr) || todayISO();
    if (dateCr && !crToISO(dateCr)) throw new Error('Fecha inválida. Usa formato dd/mm/aaaa.');
    const period = String(document.getElementById('sav-period')?.value || '') || isoToPeriod(dateIso);

    const amount = round2(document.getElementById('sav-amount')?.value);
    if (!(amount > 0)) throw new Error('Monto requerido.');

    const categoryIdRaw = document.getElementById('sav-category')?.value || '';
    const categoryId = categoryIdRaw ? Number(categoryIdRaw) : null;
    const goalIdRaw = document.getElementById('sav-goal')?.value || '';
    const goalId = goalIdRaw ? Number(goalIdRaw) : null;
    const desc = String(document.getElementById('sav-desc')?.value || '').trim();
    const t = nowIso();

    // Accounts
    let accountId = Number(document.getElementById('sav-from-account')?.value || 0);
    let accountToId = null;
    let savingsRefId = null;

    // Obtener moneda por cuenta origen (o por depósito ref)
    let currency = String(document.getElementById('sav-currency')?.value || 'CRC');

    if (kind === 'deposit') {
      if (!accountId) throw new Error('Cuenta origen requerida.');
      const acc = state.accounts.find(a => Number(a.id) === accountId);
      currency = acc?.currency || currency;
      accountToId = getSavingsAccountId(currency, state.accounts);
      if (!accountToId) throw new Error('No se encontró cuenta de ahorros por defecto.');
      if (accountId === accountToId) throw new Error('La cuenta origen no puede ser la misma cuenta de ahorros.');

      // Validación: si no permite negativo, bloquear
      const meta = state.accounts.find(a => Number(a.id) === accountId);
      if (meta && Number(meta.allow_negative || 0) !== 1) {
        const bal = getAccountBalance(accountId);
        if ((bal - amount) < -0.00001) {
          throw new Error(`La cuenta no permite saldo negativo.\nSaldo disponible: ${formatMoney(bal, currency)}`);
        }
      }
    } else {
      // withdraw
      const refId = Number(document.getElementById('sav-ref-deposit')?.value || 0);
      savingsRefId = refId || null;
      if (refId) {
        const dep = state.savings.find(m => Number(m.id) === refId);
        currency = dep?.account_to_currency || dep?.account_currency || currency;
      }
      accountId = getSavingsAccountId(currency, state.accounts);
      accountToId = Number(document.getElementById('sav-to-account')?.value || 0) || null;
      if (!accountToId) throw new Error('Cuenta destino requerida.');
      if (accountId === accountToId) throw new Error('La cuenta destino no puede ser la misma cuenta de ahorros.');

      // Validar saldo disponible en cuenta de ahorros
      const bal = getAccountBalance(accountId);
      if ((bal - amount) < -0.00001) {
        throw new Error(`No hay saldo suficiente en ahorros.\nSaldo disponible: ${formatMoney(bal, currency)}`);
      }

      // Validar por depósito si aplica
      if (refId) {
        const rem = calcDepositRemaining(refId);
        if ((rem - amount) < -0.00001) {
          throw new Error(`El retiro excede el disponible del depósito.\nDisponible: ${formatMoney(rem, currency)}`);
        }
      }
    }

    
      // Blindaje: validar cierre de mes (antes y después)
      const oldMov = id ? dbSelectMovementById(id) : null;
      
const nextMov = {
  id,
  type: 'transfer',
  date: dateIso,
  period,
  account_id: accountId,
  account_to_id: accountToId
};
guardAssertNotClosedForChange(id ? 'update' : 'create', oldMov, nextMov);

// Derivados FX (moneda, monto destino, base_amount)
const fromAcc = state.accounts.find(a => Number(a.id) === Number(accountId));
const toAcc = accountToId ? state.accounts.find(a => Number(a.id) === Number(accountToId)) : null;
const fromCur = String(fromAcc?.currency || currency || 'CRC');
const toCur = String(toAcc?.currency || fromCur);
const baseCur = window.SGF.fx?.baseCurrency?.() || 'CRC';

let fxRate = 1;
let amountTo = null;
if (toCur !== fromCur) {
  fxRate = Number(window.SGF.fx?.rate?.(dateIso, fromCur, toCur) || 0);
  if (!Number.isFinite(fxRate) || fxRate <= 0) {
    throw new Error(`Falta tipo de cambio para ${fromCur}→${toCur} en ${dateIso}.`);
  }
  amountTo = round2(Number(amount || 0) * fxRate);
} else {
  fxRate = 1;
  amountTo = round2(Number(amount || 0));
}

const toBase = (fromCur === baseCur) ? 1 : Number(window.SGF.fx?.rate?.(dateIso, fromCur, baseCur) || 0);
const baseAmount = round2(Number(amount || 0) * Number(toBase || 0));

      try {
        if (id) {
      // Reglas extra en edición
      const old = window.SGF.db.select('SELECT * FROM movements WHERE id=:id LIMIT 1', { ':id': id })[0];
      if (!old) throw new Error('Registro no encontrado.');

      if (String(old.savings_kind) === 'deposit') {
        // si tiene retiros asociados, no permitir bajar debajo del total retirado
        const used = window.SGF.db.scalar(
          'SELECT COALESCE(SUM(amount),0) AS s FROM movements WHERE COALESCE(is_savings,0)=1 AND savings_kind=\'withdraw\' AND savings_ref_id=:id',
          { ':id': id }
        );
        if (Number(used || 0) > amount + 0.00001) {
          throw new Error('No puedes reducir el depósito por debajo de lo ya retirado.');
        }
      }

      
window.SGF.db.run(
  `UPDATE movements
   SET date=:date, period=:period, account_id=:aid, account_to_id=:ato,
       category_id=:cid, amount=:amt, currency=:cur, fx_rate=:fx, amount_to=:amt_to, base_amount=:base, description=:desc,
       is_savings=1, savings_kind=:sk, goal_id=:gid, savings_ref_id=:rid,
       updated_at=:u
   WHERE id=:id`,
  {
    ':date': dateIso,
    ':period': period,
    ':aid': accountId,
    ':ato': accountToId,
    ':cid': categoryId,
    ':amt': amount,
    ':cur': fromCur,
    ':fx': Number(fxRate || 1),
    ':amt_to': (amountTo == null ? null : Number(amountTo)),
    ':base': Number(baseAmount || 0),
    ':desc': desc,
    ':sk': kind,
    ':gid': goalId,
    ':rid': savingsRefId,
    ':u': t,
    ':id': id,
  }
);
    } else {
      
window.SGF.db.run(
  `INSERT INTO movements
   (type,date,period,account_id,account_to_id,category_id,amount,currency,fx_rate,amount_to,base_amount,description,reference_url,attachments_text,is_split,is_opening,is_savings,savings_kind,goal_id,savings_ref_id,created_at)
   VALUES
   ('transfer',:date,:period,:aid,:ato,:cid,:amt,:cur,:fx,:amt_to,:base,:desc,NULL,NULL,0,0,1,:sk,:gid,:rid,:t)`,
  {
    ':date': dateIso,
    ':period': period,
    ':aid': accountId,
    ':ato': accountToId,
    ':cid': categoryId,
    ':amt': amount,
    ':cur': fromCur,
    ':fx': Number(fxRate || 1),
    ':amt_to': (amountTo == null ? null : Number(amountTo)),
    ':base': Number(baseAmount || 0),
    ':desc': desc,
    ':sk': kind,
    ':gid': goalId,
    ':rid': savingsRefId,
    ':t': t,
  }
);
    }
      await window.SGF.db.save();
    } catch (e) {
      if (isMonthClosedError(e)) {
        toastMonthClosed(e);
        return;
      }
      throw e;
    }
    closeModal();
    refresh();
    toast('Ahorro guardado');
  }

  // --------- Modal: Metas ---------

  function setupGoalsModalDynamic() {
    const nameEl = document.getElementById('goal-name');
    const body = document.getElementById('goal-table-body');
    if (!nameEl || !body) return;
    if (nameEl.dataset.bound === '1') {
      renderGoalsTable();
      return;
    }

    // limpiar form
    clearGoalForm();
    renderGoalsTable();

    nameEl.dataset.bound = '1';
  }

  function clearGoalForm() {
    const idEl = document.getElementById('goal-id');
    const nameEl = document.getElementById('goal-name');
    const curEl = document.getElementById('goal-currency');
    const targetEl = document.getElementById('goal-target');
    const activeEl = document.getElementById('goal-active');
    if (idEl) idEl.value = '';
    if (nameEl) nameEl.value = '';
    if (curEl) curEl.value = 'CRC';
    if (targetEl) targetEl.value = '';
    if (activeEl) activeEl.checked = true;
  }

  function renderGoalsTable() {
    const body = document.getElementById('goal-table-body');
    if (!body) return;
    // recargar desde DB por si se abrieron sin mount
    state.goals = getGoals();
    if (!Array.isArray(state.savings) || state.savings.length === 0) {
      try { state.savings = getSavingsMovements(); } catch (_) { state.savings = []; }
    }
    const progressByGoal = computeGoalProgress(state.goals, state.savings);
    body.innerHTML = (state.goals || []).map(g => {
      const active = Number(g.active || 0) === 1;
      const cur = String(g.currency || 'CRC');
      const prog = progressByGoal.get(Number(g.id))?.saved || 0;
      const target = Number(g.target || 0);
      const pct = target > 0 ? Math.max(0, Math.min(999, Math.round((prog / target) * 100))) : 0;
      const pctBar = Math.max(0, Math.min(100, pct));
      const remaining = round2(target - Number(prog || 0));
      const isDone = target > 0 && Number(prog || 0) >= target;
      const rowCls = isDone ? 'bg-green-50' : '';
      const remainingUi = remaining > 0
        ? `<span class="text-sm font-semibold text-gray-700">${formatNumber(remaining)}</span>`
        : `<span class="text-sm font-semibold text-green-700">Excedido +${formatNumber(Math.abs(remaining))}</span>`;
      return `
        <tr class="border-b hover:bg-gray-50 ${rowCls}">
          <td class="p-2">
            <div class="flex gap-1">
              <button class="text-blue-600 hover:bg-blue-50 p-1 rounded" onclick="window.SGF.modules.ahorros.editGoal(${Number(g.id)})" title="Editar"><i data-lucide="edit" class="w-4 h-4"></i></button>
              <button class="text-red-600 hover:bg-red-50 p-1 rounded" onclick="window.SGF.modules.ahorros.deleteGoal(${Number(g.id)})" title="Eliminar"><i data-lucide="trash" class="w-4 h-4"></i></button>
            </div>
          </td>
          <td class="p-2 font-medium">${escapeHtml(g.name)}</td>
          <td class="p-2">${escapeHtml(cur)}</td>
          <td class="p-2">${formatNumber(target)}</td>
          <td class="p-2">
            <div class="text-xs text-gray-600">${formatNumber(prog)} / ${formatNumber(target)}</div>
            <div class="w-40 bg-gray-200 rounded-full h-2 mt-1 overflow-hidden">
              <div class="h-2 bg-blue-600" style="width:${pctBar}%"></div>
            </div>
          </td>
          <td class="p-2">${remainingUi}</td>
          <td class="p-2 text-sm font-semibold text-gray-700">${pct}%</td>
          <td class="p-2">${active ? 'Sí' : 'No'}</td>
        </tr>
      `;
    }).join('');
    window.lucide?.createIcons?.();
  }

  async function saveGoalFromModal() {
    const id = Number(document.getElementById('goal-id')?.value || 0);
    const name = String(document.getElementById('goal-name')?.value || '').trim();
    const currency = String(document.getElementById('goal-currency')?.value || 'CRC');
    const target = round2(document.getElementById('goal-target')?.value);
    const active = document.getElementById('goal-active')?.checked ? 1 : 0;
    if (!name) throw new Error('Nombre requerido.');
    if (!(target > 0)) throw new Error('Monto meta requerido.');
    const t = nowIso();

    if (id) {
      window.SGF.db.run(
        'UPDATE savings_goals SET name=:n, currency=:c, target=:t, active=:a WHERE id=:id',
        { ':n': name, ':c': currency, ':t': target, ':a': active, ':id': id }
      );
        } else {
      window.SGF.db.run(
        'INSERT INTO savings_goals(name,currency,target,active,created_at) VALUES (:n,:c,:t,:a,:d)',
        { ':n': name, ':c': currency, ':t': target, ':a': active, ':d': t }
      );
    }

    await window.SGF.db.save();
    clearGoalForm();
    renderGoalsTable();
    refresh();
    toast('Meta guardada');
  }

  async function deleteGoal(id) {
    const gid = Number(id);
    if (!gid) return;
    const used = Number(window.SGF.db.scalar('SELECT COUNT(*) AS c FROM movements WHERE goal_id=:id', { ':id': gid }) || 0);
    if (used > 0) {
      toast('No se puede eliminar: la meta está en uso.');
      return;
    }
    const ok = await window.SGF.uiConfirm({
      title: 'Eliminar meta',
      message: '¿Eliminar esta meta de ahorro?',
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    window.SGF.db.run('DELETE FROM savings_goals WHERE id=:id', { ':id': gid });
    await window.SGF.db.save();
    renderGoalsTable();
    refresh();
    toast('Meta eliminada');
  }

  function editGoal(id) {
    const gid = Number(id);
    const g = state.goals.find(x => Number(x.id) === gid) || window.SGF.db.select('SELECT * FROM savings_goals WHERE id=:id LIMIT 1', { ':id': gid })[0];
    if (!g) return;
    document.getElementById('goal-id').value = String(gid);
    document.getElementById('goal-name').value = g.name || '';
    document.getElementById('goal-currency').value = g.currency || 'CRC';
    document.getElementById('goal-target').value = Number(g.target || 0).toFixed(2);
    document.getElementById('goal-active').checked = Number(g.active || 0) === 1;
  }

  // --------- Acciones tabla Ahorros ---------

  function openSavingsEdit(id) {
    openModal('sav_new', { id: Number(id) });
  }

  function openSavingsWithdraw(depositId) {
    openModal('sav_new', { kind: 'withdraw', refDepositId: Number(depositId) });
  }

  async function deleteSavings(id) {
    const mid = Number(id);
    if (!mid) return;
    const m = window.SGF.db.select('SELECT id, savings_kind FROM movements WHERE id=:id LIMIT 1', { ':id': mid })[0];
    if (!m) return;
    if (String(m.savings_kind) === 'deposit') {
      const used = Number(window.SGF.db.scalar(
        'SELECT COUNT(*) AS c FROM movements WHERE COALESCE(is_savings,0)=1 AND savings_kind=\'withdraw\' AND savings_ref_id=:id',
        { ':id': mid }
      ) || 0);
      if (used > 0) {
        toast('No se puede eliminar: el depósito tiene retiros asociados.');
        return;
      }
    }

    const ok = await window.SGF.uiConfirm({
      title: 'Eliminar ahorro',
      message: '¿Eliminar este registro de ahorro?',
      confirmText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    const oldMov = dbSelectMovementById(mid);
    try {
      guardAssertNotClosedForChange('delete', oldMov, null);
      window.SGF.db.run('DELETE FROM movements WHERE id=:id', { ':id': mid });
      await window.SGF.db.save();
    } catch (e) {
      if (isMonthClosedError(e)) { toastMonthClosed(e); return; }
      throw e;
    }
    refresh();
    toast('Ahorro eliminado');
  }

  // --------- Refresh ---------

  function refresh() {
    try {
      state.accounts = getAccounts();
      state.categories = getCategories();
      state.goals = getGoals();
      state.savings = getSavingsMovements();
    } catch (e) {
      console.warn('Ahorros: no se pudo cargar datos', e);
      state.accounts = [];
      state.categories = [];
      state.goals = [];
      state.savings = [];
    }
    setupFilters();
    applyFiltersAndRender();
  }

  // --------- Public module API ---------

  window.SGF.modules.ahorros = {
    onMount() {
      refresh();
    },
    setupSavingsModalDynamic,
    setupGoalsModalDynamic,
    openSavingsEdit,
    openSavingsWithdraw,
    deleteSavings,
    editGoal,
    deleteGoal,
  };

  // Handlers del modal
  window.SGF.modalHandlers.sav_new = saveSavingsFromModal;
  window.SGF.modalHandlers.goal_new = saveGoalFromModal;
})();
