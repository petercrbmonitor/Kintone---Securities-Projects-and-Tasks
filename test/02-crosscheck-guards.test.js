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


/* ============ stale queue rows ============ */
console.log('\nTEST 15: a queued name that is now in Current DB is dropped from Sort');
mock.resetSs(); scaffoldAll_(true);
var sortSh = ss.getSheetByName('Sort');
// queued last cycle as a brand-new name...
sortSh.appendRow(['Gemini Space Station Inc', 'GEMI', false, '', '', '', '', '', '', '', '', '', 'AS Pull', '']);
// ...and added to Kintone since, so the refresh now has it
ss.getSheetByName('Current DB').appendRow(['Gemini Space Station Inc', 'GEMI', 'Active', '1A',
  '', '', '', '', '', false, 'R9', 'Exchanges/Platforms', '']);
ss.getSheetByName('Clean Pull').appendRow(['Some Other Co', 'OTH', '', '', '', '', '']);
runCrosscheck();
var t15 = rowsOf('Sort', 14).map(function (r) { return String(r[1]); });
ok(t15.indexOf('GEMI') < 0, 'the already-tracked queue row is gone');
ok(t15.indexOf('OTH') >= 0, 'the genuinely new name is there');
ok(rowsOf('History Log', 4).map(function (r) { return String(r[3]); }).join(' ')
   .indexOf('now tracked on Current DB') >= 0, 'and the log says why it went');

console.log('\nTEST 16: near-match and drift rows are NOT dropped (they need a human answer)');
mock.resetSs(); scaffoldAll_(true);
var sortSh2 = ss.getSheetByName('Sort');
sortSh2.appendRow(['Acme Holdings PLC', 'ACM.L', false, '', '', '', '', '', '', '', '', '', 'Review',
  'Near-match (exact name) vs "Acme Holdings Inc" on Current DB - confirm new vs same.']);
sortSh2.appendRow(['Renamed Corp', 'RNM', false, '', '', '', '', '', '', '', '', '', 'DB Drift',
  'Name changed - same ticker as "Old Name Corp" on Current DB.']);
ss.getSheetByName('Current DB').appendRow(['Acme Holdings Inc', 'ACME', 'Active', '1A', '', '', '', '', '', false, 'R1', '', '']);
ss.getSheetByName('Current DB').appendRow(['Old Name Corp', 'RNM', 'Active', '1A', '', '', '', '', '', false, 'R2', '', '']);
ss.getSheetByName('Clean Pull').appendRow(['Filler Co', 'FIL', '', '', '', '', '']);
runCrosscheck();
var t16 = rowsOf('Sort', 14).map(function (r) { return String(r[1]); });
ok(t16.indexOf('ACM.L') >= 0, 'the near-match question is still on the queue');
ok(t16.indexOf('RNM') >= 0, 'and the unresolved drift row too');

console.log('\nTEST 17: a drift row goes once the DB name matches again');
mock.resetSs(); scaffoldAll_(true);
ss.getSheetByName('Sort').appendRow(['Renamed Corp', 'RNM', false, '', '', '', '', '', '', '', '', '',
  'DB Drift', 'Name changed - same ticker as "Old Name Corp" on Current DB.']);
ss.getSheetByName('Current DB').appendRow(['Renamed Corp', 'RNM', 'Active', '1A', '', '', '', '', '', false, 'R2', '', '']);
ss.getSheetByName('Clean Pull').appendRow(['Filler Co', 'FIL', '', '', '', '', '']);
runCrosscheck();
ok(rowsOf('Sort', 14).map(function (r) { return String(r[1]); }).indexOf('RNM') < 0,
  'the drift is resolved, so the row is dropped');

console.log('\nTEST 18: the Health Check flags a stale queue row before you re-run Crosscheck');
mock.resetSs(); scaffoldAll_(true);
ss.getSheetByName('Sort').appendRow(['Gemini Space Station Inc', 'GEMI', false, '', '', '', '', '', '', '', '', '', 'AS Pull', '']);
ss.getSheetByName('Current DB').appendRow(['Gemini Space Station Inc', 'GEMI', 'Active', '1A', '', '', '', '', '', false, 'R9', '', '']);
runHealthCheck();
var hc = rowsOf('Health Check', 7).filter(function (r) { return String(r[1]) === 'Already tracked on Sort'; });
ok(hc.length === 1 && String(hc[0][4]) === 'GEMI', 'reported, with the ticker named');

H.finish();
