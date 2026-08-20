# DARB Pipeline - Operating Process

Operator/analyst runbook for the DARB new-securities pipeline (the `Code.gs` in this
folder). Everything is driven from the **DARB Pipeline** menu in the workbook. The
in-sheet **Dashboard** tab is the short version of this doc — it holds the step-status
table (which steps ran this cycle), the editable Settings, and the workflow guide.

## Weekly cycle (run in order)

**Routing runs first.** Step 1 files every reviewed row to its destination list *before* the
reference data is rebuilt. A reviewed row that has not been routed is invisible to the
crosscheck, which is why already-reviewed companies used to reappear on Sort.

| # | Menu action | What it does |
|---|-------------|--------------|
| 1 | **Process Reviews (route all intern tabs)** | Sweeps every analyst tab and routes each reviewed row to its destination (**Adds** / **Watchlist** / **FR Exclude** / **Confirmed Exclude** / **In DB Reference**). Idempotent — safe to re-run. |
| 2 | **Refresh DB References** | Upload the latest Kintone export (`.xlsx`). Rebuilds **Current DB**; merges **Watchlist** (locally added rows kept; rows now Active graduate off). |
| 3 | **Import Pull Files** | Upload AlphaSense Search Summary exports (CSV/XLSX). Builds **Clean Pull**. |
| 4 | **Run Crosscheck** | Classifies Clean Pull into **Sort** (new + near-matches to confirm) and **Excluded** (already tracked). DB-drift cases (name/ticker changed vs the DB) also land on **Sort**, tagged `DB Drift`. Pull tickers containing the Dashboard's *Exclude pull tickers containing* keywords (default `.IN`) are **skipped entirely** — never added to Sort. |
| 5 | **Distribute Selected to Interns** | On **Sort**: tick `Select`, then set `Assign To` (analyst) and run — hands the row to that analyst's review tab (named by first name, e.g. `Peter`; created on first assign). |
| 6 | **Clean-up This Intern Tab** | On your review tab (your first name): set `Review Assignement` per row, then run to route each row to its destination. (Step 1 does the same across every tab at once.) |
| 7 | **Build Kintone Upload** | Formats qualified **Adds** into the single **Kintone Upload** tab (19 columns, incl. **Analyst** + **Tiering Rationale**). |
| 8 | **Download Kintone Upload CSV** | Download and import into Kintone. |

Steps 2, 3 and 4 re-run the step-1 sweep automatically and warn if any reviewed row still
could not be routed (usually a missing `If Add Recomended Tier` on an Add row) — you can
continue anyway, or stop and fix the rows first.

After step 8, run **Clear Adds (after Kintone import)** to empty the Adds tab for the next batch.
(Alternatively, tick `Imported?` on the rows you imported to keep them but skip them on the next build.)
Clear Adds only **after** the import: the profiles' `Pending Kintone Add` hold rows stay on the
Watchlist until the next refresh confirms them Active, and clearing early makes step 1 re-stage them.

## Starting a clean cycle with a fresh pull file

Run these in order. Steps 1-3 make the reference data trustworthy *before* anything is
classified against it; step 6 is then reliable.

| # | Action | Why |
|---|--------|-----|
| 1 | **1. Process Reviews** | Files every reviewed row. Nothing else should read the reference lists until this has run. |
| 2 | **Utilities → Repair reference lists** | Duplicates, companies on two lists, orphaned pending Adds. |
| 3 | **Utilities → Pipeline Health Check** | Confirms the workbook is consistent. Fix any **ERROR** before going on. |
| 4 | **2. Refresh DB References** | Upload the newest Kintone export so **Current DB** reflects what is actually tracked. Do this *before* the crosscheck, or names added since the last export look new. |
| 5 | **Utilities → Clear Sort queue** | Optional. Only if you want to abandon what is still untriaged — otherwise rows are carried over, and any that have since been resolved are dropped automatically. |
| 6 | **Utilities → Clear imported pull files** | Deletes the hidden `RAW - ...` tabs and empties Clean Pull. **Build Clean Pull stacks every RAW tab it finds**, so last week's export keeps feeding the crosscheck until it is removed. Re-importing a file of the *same name* replaces its tab; a new filename does not. |
| 7 | **3. Import Pull Files** | The new AlphaSense export. Clean Pull is rebuilt automatically from just this file. |
| 8 | **4. Run Crosscheck** | Anything already in Current DB or on a reference list is excluded, not queued. |
| 9 | **5. Distribute Selected to Interns** | Carry on with the normal cycle. |

