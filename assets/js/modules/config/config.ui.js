window.SGF = window.SGF || {}; window.SGF.modules = window.SGF.modules || {};

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
  return typeof fn === 'function' ? fn() : isoToCR(new Date().toISOString().slice(0, 10));
}

function applyTheme(theme) {
  // En esta base: theme-dark como clase
  document.body.classList.toggle('theme-dark', theme === 'dark');
}

function getConfig(key, fallback = '') {
  const row = window.SGF.db.select('SELECT value FROM config WHERE key=:k', { ':k': key })[0];
  return row ? row.value : fallback;
}

async function setConfig(key, value) {
  window.SGF.db.run('INSERT INTO config(key,value) VALUES (:k,:v) ON CONFLICT(key) DO UPDATE SET value=excluded.value', {
    ':k': key,
    ':v': String(value ?? ''),
  });
  await window.SGF.db.save();
}

function renderFxTable() {
  const tbody = document.getElementById('fx-table-body');
  if (!tbody) return;
  const rows = window.SGF.db.select(`
    SELECT rate_date, rate
    FROM exchange_rates
    WHERE from_currency='USD' AND to_currency='CRC'
    ORDER BY rate_date DESC
  `);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td class="p-3 text-sm text-gray-500" colspan="3">Sin registros.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr class="border-b hover:bg-gray-50">
      <td class="p-3 text-sm">${isoToCR(r.rate_date)}</td>
      <td class="p-3 text-sm font-semibold">${Number(r.rate).toFixed(2)}</td>
      <td class="p-3">
        <div class="flex gap-2">
          <button type="button" class="text-blue-600 hover:bg-blue-50 p-1 rounded" data-action="fx-edit" data-date="${r.rate_date}"><i data-lucide="edit" class="w-4 h-4"></i></button>
          <button type="button" class="text-red-600 hover:bg-red-50 p-1 rounded" data-action="fx-delete" data-date="${r.rate_date}"><i data-lucide="trash" class="w-4 h-4"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
  window.lucide?.createIcons?.();
}

