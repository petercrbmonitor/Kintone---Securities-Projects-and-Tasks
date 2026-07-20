/***************************************************************************************
 * DARB SECURITIES SORT PIPELINE - FULL BUILD (Steps 1-4)
 * Container-bound Google Apps Script - single file, no external dependencies.
 *
 * SETUP
 * 1. In the workbook: Extensions > Apps Script > replace Code.gs with this file.
 * 2. Project Settings > tick "Show appsscript.json manifest file" > replace its
 *    contents with the provided appsscript.json.
 * 3. Reload the workbook. The "DARB Pipeline" menu appears and all tabs scaffold.
 *
 * MENU
 *   Import Pull Files        - upload AlphaSense Search Summary CSV or XLSX exports
 *                              (RAW tabs hidden)
 *   Build Clean Pull         - stack, clean, dedupe all RAW tabs (auto-runs after import)
 *   Refresh DB References    - rebuild Current DB + Watchlist from the Kintone export
 *                              (ticker-less rows go to hidden "No Ticker Reference")
 *   Run Crosscheck           - replicate RunSort: SORT / REVIEW / EXCLUDED
 *   Distribute Selected      - hand checked Sort rows to interns (Date Assigned + Due Date)
 *   Clean-up This Tab        - route reviewed rows on the intern tab you have open
 *   Process Reviews          - sweep ALL intern tabs (backstop)
 *   Build Kintone Upload     - format qualified Adds into the single Kintone Upload tab
 *                              (parent profile + Website URLs + Source Documents subtables)
 *   Download Kintone CSV     - download the Kintone Upload tab as a UTF-8 CSV
 *   Rescaffold Tabs          - force-rewrite headers + formatting + dropdowns
 *
 * CONFIG TAB
 *   "Ticker flag keywords" - comma-separated, default ".IN". The Ticker Flag column
 *   is TRUE when a ticker contains any keyword. Edit the value, no code change needed.
 *
 * ON-SHEET BUTTONS (optional)
 *   Insert > Drawing > draw a button > Save. Click the drawing > three-dot menu >
 *   Assign script > type one of:
 *     cleanupActiveTab     (per intern tab)
 *     buildKintoneUpload       (on the Adds tab)
 *     downloadKintoneUploadCsv (on the Kintone Upload tab)
 ***************************************************************************************/

/* ================================ CONFIG / TAB DEFS ================================ */

var RAW_PREFIX = 'RAW - ';
var INTERN_RE = /^(.+) - Sort$/;
var ASSIGN_OPTIONS = ['Add', 'Watchlist', 'FR Exclude', 'Confirmed Exclude', 'In DB'];
var MOVE_OPTIONS = ['Sort', 'Watchlist', 'FR Exclude', 'Confirmed Exclude', 'Remove'];
var SORT_MOVE_OPTIONS = ['Watchlist', 'FR Exclude', 'Confirmed Exclude', 'Remove']; // Sort's own Move To (no self-move)

/* Tabs that support row reclassification via a Select + Move To pair.
 *   selectCol / moveCol = 1-based column of the Select checkbox / Move To dropdown. Trailing on
 *                        the reference lists; on Sort they sit at C/D (right after Ticker).
 *   company / ticker   = 0-based source column indices.
 *   tier/sector/analyst= 0-based indices to carry over when present.
 *   moveOptions        = Move To choices for this tab (defaults to MOVE_OPTIONS).
 *   note(rowArray)     = context string carried into the destination's Note.            */
var MOVABLE = {
  'Sort': { company: 0, ticker: 1, tier: 10, sector: 11, analyst: 7, selectCol: 3, moveCol: 4,
    moveOptions: SORT_MOVE_OPTIONS, note: function (r) { return String(r[13] || ''); } },
  'Excluded': { company: 0, ticker: 1, selectCol: 5, moveCol: 6, note: function (r) {
    return 'From Excluded: ' + r[3] + ' (' + r[2] + ')'; } },
  'Watchlist': { company: 0, ticker: 1, tier: 6, sector: 11, analyst: 4, selectCol: 14, moveCol: 15,
    note: function (r) { return String(r[8] || r[5] || ''); } },
  'FR Exclude': { company: 0, ticker: 1, tier: 6, analyst: 4, selectCol: 11, moveCol: 12,
    note: function (r) { return String(r[8] || ''); } },
  'Confirmed Exclude': { company: 0, ticker: 1, tier: 6, analyst: 4, selectCol: 11, moveCol: 12,
    note: function (r) { return String(r[8] || ''); } }
};
var TIER_OPTIONS = ['1A', '1B', '2', '3'];
var PUREPLAY_OPTIONS = ['Yes', 'No'];
var PROFILE_STATUS_OPTIONS = ['Active', 'Watchlist - Deleted Profile'];
var ACTION_STATUS_OPTIONS = ['Complete', 'JF Approved Active', 'JF Approved Inactive',
  'JF to Confirm Active - New Profiles', 'JF to Review/Mark Inactive',
  'PS to Confirm Active - New Profiles', 'PS to Review/Mark Inactive',
  'TG to Mark PS Confirm - New Profiles', 'TG to Review', 'AlphaSense Macro (New Profiles)'];
// Profiles surfaced by this macro are, by definition, new AlphaSense-macro profiles, so their
// Action Status (Kintone Upload col D) is always this. Used as the staging default + build fallback.
var ACTION_STATUS_DEFAULT = 'AlphaSense Macro (New Profiles)';

/* Profile free-text fields are seeded with these labels so they are consistent regardless
 * of who fills them - interns write after the colon. */
var DESC_PREFIX = 'BUSINESS DESCRIPTION:';
var RATIONALE_PREFIX = 'INCLUSION RATIONALE:';
var TIER_RATIONALE_PREFIX = 'TIER RATIONALE:';
var SECTOR_OPTIONS = [
  'Trademark/Intellectual Property', 'Software Providers', 'Professional Services',
  'Pre-Acquisition SPAC', 'Mining', 'Issuer', 'Holders', 'Hardware Manufacturers',
  'Financial Services/Fintech', 'Exchanges/Platforms', 'Energy Providers',
  'DA - Options Based Strategy ETP', 'DA - Exchange Traded Fund (ETF)',
  'DA - Exchange Traded Note (ETN)', 'DA - Closed-end Fund (CEF)',
  'DA & DARB - Exchange Traded Fund (ETF)', 'DA & DARB - Exchange Traded Note (ETN)',
  'DA & DARB - Closed-end Fund (CEF)', 'DARB - Exchange Traded Fund (ETF)',
  'DARB - Exchange Traded Note (ETN)', 'DARB - Closed-end Fund (CEF)',
  'Custody & Administration', 'Blockchain Developers', 'DA - Futures', 'Fund of Funds'
];

/* ===================== TIER / SECTOR RULE ENGINE =====================
 * Ported from the Kintone client logic (dropdownRules.js + tierRationaleConfig.js).
 * Field codes -> sheet columns (resolved by header name, never by index):
 *   Drop_down_2 (Tier)      = 'CRBM Tier' | 'If Add Recomended Tier'
 *   Drop_down_3 (Sector)    = 'Sector' | 'Recomended Sector'
 *   Drop_down_18 (Yes/No)   = 'Pure-Play'
 *   Text_area_0 (Inclusion) = 'Inclusion Rationale'
 *   Text_area_1 (Tier rat.) = 'Tiering Rationale'
 * Rules run on edits to Tier or Sector across Sort / intern / Adds / Kintone Upload.
 * (Drop_down_19/Drop_down_10 Table_1 cascade stays Kintone-only - no sheet subtable.) */

/* Sector -> Tier mapping (Rule 1). Verbatim from dropdownRules.dropdown3To2Mapping. */
var SECTOR_TO_TIER = {
  '1A': [
    'DA - Exchange Traded Fund (ETF)',
    'DA - Exchange Traded Note (ETN)',
    'DA - Closed-end Fund (CEF)',
    'DA & DARB - Exchange Traded Fund (ETF)',
    'DA & DARB - Exchange Traded Note (ETN)',
    'DA & DARB - Closed-end Fund (CEF)',
    'DA - Futures'
  ],
  '1B': [
    'DA - Options Based Strategy ETP',
    'Fund of Funds',
    'DARB - Closed-end Fund (CEF)',
    'DARB - Exchange Traded Note (ETN)',
    'DARB - Exchange Traded Fund (ETF)'
  ],
  '2': ['Pre-Acquisition SPAC']
};

/* Rationale boilerplate (Rule 3). Strings are VERBATIM from tierRationaleConfig.js -
 * edit here to change wording; do not reformat. */
var TIER_RATIONALE_CONFIG = {
  ETP_FUND_SECTORS: [
    'DA - Exchange Traded Fund (ETF)',
    'DA - Exchange Traded Note (ETN)',
    'DA - Closed-end Fund (CEF)',
    'DA - Options Based Strategy ETP',
    'DA & DARB - Exchange Traded Fund (ETF)',
    'DA & DARB - Exchange Traded Note (ETN)',
    'DA & DARB - Closed-end Fund (CEF)',
    'DARB - Exchange Traded Fund (ETF)',
    'DARB - Exchange Traded Note (ETN)',
    'DARB - Closed-end Fund (CEF)',
    'Fund of Funds'
  ],
  FUTURES_SECTORS: ['DA - Futures'],
  COMPANY: {
    '1A': {
      inclusion: 'INCLUSION RATIONALE: Research has confirmed that the company either (1) holds cryptocurrency, (2) conducts operations or has stated its intent to conduct operations that derive revenue from the digital asset ecosystem.',
      tier: 'TIER RATIONALE: The company directly (1) holds cryptocurrency and/or (2) engages in "coin-touching" operations. Therefore, qualifies for Tier 1A.'
    },
    '1B': {
      inclusion: 'INCLUSION RATIONALE: Research has confirmed that the company either (1) holds cryptocurrency, (2) conducts operations or has stated its intent to conduct operations that derive revenue from the digital asset ecosystem.',
      tier: 'TIER RATIONALE: The company, through a subsidiary or investment, indirectly (1) holds cryptocurrency and/or (2) engages in "coin-touching" operations. However, there is no evidence to suggest that it directly does this itself. Therefore, qualifies for Tier 1B.'
    },
    '2': {
      inclusion: 'INCLUSION RATIONALE: Research has confirmed that the company either (1) holds cryptocurrency, (2) conducts operations or has stated its intent to conduct operations that derive revenue from the digital asset ecosystem.',
      tier: 'TIER RATIONALE: There is no evidence to suggest that the company directly or indirectly (1) holds cryptocurrency and/or (2) engages in "coin-touching" operations. Additionally, the company\'s involvement in the digital asset ecosystem (1) constitutes a substantial revenue source, relative to its overall business and/or (2) the company commits, intends or focuses on digital assets becoming a substantial revenue source. Therefore, qualifies for Tier 2.'
    },
    '3': {
      inclusion: 'INCLUSION RATIONALE: Research has confirmed that the company either (1) holds cryptocurrency, (2) conducts operations or has stated its intent to conduct operations that derive revenue from the digital asset ecosystem.',
      tier: 'TIER RATIONALE: There is no evidence to suggest that the company directly or indirectly (1) holds cryptocurrency and/or (2) engages in "coin-touching" operations. Additionally, the company\'s involvement in the digital asset ecosystem does not constitute a substantial revenue source, relative to its overall business. Therefore, qualifies for Tier 3.'
    }
  },
  FUTURES: {
    '1A': {
      inclusion: 'INCLUSION RATIONALE: DA - Futures',
      tier: 'TIER RATIONALE: The Fund or ETP invests in spot cryptocurrency or related derivatives directly and therefore qualifies as a Tier 1A DARB.'
    }
  },
  ETP_FUND: {
    '1A': {
      inclusion: 'INCLUSION RATIONALE: All digital asset-themed Funds and ETPs qualify for inclusion.',
      tier: 'TIER RATIONALE: The Fund or ETP invests in spot cryptocurrency or related derivatives directly and therefore qualifies as a Tier 1A DARB.'
    },
    '1B': {
      inclusion: 'INCLUSION RATIONALE: All digital asset-themed Funds and ETPs qualify for inclusion.',
      tier: 'TIER RATIONALE: The Fund or ETP invests in digital asset related businesses (DARBs) and has no direct investment in spot cryptocurrency. Therefore it qualifies as a Tier 1B DARB.'
    }
  }
};
/* Tabs the rule engine runs on (plus any intern/analyst tab, matched separately). */
var RULE_TAB_NAMES = ['Sort', 'Adds', 'Kintone Upload'];
var BORDER_COLOR = '#d9d9d9';
var HEADER_TEAL = '#0e6e6e';   // dark teal header fill (white bold text)
var BAND_TEAL = '#e4f3f1';     // light teal alternating band

/* Sheet-tab colours, grouped by role so the workbook reads at a glance. */
var TAB_COLOR = {
  action: '#0e6e6e',      // weekly working tabs (Clean Pull, Sort, Review, ...)
  reference: '#127a7a',   // reference data (Current DB, Watchlist, exclude lists)
  output: '#0b8043',      // deliverables (Adds, Kintone Upload)
  audit: '#999999',       // logs / settings
  intern: '#1aa39a',      // per-analyst review tabs (named by first name)
  guide: '#8e44ad'        // operator dashboard / guide
};
var TAB_ROLE = {
  'Clean Pull': 'action', 'Sort': 'action',
  'Excluded': 'action',
  'Current DB': 'reference', 'Watchlist': 'reference', 'FR Exclude': 'reference',
  'Confirmed Exclude': 'reference', 'No Ticker Reference': 'reference',
  'Adds': 'output', 'Kintone Upload': 'output',
  'History Log': 'audit',
  'Dashboard': 'guide'
};
/* Audit tabs the Utilities menu can hide (Config kept visible - it holds an editable setting). */
var AUDIT_TAB_NAMES = ['History Log'];
/* Tabs retired by the redesign - auto-deleted on scaffold (drift now lives on Sort; the two
 * Kintone tabs are replaced by the single Kintone Upload tab; In DB Log / Stats audit tabs
 * removed). */
var OBSOLETE_TABS = ['Attention - DB Drift', 'Kintone Profiles', 'Kintone Source Docs', 'Review',
  'In DB Log', 'Stats'];
/* Tabs fully regenerated from source (Crosscheck / Build). On a forced rescaffold, if the column
 * layout changed, the stale body is cleared so old rows don't sit misaligned under new headers. */
var REGEN_TABS = { 'Sort': true, 'Excluded': true, 'Clean Pull': true, 'Kintone Upload': true };

/* The single "Dashboard" tab merges three former tabs: the pipeline-step status table (top),
 * the editable Settings block (middle), and the operating-workflow guide (bottom). */
var DASHBOARD_NAME = 'Dashboard';
/* Editable settings shown in the Dashboard's Settings block (label, default). Read by label. */
var CONFIG_DEFAULTS = [
  ['Exclude pull tickers containing (comma-separated, e.g. .IN)', '.IN'],
  ['Re-review tickers older than (days)', 365],
  ['Resurface tickers with no reviewed date (Yes/No)', 'No']
];
/* Operator dashboard: the numbered pipeline steps tracked on the Dashboard's status table. */
var PIPELINE_STEPS = [
  '1. Refresh DB References',
  '2. Import Pull Files',
  '3. Run Crosscheck',
  '4. Distribute Selected to Interns',
  '5. Clean-up This Intern Tab',
  '6. Process Reviews',
  '7. Build Kintone Upload',
  '8. Download Kintone Upload CSV'
];
/* logHistory_ action -> the pipeline step it completes (drives the Status tab Done marks). */
var STEP_BY_ACTION = {
  'Refresh DB References': '1. Refresh DB References',
  'Build Clean Pull': '2. Import Pull Files',
  'Run Crosscheck': '3. Run Crosscheck',
  'Distribute Selected': '4. Distribute Selected to Interns',
  'Clean-up This Tab': '5. Clean-up This Intern Tab',
  'Process Reviews': '6. Process Reviews',
  'Build Kintone Upload': '7. Build Kintone Upload'
};

var REF_SCHEMA = ['Company Name', 'AlphaSense Ticker', 'Review Assignement',
  'Ticker Reviewed Date', 'Analyst', 'Ps Note', 'If Add Recomended Tier',
  'Source', 'Note', 'Ticker Flag'];

var TABS = {
  currentDb: { name: 'Current DB', header: ['Primary Business Name', 'AlphaSense Ticker',
    'Profile Status', 'CRBM Tier', 'Analyst', 'Ps Note', 'If Add Recomended Tier',
    'Source', 'Note', 'Ticker Flag', 'Record Number', 'Sector', 'ISIN'] },
  watchlist: { name: 'Watchlist', header: REF_SCHEMA.concat(['Record Number', 'Sector', 'ISIN', 'Select', 'Move To']) },
  frExclude: { name: 'FR Exclude', header: REF_SCHEMA.concat(['Select', 'Move To']) },
  confirmedExclude: { name: 'Confirmed Exclude', header: REF_SCHEMA.concat(['Select', 'Move To']) },
  noTicker: { name: 'No Ticker Reference', header: ['Company Name', 'Source Bucket',
    'Record Number', 'Sector'] },
  adds: { name: 'Adds', header: ['Imported?', 'Select', 'Analyst', 'New Record Flag',
    'AS Business Name', 'Primary Business Name', 'AlphaSense Ticker',
    'Profile Review - Action Status', 'CRBM Tier', 'Pure-Play', 'Sector',
    'Primary Business Description', 'Inclusion Rationale', 'Tiering Rationale', 'Folder Name',
    'Website URLs', 'Source Documents'] },
  /* Single merged Kintone bulk-upload tab - column order is the integration contract (matches
     the KINTONE uPLOAD FORMAT template). Cols 1-12 = parent profile (incl. Analyst + Tiering
     Rationale); 13-14 = Website subtable (pink); 15-19 = Source Documents subtable (yellow).
     See KINTONE_FORMAT.md. */
  kintoneUpload: { name: 'Kintone Upload', header: ['New record flag', 'Primary Business Name',
    'AlphaSense Ticker', 'Analyst', 'Profile Review - Action Status', 'CRBM Tier', 'Pure-Play',
    'Sector', 'Primary Business Description', 'Inclusion Rationale', 'Tiering Rationale', 'Folder Name',
    'Website Type', "Website URL's", 'Added to BOX', 'Source Document Name', 'Note Per SD',
    'Source URL', 'Date'] },
  cleanPull: { name: 'Clean Pull', header: ['Company Name (AlphaSense)',
    'AlphaSense Ticker', 'CIK', 'ISIN', 'MCAP ($)', 'Region', 'Domicile Country'] },
  sort: { name: 'Sort', header: ['Company Name (AlphaSense)', 'Ticker', 'Select', 'Move To',
    'Assign To', 'Review Assignement', 'Ticker Reviewed Date', 'Analyst', 'Inclusion Rationale',
    'Tiering Rationale', 'If Add Recomended Tier', 'Recomended Sector', 'Source', 'Note'] },
  excluded: { name: 'Excluded', header: ['Company Name (AlphaSense)', 'Ticker',
    'Matched Source List', 'Match Type', 'Select', 'Move To'] },
  history: { name: 'History Log', header: ['Timestamp', 'Action', 'Source', 'Details'] }
};

