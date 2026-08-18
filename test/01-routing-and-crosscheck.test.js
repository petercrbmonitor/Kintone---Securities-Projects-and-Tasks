'use strict';
var H = require('./harness.js');
var mock = H.mock, ss = H.ss, ok = H.ok, rows = H.rows, rowsOf = H.rowsOf;
var internRow = H.internRow, ir = H.ir, addsRow = H.addsRow, setup = H.setup;


function dump(name) {
  var sh = ss.getSheetByName(name);
  if (!sh) return console.log('  (no tab ' + name + ')');
  console.log('  --- ' + name + ' ---');
  sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), Math.max(sh.getLastColumn(), 1)).getValues()
    .forEach(function (r, i) { console.log('   ' + i + ': ' + JSON.stringify(r.slice(0, 10))); });
}

/* ============================ TEST 1 - Add routes to BOTH tabs ======================= */
console.log('\nTEST 1: Add writes Adds AND the Watchlist hold row');
setup();
var ethan = ensureInternTab_('Ethan Guys');
scaffoldInternSheets_(true);
// Company | Ticker | RevAssign | RevDate | Analyst | PBN | Desc | Incl | Tiering | Tier | Sector...
internRow(ethan, ['Acme Blockchain Inc', 'ACME', 'Add', '', 'Ethan Guys', 'Acme Blockchain Inc',
  'BUSINESS DESCRIPTION: x', 'INCLUSION RATIONALE: y', 'TIER RATIONALE: z', '1A', 'Mining', 'Yes',
  'Website | https://a.com', 'PR | note | https://a.com/pr | 2026-01-01', 'AS Pull', '']);
processReviews();
var adds = rowsOf('Adds', 17), wl = rowsOf('Watchlist', 13);
ok(adds.length === 1 && String(adds[0][6]) === 'ACME', 'Adds has the ACME staging row');
ok(wl.length === 1 && String(wl[0][1]) === 'ACME' && String(wl[0][2]) === 'Add' &&
   String(wl[0][8]).indexOf('Pending Kintone Add') >= 0, 'Watchlist has the Add hold row');

console.log('\nTEST 1b: re-running Process Reviews is idempotent (no dupes, no lost Adds row)');
processReviews();
ok(rowsOf('Adds', 17).length === 1, 'Adds still has exactly 1 row');
ok(rowsOf('Watchlist', 13).length === 1, 'Watchlist still has exactly 1 row');

/* ====== TEST 2 - the reported defect: reviewed date set + row already on Watchlist ==== */
console.log('\nTEST 2: DEFECT - pre-stamped date + existing Watchlist row must NOT suppress Adds');
setup();
var luci = ensureInternTab_('Luciana Villarreal Romero');
scaffoldInternSheets_(true);
// company already sitting on the Watchlist from an earlier cycle
ss.getSheetByName('Watchlist').appendRow(['Zeta Digital Ltd', 'ZETA', 'Watchlist', new Date(2025, 0, 5),
  'Luciana Villarreal Romero', '', '2', 'AS Pull', 'watching', false, '', '', '']);
// analyst reviewed it as an Add and the reviewed date is already stamped (hand-entered / partial run)
internRow(luci, ['Zeta Digital Ltd', 'ZETA', 'Add', new Date(2026, 5, 1), 'Luciana Villarreal Romero',
  'Zeta Digital Ltd', 'd', 'i', 't', '1B', 'Mining', 'Yes', '', '', 'AS Pull', '']);
processReviews();
var adds2 = rowsOf('Adds', 17);
ok(adds2.length === 1 && String(adds2[0][6]) === 'ZETA',
  'the Add is recovered onto Adds even though a Watchlist row already existed');
var wl2 = rowsOf('Watchlist', 13);
ok(wl2.length === 1 && String(wl2[0][2]) === 'Add' && String(wl2[0][8]).indexOf('Pending Kintone Add') >= 0,
  'the pre-existing Watchlist row is re-stamped as the Add hold row (not duplicated)');

/* ================== TEST 3 - In DB is recorded durably (no weekly churn) ============= */
console.log('\nTEST 3: In DB writes the In DB Reference row');
setup();
var isaac = ensureInternTab_('Isaac M');
scaffoldInternSheets_(true);
internRow(isaac, ['Nova Chain PLC', 'NOVA.L', 'In DB', '', 'Isaac M', 'Nova Chain PLC',
  '', '', '', '', '', '', '', '', 'Review', 'same as NOVA']);
