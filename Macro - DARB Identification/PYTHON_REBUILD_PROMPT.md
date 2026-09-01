# DARB Securities Identification — Python Application Conversion & Process Modernization

**Source system:** `Macro - DARB Identification/Code.gs` — a single-file, container-bound Google
Apps Script (V8, ~3,900 lines, ~110 functions) attached to one Google Sheets workbook
("Macro 2.0"). It replaced a legacy `RunSort` VBA macro.

**Target:** a Python application that preserves the classification and routing methodology
exactly, while removing the spreadsheet's structural limits — manual Kintone exports, whole-tab
rewrites, the 6-minute execution ceiling, and column-index fragility.

**Reference documents in this folder:** `PROCESS.md` (operator runbook), `KINTONE_FORMAT.md`
(upload contract), `ENGINEERING_HANDOFF.md` (architecture + must-not-break list), `CODE_AUDIT.md`
(findings and status), `REBOOT.md` (deployment), `../test/` (174 behavioural assertions).

---

## Objective

Convert the DARB new-securities identification pipeline into a **Python application** that keeps
the current business logic and classification methodology while improving **automation,
performance, data integrity, auditability, and analyst workflow**.

The objective is **not to recreate the spreadsheet in Python**. The spreadsheet's shape is the
source of most of its defects: reference data arrives as a hand-uploaded `.xlsx`, decisions live
in cells that anyone can edit, "state" is inferred from whether a date cell is populated, and
every list rebuild is a full-tab overwrite. Those constraints should not survive the port.

The analyst should make **decisions**. The system should do everything around them.

---

## 0. What the current process actually does

Weekly cycle, driven from a `DARB Pipeline` menu:

| # | Step | Today |
|---|------|-------|
| 1 | Process Reviews | Sweeps analyst tabs, routes each reviewed row to its destination list |
| 2 | Refresh DB References | Operator uploads a Kintone `.xlsx` export; rebuilds `Current DB`, merges `Watchlist` |
| 3 | Import Pull Files | Operator uploads AlphaSense Search Summary exports (CSV/XLSX) → `Clean Pull` |
| 4 | Run Crosscheck | Classifies each pull row → `Sort` (needs a human) or `Excluded` (already tracked) |
| 5 | Distribute Selected | Operator ticks rows on `Sort`, sets `Assign To`, hands them to an analyst tab |
| 6 | Clean-up This Intern Tab | Analyst sets `Review Assignement` per row; rows route to their destination |
| 7 | Build Kintone Upload | Formats qualified `Adds` into a 19-column upload sheet |
| 8 | Download Kintone Upload CSV | Operator downloads and imports into Kintone by hand |

**Tabs (the current data model):** `Clean Pull`, `Sort`, `Excluded` (working); `Current DB`,
`Watchlist`, `FR Exclude`, `Confirmed Exclude`, `In DB Reference`, `No Ticker Reference`
(reference); `Adds`, `Kintone Upload` (output); `Dashboard` (steps + settings + guide);
`History Log`, `Health Check` (audit); `RAW - <filename>` per import; one tab per analyst,
named by first name.

**Analysts:** Ethan Guys, Isaac M, Mel Dapanas, Jaypee Ollos, Luciana Villarreal Romero, Jim,
Kyle, Peter, Tamara, Product Team, Jacie Specht. (Currently active reviewers: Luciana, Ethan,
Isaac.)

---

## 1. Core Goals

### 1.1 Convert the existing process to Python

Reproduce every rule below. Nothing here is negotiable without an explicit decision — several
were fixed defects, and reverting them silently reintroduces known failures.

**Identity / matching primitives**

- `normalize_name`: lowercase, strip punctuation to spaces, collapse whitespace, drop trailing
  legal suffixes (`inc, incorporated, ltd, limited, corp, corporation, llc, plc, sa, ag, nv, co,
  company, group, holdings, holding, se, ab, as, asa, oyj, kk, bhd, pte, nyrt, pjsc`) while at
  least one word remains.
