# DARB Securities Sort Pipeline - Engineering Handoff

You are setting up an existing, working Google Apps Script in a GitHub repo with version control, deployment via `clasp`, and lightweight CI. The script is complete and runs today; your job is repo hygiene, reproducible deployment, and a test/CI scaffold - not a rewrite. Read this whole brief before touching the code.

---

## 1. What this is

`Code.gs` is a single-file, **container-bound** Google Apps Script attached to one Google Sheets workbook. It runs the end-to-end DARB (Digital Asset-Related Business) new-securities pipeline for CRB Monitor: consolidate AlphaSense exports, crosscheck against the live database and exclude lists, hand genuinely-new names to interns for research, route reviewed companies to their destination, and format qualified additions for Kintone bulk upload. It replaces a legacy `RunSort` VBA macro.

Everything is driven from a custom **DARB Pipeline** menu inside the workbook. There is no server, no database, and no external service beyond Google's own APIs. All state lives in the workbook's tabs.

Workflow (numbered to match the menu):

1. Process Reviews - sweep every analyst tab and route each reviewed row to its destination list. **This runs first**: an unrouted decision is invisible to the crosscheck (see section 8).
2. Refresh DB References - rebuild Current DB + merge Watchlist from the Kintone export (`.xlsx`).
3. Import Pull Files - upload AlphaSense Search Summary exports (CSV/XLSX); auto-builds Clean Pull.
4. Run Crosscheck - classify each pull row: Sort (new, plus near-matches tagged `Review` / `DB Drift` in the Source column) or Excluded (already tracked, or in flight with an analyst); also resurfaces stale tickers (see section 8).
5. Distribute Selected to Interns - hand checked Sort rows to per-analyst tabs.
6. Clean-up This Intern Tab - route one analyst's reviewed rows (step 1 does all tabs at once).
7. Build Kintone Upload - format qualified Adds into the single 19-column upload tab.
8. Download Kintone Upload CSV.

Steps 2-4 re-run the step-1 sweep themselves and warn if reviewed rows are still unrouted.

Plus: Move selected rows between lists, and a Utilities submenu (manual Clean Pull rebuild, one-time legacy Watchlist import, Rescaffold/Restyle, Start New Cycle, Clear Sort queue, Tier/Sector rule re-apply + check, **Pipeline Health Check**, Hide/Show audit tabs).

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

## 7. Architecture map (sections of Code.gs)

Read in this order:

