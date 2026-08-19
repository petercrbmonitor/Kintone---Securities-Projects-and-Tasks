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
dedupeReferenceLists();
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
dedupeReferenceLists();
ok(rows('FR Exclude', 10).length === 1, 'still one row');
ok(mock.ss.toasts.join(' ').indexOf('No duplicate rows found') >= 0, 'and it says so');

console.log('\nTEST 3: cancelling changes nothing');
H.setup();
fr('Blackstone Inc', 'BX', 'FR Exclude', new Date(2026, 1, 1), 'Isaac M');
fr('BLACKSTONE INC', 'BX', 'FR Exclude', '', '', '', '', '', 'second copy');
mock.setUiAnswer('NO');
dedupeReferenceLists();
ok(rows('FR Exclude', 10).length === 2, 'both rows are still there after answering No');
mock.setUiAnswer('YES');

console.log('\nTEST 4: separator styles and name-only duplicates are caught');
H.setup();
fr('Fujitsu Ltd', '6702:JP', 'FR Exclude', new Date(2026, 0, 5), 'Isaac M');
fr('Fujitsu Ltd', '6702.JP', 'FR Exclude', '', '', '', '', '', 'other format');
fr('Nameless Holdings Ltd', '', 'FR Exclude', new Date(2026, 0, 6), 'Isaac M');
fr('Nameless Holdings', '', 'FR Exclude', '', '', '', '', '', 'no ticker copy');
fr('Genuinely Different Corp', 'GDC', 'FR Exclude', new Date(2026, 0, 7), 'Isaac M');
dedupeReferenceLists();
var r4 = rows('FR Exclude', 10);
ok(r4.length === 3, '6702:JP/6702.JP merge, the two ticker-less name matches merge, the third stays');
ok(r4.some(function (x) { return String(x[1]) === 'GDC'; }), 'the unrelated company is untouched');

console.log('\nTEST 5: non-duplicates are never touched, and order is preserved');
H.setup();
['AAA', 'BBB', 'CCC'].forEach(function (t, i) { fr('Company ' + t, t, 'FR Exclude', new Date(2026, 0, i + 1)); });
fr('Company BBB dup', 'BBB', 'FR Exclude', '', '', '', '', '', 'dup');
dedupeReferenceLists();
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
dedupeReferenceLists();
ok(rows('Watchlist', 13).length === 1, 'Watchlist deduped');
ok(String(rows('Watchlist', 13)[0][6]) === '2', 'and the tier from its duplicate was grafted');
ok(rows('In DB Reference', 10).length === 1, 'In DB Reference deduped');
ok(rows('FR Exclude', 10).length === 1, 'FR Exclude deduped');
var hist = H.historyText();
ok(hist.indexOf('Dedupe Reference Lists') >= 0 || hist.indexOf('3 duplicate row(s)') >= 0,
  'the run is recorded in the History Log');
ok(hist.indexOf('DUP') >= 0 && hist.indexOf('IDB') >= 0, 'and the removed rows are named');

console.log('\nTEST 7: the Health Check stops reporting them afterwards');
runHealthCheck();
var dupWarns = rows('Health Check', 7).filter(function (x) { return String(x[1]) === 'Duplicate row'; });
ok(dupWarns.length === 0, 'no Duplicate row findings remain');

H.finish();
