# Auto-deploy: GitHub -> Google Apps Script

Pushes the DARB pipeline (`Macro - DARB Identification/Code.gs` + its manifest)
to Google Apps Script via [`clasp`](https://github.com/google/clasp) in GitHub
Actions. Two environments, selected by branch.

Workflow: `.github/workflows/deploy-apps-script.yml`.

> Updating the workbook **by hand** (paste the file, reload, rescaffold, verify) is in
> `REBOOT.md`. The post-update checks there apply after an automated deploy too - `clasp`
> replaces the code, it does not reload anyone's open workbook or scaffold the tabs.

## Branch model

| Branch       | Role            | Deploys to                              |
|--------------|-----------------|-----------------------------------------|
| `main`       | test / staging  | the **staging** script (`SCRIPT_ID_STAGING`) |
| `production` | release         | the **live** workbook (`SCRIPT_ID`)     |

Day to day: land changes on `main`, let them deploy to staging and be checked,
then **promote to production** by merging `main` into `production` (a PR is the
tidy way). Merging into `production` triggers the live deploy.

Until a `SCRIPT_ID_STAGING` secret is set, pushes to `main` simply skip the
deploy step (the syntax and test gates still run), so the test branch never
touches production. **That is the current state**: a green run on `main` means
the gates passed, not that any workbook changed. Only `production` deploys.

## How it works

1. A push to `main` or `production` (or a manual **Run workflow**) starts the job.
2. `node --check` runs as a gate.
3. The job picks the Script ID from the branch (`production` -> `SCRIPT_ID`,
   anything else -> `SCRIPT_ID_STAGING`), writes the clasp credentials and a
   `.clasp.json`, then runs `clasp push -f` from the `Macro - DARB Identification`
   folder. A committed `.claspignore` means only `Code.gs` + `appsscript.json`
   are pushed.

> Apps Script stores `Code.gs` and `Code.js` identically, so keeping the file as
> `Code.gs` is fine for clasp.

## One-time setup

You need these repository secrets. **Important:** the deploy target is the
**Script ID**, which is *not* the spreadsheet ID in the sheet URL
(`.../spreadsheets/d/<SPREADSHEET_ID>/edit`). They are different IDs.

| Secret              | Required | Value                                                       |
|---------------------|----------|-------------------------------------------------------------|
| `CLASPRC_JSON`      | yes      | full contents of `~/.clasprc.json` after `clasp login`      |
| `SCRIPT_ID`         | yes      | Script ID of the **production** workbook                    |
| `SCRIPT_ID_STAGING` | optional | Script ID of a **separate staging** workbook                |

### Get a Script ID

1. Open the workbook > **Extensions > Apps Script**.
2. **Project Settings** (gear) > **IDs** > copy the **Script ID** (~57 chars).

### Enable the Apps Script API (one-time, for the deploying account)

<https://script.google.com/home/usersettings> > turn **Google Apps Script API**
ON. `clasp push` fails without this.

### Generate clasp credentials

```bash
npm install -g @google/clasp@2.4.2
clasp login            # authorize the workbook's Google account
# Windows:  type %USERPROFILE%\.clasprc.json
# macOS/Linux: cat ~/.clasprc.json
```

Copy the entire JSON into the `CLASPRC_JSON` secret. It holds a long-lived
refresh token - treat it like a password; only ever store it as a secret.

### Add the secrets

GitHub > **Settings > Secrets and variables > Actions > New repository secret**.

## Setting up a staging workbook (to make `main` deploy somewhere)

1. Make a copy of the production workbook (File > Make a copy) - this is staging.
2. In the copy: **Extensions > Apps Script > Project Settings > IDs** > copy its
   Script ID.
3. Add it as the `SCRIPT_ID_STAGING` secret.

Now `main` deploys to staging and `production` to live, from the same
credentials.

## Deploying manually from your machine (optional)

```bash
cd "Macro - DARB Identification"
cp .clasp.json.example .clasp.json     # paste the target Script ID into it
clasp push                             # .claspignore limits this to Code.gs + appsscript.json
```

`.clasp.json` is git-ignored, so your local copy never lands in the repo.

## Troubleshooting

- **`User has not enabled the Apps Script API`** - enable it (above).
- **`Could not read API credentials`** - `CLASPRC_JSON` is empty/malformed; re-copy.
- **`Script ID ... not found` / 404** - wrong ID (likely the spreadsheet ID);
  re-copy from Project Settings > IDs.
- **`main` push didn't deploy** - expected until `SCRIPT_ID_STAGING` is set; the
  run logs a warning and the syntax gate still runs.
- **Token stopped working** - a Google password change/security review can revoke
  the refresh token; re-run `clasp login` and update `CLASPRC_JSON`.
- **`Error retrieving access token: Error: invalid_grant`** - the `CLASPRC_JSON`
  refresh token is no longer valid. Re-run `clasp login`, copy the fresh
  `~/.clasprc.json` into the `CLASPRC_JSON` secret, then re-run the deploy
  (**Actions > Deploy Apps Script > Run workflow** on `production`). No new commit
  is needed - the merged code redeploys with the restored token.
  - *Recurring every ~7 days?* `clasp login` with no `--creds` uses clasp's
    built-in OAuth client, whose refresh tokens Google expires after 7 days.
    Permanent fix: use your **own** OAuth client. In Google Cloud Console >
    **Google Auth Platform**: configure the consent screen (**Internal** for a
    Workspace account, or **External** + **Publish app**), then **Clients >
    Create client > Desktop app > Download JSON**. Run
    `clasp login --creds <that file>`, then paste the new `~/.clasprc.json` into
    `CLASPRC_JSON`. Internal/published clients have no 7-day token expiry, so the
    deploy stops breaking. (The per-project `.clasp.json` file the CLI may ask
    for is generated automatically in CI - you don't need it locally.)