- **Config / tab defs** - module-level constants: option lists, field-prefix labels, `BORDER_COLOR`/teal colours, `TAB_ROLE`, `TABS` (the schema for every tab), `INTERN_HEADER`, `MOVABLE` (which tabs support reclassification), `PIPELINE_STEPS`/`STEP_BY_ACTION` (the numbered cycle and what marks each step done), `HISTORY_MAX`.
- **Menu / scaffolding** - `onOpen`, `scaffoldAll_`, `ensureTab_`, the merged `Dashboard` tab (status table + Settings + workflow guide) and its step-renumber migration, intern-tab scaffolding + **self-heal migration** (`migrateInternTab_`/`migrateInternRow_`), dropdown/validation setup, `scaffoldMoveColumns_`/`forceMoveCheckboxes_`.
- **Tier / Sector rule engine** - `SECTOR_TO_TIER`, `TIER_RATIONALE_CONFIG`, `ruleCols_` (resolves columns by header name, never by index), `applyRowRules_`, the installable `onSheetEdit_` trigger, `reapplyTierRules`/`checkTierRules`.
- **Formatting** - `applyFormat_` (the "filtered table" styler: teal header, header filter, banding, frozen row, faint borders, auto-fit), `formatRow_`, `clearBody_`, banding/tab-colour helpers, `headerLenByName_`, `restyleTabs_`, hide/show.
- **Normalization** - `normName_` (lowercase, strip punctuation, drop legal suffixes), `normTicker_` (canonical comparison form - folds `:`, `/` and whitespace to `.`), `tickerRoot_`, `tickerFlag_`, `findExistingRow_`/`findAddsRow_` (dedup lookup), Settings readers (`configValue_`, `reviewThresholdDays_`, `resurfaceBlank_`, `isStale_`, `isDateish_`).
- **Step 2 - Refresh DB References** - `showRefreshDialog`/`refreshDbReferences` (full Current DB rebuild + Watchlist MERGE, with review stamps grafted onto export rows), `convertXlsxToSheet_` (Drive REST), `headerIndex_`/`pick_`.
- **Step 3 - Import & Clean Pull** - `showCsvImportDialog`/`importPullFiles`, `buildCleanPull` (header detected by name via `RAW_ALIASES`/`findRawHeaderRow_`, legacy row-10 fallback), `readXlsxValues_`.
- **Legacy Watchlist import** - one-time `showWatchlistImportDialog`/`importLegacyWatchlist`.
- **Step 4 - Crosscheck** - `CROSSCHECK_REFS` (per-list column declarations - the reference schema is declared, never assumed), `runCrosscheck` (ticker/ISIN/exact-name/fuzzy/root matching, stale re-review, Sort carry-forward, in-flight suppression), `fuzzyPair_`/`fuzzyConfirm_`, `clearSortQueue`.
- **Route-first pre-flight** - `unroutedReviewedRows_`, `preflightRouteReviews_` (interactive) and `autoRouteReviewsQuietly_` (inside modals). Refresh / Import / Crosscheck all route reviewed rows before they read the reference data.
- **Steps 5-6 - Distribute / Route** - `distributeSelected`, `cleanupActiveTab`, `processReviews`/`routeAllInternTabs_`, `routeSheetRows_`, `reorganizeInternTab_`, `requiredReason_`, `routeRow_` (with dedup), `ensureAddHoldRow_`, `verifyRoutedDest_` (final validation of already-stamped rows), `latestInternDecisions_`/`retireStaleAddsRow_` (a later decision supersedes an earlier Add), `logRoutingOutcomes_` (per-company outcome ledger).
- **Move between lists** - `withPrefix_`, `moveSelected`, `moveWriteDest_`.
- **Steps 7-8 - Kintone export** - `buildKintoneUpload` (the single 19-column tab: parent profile + Website subtable + Source Documents subtable), `parseSourceDocs_`/`parseWebsites_`, `tabToCsv_`/`csvCell_`, `downloadCsvDialog_`, `downloadKintoneUploadCsv`.
- **Pipeline Health Check** - `runHealthCheck` + `healthCheckSchema_`/`healthCheckState_`/`healthCheckSettings_`. Read-only self-audit: header drift per column, `MOVABLE` Select/Move To positions, and cross-tab contradictions. Deliberately does not scaffold first, because scaffolding repairs the drift it looks for.
- **Shared utilities** - `addBusinessDays_`, `trimTab_`, `logHistory_`, `toast_`.

---

## 8. Key behaviours you must not break

