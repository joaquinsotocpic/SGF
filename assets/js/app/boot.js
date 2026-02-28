// Boot SGF v1.17.16

window.SGF = window.SGF || {};
window.SGF.APP_VERSION = '1.32.6';

// Nota: La delegación del Split de movimientos vive en el módulo de Movimientos.
// Mantenerla aquí causaba doble-toggle (dos listeners capturando el mismo click),
// lo que podía dar la impresión de que el botón "Activar Split" no funcionaba.
window.SGF.modules = window.SGF.modules || {};

function showSection(sectionId) {
  window.SGF.navigate(sectionId);
}

function logout() {
  location.reload();
}

function setBusy(btn, busy) {
  if (!btn) return;
  btn.disabled = !!busy;
  btn.classList.toggle('opacity-70', !!busy);
  btn.classList.toggle('cursor-not-allowed', !!busy);
}

function safeToast(msg) {
  try { toast(msg); } catch (_) { try { alert(msg); } catch (_) {} }
}

function wireLoginOnce() {
  // IMPORTANTE: este método debe llamar a wireLogin() (no a sí mismo).
  // Una recursión accidental aquí deja el Gate sin listeners y parece que
  // “ningún botón hace nada”.
  if (window.__sgfLoginWired) return;
  window.__sgfLoginWired = true;
  try {
    wireLogin();
  } catch (e) {
    console.error(e);
    safeToast(e?.message || 'Error inicializando login.');
    // Permitir reintento manual si falló antes de enlazar.
    window.__sgfLoginWired = false;
  }
}

async function showAppShell() {
  document.getElementById('login-container')?.classList.add('hidden');
  document.getElementById('app-container')?.classList.remove('hidden');

  // mostrar usuario en header
  const u = window.SGF?.session?.username || '—';
  const ud = document.getElementById('user-display');
  if (ud) ud.textContent = u;

  // version
  const v = document.getElementById('app-version');
  if (v) v.textContent = 'v' + (window.SGF.APP_VERSION || '');

  // Wire botones de sesión (solo una vez)
  const btnSave = document.getElementById('btn-save-session');
  const btnExport = document.getElementById('btn-export-vault');
  if (btnSave && !btnSave.__wired) {
    btnSave.__wired = true;
    btnSave.addEventListener('click', async () => {
      try {
        await window.SGF.db.save();
        toast('Sesión guardada localmente.');
      } catch (e) {
        console.error(e);
        toast(e?.message || 'No se pudo guardar.');
      }
    });
  }
  if (btnExport && !btnExport.__wired) {
    btnExport.__wired = true;
    btnExport.addEventListener('click', async () => {
      try {
        await window.SGF.vault.exportCurrentVaultFile();
        toast('Exportación iniciada.');
      } catch (e) {
        console.error(e);
        toast(e?.message || 'No se pudo exportar.');
      }
    });
  }

  // Seed/migraciones (await para evitar queries con columnas faltantes)
  try { await window.SGF.migrate?.ensureAll?.(); } catch (e) { console.warn('migrate.ensureAll', e); }

  showSection('dashboard');
  window.lucide?.createIcons?.();
}