/* Intern row layout (0-based). The analyst fills everything needed to build the Kintone
   Upload file (description, pure-play, websites, structured source docs):
   0 Company (AlphaSense) | 1 Ticker | 2 RevAssign | 3 RevDate | 4 Analyst |
   5 Primary Business Name | 6 Primary Business Description | 7 Inclusion Rationale |
   8 Tiering Rationale | 9 If Add Recomended Tier | 10 Recomended Sector | 11 Pure-Play |
   12 Website URLs | 13 Source Documents | 14 Source | 15 Note | 16 Date Assigned | 17 Due Date
   Website URLs: one "Type | URL" per line.  Source Documents: one "Name | Note | URL | Date"
   per line.                                                                             */
var INTERN_HEADER = ['Company Name (AlphaSense)', 'Ticker', 'Review Assignement',
  'Ticker Reviewed Date', 'Analyst', 'Primary Business Name', 'Primary Business Description',
  'Inclusion Rationale', 'Tiering Rationale', 'If Add Recomended Tier', 'Recomended Sector',
  'Pure-Play', 'Website URLs', 'Source Documents', 'Source', 'Note', 'Date Assigned', 'Due Date'];
var INTERN_WIDTH = INTERN_HEADER.length; // 18

/* Exact Kintone user names - the Assign To options and the "Analyst" value uploaded to Kintone.
 * Must match Kintone verbatim. Edit here if the Kintone users change. */
var ANALYST_OPTIONS = ['Ethan Guys', 'Isaac M', 'Mel Dapanas', 'Jaypee Ollos',
  'Luciana Villarreal Romero', 'Jim', 'Kyle', 'Peter', 'Tamara', 'Product Team', 'Jacie Specht'];
/* Per-analyst review tabs are named by FIRST NAME (e.g. "Peter", "Ethan"); the full Kintone name
 * is carried in each row's Analyst column. ANALYST_BY_FIRST maps a tab's first name back to the
 * full Kintone name (first names must stay unique across ANALYST_OPTIONS). */
function analystFirst_(name) { return String(name).trim().split(/\s+/)[0]; }
var ANALYST_BY_FIRST = (function () {
  var m = {};
  ANALYST_OPTIONS.forEach(function (n) { m[analystFirst_(n)] = n; });
  return m;
})();
/* Standing review tabs auto-created on scaffold. Empty = create a "<First name>" tab on demand
 * the first time a row is distributed to that analyst. */
var DEFAULT_INTERNS = [];

/* ================================ MENU / SCAFFOLDING ================================ */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('DARB Pipeline')
    .addItem('1. Refresh DB References', 'showRefreshDialog')
    .addItem('2. Import Pull Files (CSV / XLSX)', 'showCsvImportDialog')
    .addItem('3. Run Crosscheck', 'runCrosscheck')
    .addSeparator()
    .addItem('4. Distribute Selected to Interns', 'distributeSelected')
    .addItem('5. Clean-up This Intern Tab', 'cleanupActiveTab')
    .addItem('6. Process Reviews (backstop)', 'processReviews')
    .addSeparator()
    .addItem('Move selected rows between lists', 'moveSelected')
    .addSeparator()
    .addItem('7. Build Kintone Upload', 'buildKintoneUpload')
    .addItem('8. Download Kintone Upload CSV', 'downloadKintoneUploadCsv')
    .addItem('Clear Adds (after Kintone import)', 'clearAdds')
    .addSeparator()
    .addSubMenu(ui.createMenu('Utilities')
      .addItem('Build Clean Pull (manual rebuild)', 'buildCleanPull')
      .addItem('Import legacy Watchlist (one-time)', 'showWatchlistImportDialog')
      .addItem('Rescaffold / Restyle Tabs', 'rescaffold')
      .addItem('Start New Cycle (reset step checkmarks)', 'startNewCycle')
      .addSeparator()
      .addItem('Re-apply Tier/Sector rules (active tab)', 'reapplyTierRules')
      .addItem('Check Tier/Sector rules (active tab)', 'checkTierRules')
      .addSeparator()
      .addItem('Hide audit + log tabs', 'hideAuditTabs')
      .addItem('Show all tabs', 'showAllTabs'))
    .addToUi();
  scaffoldAll_();
}

function rescaffold() {
  scaffoldAll_(true);
  forceMoveCheckboxes_(Object.keys(MOVABLE));
  toast_('Tabs rescaffolded.');
}

function scaffoldAll_(force) {
  removeObsoleteTabs_();
  migrateInternTabNames_();
  Object.keys(TABS).forEach(function (k) { ensureTab_(TABS[k], force === true); });
  ensureDashboardTab_(force === true);
  ensureDefaultInternTabs_();
  scaffoldInternSheets_(force === true);
  refreshSortValidations_();
  refreshAddsValidations_();
  scaffoldMoveColumns_();
  setCaptureHints_();
  setTabHelp_();
  colorTabs_();
  ensureEditTrigger_();   // install the live Tier/Sector onEdit automation (idempotent)
}

/** Delete tabs retired by the redesign - their data now lives on Sort (Attention drift) and
 *  the single Kintone Upload tab. Skips a tab that can't be deleted (e.g. the active sheet);
 *  it clears on the next reload when another tab is active. */
function removeObsoleteTabs_() {
  var ss = SpreadsheetApp.getActive();
  OBSOLETE_TABS.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh && ss.getSheets().length > 1) {
      try { ss.deleteSheet(sh); } catch (e) { /* active/last sheet - removed on next reload */ }
    }
  });
}

/* ===================== OPERATOR STATUS / WORKFLOW =================================== */

/** The merged Dashboard tab (status table + Settings + workflow guide). */
function dashboardSheet_() { return SpreadsheetApp.getActive().getSheetByName(DASHBOARD_NAME); }

/** 1-based row of a pipeline step in the Dashboard status table, or 0. */
function dashboardStepRow_(sh, label) {
  if (!sh) return 0;
  var lr = sh.getLastRow();
  if (lr < 1) return 0;
  var col = sh.getRange(1, 1, lr, 1).getValues();
  for (var i = 0; i < col.length; i++) if (String(col[i][0]) === label) return i + 1;
  return 0;
}

/** Stamp a step's status row: Last Run = now, Result, Done This Cycle = check. */
function markStep_(label, result) {
  var sh = dashboardSheet_();
  var row = dashboardStepRow_(sh, label);
  if (!row) return;
  sh.getRange(row, 2, 1, 3).setValues([[new Date(), String(result || ''), '✓']]);
}

/** Warn-and-confirm guard: if the immediately-prior pipeline step has not run this cycle,
 *  ask before proceeding. Re-running an already-done step is never blocked. n = step number. */
function stepGuard_(n) {
  if (n <= 1) return true;
  var prior = PIPELINE_STEPS[n - 2];
  var sh = dashboardSheet_();
  var row = dashboardStepRow_(sh, prior);
  if (!row) return true;                                       // status not ready -> don't block
  if (String(sh.getRange(row, 4).getValue() || '').trim()) return true; // prior step done
  var ui = SpreadsheetApp.getUi();
  return ui.alert('Run out of order?',
    'Step ' + (n - 1) + ' "' + prior + '" has not run this cycle.\n\n' +
    'Continue with step ' + n + ' "' + PIPELINE_STEPS[n - 1] + '" anyway?',
    ui.ButtonSet.YES_NO) === ui.Button.YES;
}

/** Utilities action: clear the Done-This-Cycle checks to start a fresh weekly cycle. */
function startNewCycle() {
  var sh = dashboardSheet_();
  if (sh) {
    PIPELINE_STEPS.forEach(function (label) {
      var row = dashboardStepRow_(sh, label);
      if (row) sh.getRange(row, 4).clearContent();
    });
  }
  logHistory_('Start New Cycle', DASHBOARD_NAME, 'Cleared step completion checks');
  toast_('New cycle started - step checkmarks cleared.');
}

var WORKFLOW_LINES = [
  'DARB Pipeline - Operating Workflow',
  '',
  'Run these from the "DARB Pipeline" menu, in order. The status table at the top of this',
  'Dashboard tab shows which steps have run this cycle (Last Run, Result, Done This Cycle).',
  '',
  '1. Refresh DB References - upload the latest Kintone export (.xlsx). Rebuilds Current DB and',
  '   merges the Watchlist (locally added rows kept; rows now Active graduate off).',
  '2. Import Pull Files - upload AlphaSense Search Summary exports (CSV/XLSX). Builds Clean Pull.',
  '3. Run Crosscheck - sorts Clean Pull into Sort and Excluded (already tracked). New names',
  '   AND near-matches both land on Sort: near-matches are tagged "Review" in the Source',
  '   column (matched name in the Note); DB-drift cases tagged "DB Drift". No separate Review tab.',
  '4. Distribute Selected to Interns - on the Sort tab, tick Select, then either:',
  '     - set Assign To (an analyst) and run Distribute, to hand the row to that analyst (a review tab named by first name); or',
  '     - set Move To (Watchlist / FR Exclude / Confirmed Exclude / Remove) and run "Move selected',
  '       rows between lists" to file it directly - no analyst needed (e.g. an obvious non-DARB name).',
  '5. Clean-up This Intern Tab - open your review tab (your first name), set Review Assignement per row',
  '   (Add / Watchlist / FR Exclude / Confirmed Exclude / In DB), then run to route them.',
  '6. Process Reviews - backstop sweep that routes eligible rows across ALL intern tabs.',
  '7. Build Kintone Upload - formats qualified Adds into the single "Kintone Upload" tab.',
  '8. Download Kintone Upload CSV - download it and import into Kintone.',
  '   After importing, run "Clear Adds" to empty the Adds tab for the next batch.',
  '',
  'Analyst capture formats (on your review tab):',
  '   Website URLs - one per line:   Type | URL',
  '        e.g.   Website | https://company.com        Exchange | https://exchange.com/quote/...',
  '   Source Documents - one per line:   Name | Note | URL | Date',
  '        e.g.   PR - Launch | Added Press Release | https://company.com/pr | 2026-06-09',
  '',
  'Tips:',
  '   - Utilities > Start New Cycle clears the step checkmarks for a fresh week.',
  '   - Utilities > Rescaffold / Restyle Tabs repairs headers, dropdowns and formatting.',
  '   - Reference docs in the repo: PROCESS.md, KINTONE_FORMAT.md, ENGINEERING_HANDOFF.md.'
];

/** Build / refresh the single "Dashboard" tab: status table (top), Settings (middle), workflow
 *  guide (bottom). A normal scaffold leaves an existing dashboard untouched (preserving status
 *  state + edited settings); force rebuilds while preserving those. On first build it migrates the
 *  legacy Pipeline Status / Config / Workflow tabs, then deletes them. */
function ensureDashboardTab_(force) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(DASHBOARD_NAME);
  var built = sh && String(sh.getRange(1, 1).getValue()).trim() !== '';

  if (built) deleteLegacyDashboardTabs_();   // data already migrated - clean up any stragglers
  if (built && !force) return;

  // Preserve dynamic state: per-step status + edited settings. Read the existing dashboard first,
  // then the legacy tabs (migration) - the first value seen for a key wins.
  var statusState = {}, configState = {};
  readDashboardState_(sh, statusState, configState);
  readDashboardState_(ss.getSheetByName('Pipeline Status'), statusState, configState);
  readDashboardState_(ss.getSheetByName('Config'), statusState, configState);

  var isNew = !sh;
  if (!sh) sh = ss.insertSheet(DASHBOARD_NAME);
  sh.clear();
  sh.clearNotes();
  var maxR = sh.getMaxRows(), maxC = sh.getMaxColumns();
  if (maxR >= 1) sh.getRange(1, 1, maxR, maxC).clearDataValidations();

  buildDashboardLayout_(sh, statusState, configState);
  if (isNew) { try { ss.setActiveSheet(sh); ss.moveActiveSheet(1); } catch (e) { /* limited auth */ } } // dashboard leads
  deleteLegacyDashboardTabs_();              // legacy tabs now merged in
  return sh;
}

/** Delete the former Pipeline Status / Config / Workflow tabs. Skips any that is currently the
 *  active sheet (can't delete it now) - the next scaffold removes it. */
function deleteLegacyDashboardTabs_() {
  var ss = SpreadsheetApp.getActive();
  ['Pipeline Status', 'Config', 'Workflow'].forEach(function (n) {
    var old = ss.getSheetByName(n);
    if (old && ss.getSheets().length > 1) {
      try { ss.deleteSheet(old); } catch (e) { /* active sheet - retry next scaffold */ }
    }
  });
}

/** Scan a sheet for pipeline-step status rows + setting rows; fill the maps (first value wins). */
function readDashboardState_(sh, statusState, configState) {
  if (!sh) return;
  var lr = sh.getLastRow();
  if (lr < 1) return;
  var w = Math.min(Math.max(sh.getLastColumn(), 2), 4);
  sh.getRange(1, 1, lr, w).getValues().forEach(function (r) {
    var key = String(r[0]).trim();
    if (!key) return;
    if (PIPELINE_STEPS.indexOf(key) >= 0) {
      if (statusState[key] === undefined) statusState[key] = [r[1], r[2] || '', r[3] || ''];
    } else {
      for (var i = 0; i < CONFIG_DEFAULTS.length; i++) {
        if (key === CONFIG_DEFAULTS[i][0] && configState[key] === undefined &&
            String(r[1]).trim() !== '') configState[key] = r[1];
      }
    }
  });
}

/** Lay out the Dashboard: status table (rows 1..N+1), Settings block, then the workflow guide. */
function buildDashboardLayout_(sh, statusState, configState) {
  var data = [['Step', 'Last Run', 'Result', 'Done This Cycle']];        // 1: status header
  PIPELINE_STEPS.forEach(function (s) {
    var st = statusState[s] || ['', '', ''];
    data.push([s, st[0] || '', st[1] || '', st[2] || '']);
  });
  data.push(['', '', '', '']);                                           // spacer
  var settingsTitleRow = data.length + 1;                               // 1-based
  data.push(['Settings - edit the Value column only', '', '', '']);
  data.push(['Setting', 'Value', '', '']);
  CONFIG_DEFAULTS.forEach(function (d) {
    data.push([d[0], (configState[d[0]] !== undefined ? configState[d[0]] : d[1]), '', '']);
  });
  data.push(['', '', '', '']);                                           // spacer
  var guideTitleRow = data.length + 1;                                  // 1-based
  WORKFLOW_LINES.forEach(function (l) { data.push([l, '', '', '']); });

  sh.getRange(1, 1, data.length, 4).setValues(data)
    .setFontFamily('Calibri').setVerticalAlignment('top');
  sh.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground(HEADER_TEAL).setFontColor('#ffffff');
  sh.getRange(settingsTitleRow, 1, 1, 4).setBackground(BAND_TEAL);
  sh.getRange(settingsTitleRow, 1).setFontWeight('bold');
  sh.getRange(settingsTitleRow + 1, 1, 1, 2).setFontWeight('bold');     // Setting | Value sub-header
  sh.getRange(guideTitleRow, 1).setFontWeight('bold').setFontSize(13);  // guide title line
  sh.getRange(guideTitleRow, 1, WORKFLOW_LINES.length, 1).setWrap(true);
  sh.setColumnWidth(1, 520);
  sh.setColumnWidth(2, 170);
  sh.setColumnWidth(3, 230);
  sh.setColumnWidth(4, 120);
  sh.setFrozenRows(1);
  sh.getRange(1, 1).setNote(TAB_HELP[DASHBOARD_NAME] || '');
}

/** Hover hints on the free-text capture headers so analysts use the right delimiter format. */
function setCaptureHints_() {
  var ss = SpreadsheetApp.getActive();
  var webHint = 'One website per line:  Type | URL  (Type = Website or Exchange)\n' +
    'e.g.  Website | https://company.com';
  var sdHint = 'One source document per line:  Name | Note | URL | Date\n' +
    'e.g.  PR - Launch | Added Press Release | https://company.com/pr | 2026-06-09';
  getInternSheets_().forEach(function (sh) {
    sh.getRange(1, 13).setNote(webHint);   // Website URLs (col M)
    sh.getRange(1, 14).setNote(sdHint);    // Source Documents (col N)
  });
  var adds = ss.getSheetByName(TABS.adds.name);
  if (adds) {
    adds.getRange(1, 16).setNote(webHint); // Website URLs (col P)
    adds.getRange(1, 17).setNote(sdHint);  // Source Documents (col Q)
  }
}

/* Per-tab "how to use this tab" guidance - shown as a hover note on the top-left header cell
 * (hover the red corner). The Dashboard tab holds the full end-to-end guide. */
var TAB_HELP = {
  'Sort': 'TRIAGE QUEUE (built by Run Crosscheck). New names AND near-matches live here.\n' +
    '- Source "Review"   = near-match to something already tracked; read the Note, confirm new vs same.\n' +
    '- Source "DB Drift" = name/ticker changed vs the DB; update the DB or move it to a list.\n' +
    'Process a row: tick Select, then EITHER set Assign To + run Distribute (hand to an analyst),\n' +
    'OR set Move To + run "Move selected rows between lists" (file it directly - no analyst).',
  'Adds': 'STAGING for Kintone adds - one row per qualified profile (auto-created when an analyst\n' +
    'routes a Sort row to "Add"). Fill in Website URLs / Source Documents, then run Build Kintone\n' +
    'Upload. Imported? auto-ticks once the profile shows up in Current DB.',
  'Dashboard': 'HOME - the operating guide (bottom), pipeline-step status (top), and Settings.\n' +
    'Edit ONLY the Settings "Value" column; keep the Setting names unchanged:\n' +
    '- Exclude pull tickers containing: comma-separated text (e.g. .IN); pull tickers containing\n' +
    '  any of these are skipped in Crosscheck and never added to Sort.\n' +
    '- Re-review tickers older than (days): tracked tickers older than this resurface onto Sort.\n' +
    '- Resurface tickers with no reviewed date (Yes/No): include never-reviewed tickers too.\n' +
    '(Analyst names live in the script ANALYST_OPTIONS list; a tab is created on first assign.)',
  'Kintone Upload': 'OUTPUT - the bulk-upload sheet (built by Build Kintone Upload). The Profile\n' +
    'Review - Action Status column is always "AlphaSense Macro (New Profiles)"; the Analyst column\n' +
    'carries the assigned reviewer (exact Kintone name). Run Download Kintone Upload CSV, then\n' +
    'import into Kintone. Do not hand-edit - rebuild instead.',
  'Current DB': 'REFERENCE - rebuilt from the Kintone export by Refresh DB References; the source of\n' +
    'truth for "already tracked". Do not hand-edit (it is overwritten on every refresh).',
  'Watchlist': 'REFERENCE - names being monitored that are NOT yet in the DB. A row that becomes\n' +
    'Active in the DB graduates off automatically on the next refresh, so adding an already-in-DB\n' +
    'ticker here will not stick.'
};

