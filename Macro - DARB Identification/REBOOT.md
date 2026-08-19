# Rebooting the script (updating the live workbook)

How new code reaches the workbook, and what to do in the workbook afterwards. ~5 minutes.

Two things are separate, and both have to happen:

| | What it does | How |
|---|---|---|
| **Deploy** | Replaces the code in the Apps Script project | Merge `main` -> `production` (automated), or paste by hand |
| **Reboot** | Makes the workbook actually run it | Reload the sheet, rescaffold, verify |

A `clasp` deploy does **not** reload anyone's open workbook and does **not** create or repair
tabs. Anyone with the sheet open keeps running the old code until they reload. So the deploy
alone is never the whole job.

There is nothing to "restart" in the usual sense: the script has no server and no state of its
own - everything lives in the workbook's tabs.

---

## A. Deploy: how the code gets there

### Route 1 - merge to `production` (the normal route)

`.github/workflows/deploy-apps-script.yml` pushes `Code.gs` + the manifest via `clasp` on
every push to `production`. Merge `main` into `production` (a PR is the tidy way) and the
deploy runs. Full setup and secrets: `DEPLOY.md`.

**Branch reality, so nothing is assumed:**

- **`production` -> the live workbook.** This is the only branch that reaches a real script.
- **`main` -> nothing, today.** The workflow runs the syntax check and the test suite, then
  logs `No SCRIPT_ID_STAGING secret set - skipping staging deploy` and exits 0. Merging to
  `main` is therefore a *gate*, not a deploy. A green tick on `main` does not mean the workbook
  changed.
- To get a real staging environment, copy the workbook, take its Script ID
  (Extensions > Apps Script > Project Settings > IDs) and add it as the `SCRIPT_ID_STAGING`
  secret. Until then the first place new code runs is production.

**Expect the token to have expired.** The `production` deploy has failed twice with
`Error retrieving access token: Error: invalid_grant`, each time after a gap of a few weeks,
and was fixed by re-running `clasp login` and updating the `CLASPRC_JSON` secret. clasp's
built-in OAuth client expires refresh tokens after ~7 days, so if the last production deploy
was more than a week ago, assume this will happen and have the fix ready - the permanent
solution (your own OAuth client) is in `DEPLOY.md`. Nothing is half-deployed when it fails:
the push either happens or it does not.

After a successful deploy, confirm it landed: **Actions > Deploy Apps Script** shows the run,
and the deploy step prints `Deployed to production (branch production).` Then do part B.

### Route 2 - paste by hand (hotfix, or when the token is dead)

1. Workbook > **Extensions > Apps Script** > select `Code.gs`.
2. Click in the editor, **Ctrl/Cmd+A**, paste the entire new file over it.
   Always replace the whole file - the script is a single file by design, and partial pastes
   are how column-index drift gets introduced.
3. **Ctrl/Cmd+S**. The editor flags syntax errors immediately; if it does, the paste was
   truncated - re-copy and paste again.

> **Do not click "Deploy" in the Apps Script editor.** This is a container-bound script driven
> from the sheet's menu, not a web app or add-on. Saving *is* the deploy.

If you paste by hand, put the same code in the repo (or take it from there), or the next
`production` merge will overwrite the workbook with whatever the repo says.

### If the manifest changed

`appsscript.json` is pushed automatically by `clasp`. Only a hand-paste needs it done
manually, and only when the release notes say so (it changes rarely - scopes, timezone,
runtime). To see it: **Project Settings** (gear) > tick **Show "appsscript.json" manifest file
in editor**.

---

## B. Reboot: making the workbook run it

Do this after **either** route, and before the analysts touch the sheet.

## 1. Reload the workbook

**Reload the spreadsheet tab** (F5) - every open copy of it, including the analysts'.

This is the actual reboot: `onOpen` re-runs, which rebuilds the **DARB Pipeline** menu and
runs `scaffoldAll_()` - creating any new tabs, repairing headers and dropdowns, deleting
retired tabs, and re-installing the Tier/Sector edit trigger.

The menu can take a few seconds to appear on a cold load. If it never appears, see
*Troubleshooting*.

---

## 2. Re-authorize if asked

