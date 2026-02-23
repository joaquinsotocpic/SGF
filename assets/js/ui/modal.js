// Modal genérico (UI-only). La lógica de guardado se implementa luego.

window.SGF = window.SGF || {};
window.SGF.modalHandlers = window.SGF.modalHandlers || {};

const MODAL_TEMPLATES = {
  rep_drill: {
    title: 'Movimientos',
    hideSave: true,
    html: `
      
      <div class="space-y-3">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div id="repdr-subtitle" class="text-sm font-semibold text-slate-900">Movimientos</div>
            <div class="text-xs text-slate-500" id="repdr-range">—</div>
          </div>
          <div class="text-right">
            <div id="repdr-total" class="text-sm font-semibold text-slate-900">—</div>
            <div id="repdr-count" class="text-xs text-slate-500">—</div>
          </div>
        </div>
        <div id="repdr-chips" class="flex flex-wrap gap-2"></div>

        <div class="overflow-auto border rounded-xl">
          <table class="w-full text-sm">
            <thead class="text-slate-600">
              <tr class="border-b">
                <th class="text-left py-2 px-3 whitespace-nowrap">Fecha</th>
                <th class="text-left py-2 px-3">Descripción</th>
                <th class="text-left py-2 px-3">Detalle</th>
                <th class="text-right py-2 px-3 whitespace-nowrap">Monto</th>
              </tr>
            </thead>
            <tbody id="repdr-tbody" class="text-slate-800"></tbody>
          </table>
        </div>
        <div class="text-xs text-slate-500" id="repdr-foot">—</div>
      </div>
    `,
  },

  mov_new: {
    title: 'Nuevo Movimiento',
    html: `
      <div class="grid grid-cols-1 gap-3">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium mb-1">Tipo</label>
            <select id="mov-type" class="w-full p-2 border rounded-lg">
              <option>Gasto</option><option>Ingreso</option><option>Transferencia</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Fecha</label>
            <input id="mov-date" type="text" inputmode="numeric" placeholder="dd/mm/aaaa" class="w-full p-2 border rounded-lg" />
            <p class="text-xs text-gray-400 mt-1">Formato CR: dd/mm/aaaa</p>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium mb-1">Periodo contable</label>
            <!-- Se llena dinámicamente con opciones en español (valor: YYYY-MM) -->
            <select id="mov-period" class="w-full p-2 border rounded-lg"></select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Moneda (según cuenta)</label>
            <input id="mov-currency" readonly class="w-full p-2 border rounded-lg bg-gray-100 cursor-not-allowed" value="CRC" />
            <p class="text-xs text-gray-400 mt-1">Solo referencia: la moneda se define por la cuenta.</p>
          </div>
        </div>

        <div id="mov-fx-box" class="hidden border rounded-xl p-3 bg-gray-50">
          <p class="font-semibold text-sm mb-2">Tipo de cambio (transferencia multi-moneda)</p>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium mb-1">Tasa (origen → destino)</label>
              <input id="mov-fx-rate" type="number" step="0.0001" class="w-full p-2 border rounded-lg" placeholder="Ej: 540.25" />
              <p id="mov-fx-hint" class="text-xs text-gray-400 mt-1">Se sugiere según histórico por fecha.</p>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Monto destino (calculado)</label>
              <input id="mov-amount-to" readonly class="w-full p-2 border rounded-lg bg-gray-100 cursor-not-allowed" value="0.00" />
              <p class="text-xs text-gray-400 mt-1">Destino = Origen × Tasa</p>
            </div>
          </div>
        </div>

        <div class
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium mb-1">Cuenta origen</label>
            <select id="mov-account" class="w-full p-2 border rounded-lg"></select>
            <div class="text-xs text-gray-500 mt-1">Saldo actual: <span id="mov-account-balance" class="font-semibold text-blue-600">₡ 0.00</span></div>
          </div>
          <div id="mov-dest-group" class="hidden">
            <label class="block text-sm font-medium mb-1">Cuenta destino</label>
            <select id="mov-account-to" class="w-full p-2 border rounded-lg"></select>
            <p class="text-xs text-gray-400 mt-1">Visible solo si el tipo es Transferencia.</p>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium mb-1">Categoría</label>
            <select id="mov-category-single" class="w-full p-2 border rounded-lg"></select>
            <div class="mt-2">
              <button id="mov-split-toggle" type="button" class="px-3 py-2 rounded-lg bg-white border w-full flex items-center justify-center gap-2 text-sm">
                <i data-lucide="git-branch" class="w-4 h-4"></i><span>Activar Split de categorías</span>
              </button>
              <p class="text-xs text-gray-400 mt-1">Opcional: habilita Split solo si lo necesitas.</p>
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Monto</label>
            <input id="mov-amount" type="number" step="0.01" class="w-full p-2 border rounded-lg" placeholder="0.00" />
          </div>
        </div>

        <div id="mov-split-box" class="hidden border rounded-xl p-3 bg-gray-50">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <p class="font-semibold text-sm">Split de categorías</p>
            <button id="mov-split-add" type="button" class="px-3 py-2 rounded-lg bg-gray-200 text-sm">Agregar fila</button>
          </div>
          <div class="mt-3 bg-white border rounded-lg overflow-hidden">
            <table class="w-full text-left text-sm">
              <thead class="bg-gray-50 border-b">
                <tr>
                  <th class="p-2">Categoría</th>
                  <th class="p-2">Monto</th>
                  <th class="p-2">Acción</th>
                </tr>
              </thead>
              <tbody id="mov-split-rows"></tbody>
            </table>
          </div>
          <p class="text-xs text-gray-400 mt-2">UI-only: luego se validará que la suma del split coincida con el monto.</p>
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">Descripción</label>
          <input id="mov-desc" type="text" class="w-full p-2 border rounded-lg" placeholder="Opcional" />
        </div>

        <div class="grid grid-cols-1 gap-3">
          <div>
            <label class="block text-sm font-medium mb-1">Referencia / URL</label>
            <textarea id="mov-ref" rows="3" class="w-full p-2 border rounded-lg" placeholder="https://... o referencia interna"></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Adjuntos (texto)</label>
            <textarea id="mov-att" rows="3" class="w-full p-2 border rounded-lg" placeholder="Factura.pdf | /adjuntos/2026/...\nComprobante.png | /adjuntos/..."></textarea>
            <p class="text-xs text-gray-400 mt-1">UI-only: luego se modelará como lista (nombre + referencia).</p>
          </div>
        </div>
      </div>
    `
  },
  mov_rec: {
    title: 'Movimientos Recurrentes',
    html: `
      <div class="space-y-4">
        <div class="flex flex-col lg:flex-row lg:items-end justify-between gap-3">
          <div class="flex gap-2 flex-wrap">
            <button id="rec-new" type="button" class="bg-gray-200 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
              <i data-lucide="plus" class="w-4 h-4"></i><span>Nueva plantilla</span>
            </button>
          </div>
          <div class="flex gap-2 flex-wrap items-end">
            <div class="w-full sm:w-56">
              <label class="block text-xs font-semibold text-gray-500 mb-1">Generar para</label>
              <select id="rec-gen-period" class="w-full p-2 border rounded-lg text-sm"></select>
            </div>
            <button id="rec-gen-btn" type="button" class="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2">
              <i data-lucide="repeat" class="w-4 h-4"></i><span>Generar por mes</span>
            </button>
          </div>
        </div>

        <div class="border rounded-xl p-4 bg-gray-50">
          <input type="hidden" id="rec-id" />
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium mb-1">Nombre</label>
              <input id="rec-name" class="w-full p-2 border rounded-lg" placeholder="Internet, Salario, Luz..." />
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-medium mb-1">Tipo</label>
                <select id="rec-type" class="w-full p-2 border rounded-lg">
                  <option>Gasto</option><option>Ingreso</option><option>Transferencia</option>
                </select>
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">Día del mes</label>
                <input id="rec-day" type="number" min="1" max="31" class="w-full p-2 border rounded-lg" placeholder="1" />
              </div>
            </div>

            <!-- Cuentas: hacer Cuenta origen más ancha -->
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div class="sm:col-span-2">
                <label class="block text-sm font-medium mb-1">Cuenta origen</label>
                <select id="rec-account" class="w-full p-2 border rounded-lg"></select>
              </div>
              <div id="rec-dest-group" class="hidden sm:col-span-1">
                <label class="block text-sm font-medium mb-1">Cuenta destino</label>
                <select id="rec-account-to" class="w-full p-2 border rounded-lg"></select>
              </div>
            </div>

            <!-- Categoría: hacer más ancha -->
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div class="sm:col-span-2">
                <label class="block text-sm font-medium mb-1">Categoría (opcional)</label>
                <select id="rec-category" class="w-full p-2 border rounded-lg"></select>
              </div>
              <div class="sm:col-span-1">
                <label class="block text-sm font-medium mb-1">Monto</label>
                <input id="rec-amount" type="number" step="0.01" class="w-full p-2 border rounded-lg" placeholder="0.00" />
              </div>
            </div>

            <div class="lg:col-span-2">
              <label class="block text-sm font-medium mb-1">Descripción (opcional)</label>
              <textarea id="rec-desc" rows="2" class="w-full p-2 border rounded-lg" placeholder="Opcional"></textarea>
              <label class="flex items-center gap-2 text-sm mt-2">
                <input id="rec-active" type="checkbox" checked /> Activa
              </label>
              <p class="text-xs text-gray-500 mt-2">Usa el botón <b>Guardar</b> de abajo para crear/actualizar la plantilla.</p>
            </div>
          </div>
        </div>

        <div class="bg-white border rounded-xl overflow-hidden">
          <table class="w-full text-left text-sm">
            <thead class="bg-gray-50 border-b">
              <tr>
                <th class="p-2">Acciones</th>
                <th class="p-2">Nombre</th>
                <th class="p-2">Tipo</th>
                <th class="p-2">Cuenta</th>
                <th class="p-2">Día</th>
                <th class="p-2">Monto</th>
                <th class="p-2">Activa</th>
              </tr>
            </thead>
            <tbody id="rec-table-body"></tbody>
          </table>
        </div>
      </div>
    `
  },
  sav_new: {
    title: 'Nuevo Ahorro',
    html: `
      <div class="grid grid-cols-1 gap-3">
        <input type="hidden" id="sav-id" />

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium mb-1">Tipo</label>
            <select id="sav-kind" class="w-full p-2 border rounded-lg">
              <option value="deposit">Depósito</option>
              <option value="withdraw">Retiro</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Fecha</label>
            <input id="sav-date" type="text" inputmode="numeric" placeholder="dd/mm/aaaa" class="w-full p-2 border rounded-lg" />
            <p class="text-xs text-gray-400 mt-1">Formato CR: dd/mm/aaaa</p>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium mb-1">Periodo contable</label>
            <select id="sav-period" class="w-full p-2 border rounded-lg"></select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Moneda (según cuenta)</label>
            <input id="sav-currency" readonly class="w-full p-2 border rounded-lg bg-gray-100 cursor-not-allowed" value="CRC" />
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div id="sav-from-group">
            <label class="block text-sm font-medium mb-1">Cuenta origen</label>
            <select id="sav-from-account" class="w-full p-2 border rounded-lg"></select>
            <div class="text-xs text-gray-500 mt-1">Saldo disponible: <span id="sav-from-balance" class="font-semibold text-blue-600">₡ 0.00</span></div>
          </div>

          <div id="sav-to-fixed-group">
            <label class="block text-sm font-medium mb-1">Cuenta ahorro destino</label>
            <input id="sav-to-fixed" readonly class="w-full p-2 border rounded-lg bg-gray-100 cursor-not-allowed" value="" />
            <p class="text-xs text-gray-400 mt-1">La cuenta destino se define automáticamente por la moneda.</p>
          </div>

          <div id="sav-to-group" class="hidden">
            <label class="block text-sm font-medium mb-1">Cuenta destino</label>
            <select id="sav-to-account" class="w-full p-2 border rounded-lg"></select>
            <p class="text-xs text-gray-400 mt-1">En retiros, el origen será la cuenta de ahorros.</p>
          </div>
        </div>

        <div id="sav-ref-group" class="hidden">
          <label class="block text-sm font-medium mb-1">Retirar desde depósito (opcional)</label>
          <select id="sav-ref-deposit" class="w-full p-2 border rounded-lg"></select>
          <p class="text-xs text-gray-400 mt-1">Disponible del depósito: <span id="sav-ref-remaining" class="font-semibold">0.00</span></p>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium mb-1">Categoría (opcional)</label>
            <select id="sav-category" class="w-full p-2 border rounded-lg"></select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Monto</label>
            <input id="sav-amount" type="number" step="0.01" class="w-full p-2 border rounded-lg" placeholder="0.00" />
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">Meta (opcional)</label>
          <select id="sav-goal" class="w-full p-2 border rounded-lg"></select>
        </div>

        <div>
          <label class="block text-sm font-medium mb-1">Descripción</label>
          <input id="sav-desc" class="w-full p-2 border rounded-lg" placeholder="Opcional" />
        </div>

        <p class="text-xs text-gray-400">Depósito: cuenta origen → cuenta de ahorros (según moneda). Retiro: cuenta de ahorros → cuenta destino.</p>
      </div>
    `
  },

  fx_new: {
    title: 'Tipo de Cambio (USD→CRC)',
    html: `
      <div class="space-y-3">
        <div>
          <label class="block text-sm font-medium mb-1">Fecha</label>
          <input id="fx-date" type="text" inputmode="numeric" placeholder="dd/mm/aaaa" class="w-full p-2 border rounded-lg" />
          <p class="text-xs text-gray-400 mt-1">Formato CR: dd/mm/aaaa</p>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Tipo de cambio</label>
          <input id="fx-rate" type="number" step="0.0001" class="w-full p-2 border rounded-lg" placeholder="0.0000" />
          <p class="text-xs text-gray-400 mt-1">Se valida duplicado por fecha (v1.05).</p>
        </div>
      </div>
    `
  },
  goal_new: {
    title: 'Metas de Ahorro',
    html: `
      <div class="space-y-4">
        <div class="border rounded-xl p-4 bg-gray-50">
          <input type="hidden" id="goal-id" />
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium mb-1">Nombre</label>
              <input id="goal-name" class="w-full p-2 border rounded-lg" placeholder="Fondo emergencia" />
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-medium mb-1">Moneda</label>
                <select id="goal-currency" class="w-full p-2 border rounded-lg"><option>CRC</option><option>USD</option></select>
              </div>
              <div>
                <label class="block text-sm font-medium mb-1">Monto meta</label>
                <input id="goal-target" type="number" step="0.01" class="w-full p-2 border rounded-lg" placeholder="0.00" />
              </div>
            </div>
          </div>
          <label class="flex items-center gap-2 text-sm mt-3">
            <input id="goal-active" type="checkbox" checked /> Activa
          </label>
          <p class="text-xs text-gray-500 mt-2">Usa el botón <b>Guardar</b> de abajo para crear/actualizar la meta.</p>
        </div>

        <div class="bg-white border rounded-xl overflow-hidden">
          <table class="w-full text-left text-sm">
            <thead class="bg-gray-50 border-b">
              <tr>
                <th class="p-2">Acciones</th>
                <th class="p-2">Nombre</th>
                <th class="p-2">Moneda</th>
                <th class="p-2">Meta</th>
                <th class="p-2">Progreso</th>
                <th class="p-2">Restante</th>
                <th class="p-2">%</th>
                <th class="p-2">Activa</th>
              </tr>
            </thead>
            <tbody id="goal-table-body"></tbody>
          </table>
        </div>
      </div>
    `
  },
  bud_new: {
    title: 'Presupuesto',
    html: `
      <div class="space-y-3">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium mb-1">Periodo</label>
            <select id="bud-period" class="w-full p-2 border rounded-lg"></select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Tipo</label>
            <select id="bud-type" class="w-full p-2 border rounded-lg"><option value="expense">Gasto</option><option value="income">Ingreso</option></select>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Categoría</label>
          <select id="bud-cat" class="w-full p-2 border rounded-lg"></select>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium mb-1">Moneda</label>
            <select id="bud-cur" class="w-full p-2 border rounded-lg"><option value="CRC">CRC</option><option value="USD">USD</option></select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Monto presupuestado</label>
            <input id="bud-amount" type="number" step="0.01" class="w-full p-2 border rounded-lg" placeholder="0.00" />
          </div>
        </div>
        <div class="flex items-center gap-2 text-sm">
          <input id="bud-rec" type="checkbox" /> Recurrente mensual (fallback)
        </div>
        <div class="flex items-center gap-2 text-sm">
          <input id="bud-active" type="checkbox" checked /> Activo
        </div>
        <input id="bud-id" type="hidden" />
      </div>
    `
  },
  recon_detail: {
    title: 'Conciliación',
    html: `
      <div class="space-y-5">
        <input type="hidden" id="recon-id" />

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 bg-gray-50 border rounded-xl p-4">
          <div class="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-medium mb-1">Cuenta</label>
              <select id="recon-account" class="w-full p-2 border rounded-lg"></select>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Periodo</label>
              <select id="recon-period" class="w-full p-2 border rounded-lg"></select>
            </div>
          </div>
          <div class="flex items-start justify-end">
            <div id="recon-status" class="px-2 py-1 rounded bg-blue-100 text-blue-700 text-xs font-bold">ABIERTO</div>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label class="block text-sm font-medium mb-1">Saldo final banco</label>
            <input id="recon-bank" type="number" step="0.01" class="w-full p-2 border rounded-lg" placeholder="0.00" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Saldo final SGF (calculado)</label>
            <input id="recon-sgf" disabled class="w-full p-2 border rounded-lg bg-gray-50" value="0.00" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Diferencia</label>
            <input id="recon-diff" disabled class="w-full p-2 border rounded-lg bg-gray-50" value="0.00" />
          </div>
        </div>

        <div class="bg-white border rounded-xl overflow-hidden">
          <div class="p-3 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <p class="font-semibold">Movimientos del mes</p>
            <label class="text-sm flex items-center gap-2"><input id="recon-only-pending" type="checkbox" /> Mostrar solo pendientes</label>
          </div>
          <div class="max-h-[50vh] overflow-y-auto">
            <table class="w-full text-left text-sm">
              <thead class="bg-gray-50 border-b sticky top-0">
                <tr>
                  <th class="p-3 w-16">OK</th>
                  <th class="p-3 w-32">Fecha</th>
                  <th class="p-3">Descripción</th>
                  <th class="p-3 w-40 text-right">Monto</th>
                </tr>
              </thead>
              <tbody id="recon-mov-body"></tbody>
            </table>
          </div>
        </div>

        <div class="flex gap-2 flex-wrap">
          <button id="recon-export" type="button" class="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300">Exportar CSV</button>
          <button id="recon-close" type="button" class="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300">Cerrar mes</button>
          <button id="recon-open" type="button" class="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300">Reabrir mes</button>
        </div>
      </div>
    `
  },
  acc_new: {
    title: 'Nueva Cuenta',
    html: `
      <div class="space-y-3">
        <div>
          <label class="block text-sm font-medium mb-1">Nombre</label>
          <input id="acc-name" class="w-full p-2 border rounded-lg" placeholder="Banco BAC" />
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium mb-1">Tipo de cuenta</label>
            <select id="acc-type" class="w-full p-2 border rounded-lg"></select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Moneda</label>
            <select id="acc-currency" class="w-full p-2 border rounded-lg"><option>CRC</option><option>USD</option></select>
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Cuenta padre (opcional)</label>
          <select id="acc-parent" class="w-full p-2 border rounded-lg"></select>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium mb-1">Color</label>
            <input id="acc-color" type="color" class="w-full p-2 border rounded-lg h-11" value="#3b82f6" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Saldo inicial</label>
            <input id="acc-opening" type="number" step="0.01" class="w-full p-2 border rounded-lg" placeholder="0.00" />
          </div>
        </div>
        <label class="flex items-center gap-2 text-sm"><input id="acc-active" type="checkbox" checked /> Activa</label>
        <label class="flex items-center gap-2 text-sm"><input id="acc-allow-neg" type="checkbox" /> Permite saldo negativo</label>
      </div>
    `
  },
  cat_new: {
    title: 'Nueva Categoría',
    html: `
      <div class="space-y-3">
        <div>
          <label class="block text-sm font-medium mb-1">Nombre</label>
          <input id="cat-name" class="w-full p-2 border rounded-lg" placeholder="Hogar" />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">Categoría padre (opcional)</label>
          <select id="cat-parent" class="w-full p-2 border rounded-lg"></select>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium mb-1">Color</label>
            <input id="cat-color" type="color" class="w-full p-2 border rounded-lg h-11" value="#10b981" />
          </div>
          <div class="flex items-end">
            <label class="flex items-center gap-2 text-sm"><input id="cat-active" type="checkbox" checked /> Activa</label>
          </div>
        </div>
      </div>
    `
  },
  type_new: {
    title: 'Nuevo Tipo de Cuenta',
    html: `
      <div>
        <label class="block text-sm font-medium mb-1">Nombre</label>
        <input id="type-name" class="w-full p-2 border rounded-lg" placeholder="Banco" />
        <p class="text-xs text-gray-400 mt-2">Los tipos base se bloquearán en versiones posteriores.</p>
      </div>
    `
  }
};