### A ticker already in Current DB must never be on Sort
If one is, the queue row is stale — it was queued in an earlier cycle and the company has been
added since. **Run Crosscheck**: it re-tests every carried row against the reference lists and
drops the resolved ones, with the reason for each in the History Log
(`… now tracked on Current DB`). The Health Check reports the same thing as
`Already tracked on Sort` if you want to see it without re-running.

Rows that exist *because* of a reference match — Source `Review` (near-match) or `DB Drift` —
are deliberately kept: they are questions for a person. A drift row disappears on its own once
the DB name matches the pull again.

## What "Add" writes
An `Add` produces **two** rows, by design, and neither suppresses the other:

- the staging row on **Adds** — this is what becomes the Kintone upload;
- a companion `Pending Kintone Add` hold row on the **Watchlist** — it keeps the ticker out of
  next week's pull and graduates off automatically once the profile is Active in the DB.

If a company shows up on the Watchlist but is missing from Adds, run **Process Reviews**: it
re-stages any Add whose staging row went missing.

### Changing your mind after routing
If you go back to a routed (struck-through) row and change `Review Assignement` from `Add` to
anything else — or file the company onto a list with **Move To** — the next **Process Reviews**
retires the leftover **Adds** staging row, so the profile you rejected is not created in
Kintone. It is named in the History Log. Two deliberate exceptions:

- if `Imported?` is already ticked the row is **kept** and you are warned instead — the profile
  exists in Kintone, so it has to be retired there, not hidden here;
- an older decision never retires a newer one. If a company was filed `Watchlist` last year and
  re-reviewed as an `Add` this week, the old row leaves the new staging row alone.

**Build Kintone Upload** is the backstop: it refuses to build quietly if a staged row's latest
analyst decision is not `Add`, naming the row and the conflicting decision so you can delete it
first. That is what catches rows staged before this behaviour existed.

## One company, one list
The reference lists are mutually exclusive: **Watchlist**, **FR Exclude**, **Confirmed
Exclude** and **In DB Reference** each hold a company's *current* filing. Routing a review, or
filing a row with **Move To**, now removes the company from the other lists automatically -
the older decision is superseded, and the removal is named in the History Log. (An `Add` is
the one exception: it keeps its `Pending Kintone Add` hold row on the Watchlist until the
profile is imported.)

Before this, a new decision was written without clearing the old one, so companies could sit
on two lists with contradictory decisions - and the crosscheck answers from whichever list it
reads first, which might be the superseded one.

## What "In DB" writes
`In DB` records the company on the **In DB Reference** tab. Current DB is rebuilt from the
Kintone export every refresh, so without that record the decision left no trace and the same
near-match (a new ticker or spelling for a company already in Kintone) came back onto Sort
every cycle.

## Triaging from Sort (no analyst needed)
Sort has both an **Assign To** column and a **Move To** column. For a row that doesn't need
analyst research (e.g. an obvious non-DARB name), tick `Select`, set **Move To**
(`Watchlist` / `FR Exclude` / `Confirmed Exclude` / `Remove`), and run **Move selected rows
between lists** — it files the row directly. The same Select + Move To pair works on
**Excluded**, **Watchlist**, **FR Exclude** and **Confirmed Exclude** to reclassify a row,
including back to **Sort** for re-triage. (There is no separate Review tab: near-matches land
on Sort tagged `Review` in the Source column.)

## Analyst capture formats (review tabs)
Hover the column headers for a reminder. One entry per line:

- **Website URLs** — `Type | URL`
  - `Website | https://company.com`
  - `Exchange | https://exchange.com/quote/...`
- **Source Documents** — `Name | Note | URL | Date`
  - `PR - Launch | Added Press Release | https://company.com/pr | 2026-06-09`

These flow into the Kintone Upload tab's Website subtable (cols 13-14) and Source Documents
subtable (cols 15-19). See `KINTONE_FORMAT.md` for the full column contract.

## Tier / Sector automation
On **Sort**, the **analyst tabs**, **Adds** and **Kintone Upload**, picking a **Sector** auto-sets
the **Tier**, the **Tier** auto-sets **Pure-Play** (2→Yes, 3→No), and both fill the **Inclusion
Rationale** + **Tiering Rationale** boilerplate. **Utilities → Check Tier/Sector rules** flags
mismatches; **Re-apply Tier/Sector rules** re-runs them in bulk. New names land on **Sort** with
Source `AS Pull`. (Editable text lives in `TIER_RATIONALE_CONFIG` in `Code.gs`.)

