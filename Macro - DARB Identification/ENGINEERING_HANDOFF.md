# DARB Securities Sort Pipeline - Engineering Handoff

You are setting up an existing, working Google Apps Script in a GitHub repo with version control, deployment via `clasp`, and lightweight CI. The script is complete and runs today; your job is repo hygiene, reproducible deployment, and a test/CI scaffold - not a rewrite. Read this whole brief before touching the code.

---

## 1. What this is

`Code.gs` is a single-file, **container-bound** Google Apps Script attached to one Google Sheets workbook. It runs the end-to-end DARB (Digital Asset-Related Business) new-securities pipeline for CRB Monitor: consolidate AlphaSense exports, crosscheck against the live database and exclude lists, hand genuinely-new names to interns for research, route reviewed companies to their destination, and format qualified additions for Kintone bulk upload. It replaces a legacy `RunSort` VBA macro.

Everything is driven from a custom **DARB Pipeline** menu inside the workbook. There is no server, no database, and no external service beyond Google's own APIs. All state lives in the workbook's tabs.

Workflow (numbered to match the menu):

1. Refresh DB References - rebuild Current DB + Watchlist from the Kintone export (`.xlsx`).
2. Import Pull Files - upload AlphaSense Search Summary exports (CSV/XLSX); auto-builds Clean Pull.
3. Run Crosscheck - classify each pull row: Sort (new) / Review (near-match) / Excluded (tracked) / Attention - DB Drift; also resurfaces stale tickers (see section 8).
4. Distribute Selected to Interns - hand checked Sort rows to per-intern tabs.
5. Clean-up This Intern Tab - route an intern's reviewed rows to their destinations.
6. Process Reviews - backstop sweep of all intern tabs.
7. Build Kintone Upload Files - format qualified Adds into two tables (Profiles + Source Docs).
8/9. Download the two CSVs.

Plus: Move selected rows between lists, Send all Review + Attention to Sort, and a Utilities submenu (manual Clean Pull rebuild, one-time legacy Watchlist import, Rescaffold/Restyle, Hide/Show audit tabs).

---

## 2. Runtime and platform

- **Apps Script, V8 runtime**, container-bound to a specific Sheets file (it is NOT a standalone or web-app project).
- Single source file `Code.gs` (~1,750 lines) plus the `appsscript.json` manifest.
- No third-party libraries. No secrets or API keys in this script - the only external call is to the Drive REST upload endpoint, authorized with `ScriptApp.getOAuthToken()` (no stored credential).
- The bound script's **Script ID** is found in the workbook: Extensions > Apps Script > Project Settings > IDs.

---

## 3. Required OAuth scopes / manifest

The script uses `SpreadsheetApp` (incl. `openById` on temp converted files), `DriveApp` (trash temp files), `UrlFetchApp` (Drive REST multipart upload to convert XLSX), and `HtmlService`/`SpreadsheetApp.getUi` (menus + modal upload/download dialogs). Set `appsscript.json` to:

```json
{
  "timeZone": "Europe/Paris",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.container.ui"
  ]
}
```

Notes:
- Full `spreadsheets` (not `.currentonly`) and `drive` are both required because XLSX import/refresh converts uploads to a temp Sheet via the Drive REST API, then opens it by ID and trashes it.
- `script.external_request` covers the `UrlFetchApp` call; `script.container.ui` covers the menu and dialogs.

---

## 4. Recommended repo layout

```
darb-sort-pipeline/
  src/
    Code.js              # the Apps Script (clasp accepts .js; identical to Code.gs)
    appsscript.json      # manifest above
  tests/
    helpers.test.js      # unit tests for the PURE helpers (see section 11)
    helpers.js           # extracted copy of pure functions for Node testing (see section 11)
  .clasp.json
  .claspignore
  .gitignore
  package.json
  README.md              # short pointer to this handoff
  ENGINEERING_HANDOFF.md # this file
  docs/
    PROCESS.md           # operator/analyst process doc (currently outstanding - see section 13)
```

Keep `Code.js` as the single source of truth. Do not split it without coordinating - many functions share module-level constants and the column-index contract (section 10).

---

## 5. clasp setup (first time)