function openModal(key, context = {}) {
  const overlay = document.getElementById('modal-overlay');
  const titleEl = document.getElementById('modal-title');
  const fields = document.getElementById('modal-body');
  const saveBtn = document.getElementById('modal-save');

  const tpl = MODAL_TEMPLATES[key] || { title: 'Acción', html: '<p class="text-gray-500">Sin plantilla.</p>' };

  titleEl.textContent = tpl.title;
  fields.innerHTML = tpl.html;

  window.SGF.modalContext = { key, ...context };
  // Hide/show save button depending on template
  if (saveBtn) {
    if (tpl.hideSave) saveBtn.classList.add('hidden');
    else saveBtn.classList.remove('hidden');
  }

  if (saveBtn) {
    saveBtn.onclick = async () => {
      const handler = window.SGF.modalHandlers?.[key];
      if (!handler) {
        toast('Sin handler de guardado.');
        return;
      }
      try {
        await handler(window.SGF.modalContext);
      } catch (err) {
        toast(err?.message || 'No se pudo guardar.');
      }
    };
  }

  overlay.classList.replace('hidden', 'flex');
  if (window.lucide?.createIcons) window.lucide.createIcons();

  // Hooks UI-only por modal
  if (key === 'mov_new') setupMovModalUI();
  if (key === 'mov_rec') setupRecModalUI();
  if (key === 'sav_new') setupSavingsModalUI();
  if (key === 'goal_new') setupGoalsModalUI();
  if (key === 'bud_new') setupBudgetModalUI();
  if (key === 'recon_detail') setupReconModalUI();
}

