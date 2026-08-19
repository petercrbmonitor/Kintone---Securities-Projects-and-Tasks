# Code Audit - DARB Securities Sort Pipeline (`Code.gs`)

Audit of `Macro - DARB Identification/Code.gs` (1,900 lines, 78 functions),
the container-bound Google Apps Script that runs the end-to-end DARB
new-securities pipeline. Reviewed against the data contract in `TABS` /
`INTERN_HEADER` and the behaviours called out in `ENGINEERING_HANDOFF.md`.

## Summary

The script is in good shape: a single, well-organised file with a coherent
section layout, defensive coding (try/catch around checkbox operations,
dedup-on-route, capped audit logs), and clear inline documentation. It parses
cleanly under the V8/Node syntax checker. The most important structural risk
flagged in the handoff - the numeric column-index contract - was checked
end to end and is internally consistent today.

No correctness-breaking bug was found in the core pipeline logic. The findings
below are hardening and robustness items, ordered by priority. Several mirror
the handoff backlog (section 13); this audit confirms them against the code and
adds specifics.

## Status - 2026-08-18 update

Three defects reported from live use were diagnosed, reproduced against the then-current
build, and fixed (see the git history on `claude/darb-identification-fixes-1ucd2g`):

- **Misrouted Adds.** `verifyRoutedDest_` accepted a Watchlist row as proof that an `Add` had
  been routed. Every Add also writes a Watchlist hold row, so a row whose reviewed date was
  already stamped verified as done and the Adds staging row was never created. Add is now
  satisfied only by `Adds` or `Current DB`; the hold row is a companion, never evidence.
- **Reviewed companies reappearing on Sort.** `Adds` and a new `In DB Reference` list are now
  crosscheck reference lists (`In DB` previously wrote nothing at all); an exact name match
  against a reviewed list excludes, so a changed ticker string no longer makes a reviewed
  company new; rows in flight with an analyst are held back; the Sort queue is carried forward
  instead of wiped; and a stale ticker surfaced for re-review is no longer **deleted** from its
  reference list - that deletion destroyed the review history, so the next crosscheck saw a
  brand-new name.
- **Step order.** Routing (`Process Reviews`) is step 1, and Refresh / Import / Crosscheck run
  the sweep themselves and warn when reviewed rows are still unrouted.

Findings closed by that work and the follow-ups:

- **#5 Ticker canonicalization** - `normTicker_` folds `:`, `/` and whitespace to `.`.
- **#6 Automated tests** - `test/` + `npm test`, 122 assertions over 5 suites, wired into CI
  and into the pre-deploy gate. The mock loads the real `Code.gs`, so there are no extracted
  helper copies to drift (the reason this was deferred).
- **#11 `tickerMap` field semantics** - reference columns are declared per list in
  `CROSSCHECK_REFS` instead of a single hardcoded `r[3]`.
- **Handoff backlog #5 (`selfTest_`)** - superseded by **Utilities > Pipeline Health Check**,
  which asserts every tab header per column, each analyst tab against `INTERN_HEADER`, and the
  `MOVABLE` Select / Move To positions, then reports cross-tab contradictions. Read-only.

Still open: **#4** (batch writes) and the handoff's schema-version migration. Neither blocks
production.

**Note on the sections below.** They were written against the pre-redesign schema and are kept
as the historical record. Several tabs they cite (`Review`, `Attention - DB Drift`,
`Kintone Profiles`, `Kintone Source Docs`, `In DB Log`, `Stats`, `Config`) have since been
retired or merged, and the column counts quoted (Adds 22, Intern 16) are no longer current -
`TABS` and `INTERN_HEADER` in `Code.gs` are the source of truth, and the Health Check verifies
the live workbook against them.

### Verified correct (confidence checks)

- **Syntax**: `node --check` passes (checked via a `.js` copy; `.gs` is the
  same source).
- **Column-index contract**: for every movable tab,
  `MOVABLE[name].dataCols === header.length - 2`:
  Review (6 = 8-2), Excluded (4 = 6-2), Attention - DB Drift (6 = 8-2),
  Watchlist (13 = 15-2), FR Exclude (10 = 12-2), Confirmed Exclude (10 = 12-2).
- **Write/read alignment**: every append and read site matches its schema -
  Watchlist (13 data cols), FR/Confirmed Exclude (10), Sort (12), Adds (22),
  Intern (16), Kintone Profiles (16), Kintone Source Docs (8).
- **Crosscheck precedence**: reference lists are loaded Current DB -> Watchlist
  -> FR Exclude -> Confirmed Exclude, and `tickerMap[t]` keeps the first hit, so
  Current DB correctly wins and its rows are exempt from stale re-review.