- `normalize_ticker`: uppercase, trim, then fold `:`, `/` and whitespace runs to a single `.`,
  collapse repeats, strip leading/trailing separators. `9923:HK`, `9923 HK` and `9923.HK` are
  one security; so are `BRK/B` and `BRK.B`.
- `ticker_root`: everything before the first `.` (`ABC.L` → `ABC`), used for
  same-symbol-different-exchange detection at root length ≥ 3.
- Fuzzy name pair (intentionally conservative — **do not loosen**): equal first 5 characters, OR
  one contains the other, OR identical first two words.
- Name-based exclusion ignores normalized names shorter than 4 characters.

**Crosscheck ladder** — first match wins, evaluated in this order:

1. Company is out with an analyst and not yet routed → hold back ("in flight"), never queue.
2. Exact ticker in a reference list → **excluded**. If the reference is a Kintone-backed list
   and the name differs materially (not a fuzzy pair) → also raise a **DB Drift** review item.
3. ISIN match (when the reference carries ISIN) → **excluded** + DB Drift (ticker changed).
4. Exact normalized name on a *reviewed* list (Watchlist / FR Exclude / Confirmed Exclude /
   In DB Reference / Adds) → **excluded**. Without this, a reviewed company whose ticker string
   changed came back as brand new every week.
5. Exact normalized name in Current DB → **review item** ("confirm new vs same").
6. First word ≥ 4 chars + fuzzy confirm → **review item**.
7. Ticker root match (different full ticker) → **review item**.
8. Otherwise → **new**, queue for analyst review.

Reference-list precedence when a ticker appears on several: Current DB → Watchlist → FR Exclude
→ Confirmed Exclude → In DB Reference → Adds.

**Stale re-review:** a reviewed reference row whose reviewed date is older than the configured
threshold (default **365 days**) resurfaces for re-review. Blank reviewed dates obey a separate
setting (default **No**). **The reference row is never deleted when this happens** — deleting it
destroyed the review history and made the company look brand new on the next run.

**Excluded-ticker keywords:** pull tickers containing any configured keyword (default `.IN`) are
skipped entirely and never queued.

**Analyst decisions** (exactly five): `Add`, `Watchlist`, `FR Exclude`, `Confirmed Exclude`,
`In DB`.

- `Add` writes **two** records: the staging record (what goes to Kintone) **and** a companion
  "Pending Kintone Add" hold record on the Watchlist. Neither may suppress the other.
- `In DB` records the alias on **In DB Reference**. It must write something: when it wrote
  nothing, the same near-match resurfaced every single cycle.
- The four reference lists are **mutually exclusive** — filing a company on one clears the
  others. `Add` is the single exception (it keeps its Watchlist hold record until imported).
- A later decision **supersedes** an earlier `Add`: the staging record is retired, unless it is
  already marked imported (then warn — the profile exists in Kintone and must be retired there).
  Only the newest dated decision for a company may retire a staging record.
- `Add` requires a tier. A row without one is skipped with a stated reason, never mis-routed.

**Tier / sector rules** (ported from the Kintone client `dropdownRules.js` /
`tierRationaleConfig.js` — 25 sectors):

- Sector → Tier: `1A` = DA - ETF / ETN / CEF, DA & DARB - ETF / ETN / CEF, DA - Futures.
  `1B` = DA - Options Based Strategy ETP, Fund of Funds, DARB - CEF / ETN / ETF.
  `2` = Pre-Acquisition SPAC. Others: analyst-set.
- Tier → Pure-Play: `2` → Yes, `3` → No.
- Tier + sector → Inclusion Rationale and Tiering Rationale boilerplate, in three families:
  Futures, ETP/Fund, and Company. **The strings are verbatim contract text — port them exactly.**

**Field-name contract.** These misspellings match live Kintone fields and must be preserved
wherever they cross the boundary: `Review Assignement`, `Recomended Sector`,
`If Add Recomended Tier`. `Profile Status` is strictly `Active` or
`Watchlist - Deleted Profile`. New profiles carry Action Status
`AlphaSense Macro (New Profiles)`.

