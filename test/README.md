# Pipeline tests

`npm test` — runs every `*.test.js` here in its own process and prints a combined tally.
Also run by CI on every push/PR, and as a gate before any `clasp` deploy.

## How it works

Apps Script does not run in Node, so `gas-mock.js` implements just enough of the platform —
`SpreadsheetApp`, sheets, ranges, checkboxes, data validations, the modal/alert UI,
`LockService`, `Utilities`, `DriveApp` — for `Code.gs` to be loaded and driven offline.

`harness.js` reads the real `Macro - DARB Identification/Code.gs` and evaluates it in the
global scope, then exposes the assertion and fixture helpers. **The suites call the real
functions.** Nothing is reimplemented here, so the tests cannot quietly drift away from the
source — the reason the unit-test scaffold was held back until now (`CODE_AUDIT.md` finding 6).

The mock is deliberately faithful where behaviour depends on it — for example
`Range.removeCheckboxes()` clears TRUE/FALSE values exactly as Sheets does, which is what the
Sort carry-forward has to work around.

## Suites

| File | Covers |
|------|--------|
| `00-helpers.test.js` | Pure helpers: name/ticker normalization, staleness, fuzzy matching, capture-format parsing, CSV quoting, legacy row migration, dedup lookup. |
| `01-routing-and-crosscheck.test.js` | Add routing to both tabs, In DB Reference, crosscheck exclusion of reviewed/staged/in-flight companies, Sort carry-forward, stale re-review, step-order pre-flight, dashboard migration. |
| `02-crosscheck-guards.test.js` | DB-drift scope, counter reconciliation, the short-name exclusion guard. |
| `03-superseded-adds.test.js` | A later decision retiring a stale Adds staging row — including the guard that stops an older decision from retiring a newer Add, and the `Imported?` exemption. |
| `04-health-check.test.js` | Ticker canonicalization end-to-end, and every Health Check finding (schema drift, routing contradictions, settings). |

## Writing a test

```js
'use strict';
var H = require('./harness.js');
var ok = H.ok, rows = H.rows, ss = H.ss;

H.setup();                                   // empty workbook, all tabs scaffolded
H.internRow(ensureInternTab_('Ethan Guys'),  // Code.gs functions are globals
  ['Acme Inc', 'ACME', 'Add', '', 'Ethan Guys', 'Acme Inc', 'd', 'i', 't', '1A', 'Mining', 'Yes']);
processReviews();
ok(rows('Adds', 17).length === 1, 'the Add was staged');
H.finish();                                  // prints the tally, sets the exit code
```

Dialogs: `H.mock.setUiAnswer('YES' | 'NO')` chooses what the operator clicks, and
`H.mock.uiLog` holds the prompts that were shown.

## Limits

The mock is not Google Sheets. Formatting, banding, filters, tab colours and column widths are
accepted and ignored; formulas are stored as text, not evaluated. Anything that depends on
real rendering or on the 6-minute execution limit still has to be checked in the workbook.
