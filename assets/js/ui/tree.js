// TreeView UI-only

function toggleCollapse(btn) {
  const container = btn.closest('.tree-node')?.querySelector('.children-container');
  if (!container) return;
  container.classList.toggle('hidden');
  const icon = btn.querySelector('i');
  if (icon) icon.style.transform = container.classList.contains('hidden') ? 'rotate(-90deg)' : 'rotate(0deg)';
}

function toggleAllNodes(expand) {
  document.querySelectorAll('.children-container').forEach(c => c.classList.toggle('hidden', !expand));
  document.querySelectorAll('.tree-node i[data-lucide="chevron-down"]').forEach(i => i.style.transform = expand ? 'rotate(0deg)' : 'rotate(-90deg)');
}

function filterTree(inputId, scopeId) {
  const q = (document.getElementById(inputId)?.value || '').trim().toLowerCase();
  const scope = scopeId ? document.getElementById(scopeId) : document;
  if (!scope) return;

  // Sin filtro: restaurar.
  if (!q) {
    scope.querySelectorAll('.tree-node').forEach(n => {
      n.style.display = '';
      n.style.opacity = '1';
    });
    return;
  }

  // Un nodo se muestra si él o algún descendiente hace match.
  function nodeChildren(node) {
    const box = node.querySelector(':scope > .children-container');
    if (!box) return [];
    return Array.from(box.children).filter(el => el.classList && el.classList.contains('tree-node'));
  }

  function apply(node) {
    const label = (node.querySelector('[data-tree-label]')?.textContent || '').toLowerCase();
    const selfMatch = label.includes(q);
    const children = nodeChildren(node);
    const childMatch = children.map(apply).some(Boolean);

    const keep = selfMatch || childMatch;
    node.style.display = keep ? '' : 'none';
    node.style.opacity = '1';

    // Si hay match en descendientes, expandir.
    if (childMatch) {
      const box = node.querySelector(':scope > .children-container');
      if (box) box.classList.remove('hidden');
      const icon = node.querySelector('i[data-lucide="chevron-down"]');
      if (icon) icon.style.transform = 'rotate(0deg)';
    }

    return keep;
  }

  // Raíces: no tienen ancestro .tree-node dentro del mismo scope.
  const all = Array.from(scope.querySelectorAll('.tree-node'));
  const roots = all.filter(n => {
    const parentTree = n.parentElement?.closest('.tree-node');
    return !parentTree || !scope.contains(parentTree);
  });
  roots.forEach(apply);
}

function regenerateColors(scopeId) {
  const colors = Array.from({ length: 10 }, () => `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6,'0')}`);
  const scope = scopeId ? document.getElementById(scopeId) : document;
  let i = 0;
  scope.querySelectorAll('.node-color-dot').forEach(dot => {
    dot.style.backgroundColor = colors[i % colors.length];
    i++;
  });
}

window.toggleCollapse = toggleCollapse;
window.toggleAllNodes = toggleAllNodes;
window.filterTree = filterTree;
window.regenerateColors = regenerateColors;
