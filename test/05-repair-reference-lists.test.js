/**
 * Merging duplicate rows on the reference lists. The risk here is data loss, so most of these
 * assert what must SURVIVE a merge, not just what disappears.
 */
'use strict';
var H = require('./harness.js');
var mock = H.mock, ss = H.ss, ok = H.ok, rows = H.rows;

function fr(company, ticker, assignment, date, analyst, psNote, tier, source, note) {
  ss.getSheetByName('FR Exclude').appendRow([company, ticker, assignment || 'FR Exclude',
    date || '', analyst || '', psNote || '', tier || '', source || '', note || '', false]);
}

console.log('TEST 1: the reviewed copy wins and the other copy\'s data is grafted on');
H.setup();
// the older copy carries the analyst note; the newer copy carries the review date
fr('BNP Paribas SA', 'BNP.FR', 'FR Exclude', '', '', 'legacy note', '3', 'Legacy Watchlist', '');
fr('BNP Paribas', 'BNP.FR', 'FR Exclude', new Date(2026, 5, 1), 'Isaac M', '', '', '', 'reviewed 2026');
mock.setUiAnswer('YES');
repairReferenceLists();
var r = rows('FR Exclude', 10);
ok(r.length === 1, 'the two rows become one');
ok(H.mock.ss.getSheetByName('FR Exclude').getRange(2, 4).getValue() instanceof Date,
  'the reviewed date survives');
ok(String(r[0][4]) === 'Isaac M', 'the analyst survives');
ok(String(r[0][5]) === 'legacy note', 'the note from the OTHER row is grafted onto the keeper');
ok(String(r[0][6]) === '3', 'the tier from the other row is grafted too');
ok(String(r[0][0]) === 'BNP Paribas', 'the keeper row supplies the company name');

console.log('\nTEST 2: re-running finds nothing (idempotent)');
mock.ss.toasts.length = 0;
repairReferenceLists();
ok(rows('FR Exclude', 10).length === 1, 'still one row');
ok(mock.ss.toasts.join(' ').indexOf('nothing to repair') >= 0, 'and it says so');

console.log('\nTEST 3: cancelling changes nothing');
H.setup();
fr('Blackstone Inc', 'BX', 'FR Exclude', new Date(2026, 1, 1), 'Isaac M');
fr('BLACKSTONE INC', 'BX', 'FR Exclude', '', '', '', '', '', 'second copy');
mock.setUiAnswer('NO');
repairReferenceLists();
ok(rows('FR Exclude', 10).length === 2, 'both rows are still there after answering No');
mock.setUiAnswer('YES');

console.log('\nTEST 4: separator styles and name-only duplicates are caught');
H.setup();
fr('Fujitsu Ltd', '6702:JP', 'FR Exclude', new Date(2026, 0, 5), 'Isaac M');
fr('Fujitsu Ltd', '6702.JP', 'FR Exclude', '', '', '', '', '', 'other format');
fr('Nameless Holdings Ltd', '', 'FR Exclude', new Date(2026, 0, 6), 'Isaac M');
fr('Nameless Holdings', '', 'FR Exclude', '', '', '', '', '', 'no ticker copy');
fr('Genuinely Different Corp', 'GDC', 'FR Exclude', new Date(2026, 0, 7), 'Isaac M');
repairReferenceLists();
var r4 = rows('FR Exclude', 10);
ok(r4.length === 3, '6702:JP/6702.JP merge, the two ticker-less name matches merge, the third stays');
ok(r4.some(function (x) { return String(x[1]) === 'GDC'; }), 'the unrelated company is untouched');

console.log('\nTEST 5: non-duplicates are never touched, and order is preserved');
H.setup();
['AAA', 'BBB', 'CCC'].forEach(function (t, i) { fr('Company ' + t, t, 'FR Exclude', new Date(2026, 0, i + 1)); });
fr('Company BBB dup', 'BBB', 'FR Exclude', '', '', '', '', '', 'dup');
repairReferenceLists();
var r5 = rows('FR Exclude', 10).map(function (x) { return String(x[1]); });
ok(r5.join(',') === 'AAA,BBB,CCC', 'three rows remain, in their original order');