```bash
npm install -g @google/clasp
clasp login                     # opens browser; authorize with the account that owns the workbook
mkdir darb-sort-pipeline && cd darb-sort-pipeline
clasp clone <SCRIPT_ID> --rootDir ./src
```

`clasp clone` pulls the live `Code.gs` and `appsscript.json` into `./src`. Commit those, then add the repo scaffolding files below. Going forward:

```bash
clasp pull        # bring remote changes into src/ (if edited in the Apps Script UI)
clasp push        # deploy src/ to the bound script
clasp open        # open the script in the browser
```

Sample config files:

**.clasp.json** (commit; scriptId is not a secret but treat it as environment-specific):
```json
{ "scriptId": "<SCRIPT_ID>", "rootDir": "src" }
```

**.claspignore**
```
**/**
!appsscript.json
!Code.js
```

**.gitignore**
```
node_modules/
.clasprc.json          # NEVER commit - this is your clasp auth token
.DS_Store
```

**package.json**
```json
{
  "name": "darb-sort-pipeline",
  "private": true,
  "scripts": {
    "check": "node --check src/Code.js",
    "test": "node --test tests/"
  },
  "devDependencies": {}
}
```

---

## 6. Deploy and authorize

1. `clasp push` writes `src/Code.js` + `appsscript.json` to the bound script.
2. Reload the workbook in the browser. `onOpen` builds the **DARB Pipeline** menu and scaffolds all tabs.
3. Run any menu action once; accept the OAuth consent (Drive + Sheets + external request). Re-run after authorizing.
4. Run **Utilities > Rescaffold / Restyle Tabs** once to apply current headers, teal styling, filters, banding, tab colours, and the Select/Move To controls across existing tabs.