Business logic must live in engines that are unit-testable without the UI and without Kintone.

### 1.2 Reduce update latency

Today every step rewrites whole tabs. `FR Exclude` alone is ~3,700 rows; the Watchlist ~1,000+.
Routing appends row-by-row and the audit sweep re-verifies every historical row on every run.
Apps Script's 6-minute ceiling is the real constraint.

The Python application should:

- Process **only changed records** (`Detect Change → Process Change → Update → Log`).
- Never re-download the whole Kintone reference set when nothing has changed.
- Index by normalized ticker and normalized name so matching is a lookup, not a scan.
- Give the analyst an immediate result on each action, with no page reload and no full re-query.

### 1.3 Use Kintone as the DB reference source

**This is the single biggest change.** Today a human exports `.xlsx` from Kintone and uploads it;
between exports, `Current DB` is stale, and anything added to Kintone since the last export looks
like a new company. Every "already tracked name reappeared" incident traces back to this.

Build one Kintone integration layer owning authentication, retrieval, pagination, field mapping,
error handling, retry, rate limits, change detection (last-modified / revision), and sync status.
Credentials come from environment variables or a secrets manager — never the source, never a
config file in the repo.

The Kintone reference set includes both Active profiles and the Kintone-side watchlist
(currently identified by tab names containing "watchlist" in the export). Profiles with no
ticker still matter — they are name-matched only, and must not be dropped.

Write-back: today the upload is a manual CSV import. Target state is API-driven record creation
with the same two-subtable shape (below), with the CSV export retained as a fallback.

### 1.4 Maintain a comprehensive audit trail

Today: a `History Log` tab capped at 100 rows (older entries are deleted), plus a per-run
"Routing Outcomes" ledger giving every company exactly one outcome — `ROUTED` / `OK` /
`SKIPPED <reason>` / `ERROR <failure point>` / `PENDING`. That ledger is the most valuable
diagnostic in the system and must survive the port — **without the 100-row cap**.

Record per event: timestamp, actor (analyst or system), company + ticker + record ID, action,
previous value, new value, source of change, manual vs automated, validation/routing result,
and error detail. Append-only, independent of current record state, never truncated.

Events the current system already emits that must be preserved: decision routed; decision
superseded; staging record retired; company moved off another list; duplicate merged; stale
ticker resurfaced; hold record created/cleared; sync performed; build/export produced.

### 1.5 Simplify company identification/classification

Today an analyst opens their own tab, reads a row, sets a dropdown, and waits for an operator to
run a sweep. Fields like tier, sector, pure-play and both rationales are set by hand or by an
on-edit trigger.

Target: a queue, and one click per decision — `[ ADD ] [ WATCHLIST ] [ FR EXCLUDE ]
[ CONFIRMED EXCLUDE ] [ IN DB ] [ DEFER ]` — with the dependent fields derived automatically by
the tier/sector engine and only surfaced for editing when the analyst wants them.

---

## 2. Analyst Workflow

### Step 1 — Load reference data
Sync from Kintone incrementally. Skip entirely when nothing has changed since the last sync.

### Step 2 — Identify records requiring action
Ingest the AlphaSense pull (file upload initially; API later if available). Run the crosscheck
ladder. Distinguish: **new** · **near-match, confirm new vs same** · **DB drift (name or ticker
changed vs Kintone)** · **due for re-review (stale)** · **in flight with an analyst** ·
**already tracked (excluded)** · **skipped (flagged ticker)** · **failed/exception**.

Deduplicate the pull by canonical ticker before it reaches the queue.

### Step 3 — Present the analyst review queue
One screen per company with everything needed to decide: AlphaSense name, ticker, CIK, ISIN,
market cap, region, domicile, why it surfaced (and against what, with the matched name and
list), prior review history for that company, and the current Kintone record if one exists.

The analyst should never have to open another tab to answer "have we seen this before?".

### Step 4 — Analyst classification
One action per decision. Required-field prompts appear inline *before* the action is accepted —
an `Add` without a tier should be impossible to submit, not silently skipped hours later.

