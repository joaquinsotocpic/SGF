function filterTable(inputId, tableBodyId) {
  const q = (document.getElementById(inputId)?.value || '').toLowerCase();
  document.querySelectorAll(`#${tableBodyId} tr`).forEach(row => {
    row.style.display = row.innerText.toLowerCase().includes(q) ? '' : 'none';
  });
}

window.filterTable = filterTable;
