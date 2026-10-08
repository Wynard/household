import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Bon fonts, self-hosted; latin + latin-ext only (Romanian ă â î ș ț)
import '@fontsource-variable/lexend/wght.css';
import '@fontsource/ibm-plex-sans-condensed/latin-700.css';
import '@fontsource/ibm-plex-sans-condensed/latin-ext-700.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-ext-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-ext-600.css';
import './styles/tokens.css';
import './styles/base.css';
import { config } from './config';
import { MockApp } from './app/App';
import { GoogleApp } from './app/GoogleApp';
import { applyTheme } from './app/theme';
import { prefs } from './app/prefs';

// before the first paint, so a chosen theme never flashes the other one
applyTheme(prefs.ui().theme);

const root = document.getElementById('root')!;

// Frame-busting: GitHub Pages can't send frame-ancestors / X-Frame-Options,
// so refuse to render inside someone else's frame.
function framed(): boolean {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

if (framed()) {
  const p = document.createElement('p');
  p.style.cssText = 'font: 16px system-ui, sans-serif; padding: 24px;';
  p.textContent = 'Household can only be opened directly, not inside another page.';
  root.replaceChildren(p);
} else {
  createRoot(root).render(<StrictMode>{config.useMock ? <MockApp /> : <GoogleApp />}</StrictMode>);
}
