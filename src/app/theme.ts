// Appearance (Settings › This phone): "system" follows the phone's dark mode;
// light / dark set data-theme on <html>, which tokens.css honours.
import type { Theme } from './prefs';

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme;
  else root.dataset.theme = t;
}