/** Set the per-tab "how to use" hover note on each tab's top-left header cell. */
function setTabHelp_() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(TAB_HELP).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh) sh.getRange(1, 1).setNote(TAB_HELP[name]);
  });
}

/** Create tab if missing; write header if new / blank / forced. */
function ensureTab_(def, forceHeader) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(def.name);
  var isNew = false;
  if (!sh) { sh = ss.insertSheet(def.name); isNew = true; }
  if (forceHeader || isNew || sh.getRange(1, 1).getValue() === '') {
    // Regenerated-from-source tabs (Sort, Excluded, Clean Pull, Kintone Upload): if the column
    // layout changed, drop the stale body so old rows don't sit misaligned under the new headers
    // (e.g. Source landing under the Tier dropdown). They are repopulated by Crosscheck / Build.
    if (!isNew && REGEN_TABS[def.name] && sh.getLastRow() >= 2) {
      var cur = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), def.header.length)).getValues()[0];
      var changed = def.header.some(function (h, i) { return String(cur[i] || '') !== String(h); });
      if (changed) clearBody_(sh);
    }
    resetTabForHeader_(sh, def.header.length);  // wipe stale validations / old trailing headers
    sh.getRange(1, 1, 1, def.header.length).setValues([def.header]);
    applyFormat_(sh, def.header.length);
  }
  if (isNew && def.name === TABS.noTicker.name) sh.hideSheet();
  return sh;
}

/** When a tab's header is (re)written after a schema change, clear ALL stale data validations
 *  on the sheet (old dropdowns/checkboxes that would otherwise sit on the wrong columns) and
 *  blank any leftover header cells beyond the new width. The scaffolders re-apply the correct
 *  validations / checkboxes afterwards. */
function resetTabForHeader_(sh, headerLen) {
  var mr = sh.getMaxRows(), mc = sh.getMaxColumns();
  sh.getRange(1, 1, mr, mc).clearDataValidations();
  if (mc > headerLen) sh.getRange(1, headerLen + 1, 1, mc - headerLen).clearContent();
}

/** Read a Settings value from the Dashboard whose label starts with labelPrefix (case-insensitive). */
function configValue_(labelPrefix, def) {
  var sh = dashboardSheet_();
  if (sh && sh.getLastRow() >= 1) {
    var vals = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0]).toLowerCase().indexOf(labelPrefix.toLowerCase()) === 0) {
        return vals[i][1];
      }
    }
  }
  return def;
}

/** Re-review threshold in days (Config, default 365). */
function reviewThresholdDays_() {
  var n = parseInt(configValue_('re-review tickers older', 365), 10);
  return (isNaN(n) || n <= 0) ? 365 : n;
}

/** Whether tickers with no reviewed date should also resurface (Config, default No). */
function resurfaceBlank_() {
  var v = String(configValue_('resurface tickers with no reviewed', 'No')).toLowerCase().trim();
  return v === 'yes' || v === 'true' || v === 'y';
}

/** A reviewed-date is stale if older than thresholdDays; blank obeys resurfaceBlank. */
function isStale_(reviewed, thresholdDays, resurfaceBlank) {
  var d = reviewed;
  if (!(d instanceof Date)) {
    if (typeof d === 'string' && isDateish_(d)) { d = new Date(d); }
    else { return resurfaceBlank; }
  }
  if (isNaN(d.getTime())) return resurfaceBlank;
  return (Date.now() - d.getTime()) / 86400000 > thresholdDays;
}

/** Review tabs are named by analyst first name and detected via ANALYST_BY_FIRST. */
function getInternSheets_() {
  return SpreadsheetApp.getActive().getSheets().filter(function (s) {
    return ANALYST_BY_FIRST.hasOwnProperty(s.getName());   // tabs are named by analyst first name
  });
}

/** The full Kintone analyst name for a review tab (tabs are named by first name). */
function internName_(sh) { var n = sh.getName(); return ANALYST_BY_FIRST[n] || n; }

/** Ensure a "<First name>" review tab exists for each standing reviewer in DEFAULT_INTERNS.
 *  New tabs get the canonical header + table styling; scaffoldInternSheets_ then adds the
 *  dropdowns and colorTabs_ tints them. Existing tabs are left untouched. */
function ensureDefaultInternTabs_() {
  DEFAULT_INTERNS.forEach(function (name) { ensureInternTab_(name); });
}

/** Create a "<First name>" review tab if missing (standing tabs and on-demand at distribute time).
 *  Accepts a full or first name. Returns the sheet. New tabs get the canonical header, styling
 *  and intern tint; scaffoldInternSheets_ then adds the dropdowns. */
function ensureInternTab_(name) {
  var ss = SpreadsheetApp.getActive();
  var tabName = analystFirst_(name);
  var sh = ss.getSheetByName(tabName);
  if (sh) return sh;
  sh = ss.insertSheet(tabName);
  sh.getRange(1, 1, 1, INTERN_WIDTH).setValues([INTERN_HEADER]);
  applyFormat_(sh, INTERN_WIDTH);
  sh.setTabColor(TAB_COLOR.intern);
  return sh;
}

/** One-time migration: rename legacy "<Name> - Sort" tabs to just the analyst's first name. */
function migrateInternTabNames_() {
  var ss = SpreadsheetApp.getActive();
  ss.getSheets().forEach(function (s) {
    var n = s.getName();
    if (n.indexOf(RAW_PREFIX) === 0) return;
    var m = n.match(INTERN_RE);                       // "<Name> - Sort"
    if (!m) return;
    var first = analystFirst_(m[1]);
    if (first === n || ss.getSheetByName(first)) return;  // already renamed, or target name taken
    s.setName(first);
  });
}

function scaffoldInternSheets_(force) {
  var assignRule = listRule_(ASSIGN_OPTIONS);
  var tierRule = listRule_(TIER_OPTIONS);
  var sectorRule = listRule_(SECTOR_OPTIONS);
  var pureplayRule = listRule_(PUREPLAY_OPTIONS);
  getInternSheets_().forEach(function (sh) {
    var cur = sh.getRange(1, 1, 1, INTERN_WIDTH).getValues()[0];
    var headerOk = cur.every(function (v, i) { return String(v) === String(INTERN_HEADER[i]); });
    if (force || !headerOk) {
      migrateInternTab_(sh);   // rewrites header AND realigns any old-layout rows
    }
    var mr = sh.getMaxRows();
    if (mr > 1) {
      sh.getRange(2, 3, mr - 1, 1).setDataValidation(assignRule);    // Review Assignement (col 3)
      sh.getRange(2, 10, mr - 1, 1).setDataValidation(tierRule);     // If Add Recomended Tier (col 10)
      sh.getRange(2, 11, mr - 1, 1).setDataValidation(sectorRule);   // Recomended Sector (col 11)
      sh.getRange(2, 12, mr - 1, 1).setDataValidation(pureplayRule); // Pure-Play (col 12)
    }
  });
}

/** True for a Date cell, or a string that clearly reads as a date. */
function isDateish_(v) {
  if (v instanceof Date) return true;
  return typeof v === 'string' && /^\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4}/.test(v.trim());
}

/**
 * Realign one intern data row to the current 18-column layout (read at the new width).
 * Current (0-based): 0 Company | 1 Ticker | 2 RevAssign | 3 RevDate | 4 Analyst |
 *   5 Primary Business Name | 6 Description | 7 Inclusion Rationale | 8 Tiering Rationale |
 *   9 Tier | 10 Sector | 11 Pure-Play | 12 Website URLs | 13 Source Documents | 14 Source |
 *   15 Note | 16 Date Assigned | 17 Due Date
 * Two prior layouts are migrated:
 *   - 17-col (no Tiering Rationale): Due Date at 16 -> insert a blank at index 8.
 *   - 16-col: dates at 14/15, cols 8/9/10 were Website/Exchange1/Exchange2 -> collapse the
 *     three URL columns into "Type | URL" lines and insert the blank Tiering Rationale.
 */
function migrateInternRow_(r) {
  if (isDateish_(r[17])) return r;                             // already current 18-col (Due at 17)
  if (isDateish_(r[16])) {                                     // 17-col layout -> insert blank Tiering Rationale at 8
    return [r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], '',
      r[8], r[9], r[10], r[11], r[12], r[13], r[14], r[15], r[16]];
  }
  if (isDateish_(r[14]) || isDateish_(r[15])) {               // ancient 16-col layout
    var web = [];
    if (String(r[8] || '').trim()) web.push('Website | ' + String(r[8]).trim());
    if (String(r[9] || '').trim()) web.push('Exchange | ' + String(r[9]).trim());
    if (String(r[10] || '').trim()) web.push('Exchange | ' + String(r[10]).trim());
    return [r[0], r[1], r[2], r[3], r[4],
      r[0], '', r[5], '', r[6], r[7], '',                      // PBN(=AS name), Desc, InclRat, TieringRat, Tier, Sector, Pure-Play
      web.join('\n'), r[11], r[12], r[13], r[14], r[15]];      // Website URLs, SrcDocs, Source, Note, DateAssigned, Due
  }
  return r;                                                    // markers / undated rows untouched
}

/** Rewrite an intern tab's header to the canonical schema and realign its rows. */
function migrateInternTab_(sh) {
  var lr = sh.getLastRow();
  var rows = [];
  if (lr >= 2) {
    sh.getRange(2, 1, lr - 1, INTERN_WIDTH).getValues().forEach(function (r) {
      var m = migrateInternRow_(r);
      if (!String(m[0] || '').trim() && !String(m[1] || '').trim()) return; // drop blank spacers
      rows.push(m);
    });
  }
  clearBody_(sh);
  resetTabForHeader_(sh, INTERN_WIDTH);   // wipe stale validations + old trailing headers
  sh.getRange(1, 1, 1, INTERN_WIDTH).setValues([INTERN_HEADER]);
  if (rows.length) sh.getRange(2, 1, rows.length, INTERN_WIDTH).setValues(rows);
  applyFormat_(sh, INTERN_WIDTH);
  reorganizeInternTab_(sh);   // restratify pending vs routed + restore strikethrough
}

/** Dropdowns on the Sort tab: Assign To (E), Tier (K), Sector (L). */
function refreshSortValidations_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(TABS.sort.name);
  if (!sh) return;
  var lr = sh.getLastRow();
  if (lr < 2) return;
  var n = lr - 1;
  sh.getRange(2, 11, n, 1).setDataValidation(listRule_(TIER_OPTIONS));
  sh.getRange(2, 12, n, 1).setDataValidation(listRule_(SECTOR_OPTIONS));
  sh.getRange(2, 5, n, 1).setDataValidation(listRule_(ANALYST_OPTIONS)); // Assign To
}

/* ---- Tier/Sector rule engine: row-level helpers (reusable for live edits + bulk) ---- */

/** Resolve rule columns on a sheet by header name. Returns {tier,sector,inclusion,tiering,pureplay}
 *  (1-based; 0 when a column is absent) or null if Tier and Sector aren't both present. */
function ruleCols_(sh) {
  var lastCol = sh.getLastColumn();
  if (lastCol < 1) return null;
  var hdr = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  function find(names) {
    for (var i = 0; i < hdr.length; i++) if (names.indexOf(hdr[i]) >= 0) return i + 1;
    return 0;
  }
  var tier = find(['CRBM Tier', 'If Add Recomended Tier']);
  var sector = find(['Sector', 'Recomended Sector']);
  if (!tier || !sector) return null;
  return { tier: tier, sector: sector,
    inclusion: find(['Inclusion Rationale']),
    tiering: find(['Tiering Rationale']),
    pureplay: find(['Pure-Play']) };
}

/** True if a tab participates in the rule engine (the three named tabs + any analyst tab). */
function isRuleTab_(name) {
  return RULE_TAB_NAMES.indexOf(name) >= 0 || ANALYST_BY_FIRST.hasOwnProperty(name);
}

/** Tier for a sector via the Rule 1 mapping ('' if none). */
function tierForSector_(sector) {
  for (var t in SECTOR_TO_TIER) {
    if (SECTOR_TO_TIER.hasOwnProperty(t) && SECTOR_TO_TIER[t].indexOf(sector) >= 0) return t;
  }
  return '';
}

/** Rationale {inclusion,tier} for a Tier+Sector, or null. Mirrors the Kintone updateRationale order. */
function rationaleFor_(tier, sector) {
  if (!tier) return null;
  var c = TIER_RATIONALE_CONFIG, r;
  if (sector && c.FUTURES_SECTORS.indexOf(sector) >= 0) r = c.FUTURES[tier] || c.COMPANY[tier];
  else if (sector && c.ETP_FUND_SECTORS.indexOf(sector) >= 0) r = c.ETP_FUND[tier] || c.COMPANY[tier];
  else r = c.COMPANY[tier];
  return r || null;
}

/** Rule 1: Sector -> Tier. */
function applySectorToTier_(sh, row, cols) {
  var sector = String(sh.getRange(row, cols.sector).getValue()).trim();
  if (!sector) return;
  var tier = tierForSector_(sector);
  if (tier) sh.getRange(row, cols.tier).setValue(tier);
}

/** Rule 2: Tier -> Pure-Play (Drop_down_18). 2 -> Yes, 3 -> No. No-op if no Pure-Play column (Sort). */
function applyTierToPurePlay_(sh, row, cols) {
  if (!cols.pureplay) return;
  var tier = String(sh.getRange(row, cols.tier).getValue()).trim();
  if (tier === '2') sh.getRange(row, cols.pureplay).setValue('Yes');
  else if (tier === '3') sh.getRange(row, cols.pureplay).setValue('No');
}

/** Rule 3: Tier + Sector -> Inclusion + Tiering rationale. Tier must be set; clears both if no match. */
function applyRationale_(sh, row, cols) {
  if (!cols.inclusion || !cols.tiering) return;
  var tier = String(sh.getRange(row, cols.tier).getValue()).trim();
  if (!tier) return;
  var sector = String(sh.getRange(row, cols.sector).getValue()).trim();
  var r = rationaleFor_(tier, sector);
  if (r) {
    sh.getRange(row, cols.inclusion).setValue(r.inclusion);
    sh.getRange(row, cols.tiering).setValue(r.tier);
  } else {
    sh.getRange(row, cols.inclusion).clearContent();
    sh.getRange(row, cols.tiering).clearContent();
  }
}

/** Apply every row-level rule to one row (bulk re-apply + upload prep). */
function applyRowRules_(sh, row, cols) {
  applySectorToTier_(sh, row, cols);
  applyTierToPurePlay_(sh, row, cols);
  applyRationale_(sh, row, cols);
}

/** Installable onEdit: live Tier/Sector automation on the rule tabs. Never throws. */
function onSheetEdit_(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (!isRuleTab_(sh.getName())) return;
    var row = e.range.getRow();
    if (row < 2 || e.range.getNumRows() > 1 || e.range.getNumColumns() > 1) return; // single data cell
    var cols = ruleCols_(sh);
    if (!cols) return;
    var col = e.range.getColumn();
    if (col === cols.sector) { applySectorToTier_(sh, row, cols); applyRationale_(sh, row, cols); }
    else if (col === cols.tier) { applyTierToPurePlay_(sh, row, cols); applyRationale_(sh, row, cols); }
  } catch (err) { /* edit triggers must stay silent */ }
}

/** Create the installable onEdit trigger once (idempotent). Swallows limited-auth failures
 *  (e.g. when called from onOpen) - it installs on the next authorized menu action. */
function ensureEditTrigger_() {
  try {
    var exists = ScriptApp.getProjectTriggers().some(function (t) {
      return t.getHandlerFunction() === 'onSheetEdit_';
    });
    if (!exists) {
      ScriptApp.newTrigger('onSheetEdit_').forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
    }
  } catch (err) { /* installs later under full auth */ }
}

/** Bulk: re-apply all rules to every data row of a sheet (reusable before Kintone upload). */
function applyAllRulesToSheet_(sh) {
  var cols = ruleCols_(sh);
  if (!cols) return 0;
  var lr = sh.getLastRow();
  if (lr < 2) return 0;
  for (var row = 2; row <= lr; row++) applyRowRules_(sh, row, cols);
  return lr - 1;
}

/** Menu: re-apply Tier/Sector rules across the active rule tab. */
function reapplyTierRules() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (!isRuleTab_(sh.getName())) { toast_('Open Sort, Adds, Kintone Upload or an analyst tab first.'); return; }
  var n = applyAllRulesToSheet_(sh);
  restyleTabs_([sh.getName()]);
  logHistory_('Re-apply Tier Rules', sh.getName(), n + ' row(s) processed');
  toast_('Re-applied Tier/Sector rules to ' + n + ' row(s).');
}

/** Menu / Rule 5: flag rows whose Tier/Sector/Pure-Play violate the mapping (surface, don't block). */
function checkTierRules() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (!isRuleTab_(sh.getName())) { toast_('Open Sort, Adds, Kintone Upload or an analyst tab first.'); return; }
  var cols = ruleCols_(sh);
  if (!cols) { toast_('No Tier/Sector columns on this tab.'); return; }
  var lr = sh.getLastRow();
  if (lr < 2) { toast_('Nothing to check.'); return; }
  var vals = sh.getRange(2, 1, lr - 1, sh.getLastColumn()).getValues();
  var issues = [];
  vals.forEach(function (r, i) {
    var tier = String(r[cols.tier - 1] || '').trim();
    var sector = String(r[cols.sector - 1] || '').trim();
    var pp = cols.pureplay ? String(r[cols.pureplay - 1] || '').trim() : '';
    var label = String(r[0] || '').trim() || ('Row ' + (i + 2));
    if (sector) {
      var expect = tierForSector_(sector);
      if (expect && tier !== expect) {
        issues.push('Row ' + (i + 2) + ' (' + label + '): Sector "' + sector + '" expects Tier ' +
          expect + ', has "' + (tier || 'blank') + '"');
      }
    }
    if (cols.pureplay && tier === '2' && pp !== 'Yes') {
      issues.push('Row ' + (i + 2) + ' (' + label + '): Tier 2 needs Pure-Play "Yes", has "' + (pp || 'blank') + '"');
    }
    if (cols.pureplay && tier === '3' && pp !== 'No') {
      issues.push('Row ' + (i + 2) + ' (' + label + '): Tier 3 needs Pure-Play "No", has "' + (pp || 'blank') + '"');
    }
  });
  if (!issues.length) { SpreadsheetApp.getUi().alert('Tier/Sector check: no issues on "' + sh.getName() + '".'); return; }
  var shown = issues.slice(0, 30).join('\n');
  SpreadsheetApp.getUi().alert('Tier/Sector check - ' + issues.length + ' issue(s) on "' + sh.getName() + '":\n\n' +
    shown + (issues.length > 30 ? '\n\n...and ' + (issues.length - 30) + ' more.' : ''));
}