### Step 5 — Automated processing
Apply the tier/sector rules, validate, file the record on exactly one reference list (clearing
the others), create the staging record and its hold record for an `Add`, retire anything the
decision supersedes, sync, and write the audit entries — as one transaction.

### Step 6 — Confirmation
Immediate, per-record: `✓ Filed as Confirmed Exclude` · `✓ Staged for Kintone (Tier 1A)` ·
`⚠ Tier required for Add` · `✕ Kintone sync failed — retry`. The analyst moves to the next
company without a refresh.

---

## 3. Application Architecture

```text
Python Application
│
├── UI Layer
│   ├── Analyst Dashboard        (queue counts, cycle status, sync freshness)
│   ├── Review Queue             (filter, sequential processing)
│   ├── Company Detail           (evidence + match provenance + prior decisions)
│   ├── Classification Controls  (five decisions + defer)
│   └── Audit History            (per company and global)
│
├── Business Logic
│   ├── Identification Engine    (the crosscheck ladder)
│   ├── Classification Engine    (sector→tier→pure-play→rationales)
│   ├── Validation Engine        (required fields per decision)
│   ├── Routing Engine           (exclusive filing, hold records, supersede)
│   └── Change Detection         (what actually differs since last sync)
│
├── Data Layer
│   ├── Kintone API Client
│   ├── Local store (relational; normalized ticker + name indexed)
│   ├── Synchronization Manager
│   └── Audit store (append-only)
│
└── Services
    ├── Logging · Error Handling · Authentication
    ├── Background Processing (sync, batch classify, export)
    └── Monitoring / health checks
```

**Suggested stack** (adjust to house standards): FastAPI or Django, PostgreSQL, SQLAlchemy or
the Django ORM, Alembic migrations, Celery/RQ or APScheduler for background work, pytest.

**Schema note.** Do not port the spreadsheet's positional layout. Model companies, decisions,
list memberships, sync state and audit events as first-class tables with real keys. The current
system's worst structural risk is that everything is read by column index — a single mid-schema
insertion misaligns every read, which is why the workbook now ships a schema self-check.

---

## 4. Kintone Integration

Kintone becomes the authoritative source for the DB reference list. **The REST API supports
everything this design needs — verified against the current API documentation:**

| Need | API capability | Limit |
|---|---|---|
| Read reference records | `GET /k/v1/records.json` | **500 records per request**; `offset` caps at **10,000** — beyond that use the cursor API or the seek method (`$id > <last id> order by $id asc limit 500`) |
| **Incremental sync** | `query=Updated_datetime > "2026-09-01T00:00:00Z"` | `Updated_datetime`, `Created_datetime`, `$id`, Created/Updated by are all queryable built-ins. Relative helpers (`NOW()`, `FROM_TODAY()`) also available |
| Create profiles | `POST /k/v1/records.json` | **100 records per request** |
| **Subtables in one call** | Table fields post as `value: [{ value: {...} }]` per row | Website URLs and Source Documents go up **with the parent record** — no second keyed import |
| Batched writes | `POST /k/v1/bulkRequest.json` | **20 requests per call, rolled back entirely if any one fails** |
| Field discovery | `GET /k/v1/app/form/fields.json` | Use it to verify field codes at startup rather than assuming them |

**Platform limits, and what they mean here:** 100 concurrent requests per domain (HTTP 429
beyond; response headers expose current concurrency — back off around 80%), and **10,000 API
requests per app per day**. A full reference reload of ~5,000 profiles is ~10 requests. A
typical incremental sync is 1–2. The daily budget is not a constraint on this workload unless
something polls carelessly.

**What this removes from the current process:**

- The manual `.xlsx` export. `Current DB` stops being stale between exports — which is the root
  cause of already-tracked companies appearing as new.
- The two-file CSV import (Profiles, then Source Docs keyed on AlphaSense Ticker + Primary
  Business Name). Subtables post with the parent record, so a blank ticker can no longer break
  the key-match.
- The manual download/import step at the end of the cycle.

