function toggleSidebar() {
  document.getElementById('sidebar')?.classList.toggle('-translate-x-full');
}

function toggleDropdown(id) {
  document.getElementById(id)?.classList.toggle('hidden');
}

window.toggleSidebar = toggleSidebar;
window.toggleDropdown = toggleDropdown;
