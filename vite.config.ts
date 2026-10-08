/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { createHash } from 'node:crypto';

// Content-Security-Policy, delivered as a <meta> tag because GitHub Pages
// cannot send HTTP headers. Every allowed source is explained in SECURITY.md.
// It is only injected into production builds: the Vite dev server needs an
// inline React Refresh preamble that a strict policy would block. Use
// `npm run build && npm run preview` to test the app under the real policy.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'THEME_HASH' https://accounts.google.com https://apis.google.com",
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
      // the only inline script is the tiny theme boot; allow exactly it by its hash
      const boot = html.match(/<script id="theme-boot">([\s\S]*?)<\/script>/)?.[1] ?? '';
      if (!boot) throw new Error('index.html: the theme-boot script is missing');
      const hash = `sha256-${createHash('sha256').update(boot).digest('base64')}`;
      const csp = CSP.replace('THEME_HASH', hash);
      return html.replace('<!-- CSP -->', `<meta http-equiv="Content-Security-Policy" content="${csp}" />`);
    },
  };
}

// Each build gets an ID. The app compares it with version.json (never cached)
// when it comes back to the foreground, so a phone that keeps the installed app
// open for days still picks up new versions (src/app/appUpdate.ts).
const BUILD_ID = new Date().toISOString();

function versionPlugin(): Plugin {
  return {
    name: 'household-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'HH_']);
  const base = env.VITE_BASE ? `/${env.VITE_BASE.replace(/^\/|\/$/g, '')}/` : '/';
  return {
    base,
    envPrefix: ['VITE_', 'HH_'],
    define: { __BUILD_ID__: JSON.stringify(mode === 'test' ? 'test' : BUILD_ID) },
    plugins: [
      react(),
      cspPlugin(),
      versionPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        // an external registerSW.js keeps the page free of inline scripts (CSP)
        injectRegister: 'script',
        includeAssets: ['icon.svg', 'apple-touch-icon.png', 'favicon-32.png', 'licenses/*.txt'],
        manifest: {
          name: 'Household',
          short_name: 'Household',
          description: 'Stock, recipes, shopping and a shared money pot for two.',
          lang: 'en',
          start_url: '.',
          scope: '.',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#ECECE8',
          theme_color: '#ECECE8',
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // Only the app's own static files are cached. Drive and Gemini responses are never
          // cached (they're cross-origin and not matched by any rule), and navigations go to
          // the network first so a new version shows up right away.
          // index.html is NOT precached: the page always comes from the network first (rule below),
          // so a new deploy (e.g. new build variables) shows up on the next open.
          globPatterns: ['**/*.{js,css,svg,png,woff,woff2,txt}'],
          navigateFallback: null,
          runtimeCaching: [
            {
              urlPattern: ({ request, sameOrigin }) => sameOrigin && request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: { cacheName: 'hh-pages', networkTimeoutSeconds: 4 },
            },
          ],
          cleanupOutdatedCaches: true,
        },
      }),
    ],
    build: {
      sourcemap: false,
      target: 'es2022',
      rollupOptions: {
        output: {
          manualChunks: (id) =>
            id.includes('node_modules') && !id.includes('@fontsource') ? 'vendor' : undefined,
        },
      },
    },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    test: {
      globals: true,
      // Pure logic runs in node (fast). Component tests opt in with
      // `// @vitest-environment jsdom` at the top of the file.
      environment: 'node',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      // the design-token tests read tokens.css and base.css as text
      css: { include: [/src[\\/]styles[\\/][^?]*\.css/] },
    },
  };
});