```text
Kintone → Sync Layer → Local store → Analyst workflow → Validated change → Kintone
```

Never require a full refresh per user action.

### Before building: confirm with the Kintone administrator

1. **App IDs and field codes** for the profiles app and the watchlist app (`app/form/fields.json`).
   Note the intentionally misspelled codes: `Review Assignement`, `Recomended Sector`,
   `If Add Recomended Tier`.
2. **Authentication method.** Per-app API tokens are simplest and are scoped per app — if
   profiles and watchlist are separate apps, a `bulkRequest` spanning both needs multiple
   tokens. Password auth or OAuth covers cases API tokens do not. Credentials come from
   environment variables or a secrets manager, never source control.
3. **IP allowlisting.** Some Kintone deployments restrict API access by source IP. If yours
   does, the application host has to be allowlisted — this is a hard blocker, so check first.
4. **Write permissions.** Read-only tokens are enough for Phases 2–3; record creation needs
   write scope, which should stay off until parallel testing passes.

### CSV fallback

Keep a CSV/XLSX import path. It is worth having for three reasons: bootstrapping before API
access is granted, disaster recovery when the API is unreachable, and one-off historical loads.

It should not be the primary path. Reference data that is only as fresh as the last manual
export is precisely the condition that produces "this company is already in the database, why is
it in my queue?" — the defect that motivated this rebuild. If the CSV route is used in
production, the application must display the age of the reference data prominently and warn when
it exceeds a configured threshold.

**Upload contract (preserve exactly).** One parent profile per record with two subtables:
Website URLs and Source Documents. In the current CSV that is 19 columns — cols 1–12 parent
(New record flag, Primary Business Name, AlphaSense Ticker, Analyst, Profile Review - Action
Status, CRBM Tier, Pure-Play, Sector, Primary Business Description, Inclusion Rationale,
Tiering Rationale, Folder Name), 13–14 Website subtable, 15–19 Source Documents subtable. The
`New record flag` (`*`) marks the first row of each record's block only. Via the API this
becomes one record object with two table fields; the CSV shape must still be reproducible for
the fallback path. Analyst capture formats today: `Type | URL` per line;
`Name | Note | URL | Date` per line — these become structured child rows.

---

## 5. Performance & Latency

Known bottlenecks to design out, all observed in the current system:

- Whole-tab rewrites on every list change (~3,700 rows on FR Exclude).
- Row-by-row appends and deletes during routing.
- Re-verification of every historical decision on every sweep.
- Re-reading the full Kintone export weekly to detect a handful of changes.
- Stale imports silently re-processed (every prior pull file is re-stacked until removed).
- Hard 6-minute execution ceiling forcing work to be split.

Apply: indexed lookups on canonical ticker/name, incremental sync, batch writes, background
jobs for sync and export, caching of reference membership per run, and lazy loading in the UI.