console.log('\nTEST 6: every list is covered, and the removals are logged');
H.setup();
var wl = ss.getSheetByName('Watchlist');
wl.appendRow(['Dup Co', 'DUP', 'Watchlist', new Date(2026, 2, 2), 'Isaac M', '', '', '', '', false, '', '', '']);
wl.appendRow(['Dup Co Ltd', 'DUP', 'Watchlist', '', '', '', '2', '', '', false, '', '', '']);
ss.getSheetByName('In DB Reference').appendRow(['Idb Co', 'IDB', 'In DB', new Date(2026, 2, 3), 'Isaac M', '', '', '', '', false]);
ss.getSheetByName('In DB Reference').appendRow(['Idb Co', 'IDB', 'In DB', '', '', '', '', '', '', false]);
fr('Fr Co', 'FRC', 'FR Exclude', new Date(2026, 2, 4), 'Isaac M');
fr('Fr Co', 'FRC', 'FR Exclude', '');
repairReferenceLists();
ok(rows('Watchlist', 13).length === 1, 'Watchlist deduped');
ok(String(rows('Watchlist', 13)[0][6]) === '2', 'and the tier from its duplicate was grafted');
ok(rows('In DB Reference', 10).length === 1, 'In DB Reference deduped');
ok(rows('FR Exclude', 10).length === 1, 'FR Exclude deduped');
var hist = H.historyText();
ok(hist.indexOf('item(s) repaired') >= 0,
  'the run is recorded in the History Log');
ok(hist.indexOf('DUP') >= 0 && hist.indexOf('IDB') >= 0, 'and the removed rows are named');

console.log('\nTEST 7: the Health Check stops reporting them afterwards');
runHealthCheck();
var dupWarns = rows('Health Check', 7).filter(function (x) { return String(x[1]) === 'Duplicate row'; });
ok(dupWarns.length === 0, 'no Duplicate row findings remain');


/* ==================== FILED ON TWO LISTS ==================== */
console.log('\nTEST 8: the most recent decision wins when a company is on two lists');
H.setup();
ss.getSheetByName('Watchlist').appendRow(['Split Co', 'SPL', 'Watchlist', new Date(2025, 0, 1),
  'Isaac M', 'old ps note', '', 'AS Pull', '', false, '', 'Mining', '']);
ss.getSheetByName('Confirmed Exclude').appendRow(['Split Co', 'SPL', 'Confirmed Exclude',
  new Date(2026, 5, 1), 'Ethan Guys', '', '3', 'AS Pull', 'not a DARB', false]);
mock.setUiAnswer('YES');
repairReferenceLists();
ok(rows('Watchlist', 13).length === 0, 'the older Watchlist filing is removed');
var ce = rows('Confirmed Exclude', 10);
ok(ce.length === 1, 'the newer Confirmed Exclude filing survives');
ok(String(ce[0][5]) === 'old ps note', 'and the note that only existed on the removed row is kept');
ok(H.historyText().indexOf('kept on Confirmed Exclude') >= 0, 'the move is explained in the log');

console.log('\nTEST 9: routing a reviewed row files it on ONE list, not several');
H.setup();
// company already sitting on the Watchlist from a previous cycle
ss.getSheetByName('Watchlist').appendRow(['Moved On Ltd', 'MVD', 'Watchlist', new Date(2025, 0, 1),
  'Isaac M', '', '', 'AS Pull', '', false, '', '', '']);
var eth = ensureInternTab_('Ethan Guys'); scaffoldInternSheets_(true);
H.internRow(eth, ['Moved On Ltd', 'MVD', 'Confirmed Exclude', '', 'Ethan Guys', 'Moved On Ltd']);
processReviews();
ok(rows('Confirmed Exclude', 10).length === 1, 'the new decision is filed');
ok(rows('Watchlist', 13).length === 0, 'and the old Watchlist filing is cleared automatically');
ok(H.historyText().indexOf('MOVED OFF Watchlist') >= 0, 'the removal is named in the routing log');

console.log('\nTEST 10: an Add keeps its Watchlist hold row but clears other lists');
H.setup();
ss.getSheetByName('FR Exclude').appendRow(['Upgrade Co', 'UPG', 'FR Exclude', new Date(2025, 0, 1),
  'Isaac M', '', '', 'AS Pull', '', false]);