- **Route first.** `Process Reviews` is step 1, and Refresh / Import / Crosscheck each re-run the sweep before touching reference data (`preflightRouteReviews_`). A reviewed row that has not reached its destination list is invisible to the crosscheck, which is exactly how already-reviewed companies come back onto Sort.
- **Watchlist merge (Refresh):** Current DB is a full overwrite from the Kintone export; Watchlist is a MERGE - export rows are authoritative, locally-routed/pasted rows not in the export are preserved, rows now Active in the DB graduate off, and local review stamps are grafted onto export rows that arrive blank. Two populations coexist on Watchlist: the DB import (rebuilt each refresh) and the legacy rows loaded once via the legacy import.
- **An `Add` writes TWO rows.** The staging row on `Adds` (what becomes the Kintone upload) and a companion `Pending Kintone Add` hold row on `Watchlist`. They are written independently and neither suppresses the other; `verifyRoutedDest_` must never accept the hold row as proof that an Add was routed, or the staging row silently stops being created.
- **`In DB` records the alias.** It writes to `In DB Reference`. It used to write nothing at all - and because Current DB is rebuilt from the export every refresh, the decision left no trace and the same near-match resurfaced every cycle.
- **Stale-ticker re-review (Crosscheck):** an exact-ticker or exact-name match against Watchlist / FR Exclude / Confirmed Exclude / In DB Reference whose `Ticker Reviewed Date` is older than the Settings threshold (default 365 days) is surfaced on Sort for re-review. The reference row **stays put** - deleting it (as an earlier build did) destroys the review history, so the next crosscheck sees a brand-new name. Current DB is exempt. Blank reviewed dates obey the "Resurface tickers with no reviewed date" setting (default No). This is idempotent.
- **Nothing in flight is re-issued as new.** Crosscheck carries the existing Sort queue forward (Select ticks and Assign To intact), holds back companies sitting un-reviewed on an analyst tab, and treats `Adds` and `In DB Reference` as reference lists.
- **Newest decision wins.** `retireStaleAddsRow_` removes a staging row that a later non-Add decision has overruled, but only when the deciding row holds the newest dated decision for that company (`latestInternDecisions_`), and never when `Imported?` is ticked. Without the newest-decision guard, an old audit row would delete the staging row of a legitimate later Add on every sweep.
- **Dedup-on-route:** `routeRow_` and `moveWriteDest_` use `findExistingRow_`/`findAddsRow_` (ticker first, name fallback) to avoid duplicate rows. When a company is **already** on a reference list the routed review is **stamped onto the existing row** (`stampReviewOnDest_`) rather than dropped - otherwise the existing row keeps a blank reviewed date and Crosscheck re-surfaces the ticker every cycle.
- **Intern-tab self-heal:** intern tabs detect a stale header and migrate row layout automatically. Do not change `INTERN_HEADER` order without updating `migrateInternRow_` and the index contract.
- **Two-table Kintone export:** Website URLs and Source Documents are separate Kintone subtables and must stay separate blocks of the single `Kintone Upload` tab (cols 13-14 and 15-19). See `KINTONE_FORMAT.md`.

---

## 9. Tab inventory (data contract)

Working: `Clean Pull`, `Sort`, `Excluded`. Reference: `Current DB`, `Watchlist`, `FR Exclude`, `Confirmed Exclude`, `In DB Reference`, `No Ticker Reference` (hidden). Output: `Adds`, `Kintone Upload`. Guide: `Dashboard` (step status + Settings + workflow). Audit: `History Log`, `Health Check` (created on demand). Dynamic: `RAW - <filename>` (hidden, one per import), `<First name>` (one per analyst). Authoritative column schemas live in the `TABS` object and `INTERN_HEADER` - treat those as the source of truth.

Retired and auto-deleted on scaffold (`OBSOLETE_TABS`): `Review`, `Attention - DB Drift`, `Kintone Profiles`, `Kintone Source Docs`, `In DB Log`, `Stats`. The former `Pipeline Status` / `Config` / `Workflow` tabs are merged into `Dashboard`.

Settings live in the Dashboard's Settings block (operator edits the Value column only): `Exclude pull tickers containing` (default `.IN`), `Re-review tickers older than (days)` (default `365`), `Resurface tickers with no reviewed date` (default `No`).

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

`npm test` runs the suite in `test/`; `npm run check` is the syntax gate. Both run in CI on every push/PR (`.github/workflows/ci.yml`) and again as a gate before any `clasp` deploy.

Apps Script does not run in Node, so `test/gas-mock.js` implements enough of the platform - `SpreadsheetApp`, sheets, ranges, checkboxes, data validations, the alert/modal UI, `LockService`, `Utilities`, `DriveApp` - for `test/harness.js` to load the real `Code.gs` and drive it offline. **The suites call the real functions**; nothing is copied, so the tests cannot drift from the source. That drift risk is why the scaffold was held back in the original audit.