The first menu action after a scope change shows **Authorization required**. Click through
**Continue > (choose the workbook's Google account) > Advanced > Go to ... (unsafe) > Allow**.
The "unsafe" wording is normal for an unpublished container-bound script.

Current scopes (`appsscript.json`): spreadsheets, drive, external requests, container UI,
script app (for the installable edit trigger).

`onOpen` runs with limited authorization, so the edit trigger may fail to install there - it
installs silently on the first fully-authorized menu action. Nothing to do.

---

## 3. Rescaffold

**DARB Pipeline > Utilities > Rescaffold / Restyle Tabs.**

Forces headers, dropdowns, checkboxes, banding and tab colours back to spec, creates any tab
the new version added, and removes retired ones. Safe to run repeatedly. Run it after **every**
code update, not just this one.

---

## 4. Verify

**DARB Pipeline > Utilities > Pipeline Health Check.**

Read the **Health Check** tab it writes:

- **ERROR = schema drift** - a header does not match what the code writes. Fix these before
  running anything else: every read is one column out until you do. Usually another
  Rescaffold clears it; if it does not, a column was inserted by hand and the rows need
  realigning first.
- **WARN = contradictions between tabs** - reviewed rows that never routed, staged Adds a
  later decision overruled, hold rows with nothing staged, a company on two lists. Work
  through them, or note them and continue.
- **OK** on its own means the workbook is consistent.

---

## 5. Settle the data

Run **DARB Pipeline > 1. Process Reviews** once. It is idempotent, and after an update it also
back-fills anything the new version records that the old one did not. Check the History Log
entry it writes - a larger-than-usual "recovered" count is expected on the first run after an
update, and is not an error.

---

## 6. Sanity-check one cycle

Nothing beats one real pass. On a quiet moment:

- open an analyst tab, confirm the dropdowns work and the header reads as expected;
- run **Run Crosscheck** and confirm the counts in the toast/History Log look sane;
- confirm the **Dashboard** step table is ticking steps off as you run them.

---

## Release-specific steps

### Updating to the route-first release (In DB Reference / Health Check / superseded Adds)

1. Deploy (part A), then steps 1-3 of part B. The rescaffold creates the **In DB Reference** tab and rebuilds the
   **Dashboard** for the renumbered steps (your Settings *values* are preserved; the
   Done-This-Cycle ticks reset, which is correct for a renumbered cycle).
2. **Process Reviews** (step 5 above) - this is the back-fill run. Past `In DB` decisions that
   are not matched in Current DB get recorded on In DB Reference, and any `Add` whose staging
   row went missing is re-staged.
3. **Pipeline Health Check** - expect **WARN** rows for anything staged on Adds that a later
   decision overruled. Those are pre-existing orphans the old code could not see; delete the
   Adds rows it names. Build Kintone Upload will also refuse to build quietly on them.
4. Tell the analysts two things: routing is now **step 1** (run it before anything else), and
   an `Add` legitimately appears on **both** Adds and the Watchlist.

---

## Rollback

Fastest, in the workbook:

1. **Extensions > Apps Script**, open `Code.gs`.
2. File list > three-dot menu next to `Code.gs` > **See version history**.
3. Pick the previous version > **Restore**.
4. Reload the workbook, then **Rescaffold / Restyle Tabs**.

If the bad code came from a `production` merge, revert that merge in the repo too, or the next deploy re-pushes it.

Rolling back the *code* does not roll back the *tabs*. If the newer version created a tab or
wrote rows, they stay; the older code ignores what it does not know about. The repo's git
history is the other source of a known-good `Code.gs`.

---

## Troubleshooting

**The DARB Pipeline menu is missing.**
Reload the workbook. If it is still missing, open Apps Script and check for a syntax error
(the editor underlines it). A file that does not parse means `onOpen` never runs, so no menu.
As a one-off you can run `onOpen` manually from the editor's function dropdown.

**"Script function not found: runHealthCheck" (or any other name).**
The pasted file is older than the menu the workbook remembers, or the paste was truncated.
Re-paste the whole file and reload.

**Authorization loop - it keeps asking.**
You are signed into more than one Google account in the browser. Open the workbook in a window
signed into only the workbook's account, or use a Chrome profile for it.

**Tier/Sector auto-fill stopped working.**
That is the installable `onSheetEdit_` trigger. Run any menu action once (fully authorized) to
re-install it. To check: Apps Script > **Triggers** (clock icon) - there should be exactly one
`onSheetEdit_` trigger, "From spreadsheet - On edit". Delete duplicates; the code only ever
creates one.

**"Exceeded maximum execution time" (6 minutes).**
An unusually large batch. Re-run the same action - every step is idempotent and picks up where
it stopped. If it recurs on normal volumes, that is the batching item in the engineering
backlog, not a data problem.

**"Another DARB action is running - please retry in a moment."**
Someone else (or a previous run) holds the document lock. Wait a few seconds and retry.

**A retired tab is still there.**
Retired tabs cannot be deleted while one of them is the active sheet. Click a different tab,
then Rescaffold again.

**Dates look a day out in the exported CSV.**
Check **Project Settings > Time zone** in the Apps Script editor. Dates are formatted in the
*script's* timezone, not yours; set it to the operating team's zone.
