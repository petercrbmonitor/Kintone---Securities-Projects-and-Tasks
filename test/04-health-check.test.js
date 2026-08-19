'use strict';
var H = require('./harness.js');
var mock = H.mock, ss = H.ss, ok = H.ok, rows = H.rows, rowsOf = H.rowsOf;
var internRow = H.internRow, ir = H.ir, addsRow = H.addsRow, setup = H.setup;

function report() { return rows('Health Check', 7); }
function found(check, sev) {
  return report().filter(function (r) {
    return String(r[1]) === check && (!sev || String(r[0]) === sev);
  });
}

/* ---------------- ticker canonicalization (audit finding 5) ---------------- */
console.log('TEST H1: separator styles are the same ticker');
mock.resetSs(); scaffoldAll_(true);
ss.getSheetByName('Current DB').appendRow(['Hong Kong Chain Ltd', '9923.HK', 'Active', '1A',
  '', '', '', '', '', false, 'R1', 'Mining', '']);
ss.getSheetByName('Clean Pull').appendRow(['Hong Kong Chain Ltd', '9923:HK', '', '', '', '', '']);
ss.getSheetByName('Clean Pull').appendRow(['Berkshire Crypto B', 'BRK/B', '', '', '', '', '']);
ss.getSheetByName('Confirmed Exclude').appendRow(['Berkshire Crypto B', 'BRK.B', 'Confirmed Exclude',
  new Date(), 'Isaac M', '', '3', 'AS Pull', '', false]);
runCrosscheck();
ok(rows('Sort', 14).length === 0, '9923:HK / BRK/B match 9923.HK / BRK.B and stay off Sort');
ok(rows('Excluded', 4).length === 2, 'both are reported as excluded');

/* ---------------- health check: clean workbook ---------------- */
console.log('\nTEST H2: a clean workbook reports OK');
mock.resetSs(); scaffoldAll_(true);
runHealthCheck();
ok(report().length === 1 && String(report()[0][0]) === 'OK', 'single OK row, no findings');

/* ---------------- schema drift ---------------- */
console.log('\nTEST H3: schema drift is caught');
mock.resetSs(); scaffoldAll_(true);
var eth = ensureInternTab_('Ethan Guys'); scaffoldInternSheets_(true);
eth.getRange(1, 9).setValue('Tier Rationale');            // analyst tab header renamed
ss.getSheetByName('Watchlist').getRange(1, 14).setValue('Pick');  // Select column drifted
ss.getSheetByName('Adds').getRange(1, 5).setValue('Business Name');
runHealthCheck();
var sch = found('Schema', 'ERROR');
ok(sch.length >= 3, 'header drift on the analyst tab, Watchlist and Adds all reported');
ok(sch.some(function (r) { return String(r[5]).indexOf('Column I') >= 0; }),
  'the exact column letter is named');
ok(sch.some(function (r) { return String(r[5]).indexOf('MOVABLE expects "Select"') >= 0; }),
  'a Select column that no longer lines up with MOVABLE is called out');

/* ---------------- state: unrouted + contradicted + orphan pairs ---------------- */
console.log('\nTEST H4: routing contradictions are caught');
mock.resetSs(); scaffoldAll_(true);
var e2 = ensureInternTab_('Ethan Guys'); scaffoldInternSheets_(true);
// reviewed but never routed (no tier, so it cannot route)
ir(e2, ['No Tier Co', 'NTC', 'Add', '', 'Ethan Guys', 'No Tier Co']);
// staged on Adds but the newest decision says Watchlist
ss.getSheetByName('Adds').appendRow([false, false, 'Ethan Guys', '*', 'Theta Systems Inc',
  'Theta Systems Inc', 'THT', ACTION_STATUS_DEFAULT, '1A', 'Yes', 'Mining', '', '', '', '', '', '']);
ir(e2, ['Theta Systems Inc', 'THT', 'Watchlist', new Date(2026, 1, 1), 'Ethan Guys', 'Theta Systems Inc']);
// hold row with nothing staged
ss.getSheetByName('Watchlist').appendRow(['Ghost Corp', 'GHO', 'Add', new Date(), 'Isaac M', '',
  '1A', 'AS Pull', 'Pending Kintone Add', false, '', '', '']);
