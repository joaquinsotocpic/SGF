// Router simple por vistas (Opción 3)
// Carga /views/<seccion>.html dentro de #view-root

const SGF_ROUTES = {
  dashboard: { title: 'Dashboard', view: 'dashboard.html' },
  movimientos: { title: 'Movimientos', view: 'movimientos.html' },
  ahorros: { title: 'Ahorros', view: 'ahorros.html' },
  presupuestos: { title: 'Presupuestos', view: 'presupuestos.html' },
  conciliacion: { title: 'Conciliación', view: 'conciliacion.html' },
  cuentas: { title: 'Cuentas', view: 'catalogos-cuentas.html' },
  tipos: { title: 'Tipos de Cuenta', view: 'catalogos-tipos.html' },
  categorias: { title: 'Categorías', view: 'catalogos-categorias.html' },
  reportes_resumen_cuentas: { title: 'Reportes · Resumen por cuentas', view: 'reportes-resumen-cuentas.html' },
  reportes_resumen_categorias: { title: 'Reportes · Resumen por categorías', view: 'reportes-resumen-categorias.html' },
  reportes_estado_resultados: { title: 'Reportes · Estado de Resultados', view: 'reportes-estado-resultados.html' },
  reportes_flujo_caja: { title: 'Reportes · Flujo de Caja', view: 'reportes-flujo-caja.html' },
  reportes_presupuesto_vs_real: { title: 'Reportes · Presupuesto vs Real', view: 'reportes-presupuesto-vs-real.html' },
  reportes_tendencias_12m: { title: 'Reportes · Tendencias (12 meses)', view: 'reportes-tendencias-12m.html' },
  reportes_insights: { title: 'Reportes · Insights', view: 'reportes-insights.html' },
  reportes_comparativo_mes: { title: 'Reportes · Comparativo Mes a Mes', view: 'reportes-comparativo-mes.html' },
  reportes_balance_cuentas: { title: 'Reportes · Balance por Cuenta', view: 'reportes-balance-cuentas.html' },
  config: { title: 'Configuración', view: 'config.html' },
};

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

async function navigate(sectionId) {
  const route = SGF_ROUTES[sectionId] || SGF_ROUTES.dashboard;
  const root = document.getElementById('view-root');
  const titleEl = document.getElementById('section-title');

  if (!root) {
    console.error('Router: no existe #view-root');
    return;
  }
  if (!titleEl) {
    console.error('Router: no existe #section-title');
    return;
  }

  titleEl.textContent = route.title;

  // 1) Cargar la vista (template inline o fetch)
  try {
    const tpl = document.getElementById(`sgf-view-${route.view}`);
    if (tpl) {
      root.innerHTML = tpl.innerHTML;
    } else {
      const res = await fetch(`views/${route.view}?v=${encodeURIComponent(window.SGF?.APP_VERSION || Date.now())}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      root.innerHTML = await res.text();
    }
  } catch (err) {
    root.innerHTML = `
      <div class="bg-white p-6 rounded-xl shadow-sm border">
        <h3 class="text-lg font-bold mb-2">No se pudo cargar la vista</h3>
        <p class="text-gray-500 mb-4">Esto suele pasar si abres el archivo con <code>file://</code> (bloqueo de <code>fetch</code>).</p>
        <div class="bg-gray-50 border rounded-lg p-4 text-sm text-gray-700">
          <p class="font-semibold mb-2">Solución rápida (servidor local):</p>
          <ol class="list-decimal ml-5 space-y-1">
            <li>Abre una terminal en la carpeta del proyecto</li>
            <li>Ejecuta: <code>python -m http.server 8000</code></li>
            <li>Abre: <code>http://localhost:8000</code></li>
          </ol>
        </div>
        <p class="text-xs text-gray-400 mt-4">Error: ${escapeHtmlSafe(String(err))}</p>
      </div>
    `;
    return;
  }

  // 2) Re-render icons
  try { window.lucide?.createIcons?.(); } catch (_) {}

  // 3) Hook del módulo (si falla, no "romper" el router)
  try {
    // Asegurar migraciones antes de ejecutar lógica del módulo
    try { await window.SGF?.migrate?.ensureAll?.(); } catch (e) { console.warn(e); }

    if (window.SGF?.modules?.[sectionId]?.onMount) {
      // Permitir onMount async sin romper navegación
      await window.SGF.modules[sectionId].onMount();
    }
  } catch (err) {
    console.error(err);
    try { (window.toast || window.SGF?.ui?.toast || window.alert)?.call(null, err?.message || String(err)); } catch (_) {}
  }

  // 4) En móvil, cerrar sidebar
  if (window.innerWidth < 1024) {
    document.getElementById('sidebar')?.classList.add('-translate-x-full');
  }
}

window.SGF = window.SGF || {};
window.SGF.navigate = navigate;