function wireConfigClickHandlers() {
  if (wireConfigClickHandlers.__wired) return;
  document.addEventListener('click', (e) => {
    const btn = e.target?.closest?.('button[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (action !== 'fx-edit' && action !== 'fx-delete') return;
    e.preventDefault();
    e.stopPropagation();
    const date = btn.getAttribute('data-date');
    if (!date) return;
    if (action === 'fx-edit') {
      openModal('fx_new', { mode: 'edit', date });
    } else {
      window.SGF.actions.deleteFx(date);
    }
  }, { capture: true });
  wireConfigClickHandlers.__wired = true;
}

function wireThemeButtons() {
  const light = document.getElementById('btn-theme-light');
  const dark = document.getElementById('btn-theme-dark');
  if (light) light.onclick = async () => {
    await setConfig('theme', 'light');
    applyTheme('light');
    toast('Tema claro guardado.');
  };
  if (dark) dark.onclick = async () => {
    await setConfig('theme', 'dark');
    applyTheme('dark');
    toast('Tema oscuro guardado.');
  };
}

function renderSavingsDefaultSelects() {
  const selCrc = document.getElementById('cfg-savings-crc');
  const selUsd = document.getElementById('cfg-savings-usd');
  if (!selCrc || !selUsd) return;

  // Cargar cuentas de tipo Ahorros
  const tipoAhorros = window.SGF.db.scalar("SELECT id FROM account_types WHERE name='Ahorros' LIMIT 1") || 0;
  const accounts = window.SGF.db.select(
    'SELECT id,name,currency FROM accounts WHERE type_id=:t AND active=1 ORDER BY currency,name',
    { ':t': Number(tipoAhorros) }
  );
  const build = (sel, currency) => {
    const opts = ['<option value="">(Sin asignar)</option>']
      .concat(accounts.filter(a => String(a.currency) === currency).map(a => `<option value="${a.id}">${a.name}</option>`));
    sel.innerHTML = opts.join('');
  };
  build(selCrc, 'CRC');
  build(selUsd, 'USD');

  const curCrc = getConfig('defaultSavingsCrcAccountId', '');
  const curUsd = getConfig('defaultSavingsUsdAccountId', '');
  if (curCrc) selCrc.value = String(curCrc);
  if (curUsd) selUsd.value = String(curUsd);

  selCrc.onchange = async () => {
    await setConfig('defaultSavingsCrcAccountId', selCrc.value || '');
    toast('Ahorro CRC predeterminado guardado.');
  };
  selUsd.onchange = async () => {
    await setConfig('defaultSavingsUsdAccountId', selUsd.value || '');
    toast('Ahorro USD predeterminado guardado.');
  };
}

function wireMaintenanceButtons() {
  const bDemo = document.getElementById('btn-maint-demo');
  const bBase = document.getElementById('btn-maint-base');
  const bDiag = document.getElementById('btn-maint-diagnose');
  const bReset = document.getElementById('btn-maint-reset');

  const m = window.SGF.maintenance;

  async function run(btn, fn, label) {
    if (!btn) return;
    if (typeof fn !== 'function') {
      toast(`No disponible: ${label}. Revisa que la sesión esté abierta.`);
      return;
    }
    const prev = btn.innerHTML;
    try {
      btn.disabled = true;
      btn.classList.add('opacity-70', 'cursor-not-allowed');
      btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i><span>Procesando...</span>`;
      window.lucide?.createIcons?.();
      await fn();
    } catch (e) {
      console.error(e);
      toast(e?.message || `Error en ${label}.`);
    } finally {
      btn.disabled = false;
      btn.classList.remove('opacity-70', 'cursor-not-allowed');
      btn.innerHTML = prev;
      window.lucide?.createIcons?.();
    }
  }

  if (bDemo) bDemo.onclick = () => run(bDemo, m?.loadDemo, 'Cargar demo');
  if (bBase) bBase.onclick = () => run(bBase, m?.loadBase, 'Cargar base');
  if (bDiag) bDiag.onclick = () => run(bDiag, m?.diagnoseRepair, 'Diagnosticar y reparar');
  if (bReset) bReset.onclick = () => run(bReset, m?.resetFull, 'Reset completo');
}

// Modal handler
window.SGF.modalHandlers.fx_new = async (ctx) => {
  const dateCR = (document.getElementById('fx-date')?.value || '').trim();
  const date = crToISO(dateCR);
  const rate = Number(document.getElementById('fx-rate')?.value || 0);
  if (!date) throw new Error('Fecha requerida (dd/mm/aaaa).');
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Tipo de cambio inválido.');

  // Evitar duplicados (PK rate_date)
  window.SGF.db.run(`
    INSERT INTO exchange_rates(rate_date,from_currency,to_currency,rate,created_at)
    VALUES (:d,'USD','CRC',:r,:t)
    ON CONFLICT(rate_date) DO UPDATE SET rate=excluded.rate
  `, { ':d': date, ':r': rate, ':t': new Date().toISOString() });

  await window.SGF.db.save();
  closeModal();
  renderFxTable();
  toast('Tipo de cambio guardado.');
};

window.SGF.actions = window.SGF.actions || {};
window.SGF.actions.deleteFx = async (date) => {
  const ok = await (window.SGF.uiConfirm?.({
    title: 'Eliminar tipo de cambio',
    message: `¿Eliminar el tipo de cambio USD→CRC de la fecha ${isoToCR(date)}?`,
    confirmText: 'Eliminar',
    cancelText: 'Cancelar',
    danger: true,
  }) ?? Promise.resolve(confirm('¿Eliminar tipo de cambio de esta fecha?')));
  if (!ok) return;
  try {
    // rate_date es PK. Aún así, filtramos por par de monedas para mayor seguridad.
    const changed = window.SGF.db.run(
      "DELETE FROM exchange_rates WHERE rate_date=:d AND from_currency='USD' AND to_currency='CRC'",
      { ':d': date }
    );
    await window.SGF.db.save();
    renderFxTable();
    toast(changed > 0 ? 'Eliminado.' : 'No se eliminó (sin cambios).');
  } catch (e) {
    console.error(e);
    toast('No se pudo eliminar.');
  }
};

// Prefill al abrir modal
function patchFxPrefill() {
  const orig = window.openModal;
  if (orig.__fxpatched) return;
  const patched = async (key, ctx = {}) => {
    orig(key, ctx);
    if (key === 'fx_new') {
      if (ctx.mode === 'edit' && ctx.date) {
        const r = window.SGF.db.select(`SELECT rate_date, rate FROM exchange_rates WHERE rate_date=:d AND from_currency='USD' AND to_currency='CRC'`, { ':d': ctx.date })[0];
        if (r) {
          document.getElementById('fx-date').value = isoToCR(r.rate_date);
          document.getElementById('fx-rate').value = r.rate;
        }
      } else {
        document.getElementById('fx-date').value = todayCR();
        document.getElementById('fx-rate').value = '';
      }
    }
  };
  patched.__fxpatched = true;
  window.openModal = patched;
}

patchFxPrefill();


function wireBackupImport() {
  const btnExport = document.getElementById('btn-vault-export');
  const btnImport = document.getElementById('btn-vault-import');
  const fileInput = document.getElementById('vault-import-file');
  const chkAuto = document.getElementById('cfg-auto-backup');
  const btnLatest = document.getElementById('btn-vault-latest-backup');
  const btnRestore = document.getElementById('btn-vault-restore-latest-backup');
  const lblLast = document.getElementById('lbl-last-backup');

  function getConfig(key, fallback='') {
    try {
      return String(window.SGF.db?.scalar?.('SELECT value FROM config WHERE key=:k', { ':k': key }) ?? fallback);
    } catch (_) {
      return String(fallback);
    }
  }

  async function setConfig(key, value) {
    window.SGF.db.run('INSERT INTO config(key,value) VALUES (:k,:v) ON CONFLICT(key) DO UPDATE SET value=excluded.value', { ':k': key, ':v': String(value) });
    await window.SGF.db.save();
  }

  async function refreshBackupLabel() {
    try {
      const rows = await window.SGF.vault.listBackups();
      if (!lblLast) return;
      if (!rows.length) {
        lblLast.textContent = 'Sin auto-backups.';
      } else {
        const dt = String(rows[0].createdAt || '').replace('T',' ').replace('Z','');
        lblLast.textContent = 'Último: ' + dt;
      }
    } catch (_) {
      if (lblLast) lblLast.textContent = '';
    }
  }

  if (chkAuto) {
    chkAuto.checked = getConfig('autoBackup', '0') === '1';
    chkAuto.onchange = async () => {
      try {
        await setConfig('autoBackup', chkAuto.checked ? '1' : '0');
        toast(chkAuto.checked ? 'Auto-backup activado.' : 'Auto-backup desactivado.');
        await refreshBackupLabel();
      } catch (e) {
        console.error(e);
        toast('No se pudo guardar la preferencia.');
      }
    };
  }

  if (btnExport) {
    btnExport.onclick = async () => {
      try {
        await window.SGF.db.save();
        await window.SGF.vault.exportCurrentVaultFile();
        toast('Respaldo exportado.');
        await refreshBackupLabel();
      } catch (e) {
        console.error(e);
        toast(String(e?.message || e || 'Error al exportar respaldo.'));
      }
    };
  }

  if (btnImport && fileInput) {
    btnImport.onclick = () => fileInput.click();
    fileInput.onchange = async (ev) => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      try {
        const txt = await f.text();
        const payload = JSON.parse(txt);
        await window.SGF.vault.importVaultPayload(payload, { overwrite: true });

        const importedUser = String(payload?.username || '');
        const currentUser = String(window.SGF?.session?.username || '');
        if (importedUser && currentUser && importedUser === currentUser) {
          toast('Respaldo importado. Cierra sesión e inicia nuevamente para aplicarlo.');
        } else {
          toast(`Respaldo importado para usuario: ${importedUser || '(desconocido)'}.`);
        }
      } catch (e) {
        console.error(e);
        toast(String(e?.message || e || 'Error al importar respaldo.'));
      } finally {
        fileInput.value = '';
        await refreshBackupLabel();
      }
    };
  }

  if (btnLatest) {
    btnLatest.onclick = async () => {
      try {
        await window.SGF.vault.downloadLatestBackupFile();
      } catch (e) {
        console.error(e);
        toast(e?.message || 'No hay auto-backups para descargar.');
      }
    };
  }

  if (btnRestore) {
    btnRestore.onclick = async () => {
      const ok = confirm('¿Restaurar el último auto-backup? Esto reemplaza la bóveda local.');
      if (!ok) return;
      try {
        await window.SGF.vault.restoreLatestBackup();
        toast('Auto-backup restaurado. Recargando...');
        setTimeout(() => location.reload(), 350);
      } catch (e) {
        console.error(e);
        toast(e?.message || 'No se pudo restaurar.');
      }
    };
  }

  refreshBackupLabel();
}


function wireCurrencyConfig() {
  const baseSel = document.getElementById('cfg-base-currency');
  const secSel = document.getElementById('cfg-secondary-currency');
  const defFx = document.getElementById('cfg-default-usdcrc');

  if (baseSel) baseSel.value = getConfig('baseCurrency', 'CRC');
  if (secSel) secSel.value = getConfig('secondaryCurrency', 'USD');
  if (defFx) defFx.value = String(getConfig('defaultUsdToCrc', '0'));

  function persist(key, value) {
    window.SGF.db.run('INSERT OR REPLACE INTO config(key,value) VALUES (:k,:v)', { ':k': key, ':v': String(value) });
    window.SGF.db.save();
  }

  function normalize() {
    const b = String(baseSel?.value || 'CRC');
    const s = String(secSel?.value || 'USD');
    if (b === s) {
      // auto-ajuste: secundaria distinta
      const next = (b === 'CRC') ? 'USD' : 'CRC';
      if (secSel) secSel.value = next;
    }
    persist('baseCurrency', String(baseSel?.value || 'CRC'));
    persist('secondaryCurrency', String(secSel?.value || 'USD'));

    // Nota: el motor FX v1.16 soporta CRC(base) y USD(sec). Si se cambia, se muestra aviso.
    const finalBase = String(baseSel?.value || 'CRC');
    const finalSec = String(secSel?.value || 'USD');
    if (!(finalBase === 'CRC' && finalSec === 'USD')) {
      window.SGF.ui?.toast?.('Aviso: FX histórico v1.16 está optimizado para base CRC y secundaria USD.');
    }
  }

  baseSel?.addEventListener('change', normalize);
  secSel?.addEventListener('change', normalize);

  defFx?.addEventListener('change', () => {
    const v = Number(defFx.value || 0);
    if (!Number.isFinite(v) || v < 0) {
      window.SGF.ui?.toast?.('Tipo de cambio por defecto inválido.');
      return;
    }
    persist('defaultUsdToCrc', String(v));
  });
}
window.SGF.modules.config = {
  onMount() {
    // Prioridad: que Mantenimiento siempre funcione aunque algo más falle
    try { wireMaintenanceButtons(); } catch (e) { console.error(e); }

    try { wireConfigClickHandlers(); } catch (e) { console.error(e); }
    try { wireThemeButtons(); } catch (e) { console.error(e); }

    try {
      const theme = getConfig('theme', 'light');
      applyTheme(theme);
    } catch (e) { console.error(e); }

    try { renderFxTable(); } catch (e) { console.error(e); }
    try { renderSavingsDefaultSelects(); } catch (e) { console.error(e); }
    try { wireBackupImport(); } catch (e) { console.error(e); }
    try { wireCurrencyConfig(); } catch (e) { console.error(e); }
  }
};
