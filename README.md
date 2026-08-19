# DARB - Securities Projects, Scrips, and Procedures

CRB Monitor working repository for DARB (Digital Asset-Related Business)
securities projects, scrips, and operating procedures.

## Repository structure

### `Macro - DARB Identification/`
The current, canonical DARB new-securities identification pipeline.

- `Code.gs` - the single-file, container-bound Google Apps Script that runs
  the end-to-end DARB new-securities sort pipeline (consolidate AlphaSense
  exports, crosscheck against the live database and exclude lists, route
  reviewed companies, and format qualified additions for Kintone bulk upload).
- `PROCESS.md` - operator/analyst runbook for the weekly cycle.
- `REBOOT.md` - how to update the live workbook: paste, reload, re-authorize,
  rescaffold, health check, rollback and troubleshooting.
- `DEPLOY.md` - automated `clasp` deployment from GitHub Actions.
- `KINTONE_FORMAT.md` - the Kintone bulk-upload column contract.
- `ENGINEERING_HANDOFF.md` - engineering handoff covering runtime, OAuth
  scopes, recommended repo layout, `clasp` deployment, architecture map,
  data contract, conventions, testing/CI, and the prioritised backlog.
- `CODE_AUDIT.md` - code audit and the status of each finding.

### `test/`
Offline test suite for the pipeline - `npm test`. `gas-mock.js` fakes enough of
Apps Script for the real `Code.gs` to be loaded and driven in Node, so the tests
exercise the shipped code rather than copies of it. Also run by CI and as a gate
before any deploy.

### `archive/`
Legacy and superseded Kintone app customizations and supporting docs, kept
for reference (ETP Holdings Update views, audit-escalation apps, CRB clean
view styling, the DARB assistant, task-button and projects-app enhancements,
and the earlier setup/quick-reference guides).

## Ownership

Product owner / primary operator: Peter Simcox (CRB Monitor).
