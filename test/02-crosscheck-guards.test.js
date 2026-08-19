'use strict';
var H = require('./harness.js');
var mock = H.mock, ss = H.ss, ok = H.ok, rows = H.rows, rowsOf = H.rowsOf;
var internRow = H.internRow, ir = H.ir, addsRow = H.addsRow, setup = H.setup;

console.log('TEST 11: no bogus "DB Drift" from an Adds/In DB Reference ticker match');
mock.resetSs(); scaffoldAll_(true);
ss.getSheetByName('Adds').appendRow([false, false, 'Ethan Guys', '*', 'Acme Blockchain Inc',
  'Acme Blockchain Holdings PLC', 'ACME', ACTION_STATUS_DEFAULT, '1A', 'Yes', 'Mining', '', '', '', '', '', '']);
ss.getSheetByName('Clean Pull').appendRow(['Totally Different Name Corp', 'ACME', '', '', '', '', '']);
runCrosscheck();
ok(rowsOf('Sort', 14).length === 0, 'an Adds ticker match raises no DB Drift row');
ok(rowsOf('Excluded', 4).length === 1, 'it is simply excluded');

console.log('\nTEST 12: DB Drift still raised for a Current DB ticker match');
mock.resetSs(); scaffoldAll_(true);
ss.getSheetByName('Current DB').appendRow(['Old Name Corp', 'DRF', 'Active', '1A', '', '', '', '', '', false, 'R1', 'Mining', '']);
ss.getSheetByName('Clean Pull').appendRow(['Totally Different Name Corp', 'DRF', '', '', '', '', '']);
runCrosscheck();
var s = rowsOf('Sort', 14);
ok(s.length === 1 && String(s[0][12]) === 'DB Drift', 'Current DB name drift still surfaces on Sort');

console.log('\nTEST 13: short normalized names are not used for name-exclusion');
mock.resetSs(); scaffoldAll_(true);
ss.getSheetByName('FR Exclude').appendRow(['IBM', 'IBM', 'FR Exclude', new Date(), 'Isaac M', '', '', '', '', false]);
ss.getSheetByName('Clean Pull').appendRow(['IBM', 'IBM.DE', '', '', '', '', '']);
runCrosscheck();
ok(rowsOf('Sort', 14).length === 1, 'a 3-char normalized name does not silently exclude a new ticker');

console.log('\nTEST 14: counters reconcile with rows actually added');
mock.resetSs(); scaffoldAll_(true);
var wl = ss.getSheetByName('Watchlist');
wl.appendRow(['Stale One Corp', 'ST1', 'Watchlist', new Date(2019, 0, 1), 'Isaac M', '', '2', 'AS Pull', '', false, '', '', '']);
ss.getSheetByName('Clean Pull').appendRow(['Stale One Corp', 'ST1', '', '', '', '', '']);
runCrosscheck();
runCrosscheck();   // second pass: the re-review row is already queued
var hist = rowsOf('History Log', 4).filter(function (r) { return String(r[1]) === 'Run Crosscheck'; });
var last = String(hist[hist.length - 1][3]);
console.log('  ' + last);
ok(last.indexOf('0 new to SORT') === 0 || /^\d+ in - 0 new to SORT/.test(last),
  'second run reports 0 new (re-review not double-counted)');
ok(rowsOf('Sort', 14).length === 1, 'and Sort still holds exactly one row');

H.finish();