var eth2 = ensureInternTab_('Ethan Guys'); scaffoldInternSheets_(true);
H.internRow(eth2, ['Upgrade Co', 'UPG', 'Add', '', 'Ethan Guys', 'Upgrade Co', 'd', 'i', 't',
  '1A', 'Mining', 'Yes', '', '', 'AS Pull', '']);
processReviews();
ok(rows('Adds', 17).length === 1, 'staged on Adds');
ok(rows('Watchlist', 13).length === 1, 'the Pending Kintone Add hold row is kept');
ok(rows('FR Exclude', 10).length === 0, 'the superseded FR Exclude filing is cleared');

/* ==================== ORPHANED PENDING ADDS ==================== */
console.log('\nTEST 11: an orphaned hold row with a tier is re-staged on Adds');
H.setup();
ss.getSheetByName('Watchlist').appendRow(['Orphan Ltd', 'ORP', 'Add', new Date(2026, 4, 1),
  'Ethan Guys', 'why it qualifies', '1A', 'AS Pull', 'Pending Kintone Add', false, '', 'Mining', '']);
repairReferenceLists();
var a11 = rows('Adds', 17);
ok(a11.length === 1 && String(a11[0][6]) === 'ORP', 're-staged on Adds');
ok(String(a11[0][8]) === '1A' && String(a11[0][10]) === 'Mining', 'tier and sector carried over');
ok(String(a11[0][2]) === 'Ethan Guys', 'and the analyst');
ok(rows('Watchlist', 13).length === 1, 'the hold row stays until the profile is imported');

console.log('\nTEST 12: an orphaned hold row with no tier has its Add marking cleared');
H.setup();
ss.getSheetByName('Watchlist').appendRow(['No Tier Orphan', 'NTO', 'Add', new Date(2026, 4, 1),
  'Ethan Guys', '', '', 'AS Pull', 'Pending Kintone Add', false, '', '', '']);
repairReferenceLists();
ok(rows('Adds', 17).length === 0, 'nothing is staged without a tier');
var w12 = rows('Watchlist', 13);
ok(String(w12[0][2]) === 'Watchlist', 'it becomes an ordinary Watchlist row');
ok(String(w12[0][8]).indexOf('Pending Kintone Add') < 0, 'and the pending marking is gone');

console.log('\nTEST 13: a healthy hold row (staged on Adds) is left alone');
H.setup();
H.addsRow('Healthy Co', 'HLT', false);
ss.getSheetByName('Watchlist').appendRow(['Healthy Co', 'HLT', 'Add', new Date(), 'Ethan Guys',
  '', '1A', 'AS Pull', 'Pending Kintone Add', false, '', '', '']);
mock.ss.toasts.length = 0;
repairReferenceLists();
ok(rows('Adds', 17).length === 1 && rows('Watchlist', 13).length === 1, 'both rows untouched');
ok(mock.ss.toasts.join(' ').indexOf('nothing to repair') >= 0, 'and it reports nothing to repair');

console.log('\nTEST 14: the Health Check is clean after a repair');
H.setup();
ss.getSheetByName('FR Exclude').appendRow(['Dup A', 'DPA', 'FR Exclude', new Date(2026, 1, 1), 'Isaac M', '', '', '', '', false]);
ss.getSheetByName('FR Exclude').appendRow(['Dup A', 'DPA', 'FR Exclude', '', '', '', '', '', '', false]);
ss.getSheetByName('Watchlist').appendRow(['Dup A', 'DPA', 'Watchlist', new Date(2025, 1, 1), 'Isaac M', '', '', '', '', false, '', '', '']);
ss.getSheetByName('Watchlist').appendRow(['Lost Add', 'LST', 'Add', new Date(2026, 4, 1), 'Ethan Guys', '', '1A', '', 'Pending Kintone Add', false, '', '', '']);
repairReferenceLists();
runHealthCheck();
var left = rows('Health Check', 7).filter(function (x) {
  return ['Duplicate row', 'On two lists', 'Hold row without staging row'].indexOf(String(x[1])) >= 0;
});
ok(left.length === 0, 'none of the three findings remain');

H.finish();