- **Intentional misspellings preserved**: `Review Assignement`,
  `Recomended Sector`, `If Add Recomended Tier` are Kintone integration
  contracts and are correctly left untouched.

## Implementation status (branch `main`)

Resolved on the test branch:

- **#1 LockService** - `withDocLock_` now serialises the routing / move / distribute
  entry points (`distributeSelected`, `cleanupActiveTab`, `processReviews`,
  `consolidateToSort`, `moveSelected`).
- **#2 Build-time validation** - `buildKintoneUpload` warns (YES/NO) on qualifying Adds
  rows with a blank ticker or blank Profile Status before writing.
- **#3 RAW header detection** - `buildCleanPull` resolves columns by header name
  (`RAW_ALIASES` + `findRawHeaderRow_`) and only falls back to the legacy row-10 layout
  when no header is found.
- **#8 Stale comment** - the `// 21` Adds-width comment is corrected to `// 22`.

Still open: #4 (batch writes), #9, #10. See the 2026-08-18 status section above for what
has closed since. None block production.

## Findings

| # | Severity | Area | Status / Item |
|---|----------|------|------|
| 1 | High | Concurrency | **Resolved** - `LockService` around routing/move/distribute |
| 2 | Medium | Output integrity | **Resolved** - build-time validation in `buildKintoneUpload` |
| 3 | Medium | Import robustness | **Resolved** - dynamic RAW header detection + name-resolved columns |
| 4 | Medium | Performance | Per-row `appendRow`/`deleteRow` vs the 6-minute limit |
| 5 | Medium | Matching | **Resolved** - `normTicker_` folds `:`, `/` and whitespace to `.` |
| 6 | Medium | Safety net | **Resolved** - `test/` + `npm test` in CI and the deploy gate |
| 7 | Low | Consistency | **Resolved** - `routeRow_` Watchlist append padded to 13 values |
| 8 | Low | Docs | Stale `// 21` comment in `buildKintoneUpload` (Adds is 22 wide) |
| 9 | Low | Config | `seedConfig_` exact-label match vs `configValue_` prefix match |
| 10 | Info | Startup | `onOpen` re-scaffolds on every open |
| 11 | Info | Semantics | **Resolved** - reference columns declared per list in `CROSSCHECK_REFS` |

### 1. [High] No concurrency control (`LockService`)

`routeRow_`, `routeSheetRows_`, `cleanupActiveTab`, `processReviews`,
`distributeSelected`, `consolidateToSort`, and `moveSelected` all mutate shared
tabs (Watchlist, Adds, FR/Confirmed Exclude) with per-row
`appendRow`. The dedup guard (`findExistingRow_` then `appendRow`) is a
check-then-act with no lock, so two interns running **Clean-up This Tab** at the
same time can interleave appends and even double-create the same profile.

**Recommendation**: wrap each menu entry point that writes shared tabs in a
document lock:

```js
function withDocLock_(fn) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) { toast_('Another action is running - try again in a moment.'); return; }
  try { return fn(); } finally { lock.releaseLock(); }
}
```

