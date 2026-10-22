// Applies the theme before first paint to avoid a flash.
try {
  var t = localStorage.getItem('slate-theme');
  if (!t || t === 'system') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
} catch (e) {}