**Suggested targets** (agree before build; measure, don't assert):

| Operation | Target |
|---|---|
| Incremental Kintone sync (no changes) | < 2 s |
| Incremental sync (≤ 200 changed records) | < 15 s |
| Crosscheck of a 5,000-row pull against full reference | < 30 s |
| Queue load (first 50 records) | < 1 s |
| Single classification action, end to end incl. audit | < 500 ms |
| Kintone write-back per record | < 2 s, retried |

---

## 6. Classification Engine

Extract every rule into a pure, testable engine: inputs, decision rules, outcomes, required
fields, exceptions, routing, validation. No classification logic inside UI handlers.

```text
UI action → Classification service → Business rules → Validation → Persistence → Audit
```

The same engine must serve the UI, batch re-classification, and any future API.

---

## 7. Analyst UI

Actions, not data entry:

```text
Oceanus Group Ltd            OCNS.SG    Market cap 41.2M SGD    Singapore
Surfaced: near-match (fuzzy name) vs "Oceanus Group" on Current DB (OCNS) — confirm new vs same
Prior decisions: none

Classification   [ ADD ]  [ WATCHLIST ]  [ FR EXCLUDE ]  [ CONFIRMED EXCLUDE ]  [ IN DB ]
If Add           Sector [ ▾ ] → Tier auto  ·  Pure-Play auto  ·  Rationales auto
Actions          [ SAVE ]  [ DEFER ]  [ NEXT ]
```

Underlying fields stay editable for the cases the rules do not cover.

---

## 8. Queue-Based Processing

Filter by status, classification, analyst, date, priority, new vs existing, error state, last
updated, review status, and **why it surfaced** (new / near-match / drift / re-review). Support
sequential processing, bulk actions for obvious non-DARB names, and per-analyst assignment that
replaces today's one-tab-per-analyst arrangement.

---

## 9. Audit Trail

| Timestamp | Actor | Company | Action | Previous | New | Source |
|---|---|---|---|---|---|---|
| 2026-09-01 10:32 | Luciana | Oceanus Group Ltd | Classification | Needs review | Add | Manual |
| 2026-09-01 10:32 | System | Oceanus Group Ltd | Tier assignment | — | 1A | Automated |
| 2026-09-01 10:32 | System | Oceanus Group Ltd | Hold record created | — | Watchlist (pending) | Automated |
| 2026-09-01 10:33 | System | Oceanus Group Ltd | Kintone sync | Pending | Complete | Automated |

Must answer: **who changed what, when, why, and what happened as a result** — and survive any
later change to the company record.

---

## 10. Error Handling

One bad record or a Kintone timeout must never stop the queue. Capture, log against the
company, keep going, and offer retry:

```text
⚠ Sync failed — Oceanus Group Ltd — Kintone API timeout (attempt 2 of 3)
[ RETRY ]  [ SKIP ]  [ VIEW DETAILS ]
```

The current implementation already leaves a failed row un-stamped so it retries next run; keep
that self-healing property.

---

## 11. Data Integrity

Stable internal IDs plus canonical ticker/name keys. Duplicate detection on write. Validation
before write. Transactional decision-plus-audit. Conflict detection on Kintone revision.
Row-level locking where two analysts could touch one company — the current system serialises
routing on a document lock for exactly this reason.

**Invariants to enforce** (each one is a defect that has actually occurred):

1. A company is filed on **at most one** reference list. `Add` may additionally hold a pending
   record.
2. An `Add` has a staging record **and** a hold record — or neither.
3. A staging record is never exported when a **newer** decision contradicts it.
4. A decision recorded as complete is present on its destination.
5. A company already tracked in Kintone never appears in the new-company queue.
6. No company appears twice on one list.
7. A resurfaced stale ticker keeps its review history.

---

## 12. Logging & Monitoring

Keep the **audit trail** (business: who decided what) separate from the **application log**
(technical: API calls, exceptions, sync events, background jobs, auth failures, timings).
Business auditability must not depend on application logs.

Carry forward the workbook's **Health Check** as a scheduled integrity job asserting the
invariants in §11 and alerting on breach.

---

## 13. Testing & Validation

**Functional equivalence.** Same pull + same reference set ⇒ same classification and routing as
the current macro, unless a change is explicitly approved. The existing suite in `../test/`
(174 assertions over the real `Code.gs`) is the behavioural specification — port it.

**Regression cases that must pass** (each is a real, reproduced defect):

1. `Add` writes both records; a pre-existing Watchlist row does not suppress the staging record.
2. `Add` recovers when the reviewed date is already stamped but the staging record is missing.
3. `In DB` records an alias; the same near-match does not resurface next cycle.
4. A reviewed company whose ticker string changed stays excluded.
5. A company in flight with an analyst is not re-issued as new.
6. A stale ticker resurfaces **and keeps** its reference row; a second run does not duplicate it.
7. A 30-day-old review is not resurfaced at a 365-day threshold.
8. A later non-`Add` decision retires the staging record — but an **older** decision never
   retires a newer `Add`.
9. An already-imported staging record is warned about, never deleted.
10. A company already in the DB never appears in the queue, including one queued in an earlier
    cycle and added since.
11. Filing a company on one list clears the others.
12. Separator variants (`9923:HK` / `9923 HK` / `9923.HK`) are one company.
13. Merging duplicates preserves the reviewed date, analyst and any field held only by the row
    being removed.
14. A schema/field change is detected and reported rather than silently misread.

**Edge cases:** missing fields, blank classifications, duplicates, ticker-less profiles, name
collisions after normalization, conflicting decisions from two analysts, API failures, partial
updates, invalid data, unexpected Kintone responses.

**Performance:** measure against §5 targets on production-sized data (~3,700 exclude rows,
~1,000 watchlist rows, ~5,000-row pulls).

---

## 14. Migration Strategy

| Phase | Content |
|---|---|
| 1 — Discovery | Document current rules from `Code.gs`, `PROCESS.md`, `KINTONE_FORMAT.md`, `ENGINEERING_HANDOFF.md`, `CODE_AUDIT.md` and the test suite. Confirm the four Kintone prerequisites in §4 (app IDs and field codes, auth method, IP allowlisting, write permissions) before committing to the API path. |
| 2 — Python core | Identification, classification, validation, routing engines + data model. Port the test suite first. |
| 3 — Kintone integration | Read sync with change detection; then write-back. |
| 4 — Analyst UI | Queue + one-click classification. |
| 5 — Audit system | Append-only events, per-company history, the Routing Outcomes equivalent. |
| 6 — Parallel testing | Run both systems on the same weekly pull; diff every classification. Investigate **every** difference before accepting it. |
| 7 — Performance | Optimise against the §5 targets. |
| 8 — Production | Cut over per analyst, keeping the workbook read-only as a fallback for one full cycle. |

**Data migration.** The workbook holds real state the Python app must inherit: Watchlist
(Kintone-sourced + locally added + legacy import), FR Exclude, Confirmed Exclude, In DB
Reference, staged Adds, and per-analyst review history including reviewed dates. Run the
workbook's **Repair reference lists** action before extracting, so duplicates and cross-list
conflicts are resolved first. Treat the reviewed dates as authoritative — they drive the
re-review clock.

---

## 15. Development Requirements

Review the existing implementation before writing code. Specifically identify: the crosscheck
ladder and its precedence, the five decisions and their side effects, the tier/sector rule
tables, the required-field rules, the Kintone upload contract, the manual steps that exist only
because the platform is a spreadsheet, and the audit events already emitted.

Do **not** convert line-for-line. `Understand → Document → Refactor → Optimize → Test → Deploy`.

Known-good behaviours to preserve verbatim: the conservative fuzzy thresholds, the verbatim
rationale boilerplate, the misspelled field names, the two Profile Status values, the two-table
upload shape, the per-company outcome ledger, and idempotency of every operation.

Known problems **not** to carry over: manual `.xlsx` reference exports, whole-list rewrites,
column-index addressing, the 100-row audit cap, state inferred from whether a date cell is
filled, and decisions that live in editable cells with no ownership or history.

---

## 16. Success Criteria

| Dimension | Target |
|---|---|
| **Automation** | No manual export/upload of reference data. Analyst sets no derived field by hand. |
| **Speed** | Decision → recorded → synced in seconds, not a weekly batch. Meets §5. |
| **Accuracy** | Identical classification to the current macro on parallel runs, or a documented, approved reason. |
| **Usability** | One click per decision; everything needed to decide on one screen. |
| **Transparency** | Every decision attributable, with before/after, permanently. |
| **Reliability** | An API failure or bad record never stops the queue; failed work retries. |
| **Scalability** | Handles growth in companies, analysts and lists without whole-dataset passes. |
| **Maintainability** | UI, engines, Kintone client and audit independently testable; the invariants in §11 enforced by automated checks. |

---

## Primary Development Principle

**The goal is not to make the spreadsheet look like a Python application.** It is to use Python
to remove the friction the spreadsheet imposes — the manual exports, the whole-table rewrites,
the invisible state, the once-a-week batch — while preserving the classification methodology
exactly and building a far stronger audit and data-control framework around it.

The analyst makes **decisions**. The system does the rest.