Then call the body inside `withDocLock_(function () { ... })`. Low-risk and
additive. (Handoff backlog #1.)

### 2. [Medium] No build-time validation in `buildKintoneUpload`

A qualified Add with a **blank ticker** produces Source Docs rows whose key
(Primary Business Name + AlphaSense Ticker) is incomplete, which breaks the
Kintone subtable match; a **blank Profile Status** imports an empty picklist
value. Nothing warns the operator.

**Recommendation**: before writing the output tabs, collect qualifying rows with
a blank ticker or blank Profile Status and surface them with `ui.alert` (block
or confirm), or skip-and-report them in the toast/History Log. (Handoff
backlog #2.)

### 3. [Medium] Hard-coded RAW offset and positional column map

`buildCleanPull` reads `getRange(10, 1, lr - 9, 11)` - data is assumed to start
on **row 10** - and maps RAW columns positionally (CIK = col 2, ISIN = col 3,
MCAP = col 5, Region = col 7, Domicile = col 8). If AlphaSense changes the
Search Summary metadata block height, rows are silently dropped; if it reorders
columns, fields silently mismap and ISIN matching breaks with no error.

**Recommendation**: detect the header row (scan the first ~20 rows for one
containing "Company"/"Ticker") or make the offset a Config setting, and resolve
columns by header name (the same `headerIndex_`/`pick_` approach already used in
`refreshDbReferences`). (Handoff backlog #3 + section 12.)

### 4. [Medium] Per-row writes vs the 6-minute execution limit

Routing, move, distribute, and consolidate use per-row `appendRow` /
`deleteRow` plus per-row `formatRow_`. At weekly volumes (tens of rows) this is
fine, but a large Clean-up or bulk Move would be slow and could hit the 6-minute
Apps Script ceiling.

**Recommendation**: batch - accumulate destination rows and `setValues` once;
collect deletions and remove contiguous ranges in single `deleteRows` calls;
apply formatting to the written block rather than row by row. (Handoff
backlog #4.)

### 5. [Medium] Ticker canonicalization gap

`normTicker_` only trims and uppercases, and `tickerRoot_` splits on `.` only.
Equivalent tickers written with different separators (`9923:HK` vs `9923.HK`,
`BRK.B` vs `BRK/B`) will not match in `tickerMap`/dedup, and colon-suffixed
tickers do not root-match.

**Recommendation**: add a canonical step (normalise `:` and `/` to `.`, collapse
whitespace) used everywhere a ticker is compared or de-duplicated. (Handoff
backlog #6.)

### 6. [Medium] No automated tests / CI guard

There is no syntax or unit-test gate, so a bad paste can ship. The pure helpers
(`normName_`, `normTicker_`, `tickerRoot_`, `isStale_`, `isDateish_`,
`migrateInternRow_`, `fuzzyPair_`, `parseSourceDocs_`, `csvCell_`, `withPrefix_`,
`findExistingRow_`) are easily unit-testable in Node.

**Status**: this PR adds a **syntax-check CI workflow** (`.github/workflows/ci.yml`)
and a **deploy gate** that runs `node --check` before any push. The unit-test
scaffold (handoff section 11) is the recommended next step - kept out of this
change to avoid helper/source drift until we agree how to keep them in sync.

### 7. [Low] `routeRow_` Watchlist append width

In the `Watchlist` branch of `routeRow_`, the append writes 12 values (omitting
the trailing ISIN column), while every other Watchlist write - refresh, legacy
import, `moveWriteDest_`, and the Add -> Watchlist hold - writes 13. It is
harmless today (ISIN simply ends blank) but inconsistent and would become an
off-by-one risk if a column were ever appended.

**Recommendation**: pad the array with a trailing `''` so all Watchlist writes
are 13 wide.

### 8. [Low] Stale comment in `buildKintoneUpload`

`var width = TABS.adds.header.length; // 21` - the Adds header is **22** columns.
The code uses `.length`, so runtime is correct, but the comment is wrong and
would mislead anyone doing index math. Fix the comment to `// 22`.

### 9. [Low] Config label matching mismatch

`seedConfig_` checks for an existing setting by **exact** lowercased label, while
`configValue_`/`flagKeywords_` read by **prefix**. If an operator edits a Config
label (not just its value), `seedConfig_` will re-append a duplicate default row.

**Recommendation**: document that Config labels must not be edited (only
values), or match by prefix in `seedConfig_` too.

### 10. [Info] `onOpen` re-scaffolds on every open

`onOpen` -> `scaffoldAll_()` refreshes validations, move columns, and tab colours
on each open. Fine today; if the workbook grows, consider deferring the heavier
scaffolding to the explicit **Rescaffold / Restyle** utility so the menu always
appears promptly.

### 11. [Info] `tickerMap` field semantics differ for Current DB

In `runCrosscheck`, `tickerMap[t]` stores `reviewed: r[3]`, which is
**Ticker Reviewed Date** on Watchlist/FR/Confirmed but **CRBM Tier** on
Current DB. This is safe only because Current DB has `reviewable: false`, so
`isStale_` is never called on it. Worth a comment so a future edit does not flip
`reviewable` and read a tier string as a date.

## Prioritised recommendations

1. **Add `LockService`** to the shared-write entry points (finding 1).
2. **Validate before Kintone export** - warn on blank ticker / Profile Status
   (finding 2).
3. **Harden RAW import** - dynamic header detection + name-resolved columns
   (finding 3).
4. **Add the unit-test scaffold** for the pure helpers and wire it into CI
   (finding 6).
5. **Batch the per-row writes** before any bulk-scale use (finding 4).
6. **Canonicalize tickers** before compare/dedup (finding 5).
7. Tidy-ups: pad the Watchlist append (7), fix the `// 22` comment (8),
   add a `selfTest_` that asserts the header widths so column inserts cannot
   drift silently (handoff backlog #5).

None of these block production. Items 7-8 are trivial and safe; 1-6 are the
substantive hardening work and can be scheduled as the owner prefers. Because
several touch behaviours the handoff marks as must-not-break and the script
cannot be exercised in CI (Apps Script does not run in Node), each change should
be reviewed against `ENGINEERING_HANDOFF.md` section 8 before merging.
