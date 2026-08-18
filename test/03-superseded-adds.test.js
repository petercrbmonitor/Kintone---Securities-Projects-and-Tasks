'use strict';
var H = require('./harness.js');
var mock = H.mock, ss = H.ss, ok = H.ok, rows = H.rows, rowsOf = H.rowsOf;
var internRow = H.internRow, ir = H.ir, addsRow = H.addsRow, setup = H.setup;


/* ============ 1. THE FIX: analyst downgrades their own routed Add ============ */
console.log('TEST A: Add -> analyst changes the routed row to Watchlist');
mock.resetSs(); scaffoldAll_(true);
var luci = ensureInternTab_('Luciana Villarreal Romero'); scaffoldInternSheets_(true);
ir(luci, ['Zeta Digital Ltd', 'ZETA', 'Add', '', 'Luciana Villarreal Romero', 'Zeta Digital Ltd',
  'd', 'i', 't', '1B', 'Mining', 'Yes', '', '', 'AS Pull', '']);
processReviews();
ok(rows('Adds', 17).length === 1, 'the Add staged normally');
luci.getRange(4, 3).setValue('Watchlist');       // routed rows sit under the Completed marker
processReviews();
ok(rows('Adds', 17).length === 0, 'the orphaned Adds staging row is retired');
var wl = rows('Watchlist', 13);
ok(wl.length === 1 && String(wl[0][2]) === 'Watchlist',
  'the Watchlist row is re-stamped from "Add" to "Watchlist"');
ok(H.historyText().indexOf('SUPERSEDES') >= 0, 'the supersede is named in the Routing Outcomes log');

/* ====== 2. THE GUARD: an OLD decision must not retire a NEWER Add ====== */
console.log('\nTEST B: old "Watchlist" audit row must NOT kill a later Add');
mock.resetSs(); scaffoldAll_(true);
var isaac = ensureInternTab_('Isaac M'); scaffoldInternSheets_(true);
var ethan = ensureInternTab_('Ethan Guys'); scaffoldInternSheets_(true);
// Isaac decided "Watchlist" a year ago (already routed - dated + on the Watchlist)
ir(isaac, ['Nova Chain PLC', 'NOVA', 'Watchlist', new Date(2025, 0, 10), 'Isaac M', 'Nova Chain PLC']);
ss.getSheetByName('Watchlist').appendRow(['Nova Chain PLC', 'NOVA', 'Watchlist', new Date(2025, 0, 10),
  'Isaac M', '', '', 'AS Pull', '', false, '', '', '']);
// Ethan re-reviewed it this week and added it
ir(ethan, ['Nova Chain PLC', 'NOVA', 'Add', '', 'Ethan Guys', 'Nova Chain PLC', 'd', 'i', 't',
  '1A', 'Mining', 'Yes', '', '', 'AS Pull', '']);
processReviews();
ok(rows('Adds', 17).length === 1, 'the newer Add is staged');
processReviews();   // Isaac's old row re-verifies on every sweep
ok(rows('Adds', 17).length === 1, "the older analyst's audit row does NOT retire the newer Add");
processReviews();
ok(rows('Adds', 17).length === 1, 'and still not after a third sweep');

/* ============ 3. Imported? guard ============ */
console.log('\nTEST C: an already-imported staging row is warned about, never deleted');
mock.resetSs(); scaffoldAll_(true);
var eth = ensureInternTab_('Ethan Guys'); scaffoldInternSheets_(true);
addsRow('Kappa Corp', 'KAP', true);                     // Imported? ticked
ir(eth, ['Kappa Corp', 'KAP', 'Confirmed Exclude', '', 'Ethan Guys', 'Kappa Corp']);
processReviews();
ok(rows('Adds', 17).length === 1, 'the imported staging row is left in place');
ok(H.historyText().indexOf('already in Kintone') >= 0, 'and the operator is told to retire it in Kintone');
ok(rows('Confirmed Exclude', 10).length === 1, 'the new decision is still filed normally');

