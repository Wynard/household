// Appearance (Settings › This phone): "system" follows the phone's dark mode;
// light / dark set data-theme on <html>, which tokens.css honours. index.html
// applies a stored choice before the first paint; this keeps it in sync after.
import type { Theme } from './prefs';

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
  // the browser bar takes the "counter" color: the two theme-color tags follow
  // the phone, a forced theme sets both to the current --bg token
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => {
    m.dataset.system ??= m.content;
    m.content = t === 'system' || !bg ? m.dataset.system : bg;
  });
}