// same company on two lists
ss.getSheetByName('FR Exclude').appendRow(['Split Brain Ltd', 'SPB', 'FR Exclude', new Date(),
  'Isaac M', '', '', 'AS Pull', '', false]);
ss.getSheetByName('Confirmed Exclude').appendRow(['Split Brain Ltd', 'SPB', 'Confirmed Exclude',
  new Date(), 'Isaac M', '', '', 'AS Pull', '', false]);
// listed twice on one list
ss.getSheetByName('FR Exclude').appendRow(['Twice Listed Inc', 'TWC', 'FR Exclude', new Date(),
  'Isaac M', '', '', 'AS Pull', '', false]);
ss.getSheetByName('FR Exclude').appendRow(['Twice Listed Inc', 'TWC', 'FR Exclude', new Date(),
  'Isaac M', '', '', 'AS Pull', '', false]);
runHealthCheck();
ok(found('Unrouted review', 'WARN').length === 1, 'the unrouted review is reported');
ok(found('Contradicted Add', 'ERROR').length === 1, 'the overruled staging row is an ERROR');
ok(found('Hold row without staging row', 'WARN').length === 1, 'the orphaned hold row is reported');
ok(found('On two lists', 'WARN').length === 1, 'the company filed on two lists is reported');
ok(found('Duplicate row', 'WARN').length === 1, 'the duplicate row is reported');
ok(found('Routed but missing', 'WARN').length === 1,
  'the row stamped reviewed with no destination record is reported');

/* ---------------- settings ---------------- */
console.log('\nTEST H4b: an ordinary Watchlist row is NOT mistaken for a pending Add');
mock.resetSs(); scaffoldAll_(true);
// Review Assignement reads "Add" but there is no "Pending Kintone Add" note - this is an
// ordinary reference row, not a profile staged for Kintone. Flagging these buried the real
// findings under hundreds of mainstream company names on the live Watchlist.
ss.getSheetByName('Watchlist').appendRow(['Commonwealth Bank of Australia', 'CBA.AU', 'Add',
  new Date(2026, 3, 1), 'Isaac M', '', '', 'AS Pull', 'ordinary watchlist note', false, '', '', '']);
// ...while a genuine hold row (carrying the note) still is flagged
ss.getSheetByName('Watchlist').appendRow(['Real Pending Co', 'RPC', 'Add', new Date(), 'Ethan Guys',
  '', '1A', 'AS Pull', 'Pending Kintone Add', false, '', '', '']);
runHealthCheck();
var holds = found('Hold row without staging row', 'WARN');
ok(holds.length === 1, 'only the row carrying the Pending Kintone Add note is flagged');
ok(String(holds[0][4]) === 'RPC', 'and it is the right one');

console.log('\nTEST H5: unusable Settings values are reported');
mock.resetSs(); scaffoldAll_(true);
var dash = ss.getSheetByName('Dashboard');
for (var r = 1; r <= dash.getLastRow(); r++) {
  if (String(dash.getRange(r, 1).getValue()).indexOf('Re-review tickers older') === 0) {
    dash.getRange(r, 2).setValue('one year');
  }
}
runHealthCheck();
ok(found('Settings', 'WARN').length === 1, 'a non-numeric re-review threshold is reported');
ok(reviewThresholdDays_() === 365, 'and the code still falls back to 365 days');

/* ---------------- read-only guarantee ---------------- */
console.log('\nTEST H6: the health check changes nothing else');
mock.resetSs(); scaffoldAll_(true);
var e3 = ensureInternTab_('Ethan Guys'); scaffoldInternSheets_(true);
ir(e3, ['Untouched Co', 'UNT', 'Add', '', 'Ethan Guys', 'Untouched Co', 'd', 'i', 't', '1A',
  'Mining', 'Yes', '', '', 'AS Pull', '']);
e3.getRange(1, 9).setValue('Tier Rationale');     // drift that a scaffold would silently repair
runHealthCheck();
ok(rows('Adds', 17).length === 0, 'it does not route anything');
ok(String(e3.getRange(1, 9).getValue()) === 'Tier Rationale',
  'and it does not repair the drift it is reporting');

H.finish();