/* ============ 4. fresh route (no prior date) retires too ============ */
console.log('\nTEST D: a fresh route to a non-Add list retires a stale staging row');
mock.resetSs(); scaffoldAll_(true);
var eth2 = ensureInternTab_('Ethan Guys'); scaffoldInternSheets_(true);
addsRow('Omega Labs Inc', 'OMG', false);
ir(eth2, ['Omega Labs Inc', 'OMG', 'FR Exclude', '', 'Ethan Guys', 'Omega Labs Inc']);
processReviews();
ok(rows('Adds', 17).length === 0, 'the staging row is retired');
ok(rows('FR Exclude', 10).length === 1, 'and the company is filed on FR Exclude');

/* ============ 5. Move To path ============ */
console.log('\nTEST E: moving a staged company onto a list retires its staging row');
mock.resetSs(); scaffoldAll_(true);
addsRow('Sigma Mining Ltd', 'SIG', false);
var sortSh = ss.getSheetByName('Sort');
sortSh.appendRow(['Sigma Mining Ltd', 'SIG', true, 'Confirmed Exclude', '', '', '', '', '', '', '', '', 'AS Pull', '']);
ss.setActiveSheet(sortSh);
moveSelected();
ok(rows('Adds', 17).length === 0, 'Move To -> Confirmed Exclude retires the staging row');
ok(rows('Confirmed Exclude', 10).length === 1, 'and files the company');

console.log('\nTEST E2: moving a row back to Sort does NOT retire the staging row');
mock.resetSs(); scaffoldAll_(true);
addsRow('Delta Chain Co', 'DLT', false);
var wlSh = ss.getSheetByName('Watchlist');
wlSh.appendRow(['Delta Chain Co', 'DLT', 'Add', new Date(), 'Ethan Guys', '', '1A', 'AS Pull',
  'Pending Kintone Add', false, '', '', '', true, 'Sort']);
ss.setActiveSheet(wlSh);
moveSelected();
ok(rows('Adds', 17).length === 1, 'reopening for triage leaves the staging row alone');

/* ============ 6. build-time backstop for pre-existing orphans ============ */
console.log('\nTEST F: Build Kintone Upload flags a contradicted staging row');
mock.resetSs(); scaffoldAll_(true);
var eth3 = ensureInternTab_('Ethan Guys'); scaffoldInternSheets_(true);
addsRow('Theta Systems Inc', 'THT', false);
// an orphan that predates the fix: the analyst row says Watchlist and is already dated,
// but no Watchlist row exists, so the routing sweep cannot prove anything from the destination
ir(eth3, ['Theta Systems Inc', 'THT', 'Watchlist', new Date(2026, 1, 1), 'Ethan Guys', 'Theta Systems Inc']);
markStep_(PIPELINE_STEPS[5], 'test');   // satisfy the step-order guard so it does not prompt
mock.uiLog.length = 0;
mock.setUiAnswer('NO');
buildKintoneUpload();
ok(mock.uiLog.length >= 1 && mock.uiLog.join(' ').indexOf('Theta Systems Inc') >= 0,
  'the contradicted row is named in the pre-build warning');
ok(mock.uiLog.join(' ').indexOf('latest analyst decision is "Watchlist"') >= 0,
  'the warning states the conflicting decision');
ok(rows('Kintone Upload', 19).length === 0, 'choosing No cancels the build');
mock.setUiAnswer('YES');

console.log('\nTEST G: a clean Add still builds without a warning');
mock.resetSs(); scaffoldAll_(true);
var eth4 = ensureInternTab_('Ethan Guys'); scaffoldInternSheets_(true);
ir(eth4, ['Iota Data Corp', 'IOT', 'Add', '', 'Ethan Guys', 'Iota Data Corp', 'BUSINESS DESCRIPTION: x',
  'INCLUSION RATIONALE: y', 'TIER RATIONALE: z', '1A', 'Mining', 'Yes',
  'Website | https://iota.com', 'PR | n | https://iota.com/pr | 2026-01-01', 'AS Pull', '']);
processReviews();
markStep_(PIPELINE_STEPS[5], 'test');   // satisfy the step-order guard so it does not prompt
mock.uiLog.length = 0;
buildKintoneUpload();
ok(mock.uiLog.length === 0, 'no spurious warning for a legitimate Add');
ok(rows('Kintone Upload', 19).length === 2, 'and it builds (1 source doc row + 1 website row)');

H.finish();
