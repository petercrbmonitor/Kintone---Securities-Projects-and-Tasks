/**
 * Unit tests for the pure helpers (CODE_AUDIT.md finding 6). These are the functions every
 * matching and dedup decision in the pipeline rests on, so a silent change here shows up as
 * "reviewed companies came back" three steps later.
 */
'use strict';
var H = require('./harness.js');
var ok = H.ok, ss = H.ss;

console.log('normName_ - punctuation, case and trailing legal suffixes');
ok(normName_('Acme Holdings Inc.') === 'acme', 'strips stacked legal suffixes');
ok(normName_('  ACME   Blockchain,  Ltd ') === 'acme blockchain', 'collapses spacing and case');
ok(normName_('Inc') === 'inc', 'never strips the only word');
ok(normName_('') === '' && normName_(null) === '', 'blank and null are empty');
ok(normName_('Zeta-Digital (UK) PLC') === 'zeta digital uk', 'punctuation becomes spacing');

console.log('\nnormTicker_ - canonical comparison form (audit finding 5)');
ok(normTicker_('9923:HK') === normTicker_('9923.HK'), 'colon and dot are the same ticker');
ok(normTicker_('9923 HK') === normTicker_('9923.HK'), 'space and dot are the same ticker');
ok(normTicker_('brk/b') === 'BRK.B', 'slash folds to a dot and case is raised');
ok(normTicker_(' abc ') === 'ABC', 'trims');
ok(normTicker_('ABC..DE') === 'ABC.DE', 'collapses repeated separators');
ok(normTicker_('.ABC.') === 'ABC', 'never leads or trails with a separator');
ok(normTicker_('') === '' && normTicker_(undefined) === '', 'blank and undefined are empty');

console.log('\ntickerRoot_ - exchange suffix stripped');
ok(tickerRoot_('ABC.L') === 'ABC', 'dot suffix');
ok(tickerRoot_('9923:HK') === '9923', 'colon suffix now roots too');
ok(tickerRoot_('ABC') === 'ABC', 'no suffix is unchanged');

console.log('\nfuzzyPair_ - conservative near-match');
ok(fuzzyPair_('acme blockchain', 'acme block') === true, 'shared first five characters');
ok(fuzzyPair_('acme', 'acme blockchain holdings') === true, 'containment');
ok(fuzzyPair_('zulu mining', 'alpha energy') === false, 'unrelated names do not pair');
ok(fuzzyPair_('', 'acme') === false, 'blank never pairs');

console.log('\nisStale_ - re-review threshold');
var daysAgo = function (n) { return new Date(Date.now() - n * 86400000); };
ok(isStale_(daysAgo(400), 365, false) === true, '400 days old is stale at a 365-day threshold');
ok(isStale_(daysAgo(30), 365, false) === false, '30 days old is not');
ok(isStale_('', 365, false) === false, 'a blank date obeys the Resurface setting (No)');
ok(isStale_('', 365, true) === true, 'and resurfaces when it is Yes');
ok(isStale_('2019-01-01', 365, false) === true, 'a date written as text is still compared');
ok(isStale_('not a date', 365, false) === false, 'unparseable text falls back to the setting');

console.log('\nisDateish_');
ok(isDateish_(new Date()) === true, 'a Date');
ok(isDateish_('2026-06-09') === true, 'an ISO string');
ok(isDateish_('Pending Kintone Add') === false, 'ordinary text is not');

console.log('\nwithPrefix_ - label seeding is idempotent');
ok(withPrefix_('', 'INCLUSION RATIONALE:') === 'INCLUSION RATIONALE:', 'blank becomes the label');
ok(withPrefix_('INCLUSION RATIONALE: text', 'INCLUSION RATIONALE:') === 'INCLUSION RATIONALE: text',
  'an already-labelled value is left alone');
ok(withPrefix_('text', 'NOTE:') === 'NOTE: text', 'otherwise the label is prepended');

console.log('\nparseSourceDocs_ / parseWebsites_ - analyst capture formats');
var sd = parseSourceDocs_('PR - Launch | Added PR | https://x.com/pr | 2026-06-09\nOther | | https://y.com |');
ok(sd.length === 2 && sd[0].name === 'PR - Launch' && sd[0].date === '2026-06-09', 'four fields per line');
ok(sd[1].note === '' && sd[1].date === '', 'missing trailing fields are blank, not undefined');
ok(parseSourceDocs_('').length === 0, 'an empty cell yields no rows');
var w = parseWebsites_('Website | https://a.com\nhttps://b.com');
ok(w.length === 2 && w[0].type === 'Website' && w[0].url === 'https://a.com', 'typed line');
ok(w[1].type === 'Website' && w[1].url === 'https://b.com', 'a bare URL defaults to Website');

console.log('\ncsvCell_ - RFC-4180 quoting');
ok(csvCell_('plain') === 'plain', 'plain text is unquoted');
ok(csvCell_('a,b') === '"a,b"', 'commas force quoting');
ok(csvCell_('say "hi"') === '"say ""hi"""', 'inner quotes are doubled');
ok(csvCell_(null) === '' && csvCell_(undefined) === '', 'null and undefined are empty');
ok(/^\d{4}-\d{2}-\d{2}$/.test(csvCell_(new Date(2026, 5, 9))), 'dates export as yyyy-MM-dd');

console.log('\ncolLetter_ - health-check column references');
ok(colLetter_(1) === 'A' && colLetter_(9) === 'I' && colLetter_(26) === 'Z', 'single letters');
ok(colLetter_(27) === 'AA', 'wraps past Z');

console.log('\naddBusinessDays_ - due dates skip weekends');
var mon = new Date(2026, 0, 5);
while (mon.getDay() !== 1) mon.setDate(mon.getDate() + 1);
var due = addBusinessDays_(mon, 5);
ok(due.getDay() === 1 && (due - mon) / 86400000 === 7, '5 business days from Monday is next Monday');

console.log('\nmigrateInternRow_ - legacy analyst layouts');
var cur = []; for (var i = 0; i < 18; i++) cur.push('c' + i);
cur[17] = new Date(2026, 0, 2);
ok(migrateInternRow_(cur)[8] === 'c8', 'a current 18-column row is returned untouched');
var old17 = []; for (var j = 0; j < 17; j++) old17.push('o' + j);
old17[16] = new Date(2026, 0, 2);
var mig = migrateInternRow_(old17);
ok(mig.length === 18 && mig[8] === '' && mig[9] === 'o8',
  '17-column rows gain the blank Tiering Rationale at index 8 and shift right');

console.log('\nfindExistingRow_ - ticker first, name only when there is no ticker');
H.setup();
var wl = ss.getSheetByName('Watchlist');
wl.appendRow(['Acme Blockchain Inc', 'ACME', '', '', '', '', '', '', '', false, '', '', '']);
wl.appendRow(['Nameless Co', '', '', '', '', '', '', '', '', false, '', '', '']);
ok(findExistingRow_(wl, 1, 2, normTicker_('acme'), normName_('Totally Other')) === 2,
  'matches on ticker regardless of the name');
ok(findExistingRow_(wl, 1, 2, normTicker_('9999'), normName_('Acme Blockchain Inc')) === -1,
  'a different ticker is not a match even when the name is identical');
ok(findExistingRow_(wl, 1, 2, '', normName_('Nameless Co.')) === 3,
  'falls back to the name when the row has no ticker');

H.finish();
