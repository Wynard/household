# Household

A private household app for two people, mostly used on phones and installed to the home screen.

- **Stock**: what's at home (food, cleaning products, toiletries, medicine), by storage place or category, with low-stock alerts.
- **Recipes**: favourites and categories, checked against stock, a servings scaler, a step-by-step cooking mode with timers,
  and a **week plan** that reserves stock meal by meal.
- **Shopping**: one shared list, filled by hand, by low stock, by recipes and by the plan.
- **Budget**: a shared money pot. Who put in what, who spent what on which items, and what's left. Purchases come from receipt
  scans or manual entry; every entry can be edited or deleted (with undo).
- **Insights**: monthly spending and consumption, with filters and drill-down.
- **Assistant**: talk or type ("we bought 2 kg potatoes at the market for 10 lei"), scan receipts, paste recipe links. It prepares
  changes as cards; nothing changes until someone taps **Apply**.

There's no server. The app is a static site on GitHub Pages, the data lives as JSON files in a Google Drive folder shared by the two
of you, and the AI features use each person's own Gemini API key (free tier), called from the browser.

## Try it with sample data

```sh
npm install
npm run dev:mock
```

Open http://localhost:5173. Everything runs on fictional sample data ("Ana" and "Mihai"), with no Google setup. To try the Assistant,
paste a Gemini key in **Settings › This phone**. In **Settings › This phone › Sample data** you can switch between the two people.

## Set it up for real

Follow **[SETUP.md](SETUP.md)**: GitHub Pages, a Google Cloud project, OAuth client, Picker key, Gemini keys, the first run on both
phones, installing to the home screen, troubleshooting, and the security checklist.

## Scripts

| Command                             | What it does                                                           |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `npm run dev:mock`                  | Dev server with sample data                                            |
| `npm run dev`                       | Dev server against Google Drive (needs `.env.local`, see SETUP.md)     |
| `npm run check`                     | Typecheck, lint and unit tests                                         |
| `npm run check:privacy`             | Secret scan (gitleaks), email check and commit identity check          |
| `npm run build` / `npm run preview` | Production build, served locally with the real Content-Security-Policy |
| `npm run commit -- -m "…"`          | Commit with UTC timestamps                                             |

Every push to `main` runs the privacy check, `npm audit`, the tests and the build in GitHub Actions, then deploys to Pages.

## How it's built

- Vite, React, TypeScript (strict), React Router (`HashRouter`), TanStack Query, zod, date-fns. No component library; plain CSS
  with design tokens (`src/styles`).
- `src/domain`: types, zod schemas and pure logic: units, categorisation, availability, plan, shopping merge, budget math,
  insights. Unit-tested.
- `src/domain/actions`: the **actions layer**. Every change (from a button or the Assistant) is planned as small operations
  with a preview and an undo, then written. `src/domain/ops.ts` applies, re-applies and inverts those operations.
- `src/storage`: one `StorageAdapter` interface with a `DriveAdapter` (Drive API v3) and a `MockAdapter`. The `DataStore` writes
  optimistically, checks the file version before every write and re-applies changes on top of the other person's newer version.
- `src/ai`: the Gemini client, the receipt and recipe pipelines, privacy helpers, and the Assistant's tools.

See [SECURITY.md](SECURITY.md) for the security and privacy rules the app follows.

## Licences

Fonts: Bricolage Grotesque and Atkinson Hyperlegible, both under the SIL Open Font License (`public/licenses`).
