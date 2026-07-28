/*
 * ETP Holdings Update - Kintone customization
 * App 106 (csl61zqur0t5.kintone.com)
 *
 * Implements the workflow the native config cannot do:
 *   - Add to Queue / Refresh Queue (sector-allowlisted pull from App 23)
 *   - Fetch Record / Fetch Next Record (auto-assignment + 24h same-issuer rule)
 *   - Screen buttons and navigation (Overview / edit / view-only / Updated Records)
 *   - Save  -> push Holdings back into App 23, release lock
 *   - Cancel -> discard, release lock
 *
 * Does NOT modify App 23. The master app (App 86 in test, App 23 live)
 * is only read on pull and written back on Save. The cryptoasset reference
 * (App 85 in test, App 34 live) is read-only - used for BCBS auto-fill and for
 * Paste allocation ticker matching.
 *
 * Two analyst conveniences on the edit screen:
 *   - BCBS auto-fill: setting an Underlying Cryptoasset fills BCBS Group from the
 *     reference app (non-blocking; name mismatches never block the edit).
 *   - Paste allocation: paste a name/ticker/weight block; rows are matched against
 *     the reference app and added to the Holdings table for review before Save.
 *
 * Environment is controlled by APP_MASTER / APP_REF in CONFIG below.
 */