/** Dropdowns on the Adds tab: Action Status (H), CRBM Tier (I), Pure-Play (J), Sector (K);
 *  Imported? + Select checkboxes (A, B). */
function refreshAddsValidations_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(TABS.adds.name);
  if (!sh) return;
  var mr = sh.getMaxRows();
  if (mr < 2) return;
  sh.getRange(2, 8, mr - 1, 1).setDataValidation(listRuleAllowOther_(ACTION_STATUS_OPTIONS)); // Action Status (H)
  sh.getRange(2, 9, mr - 1, 1).setDataValidation(listRule_(TIER_OPTIONS));      // CRBM Tier (I)
  sh.getRange(2, 10, mr - 1, 1).setDataValidation(listRule_(PUREPLAY_OPTIONS)); // Pure-Play (J)
  sh.getRange(2, 11, mr - 1, 1).setDataValidation(listRule_(SECTOR_OPTIONS));   // Sector (K)
  var lr = sh.getLastRow();
  if (lr >= 2) {
    try { sh.getRange(2, 1, lr - 1, 2).insertCheckboxes(); } catch (e) { /* already present */ } // Imported? + Select
  }
}

function listRule_(options) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(options, true).setAllowInvalid(false).build();
}

/** Gentle: refresh the Move To dropdown on every movable tab and add Select checkboxes
 *  only where they are missing (never clobbers ticks a user is mid-way through). */
function scaffoldMoveColumns_() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(MOVABLE).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var lr = sh.getLastRow();
    if (lr < 2) return;
    var cfg = MOVABLE[name], n = lr - 1;
    sh.getRange(2, cfg.moveCol, n, 1).setDataValidation(listRule_(cfg.moveOptions || MOVE_OPTIONS)); // Move To
    var probe = sh.getRange(2, cfg.selectCol).getValue();
    if (probe === '' || probe === null) sh.getRange(2, cfg.selectCol, n, 1).insertCheckboxes();
  });
}

/** Force: rebuild Select checkboxes + Move To dropdown across the full data range.
 *  Use right after a tab's data is rebuilt or appended (no ticks are pending then). */
function forceMoveCheckboxes_(names) {
  var ss = SpreadsheetApp.getActive();
  names.forEach(function (name) {
    var cfg = MOVABLE[name];
    if (!cfg) return;
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var lr = sh.getLastRow();
    if (lr < 2) return;
    var n = lr - 1;
    var sel = sh.getRange(2, cfg.selectCol, n, 1);
    try { sel.removeCheckboxes(); } catch (e) { /* none present */ }
    sel.insertCheckboxes();
    sh.getRange(2, cfg.moveCol, n, 1).setDataValidation(listRule_(cfg.moveOptions || MOVE_OPTIONS));
  });
}

/** Same dropdown but tolerant of free-typed values (e.g. an unusual Profile Status). */
function listRuleAllowOther_(options) {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(options, true).setAllowInvalid(true).build();
}

/* ================================ FORMATTING HELPERS ================================ */

/** Style a tab as a filtered table: Calibri 11, frozen teal header (white bold text),
 *  a reset header filter, white / light-teal row banding, faint internal borders, auto-fit.
 *  (Google's native "Insert > Table" isn't scriptable, so a filter + banding is the
 *  reliable equivalent.) */
function applyFormat_(sh, numCols) {
  var lastRow = Math.max(sh.getLastRow(), 1);
  var rng = sh.getRange(1, 1, lastRow, numCols);
  rng.setFontFamily('Calibri').setFontSize(11);
  rng.setBorder(false, false, false, false, true, true,
    BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, numCols)
    .setFontWeight('bold').setBackground(HEADER_TEAL).setFontColor('#ffffff');
  // Reset the header filter so it always spans the current data extent.
  var f = sh.getFilter();
  if (f) f.remove();
  sh.getRange(1, 1, lastRow, numCols).createFilter();
  applyBanding_(sh, numCols, lastRow);
  sh.autoResizeColumns(1, numCols);
}

function removeBandings_(sh) {
  var bs = sh.getBandings();
  for (var i = 0; i < bs.length; i++) bs[i].remove();
}

/** White / light-teal alternating bands on the data rows (header excluded). */
function applyBanding_(sh, numCols, lastRow) {
  removeBandings_(sh);
  if (lastRow < 2) return;
  var b = sh.getRange(2, 1, lastRow - 1, numCols)
    .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, false, false);
  b.setFirstRowColor('#ffffff').setSecondRowColor(BAND_TEAL);
}

/** Colour each sheet tab by role so the workbook reads at a glance. */
function colorTabs_() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(TAB_ROLE).forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s) s.setTabColor(TAB_COLOR[TAB_ROLE[n]]);
  });
  getInternSheets_().forEach(function (s) { s.setTabColor(TAB_COLOR.intern); });
}

/** Header length for a tab name (TABS def or intern width) - used to restyle by name. */
function headerLenByName_(name) {
  var keys = Object.keys(TABS);
  for (var i = 0; i < keys.length; i++) {
    if (TABS[keys[i]].name === name) return TABS[keys[i]].header.length;
  }
  return ANALYST_BY_FIRST.hasOwnProperty(name) ? INTERN_WIDTH : null;
}

/** Re-apply table styling to a set of tabs by name (refreshes filter + banding extent
 *  after rows were appended one at a time). */
function restyleTabs_(names) {
  var ss = SpreadsheetApp.getActive();
  names.forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (!sh) return;
    var cols = headerLenByName_(n);
    if (cols) applyFormat_(sh, cols);
  });
}

function hideAuditTabs() {
  var ss = SpreadsheetApp.getActive();
  AUDIT_TAB_NAMES.forEach(function (n) { var s = ss.getSheetByName(n); if (s) s.hideSheet(); });
  toast_('Audit/log tabs hidden. Utilities > Show all tabs to bring them back.');
}

function showAllTabs() {
  var ss = SpreadsheetApp.getActive();
  ss.getSheets().forEach(function (s) {
    var n = s.getName();
    if (n.indexOf(RAW_PREFIX) === 0 || n === TABS.noTicker.name) return; // stay hidden (internal)
    s.showSheet();
  });
  toast_('Working tabs shown. RAW imports and No Ticker Reference stay hidden by design.');
}

/** Single-row format. Clears any leftover strikethrough so freshly written rows come in
 *  clean (prevents distributed/appended rows inheriting a previous row's line-through). */
function formatRow_(sh, rowNum, numCols) {
  sh.getRange(rowNum, 1, 1, numCols).setFontFamily('Calibri').setFontSize(11)
    .setFontLine('none')
    .setBorder(false, false, false, false, true, true,
      BORDER_COLOR, SpreadsheetApp.BorderStyle.SOLID);
}

/** Clear everything below the header (filter, content, validations, checkboxes, strikethrough). */
function clearBody_(sh) {
  var f = sh.getFilter();
  if (f) f.remove();
  var mr = sh.getMaxRows(), mc = sh.getMaxColumns();
  if (mr < 2) return;
  var rng = sh.getRange(2, 1, mr - 1, mc);
  try { rng.removeCheckboxes(); } catch (e) { /* no checkboxes present */ }
  rng.clearDataValidations();
  rng.clearContent();
  rng.setFontLine('none');
}

/* ============================== NORMALIZATION HELPERS =============================== */

var LEGAL_SUFFIXES = {};
['inc', 'incorporated', 'ltd', 'limited', 'corp', 'corporation', 'llc', 'plc', 'sa',
  'ag', 'nv', 'co', 'company', 'group', 'holdings', 'holding', 'se', 'ab', 'as', 'asa',
  'oyj', 'kk', 'bhd', 'pte', 'nyrt', 'pjsc'
].forEach(function (s) { LEGAL_SUFFIXES[s] = true; });

/** lowercase, strip punctuation, collapse whitespace, strip trailing legal suffixes. */
function normName_(name) {
  var s = String(name || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  var w = s.split(' ');
  while (w.length > 1 && LEGAL_SUFFIXES[w[w.length - 1]]) w.pop();
  return w.join(' ');
}

function normTicker_(t) { return String(t || '').trim().toUpperCase(); }

/**
 * 1-based row of the first data row on `sh` whose ticker (1-based col tCol) matches normT,
 * or whose name (1-based col nCol) matches normN when normT is blank. -1 if none.
 * Used to prevent duplicate rows when routing / moving the same company twice.
 */
function findExistingRow_(sh, nCol, tCol, normT, normN) {
  var lr = sh.getLastRow();
  if (lr < 2) return -1;
  var maxC = Math.max(nCol, tCol);
  var vals = sh.getRange(2, 1, lr - 1, maxC).getValues();
  for (var i = 0; i < vals.length; i++) {
    var t = normTicker_(vals[i][tCol - 1]);
    if (normT) { if (t === normT) return i + 2; }
    else if (normN && normName_(vals[i][nCol - 1]) === normN) return i + 2;
  }
  return -1;
}

/** Configurable ticker keyword flag - keywords read from the Config tab (default .IN). */
var _flagKeywordsCache = null;
function flagKeywords_() {
  if (_flagKeywordsCache) return _flagKeywordsCache;
  var def = ['.IN'];
  var sh = dashboardSheet_();
  if (sh && sh.getLastRow() >= 1) {
    var vals = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0]).toLowerCase().indexOf('exclude pull tickers') === 0) {
        var kws = String(vals[i][1] || '').split(',')
          .map(function (s) { return s.trim().toUpperCase(); })
          .filter(function (s) { return s.length > 0; });
        if (kws.length) { _flagKeywordsCache = kws; return kws; }
      }
    }
  }
  _flagKeywordsCache = def;
  return def;
}

function tickerFlag_(t) {
  var nt = normTicker_(t);
  if (!nt) return false;
  var kws = flagKeywords_();
  for (var i = 0; i < kws.length; i++) {
    if (nt.indexOf(kws[i]) >= 0) return true;
  }
  return false;
}

function sanitizeName_(filename) {
  return String(filename).replace(/\.[^.]*$/, '')
    .replace(/[\\\/\?\*\[\]:]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 85);
}

/* ========================== STEP 1 - CONSOLIDATE & CLEAN PULL ======================= */

function showCsvImportDialog() {
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Calibri,Arial,sans-serif;font-size:13px">' +
    '<p>Select one or more AlphaSense Search Summary exports - CSV or Excel (.xlsx), ' +
    'one per market-cap range.</p>' +
    '<input type="file" id="f" multiple accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><br><br>' +
    '<button id="go" onclick="go()">Import</button> <span id="st"></span>' +
    '<scr' + 'ipt>' +
    'function go(){var fs=document.getElementById("f").files;if(!fs.length){return;}' +
    'document.getElementById("go").disabled=true;' +
    'document.getElementById("st").textContent="Reading files...";' +
    'var out=[],pending=fs.length;' +
    'Array.prototype.forEach.call(fs,function(f){' +
    'var isX=/\\.xlsx$/i.test(f.name);var r=new FileReader();' +
    'r.onload=function(e){' +
    'if(isX){out.push({name:f.name,kind:"xlsx",data:e.target.result.split(",")[1]});}' +
    'else{out.push({name:f.name,kind:"csv",content:e.target.result});}' +
    'if(--pending===0)send(out);};' +
    'if(isX){r.readAsDataURL(f);}else{r.readAsText(f);}});' +
    'function send(arr){document.getElementById("st").textContent="Importing...";' +
    'google.script.run.withSuccessHandler(function(m){' +
    'document.getElementById("st").textContent=m;' +
    'setTimeout(function(){google.script.host.close();},1500);})' +
    '.withFailureHandler(function(err){document.getElementById("go").disabled=false;' +
    'document.getElementById("st").textContent="Error: "+err.message;})' +
    '.importPullFiles(arr);}}' +
    '</scr' + 'ipt></div>'
  ).setWidth(440).setHeight(190);
  SpreadsheetApp.getUi().showModalDialog(html, 'Import AlphaSense Pulls');
}

/** Each file -> its own hidden RAW tab (re-import replaces in place). Auto Clean Pull.
 *  CSVs are parsed directly; XLSX files are converted via the Drive API and the first
 *  sheet is read (Search Summary exports are single-tab). */
function importPullFiles(files) {
  if (!files || !files.length) throw new Error('No files received.');
  scaffoldAll_();
  var ss = SpreadsheetApp.getActive();
  files.forEach(function (f) {
    var data;
    if (f.kind === 'xlsx') {
      data = readXlsxValues_(Utilities.base64Decode(f.data), f.name);
    } else {
      data = Utilities.parseCsv(f.content);
    }
    if (!data || !data.length) return;
    var width = Math.max.apply(null, data.map(function (r) { return r.length; }));
    data = data.map(function (r) {
      r = r.slice();
      while (r.length < width) r.push('');
      return r;
    });
    var tabName = RAW_PREFIX + sanitizeName_(f.name);
    var sh = ss.getSheetByName(tabName);
    if (sh) { sh.clear(); } else { sh = ss.insertSheet(tabName); }
    sh.getRange(1, 1, data.length, width).setValues(data);
    sh.hideSheet();
    logHistory_('Import Pull (' + (f.kind === 'xlsx' ? 'XLSX' : 'CSV') + ')', f.name,
      data.length + ' rows written to hidden "' + tabName + '"');
  });
  buildCleanPull();
  return files.length + ' file(s) imported - Clean Pull rebuilt.';
}

/** Convert an uploaded xlsx via Drive and return the first sheet's values. */
function readXlsxValues_(bytes, name) {
  var tempId = convertXlsxToSheet_(bytes, name);
  try {
    var sh = SpreadsheetApp.openById(tempId).getSheets()[0];
    var lr = sh.getLastRow(), lc = sh.getLastColumn();
    if (lr < 1 || lc < 1) return [];
    return sh.getRange(1, 1, lr, lc).getValues();
  } finally {
    try { DriveApp.getFileById(tempId).setTrashed(true); } catch (e) { /* best effort */ }
  }
}

/* AlphaSense Search Summary header aliases, resolved by name so a column reorder or a
 * change in the metadata-block height does not silently drop rows or disable ISIN
 * matching. If no header row is found we fall back to the historical layout (data from
 * row 10, fixed column positions). */
var RAW_ALIASES = {
  company: ['company', 'company name', 'name', 'primary business name',
    'company name (alphasense)', 'issuer name', 'issuer'],
  ticker: ['ticker', 'alphasense ticker', 'symbol', 'sentieo ticker', 'primary symbol'],
  cik: ['cik'],
  isin: ['isin'],
  mcap: ['mcap', 'mcap ($)', 'market cap', 'market cap ($)', 'market capitalization',
    'market capitalisation', 'mkt cap'],
  region: ['region'],
  domicile: ['domicile', 'domicile country', 'country', 'country of domicile']
};
var RAW_LEGACY_COLS = { company: 0, ticker: 1, cik: 2, isin: 3, mcap: 5, region: 7, domicile: 8 };
var RAW_HEADER_SCAN = 20; // rows to scan for the header before falling back to legacy

/** Find the header row in a RAW grid: the first row (within RAW_HEADER_SCAN) that resolves
 *  both a company and a ticker column by name. Returns {row, idx} or null. */
function findRawHeaderRow_(grid) {
  var scan = Math.min(RAW_HEADER_SCAN, grid.length);
  for (var i = 0; i < scan; i++) {
    var pos = {};
    grid[i].forEach(function (h, c) {
      var key = String(h || '').toLowerCase().trim();
      if (!key) return;
      Object.keys(RAW_ALIASES).forEach(function (field) {
        if (pos[field] === undefined && RAW_ALIASES[field].indexOf(key) >= 0) pos[field] = c;
      });
    });
    if (pos.company !== undefined && pos.ticker !== undefined) return { row: i, idx: pos };
  }
  return null;
}

/** Read a field from a RAW row by the resolved column map (blank if unmapped / out of range). */
function rawCell_(r, col, field) {
  var c = col[field];
  return (c === undefined || c < 0 || c >= r.length) ? '' : r[c];
}

/**
 * Stack data rows from every RAW tab. The header row is detected by column name
 * (RAW_ALIASES); if none is found we fall back to the historical layout (data from
 * row 10, fixed column positions). Keep: real ticker (not blank, not "-") AND MCAP not
 * PRIVATE / ACQUIRED. Dedupe ticker-first (normalized ticker), Company as tiebreak.
 */
function buildCleanPull() {
  var ss = SpreadsheetApp.getActive();
  var rawSheets = ss.getSheets().filter(function (s) {
    return s.getName().indexOf(RAW_PREFIX) === 0;
  });
  if (!rawSheets.length) { toast_('No RAW tabs found - run Import CSVs first.'); return; }

  var byKey = {}, order = [], legacyTabs = 0;
  rawSheets.forEach(function (sh) {
    var lr = sh.getLastRow();
    if (lr < 2) return;
    var lc = Math.max(sh.getLastColumn(), 11);
    var grid = sh.getRange(1, 1, lr, lc).getValues();
    var hdr = findRawHeaderRow_(grid);
    var startRow, col;
    if (hdr) { startRow = hdr.row + 1; col = hdr.idx; }
    else { startRow = 9; col = RAW_LEGACY_COLS; legacyTabs++; }   // legacy: data begins on row 10
    for (var i = startRow; i < grid.length; i++) {
      var r = grid[i];
      var company = String(rawCell_(r, col, 'company') || '').trim();
      var ticker = String(rawCell_(r, col, 'ticker') || '').trim();
      var mcap = String(rawCell_(r, col, 'mcap') || '').trim().toUpperCase();
      if (!company && !ticker) continue;
      if (!ticker || ticker === '-') continue;
      if (mcap === 'PRIVATE' || mcap === 'ACQUIRED') continue;
      var out = [company, ticker, rawCell_(r, col, 'cik'), rawCell_(r, col, 'isin'),
        rawCell_(r, col, 'mcap'), rawCell_(r, col, 'region'), rawCell_(r, col, 'domicile')];
      var key = normTicker_(ticker);
      if (!(key in byKey)) {
        byKey[key] = out;
        order.push(key);
      } else if (String(out[0]).toLowerCase() < String(byKey[key][0]).toLowerCase()) {
        byKey[key] = out; // company tiebreak
      }
    }
  });

  var rows = order.map(function (k) { return byKey[k]; });
  var sh = ensureTab_(TABS.cleanPull);
  clearBody_(sh);
  if (rows.length) sh.getRange(2, 1, rows.length, 7).setValues(rows);
  applyFormat_(sh, 7);
  logHistory_('Build Clean Pull', rawSheets.length + ' RAW tab(s)',
    rows.length + ' rows after clean + dedupe' +
    (legacyTabs ? ' - ' + legacyTabs + ' tab(s) used the legacy row-10 fallback (no header row detected)' : ''));
  toast_('Clean Pull rebuilt: ' + rows.length + ' rows.');
}

/* ====================== STEP 1.5 - REFRESH DB REFERENCES ============================ */