## Tracking progress
- **Dashboard** tab (status table at top) — one row per step with **Last Run**, **Result**, and a
  ✓ under **Done This Cycle**, updated automatically as you run each step.
- **Utilities → Start New Cycle** — clears the ✓ marks to begin a fresh week.
- **History Log** tab — full audit trail of every run.

## Utilities
- **Build Clean Pull** - rebuild Clean Pull from the RAW import tabs without re-importing.
- **Clear imported pull files** - delete every hidden `RAW - ...` tab and empty Clean Pull, so
  the next import is the only pull in play. Reference lists, Adds and analyst tabs are untouched.
- **Import legacy Watchlist** - one-time load of the legacy macro Watchlist.
- **Rescaffold / Restyle Tabs** - repair headers, dropdowns, formatting and tab colours; also
  clears stale validations and deletes retired tabs. Run this after any script update.
- **Start New Cycle** - reset the Dashboard status checkmarks.
- **Clear Sort queue** - discard untriaged Sort rows. Crosscheck now *carries the Sort queue
  forward* (with your `Select` ticks and `Assign To` choices) instead of wiping it, so this is
  the deliberate way to start from a clean queue.
- **Pipeline Health Check** - read-only audit of the whole workbook, written to a **Health
  Check** tab. Run it when something looks wrong, and after any script update. It changes
  nothing: it reports and tells you the fix.
  - **ERROR = schema drift.** A column inserted mid-schema makes every read one column out -
    the failure mode that has bitten this workbook before. Fix these first.
  - **WARN = contradictions between tabs**: reviewed rows that never routed, a staged Add a
    later decision overruled, a `Pending Kintone Add` hold row with nothing staged behind it
    (identified by that note, not by `Review Assignement` reading "Add" - many ordinary
    reference rows carry that value), a
    company filed on two lists at once, the same company listed twice on one list, or a
    Settings value that cannot be read (so a default is silently in use).
- **Repair reference lists** - fixes three Health Check findings in bulk across Watchlist /
  FR Exclude / Confirmed Exclude / In DB Reference. Shows the counts and asks before changing
  anything; every change is named in the History Log; safe to re-run.
  - `Duplicate row` (same company twice on one list) - the row with the most recent
    `Ticker Reviewed Date` is kept and any field it is missing is filled in from the other
    copy, so no reviewed date, analyst, tier or note is lost whichever copy carried it.
  - `On two lists` (contradictory filings) - the most recent decision wins and the older
    filing is removed, again merging anything only the removed row held.
  - `Hold row without staging row` (a pending Add that will never upload) - re-staged on
    **Adds** when the hold row carries a tier; otherwise the Add marking is cleared and it
    stays an ordinary Watchlist row.

  **Current DB is not included** - it is rebuilt from the Kintone export each refresh, so a
  duplicate there has to be fixed in Kintone.
- **Hide audit + log tabs** / **Show all tabs**.

## Tabs at a glance
- **Working:** Clean Pull, Sort, Excluded, `<first name>` review tabs (one per analyst).
- **Reference:** Current DB, Watchlist, FR Exclude, Confirmed Exclude, In DB Reference,
  No Ticker Reference (hidden).
- **Output:** Adds, Kintone Upload.
- **Guide:** Dashboard (status table + Settings + workflow guide).
- **Audit:** History Log, Health Check (created the first time you run the health check).

## Notes
- **Tickers match across separator styles.** `9923:HK`, `9923 HK` and `9923.HK` are treated as
  the same security everywhere tickers are compared, as are `BRK/B` and `BRK.B`. Tabs still show
  the ticker exactly as the source wrote it.
- **Nothing already in the pipeline is re-issued as new.** Crosscheck holds back companies that
  are out with an analyst but not yet routed (reported on **Excluded** as `In flight`), keeps
  rows already on Sort, and treats **Adds** and **In DB Reference** as reference lists. An
  exact name match against a reviewed list excludes even when the ticker string has changed.
- A stale ticker resurfaced for re-review (Dashboard: *Re-review tickers older than (days)*,
  default 365) **stays on its reference list**. Earlier builds deleted it, which destroyed the
  review history and made the company look brand new on the following run.
- Drift now lives on **Sort** (the old `Attention - DB Drift` tab is retired and auto-deleted).
- The single **Kintone Upload** tab replaces the old `Kintone Profiles` / `Kintone Source Docs`
  tabs (also auto-deleted).
- After a script update, run **Rescaffold / Restyle Tabs** once and reload the workbook.
  The full update runbook - paste, reload, re-authorize, rescaffold, health check, rollback - is
  in `REBOOT.md`.