(function () {
  'use strict';

  /* ===================== CONFIG (edit here, no rebuild) ===================== */

  var THIS_APP = 106;

  // ---- ENVIRONMENT SWITCH ----
  // TEST: master = App 86 (copy of 23), reference = App 85 (copy of 34).
  // To go LIVE, set APP_MASTER = 23 and APP_REF = 34.
  var APP_MASTER = 86;            // ETP profiles to pull from / push to
  var APP_REF = 85;              // cryptoasset reference (for BCBS auto-fill)
  var APP23 = APP_MASTER;        // alias kept for the rest of the code

  // Sector allowlist - only master-app profiles in these sectors are queued.
  // Allowlist (include), never a blocklist. Add a sector here to let it in.
  // Strings must match the master app's "Sector" (Drop_down_3) labels exactly.
  // NOTE: App 86 names the options sector "DA - Options Based Strategy Exchange
  // Traded Fund (ETF)"; live App 23 uses "DA - Options Based Strategy ETP".
  // Both are listed so the allowlist works against either environment.
  var ALLOWLIST_SECTORS = [
    'DA - Exchange Traded Fund (ETF)',
    'DA & DARB - Exchange Traded Fund (ETF)',
    'DARB - Exchange Traded Fund (ETF)',
    'DA - Exchange Traded Note (ETN)',
    'DA & DARB - Exchange Traded Note (ETN)',
    'DARB - Exchange Traded Note (ETN)',
    'DA - Closed-end Fund (CEF)',
    'DA & DARB - Closed-end Fund (CEF)',
    'DARB - Closed-end Fund (CEF)',
    'DA - Options Based Strategy Exchange Traded Fund (ETF)',
    'DA - Options Based Strategy ETP',
    'DA - Futures',
    'Fund of Funds'
  ];

  // Only pull profiles with this Profile Status (Drop_down_22).
  var APP23_ACTIVE_ONLY = true;

  // ---- FUND OF FUNDS POST-FILTER ----
  // 'Fund of Funds' spans crypto FoFs and funds that just hold equities of public
  // companies. Only the crypto side belongs in this queue, and the sector query
  // cannot see holdings rows, so FoF profiles are post-filtered after the pull:
  // one qualifies when its master data shows crypto / ETF / derivative exposure -
  // any DA ETP Holdings row typed with one of the classes below, Holds Spot
  // Crypto = Yes, or the ETP Holdings Type summary naming one of the classes.
  // Equities-only FoFs stay out (and drop out on refresh if they turn equities-only).
  // A FoF with no holdings data at all has no crypto evidence and is skipped by
  // default; set FOF_INCLUDE_WHEN_EMPTY = true to queue those for classification.
  var FOF_SECTOR = 'Fund of Funds';
  var FOF_CRYPTO_CLASSES = ['Spot', 'Funds', 'Futures', 'Options', 'Permitted Swaps'];
  var FOF_INCLUDE_WHEN_EMPTY = false;

  // ---- ROUND-ROBIN ASSIGNMENT ----
  // New queued records are auto-assigned across an analyst pool, load-balanced by each
  // analyst's current open workload. Members come from the Kintone group ASSIGN_GROUP
  // (user "code" = email in this domain); FALLBACK_ANALYSTS is used only if that group
  // API call fails. Set ASSIGN_ENABLED = false to leave new records unassigned.
  var ASSIGN_ENABLED = true;
  var ASSIGN_GROUP = 'Research Admins';
  var FALLBACK_ANALYSTS = [
    { code: 'james.francis@crbmonitor.com', name: 'Jim' },
    { code: 'kyle.buckley@crbmonitor.com',  name: 'Kyle' },
    { code: 'peter@crbmonitor.com',         name: 'Peter' },
    { code: 'tamara.guy@crbmonitor.com',    name: 'Tamara' }
  ];

  // ---- AUTO-SYNC ON OPEN ----
  // App 23 cannot be modified and this JS only runs while App 106 is open, so instead of a
  // background push, App 106 quietly runs a full Refresh Queue when the overview opens
  // (adds newly-Active profiles, drops non-Active ones). Throttled to at most once per
  // AUTO_SYNC_MIN_MS across tabs (localStorage timestamp).
  var AUTO_SYNC_ON_OPEN = true;
  var AUTO_SYNC_MIN_MS = 10 * 60 * 1000;

  // ---- REVIEW CADENCE ----
  // Records are revisited on a cadence. "Queue Due Reviews" re-queues any Updated
  // record whose Next Review Due date has passed, re-pulling fresh data from the
  // master app first so the analyst always reviews current App 23 data.
  // Cadence is per-record (review_cadence dropdown); default below is used when a
  // record has no cadence set. "Hold" excludes a record from auto re-queue.
  var DEFAULT_CADENCE = 'Monthly';
  var CADENCE_MONTHS = { 'Monthly': 1, 'Quarterly': 3, 'Semi-Annual': 6, 'Annual': 12, 'Hold': null };

  // Master-app field codes used on pull/push.
  var A23 = {
    sector: 'Drop_down_3',          // Sector
    profileStatus: 'Drop_down_22',  // Profile Status
    issuer: 'Text_27',              // ETP Issuer (top-level; exists in App 23 and 86)
    etpName: 'Text',                // Primary Business Name
    securitiesTable: 'Table_1',     // Securities subtable
    secPrimarySymbol: 'Text_33',    // Primary Symbol (identifier source)
    secIsin: 'Text_36',             // ISIN (identifier fallback)
    sec_id: 'security_id',          // Security Id
    sec_type: 'Drop_down_9',        // Security Type
    sec_status: 'Drop_down_10',     // Security Status
    sec_maturity: 'Date_8',         // Maturity Date
    sec_cusip: 'Text_35',           // CUSIP
    sec_futExpiry: 'Text_47',       // Futures Expiry (text)
    sec_exchange: 'Text_57',        // Primary Exchange Name
    holdingsTable: 'Table_7',       // DA ETP Holdings subtable
    h_assetType: 'Text_30',         // ETP - Asset Breakdown (dropdown)
    h_underlying: 'Drop_down_24',   // Underlying Cryptoasset Name (lookup key)
    h_bcbs: 'Drop_down_14',         // BCBS Group
    h_pct: 'Text_28',               // Underlying Asset Breakdown (%) - text
    h_asOf: 'Date_and_time_0',      // As of Date
    // derived targets (App 23's own automations normally set these in the UI)
    bcbsRollup: 'BCBS_Lowest_Value', // ETP BCBS Group (worst-of rollup)
    updatedBy: 'HoldingsUpdateSummary', // Holdings last updated by (name)
    updatedAt: 'Date_and_time_1',    // Holding review date and time
    boxName: 'Text_4',               // Box folder name
    boxRef: 'Text_5',                // Box folder reference (id or URL) the Box plugin uses
    holdsSpot: 'Drop_down_34',       // Holds Spot Crypto (Yes/No) - FoF post-filter signal
    holdingsType: 'Text_52'          // ETP Holdings Type summary - FoF post-filter signal
  };

  // Reference app (App 85 test / App 34 live) field codes - for BCBS auto-fill.
  var A34 = {
    key: 'Text_3',           // Underlying Cryptoasset Name (unique key)
    bcbs: 'Drop_down',       // BCBS Group
    foundInEtps: 'Drop_down_18' // Found in ETPs?
  };

  // This app's field codes.
  var F = {
    a23id: 'app23_record_id',
    a23link: 'app23_link',
    boxName: 'box_folder_name',
    boxLink: 'box_link',
    issuer: 'issuer',
    etpName: 'etp_name',
    identifier: 'identifier',
    sector: 'sector',
    profileStatus: 'profile_status',
    status: 'status',
    assignedTo: 'assigned_to',
    assignedAt: 'assigned_at',
    inEdit: 'in_edit',
    lastBy: 'last_updated_by',
    lastAt: 'last_updated_at',
    order: 'order_seq',
    cadence: 'review_cadence',
    reviewDue: 'review_due',
    secTable: 'securities_table',
    s_id: 'sec_security_id',
    s_type: 'sec_type',
    s_status: 'sec_status',
    s_maturity: 'sec_maturity',
    s_cusip: 'sec_cusip',
    s_isin: 'sec_isin',
    s_futExpiry: 'sec_futures_expiry',
    s_symbol: 'sec_symbol',
    s_exchange: 'sec_exchange',
    table: 'holdings_table',
    t_rowId: 'a23_row_id',
    t_assetType: 'asset_type',
    t_underlying: 'underlying_asset',
    t_bcbs: 'bcbs_group',
    t_pct: 'breakdown_pct',
    t_asOf: 'as_of_date'
  };

  var ST = { NOT: 'Not in Queue', QUEUE: 'In Queue', ASSIGNED: 'Assigned', UPDATED: 'Updated' };

  // App 23 runs three client-side automations on its OWN form. A REST API write
  // (which is how App 106 pushes back) does NOT trigger them, so we replicate
  // them here on push so App 23 stays consistent:
  //   D1  percentage cleanup -> Text_28 stored as "NN.NN%", As of Date stamped per row
  //   D2  BCBS rollup        -> BCBS_Lowest_Value = worst BCBS group across rows
  //   D3  last updated by/at -> HoldingsUpdateSummary = saver name, Date_and_time_1 = now
  var ROLLUP_RANKING = ['1A', '1B', '2A', '2B']; // best -> worst; worst present wins
  var PCT_DECIMALS = 2;

  // Profile-level context fields mirrored from App 23.
  // a106 = field code here, a23 = App 23 field code, push = write back on Save.
  // Fields flagged derived:true are NOT pushed generically - they are recomputed
  // on push by the D1/D2/D3 logic above, and locked in edit.
  var PROFILE_FIELDS = [
    { a106: 'holds_spot_crypto',            a23: 'Drop_down_34',         push: true },  // derived by applyDerived()
    { a106: 'etp_bcbs_group',               a23: 'BCBS_Lowest_Value',    push: false, derived: true },
    { a106: 'portfolio_type',               a23: 'Drop_down_36',         push: true },  // derived by applyDerived()
    { a106: 'etp_holdings_type',            a23: 'Text_52',              push: true },  // derived by applyDerived()
    { a106: 'staking_yield',                a23: 'Text_53',              push: true },
    { a106: 'expense_ratio',                a23: 'Text_16',              push: true },
    { a106: 'aum_expense_updated',          a23: 'Date_2',               push: true },
    { a106: 'holding_review_dt',            a23: 'Date_and_time_1',      push: false, derived: true },
    { a106: 'holdings_url',                 a23: 'Link',                 push: true },
    { a106: 'reconstitution_schedule',      a23: 'Drop_down_26',         push: true },
    { a106: 'reconstitution_note',          a23: 'Text_area_7',          push: true },
    // D3: stamped on push with the saver's name (App 23's own "last updated by").
    { a106: 'holdings_last_updated_by_a23', a23: 'HoldingsUpdateSummary', push: false, derived: true }
  ];

  /* ============================= HELPERS ============================= */

  function api(path, method, params) {
    return kintone.api(kintone.api.url(path, true), method, params);
  }

  function me() { return kintone.getLoginUser(); }

  function nowIso() { return new Date().toISOString(); }

  // ---- review cadence helpers ----
  function cadenceMonths(c) {
    var m = CADENCE_MONTHS.hasOwnProperty(c) ? CADENCE_MONTHS[c] : undefined;
    if (m === null) return null;                 // Hold -> no auto re-queue
    return (m === undefined) ? CADENCE_MONTHS[DEFAULT_CADENCE] : m; // blank -> default
  }
  function ymd(d) {
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function todayYmd() { return ymd(new Date()); }
  function addMonths(d, n) {
    var x = new Date(d.getTime());
    var day = x.getDate();
    x.setMonth(x.getMonth() + n);
    if (x.getDate() < day) x.setDate(0); // clamp end-of-month overflow
    return x;
  }
  // Next due date string from a base review date (ISO or '') and a cadence.
  // Hold -> '' (never auto-due). No base -> counts from today.
  function computeDue(baseIso, cadence) {
    var months = cadenceMonths(cadence);
    if (months === null) return '';
    var base = baseIso ? new Date(baseIso) : new Date();
    if (isNaN(base.getTime())) base = new Date();
    return ymd(addMonths(base, months));
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = parseFloat(String(v).replace(/[, %]/g, ''));
    return isNaN(n) ? null : n;
  }

  // D1: App 23 stores the breakdown % as cleaned text "NN.NN%". Mirror that format
  // on push so App 23 matches what its own form would have produced.
  function formatPercent(raw) {
    var n = num(raw);
    return n === null ? '' : n.toFixed(PCT_DECIMALS) + '%';
  }

  // D2: pick the worst BCBS group present across holdings rows, per ROLLUP_RANKING.
  function computeRollup(rows) {
    var vals = (rows || [])
      .map(function (r) { return r.value[F.t_bcbs] && r.value[F.t_bcbs].value; })
      .filter(Boolean);
    if (!vals.length) return '';
    return vals.reduce(function (worst, v) {
      return ROLLUP_RANKING.indexOf(v) > ROLLUP_RANKING.indexOf(worst) ? v : worst;
    });
  }

  // Collapse duplicate holdings rows by Asset Type + Underlying Cryptoasset, keeping the
  // first occurrence (call after sorting desc by % to keep the largest). Genuinely blank
  // rows (no type and no underlying) are left untouched.
  function dedupeRows(rows) {
    var seen = {};
    return (rows || []).filter(function (row) {
      var v = row.value || {};
      var t = ((v[F.t_assetType] && v[F.t_assetType].value) || '').trim().toLowerCase();
      var u = ((v[F.t_underlying] && v[F.t_underlying].value) || '').trim().toLowerCase();
      if (!t && !u) return true;
      var key = t + '|' + u;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function quoteList(arr) {
    return arr.map(function (s) { return '"' + String(s).replace(/"/g, '\\"') + '"'; }).join(', ');
  }

  // Fetch all App 23 records matching a query (handles >500 via offset).
  function fetchAll(appId, query, fields) {
    var out = [];
    function page(offset) {
      var q = query + ' order by $id asc limit 500 offset ' + offset;
      return api('/k/v1/records', 'GET', { app: appId, query: q, fields: fields }).then(function (r) {
        out = out.concat(r.records);
        if (r.records.length === 500) return page(offset + 500);
        return out;
      });
    }
    return page(0);
  }

  function busy(on, msg) {
    var id = 'ehu-busy';
    var el = document.getElementById(id);
    if (on) {
      if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.className = 'etp-busy';
        el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;';
        document.body.appendChild(el);
      }
      el.textContent = msg || 'Working...';
    } else if (el) {
      el.parentNode.removeChild(el);
    }
  }

  function toast(msg) {
    busy(true, msg);
    setTimeout(function () { busy(false); }, 2200);
  }

  function mkBtn(label, onClick, primary) {
    var b = document.createElement('button');
    b.textContent = label;
    b.className = 'etp-btn ' + (primary ? 'etp-btn-primary' : 'etp-btn-ghost');
    b.onclick = onClick;
    return b;
  }

  function bar() {
    var d = document.createElement('div');
    d.className = 'ehu-bar etp-bar';
    return d;
  }

  function go(recordId, mode) {
    var hash = '#record=' + recordId + (mode === 'edit' ? '&mode=edit' : '');
    // If we are already on a record page (/show), changing only the hash does NOT make
    // Kintone re-fetch - it switches mode using the cached record, so the edit form keeps
    // a stale $revision and the next save fails with GAIA_UN03 ("...updated while editing").
    // Force a full reload in that case so the form loads the current revision.
    var onShow = window.location.pathname.indexOf('/k/' + THIS_APP + '/show') === 0;
    if (onShow) {
      window.location.hash = hash;
      window.location.reload();
    } else {
      window.location.href = '/k/' + THIS_APP + '/show' + hash;
    }
  }

  function gotoIndex(query) {
    var url = '/k/' + THIS_APP + '/';
    if (query) url += '?view=' + encodeURIComponent('') ; // view kept default; filtering done client-side
    window.location.href = '/k/' + THIS_APP + '/';
  }

  /* ============================= PULL / QUEUE ============================= */

  // The master app only accepts sector values that are real options on its
  // Sector field (App 86 and App 23 differ on the options-ETF label), so we
  // intersect the allowlist with the live options before querying.
  function masterSectorOptions() {
    return api('/k/v1/app/form/fields', 'GET', { app: APP_MASTER }).then(function (resp) {
      var f = resp.properties[A23.sector];
      return (f && f.options) ? Object.keys(f.options) : [];
    });
  }

  // App 106 field definitions (cached). Used to mirror master values SAFELY: a value for
  // a field that does not exist in App 106 is dropped, and a value that is not a valid
  // option for a dropdown is blanked - so a pull never fails with "Missing or invalid
  // input." on a field/option mismatch between the master app and App 106.
  var _a106Fields = null;
  function a106Fields() {
    if (_a106Fields) return Promise.resolve(_a106Fields);
    return api('/k/v1/app/form/fields', 'GET', { app: THIS_APP }).then(function (resp) {
      _a106Fields = resp.properties || {};
      return _a106Fields;
    }).catch(function () { return (_a106Fields = _a106Fields || {}); });
  }
  function optionOK(def, value) {
    if (def && def.type === 'DROP_DOWN') {
      if (value === '' || value == null) return '';
      return (def.options && def.options[value]) ? value : '';
    }
    return value;
  }
  function coerceToA106(body) {
    var props = _a106Fields;
    if (!props || !Object.keys(props).length) return body;   // not loaded -> no-op
    Object.keys(body).forEach(function (code) {
      var def = props[code];
      if (!def) { delete body[code]; return; }               // field absent in App 106
      if (def.type === 'SUBTABLE') {
        var fields = def.fields || {};
        (body[code].value || []).forEach(function (row) {
          var cells = row.value || {};
          Object.keys(cells).forEach(function (cc) {
            if (!fields[cc]) { delete cells[cc]; return; }    // cell absent in subtable
            cells[cc].value = optionOK(fields[cc], cells[cc].value);
          });
        });
      } else {
        body[code].value = optionOK(def, body[code].value);
      }
    });
    return body;
  }

  // ---- round-robin / load-balanced assignment ----
  var _pool = null;
  function assignPool() {
    if (_pool) return Promise.resolve(_pool);
    if (!ASSIGN_ENABLED) return Promise.resolve((_pool = []));
    return api('/k/v1/group/users', 'GET', { code: ASSIGN_GROUP }).then(function (resp) {
      var users = (resp.users || []).map(function (u) { return { code: u.code, name: u.name }; });
      _pool = users.length ? users : FALLBACK_ANALYSTS.slice();
      return _pool;
    }).catch(function () { _pool = FALLBACK_ANALYSTS.slice(); return _pool; });
  }
  // Current open workload (In Queue + Assigned) per assignee code, for load-balancing.
  function currentLoad() {
    return fetchAll(THIS_APP, F.status + ' in ("' + ST.QUEUE + '","' + ST.ASSIGNED + '")', [F.assignedTo])
      .then(function (recs) {
        var load = {};
        recs.forEach(function (r) {
          ((r[F.assignedTo] && r[F.assignedTo].value) || []).forEach(function (u) {
            if (u && u.code) load[u.code] = (load[u.code] || 0) + 1;
          });
        });
        return load;
      });
  }
  // Assign each new record body to the least-loaded pool member (round-robin when even).
  function balanceAssign(records, pool, load) {
    if (!pool || !pool.length) return;
    var counts = {};
    pool.forEach(function (p) { counts[p.code] = (load && load[p.code]) || 0; });
    records.forEach(function (rec) {
      var pick = pool[0];
      for (var i = 1; i < pool.length; i++) if (counts[pool[i].code] < counts[pick.code]) pick = pool[i];
      rec[F.assignedTo] = { value: [{ code: pick.code }] };
      counts[pick.code] += 1;
    });
  }

  function sectorQuery(validSectors) {
    var q = F_in(A23.sector, validSectors);
    if (APP23_ACTIVE_ONLY) q += ' and ' + F_in(A23.profileStatus, ['Active']);
    return q;
  }
  function F_in(code, vals) { return code + ' in (' + quoteList(vals) + ')'; }

  // Fund of Funds post-filter (see FOF_* config). Non-FoF sectors always pass;
  // a FoF passes only on crypto / ETF / derivative evidence in the master record.
  function fofQualifies(rec) {
    if (valOf(rec, A23.sector) !== FOF_SECTOR) return true;
    if (valOf(rec, A23.holdsSpot) === 'Yes') return true;
    var isCrypto = function (s) {
      s = String(s || '').trim().toLowerCase();
      return s && FOF_CRYPTO_CLASSES.some(function (c) { return c.toLowerCase() === s; });
    };
    var rows = (rec[A23.holdingsTable] && rec[A23.holdingsTable].value) || [];
    var sawTyped = false;
    for (var i = 0; i < rows.length; i++) {
      var t = cell(rows[i].value || {}, A23.h_assetType);
      if (String(t || '').trim()) sawTyped = true;
      if (isCrypto(t)) return true;
    }
    // Summary can carry the classes even when rows were cleared ("Equities; Spot").
    var summary = String(valOf(rec, A23.holdingsType)).split(';');
    for (var j = 0; j < summary.length; j++) if (isCrypto(summary[j])) return true;
    if (sawTyped) return false;          // typed rows, none crypto (equities-only etc.)
    return FOF_INCLUDE_WHEN_EMPTY;       // no holdings evidence at all
  }

  // silent = true suppresses the failure alert (used by the throttled auto-sync on open).
  function pullQueue(providerFilter, silent) {
    busy(true, 'Pulling qualifying profiles from App ' + APP_MASTER + '...');
    return Promise.all([masterSectorOptions(), a106Fields()]).then(function (res) {
      var opts = res[0];
      var allow = ALLOWLIST_SECTORS.filter(function (s) { return opts.indexOf(s) > -1; });
      if (!allow.length) { busy(false); if (!silent) alert('No allowlisted sectors exist on App ' + APP_MASTER + '.'); return 0; }
      return doPull(providerFilter, allow);
    }).catch(function (e) { busy(false); if (silent) { try { console.error('[ETP auto-sync]', e); } catch (x) {} } else { alert('Pull failed: ' + msgOf(e)); } });
  }

  // Throttled auto-sync: a full Refresh Queue when the overview opens, at most once per
  // AUTO_SYNC_MIN_MS across tabs - so newly-Active App 23 profiles appear (and non-Active
  // ones leave) without anyone clicking Refresh Queue.
  function maybeAutoSync() {
    if (!AUTO_SYNC_ON_OPEN) return;
    var KEY = 'ehu-last-sync';
    var last = 0;
    try { last = parseInt(localStorage.getItem(KEY) || '0', 10) || 0; } catch (e) {}
    if (Date.now() - last < AUTO_SYNC_MIN_MS) return;
    try { localStorage.setItem(KEY, String(Date.now())); } catch (e) {}
    // Reload the list if the sync actually added records, so they appear without a manual
    // refresh. The timestamp above is already set, so the reload won't re-trigger a sync.
    pullQueue('', true).then(function (added) { if (added > 0) window.location.reload(); });
  }

  function doPull(providerFilter, allow) {
    // Existing this-app records keyed by app23 id (status + lock drive the dequeue sweep).
    // $id must be requested explicitly (Kintone omits it when "fields" is set) -
    // dequeueRecords updates the dropped records by $id.
    return fetchAll(THIS_APP, '', ['$id', F.a23id, F.status, F.inEdit, F.order])
      .then(function (existing) {
        var byKey = {};
        var maxOrder = 0;
        existing.forEach(function (r) {
          byKey[r[F.a23id].value] = r;
          var o = num(r[F.order].value) || 0;
          if (o > maxOrder) maxOrder = o;
        });

        var q = sectorQuery(allow);
        if (providerFilter) q += ' and ' + A23.issuer + ' like "' + providerFilter.replace(/"/g, '') + '"';

        return fetchAll(APP23, q).then(function (src) {
          var toAdd = [];
          var seq = maxOrder;
          var qualifying = {};                 // master ids still qualifying (this pull)
          src.forEach(function (rec) {
            if (!fofQualifies(rec)) return;    // equities-only Fund of Funds stays out
            var key = rec.$id.value;
            qualifying[key] = true;
            if (byKey[key]) {
              // Already tracked: skip in-progress work; do not re-queue Updated unless re-added manually.
              return;
            }
            seq += 1;
            toAdd.push(buildNewRecord(rec, seq));
          });

          // Self-cleaning queue: a record whose master no longer qualifies (status left
          // "Active" or sector left the allowlist) drops out of the queue. Only on a FULL
          // refresh - a provider-filtered pull's qualifying set is partial and would wrongly
          // dequeue every other provider. Never touch Assigned / in-edit records.
          var toDrop = [];
          if (!providerFilter) {
            existing.forEach(function (r) {
              var st = r[F.status] && r[F.status].value;
              var locked = r[F.inEdit] && r[F.inEdit].value === 'Yes';
              var mid = r[F.a23id] && r[F.a23id].value;
              if (!locked && mid && !qualifying[mid] && (st === ST.QUEUE || st === ST.UPDATED)) {
                toDrop.push(r);
              }
            });
          }

          if (!toAdd.length && !toDrop.length) {
            busy(false);
            toast('Queue is up to date - nothing to add or remove.');
            return 0;
          }

          return dequeueRecords(toDrop).then(function () {
            if (!toAdd.length) {
              busy(false);
              toast(pullSummary(0, toDrop.length, providerFilter));
              return 0;
            }
            // Round-robin / load-balance the new records across the analyst pool, then add.
            return Promise.all([assignPool(), currentLoad()]).then(function (pl) {
              balanceAssign(toAdd, pl[0], pl[1]);
              return chunkAdd(THIS_APP, toAdd).catch(function (e) {
                // An assignee code that is not valid in this environment would reject the
                // whole add. Retry unassigned so the pull still succeeds (records land In
                // Queue, just without an owner).
                try { console.warn('[ETP] add with assignment failed, retrying unassigned:', msgOf(e)); } catch (x) {}
                toAdd.forEach(function (rec) { delete rec[F.assignedTo]; });
                return chunkAdd(THIS_APP, toAdd);
              }).then(function () {
                busy(false);
                toast(pullSummary(toAdd.length, toDrop.length, providerFilter));
                return toAdd.length;
              });
            });
          });
        });
      });
  }

  // Move records out of the queue (status -> Not in Queue), refreshing profile_status
  // from the master where it still exists so the mirror shows the current (non-Active)
  // status. Used by the Refresh Queue self-cleaning sweep.
  function dequeueRecords(records) {
    if (!records || !records.length) return Promise.resolve();
    var masterIds = records
      .map(function (r) { return r[F.a23id] && r[F.a23id].value; })
      .filter(Boolean);
    return fetchMasterStatuses(masterIds).then(function (statusByMaster) {
      var updates = records.map(function (r) {
        var mid = r[F.a23id] && r[F.a23id].value;
        var body = {};
        body[F.status] = { value: ST.NOT };
        // Master deleted -> not in the map; leave the last-known profile_status as-is.
        if (mid && statusByMaster.hasOwnProperty(mid)) {
          body[F.profileStatus] = { value: statusByMaster[mid] };
        }
        return { id: r.$id.value, record: coerceToA106(body) };
      });
      return chunkUpdate(THIS_APP, updates);
    });
  }

  // master $id -> current Profile Status (Drop_down_22). Chunked so a long id list
  // never blows the query length; masters that no longer exist just drop out of the map.
  function fetchMasterStatuses(masterIds) {
    var map = {};
    var i = 0;
    function next() {
      if (i >= masterIds.length) return Promise.resolve(map);
      var slice = masterIds.slice(i, i + 100).map(function (m) {
        return '"' + String(m).replace(/"/g, '') + '"';
      });
      i += 100;
      return fetchAll(APP_MASTER, '$id in (' + slice.join(',') + ')', ['$id', A23.profileStatus])
        .then(function (recs) {
          recs.forEach(function (m) { map[m.$id.value] = valOf(m, A23.profileStatus); });
          return next();
        });
    }
    return next();
  }

  function pullSummary(added, removed, providerFilter) {
    if (providerFilter) return 'Added ' + added + ' profile(s) for "' + providerFilter + '".';
    return 'Queue updated - added ' + added + ', removed ' + removed + '.';
  }

  // Clickable URL to the master record (App 86 test / App 23 live). location.origin keeps
  // it on whatever Kintone subdomain we run on. Stored in the LINK field app23_link; if that
  // field does not exist in App 106 yet, coerceToA106 drops it (no error) until you add it.
  function masterUrl(id) {
    return id ? (location.origin + '/k/' + APP_MASTER + '/show#record=' + encodeURIComponent(id)) : '';
  }

  // Box folder URL from App 23's Text_5 reference: use it directly if it is already a URL,
  // otherwise treat it as a Box folder id. Empty -> '' (no button shown).
  function boxUrl(ref) {
    ref = (ref == null ? '' : String(ref)).trim();
    if (!ref) return '';
    return /^https?:\/\//i.test(ref) ? ref : ('https://app.box.com/folder/' + encodeURIComponent(ref));
  }

  // Common master -> this-app field mapping (shared by initial pull and re-pull).
  function mapMasterFields(rec) {
    var r = {};
    r[F.issuer] = { value: valOf(rec, A23.issuer) };
    r[F.etpName] = { value: valOf(rec, A23.etpName) };
    r[F.identifier] = { value: identifierOf(rec) };
    r[F.sector] = { value: valOf(rec, A23.sector) };
    r[F.profileStatus] = { value: valOf(rec, A23.profileStatus) }; // read-only master mirror
    r[F.a23link] = { value: masterUrl(rec.$id && rec.$id.value) };  // click-through to master
    r[F.boxName] = { value: valOf(rec, A23.boxName) };              // Box folder name (mirror)
    r[F.boxLink] = { value: boxUrl(valOf(rec, A23.boxRef)) };       // Box folder URL (button)
    PROFILE_FIELDS.forEach(function (m) { r[m.a106] = { value: valOf(rec, m.a23) }; });
    r[F.secTable] = { value: mapSecuritiesIn(rec) };
    r[F.table] = { value: mapHoldingsIn(rec) };
    return coerceToA106(r);   // drop unknown fields / blank invalid dropdown options
  }

  function buildNewRecord(rec, seq) {
    var r = mapMasterFields(rec);
    r[F.a23id] = { value: String(rec.$id.value) };
    r[F.status] = { value: ST.QUEUE };
    r[F.inEdit] = { value: 'No' };
    r[F.order] = { value: String(seq) };
    r[F.cadence] = { value: DEFAULT_CADENCE };
    // Next due from the master's last holding review (Date_and_time_1) + cadence.
    r[F.reviewDue] = { value: computeDue(valOf(rec, A23.updatedAt), DEFAULT_CADENCE) };
    return r;
  }

  function valOf(rec, code) { return (rec[code] && rec[code].value != null) ? rec[code].value : ''; }

  function identifierOf(rec) {
    var t = rec[A23.securitiesTable];
    if (t && t.value && t.value.length) {
      for (var i = 0; i < t.value.length; i++) {
        var row = t.value[i].value;
        var sym = row[A23.secPrimarySymbol] && row[A23.secPrimarySymbol].value;
        var isin = row[A23.secIsin] && row[A23.secIsin].value;
        if (sym) return sym;
        if (isin) return isin;
      }
    }
    return '';
  }

  // App 23 Holdings rows -> this app rows, sorted desc by %.
  // Each App 23 row id is kept in a23_row_id so the push can update by id and
  // leave App 23's underlying-asset lookup untouched (App 23/App 34 names can differ).
  function mapHoldingsIn(rec) {
    var src = (rec[A23.holdingsTable] && rec[A23.holdingsTable].value) || [];
    var rows = src.map(function (row) {
      var v = row.value;
      var o = {};
      o[F.t_rowId] = { value: row.id != null ? String(row.id) : '' };
      o[F.t_assetType] = { value: cell(v, A23.h_assetType) };
      o[F.t_underlying] = { value: cell(v, A23.h_underlying) };
      o[F.t_bcbs] = { value: cell(v, A23.h_bcbs) };
      var pct = num(cell(v, A23.h_pct));
      o[F.t_pct] = { value: pct === null ? '' : String(pct) };
      o[F.t_asOf] = { value: cell(v, A23.h_asOf) || '' };
      return { value: o, _pct: pct === null ? -1 : pct };
    });
    rows.sort(function (a, b) { return b._pct - a._pct; });
    return rows.map(function (x) { return { value: x.value }; });
  }

  function cell(rowVal, code) { return (rowVal[code] && rowVal[code].value != null) ? rowVal[code].value : ''; }

  // Master Securities (Table_1) -> this app's read-only Securities subtable.
  // All rows are carried over (an ETP can list several ISIN/CUSIP/symbol/exchange).
  function mapSecuritiesIn(rec) {
    var src = (rec[A23.securitiesTable] && rec[A23.securitiesTable].value) || [];
    return src.map(function (row) {
      var v = row.value;
      var o = {};
      o[F.s_id] = { value: cell(v, A23.sec_id) };
      o[F.s_type] = { value: cell(v, A23.sec_type) };
      o[F.s_status] = { value: cell(v, A23.sec_status) };
      o[F.s_symbol] = { value: cell(v, A23.secPrimarySymbol) };
      o[F.s_exchange] = { value: cell(v, A23.sec_exchange) };
      o[F.s_cusip] = { value: cell(v, A23.sec_cusip) };
      o[F.s_isin] = { value: cell(v, A23.secIsin) };
      o[F.s_maturity] = { value: cell(v, A23.sec_maturity) || '' };
      o[F.s_futExpiry] = { value: cell(v, A23.sec_futExpiry) };
      return { value: o };
    });
  }

  function chunkAdd(appId, records) {
    var i = 0;
    function next() {
      if (i >= records.length) return Promise.resolve();
      var slice = records.slice(i, i + 100);
      i += 100;
      return api('/k/v1/records', 'POST', { app: appId, records: slice }).then(next);
    }
    return next();
  }

  function chunkUpdate(appId, records) {
    var i = 0;
    function next() {
      if (i >= records.length) return Promise.resolve();
      var slice = records.slice(i, i + 100);
      i += 100;
      return api('/k/v1/records', 'PUT', { app: appId, records: slice }).then(next);
    }
    return next();
  }

  /* ============================= REVIEW RECURRENCE ============================= */

  // Records due for re-review: Updated, not being edited, cadence not Hold, and the
  // Next Review Due date is today or earlier (records with no due date count too).
  function dueQuery() {
    return F.status + ' in ("' + ST.UPDATED + '") and ' + F.inEdit + ' in ("No") and '
      + F.cadence + ' not in ("Hold") and (' + F.reviewDue + ' <= "' + todayYmd() + '" or ' + F.reviewDue + ' = "")';
  }

  function countDue() {
    return fetchAll(THIS_APP, dueQuery(), [F.a23id]).then(function (r) { return r.length; });
  }

  // Re-queue everything that is due, RE-PULLING fresh master data first so the
  // analyst reviews current App 23 values (not last month's snapshot). The App 106
  // record is updated in place (status -> In Queue); cadence and order are kept.
  function queueDueReviews() {
    busy(true, 'Finding records due for review...');
    return fetchAll(THIS_APP, dueQuery(), ['$id', F.a23id, F.order, F.cadence]).then(function (due) {
      if (!due.length) { busy(false); toast('Nothing is due for review.'); return 0; }
      // map this-app record by master id so we can update in place
      var byMaster = {};
      var ids = [];
      due.forEach(function (d) {
        var mid = d[F.a23id].value;
        if (mid) { byMaster[mid] = d; ids.push('"' + String(mid).replace(/"/g, '') + '"'); }
      });
      busy(true, 'Re-pulling ' + ids.length + ' profile(s) from App ' + APP_MASTER + '...');
      return fetchAll(APP_MASTER, '$id in (' + ids.join(',') + ')').then(function (masters) {
        var updates = [];
        var dropped = 0;
        masters.forEach(function (m) {
          var d = byMaster[m.$id.value];
          if (!d) return;
          var body = mapMasterFields(m);     // also refreshes profile_status from the master
          body[F.inEdit] = { value: 'No' };
          // Self-cleaning: a master that is no longer Active (or a Fund of Funds
          // that no longer shows crypto exposure) drops out of the queue
          // (status -> Not in Queue) instead of being re-queued for review.
          if ((!APP23_ACTIVE_ONLY || valOf(m, A23.profileStatus) === 'Active') && fofQualifies(m)) {
            body[F.status] = { value: ST.QUEUE };
          } else {
            body[F.status] = { value: ST.NOT };
            dropped += 1;
          }
          updates.push({ id: d.$id.value, record: body });
          delete byMaster[m.$id.value];
        });
        // any due records whose master row no longer exists are left as-is
        var missing = Object.keys(byMaster).length;
        return chunkUpdate(THIS_APP, updates).then(function () {
          busy(false);
          var requeued = updates.length - dropped;
          var msg = 'Re-queued ' + requeued + ' due record(s) with fresh App ' + APP_MASTER + ' data.';
          if (dropped) msg += '\n' + dropped + ' record(s) no longer qualify - moved to "Not in Queue".';
          if (missing) msg += '\n' + missing + ' due record(s) had no matching master profile and were skipped.';
          toast(msg);
          return requeued;
        });
      });
    }).catch(function (e) { busy(false); alert('Queue due reviews failed: ' + msgOf(e)); });
  }

  // Pull the latest master data into a single existing record (keeps status,
  // cadence, due date, order). Used by the "Refresh from master" detail button.
  function refreshOne(app106Id, masterId) {
    if (!masterId) { alert('This record has no linked master id.'); return Promise.resolve(); }
    busy(true, 'Refreshing from App ' + APP_MASTER + '...');
    return fetchAll(APP_MASTER, '$id in ("' + String(masterId).replace(/"/g, '') + '")').then(function (m) {
      if (!m.length) { busy(false); alert('Master profile ' + masterId + ' not found in App ' + APP_MASTER + '.'); return; }
      var body = mapMasterFields(m[0]);
      return api('/k/v1/record', 'PUT', { app: THIS_APP, id: app106Id, record: body }).then(function () {
        busy(false);
        toast('Refreshed from master. Reloading...');
        setTimeout(function () { window.location.reload(); }, 700);
      });
    }).catch(function (e) { busy(false); alert('Refresh failed: ' + msgOf(e)); });
  }

  /* ============================= FETCH / ASSIGN ============================= */

  function fetchAndOpen() {
    busy(true, 'Finding the next record...');
    var q = F.status + ' in ("' + ST.QUEUE + '") and ' + F.inEdit + ' in ("No") order by ' + F.order + ' asc limit 500';
    return api('/k/v1/records', 'GET', { app: THIS_APP, query: q })
      .then(function (r) {
        var all = r.records;
        if (!all.length) { busy(false); alert('No records left in the Queue'); return; }
        // Round-robin pre-assigns an owner on pull, so prefer my own queued records;
        // fall back to the shared pool when my queue is empty (work-stealing).
        var myCode = me().code;
        var mine = all.filter(function (p) {
          return ((p[F.assignedTo] && p[F.assignedTo].value) || []).some(function (x) { return x && x.code === myCode; });
        });
        var pool = mine.length ? mine : all;
        return chooseRecord(pool).then(function (chosen) {
          return assign(chosen).then(function () {
            busy(false);
            go(chosen.$id.value, 'edit');
          });
        });
      })
      .catch(function (e) { busy(false); alert('Fetch failed: ' + msgOf(e)); });
  }

  function chooseRecord(pool) {
    var u = me().code;
    return api('/k/v1/records', 'GET', {
      app: THIS_APP,
      query: F.lastBy + ' in ("' + u + '") order by ' + F.lastAt + ' desc limit 1'
    }).then(function (r) {
      var recent = r.records[0];
      var within24 = false, issuer = '';
      if (recent && recent[F.lastAt] && recent[F.lastAt].value) {
        var t = new Date(recent[F.lastAt].value).getTime();
        within24 = (Date.now() - t) <= 24 * 3600 * 1000;
        issuer = recent[F.issuer] ? recent[F.issuer].value : '';
      }
      if (within24 && issuer) {
        var same = pool.filter(function (p) { return (p[F.issuer] && p[F.issuer].value) === issuer; });
        if (same.length) return pick(same, true); // random among same issuer
        return pick(pool, false);                  // next in order
      }
      return pick(pool, true);                      // random
    });
  }

  function pick(list, random) {
    if (random) return list[Math.floor(Math.random() * list.length)];
    // next in order: pool already sorted asc by order_seq
    return list[0];
  }

  function assign(rec) {
    var body = {};
    body[F.status] = { value: ST.ASSIGNED };
    body[F.assignedTo] = { value: [{ code: me().code }] };
    body[F.assignedAt] = { value: nowIso() };
    body[F.inEdit] = { value: 'Yes' };
    return api('/k/v1/record', 'PUT', { app: THIS_APP, id: rec.$id.value, record: body });
  }

  function releaseLock(recordId, toStatus) {
    var body = {};
    body[F.inEdit] = { value: 'No' };
    body[F.assignedTo] = { value: [] };
    if (toStatus) body[F.status] = { value: toStatus };
    return api('/k/v1/record', 'PUT', { app: THIS_APP, id: recordId, record: body });
  }

  // After a native Cancel, Kintone returns to the detail view without releasing our lock.
  // If this record is still Assigned + locked to the current user (in_edit reverted to
  // "Yes" because the edit was discarded), send it back to the queue (In Queue, in_edit
  // No) while KEEPING its assigned owner so round-robin ownership survives a cancel.
  function releaseIfCancelled(rec) {
    if (!rec) return;
    var locked = rec[F.inEdit] && rec[F.inEdit].value === 'Yes';
    var st = rec[F.status] && rec[F.status].value;
    var mine = ((rec[F.assignedTo] && rec[F.assignedTo].value) || [])
      .some(function (u) { return u && u.code === me().code; });
    if (!(locked && st === ST.ASSIGNED && mine)) return;
    var body = {};
    body[F.inEdit] = { value: 'No' };
    body[F.status] = { value: ST.QUEUE };
    api('/k/v1/record', 'PUT', { app: THIS_APP, id: kintone.app.record.getId(), record: body })
      .catch(function () { /* non-fatal */ });
  }

  /* ===================== DERIVED PROFILE FIELDS (from holdings) =====================
   * App 23 derives these on its own form; a REST write from App 106 does not trigger
   * that, and analysts edit the table here, so App 106 recomputes the same values from
   * holdings_table and pushes them back. They are read-only (locked) mirrors in this app.
   *   etp_holdings_type (Text_52)      - distinct asset classes present (+ "Equities"
   *                                      when the sector is an equity sector), "; "-joined.
   *                                      (matches App 23's Text_52 asset-summary automation)
   *   holds_spot_crypto (Drop_down_34) - "Yes" when any Spot row carries a non-zero %.
   *   portfolio_type    (Drop_down_36) - "Single Asset" for one distinct underlying
   *                                      cryptoasset, "Basket" for two or more.
   * Recomputed only when the table actually holds something, so an empty / parked table
   * never clobbers the values pulled from App 23.
   */
  var DERIVED_ASSET_CLASSES = ['Funds', 'Futures', 'Options', 'Permitted Swaps', 'Spot', 'Equities'];
  var DERIVED_ASSET_MAP = DERIVED_ASSET_CLASSES.reduce(function (m, n) { m[n.toLowerCase()] = n; return m; }, {});
  var DERIVED_EQUITY_SECTORS = [
    'DARB - Exchange Traded Note (ETN)',
    'DARB - Exchange Traded Fund (ETF)',
    'DARB - Closed-end Fund (CEF)',
    'DA & DARB - Exchange Traded Fund (ETF)',
    'DA & DARB - Exchange Traded Note (ETN)',
    'DA & DARB - Closed-end Fund (CEF)'
  ];

  function applyDerived(rec) {
    if (!rec || !rec[F.table]) return;
    var rows = rec[F.table].value || [];
    var classes = {}, underlyings = {}, hasSpot = false, hasHoldings = false;
    rows.forEach(function (row) {
      var v = row.value;
      var pct = num(v[F.t_pct] && v[F.t_pct].value);
      if (pct === null || pct === 0) return;          // only rows with a real weight count
      hasHoldings = true;
      var cls = DERIVED_ASSET_MAP[String((v[F.t_assetType] && v[F.t_assetType].value) || '').trim().toLowerCase()];
      if (cls) { classes[cls] = true; if (cls === 'Spot') hasSpot = true; }
      var u = String((v[F.t_underlying] && v[F.t_underlying].value) || '').trim();
      if (u) underlyings[u] = true;
    });
    if (!hasHoldings) return;                         // nothing to derive from - keep App 23 values

    var sector = (rec[F.sector] && rec[F.sector].value) || '';
    if (DERIVED_EQUITY_SECTORS.indexOf(sector) > -1) classes['Equities'] = true;

    derivedSet(rec, 'etp_holdings_type', Object.keys(classes).sort().join('; '));
    derivedSet(rec, 'holds_spot_crypto', hasSpot ? 'Yes' : 'No');
    var nUnderlying = Object.keys(underlyings).length;
    if (nUnderlying >= 1) derivedSet(rec, 'portfolio_type', nUnderlying === 1 ? 'Single Asset' : 'Basket');
  }

  function derivedSet(rec, code, value) { if (rec[code]) rec[code].value = value; }

  /* ============================= SAVE / PUSH ============================= */

  // On edit submit: stamp metadata + as_of_date, sort rows desc, then push to App 23.
  // We let the native save complete first (kintone validates the lookup), then push.
  function onEditSubmit(event) {
    var rec = event.record;
    var serverNow = nowIso();

    // D1: per-row As of Date - stamp now when the row has a %, clear otherwise.
    // Mutate .value only; replacing the cell object drops its type and Kintone
    // rejects the save ("as_of_date.type is invalid").
    var rows = (rec[F.table].value || []).map(function (row) {
      // Normalise the breakdown to a bare number string so a stray "%" (e.g. typed by
      // hand) is stripped and never trips the NUMBER field's "can only be numbers" check.
      var n = num(row.value[F.t_pct] && row.value[F.t_pct].value);
      if (row.value[F.t_pct]) row.value[F.t_pct].value = (n === null ? '' : String(n));
      var hasPct = n !== null;
      if (row.value[F.t_asOf]) row.value[F.t_asOf].value = hasPct ? serverNow : '';
      return row;
    });
    rows.sort(function (a, b) {
      return (num(b.value[F.t_pct].value) || -1) - (num(a.value[F.t_pct].value) || -1);
    });
    // Deduplicate by Asset Type + Underlying (keep the highest % = first after the sort),
    // so a double-paste or repeated row collapses to one entry before push.
    var seenRows = {};
    rows = rows.filter(function (row) {
      var v = row.value;
      var t = ((v[F.t_assetType] && v[F.t_assetType].value) || '').trim().toLowerCase();
      var u = ((v[F.t_underlying] && v[F.t_underlying].value) || '').trim().toLowerCase();
      if (!t && !u) return true;                 // keep genuinely blank rows
      var key = t + '|' + u;
      if (seenRows[key]) return false;
      seenRows[key] = true;
      return true;
    });
    rec[F.table].value = rows;

    // D2: roll up the worst BCBS group into the mirrored ETP BCBS Group field.
    if (rec.etp_bcbs_group) rec.etp_bcbs_group.value = computeRollup(rows);
    // D3: stamp App 23's "Holdings last updated by / Holding review date" mirrors.
    if (rec.holdings_last_updated_by_a23) rec.holdings_last_updated_by_a23.value = me().name;
    if (rec.holding_review_dt) rec.holding_review_dt.value = serverNow;

    // Derive Holds Spot Crypto / Portfolio Type / ETP Holdings Type from the table
    // (pushed back to App 23 by the push:true profile fields below).
    applyDerived(rec);

    // Schedule the next review from now + this record's cadence.
    var cad = (rec[F.cadence] && rec[F.cadence].value) || DEFAULT_CADENCE;
    if (rec[F.reviewDue]) rec[F.reviewDue].value = computeDue(serverNow, cad);

    rec[F.lastAt].value = serverNow;
    rec[F.lastBy].value = [{ code: me().code }];
    rec[F.inEdit].value = 'No';
    rec[F.assignedTo].value = [];
    // status flips to Updated only after the App 23 push succeeds (see success hook)
    return event;
  }

  function onEditSubmitSuccess(event) {
    var rec = event.record;
    var a23id = rec[F.a23id].value;
    pushToApp23(a23id, rec)
      .then(function () {
        return api('/k/v1/record', 'PUT', {
          app: THIS_APP, id: rec.$id.value, record: setVal({}, F.status, ST.UPDATED)
        });
      })
      .then(function () { toast('Saved and pushed to App 23.'); })
      .catch(function (e) {
        // keep record Assigned, surface error, re-lock so it is not lost
        var body = {};
        body[F.status] = { value: ST.ASSIGNED };
        body[F.inEdit] = { value: 'Yes' };
        body[F.assignedTo] = { value: [{ code: me().code }] };
        api('/k/v1/record', 'PUT', { app: THIS_APP, id: rec.$id.value, record: body });
        alert('Saved locally but push to App 23 FAILED - record kept as Assigned.\n\n' + msgOf(e));
      });
    return event;
  }

  function setVal(o, code, v) { o[code] = { value: v }; return o; }

  // Update App 23 Table_7, write the editable profile fields, and replicate
  // App 23's own form automations (D1/D2/D3) since a REST write does not trigger
  // its JS.
  //
  // Holdings rows are updated BY ROW ID (a23_row_id) with only the analyst-edited
  // columns; the Underlying Cryptoasset lookup (Drop_down_24) is never written, so
  // App 23 keeps its own underlying value. This matters because App 23's stored
  // asset name often differs from App 34's current name, and writing the lookup
  // would fail validation. Rows with an id are updated (underlying preserved);
  // rows without one are new (underlying left blank in App 23, set there if needed);
  // existing rows not included are removed.
  function pushToApp23(a23id, rec) {
    var rows = (rec[F.table] && rec[F.table].value) || [];
    var serverNow = nowIso();
    var t7 = rows.map(function (row) {
      var v = row.value;
      var pct = num(v[F.t_pct].value);
      var o = {};
      o[A23.h_assetType] = { value: v[F.t_assetType].value || '' };
      o[A23.h_bcbs] = { value: v[F.t_bcbs].value || '' };       // BCBS group (copy target)
      o[A23.h_pct] = { value: formatPercent(pct) };             // D1: "NN.NN%"
      o[A23.h_asOf] = { value: pct === null ? '' : serverNow }; // D1: stamp if % present
      // NOTE: A23.h_underlying (Drop_down_24 lookup) is omitted for EXISTING rows
      // (updated by id) so the master keeps its own underlying value. For NEW rows
      // it is included when present: Paste allocation resolves to a valid reference
      // -app key, so the lookup validates; a manually typed name that is not a valid
      // key will make the push report an error (record kept Assigned) rather than
      // silently drop the asset name.
      var rowId = v[F.t_rowId] && v[F.t_rowId].value;
      var out = { value: o };
      if (rowId) {
        out.id = String(rowId); // update in place -> underlying preserved
      } else {
        var u = v[F.t_underlying] && v[F.t_underlying].value;
        if (u) o[A23.h_underlying] = { value: u };
      }
      return out;
    });
    var body = {};
    body[A23.holdingsTable] = { value: t7 };
    // editable profile fields (analyst edits flow straight back)
    PROFILE_FIELDS.forEach(function (m) {
      if (!m.push) return;
      var cell = rec[m.a106];
      body[m.a23] = { value: cell && cell.value != null ? cell.value : '' };
    });
    // D2: BCBS rollup -> ETP BCBS Group (BCBS_Lowest_Value)
    body[A23.bcbsRollup] = { value: computeRollup(rows) };
    // D3: last updated by / at, as App 23's own form would stamp them
    body[A23.updatedBy] = { value: me().name };
    body[A23.updatedAt] = { value: serverNow };
    return api('/k/v1/record', 'PUT', { app: APP23, id: a23id, record: body });
  }

  function msgOf(e) {
    if (!e) return 'Unknown error';
    var parts = [];
    if (e.message) parts.push(e.message);
    if (e.code) parts.push('[' + e.code + ']');
    if (e.errors) { try { parts.push(JSON.stringify(e.errors)); } catch (x) { /* ignore */ } }
    if (parts.length) return parts.join(' ');
    try { return JSON.stringify(e); } catch (x) { return String(e); }
  }

  /* ============================= SCREENS ============================= */

  // Overview (index) page
  kintone.events.on('app.record.index.show', function (event) {
    a106Fields();                  // warm App 106 field map for safe mirror writes
    maybeAutoSync();               // throttled full sync on open (Active in / non-Active out)
    buttonizeListButtons();        // Master Profile + Box links as buttons in the list view
    if (document.querySelector('.ehu-bar')) return event;
    var sp = kintone.app.getHeaderMenuSpaceElement();
    if (!sp) return event;
    var b = bar();
    b.appendChild(mkBtn('Add to Queue', function () {
      var p = prompt('Add to Queue.\nEnter an ETP Provider to filter (App 23 "ETP Provider"),\nor leave blank to queue all qualifying profiles:', '');
      if (p === null) return;
      pullQueue(p.trim());
    }, true));
    b.appendChild(mkBtn('Refresh Queue', function () { pullQueue(''); }));
    var dueBtn = mkBtn('Queue Due Reviews', function () { queueDueReviews(); }, true);
    b.appendChild(dueBtn);
    b.appendChild(mkBtn('Fetch Record', function () { fetchAndOpen(); }, true));
    b.appendChild(mkBtn('Updated Records', function () {
      // jump to a client filter: open index and show only Updated
      sessionStorage.setItem('ehu-filter', 'updated');
      gotoIndex();
    }));
    b.appendChild(mkBtn('Guide', function () { openGuideModal(); }));
    sp.appendChild(b);

    // Show how many records are currently due for review on the button.
    countDue().then(function (n) {
      dueBtn.textContent = 'Queue Due Reviews (' + n + ')';
    }).catch(function () { /* leave default label */ });

    // Optional: client-side "Updated Records" emphasis note
    if (sessionStorage.getItem('ehu-filter') === 'updated') {
      sessionStorage.removeItem('ehu-filter');
      toast('Tip: use the view selector / filter on Status = "Updated".');
    }
    return event;
  });

  // Edit page - hook save + add Cancel
  kintone.events.on('app.record.edit.submit', onEditSubmit);
  kintone.events.on('app.record.edit.submit.success', onEditSubmitSuccess);

  // Reference-app (App 34/85) BCBS lookup cache: exact Underlying Cryptoasset Name ->
  // { bcbs, found }. Loaded once so the change handler can fill BCBS SYNCHRONOUSLY.
  // Kintone forbids a change handler from returning a Promise ("...not allowed to return
  // 'Thenable' object"); the old async version threw on manual edits AND on Paste's set().
  var _refByKey = null;
  function loadRefByKey() {
    if (_refByKey) return Promise.resolve(_refByKey);
    return fetchAll(APP_REF, '', [A34.key, A34.bcbs, A34.foundInEtps]).then(function (records) {
      var m = {};
      records.forEach(function (r) {
        var key = (r[A34.key] || {}).value;
        if (!key) return;
        m[key] = {
          bcbs: (r[A34.bcbs] || {}).value || '',
          found: ((r[A34.foundInEtps] || {}).value || '') === 'Yes'
        };
      });
      _refByKey = m;
      return m;
    }).catch(function () { return (_refByKey = _refByKey || {}); });
  }

  // Auto-fill BCBS Group from the reference app when the analyst sets an Underlying
  // Cryptoasset. SYNCHRONOUS (never returns a Promise): resolves against the cached map;
  // if the cache is not ready or the name is unknown, BCBS is left as-is so an
  // App 23/App 34 name mismatch never blocks the edit.
  kintone.events.on(
    ['app.record.edit.change.' + F.t_underlying, 'app.record.create.change.' + F.t_underlying],
    function (event) {
      var row = event.changes && event.changes.row;
      if (!row || !row.value[F.t_underlying] || !row.value[F.t_bcbs]) return event;
      var name = (row.value[F.t_underlying].value || '').trim();
      var hit = (name && _refByKey) ? _refByKey[name] : null;
      if (hit && hit.found && hit.bcbs) row.value[F.t_bcbs].value = hit.bcbs;
      return event;
    }
  );

  // Recompute the table-derived profile fields live as the analyst edits the holdings
  // (rows added/removed, or an Asset Type / % / Underlying cell changed).
  kintone.events.on([
    'app.record.create.change.' + F.table,        'app.record.edit.change.' + F.table,
    'app.record.create.change.' + F.t_assetType,  'app.record.edit.change.' + F.t_assetType,
    'app.record.create.change.' + F.t_pct,        'app.record.edit.change.' + F.t_pct,
    'app.record.create.change.' + F.t_underlying, 'app.record.edit.change.' + F.t_underlying
  ], function (event) {
    applyDerived(event.record);
    return event;
  });

  kintone.events.on('app.record.edit.show', function (event) {
    loadRefByKey();                // warm the BCBS lookup cache for synchronous auto-fill
    // "Holdings Assistant" renders in the in-form space field under the holdings table
    // (element id "pasteAllocSpace"). No Cancel button here - Kintone's own Cancel handles
    // discard, and detail.show releases the lock if the edit was cancelled.
    var ps = null;
    try { ps = kintone.app.record.getSpaceElement('pasteAllocSpace'); } catch (e) { ps = null; }
    if (!ps) ps = kintone.app.record.getHeaderMenuSpaceElement();   // fallback if space missing
    if (ps && !ps.querySelector('.ehu-paste-btn')) {
      var b = bar();
      var pb = mkBtn('Holdings Assistant', function () { openPasteModal(); }, true);
      pb.className += ' ehu-paste-btn';
      b.appendChild(pb);
      ps.appendChild(b);
    }
    // make system fields read-only in the form
    lockSystemFields(event);
    // reflect the table-derived fields on open (heals any drift from the master)
    applyDerived(event.record);
    renderRecordButtons();             // App 23 + Box link fields as buttons
    return event;
  });

  // Detail (view-only) page - navigation buttons
  kintone.events.on('app.record.detail.show', function (event) {
    hideRowId();
    a106Fields();                  // warm App 106 field map for "Refresh from master"
    releaseIfCancelled(event.record);  // native Cancel lands here - free our lock if so
    renderRecordButtons();             // App 23 + Box link fields as buttons
    if (document.querySelector('.ehu-bar')) return event;
    var sp = kintone.app.record.getHeaderMenuSpaceElement();
    if (!sp) return event;
    var id = kintone.app.record.getId();
    var b = bar();
    b.appendChild(mkBtn('ETP Holdings Update', function () { gotoIndex(); }, true));
    b.appendChild(mkBtn('Fetch Next Record', function () { fetchAndOpen(); }, true));
    b.appendChild(mkBtn('Refresh from master', function () {
      var r = kintone.app.record.get().record;
      var mid = r[F.a23id] && r[F.a23id].value;
      if (!confirm('Re-pull the latest data for this profile from App ' + APP_MASTER + '?\nThis overwrites the holdings and profile fields shown here.')) return;
      refreshOne(id, mid);
    }));
    b.appendChild(mkBtn('Edit', function () {
      // re-open in edit + re-lock to this user
      var body = {};
      body[F.inEdit] = { value: 'Yes' };
      body[F.status] = { value: ST.ASSIGNED };
      body[F.assignedTo] = { value: [{ code: me().code }] };
      api('/k/v1/record', 'PUT', { app: THIS_APP, id: id, record: body })
        .then(function () { go(id, 'edit'); })
        .catch(function () { go(id, 'edit'); });
    }));
    sp.appendChild(b);
    return event;
  });

  function lockSystemFields(event) {
    var rec = event.record;
    [F.a23id, F.status, F.assignedTo, F.assignedAt, F.inEdit, F.lastBy, F.lastAt, F.order, F.reviewDue,
      F.issuer, F.etpName, F.identifier, F.sector, F.profileStatus, F.a23link, F.boxName, F.boxLink,
      'holdings_last_updated_by_a23', 'etp_bcbs_group', 'holding_review_dt',
      'holds_spot_crypto', 'portfolio_type', 'etp_holdings_type']
      .forEach(function (code) {
        if (rec[code]) rec[code].disabled = true;
      });
    // Securities is reference data maintained in the master app - lock every cell.
    if (rec[F.secTable] && rec[F.secTable].value) {
      rec[F.secTable].value.forEach(function (row) {
        Object.keys(row.value).forEach(function (c) {
          if (row.value[c]) row.value[c].disabled = true;
        });
      });
    }
    hideRowId();
    return event;
  }

  // A23 Row ID is an internal pointer (the App 23 subtable row id), not for humans.
  function hideRowId() {
    try { kintone.app.record.setFieldShown(F.t_rowId, false); } catch (e) { /* older UI */ }
  }

  // Render a LINK field as a themed button (opens the URL in a new tab) instead of raw text.
  function renderLinkButton(code, label, marker) {
    try {
      var url = (kintone.app.record.get().record[code] || {}).value;
      var el = kintone.app.record.getFieldElement(code);
      if (!url || !el || el.querySelector('.' + marker)) return;
      el.innerHTML = '';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.className = 'etp-btn etp-btn-primary ' + marker;
      btn.onclick = function () { window.open(url, '_blank', 'noopener'); };
      el.appendChild(btn);
    } catch (e) { /* field not on the form / older UI */ }
  }
  // Master Record -> App 23/86; Box -> the shared Box folder (team adds files there).
  function renderRecordButtons() {
    renderLinkButton(F.a23link, 'Master Profile', 'ehu-master-btn');
    renderLinkButton(F.boxLink, 'Open Box folder', 'ehu-box-btn');
  }

  // Turn the LINK cells in the index/list view into compact buttons (one per row).
  // Requires the field to be a column in the active list view.
  function buttonizeListCells(code, label, marker) {
    try {
      var els = kintone.app.getFieldElements(code) || [];
      els.forEach(function (el) {
        if (!el || el.querySelector('.' + marker)) return;
        var a = el.querySelector('a');
        var url = a ? (a.href || a.textContent) : '';
        if (!url || !/^https?:\/\//i.test(url)) return;
        el.innerHTML = '';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.className = 'etp-btn etp-btn-primary ' + marker;
        btn.style.padding = '4px 12px';
        btn.style.fontSize = '12px';
        btn.onclick = function (e) { e.stopPropagation(); window.open(url, '_blank', 'noopener'); };
        el.appendChild(btn);
      });
    } catch (e) { /* field not in this view / older UI */ }
  }
  function buttonizeListButtons() {
    buttonizeListCells(F.a23link, 'Master Profile', 'ehu-master-btn');
    buttonizeListCells(F.boxLink, 'Open Box folder', 'ehu-box-btn');
  }

  /* ===================== IN-APP GUIDE (edit GUIDE_HTML to tweak) =====================
   * Opened by the "Guide" toolbar button. This replaces the app-description blurb with a
   * clear, in-app doc. Edit the HTML below to perfect the instructions. */
  var GUIDE_HTML =
    '<h3 class="etp-modal-title">ETP Holdings Update - how it works</h3>' +
    '<p class="etp-modal-sub">A queue-driven workstation for reviewing and updating the DA ETP Holdings that live in the master ETP app. This app is a work mirror - the master app stays the system of record.</p>' +
    '<div class="etp-guide" style="max-height:60vh;overflow:auto;font-size:14px;line-height:1.55;color:#0c2b28">' +
      '<h4>What it references</h4>' +
      '<ul>' +
        '<li><b>Master app</b> (ETP profiles) - App 23 live / App 86 test. Read when pulling, written back on Save.</li>' +
        '<li><b>Reference app</b> (cryptoasset &amp; BCBS) - App 34 live / App 85 test. Read-only; used for BCBS auto-fill and ticker matching.</li>' +
        '<li><b>Box</b> - the <b>Open Box folder</b> button opens the same Box folder as the master record, for adding files.</li>' +
      '</ul>' +
      '<h4>How records get here</h4>' +
      '<p>A profile is pulled in when it is <b>Active</b> and in an allow-listed <b>Sector</b>. The overview auto-syncs when opened (or use <b>Refresh Queue</b>); profiles that are no longer Active drop out automatically.</p>' +
      '<h4>How to use it</h4>' +
      '<ul>' +
        '<li><b>Add to Queue / Refresh Queue</b> - pull qualifying profiles from the master app.</li>' +
        '<li><b>Queue Due Reviews (N)</b> - re-pull records whose review is due (N = how many are due now).</li>' +
        '<li><b>Fetch Record</b> - assigns the next queued record to you and opens it to edit.</li>' +
        '<li><b>Holdings Assistant</b> (edit screen) - paste a holdings list or extract it from text/a screenshot with AI; rows are matched to the reference app and added for review, then <b>Save</b>.</li>' +
        '<li><b>Save</b> - writes the holdings back to the master app and schedules the next review.</li>' +
        '<li><b>Master Profile / Open Box folder</b> - open the linked master record / Box folder.</li>' +
      '</ul>' +
    '</div>';

  function openGuideModal() {
    if (document.getElementById('etp-guide-ov')) return;
    var ov = document.createElement('div');
    ov.id = 'etp-guide-ov';
    ov.className = 'etp-modal-ov';
    var box = document.createElement('div');
    box.className = 'etp-modal';
    box.style.maxWidth = '720px';
    box.innerHTML = GUIDE_HTML +
      '<div class="etp-modal-actions"><button id="etp-guide-close" class="etp-btn etp-btn-primary">Close</button></div>';
    ov.appendChild(box);
    document.body.appendChild(ov);
    var close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    box.querySelector('#etp-guide-close').onclick = close;
  }

  /* ============================= PASTE ALLOCATION ============================= */
  // Paste a name / ticker / weight block; tickers are matched against the reference
  // app (App 85 / App 34) and rows are added straight into the open edit form's
  // Holdings table (BCBS auto-filled on a match). Nothing is written to the server
  // here - the analyst reviews, then the normal Save pushes to the master app.

  var PASTE_TYPE_OPTIONS = ['Spot', 'Futures', 'Options', 'Funds', 'Permitted Swaps'];

  // kintone.app.record.set() validates the in-form record model and rejects any subtable
  // cell that lacks a valid `type` ("...type is invalid"). REST writes (pull/push) do not
  // need it, but Paste builds brand-new rows and feeds them through set(), so each cell
  // must carry its field type. These match the deployed holdings_table schema.
  var HOLDINGS_CELL_TYPES = (function () {
    var m = {};
    m[F.t_rowId] = 'SINGLE_LINE_TEXT';
    m[F.t_assetType] = 'DROP_DOWN';
    m[F.t_underlying] = 'SINGLE_LINE_TEXT';
    m[F.t_bcbs] = 'DROP_DOWN';
    m[F.t_pct] = 'NUMBER';
    m[F.t_asOf] = 'DATETIME';
    return m;
  })();
  function hcell(code, value) { return { type: HOLDINGS_CELL_TYPES[code], value: value }; }

  function pnorm(s) { return String(s || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase(); }

  // Parser - auto-detects delimited COLUMN paste (header with Symbol/Weight) vs a
  // loose STREAM paste (pairs each weight with the nearest preceding ticker).
  function parseSource(text) {
    var raw = String(text).replace(/\u00A0/g, ' ').replace(/\u2212/g, '-');
    var lines = raw.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    var numRe = /^(-?\d{1,3}(?:[.,]\d{1,4})?)%?$/;
    var tickRe = /^(?=[A-Z0-9]*[A-Z])[A-Z0-9]{2,6}$/;
    var clean = function (s) { return String(s == null ? '' : s).replace(/[^A-Za-z0-9]/g, '').toUpperCase(); };
    var asNum = function (s) { var m = String(s == null ? '' : s).trim().match(numRe); return m ? m[1].replace(',', '.') : null; };
    var tickFromField = function (f) {
      var p = /\(([A-Za-z0-9]{2,6})\)\s*$/.exec(f) || /\(([A-Za-z0-9]{2,6})\)/.exec(f);
      if (p) return { ticker: p[1].toUpperCase(), name: String(f).slice(0, String(f).lastIndexOf('(')).trim() };
      var c = clean(f);
      return tickRe.test(c) ? { ticker: c, name: '' } : null;
    };

    // Pre-pass for bullet / colon lists: "[*-\u20221.] Name (TICKER)[:] weight[%]" per line
    // (e.g. "* Bitcoin (BTC): 50.03%"). Used only when EVERY non-empty line matches, so
    // delimited and free-stream pastes fall through to the logic below.
    var bulletRe = /^\s*(?:[*\u2022\u00b7\u25aa\u2023>\u2043\-\u2013\u2014]+|\d+[.)])\s+/;
    var lineRe = /^(.*?)\s*\(([A-Za-z0-9]{2,6})\)\s*[:\-\u2013]?\s*(-?\d{1,3}(?:[.,]\d{1,4})?)\s*%?\s*$/;
    var lineHits = [];
    lines.forEach(function (l) {
      var m = lineRe.exec(l.replace(bulletRe, '').trim());
      if (m) lineHits.push({ ticker: m[2].toUpperCase(), pct: m[3].replace(',', '.'), name: m[1].trim() });
    });
    if (lineHits.length >= 2 && lineHits.length === lines.length) return lineHits;

    var delim = raw.indexOf('\t') > -1 ? '\t'
              : raw.indexOf('|') > -1 ? '|'         // markdown / pipe tables
              : raw.indexOf(';') > -1 ? ';'
              : /[^\d],|,[^\d]/.test(raw) ? ','
              : null;
    // Split a row by the delimiter; for "|" tables, drop the empty cells the outer pipes
    // create so column indices line up (e.g. "| a | b |" -> ["a","b"]).
    var splitRow = function (line) {
      var p = line.split(delim).map(function (s) { return s.trim(); });
      if (delim === '|') {
        while (p.length && p[0] === '') p.shift();
        while (p.length && p[p.length - 1] === '') p.pop();
      }
      return p;
    };
    var hdr = null;
    if (delim && lines.length >= 2) {
      var head = splitRow(lines[0]);
      var looks = head.some(function (h) { return /name|symbol|ticker|weight|ponder|price|reference|index/i.test(h); }) &&
                  !head.some(function (h) { return asNum(h); });
      if (looks) {
        var si = -1, wi = -1, ni = -1;
        head.forEach(function (h, i) {
          if (si < 0 && /symbol|ticker/i.test(h)) si = i;
          if (/weight|ponder/i.test(h)) wi = i;
          if (ni < 0 && /name/i.test(h)) ni = i;
        });
        hdr = { si: si < 0 ? 1 : si, wi: wi < 0 ? head.length - 1 : wi, ni: ni < 0 ? 0 : ni };
      }
    }
    var out = [];
    if (hdr) {
      lines.slice(1).forEach(function (line) {
        var f = splitRow(line);
        var w = asNum(f[hdr.wi]);
        if (!w) return;
        var tf = tickFromField(f[hdr.si]);
        if (!tf) for (var i = 1; i < f.length && !tf; i++) tf = tickFromField(f[i]);
        if (tf) out.push({ ticker: tf.ticker, pct: w, name: f[hdr.ni] || tf.name });
      });
      return out;
    }
    var fields = delim
      ? lines.reduce(function (a, l) { return a.concat(l.split(delim)); }, [])
      : raw.split(/\s+/);
    var pend = null, prev = '';
    fields.forEach(function (f) {
      var s = String(f == null ? '' : f).trim();
      if (!s) return;
      var n = asNum(s);
      if (n) { if (pend) { out.push({ ticker: pend.ticker, pct: n, name: pend.name || prev }); pend = null; } prev = ''; return; }
      var tf = tickFromField(s);
      if (tf) pend = { ticker: tf.ticker, name: tf.name || prev };
      else prev = s;
    });
    return out;
  }

  // ticker -> [{key, nameNorm, bcbs, found}] from the reference app.
  function loadRefKeyMap() {
    return fetchAll(APP_REF, '', [A34.key, A34.bcbs, A34.foundInEtps]).then(function (records) {
      var map = {};
      records.forEach(function (r) {
        var key = (r[A34.key] || {}).value;
        if (!key) return;
        var t = /\(([A-Za-z0-9]+)\)\s*$/.exec(key) || /\(([A-Za-z0-9]+)\)/.exec(key);
        if (!t) return;
        var tick = t[1].toUpperCase();
        var namePart = key.slice(0, key.lastIndexOf('(')).trim();
        (map[tick] = map[tick] || []).push({
          key: key,
          nameNorm: pnorm(namePart),
          bcbs: (r[A34.bcbs] || {}).value || '',
          found: ((r[A34.foundInEtps] || {}).value || '') === 'Yes'
        });
      });
      return map;
    });
  }

  // resolve a parsed row to one reference candidate (prefer Found-in-ETPs = Yes,
  // then break same-ticker collisions by name).
  function resolveRef(p, map) {
    var arr = map[p.ticker];
    if (!arr || !arr.length) return { status: 'unmatched' };
    var pool = arr.filter(function (c) { return c.found; });
    if (!pool.length) pool = arr;
    if (pool.length === 1) return { status: 'ok', cand: pool[0] };
    var hit = pool.filter(function (c) { return c.nameNorm === pnorm(p.name); });
    if (hit.length === 1) return { status: 'ok', cand: hit[0] };
    return { status: 'ambiguous', options: pool.map(function (c) { return c.key; }) };
  }

  /* ===================== HOLDINGS ASSISTANT (optional Gemini extraction) =====================
   * Folded in from the standalone DARB "Profile assistant". Each analyst stores their own free
   * Gemini key (aistudio.google.com/apikey) in this browser under the SAME storage key, so a
   * key saved in the DARB app is reused here. "Extract with AI" turns pasted text / a pasted or
   * attached screenshot into "Name (TICKER) - weight%" lines, which the paste parser then reads.
   * The key is sent directly to Google, never to a shared server. */
  var AI_MODEL = 'gemini-3.5-flash';
  var AI_STORE_KEY = 'darbAiGeminiKey';
  var AI_HOLDINGS_INSTR = 'The input is a list of crypto holdings, given either as pasted text (often with each asset duplicated: name, name with ticker, then weight) or as an attached image of a holdings breakdown. Output one line per asset as "Name (TICKER) - weight%". Include an asset only where its name/ticker/weight is clearly legible; where a box shows only an icon and a percentage with no text label, write "UNVERIFIED (weight%)". Do NOT fabricate, estimate, or identify assets from logos or icons; if a value is absent, write "[missing]". Return only the list.';
  function aiEndpoint(key) { return 'https://generativelanguage.googleapis.com/v1beta/models/' + AI_MODEL + ':generateContent?key=' + encodeURIComponent(key); }
  function aiGetKey() { try { return localStorage.getItem(AI_STORE_KEY); } catch (e) { return null; } }
  function aiSetKey(v) { try { localStorage.setItem(AI_STORE_KEY, v); } catch (e) { /* ignore */ } }
  // Resolve to the extracted holdings text (or reject with a friendly message).
  function aiExtractHoldings(text, image) {
    var key = aiGetKey();
    if (!key) return Promise.reject(new Error('Enter your Gemini key first.'));
    var parts = [{ text: AI_HOLDINGS_INSTR + (text ? ('\n\n---\nTEXT:\n' + text) : '') }];
    if (image) parts.push({ inlineData: image });
    return fetch(aiEndpoint(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: parts }], generationConfig: { temperature: 0.2 } })
    }).then(function (res) {
      return res.json().then(function (data) {
        if (res.status === 429) throw new Error('Gemini rate limit - wait a moment and try again.');
        if (res.status === 400 || res.status === 404) throw new Error('Request rejected - check the API key. (' + ((data.error && data.error.message) || res.status) + ')');
        if (data.error) throw new Error(data.error.message || 'request rejected');
        var c = data && data.candidates && data.candidates[0];
        var out = c && c.content && c.content.parts && c.content.parts[0] && c.content.parts[0].text;
        return (out || '').trim();
      });
    });
  }

  function openPasteModal() {
    if (document.getElementById('etp-paste-ov')) return;
    var ov = document.createElement('div');
    ov.id = 'etp-paste-ov';
    ov.className = 'etp-modal-ov';
    var typeOpts = '<option value="">(leave blank)</option>' +
      PASTE_TYPE_OPTIONS.map(function (o) { return '<option value="' + o + '">' + o + '</option>'; }).join('');
    var box = document.createElement('div');
    box.className = 'etp-modal';
    box.style.maxHeight = '92vh';
    box.style.overflowY = 'auto';
    box.innerHTML =
      '<h3 class="etp-modal-title">Holdings Assistant</h3>' +
      '<p class="etp-modal-sub">Paste a name / ticker / weight block, or use AI to extract holdings from messy text or a screenshot. Rows are matched against the reference app (App ' + APP_REF + '); BCBS Group fills automatically on a match.</p>' +
      '<textarea id="etp-paste-text" class="etp-modal-text" placeholder="Bitcoin (BTC) 52.69%&#10;Ethereum ETH 18.84&#10;...   (or paste a screenshot below, then Extract with AI)"></textarea>' +
      '<div class="etp-ai-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px">' +
        '<button id="etp-ai-attach" class="etp-btn etp-btn-ghost" type="button">Attach image</button>' +
        '<span id="etp-ai-imgname" style="font-size:.8rem;color:var(--etp-muted)"></span>' +
        '<button id="etp-ai-run" class="etp-btn etp-btn-primary" type="button">Extract Holdings</button>' +
        '<span id="etp-ai-status" style="font-size:.8rem;color:var(--etp-muted)"></span>' +
        '<input id="etp-ai-file" type="file" accept="image/*" style="display:none"/>' +
      '</div>' +
      '<div id="etp-ai-keyrow" style="display:none;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px">' +
        '<input id="etp-ai-key" type="password" placeholder="Gemini API key (stored in this browser only)" style="flex:1;min-width:200px;padding:8px 10px;border:1px solid var(--etp-line);border-radius:8px;font-family:var(--etp-font)"/>' +
        '<button id="etp-ai-savekey" class="etp-btn etp-btn-primary" type="button">Save key</button>' +
        '<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener" style="font-size:.8rem;color:var(--etp-teal)">Get a free key</a>' +
      '</div>' +
      '<div class="etp-modal-controls" style="margin-top:12px">' +
        '<span><label>As of date</label><input id="etp-paste-date" type="date"/></span>' +
        '<span><label>Asset breakdown</label><select id="etp-paste-type">' + typeOpts + '</select></span>' +
        '<label class="etp-modal-check"><input id="etp-paste-replace" type="checkbox" checked/> Replace existing rows</label>' +
      '</div>' +
      '<div class="etp-modal-actions">' +
        '<button id="etp-paste-cancel" class="etp-btn etp-btn-ghost">Cancel</button>' +
        '<button id="etp-paste-run" class="etp-btn etp-btn-primary">Add rows</button>' +
      '</div>';
    ov.appendChild(box);
    document.body.appendChild(ov);
    box.querySelector('#etp-paste-date').value = new Date().toISOString().slice(0, 10);
    var close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    box.querySelector('#etp-paste-cancel').onclick = close;

    // ---- Holdings Assistant (AI) wiring ----
    var aiImage = null;
    var statusEl = box.querySelector('#etp-ai-status');
    var keyRow = box.querySelector('#etp-ai-keyrow');
    var setAiStatus = function (m) { statusEl.textContent = m || ''; };
    var aiLoadImage = function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        aiImage = { mimeType: file.type || 'image/png', data: String(reader.result).split(',')[1] };
        box.querySelector('#etp-ai-imgname').innerHTML = 'image attached &#10003; <span id="etp-ai-imgx" style="cursor:pointer;color:#c33">&times;</span>';
        var x = box.querySelector('#etp-ai-imgx');
        if (x) x.onclick = function () { aiImage = null; box.querySelector('#etp-ai-imgname').textContent = ''; };
      };
      reader.readAsDataURL(file);
    };
    var fileInput = box.querySelector('#etp-ai-file');
    box.querySelector('#etp-ai-attach').onclick = function () { fileInput.click(); };
    fileInput.onchange = function (e) { if (e.target.files[0]) aiLoadImage(e.target.files[0]); };
    box.addEventListener('paste', function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) { e.preventDefault(); aiLoadImage(items[i].getAsFile()); return; }
      }
    });
    box.querySelector('#etp-ai-savekey').onclick = function () {
      var v = box.querySelector('#etp-ai-key').value.trim();
      if (v) { aiSetKey(v); keyRow.style.display = 'none'; setAiStatus('Key saved.'); }
    };
    box.querySelector('#etp-ai-run').onclick = function () {
      if (!aiGetKey()) { keyRow.style.display = 'flex'; setAiStatus('Paste your Gemini key, then Save key.'); return; }
      var srcText = box.querySelector('#etp-paste-text').value.trim();
      if (!srcText && !aiImage) { setAiStatus('Paste text or attach a screenshot first.'); return; }
      setAiStatus('Extracting holdings...');
      aiExtractHoldings(srcText, aiImage).then(function (out) {
        if (!out) { setAiStatus('No holdings returned - try a clearer screenshot.'); return; }
        box.querySelector('#etp-paste-text').value = out;
        setAiStatus('Done - review the list, then Add rows.');
      }).catch(function (err) {
        var m = msgOf(err);
        setAiStatus(m);
        if (/key/i.test(m)) keyRow.style.display = 'flex';
      });
    };

    box.querySelector('#etp-paste-run').onclick = function () {
      var text = box.querySelector('#etp-paste-text').value;
      var date = box.querySelector('#etp-paste-date').value;
      var type = box.querySelector('#etp-paste-type').value;
      var replace = box.querySelector('#etp-paste-replace').checked;
      close();
      runPaste(text, date, type, replace);
    };
  }

  function runPaste(text, asOfDate, breakdownType, replace) {
    var parsed = parseSource(text);
    if (!parsed.length) { alert('No "name + ticker + weight" rows found in the paste.'); return; }
    busy(true, 'Matching ' + parsed.length + ' row(s) against App ' + APP_REF + '...');
    loadRefKeyMap().then(function (map) {
      busy(false);
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var now = new Date();
      var clock = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
      var dateVal = asOfDate ? new Date(asOfDate + 'T' + clock).toISOString() : '';

      var rec = kintone.app.record.get().record;
      var rows = replace ? [] : (rec[F.table].value || []).slice();
      var unmatched = [], ambiguous = [], nobcbs = 0;

      parsed.forEach(function (p) {
        var res = resolveRef(p, map);
        var underlying, bcbs = '';
        if (res.status === 'ok') { underlying = res.cand.key; bcbs = res.cand.bcbs || ''; }
        else {
          underlying = p.name ? (p.name + ' (' + p.ticker + ')') : p.ticker;
          if (res.status === 'ambiguous') ambiguous.push(p.ticker); else unmatched.push(p.ticker);
        }
        if (!bcbs) nobcbs++;
        var numPct = num(p.pct);
        var c = {};
        c[F.t_rowId] = hcell(F.t_rowId, '');
        c[F.t_assetType] = hcell(F.t_assetType, breakdownType || '');
        c[F.t_underlying] = hcell(F.t_underlying, underlying);
        c[F.t_bcbs] = hcell(F.t_bcbs, bcbs);
        // breakdown_pct is a NUMBER field - store the bare number only (num() already
        // stripped any "%"/commas) so the value never trips "can only be numbers".
        c[F.t_pct] = hcell(F.t_pct, numPct === null ? '' : String(numPct));
        c[F.t_asOf] = hcell(F.t_asOf, (numPct !== null && dateVal) ? dateVal : null);
        rows.push({ value: c });
      });

      rows.sort(function (a, b) { return (num(b.value[F.t_pct].value) || -1) - (num(a.value[F.t_pct].value) || -1); });
      rows = dedupeRows(rows);            // collapse repeats by Asset Type + Underlying
      rec[F.table].value = rows;
      applyDerived(rec);                 // refresh Holds Spot / Portfolio Type / Holdings Type
      kintone.app.record.set({ record: rec });

      var msg = parsed.length + ' row(s) added' + (replace ? ' (replaced existing).' : '.');
      if (nobcbs) msg += '\nNo BCBS match for ' + nobcbs + ' row(s) - set BCBS manually.';
      if (unmatched.length) msg += '\nNot in App ' + APP_REF + ': ' + unmatched.join(', ');
      if (ambiguous.length) msg += '\nAmbiguous ticker (verify): ' + ambiguous.join(', ');
      alert(msg + '\n\nReview the rows, then Save to push to the master app.');
    }).catch(function (e) { busy(false); alert('Paste failed: ' + msgOf(e)); });
  }

})();