function showRefreshDialog() {
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Calibri,Arial,sans-serif;font-size:13px">' +
    '<p>Select the latest AlphaSense Ticker export workbook (.xlsx).<br>' +
    'Current DB is rebuilt. Watchlist is merged: export rows refreshed, local rows kept, ' +
    'rows now Active graduate off. FR Exclude / Confirmed Exclude untouched.</p>' +
    '<input type="file" id="f" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><br><br>' +
    '<button id="go" onclick="go()">Refresh</button> <span id="st"></span>' +
    '<scr' + 'ipt>' +
    'function go(){var fs=document.getElementById("f").files;if(!fs.length){return;}' +
    'var f=fs[0];document.getElementById("go").disabled=true;' +
    'document.getElementById("st").textContent="Reading file...";' +
    'var r=new FileReader();' +
    'r.onload=function(e){var b64=e.target.result.split(",")[1];' +
    'document.getElementById("st").textContent="Rebuilding references...";' +
    'google.script.run.withSuccessHandler(function(m){' +
    'document.getElementById("st").textContent=m;' +
    'setTimeout(function(){google.script.host.close();},1800);})' +
    '.withFailureHandler(function(err){document.getElementById("go").disabled=false;' +
    'document.getElementById("st").textContent="Error: "+err.message;})' +
    '.refreshDbReferences({name:f.name,data:b64});};' +
    'r.readAsDataURL(f);}' +
    '</scr' + 'ipt></div>'
  ).setWidth(470).setHeight(230);
  SpreadsheetApp.getUi().showModalDialog(html, 'Refresh DB References');
}

/**
 * Refresh from the Kintone ticker export:
 * - Current DB: full rebuild (overwrite) from the Active tabs.
 * - Watchlist: MERGE - export rows are authoritative; locally routed/pasted rows that
 *   are not in the export are preserved; rows that now appear ACTIVE in the export
 *   graduate off the Watchlist automatically (Current DB takes priority) and are
 *   listed in History Log.
 * Tabs classified by name: contains "Watchlist" -> Watchlist bucket, else Active.
 * Columns resolved by header name - tab count and order not hardcoded.
 * Rows WITHOUT a ticker are kept out of the visible tabs and written to the hidden
 * "No Ticker Reference" tab - the crosscheck still name-matches against them.
 */
function refreshDbReferences(file) {
  if (!file || !file.data) throw new Error('No file received.');
  scaffoldAll_();
  var bytes = Utilities.base64Decode(file.data);
  var tempId = convertXlsxToSheet_(bytes, file.name);
  var activeRows = [], watchRows = [], noTickerRows = [];
  var activeTabs = [], watchTabs = [];
  try {
    var src = SpreadsheetApp.openById(tempId);
    src.getSheets().forEach(function (sh) {
      var lr = sh.getLastRow(), lc = sh.getLastColumn();
      if (lr < 2 || lc < 1) return;
      var vals = sh.getRange(1, 1, lr, lc).getValues();
      var idx = headerIndex_(vals[0]);
      var isWatch = /watchlist/i.test(sh.getName());
      (isWatch ? watchTabs : activeTabs).push(sh.getName());
      var bucket = isWatch ? 'Watchlist' : 'Current DB';
      for (var i = 1; i < lr; i++) {
        var r = vals[i];
        var pbn = pick_(r, idx, 'primary business name');
        var ticker = String(pick_(r, idx, 'alphasense ticker') || '').trim();
        if (!String(pbn || '').trim() && !ticker) continue;
        var rec = pick_(r, idx, 'record number');
        var sector = pick_(r, idx, 'sector');
        var status = pick_(r, idx, 'profile status');
        var tier = pick_(r, idx, 'crbm tier');
        var isin = String(pick_(r, idx, 'isin') || '').trim(); // optional export column
        if (!ticker) {                       // no empties on visible tabs
          noTickerRows.push([pbn, bucket, rec, sector]);
        } else if (isWatch) {
          watchRows.push([pbn, ticker, '', '', '', '', tier, '', '',
            tickerFlag_(ticker), rec, sector, isin]);
        } else {
          activeRows.push([pbn, ticker, status, tier, '', '', '', '', '',
            tickerFlag_(ticker), rec, sector, isin]);
        }
      }
    });
  } finally {
    try { DriveApp.getFileById(tempId).setTrashed(true); } catch (e) { /* best effort */ }
  }

  var dbSh = ensureTab_(TABS.currentDb);
  clearBody_(dbSh);
  if (activeRows.length) dbSh.getRange(2, 1, activeRows.length, 13).setValues(activeRows);
  applyFormat_(dbSh, 13);

  // Watchlist MERGE - export rows are authoritative; locally routed/pasted rows not in
  // the export are preserved; rows now Active in the DB graduate off the list.
  var wlSh = ensureTab_(TABS.watchlist);
  var activeTickerSet = {}, activeNameSet = {};
  activeRows.forEach(function (r) {
    var t = normTicker_(r[1]);
    if (t) activeTickerSet[t] = true;
    var nn = normName_(r[0]);
    if (nn) activeNameSet[nn] = true;
  });
  var watchTickerSet = {}, watchNameSet = {};
  watchRows.forEach(function (r) {
    var t = normTicker_(r[1]);
    if (t) watchTickerSet[t] = true;
    var nn = normName_(r[0]);
    if (nn) watchNameSet[nn] = true;
  });
  var preserved = [], graduated = [], seenLocal = {}, localStamp = {}, stamped = 0;
  var wlLr = wlSh.getLastRow();
  if (wlLr >= 2) {
    wlSh.getRange(2, 1, wlLr - 1, 13).getValues().forEach(function (r) {
      var name = String(r[0] || '').trim();
      var t = normTicker_(r[1]);
      if (!name && !t) return;
      var nn = normName_(name);
      if (t ? activeTickerSet[t] : (nn && activeNameSet[nn])) {     // now Active in DB
        graduated.push(name + (t ? ' (' + t + ')' : ''));
        return;
      }
      if (t ? watchTickerSet[t] : (nn && watchNameSet[nn])) {       // already in export
        // The export copy wins the row, but the export never carries the local review stamp
        // (Review Assignement / Ticker Reviewed Date / Analyst / Ps Note / Source / Note).
        // Losing it made Crosscheck treat an already-reviewed ticker as never reviewed -
        // stale-state churn every weekly refresh. Remember the stamp to graft onto the
        // export row below.
        if (r[2] || r[3]) {
          if (t && !localStamp['t:' + t]) localStamp['t:' + t] = r;
          if (nn && !localStamp['n:' + nn]) localStamp['n:' + nn] = r;
        }
        return;
      }
      var key = t || ('name:' + nn);
      if (seenLocal[key]) return;
      seenLocal[key] = true;
      preserved.push(r);                                            // keep local row
    });
  }
  // Graft preserved review stamps onto the matching export rows (only fields the export
  // left blank - the export stays authoritative for everything it actually provides).
  watchRows.forEach(function (w) {
    var t = normTicker_(w[1]), nn = normName_(w[0]);
    var s = (t && localStamp['t:' + t]) || (nn && localStamp['n:' + nn]);
    if (!s) return;
    var grafted = false;
    [2, 3, 4, 5, 6, 7, 8].forEach(function (c) {  // RevAssign, RevDate, Analyst, PsNote, Tier, Source, Note
      if (!String(w[c] || '').trim() && String(s[c] || '').trim() !== '') { w[c] = s[c]; grafted = true; }
    });
    if (grafted) stamped++;
  });
  clearBody_(wlSh);
  var allWatch = watchRows.concat(preserved);
  if (allWatch.length) wlSh.getRange(2, 1, allWatch.length, 13).setValues(allWatch);
  applyFormat_(wlSh, TABS.watchlist.header.length);
  forceMoveCheckboxes_(['Watchlist']);

  var ntSh = ensureTab_(TABS.noTicker);
  clearBody_(ntSh);
  if (noTickerRows.length) ntSh.getRange(2, 1, noTickerRows.length, 4).setValues(noTickerRows);
  applyFormat_(ntSh, 4);
  if (!ntSh.isSheetHidden()) ntSh.hideSheet();

  var gradDetail = graduated.length
    ? ' - Graduated to Current DB and removed from Watchlist (' + graduated.length + '): ' +
      graduated.slice(0, 15).join('; ') + (graduated.length > 15 ? ' ...' : '')
    : '';
  logHistory_('Refresh DB References', file.name,
    'Current DB: ' + activeRows.length + ' rows from [' + activeTabs.join(', ') + '] - ' +
    'Watchlist: ' + watchRows.length + ' export + ' + preserved.length + ' preserved local' +
    (stamped ? ' (' + stamped + ' review stamps carried onto export rows)' : '') + ' - ' +
    'No-ticker (hidden ref): ' + noTickerRows.length + gradDetail);
  return 'Done. Current DB: ' + activeRows.length + '. Watchlist: ' + watchRows.length +
    ' export + ' + preserved.length + ' local kept' +
    (stamped ? ', ' + stamped + ' review stamps carried over' : '') +
    (graduated.length ? ', ' + graduated.length + ' graduated off' : '') +
    '. No-ticker reference: ' + noTickerRows.length + '.';
}

/** Upload + convert xlsx to a temp Google Sheet via the Drive REST API (no add-ons). */
function convertXlsxToSheet_(bytes, name) {
  var boundary = '-------darbpipeline314159';
  var meta = JSON.stringify({
    name: 'TEMP DARB import - ' + name,
    mimeType: 'application/vnd.google-apps.spreadsheet'
  });
  var head = '--' + boundary + '\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n' +
    '--' + boundary + '\r\n' +
    'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n';
  var tail = '\r\n--' + boundary + '--';
  var payload = Utilities.newBlob(head).getBytes()
    .concat(bytes)
    .concat(Utilities.newBlob(tail).getBytes());
  var resp = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'post',
      contentType: 'multipart/related; boundary=' + boundary,
      payload: payload,
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
  if (resp.getResponseCode() >= 300) {
    throw new Error('Drive conversion failed (' + resp.getResponseCode() + '): ' +
      resp.getContentText().slice(0, 300));
  }
  return JSON.parse(resp.getContentText()).id;
}

function headerIndex_(headerRow) {
  var idx = {};
  headerRow.forEach(function (h, i) { idx[String(h).toLowerCase().trim()] = i; });
  return idx;
}

function pick_(row, idx, key) { return idx[key] === undefined ? '' : row[idx[key]]; }

/* ===================== ONE-TIME LEGACY WATCHLIST IMPORT ============================= */

function showWatchlistImportDialog() {
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Calibri,Arial,sans-serif;font-size:13px">' +
    '<p>One-time load of the legacy macro Watchlist (CSV or XLSX). Company name and ' +
    'ticker are matched by header (Issuer/Company name, Sentieo/AlphaSense ticker); rows ' +
    'already on the Watchlist - by ticker or name - are skipped. Safe to re-run.</p>' +
    '<input type="file" id="f" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><br><br>' +
    '<button id="go" onclick="go()">Import</button> <span id="st"></span>' +
    '<scr' + 'ipt>' +
    'function go(){var fs=document.getElementById("f").files;if(!fs.length){return;}' +
    'var f=fs[0];document.getElementById("go").disabled=true;' +
    'document.getElementById("st").textContent="Reading file...";' +
    'var isX=/\\.xlsx$/i.test(f.name);var r=new FileReader();' +
    'r.onload=function(e){var payload=isX' +
    '?{name:f.name,kind:"xlsx",data:e.target.result.split(",")[1]}' +
    ':{name:f.name,kind:"csv",content:e.target.result};' +
    'document.getElementById("st").textContent="Importing...";' +
    'google.script.run.withSuccessHandler(function(m){' +
    'document.getElementById("st").textContent=m;' +
    'setTimeout(function(){google.script.host.close();},1800);})' +
    '.withFailureHandler(function(err){document.getElementById("go").disabled=false;' +
    'document.getElementById("st").textContent="Error: "+err.message;})' +
    '.importLegacyWatchlist(payload);};' +
    'if(isX){r.readAsDataURL(f);}else{r.readAsText(f);}}' +
    '</scr' + 'ipt></div>'
  ).setWidth(470).setHeight(220);
  SpreadsheetApp.getUi().showModalDialog(html, 'Import Legacy Watchlist (one-time)');
}

/**
 * One-time import of the legacy macro Watchlist into the Watchlist tab. Rows are tagged
 * Source = "Legacy Watchlist" and land as LOCAL rows, so the Refresh DB References merge
 * preserves them on every future upload (and supersedes any that later appear in the
 * Kintone export). Deduplicated against whatever is already on the Watchlist, by
 * normalized ticker first, then normalized name. Re-running adds only genuinely new names.
 * Column resolution is by header; if no recognizable header is found, column A is treated
 * as the company name and column B as the ticker.
 */
function importLegacyWatchlist(file) {
  if (!file) throw new Error('No file received.');
  scaffoldAll_();
  var data = (file.kind === 'xlsx')
    ? readXlsxValues_(Utilities.base64Decode(file.data), file.name)
    : Utilities.parseCsv(file.content);
  if (!data || !data.length) throw new Error('Empty file.');

  var idx = headerIndex_(data[0]);
  function find_(keys) {
    for (var i = 0; i < keys.length; i++) {
      if (idx[keys[i]] !== undefined) return idx[keys[i]];
    }
    return -1;
  }
  var cCompany = find_(['issuer name', 'company name', 'primary business name', 'company',
    'name', 'company name (alphasense)']);
  var cTicker = find_(['alphasense ticker', 'sentieo ticker', 'ticker', 'sentieo',
    'primary symbol', 'symbol']);
  var cSector = find_(['sector']);
  var cTier = find_(['crbm tier', 'tier']);
  var cNote = find_(['task type/comment', 'comment', 'comments', 'note', 'ps note', 'notes']);

  var hasHeader = (cCompany >= 0 || cTicker >= 0);
  var startRow = hasHeader ? 1 : 0;
  if (!hasHeader) { cCompany = 0; cTicker = 1; } // assume A = company, B = ticker

  var ss = SpreadsheetApp.getActive();
  var wl = ensureTab_(TABS.watchlist);
  var existTick = {}, existName = {};
  var lr = wl.getLastRow();
  if (lr >= 2) {
    wl.getRange(2, 1, lr - 1, 2).getValues().forEach(function (r) {
      var t = normTicker_(r[1]); if (t) existTick[t] = true;
      var nn = normName_(r[0]); if (nn) existName[nn] = true;
    });
  }

  var rows = [], added = 0, skipped = 0, seen = {};
  for (var i = startRow; i < data.length; i++) {
    var r = data[i];
    var company = cCompany >= 0 ? String(r[cCompany] || '').trim() : '';
    var ticker = (cTicker >= 0 ? String(r[cTicker] || '') : '').replace(/\s+/g, '');
    if (!company && !ticker) continue;
    var nt = normTicker_(ticker), nn = normName_(company);
    var key = nt || ('name:' + nn);
    if (seen[key]) { skipped++; continue; }
    seen[key] = true;
    if ((nt && existTick[nt]) || (!nt && nn && existName[nn])) { skipped++; continue; } // already listed
    var sector = cSector >= 0 ? String(r[cSector] || '').trim() : '';
    var tier = cTier >= 0 ? String(r[cTier] || '').trim() : '';
    var note = cNote >= 0 ? String(r[cNote] || '').trim() : '';
    // Watchlist schema: Company|Ticker|RevAssign|RevDate|Analyst|Ps Note|Tier|Source|Note|Flag|Record#|Sector|ISIN
    rows.push([company, ticker, 'Watchlist', '', '', note, tier, 'Legacy Watchlist',
      '', tickerFlag_(ticker), '', sector, '']);
    added++;
  }

  if (rows.length) {
    wl.getRange(wl.getLastRow() + 1, 1, rows.length, 13).setValues(rows);
  }
  applyFormat_(wl, TABS.watchlist.header.length);
  forceMoveCheckboxes_(['Watchlist']);
  logHistory_('Import Legacy Watchlist', file.name,
    added + ' added, ' + skipped + ' skipped (duplicate or blank)');
  return 'Done. ' + added + ' legacy Watchlist row(s) added, ' + skipped +
    ' skipped (already present or blank).';
}

/* ===================== STEP 2 - CROSSCHECK & CATEGORISE (RunSort) =================== */

/**
 * Replicates the legacy RunSort logic, extended for changed tickers / names:
 *   a. exact ticker in any reference list       -> EXCLUDED (Match Type: Ticker)
 *        name drifted vs DB name                -> also surfaced on SORT (Source "DB Drift")
 *   b. ISIN match (when ISINs exist in the DB)  -> EXCLUDED (Match Type: ISIN)
 *        same security, ticker changed          -> also surfaced on SORT (Source "DB Drift")
 *   c. exact normalized-name match              -> REVIEW (Exact name)
 *   d. first word (>=4 chars) + fuzzy-confirm
 *      (first-5-chars OR containment OR
 *       first-two-words)                        -> REVIEW (Fuzzy name)
 *   e. ticker root match (same symbol, other
 *      exchange suffix, root >= 3 chars)        -> REVIEW (Ticker root)
 *   f. otherwise                                -> SORT (definitely new)
 * Near-match (c/d/e) only considers Current DB records (incl. its hidden No-Ticker rows);
 * Watchlist / FR Exclude / Confirmed Exclude are still exact-excluded but not fuzzy-matched.
 * ISIN matching activates automatically once the Kintone export includes an ISIN column.
 */
