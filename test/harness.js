/**
 * Shared test harness. Loads Code.gs into the global scope on top of the Apps Script mock
 * (gas-mock.js), so every suite calls the real functions - no copies of the logic that could
 * drift from the source, which is why the unit-test scaffold was held back until now
 * (CODE_AUDIT.md finding 6).
 */
'use strict';
var fs = require('fs');
var path = require('path');
var mock = require('./gas-mock.js');

var CODE_PATH = path.join(__dirname, '..', 'Macro - DARB Identification', 'Code.gs');
(0, eval)(fs.readFileSync(CODE_PATH, 'utf8'));   // indirect eval -> Code.gs defines globals

var passes = 0, fails = 0;

/** Assert. Prints PASS/FAIL and keeps the running tally for finish(). */
function ok(cond, msg) {
  if (cond) { passes++; console.log('  PASS ' + msg); }
  else { fails++; console.log('  FAIL ' + msg); }
}

/** Data rows of a tab as a 2D array (header excluded). */
function rows(name, cols) {
  var sh = mock.ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, cols || sh.getLastColumn()).getValues();
}

/** Empty workbook with every tab freshly scaffolded. */
function setup() {
  mock.resetSs();
  scaffoldAll_(true);
}

/** Append a row to an analyst tab, padded to the canonical 18-column layout. */
function internRow(sh, values) {
  var full = values.slice();
  while (full.length < INTERN_WIDTH) full.push('');
  sh.appendRow(full);
}

/** Append a staging row to Adds. */
function addsRow(company, ticker, imported) {
  mock.ss.getSheetByName(TABS.adds.name).appendRow([imported === true, false, 'Ethan Guys', '*',
    company, company, ticker, ACTION_STATUS_DEFAULT, '1A', 'Yes', 'Mining', '', '', '', '', '', '']);
}

/** Everything written to the History Log, newest last, as one string. */
function historyText() {
  return rows('History Log', 4).map(function (r) { return String(r[3]); }).join('\n');
}

/** Print the tally and exit non-zero if anything failed. */
function finish() {
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}

module.exports = {
  mock: mock, ss: mock.ss, ok: ok, rows: rows, rowsOf: rows, setup: setup,
  internRow: internRow, ir: internRow, addsRow: addsRow, historyText: historyText, finish: finish
};