function setupReconModalUI() {
  try {
    const fn = window.SGF?.modules?.conciliacion?.setupReconModalDynamic;
    if (typeof fn === 'function') fn();
  } catch (e) {
    console.warn('No se pudo inicializar modal de conciliación', e);
  }
}

function setupBudgetModalUI() {
  try {
    const fn = window.SGF?.modules?.presupuestos?.setupBudgetModalDynamic;
    if (typeof fn === 'function') fn();
  } catch (e) {
    console.warn('No se pudo inicializar modal de presupuestos', e);
  }
}

function setupGoalsModalUI() {
  // v1.08: wiring dinámico desde el módulo de ahorros
  try {
    const fn = window.SGF?.modules?.ahorros?.setupGoalsModalDynamic;
    if (typeof fn === 'function') {
      fn();
    }
  } catch (e) {
    console.warn('No se pudo inicializar modal de metas', e);
  }
}

function setupRecModalUI() {
  // v1.07: wiring dinámico desde el módulo de movimientos
  try {
    const fn = window.SGF?.modules?.movimientos?.setupRecModalDynamic;
    if (typeof fn === 'function') {
      fn();
    }
  } catch (e) {
    console.warn('No se pudo inicializar modal de recurrentes', e);
  }
}

function setupMovModalUI() {
  // v1.06: permite wiring dinámico (cuentas/categorías reales, saldos reales)
  try {
    const fn = window.SGF?.modules?.movimientos?.setupMovModalDynamic;
    if (typeof fn === 'function') {
      const handled = fn();
      if (handled) return;
    }
  } catch (_) {
    // fallback al wiring estático
  }

  const typeSel = document.getElementById('mov-type');
  const destGroup = document.getElementById('mov-dest-group');
  const accSel = document.getElementById('mov-account');
  const balanceEl = document.getElementById('mov-account-balance');
  const currencyEl = document.getElementById('mov-currency');

  const splitToggle = document.getElementById('mov-split-toggle');
  const splitBox = document.getElementById('mov-split-box');
  const splitRows = document.getElementById('mov-split-rows');
  const splitAdd = document.getElementById('mov-split-add');
  const singleCat = document.getElementById('mov-category-single');

  const ACC_META = {};

  function syncDestVisibility() {
    const isTransfer = (typeSel?.value || '').toLowerCase().includes('transfer');
    if (!destGroup) return;
    destGroup.classList.toggle('hidden', !isTransfer);
  }

  function syncAccountMeta() {
    const meta = ACC_META[accSel?.value] || { currency: 'CRC', balance: '₡ 0.00' };
    if (balanceEl) balanceEl.textContent = meta.balance;
    if (currencyEl) currencyEl.value = meta.currency;
  }

  function addSplitRow() {
    if (!splitRows) return;
    const tr = document.createElement('tr');
    tr.className = 'border-b';
    tr.innerHTML = `
      <td class="p-2">
        <select class="mov-split-cat w-full p-2 border rounded-lg text-sm"></select>
      </td>
      <td class="p-2"><input type="number" step="0.01" class="mov-split-amt w-full p-2 border rounded-lg text-sm" placeholder="0.00" /></td>
      <td class="p-2">
        <button type="button" class="mov-split-del text-red-600 hover:bg-red-50 p-1 rounded" title="Eliminar fila">
          <i data-lucide="trash" class="w-4 h-4"></i>
        </button>
      </td>
    `;
    tr.querySelector('.mov-split-del')?.addEventListener('click', () => tr.remove());
    splitRows.appendChild(tr);
    window.lucide?.createIcons?.();
  }

  typeSel?.addEventListener('change', syncDestVisibility);
  accSel?.addEventListener('change', syncAccountMeta);

  splitToggle?.addEventListener('click', () => {
    const willShow = splitBox?.classList.contains('hidden');
    splitBox?.classList.toggle('hidden');
    // Si split está activo, deshabilitar selección simple (UI)
    if (singleCat) {
      singleCat.disabled = !!willShow;
      singleCat.classList.toggle('bg-gray-100', !!willShow);
      singleCat.classList.toggle('cursor-not-allowed', !!willShow);
    }
    if (willShow && splitRows && splitRows.children.length === 0) addSplitRow();
  });

  splitAdd?.addEventListener('click', addSplitRow);

  // init
  syncDestVisibility();
  syncAccountMeta();
}