function runCrosscheck() {
  scaffoldAll_();
  if (!stepGuard_(3)) return;
  var ss = SpreadsheetApp.getActive();
  var tickerMap = {};    // normalized ticker -> { source, name }
  var rootMap = {};      // ticker root       -> { ticker, name, source }
  var isinMap = {};      // ISIN              -> { name, ticker, source }
  var nameMap = {};      // normalized name   -> { orig, source, ticker }
  var firstWordIdx = {}; // first word        -> [{ norm, orig, source, ticker }]

  function addName_(n, source, ticker) {
    var nn = normName_(n);
    if (!nn) return;
    if (nameMap[nn] === undefined) nameMap[nn] = { orig: n, source: source, ticker: ticker || '' };
    var fw = nn.split(' ')[0];
    if (fw.length >= 4) {
      (firstWordIdx[fw] = firstWordIdx[fw] || [])
        .push({ norm: nn, orig: n, source: source, ticker: ticker || '' });
    }
  }

  var thresholdDays = reviewThresholdDays_();
  var resurfaceBlank = resurfaceBlank_();
  var tz = Session.getScriptTimeZone();

  // nearMatch = include this list in the fuzzy name / ticker-root REVIEW check. Only Current DB
  // qualifies (per request); the others still exact-exclude by ticker/ISIN but are not fuzzy-matched.
  var refDefs = [
    { name: 'Current DB', isin: true, reviewable: false, nearMatch: true },
    { name: 'Watchlist', isin: true, reviewable: true, nearMatch: false },
    { name: 'FR Exclude', isin: false, reviewable: true, nearMatch: false },
    { name: 'Confirmed Exclude', isin: false, reviewable: true, nearMatch: false }
  ];
  refDefs.forEach(function (def) {
    var sh = ss.getSheetByName(def.name);
    if (!sh) return;
    var lr = sh.getLastRow();
    if (lr < 2) return;
    var width = def.isin ? Math.min(13, sh.getMaxColumns()) : Math.min(10, sh.getMaxColumns());
    sh.getRange(2, 1, lr - 1, width).getValues().forEach(function (r) {
      var n = String(r[0] || '').trim();
      var t = normTicker_(r[1]);
      if (t) {
        if (tickerMap[t] === undefined) {
          tickerMap[t] = {
            source: def.name, name: n, reviewable: def.reviewable,
            reviewed: r[3], tier: r[6], analyst: r[4], note: r[8],
            sector: def.isin ? (r[11] || '') : ''
          };
        }
        var root = tickerRoot_(t);
        if (def.nearMatch && root.length >= 3 && rootMap[root] === undefined) {
          rootMap[root] = { ticker: t, name: n, source: def.name };
        }
      }
      if (def.isin && width >= 13) {
        var isin = String(r[12] || '').trim().toUpperCase();
        if (isin && isin !== '-' && isinMap[isin] === undefined) {
          isinMap[isin] = { name: n, ticker: t, source: def.name };
        }
      }
      if (def.nearMatch && n) addName_(n, def.name, t);
    });
  });

  // No-ticker names from the hidden reference tab (name matching only). Per the Current-DB-only
  // near-match rule, only include rows whose Source Bucket (col 2) is Current DB.
  var ntSh = ss.getSheetByName(TABS.noTicker.name);
  if (ntSh && ntSh.getLastRow() >= 2) {
    ntSh.getRange(2, 1, ntSh.getLastRow() - 1, 2).getValues().forEach(function (r) {
      var n = String(r[0] || '').trim();
      if (n && /current db/i.test(String(r[1] || ''))) addName_(n, 'Current DB (no ticker)', '');
    });
  }

  var cp = ss.getSheetByName(TABS.cleanPull.name);
  var lr = cp ? cp.getLastRow() : 0;
  if (lr < 2) { toast_('Clean Pull is empty - run Build Clean Pull first.'); return; }
  var input = cp.getRange(2, 1, lr - 1, 4).getValues(); // Company | Ticker | CIK | ISIN

  var sortRows = [], exclRows = [], considered = 0, drift = 0, nearMatch = 0, flagged = 0;
  var resurrected = 0, resurrectedByTab = {};
  input.forEach(function (r) {
    var company = String(r[0] || '').trim();
    var ticker = String(r[1] || '').trim();
    if (!company || !ticker) return;
    if (tickerFlag_(ticker)) { flagged++; return; }   // skip flagged tickers (e.g. .IN) - never reach Sort
    considered++;
    var nt = normTicker_(ticker);
    var nn = normName_(company);
    var isin = String(r[3] || '').trim().toUpperCase();
    if (isin === '-') isin = '';

    if (tickerMap[nt] !== undefined) {                       // a. exact ticker
      var ex = tickerMap[nt];
      if (ex.reviewable && isStale_(ex.reviewed, thresholdDays, resurfaceBlank)) {
        var dstr = (ex.reviewed instanceof Date)
          ? Utilities.formatDate(ex.reviewed, tz, 'yyyy-MM-dd') : 'no date';
        var rnote = 'Re-review: was on ' + ex.source + ', last reviewed ' + dstr +
          ' (> ' + thresholdDays + 'd)' + (ex.note ? ' - ' + ex.note : '');
        sortRows.push([company, ticker, '', '', '', '', '', '', '', '', ex.tier || '', ex.sector || '',
          ex.source, rnote]);                                //    stale -> back to Sort
        (resurrectedByTab[ex.source] = resurrectedByTab[ex.source] || {})[nt] = true;
        resurrected++;
        return;
      }
      exclRows.push([company, ticker, ex.source, 'Ticker']);
      var en = normName_(ex.name);
      if (nn && en && nn !== en && !fuzzyPair_(nn, en)) {    //    name drifted -> also surface on Sort
        sortRows.push([company, ticker, '', '', '', '', '', '', '', '', '', '', 'DB Drift',
          'Name changed - same ticker as "' + ex.name + '" on ' + ex.source +
          '. Update the DB name, or move to a list.']);
        drift++;
      }
      return;
    }
    if (isin && isinMap[isin] !== undefined) {               // b. same ISIN, new ticker
      var im = isinMap[isin];
      exclRows.push([company, ticker, im.source, 'ISIN']);
      sortRows.push([company, ticker, '', '', '', '', '', '', '', '', '', '', 'DB Drift',
        'Ticker changed - same ISIN as ' + im.ticker + ' "' + im.name + '" on ' + im.source +
        '. Update the DB ticker, or move to a list.']);
      drift++;
      return;
    }
    if (nn && nameMap[nn] !== undefined) {                   // c. exact name -> Sort (near-match)
      var nm = nameMap[nn];
      sortRows.push([company, ticker, '', '', '', '', '', '', '', '', '', '', 'Review',
        'Near-match (exact name) vs "' + nm.orig + '" on ' + nm.source +
        (nm.ticker ? ' (' + nm.ticker + ')' : '') + ' - confirm new vs same.']);
      nearMatch++;
      return;
    }
    var fw = nn ? nn.split(' ')[0] : '';
    if (fw.length >= 4 && firstWordIdx[fw]) {                // d. fuzzy name -> Sort (near-match)
      var m = fuzzyConfirm_(nn, firstWordIdx[fw]);
      if (m) {
        sortRows.push([company, ticker, '', '', '', '', '', '', '', '', '', '', 'Review',
          'Near-match (fuzzy name) vs "' + m.orig + '" on ' + m.source +
          (m.ticker ? ' (' + m.ticker + ')' : '') + ' - confirm new vs same.']);
        nearMatch++;
        return;
      }
    }
    var root = tickerRoot_(nt);                              // e. ticker root -> Sort (near-match)
    if (root.length >= 3 && rootMap[root] !== undefined && rootMap[root].ticker !== nt) {
      var rm = rootMap[root];
      sortRows.push([company, ticker, '', '', '', '', '', '', '', '', '', '', 'Review',
        'Near-match (ticker root) vs "' + rm.name + '" on ' + rm.source +
        (rm.ticker ? ' (' + rm.ticker + ')' : '') + ' - possible listing/ticker change.']);
      nearMatch++;
      return;
    }
    sortRows.push([company, ticker, '', '', '', '', '', '', '', '', '', '', 'AS Pull', '']); // f. definitely new (from the AlphaSense pull)
  });

  // Rebuild outputs (script-owned tabs only)
  var sortSh = ensureTab_(TABS.sort);
  clearBody_(sortSh);
  if (sortRows.length) {
    sortSh.getRange(2, 1, sortRows.length, 14).setValues(sortRows);
  }
  applyFormat_(sortSh, TABS.sort.header.length);
  forceMoveCheckboxes_(['Sort']);   // Select + Move To
  refreshSortValidations_();        // Assign To + Tier + Sector

  var exSh = ensureTab_(TABS.excluded);
  clearBody_(exSh);
  if (exclRows.length) exSh.getRange(2, 1, exclRows.length, 4).setValues(exclRows);
  applyFormat_(exSh, TABS.excluded.header.length);

  forceMoveCheckboxes_(['Excluded']);

  // Resurrected stale tickers now live on Sort - drop them from their reference list.
  Object.keys(resurrectedByTab).forEach(function (tn) {
    removeTickersFromRefTab_(tn, resurrectedByTab[tn]);
  });

  logHistory_('Run Crosscheck', 'Clean Pull', considered + ' in - ' + sortRows.length +
    ' SORT (incl ' + resurrected + ' re-review, ' + drift + ' DB drift, ' + nearMatch +
    ' near-match), ' + exclRows.length + ' EXCLUDED' +
    (flagged ? ', ' + flagged + ' skipped (flagged ticker)' : ''));
  toast_('Crosscheck: ' + sortRows.length + ' SORT' +
    (nearMatch ? ' (incl ' + nearMatch + ' near-match)' : '') +
    (resurrected ? ' (' + resurrected + ' re-review)' : '') +
    (drift ? ' (' + drift + ' DB drift)' : '') + ', ' +
    exclRows.length + ' EXCLUDED' +
    (flagged ? ', ' + flagged + ' flagged-ticker skipped' : '') + '.');
}

/** Rewrite a reference list excluding rows whose normalized ticker is in tickerSet. */
function removeTickersFromRefTab_(tabName, tickerSet) {
  var sh = SpreadsheetApp.getActive().getSheetByName(tabName);
  if (!sh) return;
  var lr = sh.getLastRow();
  if (lr < 2) return;
  var dataCols = MOVABLE[tabName] ? MOVABLE[tabName].selectCol - 1 : (headerLenByName_(tabName) || sh.getLastColumn());
  var kept = sh.getRange(2, 1, lr - 1, dataCols).getValues().filter(function (r) {
    var t = normTicker_(r[1]);
    return !(t && tickerSet[t]);
  });
  clearBody_(sh);
  if (kept.length) sh.getRange(2, 1, kept.length, dataCols).setValues(kept);
  applyFormat_(sh, headerLenByName_(tabName));
  forceMoveCheckboxes_([tabName]);
}

/** Ticker root: symbol with any exchange suffix stripped (ABC.L -> ABC). */
function tickerRoot_(t) {
  var nt = normTicker_(t);
  var i = nt.indexOf('.');
  return i > 0 ? nt.slice(0, i) : nt;
}

/** Pairwise fuzzy test - do not alter thresholds, intentionally conservative:
 *  first-5-chars OR containment OR first-two-words. */
function fuzzyPair_(a, b) {
  if (!a || !b) return false;
  if (a.slice(0, 5) === b.slice(0, 5)) return true;
  if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return true;
  var a2 = a.split(' ').slice(0, 2).join(' ');
  var b2 = b.split(' ').slice(0, 2).join(' ');
  return a2.indexOf(' ') > 0 && a2 === b2;
}

function fuzzyConfirm_(candNorm, entries) {
  for (var i = 0; i < entries.length; i++) {
    if (fuzzyPair_(candNorm, entries[i].norm)) return entries[i];
  }
  return null;
}

/* ===================== CONCURRENCY - DOCUMENT LOCK ================================== */

/* The routing / move / distribute actions append to shared tabs (Watchlist, Adds,
 * FR / Confirmed Exclude) one row at a time, and the duplicate guard
 * (findExistingRow_ then appendRow) is a check-then-act. Two interns running Clean-up at
 * the same time could interleave those appends and double-create a row. withDocLock_
 * serialises these entry points on a document-wide lock. The _holdingDocLock flag
 * (module-level, reset each execution) keeps it reentrant-safe should one wrapped action
 * ever call another within the same run. If the lock cannot be taken in 20s the action is
 * a no-op and the operator is asked to retry - nothing is half-written. */
var _holdingDocLock = false;
function withDocLock_(fn) {
  if (_holdingDocLock) return fn();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) {
    toast_('Another DARB action is running - please retry in a moment.');
    return;
  }
  _holdingDocLock = true;
  try { return fn(); } finally { _holdingDocLock = false; lock.releaseLock(); }
}

/* Public entry points (menu / on-sheet buttons) -> locked wrappers around the _impl_ body. */
function distributeSelected() { if (!stepGuard_(4)) return; return withDocLock_(distributeSelected_impl_); }
function cleanupActiveTab()   { if (!stepGuard_(5)) return; return withDocLock_(cleanupActiveTab_impl_); }
function processReviews()     { if (!stepGuard_(6)) return; return withDocLock_(processReviews_impl_); }
function moveSelected()       { return withDocLock_(moveSelected_impl_); }

/* ===================== STEP 3 - DISTRIBUTE, REVIEW & ROUTE ========================== */

/** Move checked Sort rows to the chosen intern tab. Stamps Date Assigned + Due Date.
 *  Sort row: 0 Company | 1 Ticker | 2 RevAssign | 3 RevDate | 4 Analyst | 5 Analyst Note |
 *            6 Tier | 7 Sector | 8 Source | 9 Note | 10 Select | 11 Assign To           */
function distributeSelected_impl_() {
  scaffoldAll_();
  var ss = SpreadsheetApp.getActive();
  var sortSh = ss.getSheetByName(TABS.sort.name);
  var lr = sortSh.getLastRow();
  if (lr < 2) { toast_('Sort tab is empty.'); return; }

  var interns = {};
  getInternSheets_().forEach(function (sh) { interns[internName_(sh)] = sh; });

  var vals = sortSh.getRange(2, 1, lr - 1, 14).getValues();
  var today = new Date();
  var due = addBusinessDays_(today, 5);
  var moved = 0, skipped = 0, dups = 0, toDelete = [], touched = {}, pendingKeys = {};

  vals.forEach(function (r, i) {
    if (r[2] !== true) return;                       // Select checkbox (col C)
    var who = String(r[4] || '').trim();             // Assign To (col E)
    if (!who || (!interns[who] && ANALYST_OPTIONS.indexOf(who) < 0)) { skipped++; return; }
    var sh = interns[who] || (interns[who] = ensureInternTab_(who)); // create the tab on demand
    // Idempotency guard: Sort rows are only deleted after the whole loop, so a run that dies
    // mid-way leaves already-appended rows behind on Sort. Re-running must not hand the same
    // company out twice - if it is already PENDING on the target tab (routed audit rows do not
    // block a legitimate future re-review), just drop the Sort row.
    var keys = pendingKeys[who] || (pendingKeys[who] = pendingInternKeys_(sh));
    var kT = normTicker_(r[1]), kN = normName_(r[0]);
    if (kT ? keys['t:' + kT] : (kN && keys['n:' + kN])) {
      dups++;
      toDelete.push(i + 2);
      return;
    }
    // Intern row (18 cols): default Primary Business Name to the AlphaSense name and seed the
    // Description / Inclusion / Tiering Rationale labels. Pure-Play, Website URLs and Source
    // Documents start blank for the analyst to fill.
    sh.appendRow([r[0], r[1], '', '', who, r[0], DESC_PREFIX,
      withPrefix_(r[8], RATIONALE_PREFIX), withPrefix_(r[9], TIER_RATIONALE_PREFIX), r[10] || '', r[11] || '', '',
      '', '', r[12] || '', r[13] || '', today, due]);
    formatRow_(sh, sh.getLastRow(), INTERN_WIDTH);
    if (kT) keys['t:' + kT] = true;
    if (kN) keys['n:' + kN] = true;
    touched[who] = sh;
    toDelete.push(i + 2);
    moved++;
  });

  for (var j = toDelete.length - 1; j >= 0; j--) sortSh.deleteRow(toDelete[j]); // no double-handout
  Object.keys(touched).forEach(function (k) { reorganizeInternTab_(touched[k]); }); // new rows above Completed block
  scaffoldInternSheets_();                            // refresh dropdowns on new rows
  Object.keys(touched).forEach(function (k) { applyFormat_(touched[k], INTERN_WIDTH); });
  restyleTabs_([TABS.sort.name]);                     // refresh Sort filter/banding after row deletes

  logHistory_('Distribute Selected', 'Sort', moved + ' row(s) distributed' +
    (dups ? ' - ' + dups + ' already pending on the target tab (duplicate handout removed from Sort)' : '') +
    (skipped ? ' - ' + skipped + ' skipped (no valid Assign To)' : ''));
  toast_('Distributed ' + moved + ' row(s).' +
    (dups ? ' ' + dups + ' already pending on the target tab (deduped).' : '') +
    (skipped ? ' ' + skipped + ' checked row(s) skipped - set Assign To.' : ''));
}

/** Normalized ticker/name keys of the PENDING (not yet routed) rows on an intern tab.
 *  Used by Distribute to keep partial-run re-runs from handing a company out twice. */
function pendingInternKeys_(sh) {
  var set = {};
  var lr = sh.getLastRow();
  if (lr < 2) return set;
  sh.getRange(2, 1, lr - 1, 4).getValues().forEach(function (r) {
    if (r[3]) return;                                // routed (date stamped) - not pending
    var n = String(r[0] || '').trim();
    if (n === COMPLETED_MARKER) return;
    var t = normTicker_(r[1]);
    if (t) set['t:' + t] = true;
    var nn = normName_(n);
    if (nn) set['n:' + nn] = true;
  });
  return set;
}

/** Clean-up button: route reviewed rows on the intern tab currently open. */
function cleanupActiveTab_impl_() {
  // Capture the active tab BEFORE scaffolding - a first-time Dashboard build inside
  // scaffoldAll_ switches the active sheet, which used to make this route the wrong tab.
  var ss = SpreadsheetApp.getActive();
  var name = ss.getActiveSheet().getName();
  if (!ANALYST_BY_FIRST.hasOwnProperty(name)) {
    toast_('Open an analyst review tab (named by first name), then run Clean-up.');
    return;
  }
  scaffoldAll_();
  var sh = ss.getSheetByName(name);
  var counts = { 'Add': 0, 'Watchlist': 0, 'FR Exclude': 0, 'Confirmed Exclude': 0, 'In DB': 0 };
  var skipped = routeSheetRows_(sh, counts);
  reorganizeInternTab_(sh);
  scaffoldInternSheets_();
  restyleTabs_(['Watchlist', 'FR Exclude', 'Confirmed Exclude', TABS.adds.name]);
  forceMoveCheckboxes_(['Watchlist', 'FR Exclude', 'Confirmed Exclude']);
  var total = counts['Add'] + counts['Watchlist'] + counts['FR Exclude'] +
    counts['Confirmed Exclude'] + counts['In DB'];
  logRoutingOutcomes_('Clean-up This Tab', name, counts, skipped, total + ' routed');
  toast_('Clean-up "' + name + '": ' + total + ' routed.' +
    (counts._recovered ? ' ' + counts._recovered + ' recovered from a prior incomplete run.' : '') +
    (counts._updated ? ' ' + counts._updated + ' updated existing.' : '') +
    (counts._dups ? ' ' + counts._dups + ' already staged (deduped).' : '') +
    (counts._verified ? ' ' + counts._verified + ' already routed (verified).' : '') +
    (skipped ? ' ' + skipped + ' skipped - see History Log for per-row reasons.' : '') +
    (counts._errors ? ' ' + counts._errors + ' ERROR(S) - see History Log.' : ''));
}

