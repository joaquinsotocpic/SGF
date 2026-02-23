window.SGF = window.SGF || {}; window.SGF.modules = window.SGF.modules || {};

function buildTree(rows) {
  const byId = new Map();
  rows.forEach(r => byId.set(r.id, { ...r, label: r.name, children: [] }));
  const roots = [];
  rows.forEach(r => {
    const node = byId.get(r.id);
    if (r.parent_id) {
      const parent = byId.get(r.parent_id);
      if (parent) parent.children.push(node);
      else roots.push(node);
    } else {
      roots.push(node);
    }
  });
  // ordenar por nombre
  const sortRec = (arr) => {
    arr.sort((a,b)=> String(a.name||'').localeCompare(String(b.name||'')));
    arr.forEach(n => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

function getUsageMap(kind) {
  const db = window.SGF.db;
  const map = new Map();

  function addRows(sql) {
    try {
      const rows = db.select(sql) || [];
      rows.forEach(r => {
        const id = Number(r.id);
        const c = Number(r.c || 0);
        if (!id) return;
        map.set(id, (map.get(id) || 0) + c);
      });
    } catch (_) {}
  }

  if (kind === 'cuentas') {
    addRows(`SELECT account_id AS id, COUNT(*) AS c FROM movements WHERE account_id IS NOT NULL GROUP BY account_id`);
    addRows(`SELECT account_to_id AS id, COUNT(*) AS c FROM movements WHERE account_to_id IS NOT NULL GROUP BY account_to_id`);
    addRows(`SELECT account_id AS id, COUNT(*) AS c FROM reconciliations WHERE account_id IS NOT NULL GROUP BY account_id`);
    addRows(`SELECT account_id AS id, COUNT(*) AS c FROM recurring_movements WHERE account_id IS NOT NULL GROUP BY account_id`);
    addRows(`SELECT account_to_id AS id, COUNT(*) AS c FROM recurring_movements WHERE account_to_id IS NOT NULL GROUP BY account_to_id`);
  } else if (kind === 'categorias') {
    addRows(`SELECT category_id AS id, COUNT(*) AS c FROM movements WHERE category_id IS NOT NULL GROUP BY category_id`);
    addRows(`SELECT category_id AS id, COUNT(*) AS c FROM budgets WHERE category_id IS NOT NULL GROUP BY category_id`);
    addRows(`SELECT category_id AS id, COUNT(*) AS c FROM recurring_movements WHERE category_id IS NOT NULL GROUP BY category_id`);
  } else if (kind === 'tipos') {
    addRows(`SELECT type_id AS id, COUNT(*) AS c FROM accounts WHERE type_id IS NOT NULL GROUP BY type_id`);
  }

  return map;
}

function usageBadge(count) {
  const c = Number(count || 0);
  if (c <= 0) return '<span class="px-2 py-0.5 rounded bg-gray-100 text-gray-500 text-xs">Libre</span>';
  return `<span class="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-semibold">En uso (${c})</span>`;
}


function renderTree(containerId, kind) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  const rows = kind === 'cuentas'
    ? window.SGF.db.select(`SELECT id, name, parent_id, currency, color, active, allow_negative, type_id FROM accounts ORDER BY name`)
    : window.SGF.db.select(`SELECT id, name, parent_id, color, active FROM categories ORDER BY name`);


  const usage = getUsageMap(kind === 'cuentas' ? 'cuentas' : 'categorias');

  const roots = buildTree(rows);

  // Util: obtener descendientes (incluye el nodo base) y borrar en orden hoja->raíz
  const collectDescendants = (allRows, rootId) => {
    const childrenByParent = new Map();
    allRows.forEach(r => {
      const p = r.parent_id || null;
      if (!childrenByParent.has(p)) childrenByParent.set(p, []);
      childrenByParent.get(p).push(r.id);
    });
    const ids = [];
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop();
      ids.push(id);
      const kids = childrenByParent.get(id) || [];
      kids.forEach(k => stack.push(k));
    }
    // borrar hijos primero
    return ids.reverse();
  };

  const renderNode = (node, level) => {
    const div = document.createElement('div');
    div.className = `tree-node ml-${level > 0 ? '8' : '0'} border-l border-gray-200 pl-4 py-1`;
    const hasChildren = node.children && node.children.length > 0;
    const color = node.color || colors[level % colors.length];

    const newKey = kind === 'cuentas' ? 'acc_new' : 'cat_new';

    div.innerHTML = `
      <div class="flex items-center group py-1 hover:bg-gray-50 rounded pr-2">
        <span class="node-color-dot" style="background-color:${color}"></span>
        <button type="button" onclick="toggleCollapse(this)" class="p-1 hover:text-blue-600 ${hasChildren ? '' : 'invisible'}">
          <i data-lucide="chevron-down" class="w-4 h-4"></i>
        </button>
        <span class="flex-1 text-sm font-medium" data-tree-label>${node.name}</span>
        <span class="mr-2">${usageBadge(usage.get(Number(node.id)) || 0)}</span>
        <div class="flex space-x-1">
          <button type="button" class="text-green-600 p-1 hover:bg-green-50 rounded" title="Agregar hijo"
            data-action="tree-add" data-kind="${kind}" data-id="${node.id}">
            <i data-lucide="plus-circle" class="w-4 h-4"></i>
          </button>
          <button type="button" class="text-blue-600 p-1 hover:bg-blue-50 rounded" title="Editar"
            data-action="tree-edit" data-kind="${kind}" data-id="${node.id}">
            <i data-lucide="edit-3" class="w-4 h-4"></i>
          </button>
          ${(() => { const u = usage.get(Number(node.id)) || 0; const dis = u>0; const ttl = dis ? "En uso" : "Eliminar"; return `<button type="button" class="text-red-600 p-1 hover:bg-red-50 rounded ${dis ? "opacity-40 cursor-not-allowed" : ""}" title="${ttl}" data-action="tree-delete" data-kind="${kind}" data-id="${node.id}" data-container="${containerId}" ${dis ? "disabled" : ""}><i data-lucide="trash" class="w-4 h-4"></i></button>`; })()}
        </div>
      </div>
      <div class="children-container"></div>
    `;

    // NOTA: add/edit/delete se manejan por delegación en wireCatalogClickHandlers().

    const childBox = div.querySelector('.children-container');
    (node.children || []).forEach(c => childBox.appendChild(renderNode(c, level + 1)));
    return div;
  };

  container.innerHTML = '';
  if (!roots.length) {
    container.innerHTML = `<div class="text-sm text-gray-500">Sin datos. Crea el primer registro.</div>`;
  } else {
    roots.forEach(r => container.appendChild(renderNode(r, 0)));
  }
  window.lucide?.createIcons?.();
}

function renderTiposCuenta() {
  const tbody = document.getElementById('types-table-body');
  if (!tbody) return;
  const rows = window.SGF.db.select('SELECT id, name, is_base, active FROM account_types ORDER BY name');
  const usage = getUsageMap('tipos');
  tbody.innerHTML = rows.map(r => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-3">
        <div class="flex gap-1">
          <button type="button" class="text-blue-600 hover:bg-blue-50 p-1 rounded" data-action="type-edit" data-id="${r.id}"><i data-lucide="edit" class="w-4 h-4"></i></button>
          ${(() => { const u = usage.get(Number(r.id)) || 0; const dis = (Number(r.is_base)||0)===1 || u>0; const ttl = (Number(r.is_base)||0)===1 ? "Tipo base" : (u>0 ? "En uso" : "Eliminar"); return `<button type="button" class="text-red-600 hover:bg-red-50 p-1 rounded ${dis ? "opacity-40 cursor-not-allowed" : ""}" title="${ttl}" data-action="type-delete" data-id="${r.id}" ${dis ? "disabled" : ""}><i data-lucide="trash" class="w-4 h-4"></i></button>`; })()}
        </div>
      </td>
      <td class="p-3 text-sm font-medium">${r.name}</td>
      <td class="p-3">${r.is_base ? '<span class="px-2 py-0.5 rounded bg-gray-200 text-gray-800 text-xs font-bold">Base</span>' : '-'}</td>
      <td class="p-3">${usageBadge(usage.get(Number(r.id)) || 0)}</td>
    </tr>
  `).join('');
  window.lucide?.createIcons?.();
}

// Filtro de Tipos de Cuenta
// Nota: Se define aquí para evitar ReferenceError si la vista lo llama al montar.
function wireTiposFilter() {
  const input = document.getElementById('types-filter');
  const tbodyId = 'types-table-body';
  if (!input) return;
  if (input.__wired) return;
  input.__wired = true;

  const apply = () => {
    const q = String(input.value || '').toLowerCase().trim();
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach(tr => {
      const text = String(tr.innerText || '').toLowerCase();
      tr.style.display = (!q || text.includes(q)) ? '' : 'none';
    });
  };

  input.addEventListener('input', apply);
  apply();
}

function wireCatalogClickHandlers() {
  if (wireCatalogClickHandlers.__wired) return;
  document.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('button[data-action]');
    if (!btn) return;

    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');
    const kind = btn.getAttribute('data-kind');
    const containerId = btn.getAttribute('data-container');

    // Evitar navegación/propagación inesperada
    e.preventDefault();
    e.stopPropagation();

    try {
      if (action === 'type-edit') {
        openModal('type_new', { mode: 'edit', id: Number(id) });
        return;
      }
      if (action === 'type-delete') {
        window.SGF.actions.deleteType(Number(id));
        return;
      }

      if (action === 'tree-add') {
        const key = kind === 'cuentas' ? 'acc_new' : 'cat_new';
        openModal(key, { mode: 'create', parentId: Number(id), entity: kind });
        return;
      }
      if (action === 'tree-edit') {
        const key = kind === 'cuentas' ? 'acc_new' : 'cat_new';
        openModal(key, { mode: 'edit', id: Number(id), entity: kind });
        return;
      }
      if (action === 'tree-delete') {
        window.SGF.actions.deleteTreeNode(kind, Number(id), containerId);
        return;
      }
    } catch (err) {
      console.error(err);
      toast('Acción no disponible. Revisa consola.');
    }
  }, { capture: true });
  wireCatalogClickHandlers.__wired = true;
}

async function fillAccountTypeOptions(selectId, selectedId = null) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const types = window.SGF.db.select('SELECT id, name FROM account_types WHERE active=1 ORDER BY name');
  sel.innerHTML = types.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  if (selectedId) sel.value = String(selectedId);
}

async function fillAccountParentOptions(selectId, selectedId = null, excludeId = null) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  let rows = window.SGF.db.select('SELECT id, name FROM accounts ORDER BY name');
  if (excludeId) rows = rows.filter(r => r.id !== excludeId);
  sel.innerHTML = `<option value="">(Raíz)</option>` + rows.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  sel.value = selectedId ? String(selectedId) : '';
}

async function fillCategoryParentOptions(selectId, selectedId = null, excludeId = null) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  let rows = window.SGF.db.select('SELECT id, name FROM categories ORDER BY name');
  if (excludeId) rows = rows.filter(r => r.id !== excludeId);
  sel.innerHTML = `<option value="">(Raíz)</option>` + rows.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  sel.value = selectedId ? String(selectedId) : '';
}

// --- Handlers de modales ---
window.SGF.modalHandlers.type_new = async (ctx) => {
  const name = (document.getElementById('type-name')?.value || '').trim();
  if (!name) throw new Error('Nombre requerido.');

  if (ctx.mode === 'edit' && ctx.id) {
    window.SGF.db.run('UPDATE account_types SET name=:n WHERE id=:id', { ':n': name, ':id': ctx.id });
  } else {
    window.SGF.db.run('INSERT INTO account_types(name,is_base,active) VALUES (:n,0,1)', { ':n': name });
  }
  await window.SGF.db.save();
  closeModal();
  renderTiposCuenta();
  toast('Guardado.');
};

window.SGF.modalHandlers.acc_new = async (ctx) => {
  const name = (document.getElementById('acc-name')?.value || '').trim();
  if (!name) throw new Error('Nombre requerido.');
  const typeId = Number(document.getElementById('acc-type')?.value || 0) || null;
  const currency = document.getElementById('acc-currency')?.value || 'CRC';
  const parentId = document.getElementById('acc-parent')?.value ? Number(document.getElementById('acc-parent').value) : null;
  const color = document.getElementById('acc-color')?.value || null;
  const active = document.getElementById('acc-active')?.checked ? 1 : 0;
  const allowNeg = document.getElementById('acc-allow-neg')?.checked ? 1 : 0;
  const opening = Number(document.getElementById('acc-opening')?.value || 0) || 0;

  const now = new Date().toISOString();

  // Helpers: saldo inicial como movimiento (is_opening=1)
  const upsertOpeningMovement = (accountId, amount) => {
    const accId = Number(accountId);
    const amt = Number(amount || 0);
    const date = new Date().toISOString().slice(0, 10);
    const period = date.slice(0, 7);

    const existingId = Number(window.SGF.db.scalar(
      'SELECT id AS id FROM movements WHERE account_id=:a AND is_opening=1 LIMIT 1',
      { ':a': accId }
    ) || 0);

    const oldMov = existingId ? dbSelectMovementById(existingId) : null;
    const nextMov = {
      type: 'income',
      date,
      period,
      account_id: accId,
      account_to_id: null
    };


    if (Math.abs(amt) < 0.00001) {
      if (!existingId) return;
      try {
        guardAssertNotClosedForChange('delete', oldMov, null);
        window.SGF.db.run('DELETE FROM movements WHERE id=:id', { ':id': existingId });
      } catch (e) {
        if (isMonthClosedError(e)) { toastMonthClosed(e); return; }
        throw e;
      }
      return;
    }

    try {
      guardAssertNotClosedForChange(existingId ? 'update' : 'create', oldMov, nextMov);

      if (existingId) {
      window.SGF.db.run(
        `UPDATE movements
         SET type='income', date=:d, period=:p, amount=:amt, description='Saldo inicial',
             category_id=NULL, account_to_id=NULL, is_split=0, is_opening=1, updated_at=:u
         WHERE id=:id`,
        { ':d': date, ':p': period, ':amt': amt, ':u': now, ':id': existingId }
      );
    } else {
      window.SGF.db.run(
        `INSERT INTO movements(type,date,period,account_id,account_to_id,category_id,amount,description,reference_url,attachments_text,is_split,is_opening,created_at)
         VALUES ('income',:d,:p,:a,NULL,NULL,:amt,'Saldo inicial',NULL,NULL,0,1,:cr)`,
        { ':d': date, ':p': period, ':a': accId, ':amt': amt, ':cr': now }
      );
    }
    } catch (e) {
      if (isMonthClosedError(e)) { toastMonthClosed(e); return; }
      throw e;
    }

  };
  if (ctx.mode === 'edit' && ctx.id) {
    window.SGF.db.run(`
      UPDATE accounts
      SET name=:name, type_id=:typeId, parent_id=:parentId, currency=:cur, color=:color,
          initial_balance=:opening, active=:active, allow_negative=:allowNeg
      WHERE id=:id
    `, {
      ':name': name, ':typeId': typeId, ':parentId': parentId, ':cur': currency,
      ':color': color, ':opening': opening, ':active': active, ':allowNeg': allowNeg, ':id': ctx.id
    });

    // Crear/actualizar movimiento de saldo inicial
    upsertOpeningMovement(ctx.id, opening);
  } else {
    window.SGF.db.run(`
      INSERT INTO accounts(name,type_id,parent_id,currency,color,initial_balance,active,allow_negative,created_at)
      VALUES (:name,:typeId,:parentId,:cur,:color,:opening,:active,:allowNeg,:t)
    `, {
      ':name': name, ':typeId': typeId, ':parentId': ctx.parentId || parentId, ':cur': currency,
      ':color': color, ':opening': opening, ':active': active, ':allowNeg': allowNeg, ':t': now
    });

    const newId = Number(window.SGF.db.scalar('SELECT last_insert_rowid() AS id') || 0);
    if (newId) upsertOpeningMovement(newId, opening);
  }


  await window.SGF.db.save();
  closeModal();
  renderTree('tree-cuentas', 'cuentas');
  toast('Guardado.');
};

window.SGF.modalHandlers.cat_new = async (ctx) => {
  const name = (document.getElementById('cat-name')?.value || '').trim();
  if (!name) throw new Error('Nombre requerido.');
  const parentId = document.getElementById('cat-parent')?.value ? Number(document.getElementById('cat-parent').value) : null;
  const color = document.getElementById('cat-color')?.value || null;
  const active = document.getElementById('cat-active')?.checked ? 1 : 0;
  const now = new Date().toISOString();

  if (ctx.mode === 'edit' && ctx.id) {
    window.SGF.db.run(`UPDATE categories SET name=:name, parent_id=:parentId, color=:color, active=:active WHERE id=:id`, {
      ':name': name, ':parentId': parentId, ':color': color, ':active': active, ':id': ctx.id
    });
  } else {
    window.SGF.db.run(`INSERT INTO categories(name,parent_id,color,active,created_at) VALUES (:name,:parentId,:color,:active,:t)`, {
      ':name': name, ':parentId': ctx.parentId || parentId, ':color': color, ':active': active, ':t': now
    });
  }
  await window.SGF.db.save();
  closeModal();
  renderTree('tree-categorias', 'categorias');
  toast('Guardado.');
};

// --- Acciones globales ---
window.SGF.actions = window.SGF.actions || {};

// Borrado robusto para árboles (cuentas/categorías).
// Motivo: algunos browsers/escenarios pueden perder handlers si el DOM se re-renderiza.
window.SGF.actions.deleteTreeNode = async (kind, nodeId, containerId) => {
  const ok = await (window.SGF.uiConfirm?.({
    title: 'Eliminar',
    message: '¿Eliminar este elemento?\n\nSi tiene hijos, se eliminará todo el sub-árbol.',
    confirmText: 'Eliminar',
    cancelText: 'Cancelar',
    danger: true,
  }) ?? Promise.resolve(confirm('¿Eliminar?')));
  if (!ok) return;
  try {
    // Validaciones de uso (sub-árbol completo)
    const subtreeIds = (() => {
      const all = kind === 'cuentas'
        ? window.SGF.db.select('SELECT id, parent_id FROM accounts')
        : window.SGF.db.select('SELECT id, parent_id FROM categories');
      const childrenByParent = new Map();
      all.forEach(r => {
        const p = r.parent_id || null;
        if (!childrenByParent.has(p)) childrenByParent.set(p, []);
        childrenByParent.get(p).push(r.id);
      });
      const walk = [];
      const stack = [nodeId];
      while (stack.length) {
        const id = stack.pop();
        walk.push(id);
        (childrenByParent.get(id) || []).forEach(k => stack.push(k));
      }
      return walk;
    })();

    const subtreeInUse = (() => {
      if (kind === 'cuentas') {
        const q = `
          SELECT
            (SELECT COUNT(*) FROM movements m WHERE m.account_id IN (${subtreeIds.map(()=>'?').join(',')}) OR m.account_to_id IN (${subtreeIds.map(()=>'?').join(',')})) AS movs,
            (SELECT COUNT(*) FROM recurring_movements r WHERE r.account_id IN (${subtreeIds.map(()=>'?').join(',')}) OR r.account_to_id IN (${subtreeIds.map(()=>'?').join(',')})) AS recs,
            (SELECT COUNT(*) FROM reconciliations c WHERE c.account_id IN (${subtreeIds.map(()=>'?').join(',')})) AS concs
        `;
        const args = [...subtreeIds, ...subtreeIds, ...subtreeIds, ...subtreeIds, ...subtreeIds];
        const row = window.SGF.db.select(q, args)[0] || { movs: 0, recs: 0, concs: 0 };
        const total = Number(row.movs || 0) + Number(row.recs || 0) + Number(row.concs || 0);
        return total > 0 ? `No se puede eliminar: hay referencias (Movimientos/Recurrentes/Conciliaciones).` : '';
      } else {
        const q = `
          SELECT
            (SELECT COUNT(*) FROM movements m WHERE m.category_id IN (${subtreeIds.map(()=>'?').join(',')})) AS movs,
            (SELECT COUNT(*) FROM movement_splits s WHERE s.category_id IN (${subtreeIds.map(()=>'?').join(',')})) AS splits,
            (SELECT COUNT(*) FROM budgets b WHERE b.category_id IN (${subtreeIds.map(()=>'?').join(',')})) AS buds,
            (SELECT COUNT(*) FROM recurring_movements r WHERE r.category_id IN (${subtreeIds.map(()=>'?').join(',')})) AS recs
        `;
        const args = [...subtreeIds, ...subtreeIds, ...subtreeIds, ...subtreeIds];
        const row = window.SGF.db.select(q, args)[0] || { movs: 0, splits: 0, buds: 0, recs: 0 };
        const total = Number(row.movs || 0) + Number(row.splits || 0) + Number(row.buds || 0) + Number(row.recs || 0);
        return total > 0 ? `No se puede eliminar: la categoría está en uso (Movimientos/Split/Presupuestos/Recurrentes).` : '';
      }
    })();

    if (subtreeInUse) {
      toast(subtreeInUse);
      return;
    }

    // Borrado en cascada: sub-árbol completo hoja->raíz
    const all = kind === 'cuentas'
      ? window.SGF.db.select('SELECT id, parent_id FROM accounts')
      : window.SGF.db.select('SELECT id, parent_id FROM categories');

    const ids = (() => {
      const childrenByParent = new Map();
      all.forEach(r => {
        const p = r.parent_id || null;
        if (!childrenByParent.has(p)) childrenByParent.set(p, []);
        childrenByParent.get(p).push(r.id);
      });
      const walk = [];
      const stack = [nodeId];
      while (stack.length) {
        const id = stack.pop();
        walk.push(id);
        (childrenByParent.get(id) || []).forEach(k => stack.push(k));
      }
      return walk.reverse();
    })();

    let total = 0;
    for (const id of ids) {
      if (kind === 'cuentas') total += window.SGF.db.run('DELETE FROM accounts WHERE id=:id', { ':id': id });
      else total += window.SGF.db.run('DELETE FROM categories WHERE id=:id', { ':id': id });
    }
    await window.SGF.db.save();
    renderTree(containerId, kind);
    toast(total > 0 ? 'Eliminado.' : 'No se eliminó (sin cambios).');
  } catch (e) {
    console.error(e);
    const msg = String(e && (e.message || e)).includes('IN_USE') ? 'No se puede eliminar: está en uso.' : 'No se pudo eliminar. Revisa la consola.';
    toast(msg);
  }
};

// Regenerar colores por jerarquía: un root obtiene un color y todos sus descendientes heredan el color del padre.
window.SGF.actions.regenerateTreeColors = async (kind, containerId) => {
  try {
    const ok = await (window.SGF.uiConfirm?.({
      title: 'Regenerar colores',
      message: 'Se regenerarán los colores según la jerarquía (los hijos heredan el color del padre).',
      confirmText: 'Regenerar',
      cancelText: 'Cancelar',
    }) ?? Promise.resolve(true));
    if (!ok) return;

    const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#8b5cf6', '#22c55e'];
    const rows = kind === 'cuentas'
      ? window.SGF.db.select('SELECT id, parent_id FROM accounts')
      : window.SGF.db.select('SELECT id, parent_id FROM categories');

    const childrenByParent = new Map();
    rows.forEach(r => {
      const p = r.parent_id || null;
      if (!childrenByParent.has(p)) childrenByParent.set(p, []);
      childrenByParent.get(p).push(r.id);
    });

    // Asignar color a cada nodo (root => palette; child => hereda)
    const colorById = new Map();
    let idx = 0;
    const roots = (childrenByParent.get(null) || []).slice();
    roots.forEach(rootId => {
      const rootColor = palette[idx % palette.length];
      idx++;
      const stack = [{ id: rootId, color: rootColor }];
      while (stack.length) {
        const cur = stack.pop();
        colorById.set(cur.id, cur.color);
        const kids = childrenByParent.get(cur.id) || [];
        kids.forEach(kidId => stack.push({ id: kidId, color: cur.color }));
      }
    });

    let changed = 0;
    for (const [id, color] of colorById.entries()) {
      if (kind === 'cuentas') changed += window.SGF.db.run('UPDATE accounts SET color=:c WHERE id=:id', { ':c': color, ':id': id });
      else changed += window.SGF.db.run('UPDATE categories SET color=:c WHERE id=:id', { ':c': color, ':id': id });
    }
    await window.SGF.db.save();
    renderTree(containerId, kind);
    toast(changed > 0 ? 'Colores regenerados.' : 'Sin cambios.');
  } catch (e) {
    console.error(e);
    alert('No se pudo regenerar colores.');
  }
};
window.SGF.actions.deleteType = async (id) => {
  const ok = await (window.SGF.uiConfirm?.({
    title: 'Eliminar tipo de cuenta',
    message: '¿Eliminar este tipo de cuenta?',
    confirmText: 'Eliminar',
    cancelText: 'Cancelar',
    danger: true,
  }) ?? Promise.resolve(confirm('¿Eliminar tipo?')));
  if (!ok) return;
  try {
    const row = window.SGF.db.select('SELECT id, is_base FROM account_types WHERE id=:id', { ':id': id })[0];
    if (!row) {
      toast('No encontrado.');
      return;
    }
    if (Number(row.is_base) === 1) {
      toast('No se puede eliminar: es un tipo base.');
      return;
    }
    const inUse = Number(window.SGF.db.scalar('SELECT COUNT(*) AS c FROM accounts WHERE type_id=:id', { ':id': id }) || 0);
    if (inUse > 0) {
      toast('No se puede eliminar: hay cuentas usando este tipo.');
      return;
    }
    const changed = window.SGF.db.run('DELETE FROM account_types WHERE id=:id', { ':id': id });
    await window.SGF.db.save();
    renderTiposCuenta();
    toast(changed > 0 ? 'Eliminado.' : 'No se eliminó (sin cambios).');
  } catch (e) {
    console.error(e);
    alert('No se pudo eliminar.');
  }
};

// --- Hooks de precarga al abrir modal ---
function patchModalPrefill() {
  const orig = window.openModal;
  if (orig.__patched) return;
  const patched = async (key, ctx = {}) => {
    orig(key, ctx);

    if (key === 'type_new' && ctx.mode === 'edit' && ctx.id) {
      const r = window.SGF.db.select('SELECT id,name FROM account_types WHERE id=:id', { ':id': ctx.id })[0];
      if (r) document.getElementById('type-name').value = r.name;
    }

    if (key === 'acc_new') {
      if (ctx.mode === 'edit' && ctx.id) {
        const r = window.SGF.db.select('SELECT * FROM accounts WHERE id=:id', { ':id': ctx.id })[0];
        await fillAccountTypeOptions('acc-type', r?.type_id);
        await fillAccountParentOptions('acc-parent', r?.parent_id, r?.id);
        if (r) {
          document.getElementById('acc-name').value = r.name || '';
          document.getElementById('acc-currency').value = r.currency || 'CRC';
          document.getElementById('acc-color').value = r.color || '#3b82f6';
          document.getElementById('acc-opening').value = Number(r.initial_balance || 0).toFixed(2);
          document.getElementById('acc-active').checked = !!r.active;
          document.getElementById('acc-allow-neg').checked = !!r.allow_negative;
        }
      } else {
        await fillAccountTypeOptions('acc-type');
        await fillAccountParentOptions('acc-parent', ctx.parentId || null);
      }
    }

    if (key === 'cat_new') {
      if (ctx.mode === 'edit' && ctx.id) {
        const r = window.SGF.db.select('SELECT * FROM categories WHERE id=:id', { ':id': ctx.id })[0];
        await fillCategoryParentOptions('cat-parent', r?.parent_id, r?.id);
        if (r) {
          document.getElementById('cat-name').value = r.name || '';
          document.getElementById('cat-color').value = r.color || '#10b981';
          document.getElementById('cat-active').checked = !!r.active;
        }
      } else {
        await fillCategoryParentOptions('cat-parent', ctx.parentId || null);
      }
    }
  };
  patched.__patched = true;
  window.openModal = patched;
}

patchModalPrefill();

window.SGF.modules.cuentas = {
  onMount() {
    wireCatalogClickHandlers();
    renderTree('tree-cuentas', 'cuentas');
  }
};

window.SGF.modules.categorias = {
  onMount() {
    wireCatalogClickHandlers();
    renderTree('tree-categorias', 'categorias');
  }
};

window.SGF.modules.tipos = {
  onMount() {
    wireCatalogClickHandlers();
    renderTiposCuenta();
    wireTiposFilter?.();
  }
};
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
    if (!window.SGF.closureGuard || !window.SGF.closureGuard.assertNotClosedForChange) return;
    window.SGF.closureGuard.assertNotClosedForChange(op, oldMov, newMov);
  }

  function dbSelectMovementById(id) {
    return window.SGF.db.select('SELECT * FROM movements WHERE id=:id LIMIT 1', { ':id': Number(id) })[0] || null;
  }


