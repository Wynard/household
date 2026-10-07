# Setting up Household

This guide takes you from the code to the app on both of your phones. It takes about an hour, done once. You need a GitHub
account, and each of you needs a Google account. Nothing here costs money.

In the steps below, replace `<username>` with your GitHub username and `<repo>` with the repository name (for example
`household`). The app will live at `https://<username>.github.io/<repo>/`.

**Before anything is pushed, go through the security checklist at the end (steps 11 to 17).** Some of it, like the private email
setting, must be done before your first push.

---

## 1. GitHub: repository and Pages

1. Sign in to GitHub. Click **+** (top right) › **New repository**.
2. Name it, for example `household`. Choose **Public** (GitHub Pages is free for public repositories). Don't add a README, licence
   or .gitignore: the code already has them. Click **Create repository**.
3. On your computer, in the project folder, run the commands GitHub shows under "…or push an existing repository", for example:
   ```sh
   git remote add origin https://github.com/<username>/<repo>.git
   git push -u origin main
   ```
   Run `npm run check:privacy` first (step 17).
4. In the repository, open **Settings** › **Pages**. Under **Build and deployment** › **Source**, choose **GitHub Actions**.
5. The repo name is read automatically by the build (it sets the site's base path from the repository name), so there's nothing
   to edit. For local builds you can set `VITE_BASE=<repo>` in `.env.local`.

## 2. Google Cloud project and APIs

1. Open https://console.cloud.google.com and sign in with the Google account that will own the project (either of you).
2. Top bar › project picker › **New project**. Give it a neutral name, for example `household-app`. **Don't attach a billing
   account** (step 13). Click **Create**, then select the project.
3. Menu › **APIs & Services** › **Library**. Search for **Google Drive API**, open it, click **Enable**.
4. Back in the Library, search for **Google Picker API**, open it, click **Enable**.

## 3. OAuth consent screen

1. Menu › **APIs & Services** › **OAuth consent screen** (it may be called **Google Auth Platform** › **Branding**).
2. Click **Get started** (or **Configure**). App name: something neutral like `Household`. User support email: an address that
   isn't personal, such as an alias (step 13). Audience: **External**. Contact email: the same alias. Accept and **Create**.
3. **Audience** (or **Test users**): leave the publishing status on **Testing**. Click **Add users** and add both of your Gmail
   addresses. Only these two accounts will be able to sign in.
4. **Data access** (or **Scopes**): click **Add or remove scopes** and tick:
   - `.../auth/drive.file` (See, edit, create and delete only the specific Google Drive files you use with this app)
   - `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`

   Nothing broader. Save.

## 4. OAuth client ID

1. Menu › **APIs & Services** › **Credentials** › **Create credentials** › **OAuth client ID**.
2. Application type: **Web application**. Name: `Household web`.
3. **Authorised JavaScript origins**: add both
   - `http://localhost:5173`
   - `https://<username>.github.io`

   (No path, no trailing slash.) Leave redirect URIs empty.

4. Click **Create** and copy the **Client ID** (it ends in `.apps.googleusercontent.com`). This is a public identifier, not a
   secret, but keep it out of the code anyway: it goes into a repository variable in step 6.

## 5. Picker API key and project number

1. **Credentials** › **Create credentials** › **API key**. Copy the key.
2. Click the new key to edit it. Name it `Household Picker`.
   - **Application restrictions**: **Websites**. Add `https://<username>.github.io/*` and `http://localhost:5173/*`.
   - **API restrictions**: **Restrict key** › tick only **Google Picker API**.
   - Save.
3. Find the **project number**: menu › **Cloud overview** › **Dashboard** (or the project picker). It's a long number under
   "Project number", not the project ID. The Picker calls it the app ID.

## 6. Putting the three values into the build

The app reads three public identifiers at build time. They're never stored in the code.

**For the deployed site (GitHub):** in the repository, **Settings** › **Secrets and variables** › **Actions** › **Variables** tab
› **New repository variable**. Add three variables:

| Name                       | Value                          |
| -------------------------- | ------------------------------ |
| `HH_GOOGLE_CLIENT_ID`      | the client ID from step 4      |
| `HH_PICKER_API_KEY`        | the API key from step 5        |
| `HH_GOOGLE_PROJECT_NUMBER` | the project number from step 5 |

Use **Variables**, not Secrets: these values end up in the public page anyway, and the build needs to read them. After adding
them, open **Actions**, pick the latest **Deploy** run and click **Re-run all jobs** (or push any change).

**For your own computer:** copy `.env.example` to `.env.local` and fill in the same three values (and `VITE_USE_MOCK=false`).
`.env.local` is ignored by git. Run `npm run dev` and open http://localhost:5173.

## 7. Gemini API keys (each of you, separately)

1. Open https://aistudio.google.com/apikey and sign in with your own Google account.
2. Click **Create API key**. If asked, pick a project (a new "Gemini API" project is fine; don't attach billing).
3. Copy the key. In the app on your phone: **Settings** (gear) › **This phone** › paste it under **Gemini API key** › **Save** ›
   **Test key**.
4. Restrict it (step 14).

Each phone keeps its own key, only on that phone. On the free tier, Google may use what you send to improve its products. The app
only sends what each request needs and replaces your names with "Person A" and "Person B".

## 8. First run

**The first person (creates the household):**

1. Open `https://<username>.github.io/<repo>/` on your phone and tap **Continue with Google**. Pick your account.
2. Google warns that the app isn't verified (it's in Testing mode). Tap **Continue**. Allow access to "only the specific Google
   Drive files you use with this app".
3. Tap **Create household**. Enter both names, your partner's Gmail address, a monthly spending target and how much money is in
   the shared pot right now. Tap **Create household**.
4. Tap **Share the folder with …**. This shares the `Household Data` folder with your partner as an Editor. (Or open the folder
   in Drive and share it by hand.)

**The second person (joins):**

1. Open the same address on your phone, tap **Continue with Google** and allow access the same way.
2. Tap **Join household** › **Pick the shared folder**. In the Picker, open **Shared with me** and pick **Household Data**.
3. Tap **Select the files in the folder**. Tap every file you see (household.json, items.json and the others), then **Select**.
   Google only lets the app open files you pick, so this step matters.
4. If the app later says "Your partner's phone added a file", tap the banner and select the new file the same way. This happens
   rarely, for example when a new year starts.

## 9. Installing to the home screen

- **Android (Chrome):** open the app, tap the **⋮** menu › **Install app** (or **Add to Home screen**) › **Install**.
- **iPhone (Safari):** open the app in Safari, tap **Share** (the square with an arrow) › **Add to Home Screen** › **Add**.

The app needs an internet connection. Each time it starts you tap **Continue with Google** once: for safety it never stores your
Google sign-in on the phone.

## 10. Troubleshooting

- **"Access blocked" or "This app is blocked":** the Google account isn't a test user. Add it in step 3.3.
- **"Error 400: origin_mismatch" / redirect_uri_mismatch:** the address doesn't exactly match an authorised origin in step 4.3.
  It must be `https://<username>.github.io` with no path.
- **The Picker doesn't show the folder:** make sure the folder was shared with this exact Google account (Drive › Shared with
  me). Check that the Picker key has the right website restrictions and the Google Picker API enabled (step 5).