Coverage today (122 assertions, 5 suites - see `test/README.md`):

- `00-helpers.test.js` - the pure helpers (`normName_`, `normTicker_`, `tickerRoot_`, `fuzzyPair_`, `isStale_`, `isDateish_`, `withPrefix_`, `parseSourceDocs_`, `parseWebsites_`, `csvCell_`, `colLetter_`, `addBusinessDays_`, `migrateInternRow_`, `findExistingRow_`).
- `01` - Add routing to both tabs, In DB Reference, crosscheck exclusion of reviewed/staged/in-flight companies, Sort carry-forward, stale re-review, step-order pre-flight, dashboard migration.
- `02` - DB-drift scope, counter reconciliation, short-name exclusion guard.
- `03` - a later decision retiring a stale staging row, the newest-decision guard, the `Imported?` exemption, the build-time backstop.
- `04` - ticker canonicalization end to end, and every Health Check finding.

The mock is not Sheets: formatting, banding, filters and column widths are accepted and ignored, and formulas are stored as text. Anything depending on real rendering or the 6-minute execution limit still needs a check in the workbook.

---

## 12. Assumptions to verify before relying on prod

- **AlphaSense Search Summary layout:** `buildCleanPull` finds the header row by column name (`RAW_ALIASES`) and only falls back to the historical row-10 offset when no header is recognised. The History Log records how many tabs used that fallback - if it is not zero, check the export's header names.
- **ISIN matching** only activates when the Kintone export includes an ISIN column (resolved by header name). Confirm it's present if you want ISIN-based dedup.
- **Kintone Upload subtables** are keyed on AlphaSense Ticker (+ Primary Business Name), with the `New record flag` on the first row of each record's block and blank on continuation. Confirm Kintone's subtable-update match field; switch to key-on-every-row if required.
- **Profile Status** for new Adds is constrained to `Active` / `Watchlist - Deleted Profile`; **Profile Review - Action Status** options must mirror the live Kintone picklist.

---

## 13. Backlog (from the code audit, prioritised)

Done:

1. ~~**LockService** around routing/move/distribute~~ - `withDocLock_`.
2. ~~**Build-time validation** in `buildKintoneUpload`~~ - warns on blank ticker, and on a staged row the latest analyst decision contradicts.
3. ~~**Dynamic RAW header detection**~~ - `RAW_ALIASES` + `findRawHeaderRow_`, legacy row-10 fallback.
5. ~~**`selfTest_` asserting header widths**~~ - superseded by **Pipeline Health Check**, which asserts every tab header per column, each analyst tab against `INTERN_HEADER`, and the `MOVABLE` Select/Move To positions.
6. ~~**Ticker canonicalization**~~ - `normTicker_` folds `:`, `/` and whitespace to `.`, so `9923:HK`, `9923 HK` and `9923.HK` are one ticker everywhere tickers are compared.
8. ~~**Process doc**~~ - `PROCESS.md`.

Open:

4. **Batch writes** - `routeRow_`/`moveSelected`/`distributeSelected` use per-row `appendRow`/`deleteRow`. Fine at weekly volumes (tens of rows); collect and `setValues` once before any bulk-scale use, to remove the 6-minute-execution risk. Note this touches the write paths the routing fixes hardened, so it wants its own change and a full test run.
7. **Generalised schema-version migration** - extend the intern self-heal pattern to all tabs via a schema-version cell, so a future column change migrates rather than relying on a forced rescaffold.
9. **Named column-index constants** - the Health Check now *detects* index drift; replacing the remaining magic indices with named constants would stop it happening.

---

## 14. Ownership

Product owner / primary operator: Peter Simcox (CRB Monitor). Clients receiving downstream files (UBS, HSBC) are external - no repo access. Coordinate any schema or Kintone field-name change with the owner before merging, since several names are integration contracts.
