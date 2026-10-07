/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Content-Security-Policy, delivered as a <meta> tag because GitHub Pages
// cannot send HTTP headers. Every allowed source is explained in SECURITY.md.
// It is only injected into production builds: the Vite dev server needs an
// inline React Refresh preamble that a strict policy would block. Use
// `npm run build && npm run preview` to test the app under the real policy.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://accounts.google.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  "connect-src 'self' https://www.googleapis.com https://content.googleapis.com https://generativelanguage.googleapis.com",
  'frame-src https://accounts.google.com https://docs.google.com https://drive.google.com',
  "img-src 'self' blob: data: https://*.googleusercontent.com https://ssl.gstatic.com https://www.gstatic.com",
  "font-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'household-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<!-- CSP -->', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'HH_']);
  const base = env.VITE_BASE ? `/${env.VITE_BASE.replace(/^\/|\/$/g, '')}/` : '/';
  return {
    base,
    envPrefix: ['VITE_', 'HH_'],
    plugins: [react(), cspPlugin()],
    build: { sourcemap: false, target: 'es2022' },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    test: {
      globals: true,
      // Pure logic runs in node (fast). Component tests opt in with
      // `// @vitest-environment jsdom` at the top of the file.
      environment: 'node',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
