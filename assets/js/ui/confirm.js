// UI Confirm (evita window.confirm que puede estar bloqueado en algunos entornos/webviews)
// Uso: const ok = await window.SGF.uiConfirm({ title, message, confirmText, cancelText, danger });

(function () {
  window.SGF = window.SGF || {};

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  window.SGF.uiConfirm = function uiConfirm(opts = {}) {
    const {
      title = 'Confirmar',
      message = '¿Continuar?',
      confirmText = 'Confirmar',
      cancelText = 'Cancelar',
      danger = false,
    } = opts;

    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4';
      overlay.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-xl overflow-hidden">
          <div class="bg-gray-50 p-4 border-b flex justify-between items-center">
            <h3 class="font-bold text-lg text-gray-800">${esc(title)}</h3>
            <button type="button" class="p-1 rounded hover:bg-gray-100" data-ui-confirm-close aria-label="Cerrar">×</button>
          </div>
          <div class="p-5 sm:p-6 text-sm text-gray-700 whitespace-pre-line">${esc(message)}</div>
          <div class="p-4 border-t flex justify-end gap-3">
            <button type="button" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg" data-ui-confirm-cancel>${esc(cancelText)}</button>
            <button type="button" class="px-4 py-2 rounded-lg text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}" data-ui-confirm-ok>${esc(confirmText)}</button>
          </div>
        </div>
      `;

      const cleanup = (val) => {
        overlay.remove();
        resolve(val);
      };

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup(false);
      });

      overlay.querySelector('[data-ui-confirm-close]')?.addEventListener('click', () => cleanup(false));
      overlay.querySelector('[data-ui-confirm-cancel]')?.addEventListener('click', () => cleanup(false));
      overlay.querySelector('[data-ui-confirm-ok]')?.addEventListener('click', () => cleanup(true));

      document.body.appendChild(overlay);
    });
  };
})();
