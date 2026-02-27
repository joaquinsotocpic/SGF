// v1.30.0 - Exportar a PDF (cliente) usando html2pdf.js
window.SGF = window.SGF || {};
window.SGF.pdf = window.SGF.pdf || {};

(function(ns){
  function safeName(s){
    return String(s||'reporte').trim().replace(/[^\w\-]+/g,'_').replace(/_+/g,'_').replace(/^_+|_+$/g,'');
  }

  function exportById(elementId, filename){
    const el = document.getElementById(elementId);
    if (!el) { console.error('[PDF] Elemento no encontrado:', elementId); return; }
    if (typeof window.html2pdf !== 'function') { console.error('[PDF] html2pdf no está cargado'); return; }

    const name = safeName(filename || 'reporte') + '.pdf';

    const opt = {
      margin: 0.5,
      filename: name,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    // Clonar para evitar efectos de UI (focus/hover) y esconder elementos no deseados si algún día se agrega.
    const clone = el.cloneNode(true);
    clone.style.maxWidth = '100%';

    window.html2pdf().set(opt).from(clone).save();
  }

  function bind(root=document){
    const scope = root || document;
    scope.querySelectorAll('[data-export-pdf]').forEach(btn=>{
      if (btn.__pdfBound) return;
      btn.__pdfBound = true;
      btn.addEventListener('click', ()=>{
        const target = btn.getAttribute('data-pdf-target');
        const name = btn.getAttribute('data-pdf-name') || 'reporte';
        exportById(target, name);
      });
    });
  }

  ns.exportById = exportById;
  ns.bind = bind;
})(window.SGF.pdf);


// Delegación global: cualquier botón [data-export-pdf] dispara export sin bind manual
if (!window.SGF.__pdfDelegated) {
  window.SGF.__pdfDelegated = true;
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-export-pdf]');
    if (!btn) return;
    e.preventDefault();
    let target = btn.getAttribute('data-pdf-target');
    const name = btn.getAttribute('data-pdf-name') || 'reporte';
    // fallback: si el target no existe, usar el contenedor del reporte más cercano
    if (target && !document.getElementById(target)) {
      const box = btn.closest('[id^="rep-"]');
      if (box && box.id) target = box.id;
    }
    if (!target) {
      const box = btn.closest('[id^="rep-"]');
      if (box && box.id) target = box.id;
    }
    try { window.SGF?.pdf?.exportById?.(target, name); } catch(_) {}
  });
}