processReviews();
var idb = rowsOf('In DB Reference', 10);
ok(idb.length === 1 && String(idb[0][1]) === 'NOVA.L' && String(idb[0][2]) === 'In DB',
  'In DB Reference holds the alias');
processReviews();
ok(rowsOf('In DB Reference', 10).length === 1, 're-run does not duplicate the In DB alias');

/* ============ TEST 4 - crosscheck: reviewed companies do not come back ============== */
console.log('\nTEST 4: crosscheck excludes reviewed / staged / in-flight companies');
setup();
var cp = ss.getSheetByName('Clean Pull');
[['Acme Blockchain Inc', 'ACME', '', '', '', '', ''],          // staged on Adds
 ['Zeta Digital Ltd', 'ZETA.NEW', '', '', '', '', ''],          // on Watchlist, ticker changed
 ['Nova Chain PLC', 'NOVA.DE', '', '', '', '', ''],             // In DB alias, ticker changed
 ['Orion Mining Corp', 'ORN', '', '', '', '', ''],              // out with an analyst (in flight)
 ['Brand New Co', 'BNC', '', '', '', '', ''],                   // genuinely new
 ['Fresh Exclude Ltd', 'FEX2', '', '', '', '', '']              // on FR Exclude under FEX
].forEach(function (r) { cp.appendRow(r); });

ss.getSheetByName('Adds').appendRow([false, false, 'Ethan Guys', '*', 'Acme Blockchain Inc',
  'Acme Blockchain Inc', 'ACME', ACTION_STATUS_DEFAULT, '1A', 'Yes', 'Mining', '', '', '', '', '', '']);
ss.getSheetByName('Watchlist').appendRow(['Zeta Digital Ltd', 'ZETA', 'Add', new Date(),
  'Luciana Villarreal Romero', '', '1B', 'AS Pull', 'Pending Kintone Add', false, '', '', '']);
ss.getSheetByName('In DB Reference').appendRow(['Nova Chain PLC', 'NOVA.L', 'In DB', new Date(),
  'Isaac M', '', '', 'Review', '', false]);
ss.getSheetByName('FR Exclude').appendRow(['Fresh Exclude Ltd', 'FEX', 'FR Exclude', new Date(),
  'Isaac M', '', '', 'AS Pull', '', false]);
var eth2 = ensureInternTab_('Ethan Guys');
scaffoldInternSheets_(true);
internRow(eth2, ['Orion Mining Corp', 'ORN', '', '', 'Ethan Guys', 'Orion Mining Corp']);

runCrosscheck();
var sortRows = rowsOf('Sort', 14).map(function (r) { return String(r[1]); });
var exclRows = rowsOf('Excluded', 4);
console.log('  Sort tickers: ' + JSON.stringify(sortRows));
console.log('  Excluded: ' + JSON.stringify(exclRows.map(function (r) { return r[1] + '/' + r[3]; })));
ok(sortRows.indexOf('BNC') >= 0, 'genuinely new name reaches Sort');
ok(sortRows.indexOf('ACME') < 0, 'company staged on Adds is held off Sort');
ok(sortRows.indexOf('ZETA.NEW') < 0, 'reviewed Watchlist company with a changed ticker stays off Sort');
ok(sortRows.indexOf('NOVA.DE') < 0, 'In DB alias with a changed ticker stays off Sort');
ok(sortRows.indexOf('ORN') < 0, 'company in flight with an analyst stays off Sort');
ok(sortRows.indexOf('FEX2') < 0, 'FR-excluded company with a changed ticker stays off Sort');

/* =============== TEST 5 - crosscheck carries the Sort queue forward ================= */
console.log('\nTEST 5: re-running crosscheck keeps queue + Select ticks and does not duplicate');
var sortSh = ss.getSheetByName('Sort');
var bncRow = -1;
rowsOf('Sort', 14).forEach(function (r, i) { if (String(r[1]) === 'BNC') bncRow = i + 2; });
sortSh.getRange(bncRow, 3).setValue(true);          // operator ticks Select
sortSh.getRange(bncRow, 5).setValue('Ethan Guys');  // and sets Assign To
runCrosscheck();
var after = rowsOf('Sort', 14);
var bnc = after.filter(function (r) { return String(r[1]) === 'BNC'; });
ok(bnc.length === 1, 'BNC appears exactly once after a second crosscheck');
ok(bnc[0][2] === true, 'the Select tick survived the re-run');
ok(String(bnc[0][4]) === 'Ethan Guys', 'the Assign To choice survived the re-run');