function wireLogin() {
  const form = document.getElementById('login-form');
  const btnOpen = document.getElementById('btn-open');
  const btnCreate = document.getElementById('btn-create');
  const btnDeleteAll = document.getElementById('btn-delete-all');
  if (!form) return;

  async function openFlow() {
    const username = (document.getElementById('username')?.value || '').trim();
    const password = document.getElementById('password')?.value || '';
    if (!username) { toast('Usuario requerido.'); return; }
    if ((password || '').length < 6) { toast('La contraseña debe tener mínimo 6 caracteres.'); return; }
    setBusy(btnOpen, true);
    setBusy(btnCreate, true);
    try {
      await window.SGF.vault.openUser(username, password);
      toast('Bóveda abierta.');
      await showAppShell();
    } catch (err) {
      toast(err?.message || 'No se pudo abrir.');
    } finally {
      setBusy(btnOpen, false);
      setBusy(btnCreate, false);
    }
  }

  async function createFlow() {
    const username = (document.getElementById('username')?.value || '').trim();
    const password = document.getElementById('password')?.value || '';
    if (!username) { toast('Usuario requerido.'); return; }
    if ((password || '').length < 6) { toast('La contraseña debe tener mínimo 6 caracteres.'); return; }
    setBusy(btnOpen, true);
    setBusy(btnCreate, true);
    try {
      // Si existe, permitir overwrite confirmado
      try {
        await window.SGF.vault.createUser(username, password, { overwrite: false });
      } catch (e) {
        if ((e?.message || '').includes('ya existe')) {
          const ok = confirm('El usuario ya existe. ¿Deseas recrear la bóveda desde 0? (Esto reemplaza la base local y auto-backups)');
          if (!ok) return;
          await window.SGF.vault.createUser(username, password, { overwrite: true });
        } else {
          throw e;
        }
      }
      toast('Usuario creado y bóveda lista.');
      await showAppShell();
    } catch (err) {
      toast(err?.message || 'No se pudo crear.');
    } finally {
      setBusy(btnOpen, false);
      setBusy(btnCreate, false);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await openFlow();
  });

  btnCreate?.addEventListener('click', async () => {
    await createFlow();
  });

  // Eliminar TODOS
  btnDeleteAll?.addEventListener('click', async () => {
    try {
      const users = await window.SGF.vault.listLocalUsers();
      if (!users || !users.length) {
        safeToast('No hay usuarios locales para eliminar.');
        return;
      }
      const list = users.map(u => `• ${typeof u === 'string' ? u : (u?.username || u?.name || u?.user || String(u))}`).join('\n');
      const msg = `Se eliminarán estos usuarios de este dispositivo:\n\n${list}\n\nEsto borra también auto-backups locales.`;
      const ok = window.SGF.uiConfirm
        ? await window.SGF.uiConfirm({
            title: 'Eliminar usuarios',
            message: msg,
            confirmText: 'Eliminar',
            cancelText: 'Cancelar',
            danger: true,
          })
        : confirm(msg);
      if (!ok) return;
    } catch (e) {
      console.warn('listLocalUsers', e);
      const ok2 = window.SGF.uiConfirm
        ? await window.SGF.uiConfirm({
            title: 'Eliminar usuarios',
            message: '¿Eliminar TODOS los usuarios/bóvedas locales en este dispositivo?\n\nEsto borra también auto-backups locales.',
            confirmText: 'Eliminar',
            cancelText: 'Cancelar',
            danger: true,
          })
        : confirm('¿Eliminar TODOS los usuarios/bóvedas locales en este dispositivo?');
      if (!ok2) return;
    }
    try {
      await window.SGF.vault.deleteAllUsers();
      safeToast('Usuarios eliminados localmente.');
      const u = document.getElementById('username');
      if (u) u.value = '';
      const p = document.getElementById('password');
      if (p) p.value = '';
    } catch (err) {
      safeToast(err?.message || 'No se pudo eliminar.');
    }
  });
}

window.showSection = showSection;
window.logout = logout;

document.addEventListener('DOMContentLoaded', () => { wireLoginOnce(); });

window.addEventListener('load', async () => {
  window.lucide?.createIcons?.();

  try {
    await window.SGF.vault.initSql();
  } catch (err) {
    console.error(err);
    safeToast(err?.message || 'No se pudo inicializar SQL.');
  }

  wireLoginOnce();
});


// v1.30.2 - mostrar versión en login si existe
window.addEventListener('DOMContentLoaded', ()=>{
  try{
    const el=document.getElementById('sgf-version');
    if (el && window.SGF && window.SGF.APP_VERSION) el.textContent = window.SGF.APP_VERSION;
  }catch(_){ }
});
