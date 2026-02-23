// Exportación real a PDF (v1.30.0)
// Captura la vista activa (#view-root) y descarga un PDF usando html2canvas + jsPDF.

(function () {
  window.SGF = window.SGF || {};

  function safePart(v, fallback = 'reporte') {
    const s = String(v || '').trim();
    if (!s) return fallback;
    const cleaned = s.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '');
    return cleaned || fallback;
  }

  function timestampForFile() {
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  }

  function getPdfDeps() {
    const html2canvas = window.html2canvas;
    const jsPDF = window.jspdf?.jsPDF;
    if (typeof html2canvas !== 'function' || typeof jsPDF !== 'function') {
      throw new Error('Dependencias de PDF no disponibles (html2canvas/jsPDF).');
    }
    return { html2canvas, jsPDF };
  }

  async function exportCurrentViewPdf() {
    const root = document.getElementById('view-root');
    if (!root) throw new Error('No se encontró el contenido para exportar.');

    const sectionTitle = document.getElementById('section-title')?.textContent?.trim() || 'Reporte';
    const user = window.SGF?.session?.username || 'usuario';
    const fileName = `SGF_${safePart(sectionTitle)}_${safePart(user, 'usuario')}_${timestampForFile()}.pdf`;

    const { html2canvas, jsPDF } = getPdfDeps();

    const canvas = await html2canvas(root, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      windowWidth: Math.max(root.scrollWidth, root.clientWidth),
      windowHeight: Math.max(root.scrollHeight, root.clientHeight),
    });

    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight, undefined, 'FAST');
      heightLeft -= pageHeight;
    }

    pdf.save(fileName);
    return fileName;
  }

  window.SGF.exportCurrentViewPdf = exportCurrentViewPdf;
})();