/** Backstop: sweep ALL intern tabs and route eligible rows. */
function processReviews_impl_() {
  scaffoldAll_();
  var counts = { 'Add': 0, 'Watchlist': 0, 'FR Exclude': 0, 'Confirmed Exclude': 0, 'In DB': 0 };
  var skipped = 0;
  getInternSheets_().forEach(function (sh) {
    skipped += routeSheetRows_(sh, counts);
    reorganizeInternTab_(sh);
  });
  scaffoldInternSheets_();
  restyleTabs_(['Watchlist', 'FR Exclude', 'Confirmed Exclude', TABS.adds.name]);
  forceMoveCheckboxes_(['Watchlist', 'FR Exclude', 'Confirmed Exclude']);
  logRoutingOutcomes_('Process Reviews', 'All intern tabs', counts, skipped,
    'Add ' + counts['Add'] + ', Watchlist ' + counts['Watchlist'] +
    ', FR Exclude ' + counts['FR Exclude'] + ', Confirmed Exclude ' + counts['Confirmed Exclude'] +
    ', In DB ' + counts['In DB']);
  toast_('Routed - Add: ' + counts['Add'] + ', Watchlist: ' + counts['Watchlist'] +
    ', FR Excl: ' + counts['FR Exclude'] + ', Conf Excl: ' + counts['Confirmed Exclude'] +
    ', In DB: ' + counts['In DB'] +
    (counts._recovered ? '. ' + counts._recovered + ' recovered' : '') +
    (counts._dups ? '. ' + counts._dups + ' deduped' : '') +
    (skipped ? '. Skipped ' + skipped + ' row(s) - see History Log.' : '.') +
    (counts._errors ? ' ' + counts._errors + ' ERROR(S) - see History Log.' : ''));
}

/**
 * VERBOSE ROUTING LOG. Writes the run summary to the History Log (drives the Dashboard step
 * status) plus a second "Routing Outcomes" history row with one line per company processed,
 * and mirrors the full per-row ledger (including PENDING rows) to the Apps Script execution
 * log (Extensions > Apps Script > Executions). Every company on the swept tab(s) ends the run
 * with exactly one outcome line: ROUTED / OK (verified) / SKIPPED (reason) / ERROR (failure
 * point) / PENDING (no assignment yet).
 */
function logRoutingOutcomes_(action, source, counts, skipped, summaryPrefix) {
  var log = counts._log || [];
  log.forEach(function (l) { Logger.log(l); });
  var summary = summaryPrefix +
    (counts._recovered ? ' (' + counts._recovered + ' recovered from a prior incomplete run)' : '') +
    (counts._updated ? ' (' + counts._updated + ' stamped onto existing list rows)' : '') +
    (counts._verified ? ' - ' + counts._verified + ' already routed (verified on destination)' : '') +
    (counts._dups ? ' - ' + counts._dups + ' already staged (deduped)' : '') +
    (skipped ? ' - ' + skipped + ' skipped (per-row reasons in Routing Outcomes)' : '') +
    (counts._errors ? ' - ' + counts._errors + ' ERROR(S)' : '');
  logHistory_(action, source, summary);
  // Per-company outcomes on their own history row (PENDING lines stay in the execution log
  // to keep the cell readable). 'Routing Outcomes' is not in STEP_BY_ACTION, so it never
  // overwrites the Dashboard status.
  var detail = log.filter(function (l) { return l.indexOf('PENDING') !== 0; });
  if (detail.length) {
    var text = detail.join('\n');
    if (text.length > 4500) {
      text = text.slice(0, 4500) + '\n... truncated - full log under Extensions > Apps Script > Executions';
    }
    logHistory_('Routing Outcomes', source, text);
  }
}

/** Route all eligible rows on one intern sheet. Returns skipped count.
 *  Every non-blank row ends with exactly one outcome line in counts._log:
 *    ROUTED  - written to its destination this run (incl. recovered / dedup-stamped rows)
 *    OK      - already routed on a previous run, verified present on its destination
 *    SKIPPED - not routed, with the exact reason
 *    ERROR   - routing threw, with the failure point (row left un-stamped so it retries)
 *    PENDING - no Review Assignement yet (not processed)
 *  A pre-set Ticker Reviewed Date used to be skipped silently; that hid rows whose date was
 *  hand-entered (or pasted from a reference list - the first 5 columns align) and buried them
 *  under the Completed block without ever writing the destination. Those rows are now VERIFIED
 *  against their destination and re-routed when missing, so partial or stale runs self-heal. */
function routeSheetRows_(sh, counts) {
  var lr = sh.getLastRow();
  if (lr < 2) return 0;
  var ss = SpreadsheetApp.getActive();
  var skipped = 0;
  var log = counts._log = counts._log || [];
  var tab = sh.getName();
  var vals = sh.getRange(2, 1, lr - 1, INTERN_WIDTH).getValues();
  vals.forEach(function (r, i) {
    var company = String(r[0] || '').trim(), ticker = String(r[1] || '').trim();
    if (!company && !ticker) return;                  // blank spacer row
    if (company === COMPLETED_MARKER) return;         // audit-block marker row
    var who = tab + '!' + (i + 2) + ' ' + (company || '(no name)') +
      (ticker ? ' [' + ticker + ']' : '');
    var assignment = String(r[2] || '').trim();
    if (!assignment) {
      if (r[3]) {                                     // date but no decision - never bury silently
        skipped++;
        log.push('SKIPPED ' + who + ' - Ticker Reviewed Date is set but Review Assignement is ' +
          'blank; set an assignment so it can route (or clear the date).');
      } else {
        log.push('PENDING ' + who + ' - no Review Assignement yet.');
      }
      return;
    }
    if (ASSIGN_OPTIONS.indexOf(assignment) < 0) {
      skipped++;
      log.push('SKIPPED ' + who + ' - invalid Review Assignement "' + assignment +
        '" (must be one of: ' + ASSIGN_OPTIONS.join(' / ') + ').');
      return;
    }
    if (r[3]) {
      // Date already stamped: either routed on a previous run, or hand-entered/pasted.
      // Verify the destination actually holds the record; re-route it when it does not.
      var seenOn = verifyRoutedDest_(ss, assignment, normTicker_(ticker), normName_(company));
      if (seenOn) {
        counts._verified = (counts._verified || 0) + 1;
        log.push('OK ' + who + ' - already routed (' + assignment + '; verified on ' + seenOn + ').');
        return;
      }
      var reasonV = requiredReason_(assignment, r);
      if (reasonV) {
        skipped++;
        log.push('SKIPPED ' + who + ' - reviewed date is set but the record is NOT on "' +
          assignment + '" and it cannot be re-routed: ' + reasonV);
        return;
      }
      try {
        var st2 = routeRow_(sh, i + 2, r, assignment);
        counts._recovered = (counts._recovered || 0) + 1;
        if (st2 === 'dup') counts._dups = (counts._dups || 0) + 1;
        else counts[assignment]++;
        if (st2 === 'updated') counts._updated = (counts._updated || 0) + 1;
        log.push('ROUTED ' + who + ' -> ' + assignment + ' (RECOVERED: reviewed date was ' +
          'already set but the record was missing from the destination).');
      } catch (errV) {
        counts._errors = (counts._errors || 0) + 1;
        skipped++;
        log.push('ERROR ' + who + ' - re-route to ' + assignment + ' failed: ' + errV.message);
      }
      return;
    }
    var reason = requiredReason_(assignment, r);
    if (reason) {
      skipped++;
      log.push('SKIPPED ' + who + ' - ' + reason);
      return;
    }
    try {
      var status = routeRow_(sh, i + 2, r, assignment); // 'added' | 'updated' | 'dup' | 'indb'
      if (status === 'dup') {
        counts._dups = (counts._dups || 0) + 1;         // already staged elsewhere
        log.push('ROUTED ' + who + ' -> ' + assignment + ' (already staged on Adds - deduped, marked routed).');
      } else {
        counts[assignment]++;                           // added / updated / in-DB all count as routed
        if (status === 'updated') {
          counts._updated = (counts._updated || 0) + 1;
          log.push('ROUTED ' + who + ' -> ' + assignment + ' (stamped onto the existing destination row).');
        } else if (status === 'indb') {
          log.push('ROUTED ' + who + ' - In DB (already in Current DB; nothing appended).');
        } else {
          log.push('ROUTED ' + who + ' -> ' + assignment + '.');
        }
      }
    } catch (err) {
      // One bad row must not abort the sweep: the row stays un-stamped (routeRow_ stamps the
      // date last), so it is retried automatically on the next run.
      counts._errors = (counts._errors || 0) + 1;
      skipped++;
      log.push('ERROR ' + who + ' - routing to ' + assignment + ' failed: ' + err.message +
        ' (row left un-stamped; it will retry next run).');
    }
  });
  return skipped;
}

/**
 * FINAL VALIDATION for rows whose Ticker Reviewed Date is already set: return the tab the
 * record was actually found on, or '' when it is missing from its destination (=> the stamp
 * is stale / hand-entered and the row must be re-routed). 'Add' rows are satisfied by the
 * Adds staging tab, Current DB (after the Kintone import lands) or the Watchlist hold row;
 * 'In DB' writes nothing by design, so a stamped In DB row is always satisfied.
 */
function verifyRoutedDest_(ss, assignment, nT, nN) {
  function on(tabName, nCol, tCol) {
    var s = ss.getSheetByName(tabName);
    return (s && findExistingRow_(s, nCol, tCol, nT, nN) > 0) ? tabName : '';
  }
  if (assignment === 'In DB') return 'Current DB (In DB writes no list row)';
  if (assignment === 'Watchlist') return on('Watchlist', 1, 2);
  if (assignment === 'FR Exclude' || assignment === 'Confirmed Exclude') return on(assignment, 1, 2);
  if (assignment === 'Add') {
    return on(TABS.adds.name, 5, 7) || on(TABS.currentDb.name, 1, 2) || on('Watchlist', 1, 2);
  }
  return '';
}

var COMPLETED_MARKER = 'Completed - routed (audit)';

/** Pending rows on top, routed rows under a Completed block at the bottom. */
function reorganizeInternTab_(sh) {
  var lr = sh.getLastRow();
  if (lr < 2) return;
  var vals = sh.getRange(2, 1, lr - 1, INTERN_WIDTH).getValues();
  var pending = [], done = [];
  vals.forEach(function (r) {
    var a = String(r[0] || '').trim();
    if (!a && !String(r[1] || '').trim()) return;     // blank spacer rows
    if (a === COMPLETED_MARKER) return;               // old marker rows
    // Routed = script-stamped: Ticker Reviewed Date AND a Review Assignement (routeRow_ always
    // sets both). A hand-entered date alone must stay pending - filing it under the Completed
    // block used to bury rows that were never actually written to their destination.
    (r[3] && String(r[2] || '').trim() ? done : pending).push(r);
  });
  if (!done.length) return;                           // nothing routed yet
  clearBody_(sh);
  if (pending.length) sh.getRange(2, 1, pending.length, INTERN_WIDTH).setValues(pending);
  var markerRow = 2 + pending.length + 1;             // one blank spacer row
  sh.getRange(markerRow, 1).setValue(COMPLETED_MARKER);
  sh.getRange(markerRow + 1, 1, done.length, INTERN_WIDTH).setValues(done);
  applyFormat_(sh, INTERN_WIDTH);
  sh.getRange(markerRow, 1, 1, INTERN_WIDTH).setFontWeight('bold');
  sh.getRange(markerRow + 1, 1, done.length, INTERN_WIDTH).setFontLine('line-through');
}

/** Required fields per choice - rows missing them are skipped, never mis-routed.
 *  Returns '' when the row is routable, otherwise the exact skip reason.
 *  NOTE: Tier lives at index 9 (col J) since the Tiering Rationale column was inserted at
 *  index 8 - the old r[8] check silently tested the wrong column after that layout change. */
function requiredReason_(assignment, r) {
  if (!String(r[0] || '').trim()) return 'missing Company Name (col A).';
  if (!String(r[1] || '').trim()) return 'missing Ticker (col B).';
  if (assignment === 'Add' && !String(r[9] || '').trim()) {
    return 'missing If Add Recomended Tier (col J) - required for Add.';
  }
  return '';
}

/**
 * Route one reviewed intern row to its destination. Routed rows are NOT deleted -
 * Ticker Reviewed Date is stamped and the row is struck through for audit.
 * When the company (by ticker, or name if ticker blank) is already on a reference list
 * (Watchlist / FR Exclude / Confirmed Exclude), the review is STAMPED onto that existing
 * row rather than dropped - otherwise the routed row vanishes and the pre-existing row keeps
 * a blank Ticker Reviewed Date, so Crosscheck re-surfaces the ticker for review every cycle.
 * Returns a status string: 'added' (new dest row), 'updated' (stamped an existing dest row),
 * 'dup' (already staged on Adds - skipped) or 'indb' (In DB - nothing to write).
 * Intern row (18 cols):
 *   0 Company | 1 Ticker | 2 RevAssign | 3 RevDate | 4 Analyst | 5 Primary Business Name |
 *   6 Description | 7 Inclusion Rationale | 8 Tiering Rationale | 9 Tier | 10 Sector |
 *   11 Pure-Play | 12 Website URLs | 13 Source Documents | 14 Source | 15 Note |
 *   16 Date Assigned | 17 Due Date
 */
function routeRow_(internSh, rowNum, r, assignment) {
  var ss = SpreadsheetApp.getActive();
  var today = new Date();
  var company = r[0], ticker = r[1];
  var nT = normTicker_(ticker), nN = normName_(company);
  var analyst = String(r[4] || '').trim() || internName_(internSh);
  var pbn = String(r[5] || '').trim() || company;   // canonical name; default to the AlphaSense name
  var desc = r[6], inclusion = r[7], tiering = r[8], tier = r[9], sector = r[10], pureplay = r[11];
  var websites = r[12], sourceDocs = r[13];
  var source = r[14], note = r[15];
  var status = 'added';

  if (assignment === 'Watchlist') {
    var wl = ss.getSheetByName('Watchlist');
    if (!wl) throw new Error('destination tab "Watchlist" not found');
    var wlRow = findExistingRow_(wl, 1, 2, nT, nN);
    if (wlRow > 0) {
      // Already on the Watchlist (commonly a bare export / legacy row) - stamp the review onto
      // it so the reviewed date is recorded and the ticker stops re-surfacing in Crosscheck.
      stampReviewOnDest_(wl, wlRow, assignment, today, analyst, inclusion, tier, source, note, sector, true);
      status = 'updated';
    } else {
      wl.appendRow([company, ticker, assignment, today, analyst, inclusion,
        tier, source, note, tickerFlag_(ticker), '', sector, '']); // ...Record#, Sector, ISIN (13 wide)
      formatRow_(wl, wl.getLastRow(), TABS.watchlist.header.length);
    }
  } else if (assignment === 'FR Exclude' || assignment === 'Confirmed Exclude') {
    var dest = ss.getSheetByName(assignment);
    if (!dest) throw new Error('destination tab "' + assignment + '" not found');
    var destRow = findExistingRow_(dest, 1, 2, nT, nN);
    if (destRow > 0) {
      stampReviewOnDest_(dest, destRow, assignment, today, analyst, inclusion, tier, source, note, sector, false);
      status = 'updated';
    } else {
      dest.appendRow([company, ticker, assignment, today, analyst, inclusion,
        tier, source, note, tickerFlag_(ticker)]);
      formatRow_(dest, dest.getLastRow(),
        TABS[assignment === 'FR Exclude' ? 'frExclude' : 'confirmedExclude'].header.length);
    }
  } else if (assignment === 'Add') {
    var addsSh = ss.getSheetByName(TABS.adds.name);
    if (!addsSh) throw new Error('destination tab "' + TABS.adds.name + '" not found');
    var wlAdd = ss.getSheetByName('Watchlist');
    if (!wlAdd) throw new Error('destination tab "Watchlist" not found (Add hold row)');
    if (findExistingRow_(addsSh, 5, 7, nT, nN) > 0) {
      status = 'dup';                               // already staged on Adds - no duplicate
    } else {
      // Adds row (17 cols): Imported?, Select, Analyst, New Record Flag, AS Business Name,
      // Primary Business Name, AlphaSense Ticker, Profile Review - Action Status, CRBM Tier,
      // Pure-Play, Sector, Primary Business Description, Inclusion Rationale, Tiering Rationale,
      // Folder Name, Website URLs, Source Documents. Desc / Inclusion / Tiering seeded with labels.
      addsSh.appendRow([false, false, analyst, '*', company, pbn, ticker, ACTION_STATUS_DEFAULT,
        tier, pureplay, sector, withPrefix_(desc, DESC_PREFIX),
        withPrefix_(inclusion, RATIONALE_PREFIX), tiering || '', '', websites, sourceDocs]);
      var ar = addsSh.getLastRow();
      addsSh.getRange(ar, 15).setFormula('=F' + ar);   // Folder Name mirrors Primary Business Name (col F)
      addsSh.getRange(ar, 1, 1, 2).insertCheckboxes(); // Imported? / Select = False
      formatRow_(addsSh, ar, TABS.adds.header.length);
      // Hold on Watchlist until it appears Active in a DB refresh (then it graduates off).
      if (findExistingRow_(wlAdd, 1, 2, nT, nN) <= 0) {
        var pendNote = String(note || '').trim();
        pendNote = pendNote ? pendNote + ' - Pending Kintone Add' : 'Pending Kintone Add';
        wlAdd.appendRow([company, ticker, 'Add', today, analyst, inclusion, tier,
          source, pendNote, tickerFlag_(ticker), '', sector, '']);
        formatRow_(wlAdd, wlAdd.getLastRow(), TABS.watchlist.header.length);
      }
    }
  } else if (assignment === 'In DB') {
    status = 'indb';   // already in Current DB - no list to append; row is struck through below
  }

  internSh.getRange(rowNum, 4).setValue(today);
  internSh.getRange(rowNum, 1, 1, INTERN_WIDTH).setFontLine('line-through');
  return status;
}

/**
 * Stamp an intern's review onto an EXISTING reference-list row (a dedup hit) so the routed
 * decision is recorded instead of silently dropped. Writes Review Assignement + Ticker
 * Reviewed Date + Analyst, and refreshes the Ps Note / tier / source / note (and Sector on
 * the Watchlist) when the intern supplied a value. Reference lists share REF_SCHEMA cols 1-10;
 * Watchlist additionally carries Sector at col 12. Stamping the reviewed date is what stops
 * Crosscheck from re-surfacing the ticker every cycle.
 *   col 3 Review Assignement | 4 Ticker Reviewed Date | 5 Analyst | 6 Ps Note |
 *   7 If Add Recomended Tier | 8 Source | 9 Note | 12 Sector (Watchlist only)
 */
function stampReviewOnDest_(sh, row, assignment, today, analyst, inclusion, tier, source, note, sector, hasSector) {
  sh.getRange(row, 3).setValue(assignment);                 // Review Assignement
  sh.getRange(row, 4).setValue(today);                      // Ticker Reviewed Date
  if (String(analyst || '').trim())   sh.getRange(row, 5).setValue(analyst);
  if (String(inclusion || '').trim()) sh.getRange(row, 6).setValue(inclusion); // Ps Note
  if (String(tier || '').trim())      sh.getRange(row, 7).setValue(tier);
  if (String(source || '').trim())    sh.getRange(row, 8).setValue(source);
  if (String(note || '').trim())      sh.getRange(row, 9).setValue(note);
  if (hasSector && String(sector || '').trim()) sh.getRange(row, 12).setValue(sector);
}

