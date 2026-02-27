// Utilidades de formato (v1.07.0)
// Reglas SGF:
// - UI siempre muestra fechas como dd/mm/yyyy (Costa Rica)
// - DB guarda fechas como YYYY-MM-DD

(function () {
  window.SGF = window.SGF || {};

  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];

  function pad2(n) {
    const s = String(n);
    return s.length === 1 ? `0${s}` : s;
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function isoToCR(iso) {
    const s = String(iso || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const y = s.slice(0, 4);
    const m = s.slice(5, 7);
    const d = s.slice(8, 10);
    return `${d}/${m}/${y}`;
  }

  function isValidDateParts(y, m, d) {
    const yy = Number(y), mm = Number(m), dd = Number(d);
    if (!Number.isInteger(yy) || !Number.isInteger(mm) || !Number.isInteger(dd)) return false;
    if (yy < 1900 || yy > 2100) return false;
    if (mm < 1 || mm > 12) return false;
    if (dd < 1 || dd > 31) return false;
    const dt = new Date(yy, mm - 1, dd);
    return dt.getFullYear() === yy && (dt.getMonth() + 1) === mm && dt.getDate() === dd;
  }

  // Acepta dd/mm/yyyy o dd-mm-yyyy. Devuelve YYYY-MM-DD o null si inválida.
  function crToISO(cr) {
    const s = String(cr || '').trim();
    if (!s) return null;
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (!m) return null;
    const d = pad2(m[1]);
    const mo = pad2(m[2]);
    const y = m[3];
    if (!isValidDateParts(y, mo, d)) return null;
    return `${y}-${mo}-${d}`;
  }

  function todayCR() {
    return isoToCR(todayISO());
  }

  function escapeHtml(value) {
    const s = String(value ?? '');
    return s
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  // Periodo (YYYY-MM) a etiqueta en español.
  function periodEs(period) {
    const p = String(period || '');
    if (!/^\d{4}-\d{2}$/.test(p)) return p;
    const y = p.slice(0, 4);
    const mi = Number(p.slice(5, 7));
    const name = meses[mi - 1] || p;
    return `${name} ${y}`;
  }

  window.SGF.format = {
    pad2,
    meses,
    todayISO,
    todayCR,
    isoToCR,
    crToISO,
    periodEs,
    escapeHtml,
  };
})();
