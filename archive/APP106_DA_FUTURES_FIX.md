# App 106 - missing "DA - Futures" securities + "Pull failed" error

Investigation notes for the two profiles Mel Dapanas flagged as not captured by
App 106 (ETP Holdings Update): securities `DA3RCXIQ465BLZE` and
`DA3RCXLYLRICH78`, both under sector **DA - Futures**.

## Root cause 1 - sector allowlist omits "DA - Futures"

App 106 queues master-app profiles with an **include-only allowlist** on the
Sector field (`Drop_down_3`), plus `Profile Status = "Active"`
(`ETP_Holdings_Update_2.js`, `ALLOWLIST_SECTORS` / `sectorQuery()`).

The allowlist contained the 9 ETF/ETN/CEF sector labels and the two
options-strategy labels - **no Futures entry at all**. `DA - Futures` is a
valid Tier-1A sector in the master taxonomy (see
`Macro - DARB Identification/Code.gs`: `SECTOR_OPTIONS`, `SECTOR_TO_TIER['1A']`,
`FUTURES_SECTORS`), so every Active `DA - Futures` profile was silently
excluded from the queue. This is not a whitespace/casing mismatch - the string
match is exact (`in ("...")`) and the allowlist is intersected with the master
app's real dropdown options before querying; the label was simply never listed.

**Fix:** added `'DA - Futures'` to `ALLOWLIST_SECTORS`.

Other exclusions that remain by design (confirm with the team):

- `Fund of Funds` - a Tier-1B fund sector, also NOT allowlisted today.
- All company sectors (Mining, Exchanges/Platforms, etc.) - intentionally out.
- Non-`Active` profiles (any sector) - excluded by `APP23_ACTIVE_ONLY`.

## Root cause 2 - "Pull failed: Cannot read properties of undefined (reading 'value')"

Three `fetchAll` calls passed a `fields` list without `$id`. Kintone omits
`$id` from the response whenever `fields` is specified, so downstream
`record.$id.value` reads threw `TypeError` and aborted the pull:

1. `doPull()` existing-records fetch -> crash in `dequeueRecords()` whenever the
   self-cleaning sweep had records to drop (this is the alert in the
   screenshot; it also blocked the ADD half of the same pull).
2. `fetchMasterStatuses()` -> same crash path while refreshing dropped records'
   profile status.
3. `queueDueReviews()` due-records fetch -> same bug behind the
   "Queue due reviews failed" alert.

**Fix:** `'$id'` added to all three `fields` lists.

## Counting the additional records captured after the fix

The count has to run against the live tenant. Paste this in the browser console
on any page of `csl61zqur0t5.kintone.com` (adjust `MASTER` to 86 for test):

```js
(function () {
  var MASTER = 23, THIS_APP = 106;
  function all(app, query, fields, out, offset) {
    out = out || []; offset = offset || 0;
    var q = query + ' order by $id asc limit 500 offset ' + offset;
    return kintone.api('/k/v1/records', 'GET', { app: app, query: q, fields: fields })
      .then(function (r) {
        out = out.concat(r.records);
        return r.records.length === 500 ? all(app, query, fields, out, offset + 500) : out;
      });
  }
  Promise.all([
    all(MASTER, 'Drop_down_3 in ("DA - Futures") and Drop_down_22 in ("Active")', ['$id']),
    all(THIS_APP, '', ['app23_record_id'])
  ]).then(function (res) {
    var tracked = {};
    res[1].forEach(function (r) { tracked[r.app23_record_id.value] = true; });
    var missing = res[0].filter(function (r) { return !tracked[r.$id.value]; });
    console.log('Active "DA - Futures" profiles in App ' + MASTER + ':', res[0].length);
    console.log('Not yet in App 106 (captured after fix):', missing.length,
      missing.map(function (r) { return r.$id.value; }));
  });
})();
```

After deploying the updated JS, a single **Refresh Queue** (or the auto-sync on
opening the overview) pulls the newly qualifying profiles in.