/* ============ MOVE BETWEEN LISTS (reclassification, incl. back to Sort) ============= */

/** Prepend a label prefix unless the text already starts with it. Blank -> just the label. */
function withPrefix_(text, prefix) {
  var t = String(text || '').trim();
  if (!t) return prefix;
  if (t.toUpperCase().indexOf(prefix.toUpperCase()) === 0) return t;
  return prefix + ' ' + t;
}

/**
 * Reclassify rows from the ACTIVE list. On a movable tab (Sort, Excluded,
 * Watchlist, FR Exclude, Confirmed Exclude) tick Select, choose a
 * Move To destination, then run this. Each selected row is copied to the destination and
 * removed from the source.
 *   Sort                -> re-enters the intern pipeline (context kept in the Note);
 *                          tick Select + Assign To on Sort, then Distribute.
 *   Watchlist / FR / Confirmed -> moves straight onto that reference list.
 *   Remove              -> deletes from the source only (no destination).
 * Does NOT scaffold first, so it never clears the ticks you just set.
 */
function moveSelected_impl_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getActiveSheet();
  var name = sh.getName();
  var cfg = MOVABLE[name];
  if (!cfg) {
    toast_('Open a list with a Move To column (Sort, Excluded, Watchlist, ' +
      'FR Exclude, Confirmed Exclude), tick rows, choose Move To, then run this.');
    return;
  }
  var lr = sh.getLastRow();
  if (lr < 2) { toast_('Nothing to move on "' + name + '".'); return; }

  var vals = sh.getRange(2, 1, lr - 1, sh.getLastColumn()).getValues();
  var today = new Date();
  var moved = { 'Sort': 0, 'Watchlist': 0, 'FR Exclude': 0, 'Confirmed Exclude': 0, 'Remove': 0 };
  var skipped = 0, dups = 0, toDelete = [], touchedDest = {};

  vals.forEach(function (r, i) {
    if (r[cfg.selectCol - 1] !== true) return;              // Select checkbox
    var dest = String(r[cfg.moveCol - 1] || '').trim();     // Move To
    if (MOVE_OPTIONS.indexOf(dest) < 0) { skipped++; return; }
    var company = String(r[cfg.company] || '').trim();
    var ticker = String(r[cfg.ticker] || '').trim();
    if (!company && !ticker) { skipped++; return; }
    if (dest !== 'Remove') {
      var ap = moveWriteDest_(dest, {
        company: company, ticker: ticker, source: name,
        note: cfg.note ? cfg.note(r) : '',
        tier: cfg.tier !== undefined ? r[cfg.tier] : '',
        sector: cfg.sector !== undefined ? r[cfg.sector] : '',
        analyst: cfg.analyst !== undefined ? r[cfg.analyst] : ''
      }, today);
      if (!ap) dups++;                                       // already on destination
      touchedDest[dest] = true;
    }
    moved[dest]++;
    toDelete.push(i + 2);
  });

  for (var j = toDelete.length - 1; j >= 0; j--) sh.deleteRow(toDelete[j]);

  // Restyle source + every touched destination, then refresh their controls.
  applyFormat_(sh, headerLenByName_(name));
  forceMoveCheckboxes_([name]);
  Object.keys(touchedDest).forEach(function (d) {
    var tn = (d === 'Sort') ? TABS.sort.name : d;
    var ds = ss.getSheetByName(tn);
    if (ds) applyFormat_(ds, headerLenByName_(tn));
  });
  if (touchedDest['Sort']) refreshSortValidations_();
  var movableDest = Object.keys(touchedDest).filter(function (d) { return MOVABLE[d]; });
  if (movableDest.length) forceMoveCheckboxes_(movableDest);

  var total = moved['Sort'] + moved['Watchlist'] + moved['FR Exclude'] +
    moved['Confirmed Exclude'] + moved['Remove'];
  logHistory_('Move Selected', name, total + ' moved - Sort ' + moved['Sort'] +
    ', Watchlist ' + moved['Watchlist'] + ', FR Exclude ' + moved['FR Exclude'] +
    ', Confirmed Exclude ' + moved['Confirmed Exclude'] + ', Removed ' + moved['Remove'] +
    (dups ? ' - ' + dups + ' already on destination (deduped)' : '') +
    (skipped ? ' - ' + skipped + ' skipped (no Move To set)' : ''));
  toast_('Moved ' + total + ' row(s) from "' + name + '".' +
    (dups ? ' ' + dups + ' already on destination (deduped).' : '') +
    (skipped ? ' ' + skipped + ' skipped - set Move To.' : ''));
}

/** Write one reclassified row to its destination list. Returns true if appended, false if
 *  the company was already on that list (duplicate skip). */
function moveWriteDest_(dest, d, today) {
  var ss = SpreadsheetApp.getActive();
  var nT = normTicker_(d.ticker), nN = normName_(d.company);
  if (dest === 'Sort') {
    var sortSh = ss.getSheetByName(TABS.sort.name);
    if (findExistingRow_(sortSh, 1, 2, nT, nN) > 0) return false;
    // Sort: Company|Ticker|Select|Move To|Assign To|RevAssign|RevDate|Analyst|Inclusion|Tiering|Tier|Sector|Source|Note
    sortSh.appendRow([d.company, d.ticker, false, '', '', '', '', '', '', '', d.tier || '', d.sector || '',
      d.source, d.note || '']);
    var sr = sortSh.getLastRow();
    sortSh.getRange(sr, 3).insertCheckboxes();               // Select (col C)
    formatRow_(sortSh, sr, TABS.sort.header.length);
  } else if (dest === 'Watchlist') {
    var wl = ss.getSheetByName('Watchlist');
    var wlRow = findExistingRow_(wl, 1, 2, nT, nN);
    if (wlRow > 0) {                                  // already listed - stamp the move onto it
      stampReviewOnDest_(wl, wlRow, 'Watchlist', today, d.analyst || '', d.note || '',
        d.tier || '', d.source, d.note || '', d.sector || '', true);
      return false;
    }
    wl.appendRow([d.company, d.ticker, 'Watchlist', today, d.analyst || '', d.note || '',
      d.tier || '', d.source, d.note || '', tickerFlag_(d.ticker), '', d.sector || '', '']);
    formatRow_(wl, wl.getLastRow(), TABS.watchlist.header.length);
  } else if (dest === 'FR Exclude' || dest === 'Confirmed Exclude') {
    var ex = ss.getSheetByName(dest);
    var exRow = findExistingRow_(ex, 1, 2, nT, nN);
    if (exRow > 0) {                                  // already listed - stamp the move onto it
      stampReviewOnDest_(ex, exRow, dest, today, d.analyst || '', d.note || '',
        d.tier || '', d.source, d.note || '', d.sector || '', false);
      return false;
    }
    ex.appendRow([d.company, d.ticker, dest, today, d.analyst || '', d.note || '',
      d.tier || '', d.source, d.note || '', tickerFlag_(d.ticker)]);
    formatRow_(ex, ex.getLastRow(),
      TABS[dest === 'FR Exclude' ? 'frExclude' : 'confirmedExclude'].header.length);
  }
  return true;
}

/* =============== STEP 4 - KINTONE BULK-UPLOAD FORMATTER (SINGLE TAB) ================ */

/**
 * Build the single "Kintone Upload" tab from qualified Adds. Column order matches the
 * KINTONE uPLOAD FORMAT template (see KINTONE_FORMAT.md): cols 1-12 are the parent profile,
 * 13-14 the Website subtable (pink), 15-19 the Source Documents subtable (yellow). Per
 * record we emit one row per Source Document then one row per Website URL; the parent fields
 * are repeated on every row and the New record flag "*" sits on the first row only.
 * Source docs come from the Adds "Source Documents" cell ("Name | Note | URL | Date" per
 * line); websites from "Website URLs" ("Type | URL" per line).
 * Which rows qualify: if any Adds "Select" box is ticked, only ticked rows; otherwise every
 * Adds row whose "Imported?" box is unticked AND that is not already in Current DB.
 */
function buildKintoneUpload() {
  scaffoldAll_();
  if (!stepGuard_(7)) return;
  var ss = SpreadsheetApp.getActive();
  var adds = ss.getSheetByName(TABS.adds.name);
  var lr = adds.getLastRow();
  if (lr < 2) { toast_('Adds tab is empty - nothing to format.'); return; }
  var width = TABS.adds.header.length; // 17
  var vals = adds.getRange(2, 1, lr - 1, width).getValues();
  var anySel = vals.some(function (r) { return r[1] === true; });  // Select = col B

  // Current DB membership = "already a record in Kintone" - the source of truth (populated by
  // Refresh DB References). Used to skip re-exporting tracked profiles.
  var dbTick = {}, dbName = {};
  var dbSh = ss.getSheetByName(TABS.currentDb.name);
  if (dbSh && dbSh.getLastRow() >= 2) {
    dbSh.getRange(2, 1, dbSh.getLastRow() - 1, 2).getValues().forEach(function (d) {
      var t = normTicker_(d[1]); if (t) dbTick[t] = true;
      var nn = normName_(d[0]); if (nn) dbName[nn] = true;
    });
  }
  function inDb_(r) {                                 // match by ticker (col G), name fallback
    var nT = normTicker_(r[6]), nN = normName_(r[5]) || normName_(r[4]);
    return nT ? !!dbTick[nT] : (nN ? !!dbName[nN] : false);
  }

  // Build-time validation: a blank ticker breaks the Source Docs key-match. Warn - with the
  // offending names - first. (Action Status is auto-filled, so it is never blank in the output.)
  var problems = [];
  vals.forEach(function (r) {
    var imported = r[0] === true, sel = r[1] === true;
    if (anySel ? !sel : imported) return;            // same qualifying set as the build loop below
    var nm = String(r[5] || '').trim();
    if (!nm) return;
    if (!anySel && inDb_(r)) return;                 // already in DB - will be skipped
    var issues = [];
    if (!String(r[6] || '').trim()) issues.push('blank ticker');
    if (issues.length) problems.push(nm + ' (' + issues.join(', ') + ')');
  });
  if (problems.length) {
    var ui = SpreadsheetApp.getUi();
    var resp = ui.alert('Kintone Upload - check these rows',
      problems.length + ' qualifying Add row(s) have issues that affect the Kintone import:\n\n' +
      problems.slice(0, 20).join('\n') + (problems.length > 20 ? '\n...' : '') +
      '\n\nBlank ticker breaks the Source Documents key-match.\n\nBuild anyway?',
      ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) { toast_('Kintone build cancelled - fix the flagged rows.'); return; }
  }

  var out = [], profiles = 0, skippedInDb = 0;
  vals.forEach(function (r, i) {
    var imported = r[0] === true, sel = r[1] === true;
    if (anySel ? !sel : imported) return;            // selected-only, else all not imported
    var pbn = String(r[5] || '').trim();             // Primary Business Name (col F)
    if (!pbn) return;

    // Already in Kintone? In default (non-Select) mode, skip rows already in Current DB so a
    // tracked profile is never re-exported, and auto-tick Imported? (DB-confirmed). A Select
    // tick is an explicit override that still exports.
    if (!anySel && inDb_(r)) {
      if (r[0] !== true) adds.getRange(i + 2, 1).setValue(true); // mark Imported?
      skippedInDb++;
      return;
    }

    var ticker = r[6], analyst = String(r[2] || '').trim(),  // Adds col C = Analyst
        actionStatus = String(r[7] || '').trim() || ACTION_STATUS_DEFAULT,
        tier = r[8], pureplay = r[9] || '',
        sector = r[10], desc = r[11], inclusion = r[12], tiering = r[13] || '',
        folder = String(r[14] || '').trim() || pbn;

    var sds = parseSourceDocs_(r[16]);   // [{name, note, url, date}] -> yellow subtable
    var webs = parseWebsites_(r[15]);    // [{type, url}]             -> pink subtable
    var blocks = [];
    sds.forEach(function (sd) { blocks.push({ sd: sd }); });   // Source Documents rows first
    webs.forEach(function (w) { blocks.push({ web: w }); });   // then Website URL rows
    if (!blocks.length) blocks.push({});                       // parent-only row

    blocks.forEach(function (b, k) {
      var w = b.web || { type: '', url: '' };
      var sd = b.sd || { name: '', note: '', url: '', date: '' };
      out.push([
        k === 0 ? '*' : '',                          // New record flag (first row of record only)
        pbn, ticker, analyst, actionStatus, tier, pureplay, sector, desc, inclusion, tiering, folder, // parent
        w.type || '', w.url || '',                   // pink: Website Type / Website URL's
        b.sd ? 'No' : '', sd.name || '', sd.note || '', sd.url || '', sd.date || '' // yellow: Source Docs
      ]);
    });
    profiles++;
  });

  var uSh = ensureTab_(TABS.kintoneUpload, true);
  clearBody_(uSh);
  if (out.length) {
    uSh.getRange(2, 1, out.length, TABS.kintoneUpload.header.length).setValues(out);
  }
  applyFormat_(uSh, TABS.kintoneUpload.header.length);

  logHistory_('Build Kintone Upload', 'Adds', profiles + ' profile(s), ' + out.length +
    ' upload row(s)' +
    (skippedInDb ? ' - ' + skippedInDb + ' skipped (already in Current DB, marked Imported)' : '') +
    (anySel ? ' (selected)' : ' (all not imported)'));
  toast_('Built ' + profiles + ' profile(s): ' + out.length + ' Kintone Upload row(s).' +
    (skippedInDb ? ' Skipped ' + skippedInDb + ' already in DB.' : '') +
    ' Use Download Kintone Upload CSV.');
}

/**
 * Parse the free-text Source Documents cell into entries, one per line (split on newlines
 * or ";"). Within a line "Name | Note | URL | Date" splits into the four fields; missing
 * trailing fields default to blank. Returns [{name, note, url, date}].
 */
function parseSourceDocs_(cell) {
  var s = String(cell || '').trim();
  if (!s) return [];
  return s.split(/\r?\n|;/)
    .map(function (line) { return line.trim(); })
    .filter(function (line) { return line.length; })
    .map(function (line) {
      var p = line.split('|').map(function (x) { return x.trim(); });
      return { name: p[0] || '', note: p[1] || '', url: p[2] || '', date: p[3] || '' };
    });
}

/**
 * Parse the free-text Website URLs cell into entries, one per line. "Type | URL" splits the
 * type (Website / Exchange) from the URL; a bare line is treated as a Website. Returns
 * [{type, url}].
 */
function parseWebsites_(cell) {
  var s = String(cell || '').trim();
  if (!s) return [];
  return s.split(/\r?\n|;/)
    .map(function (line) { return line.trim(); })
    .filter(function (line) { return line.length; })
    .map(function (line) {
      var p = line.split('|').map(function (x) { return x.trim(); });
      return p.length >= 2 ? { type: p[0], url: p.slice(1).join(' | ') } : { type: 'Website', url: p[0] };
    });
}

/** Build a CSV string from a tab (header + data rows), RFC-4180 quoting. */
function tabToCsv_(tabName, cols) {
  var sh = SpreadsheetApp.getActive().getSheetByName(tabName);
  if (!sh) return '';
  var lr = sh.getLastRow();
  if (lr < 2) return '';
  var vals = sh.getRange(1, 1, lr, cols).getValues();
  return vals.map(function (row) { return row.map(csvCell_).join(','); }).join('\r\n');
}

function csvCell_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    v = Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  var s = String(v);
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/** Show a download dialog for a CSV string (UTF-8 with BOM for accented names). */
function downloadCsvDialog_(csv, fname, title) {
  var html = HtmlService.createHtmlOutput(
    '<div style="font-family:Calibri,Arial,sans-serif;font-size:13px">' +
    '<p>' + title + ' is ready.</p>' +
    '<button id="dl">Download CSV</button> <span id="st"></span>' +
    '<scr' + 'ipt>' +
    'var csv=' + JSON.stringify(csv) + ';var fn=' + JSON.stringify(fname) + ';' +
    'document.getElementById("dl").onclick=function(){' +
    'var blob=new Blob(["\\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});' +
    'var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=fn;' +
    'document.body.appendChild(a);a.click();document.body.removeChild(a);' +
    'document.getElementById("st").textContent="Downloaded.";' +
    'setTimeout(function(){google.script.host.close();},900);};' +
    '</scr' + 'ipt></div>'
  ).setWidth(380).setHeight(150);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}

function downloadKintoneUploadCsv() {
  if (!stepGuard_(8)) return;
  var csv = tabToCsv_(TABS.kintoneUpload.name, TABS.kintoneUpload.header.length);
  if (!csv) { toast_('Kintone Upload tab is empty - run Build Kintone Upload first.'); return; }
  downloadCsvDialog_(csv, 'Kintone_Upload_' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') + '.csv',
    'Kintone Upload CSV');
  markStep_('8. Download Kintone Upload CSV', 'CSV downloaded');
}

/* ================================ SHARED UTILITIES ================================== */

function addBusinessDays_(d, n) {
  var r = new Date(d.getTime());
  var added = 0;
  while (added < n) {
    r.setDate(r.getDate() + 1);
    var day = r.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return r;
}

var HISTORY_MAX = 100;   // keep only the most recent N rows on the History Log

/** Keep a tab to its last maxRows data rows (trims oldest). */
function trimTab_(sh, maxRows) {
  var dataRows = sh.getLastRow() - 1;
  if (dataRows > maxRows) sh.deleteRows(2, dataRows - maxRows);
}

function logHistory_(action, source, details) {
  var sh = ensureTab_(TABS.history);
  sh.appendRow([new Date(), action, source, details]);
  trimTab_(sh, HISTORY_MAX);
  formatRow_(sh, sh.getLastRow(), TABS.history.header.length);
  if (STEP_BY_ACTION[action]) markStep_(STEP_BY_ACTION[action], details); // update the Dashboard status
}

/** Wipe the Adds tab body after a Kintone import (header kept). Asks for confirmation. */
function clearAdds() { return withDocLock_(clearAdds_impl_); }
function clearAdds_impl_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TABS.adds.name);
  if (!sh) { toast_('No Adds tab.'); return; }
  var lr = sh.getLastRow();
  if (lr < 2) { toast_('Adds is already empty.'); return; }
  var n = lr - 1, ui = SpreadsheetApp.getUi();
  var resp = ui.alert('Clear Adds?',
    'Delete all ' + n + ' row(s) from the Adds tab? Do this only after importing them to Kintone.',
    ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;
  var f = sh.getFilter();
  if (f) f.remove();
  sh.deleteRows(2, n);
  restyleTabs_([TABS.adds.name]);
  logHistory_('Clear Adds', TABS.adds.name, n + ' row(s) cleared');
  toast_('Cleared ' + n + ' row(s) from Adds.');
}

function toast_(msg) {
  SpreadsheetApp.getActive().toast(msg, 'DARB Pipeline', 6);
}
