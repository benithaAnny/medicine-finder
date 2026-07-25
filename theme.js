// =============================================================
// theme.js — dark/light mode toggle, saved in the browser only.
//
// No accounts, no backend: the preference lives in localStorage on
// this device/browser. (index.html also has a small inline script
// in <head> that applies the saved theme before first paint, so
// there's no flash of the light theme on reload.)
// =============================================================

const THEME_KEY = 'medlookup-theme';
const toggleBtn = document.getElementById('theme-toggle');
const toggleIcon = document.getElementById('theme-toggle-icon');
const toggleLabel = document.getElementById('theme-toggle-label');

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  updateToggleUI(theme);
}

function updateToggleUI(theme) {
  const isDark = theme === 'dark';
  toggleBtn.setAttribute('aria-pressed', String(isDark));
  toggleIcon.textContent = isDark ? '☀️' : '🌙';
  toggleLabel.textContent = isDark ? 'Light mode' : 'Dark mode';
}

// Sync the button's label/icon with whatever the inline <head> script
// already applied (it runs before this file loads).
updateToggleUI(currentTheme());

toggleBtn.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
});