/* ================= TEST 6 - stale re-review keeps the reference row ================= */
console.log('\nTEST 6: stale ticker resurfaces for re-review WITHOUT losing its reference row');
setup();
ss.getSheetByName('Confirmed Exclude').appendRow(['Old Timer Inc', 'OLD', 'Confirmed Exclude',
  new Date(2020, 0, 1), 'Isaac M', '', '3', 'AS Pull', 'old call', false]);
ss.getSheetByName('Clean Pull').appendRow(['Old Timer Inc', 'OLD', '', '', '', '', '']);
runCrosscheck();
ok(rowsOf('Sort', 14).filter(function (r) { return String(r[1]) === 'OLD'; }).length === 1,
  'the stale ticker is back on Sort for re-review');
ok(rowsOf('Confirmed Exclude', 10).length === 1,
  'the Confirmed Exclude row is still there (history not destroyed)');
runCrosscheck();
ok(rowsOf('Sort', 14).filter(function (r) { return String(r[1]) === 'OLD'; }).length === 1,
  'a second crosscheck does not duplicate the re-review row');

/* ================== TEST 7 - fresh review is not resurfaced early ================== */
console.log('\nTEST 7: a recently reviewed ticker is NOT resurfaced (365d threshold)');
setup();
var recent = new Date(); recent.setDate(recent.getDate() - 30);
ss.getSheetByName('Confirmed Exclude').appendRow(['Recent Co', 'RCT', 'Confirmed Exclude',
  recent, 'Isaac M', '', '3', 'AS Pull', '', false]);
ss.getSheetByName('Clean Pull').appendRow(['Recent Co', 'RCT', '', '', '', '', '']);
runCrosscheck();
ok(rowsOf('Sort', 14).length === 0, 'a 30-day-old review stays excluded');
ok(rowsOf('Excluded', 4).length === 1, 'and is reported on Excluded');

/* =============== TEST 8 - step order: pre-flight routes before crosscheck ========== */
console.log('\nTEST 8: crosscheck pre-flight routes reviewed-but-unrouted intern rows first');
setup();
var eth3 = ensureInternTab_('Ethan Guys');
scaffoldInternSheets_(true);
internRow(eth3, ['Pending Add Co', 'PAC', 'Add', '', 'Ethan Guys', 'Pending Add Co',
  'd', 'i', 't', '1A', 'Mining', 'Yes', '', '', 'AS Pull', '']);
ss.getSheetByName('Clean Pull').appendRow(['Pending Add Co', 'PAC', '', '', '', '', '']);
ok(unroutedReviewedRows_().length === 1, 'the reviewed row is detected as unrouted');
runCrosscheck();
ok(rowsOf('Adds', 17).length === 1, 'pre-flight routed it to Adds before the crosscheck ran');
ok(rowsOf('Sort', 14).length === 0, 'so the pull row did not come back onto Sort');

/* ============== TEST 9 - unroutable reviewed row warns and is reported ============= */
console.log('\nTEST 9: an Add with no tier cannot route -> operator is warned');
setup();
var eth4 = ensureInternTab_('Ethan Guys');
scaffoldInternSheets_(true);
internRow(eth4, ['No Tier Co', 'NTC', 'Add', '', 'Ethan Guys', 'No Tier Co', 'd', 'i', 't',
  '' /* no tier */, 'Mining', 'Yes', '', '', 'AS Pull', '']);
mock.uiLog.length = 0;
mock.setUiAnswer('YES');
var proceed = preflightRouteReviews_('Run Crosscheck');
ok(proceed === true, 'operator can choose to continue');
ok(mock.uiLog.length === 1 && mock.uiLog[0].indexOf('NTC') >= 0, 'the warning names the blocked row');
mock.setUiAnswer('NO');
ok(preflightRouteReviews_('Run Crosscheck') === false, 'choosing No blocks the step');
mock.setUiAnswer('YES');

/* =============== TEST 10 - dashboard step renumber migration ====================== */
console.log('\nTEST 10: dashboard rebuilds itself after the step renumber');
setup();
var dash = ss.getSheetByName('Dashboard');
dash.getRange(2, 1).setValue('1. Refresh DB References');   // simulate the old layout
dash.getRange(2, 4).setValue('OLD');
ok(!dashboardStepsCurrent_(dash), 'stale step labels are detected');
ensureDashboardTab_(false);
ok(dashboardStepRow_(ss.getSheetByName('Dashboard'), PIPELINE_STEPS[0]) > 0,
  'the dashboard now carries the new step 1 row');
ok(configValue_('re-review tickers older', 0) === 365, 'Settings values survived the rebuild');

H.finish();
