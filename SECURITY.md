# Security and privacy

Household is a static site with no server. All household data lives in the members' own Google Drive folder.
This repository is public, so it must never contain anything personal or secret.

## Repository

- No secrets or key-shaped strings. The OAuth client ID, Picker API key and Google project number are public-by-design browser
  identifiers, injected at build time from GitHub repository variables (`HH_GOOGLE_CLIENT_ID`, `HH_PICKER_API_KEY`,
  `HH_GOOGLE_PROJECT_NUMBER`) or a git-ignored `.env.local`. They end up in the public bundle, so nothing secret may ever go there.
- Each person's Gemini API key is entered in Settings and stored only in that device's `localStorage`.
- Seed and test data use fictional people and `@example.com` addresses only.
- Secret scanning in three layers: a gitleaks pre-commit hook, the same check plus an email check in CI before deploy
  (`npm run check:privacy`), and GitHub secret scanning with push protection.
- Commits use a neutral name, a GitHub no-reply address and UTC timestamps. The check also accepts GitHub's own web-flow
  committer (merges made on github.com), which isn't personal.
- If something sensitive is ever committed, treat it as public permanently: rotate the key first, then rewrite history.

## Website hardening

GitHub Pages can't set HTTP headers, so the page sets a Content-Security-Policy `<meta>` tag in production builds:

| Directive                               | Allowed                                                                                                               | Why                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `default-src`                           | `'self'`                                                                                                              | Everything else is denied unless listed.                                                       |
| `script-src`                            | `'self'`, `https://accounts.google.com`, `https://apis.google.com`                                                    | The app, Google Identity Services (sign-in) and the Google Picker loader.                      |
| `style-src`                             | `'self'`, `'unsafe-inline'`, `https://accounts.google.com`                                                            | The app's stylesheet; Google sign-in and Picker inject their own inline styles and stylesheet. |
| `connect-src`                           | `'self'`, `https://www.googleapis.com`, `https://content.googleapis.com`, `https://generativelanguage.googleapis.com` | Drive API and the Gemini API. Nothing else can be contacted.                                   |
| `frame-src`                             | `https://accounts.google.com`, `https://docs.google.com`, `https://drive.google.com`                                  | Google sign-in and the Picker dialog.                                                          |
| `img-src`                               | `'self'`, `blob:`, `data:`, Google image hosts                                                                        | Receipt photos are shown from `blob:` URLs; the Picker shows Drive thumbnails and icons.       |
| `font-src`                              | `'self'`                                                                                                              | Fonts are self-hosted. No font CDN.                                                            |
| `worker-src`, `manifest-src`            | `'self'`                                                                                                              | Service worker and web app manifest.                                                           |
| `object-src`, `base-uri`, `form-action` | `'none'`                                                                                                              | No plugins, no `<base>` hijacking, no form posts anywhere.                                     |

Also: the app refuses to render inside a frame (frame-busting, since `frame-ancestors` can't be sent), `robots: noindex, nofollow`,
`referrer: strict-origin`, no source maps, no analytics, telemetry, error reporting or third-party scripts.

All user, receipt, web-page and AI content is rendered as text through React. `dangerouslySetInnerHTML` and `innerHTML` are
banned by lint. Images and links are never rendered from AI output. Recipe source links are kept only if they are `https:`.

## CI and dependencies

- The GitHub Actions workflow runs only on pushes to `main` (and by hand), never on pull requests from forks. It has
  `contents: read` and, for the deploy job only, `pages: write` and `id-token: write`.
- Every third-party action is pinned to a full commit SHA. gitleaks is downloaded with a pinned SHA-256 checksum.
- The build fails on any secret, any non-allowed email, any non-UTC or non-neutral commit identity, high or critical
  `npm audit` findings in runtime dependencies, failing tests, or source maps in the output.
- Dependabot keeps npm packages and GitHub Actions up to date.

## Sign-in, tokens and local storage

- Google access tokens are kept in memory only. Scopes: `drive.file`, `openid`, `email`, `profile`.
- `localStorage` holds only the household folder ID, the Gemini key and model, UI preferences and the assistant conversation.
  Signing out wipes all of it, plus IndexedDB and any non-app caches.
- The service worker caches only the app's own static files, never Drive or Gemini responses.
- On startup the app checks the household folder's sharing. If it's shared with "anyone with the link" or with anyone other than
  the two members, it warns and offers to fix it.

## Photos and AI

- Receipt photos are re-encoded through a canvas before upload or sending to Gemini, which strips EXIF metadata including GPS location.
  A unit test checks this.
- Data sent to Gemini is pseudonymised: member names become "Person A" and "Person B", emails are never sent, and each request
  sends only the data it needs.
- Gemini is told to ignore card numbers, card types, loyalty or account numbers, cashier names and store addresses; such fields
  are discarded if returned anyway.
- Web-page text, receipt text and stored data are passed to Gemini inside delimited blocks marked as untrusted data, with an instruction
  never to follow instructions inside them. The Assistant only has read tools and proposal tools: nothing changes until a person taps
  Apply, and it has no way to send data to an arbitrary address.
- On the Gemini free tier, Google may use submitted data to improve its products. Settings explains this.

## Reporting

This is a private household project. If you notice a problem, open an issue without including any personal data.