There are no Apps Script "deployments" to manage (it's not a web app/add-on). `clasp push` is the deploy.

---

## 7. Architecture map (sections of Code.js)

Read in this order:

- **Config / tab defs** - module-level constants: option lists, field-prefix labels, `BORDER_COLOR`/teal colours, `TAB_ROLE`, `TABS` (the schema for every tab), `INTERN_HEADER`, `MOVABLE` (which tabs support reclassification), `HISTORY_MAX`/`STATS_MAX`.
- **Menu / scaffolding** - `onOpen`, `scaffoldAll_`, `ensureTab_`, intern-tab scaffolding + **self-heal migration** (`migrateInternTab_`/`migrateInternRow_`), dropdown/validation setup, `scaffoldMoveColumns_`/`forceMoveCheckboxes_`.
- **Formatting** - `applyFormat_` (the "filtered table" styler: teal header, header filter, banding, frozen row, faint borders, auto-fit), `formatRow_`, `clearBody_`, banding/tab-colour helpers, `headerLenByName_`, `restyleTabs_`, hide/show.
- **Normalization** - `normName_` (lowercase, strip punctuation, drop legal suffixes), `normTicker_`, `tickerRoot_`, `tickerFlag_`, `findExistingRow_` (dedup lookup), Config readers (`configValue_`, `reviewThresholdDays_`, `resurfaceBlank_`, `isStale_`, `isDateish_`).
- **Step 1 - Import & Clean Pull** - `showCsvImportDialog`/`importPullFiles`, `buildCleanPull`, `readXlsxValues_`.
- **Step 1.5 - Refresh DB References** - `showRefreshDialog`/`refreshDbReferences` (full Current DB rebuild + Watchlist MERGE), `convertXlsxToSheet_` (Drive REST), `headerIndex_`/`pick_`.
- **Legacy Watchlist import** - one-time `showWatchlistImportDialog`/`importLegacyWatchlist`.
- **Step 2 - Crosscheck** - `runCrosscheck` (ticker/ISIN/name/fuzzy/root matching + stale-ticker resurfacing), `removeTickersFromRefTab_`, `fuzzyPair_`/`fuzzyConfirm_`.
- **Step 3 - Distribute / Route** - `distributeSelected`, `cleanupActiveTab`, `processReviews`, `routeSheetRows_`, `reorganizeInternTab_`, `requiredReason_`, `routeRow_` (with dedup), `verifyRoutedDest_` (final validation of already-stamped rows), `logRoutingOutcomes_` (per-company outcome ledger).
- **Move between lists** - `withPrefix_`, `consolidateToSort`, `moveSelected`, `moveWriteDest_`.
- **Step 4 - Kintone export** - `buildKintoneUpload` (two tables), `parseSourceDocs_`, `tabToCsv_`/`csvCell_`, `downloadCsvDialog_` + the two download entry points.
- **Shared utilities** - `addBusinessDays_`, `trimTab_`, `logHistory_`, `logStats_`, `toast_`.

---

## 8. Key behaviours you must not break

- **Watchlist merge (Refresh):** Current DB is a full overwrite from the Kintone export; Watchlist is a MERGE - export rows are authoritative, locally-routed/pasted rows not in the export are preserved, and rows now Active in the DB graduate off. Two populations coexist on Watchlist: ~382 from the DB import (rebuilt each refresh) and 500+ legacy rows loaded once via the legacy import.
- **Stale-ticker re-review (Crosscheck):** an exact-ticker match against Watchlist / FR Exclude / Confirmed Exclude whose `Ticker Reviewed Date` is older than the Config threshold (default 365 days) is sent back to Sort and removed from its list. Current DB is exempt. Blank reviewed dates obey the "Resurface tickers with no reviewed date" Config flag (default No). This is idempotent.
- **Dedup-on-route:** `routeRow_` and `moveWriteDest_` use `findExistingRow_` (ticker first, name fallback) to avoid duplicate rows/profiles on Watchlist/FR/Confirmed/Adds/Sort. When a company is **already** on a reference list (Watchlist / FR Exclude / Confirmed Exclude) - common, since the Watchlist is pre-loaded from the export + legacy import - the routed review is **stamped onto the existing row** (`stampReviewOnDest_`): Review Assignement, Ticker Reviewed Date, Analyst, and any supplied Ps Note / tier / source / note / sector. This is deliberate: without it the routed row was silently dropped and the existing row kept a blank reviewed date, so Crosscheck re-surfaced the same ticker for review every cycle. An `In DB` assignment writes nothing (already in Current DB); the intern row is struck through.
- **Intern-tab self-heal:** intern tabs detect a stale header and migrate row layout automatically. Do not change `INTERN_HEADER` order without updating `migrateInternRow_` and the index contract.
- **Two-table Kintone export:** URLs and Source Documents are separate Kintone subtables and must stay separate output tabs/CSVs. Profiles import first (creates records + URL subtable), then Source Docs (keyed by AlphaSense Ticker + Primary Business Name).

---

## 9. Tab inventory (data contract)

Working: `Clean Pull`, `Sort`, `Review`, `Excluded`, `Attention - DB Drift`. Reference: `Current DB`, `Watchlist`, `FR Exclude`, `Confirmed Exclude`, `No Ticker Reference` (hidden). Output: `Adds`, `Kintone Profiles`, `Kintone Source Docs`. Audit: `In DB Log`, `Stats`, `History Log`, `Config`. Dynamic: `RAW - <filename>` (hidden, one per import), `<Name> - Sort` (one per intern). Authoritative column schemas live in the `TABS` object and `INTERN_HEADER` - treat those as the source of truth.

Config settings (auto-seeded, operator-editable): `Ticker flag keywords` (default `.IN`), `Re-review tickers older than (days)` (default `365`), `Resurface tickers with no reviewed date` (default `No`).

---

## 10. Conventions and gotchas

- **Column-index discipline.** Many functions read/write by numeric index against the `TABS`/`INTERN_HEADER` schemas. Two past bugs came from inserting columns mid-schema. Rule: append new columns at the END of a schema; if you must insert mid-schema, update every index reference and the migration logic. A future hardening task is to replace magic indices with named constants + a `selfTest_` (section 13).
- **Intentional misspellings.** `Review Assignement`, `Recomended Sector`, `If Add Recomended Tier` match the live Kintone field names. Do NOT "correct" them - they are part of the integration contract.
- **Styling.** Calibri 11, teal headers (`#0e6e6e`), white/light-teal banding, frozen header, faint internal borders, no outer border, columns fit to content. This is a hard product requirement.
- **Owner conventions** (for any docs/UI text you add): hyphens, never em dashes; greetings Hi/Hello, closings Best/Best Regards.
- **Full-file edits.** The owner works by pasting the entire updated file, not diffs. Keep `Code.js` paste-ready as one file.
- **Performance.** Logs are capped (`HISTORY_MAX`/`STATS_MAX`) and trimmed on write to keep actions fast. Routing/move are per-row appends - fine at weekly volumes (tens of rows); see section 13 for the batching task before any bulk-scale use.

---

## 11. Testing and CI

Apps Script can't run in Node, but the **pure helpers** can. Extract these into `tests/helpers.js` (plain copies, no Apps Script globals) and unit-test them: `normName_`, `normTicker_`, `tickerRoot_`, `tickerFlag_`, `fuzzyPair_`, `isDateish_`, `isStale_`, `migrateInternRow_`, `findExistingRow_`, `parseSourceDocs_`, `withPrefix_`, `csvCell_`. These already have known-good behaviour (examples: a 400-day-old date is stale at threshold 365; a canonical intern row with a date in the Date-Assigned column is left untouched while a legacy 12-column row shifts its trailing four fields right).

Minimum CI (GitHub Actions): run `npm run check` (syntax) and `npm test` on every PR.

```yaml
# .github/workflows/ci.yml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: node --check src/Code.js
      - run: node --test tests/
```

Optional auto-deploy to a **staging** bound script on merge to `main`: store a `clasp` auth token (`~/.clasprc.json`) as a repo secret and `clasp push` in a job. Use a separate staging workbook/Script ID - never auto-push to the production workbook. Keep the syntax/test gate before any push.

A periodic keep-the-extracted-helpers-in-sync check is worthwhile (the test copies can drift from `Code.js`); document the manual sync step or generate `helpers.js` from `Code.js` in a build step.

---

## 12. Assumptions to verify before relying on prod

- **AlphaSense Search Summary layout:** `buildCleanPull` reads RAW data starting at **row 10** and maps RAW columns into Clean Pull as Company/Ticker/CIK/ISIN/MCAP/Region/Domicile. Confirm the current export's metadata offset and column order; a format change silently drops rows or disables ISIN matching.
- **ISIN matching** only activates when the Kintone export includes an ISIN column (resolved by header name). Confirm it's present if you want ISIN-based dedup.
- **Kintone Source Docs import** is keyed on AlphaSense Ticker (+ Primary Business Name), key on the first row of each record's block, blank on continuation. Confirm Kintone's subtable-update match field; switch to key-on-every-row if required.
- **Profile Status** for new Adds is constrained to `Active` / `Watchlist - Deleted Profile`; **Profile Review - Action Status** options must mirror the live Kintone picklist.

---

## 13. Backlog (from the code audit, prioritised)

1. **LockService** around routing/move/distribute - multiple interns can run Clean-up concurrently and interleave appends.
2. **Build-time validation** in `buildKintoneUpload` - warn on selected Adds with blank Profile Status or blank ticker (blank ticker breaks the Source Docs key-match).
3. **Dynamic RAW header detection** - replace the hard-coded row-10 offset with a search for the header row (or a Config offset).
4. **Batch writes** - `routeRow_`/`moveSelected`/`consolidateToSort`/`distributeSelected` use per-row `appendRow`/`deleteRow`; collect and `setValues` once to remove the 6-minute-execution risk at scale.
5. **Named column-index constants + `selfTest_`** asserting header widths and `MOVABLE.dataCols === header.length - 2`. Cheap insurance against the index-drift class of bug.
6. **Ticker canonicalization** (`9923:HK` vs `9923.HK`) before dedup/crosscheck.
7. **Generalised schema-version migration** (extend the intern self-heal pattern to all tabs via a Config schema-version cell).
8. **Process doc** (`docs/PROCESS.md`) - operator/analyst-facing runbook covering the numbered menu, Adds/Tier-Rationale/prefix fields, two-table Kintone export, Move To, Send-to-Sort, teal tables, hide/show, legacy Watchlist import, and stale re-review. Currently outstanding.

---

## 14. Ownership

Product owner / primary operator: Peter Simcox (CRB Monitor). Clients receiving downstream files (UBS, HSBC) are external - no repo access. Coordinate any schema or Kintone field-name change with the owner before merging, since several names are integration contracts.