- **"Some household files aren't shared with this phone yet":** tap the banner and select the files listed.
- **"Gemini's free limit was reached":** the free tier allows a limited number of requests per minute and per day. Wait a minute.
  If it happens often, switch the model in **Settings** › **This phone** to the Flash-Lite one, which has a higher free limit.
- **Changes from the other phone don't show:** switch away from the app and back; it reloads your data when it comes back to the
  front.
- **Everything is blank after an update:** close the app fully and open it again so the new version loads.

---

## Security and privacy checklist (do this before anything is pushed)

11. **GitHub account.** Use an account with a neutral username: it appears in the site address. Turn on two-step verification or
    a passkey (Settings › Password and authentication). In **Settings** › **Emails**, turn on **Keep my email addresses
    private** and **Block command line pushes that expose my email**. Note the no-reply address shown there
    (`<id>+<username>@users.noreply.github.com`).
    In the project folder, set the repository's identity to that no-reply address and a neutral name:
    ```sh
    git config user.name "<neutral name>"
    git config user.email "<id>+<username>@users.noreply.github.com"
    ```
    Commit with `npm run commit -- -m "message"` (or `git c -m "message"`), which records the time in UTC so commit times don't
    reveal your timezone.
12. **Repository settings.** In the repository's **Settings**:
    - **Code security**: enable **Secret scanning** and **Push protection**, **Dependabot alerts** and **Dependabot security
      updates**.
    - **Branches**: add a branch protection rule (or ruleset) for `main`: block force pushes and deletions.
    - **Actions** › **General**: under "Fork pull request workflows from outside collaborators", choose **Require approval for
      all outside collaborators**.
    - **General**: under Features, turn off **Wikis** and **Projects**, and optionally **Issues**.
    - **Secrets and variables** › **Actions** › **Variables**: the three build variables from step 6.
13. **Google Cloud project.** Neutral project and app names. Use a support email that isn't personal (an alias works). **Don't
    attach a billing account**, so no key can ever cost money. Keep the OAuth app in **Testing** with only your two accounts as
    test users.
14. **Restrict the keys.**
    - Picker key: only the **Google Picker API**, only from `https://<username>.github.io/*` and `http://localhost:5173/*` (step 5).
    - Each Gemini key: in https://console.cloud.google.com › the key's project › **APIs & Services** › **Credentials**, edit the
      key: **API restrictions** › only **Generative Language API**; **Application restrictions** › **Websites** ›
      `https://<username>.github.io/*`.
    - **Rotating a key** (if one ever leaks, or once a year): create a new key the same way, put it where the old one was (the
      repository variable, or Settings on the phone), check the app works, then **Delete** the old key in Credentials.
15. **Google accounts.** Both of you: turn on two-step verification or passkeys (https://myaccount.google.com/security).
16. **Drive folder.** `Household Data` must be shared only with each other, by email. Never "anyone with the link". The app checks
    this when it starts and offers to fix it.
17. **Before the first push**, run:
    ```sh
    npm run check:privacy
    ```
    It scans the working tree and git history for secrets (gitleaks), checks that no email other than `@example.com` or a GitHub
    no-reply address appears in any file, and prints every commit identity. It must say **Privacy check passed** and show only
    your neutral name and no-reply address with times ending in `Z` (UTC). gitleaks must be installed (`winget install
Gitleaks.Gitleaks` on Windows, `brew install gitleaks` on macOS).

If something sensitive is ever committed: stop, treat it as public permanently, rotate that key first (step 14), then remove it
from the history with `git filter-repo` and force-push.
