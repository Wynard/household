# Household

A private household app for two people: stock, recipes with a weekly meal planner, a shared shopping list, a shared money pot,
and a monthly insights dashboard. Mobile-first, installable as a PWA. Data lives in a shared Google Drive folder; AI features use
the Gemini API free tier, called from the browser.

## Run it with sample data

```sh
npm install
npm run dev:mock
```

Open http://localhost:5173. No Google setup is needed: everything runs on fictional sample data.

## Scripts

| Command                             | What it does                                                           |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `npm run dev:mock`                  | Dev server with sample data                                            |
| `npm run dev`                       | Dev server against Google Drive (needs `.env.local`, see `SETUP.md`)   |
| `npm run check`                     | Typecheck, lint and unit tests                                         |
| `npm run check:privacy`             | Secret scan, email check and commit identity check                     |
| `npm run build` / `npm run preview` | Production build, served locally with the real Content-Security-Policy |

See `SETUP.md` for the Google setup and `SECURITY.md` for the security and privacy rules.