function setupSavingsModalUI() {
  // v1.08: wiring dinámico desde el módulo de ahorros
  try {
    const fn = window.SGF?.modules?.ahorros?.setupSavingsModalDynamic;
    if (typeof fn === 'function') {
      const handled = fn();
      if (handled) return;
    }
  } catch (_) {
    // fallback
  }

  const accSel = document.getElementById('sav-account');
  const balanceEl = document.getElementById('sav-account-balance');
  const destEl = document.getElementById('sav-dest');
  const currencyEl = document.getElementById('sav-currency');

  const ACC_META = {
    banco_crc: { currency: 'CRC', balance: '₡ 850,000.00', dest: 'Ahorros Colones' },
    efectivo_crc: { currency: 'CRC', balance: '₡ 120,000.00', dest: 'Ahorros Colones' },
    banco_usd: { currency: 'USD', balance: '$ 2,150.00', dest: 'Ahorros Dólares' },
  };

  function sync() {
    const meta = ACC_META[accSel?.value] || ACC_META.banco_crc;
    if (balanceEl) balanceEl.textContent = meta.balance;
    if (currencyEl) currencyEl.value = meta.currency;
    if (destEl) destEl.value = meta.dest;
  }

  accSel?.addEventListener('change', sync);
  sync();
}

function closeModal() {
  document.getElementById('modal-overlay')?.classList.replace('flex', 'hidden');
}

function toast(message) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = message;
  box.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => box.classList.add('hidden'), 2000);
}

window.openModal = openModal;
window.closeModal = closeModal;
window.toast = toast;
