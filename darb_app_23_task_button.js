/**
 * CRB Monitor - DARB App (App 23) Quick Task Assignment + Auto-Review Creation
 * v1.3 - Merged auto-create review records script (Apps 101 & 102)
 * v1.2 - Bug fixes: double-click guard on Create Task button, newline
 *         preservation in notes, escapeHtml quote escaping
 * v1.1 - Removed dead code: unused CONFIG properties (DARB_FIELDS.RECORD_ID,
 *         TICKER, SECURITY_TYPE, TASK_FIELDS.STATUS, DEFAULT_STATUS),
 *         dead CSS classes (.crb-flag-btn-small, .crb-list-actions)
 *
 * Part 1: Adds a "Create Task" button to DARB records that creates a task
 *         in App 57 (Projects/Tasks) with email notification.
 *
 * Part 2: On new Active profile creation, auto-creates one record in
 *         App 101 (Tier Review) + one in App 102 (Ops Review) with
 *         round-robin reviewer assignment.
 *
 * Installation:
 * 1. Go to App 23 Settings → Customization and Integration → JavaScript and CSS
 * 2. Upload this file
 * 3. Save and Update App
 */

(function() {
  'use strict';

  // ============================================================
  // CONFIGURATION - Update these to match your field codes
  // ============================================================

  const CONFIG = {
    // Task/Projects App
    TASK_APP_ID: 57,
    DARB_APP_ID: 23,

    // Review Apps
    APP_101: 101,
    APP_102: 102,

    // Fields in App 23 (DARB) - matched to your field codes
    DARB_FIELDS: {
      COMPANY_NAME: 'Text',               // Primary Business Name
      PROFILE_STATUS: 'Drop_down_22',
      TIER: 'Drop_down_2',
      TICKER: 'Text_24',
      SECTOR: 'Drop_down_3',
      PURE_PLAY: 'Drop_down_18',
      DOMICILE: 'Text_32',
      LAST_TIER_REVIEW: 'Date_9',
      JF_CONFIRM_STATUS: 'Drop_down_27'
    },

    // Auto-review round-robin assignment pools
    TIER_REVIEW: {
      TIER_1: 'Tamara',
      TIER_23_POOL: ['Tim', 'Isaac']
    },
    OPS_REVIEW: {
      POOL: [
        { code: 'mel.dapanas@crbmonitor.com', name: 'Mel Dapanas' },
        { code: 'joephillip.ollos@crbmonitor.com', name: 'Jaypee Ollos' }
      ]
    },

    // Fields in App 57 (Tasks) - matched to your actual field codes
    TASK_FIELDS: {
      TASK_NAME: 'Project_Name',          // Project Name field
      TASK_TYPE: 'Project_Field',         // Project Field dropdown
      ASSIGNEE: 'Task_Assignee',           // Assignee field
      DUE_DATE: 'end_date',               // End Date (lowercase)
      NOTES: 'project_description',       // Project Description (lowercase)
      SCOPE: 'Scope',                     // New: "Single Record" / "Batch" / "View"
      RECORD_LINK: 'Link',                // Link field - already exists
      RECORD_COUNT: 'Record_Count',       // Number - ADD THIS
      SOURCE_RECORD_ID: 'Source_Record_ID', // Number - ADD THIS (optional)
      SOURCE_APP: 'Source_App',            // Tracks which app created the task
      SAVED_IN_TABLE: 'Table',             // Subtable containing Saved In dropdown
      SAVED_IN_DROPDOWN: 'Drop_down'       // Drop_down field inside Table subtable
    },

    // Task type options (consolidated list)
    TASK_TYPES: [
      'Securities Review'
    ],

    // Groups whose members populate the assignee dropdown.
    // Members are fetched dynamically so adding/removing users in Kintone
    // automatically updates the list — no code changes needed.
    TEAM_GROUPS: ['Research', 'Research Admins'],

    // Fallback list used ONLY when the group API fails (permissions, network).
    // Keep this in sync with the Research + Research Admins groups in Kintone.
    FALLBACK_MEMBERS: [
      // Research group
      { name: 'Tim', code: 'timothy.rogers@crbmonitor.com' },
      { name: 'Isaac M', code: 'isaac.moriarty@crbmonitor.com' },
      { name: 'Mel Dapanas', code: 'mel.dapanas@crbmonitor.com' },
      { name: 'Jaypee Ollos', code: 'joephillip.ollos@crbmonitor.com' },
      // Research Admins group
      { name: 'Jim', code: 'james.francis@crbmonitor.com' },
      { name: 'Kyle', code: 'kyle.buckley@crbmonitor.com' },
      { name: 'Peter', code: 'peter@crbmonitor.com' },
      { name: 'Tamara', code: 'tamara.guy@crbmonitor.com' }
    ],

    // Kintone groups authorized to see the Create Task button.
    // If the groups API call fails, the button is shown (fail open).
    AUTHORIZED_GROUPS: ['Research', 'Research Admins'],

    // Default values
    DEFAULT_DUE_DAYS: 0
  };

  // ============================================================
  // TASK TEMPLATES - Grouped by category
  // ============================================================

  const TASK_TEMPLATES = {
    review: [
      { name: 'Securities/CUSIP/ISIN', type: 'Securities Review', prefix: 'ID Check: ' },
      { name: 'Pure-Play', type: 'Securities Review', prefix: 'Pure-Play Review: ' },
      { name: 'Tier', type: 'Securities Review', prefix: 'Tier Review: ' },
      { name: 'Sector', type: 'Securities Review', prefix: 'Sector Review: ' },
      { name: 'Name Change', type: 'Securities Review', prefix: 'Name Change: ' },
      { name: 'Security Status', type: 'Securities Review', prefix: 'Security Status: ' },
      { name: 'Pre-IPO', type: 'Securities Review', prefix: 'Pre-IPO: ' },
      { name: 'Business Description', type: 'Securities Review', prefix: 'Biz Desc Review: ' },
      { name: 'Inclusion Rationale', type: 'Securities Review', prefix: 'Inclusion Rationale: ' }
    ],
    include: [
      { name: 'Possible Inclusion', type: 'Securities Review', prefix: 'Possible Inclusion: ' },
      { name: 'Approved for Inclusion', type: 'Securities Review', prefix: 'Approved for Inclusion: ' }
    ],
    exclude: [
      { name: 'Possible Exclusion', type: 'Securities Review', prefix: 'Possible Exclusion: ' },
      { name: 'Confirmed for Exclusion', type: 'Securities Review', prefix: 'Confirmed for Exclusion: ' }
    ]
  };

  // Template group display labels and background tints
  var TEMPLATE_GROUP_META = {
    review: { label: 'Review', tint: '#f0f9ff' },
    include: { label: 'Include', tint: '#f0fdf9' },
    exclude: { label: 'Exclude', tint: '#fef3c7' }
  };

  // ============================================================
  // STYLES
  // ============================================================

  const STYLES = `
    .crb-task-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.6);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .crb-task-modal {
      background: white;
      border-radius: 12px;
      padding: 0;
      width: 560px;
      max-width: 95%;
      max-height: 90vh;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
    }

    .crb-modal-header {
      background: linear-gradient(135deg, #14b8a6, #0d9488);
      color: white;
      padding: 20px 24px;
    }

    .crb-modal-header h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
    }

    .crb-modal-header .crb-record-info {
      margin-top: 8px;
      font-size: 13px;
      opacity: 0.9;
    }

    .crb-modal-body {
      padding: 24px;
      max-height: 60vh;
      overflow-y: auto;
    }

    .crb-form-group {
      margin-bottom: 18px;
    }

    .crb-form-group label {
      display: block;
      margin-bottom: 6px;
      font-weight: 600;
      color: #333;
      font-size: 13px;
    }

    .crb-form-group label .required {
      color: #14b8a6;
    }

    .crb-form-group input,
    .crb-form-group select,
    .crb-form-group textarea {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 6px;
      font-size: 14px;
      box-sizing: border-box;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .crb-form-group input:focus,
    .crb-form-group select:focus,
    .crb-form-group textarea:focus {
      outline: none;
      border-color: #3498db;
      box-shadow: 0 0 0 3px rgba(52,152,219,0.15);
    }

    .crb-form-group textarea {
      min-height: 80px;
      resize: vertical;
    }

    .crb-form-row {
      display: flex;
      gap: 16px;
    }

    .crb-form-row .crb-form-group {
      flex: 1;
    }

    .crb-modal-footer {
      padding: 16px 24px;
      background: #f8f9fa;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      border-top: 1px solid #eee;
    }

    .crb-btn {
      padding: 10px 20px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
    }

    .crb-btn-primary {
      background: #14b8a6;
      color: white;
    }

    .crb-btn-primary:hover {
      background: #0d9488;
    }

    .crb-btn-secondary {
      background: white;
      color: #333;
      border: 1px solid #ddd;
    }

    .crb-btn-secondary:hover {
      background: #f0f0f0;
    }

    .crb-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    /* Main action button */
    .crb-flag-btn {
      background: linear-gradient(135deg, #14b8a6, #0d9488);
      color: white;
      border: none;
      padding: 10px 18px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
      box-shadow: 0 2px 8px rgba(20,184,166,0.3);
    }

    .crb-flag-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(20,184,166,0.4);
    }

    /* Template groups */
    .crb-template-groups {
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid #eee;
    }

    .crb-template-group {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 6px;
      margin-bottom: 4px;
    }

    .crb-template-group:last-child {
      margin-bottom: 0;
    }

    .crb-template-group-label {
      font-size: 11px;
      color: #888;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      min-width: 68px;
      flex-shrink: 0;
    }

    .crb-template-group-btns {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .crb-template-btn {
      padding: 5px 11px;
      background: white;
      border: 1px solid #ddd;
      border-radius: 20px;
      font-size: 12px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .crb-template-btn:hover {
      background: #14b8a6;
      color: white;
      border-color: #14b8a6;
    }

    /* Date quick-select */
    .crb-date-quick-select {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 8px;
    }

    .crb-date-pill {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 6px 12px;
      background: #f8f9fa;
      border: 1px solid #ddd;
      border-radius: 20px;
      cursor: pointer;
      transition: all 0.2s;
      line-height: 1.2;
    }

    .crb-date-pill:hover {
      border-color: #14b8a6;
      background: #f0fdf9;
    }

    .crb-date-pill.active {
      background: #14b8a6;
      color: white;
      border-color: #14b8a6;
    }

    .crb-date-pill-label {
      font-size: 12px;
      font-weight: 600;
    }

    .crb-date-pill-date {
      font-size: 10px;
      opacity: 0.75;
      margin-top: 1px;
    }

    .crb-message {
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 13px;
    }

    .crb-message-success {
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
    }

    .crb-message-error {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }

  `;

  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================

  function injectStyles() {
    if (document.getElementById('crb-task-styles')) return;
    var style = document.createElement('style');
    style.id = 'crb-task-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  function getDefaultDueDate(days) {
    if (days === undefined) days = CONFIG.DEFAULT_DUE_DAYS;
    var date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }

  function getRecordUrl(appId, recordId) {
    var domain = window.location.hostname;
    return 'https://' + domain + '/k/' + appId + '/show#record=' + recordId;
  }

  function getCurrentViewUrl() {
    return window.location.href;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function getFieldValue(record, fieldCode, defaultVal) {
    if (defaultVal === undefined) defaultVal = '';
    if (!record || !record[fieldCode]) return defaultVal;
    var field = record[fieldCode];
    if (field.value === null || field.value === undefined) return defaultVal;
    return field.value;
  }

  // ============================================================
  // DATE QUICK-SELECT HELPERS
  // ============================================================

  /**
   * Computes the quick-select date options.
   * Each returns { label, shortDate, isoDate }.
   */
  function getQuickDateOptions() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);

    function addDays(base, n) {
      var d = new Date(base);
      d.setDate(d.getDate() + n);
      return d;
    }

    function toISO(d) {
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1);
      if (m.length < 2) m = '0' + m;
      var day = String(d.getDate());
      if (day.length < 2) day = '0' + day;
      return y + '-' + m + '-' + day;
    }

    function shortDate(d) {
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return months[d.getMonth()] + ' ' + d.getDate();
    }

    var todayDate = today;
    var tomorrowDate = addDays(today, 1);
    var plus7Date = addDays(today, 7);

    return [
      { key: 'today',    label: 'Today',       shortDate: shortDate(todayDate),     isoDate: toISO(todayDate) },
      { key: 'tomorrow', label: 'Tomorrow',    shortDate: shortDate(tomorrowDate),  isoDate: toISO(tomorrowDate) },
      { key: 'plus7',    label: '+1 Week',     shortDate: shortDate(plus7Date),     isoDate: toISO(plus7Date) }
    ];
  }

  // ============================================================
  // GROUP-BASED VISIBILITY
  // ============================================================

  // Cached result: null = not checked yet, true/false = result
  var _userAuthorized = null;

  /**
   * Checks if the current user belongs to at least one authorized group.
   * Caches the result so the API call only happens once per page load.
   * Fails open: if the API call errors, returns true (show button).
   */
  function checkUserAuthorization() {
    if (_userAuthorized !== null) {
      return Promise.resolve(_userAuthorized);
    }

    var loginUser = kintone.getLoginUser();
    if (!loginUser || !loginUser.code) {
      // Cannot determine user; fail open
      _userAuthorized = true;
      return Promise.resolve(true);
    }

    return kintone.api(
      kintone.api.url('/k/v1/user/groups', true),
      'GET',
      { code: loginUser.code }
    ).then(function(resp) {
      var groups = resp.groups || [];
      var authorized = groups.some(function(g) {
        return CONFIG.AUTHORIZED_GROUPS.indexOf(g.code) !== -1 ||
               CONFIG.AUTHORIZED_GROUPS.indexOf(g.name) !== -1;
      });
      _userAuthorized = authorized;
      return authorized;
    }).catch(function(err) {
      // Fail open: if the API call fails, show the button anyway
      console.error('[CRB Task Button] Groups API error (failing open):', err);
      _userAuthorized = true;
      return true;
    });
  }

  // ============================================================
  // DYNAMIC TEAM MEMBER LOADING FROM GROUPS
  // ============================================================

  // Cached result: null = not loaded yet
  var _teamMembers = null;

  /**
   * Fetches members from all CONFIG.TEAM_GROUPS, de-duplicates by email (code),
   * and caches the result.  Returns [{name, code}] sorted by name.
   * Falls back to CONFIG.FALLBACK_MEMBERS when the group API returns nothing.
   */
  function fetchTeamMembers() {
    if (_teamMembers !== null) return Promise.resolve(_teamMembers);

    var requests = CONFIG.TEAM_GROUPS.map(function(groupCode) {
      return kintone.api(
        kintone.api.url('/k/v1/group/users', true), 'GET',
        { code: groupCode }
      ).then(function(resp) {
        console.log('[CRB Task Button] Group "' + groupCode + '" returned ' +
          (resp.users || []).length + ' members');
        return (resp.users || []).map(function(u) {
          return { name: u.name, code: u.code };
        });
      }).catch(function(err) {
        console.warn('[CRB Task Button] Failed to fetch group "' + groupCode + '":', err);
        return [];
      });
    });

    return Promise.all(requests).then(function(results) {
      var seen = {};
      var members = [];
      results.forEach(function(groupUsers) {
        groupUsers.forEach(function(u) {
          if (!seen[u.code]) {
            seen[u.code] = true;
            members.push(u);
          }
        });
      });
      // If group API returned nothing, use the fallback list
      if (members.length === 0) {
        console.warn('[CRB Task Button] No members from groups — using fallback list');
        members = CONFIG.FALLBACK_MEMBERS.slice();
      }
      members.sort(function(a, b) { return a.name.localeCompare(b.name); });
      _teamMembers = members;
      return members;
    });
  }

  // ============================================================
  // MODAL COMPONENT
  // ============================================================

  function createTaskModal(options) {
    var recordId = options.recordId;
    var recordName = options.recordName;
    var recordUrl = options.recordUrl;
    var isBulk = options.isBulk || false;
    var viewUrl = options.viewUrl || '';
    var recordCount = options.recordCount || 1;
    var onSubmit = options.onSubmit;
    var onCancel = options.onCancel;

    var overlay = document.createElement('div');
    overlay.id = 'crb-task-overlay';
    overlay.className = 'crb-task-modal-overlay';

    // Build template groups HTML
    var templateGroupsHtml = '';
    var groupKeys = Object.keys(TASK_TEMPLATES);
    for (var gi = 0; gi < groupKeys.length; gi++) {
      var gKey = groupKeys[gi];
      var meta = TEMPLATE_GROUP_META[gKey] || { label: gKey, tint: '#f8f9fa' };
      var templates = TASK_TEMPLATES[gKey];
      var btnsHtml = '';
      for (var ti = 0; ti < templates.length; ti++) {
        var t = templates[ti];
        btnsHtml += '<button type="button" class="crb-template-btn" ' +
          'data-prefix="' + t.prefix + '" data-type="' + t.type + '">' +
          t.name + '</button>';
      }
      templateGroupsHtml += '<div class="crb-template-group" style="background:' + meta.tint + ';">' +
        '<span class="crb-template-group-label">' + meta.label + '</span>' +
        '<div class="crb-template-group-btns">' + btnsHtml + '</div>' +
        '</div>';
    }

    // Build date quick-select pills HTML
    var dateOptions = getQuickDateOptions();
    var datePillsHtml = '';
    for (var di = 0; di < dateOptions.length; di++) {
      var opt = dateOptions[di];
      // Default selection: Today
      var activeClass = opt.key === 'today' ? ' active' : '';
      datePillsHtml += '<button type="button" class="crb-date-pill' + activeClass + '" ' +
        'data-date="' + opt.isoDate + '">' +
        '<span class="crb-date-pill-label">' + opt.label + '</span>' +
        '<span class="crb-date-pill-date">' + opt.shortDate + '</span>' +
        '</button>';
    }

    // Placeholder — assignee dropdown is populated asynchronously after render
    var memberOptionsHtml = '<option value="">Loading team members…</option>';

    // Build task type options
    var typeOptionsHtml = '';
    for (var tti = 0; tti < CONFIG.TASK_TYPES.length; tti++) {
      var tt = CONFIG.TASK_TYPES[tti];
      typeOptionsHtml += '<option value="' + tt + '">' + tt + '</option>';
    }

    var headerInfo = isBulk
      ? 'Bulk Task: ' + recordCount + ' records from current view'
      : 'Record: ' + (recordName || 'ID ' + recordId);

    var taskNameDefault = (!isBulk && recordName) ? 'Review: ' + recordName : '';

    overlay.innerHTML =
      '<div class="crb-task-modal">' +
        '<div class="crb-modal-header">' +
          '<h2>\uD83D\uDEA9 Create Task</h2>' +
          '<div class="crb-record-info">' + headerInfo + '</div>' +
        '</div>' +
        '<div class="crb-modal-body">' +
          '<div id="crb-message"></div>' +
          '<div class="crb-template-groups">' + templateGroupsHtml + '</div>' +
          '<div class="crb-form-group">' +
            '<label>Task Name <span class="required">*</span></label>' +
            '<input type="text" id="crb-task-name" placeholder="e.g., Update Company Names, Review Tier 3 Profiles..." ' +
              'value="' + taskNameDefault.replace(/"/g, '&quot;') + '">' +
          '</div>' +
          '<div class="crb-form-row">' +
            '<div class="crb-form-group">' +
              '<label>Task Type</label>' +
              '<select id="crb-task-type">' + typeOptionsHtml + '</select>' +
            '</div>' +
            '<div class="crb-form-group">' +
              '<label>Assign To <span class="required">*</span></label>' +
              '<select id="crb-assignee">' + memberOptionsHtml + '</select>' +
            '</div>' +
          '</div>' +
          '<div class="crb-form-group">' +
            '<label>Due Date</label>' +
            '<div class="crb-date-quick-select">' + datePillsHtml + '</div>' +
            '<input type="date" id="crb-due-date" value="' + getDefaultDueDate() + '">' +
          '</div>' +
          '<div class="crb-form-row">' +
            '<div class="crb-form-group">' +
              '<label>Scope</label>' +
              '<select id="crb-scope">' +
                '<option value="Single Record"' + (!isBulk ? ' selected' : '') + '>Single Record</option>' +
                '<option value="Batch"' + (isBulk ? ' selected' : '') + '>Batch / Multiple</option>' +
                '<option value="View">Saved View</option>' +
              '</select>' +
            '</div>' +
            (isBulk
              ? '<div class="crb-form-group">' +
                  '<label>Record Count (approx)</label>' +
                  '<input type="number" id="crb-record-count" value="' + recordCount + '" min="1">' +
                '</div>'
              : '') +
          '</div>' +
          '<div class="crb-form-group">' +
            '<label>Notes / Instructions</label>' +
            '<textarea id="crb-notes" placeholder="Add specific instructions, criteria, or context..."></textarea>' +
          '</div>' +
        '</div>' +
        '<div class="crb-modal-footer">' +
          '<button type="button" class="crb-btn crb-btn-secondary" id="crb-cancel">Cancel</button>' +
          '<button type="button" class="crb-btn crb-btn-primary" id="crb-submit">Create Task &amp; Notify</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // ---- Populate assignee dropdown from group members ----
    var assigneeSelect = overlay.querySelector('#crb-assignee');
    fetchTeamMembers().then(function(members) {
      if (!assigneeSelect) return;
      var opts = '<option value="">-- Select --</option>';
      members.forEach(function(m) {
        opts += '<option value="' + escapeHtml(m.code) + '">' + escapeHtml(m.name) + '</option>';
      });
      assigneeSelect.innerHTML = opts;
    });

    // ---- Date quick-select pill handlers ----
    var datePills = overlay.querySelectorAll('.crb-date-pill');
    var dateInput = overlay.querySelector('#crb-due-date');

    function clearDatePillActive() {
      for (var i = 0; i < datePills.length; i++) {
        datePills[i].classList.remove('active');
      }
    }

    for (var pi = 0; pi < datePills.length; pi++) {
      (function(pill) {
        pill.onclick = function() {
          clearDatePillActive();
          pill.classList.add('active');
          dateInput.value = pill.getAttribute('data-date');
        };
      })(datePills[pi]);
    }

    // Manual date input clears active pill highlight
    dateInput.addEventListener('input', function() {
      clearDatePillActive();
    });

    // ---- Template button handlers ----
    overlay.querySelectorAll('.crb-template-btn').forEach(function(btn) {
      btn.onclick = function() {
        var prefix = btn.getAttribute('data-prefix');
        var type = btn.getAttribute('data-type');
        var nameInput = overlay.querySelector('#crb-task-name');
        var typeSelect = overlay.querySelector('#crb-task-type');

        if (!isBulk && recordName) {
          nameInput.value = prefix + recordName;
        } else {
          nameInput.value = prefix;
          nameInput.focus();
        }
        typeSelect.value = type;
      };
    });

    // ---- Cancel handler ----
    overlay.querySelector('#crb-cancel').onclick = function() {
      removeModal();
      if (onCancel) onCancel();
    };

    // ---- Submit handler ----
    overlay.querySelector('#crb-submit').onclick = function() {
      var taskName = overlay.querySelector('#crb-task-name').value.trim();
      var taskType = overlay.querySelector('#crb-task-type').value;
      var assignee = overlay.querySelector('#crb-assignee').value;
      var dueDate = overlay.querySelector('#crb-due-date').value;
      var scope = overlay.querySelector('#crb-scope').value;
      var notes = overlay.querySelector('#crb-notes').value;
      var count = isBulk ? (overlay.querySelector('#crb-record-count') ? overlay.querySelector('#crb-record-count').value : recordCount) : 1;

      // Validation
      if (!taskName) {
        showMessage(overlay, 'Please enter a task name.', 'error');
        return;
      }
      if (!assignee) {
        showMessage(overlay, 'Please select an assignee.', 'error');
        return;
      }

      var submitBtn = overlay.querySelector('#crb-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating...';

      onSubmit({
        taskName: taskName,
        taskType: taskType,
        assignee: assignee,
        dueDate: dueDate,
        scope: scope,
        notes: notes,
        recordCount: count,
        recordUrl: isBulk ? viewUrl : recordUrl,
        sourceRecordId: isBulk ? null : recordId
      }).then(function() {
        // Resolve display name from cached group members
        var assigneeName = assignee;
        var cached = _teamMembers || [];
        for (var i = 0; i < cached.length; i++) {
          if (cached[i].code === assignee) {
            assigneeName = cached[i].name;
            break;
          }
        }
        showMessage(overlay, '\u2713 Task created and assigned to ' + assigneeName + '!', 'success');
        setTimeout(function() { removeModal(); }, 1500);
      }).catch(function(error) {
        showMessage(overlay, 'Error: ' + error.message, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Task & Notify';
      });
    };

    // ---- Close on overlay click ----
    overlay.onclick = function(e) {
      if (e.target === overlay) {
        removeModal();
        if (onCancel) onCancel();
      }
    };

    // ---- ESC key to close modal ----
    function handleEsc(e) {
      if (e.key === 'Escape') {
        removeModal();
        if (onCancel) onCancel();
      }
    }
    document.addEventListener('keydown', handleEsc);

    function removeModal() {
      document.removeEventListener('keydown', handleEsc);
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }

    // Focus first input
    setTimeout(function() {
      var nameInput = overlay.querySelector('#crb-task-name');
      if (!nameInput.value) nameInput.focus();
    }, 100);

    return overlay;
  }

  function showMessage(overlay, message, type) {
    var msgEl = overlay.querySelector('#crb-message');
    msgEl.className = 'crb-message crb-message-' + type;
    msgEl.textContent = message;
  }

  // ============================================================
  // API FUNCTIONS
  // ============================================================

  function createTask(taskData) {
    var body = {
      app: CONFIG.TASK_APP_ID,
      record: {}
    };

    // Map task data to App 57 fields
    var fields = CONFIG.TASK_FIELDS;

    if (fields.TASK_NAME) {
      body.record[fields.TASK_NAME] = { value: taskData.taskName };
    }
    if (fields.TASK_TYPE) {
      body.record[fields.TASK_TYPE] = { value: taskData.taskType };
    }
    if (fields.ASSIGNEE) {
      body.record[fields.ASSIGNEE] = { value: [{ code: taskData.assignee }] };
    }

    // NOTE: Status is intentionally omitted from the POST body.
    // Setting both Task_Assignee and status in the same POST triggers two
    // Kintone per-field notification emails (one for each field change).
    // By omitting status here, App 57's field default value
    // ("Not started - Committed") is used instead, and only a single
    // notification fires (on the assignee field).

    if (fields.DUE_DATE && taskData.dueDate) {
      body.record[fields.DUE_DATE] = { value: taskData.dueDate };
    }
    if (fields.NOTES && taskData.notes) {
      body.record[fields.NOTES] = { value: '<div>' + escapeHtml(taskData.notes).replace(/\n/g, '<br>') + '</div>' };
    }
    if (fields.SCOPE) {
      body.record[fields.SCOPE] = { value: taskData.scope };
    }
    if (fields.RECORD_LINK && taskData.recordUrl) {
      body.record[fields.RECORD_LINK] = { value: taskData.recordUrl };
    }
    if (fields.RECORD_COUNT) {
      body.record[fields.RECORD_COUNT] = { value: taskData.recordCount || 1 };
    }
    if (fields.SOURCE_RECORD_ID && taskData.sourceRecordId) {
      body.record[fields.SOURCE_RECORD_ID] = { value: taskData.sourceRecordId };
    }
    if (fields.SOURCE_APP) {
      body.record[fields.SOURCE_APP] = { value: 'DARB (23)' };
    }
    if (fields.SAVED_IN_TABLE && fields.SAVED_IN_DROPDOWN) {
      body.record[fields.SAVED_IN_TABLE] = {
        value: [{
          value: {
            [fields.SAVED_IN_DROPDOWN]: { value: 'Kintone' }
          }
        }]
      };
    }

    return kintone.api(
      kintone.api.url('/k/v1/record', true),
      'POST',
      body
    ).then(function(response) {
      return response.id;
    });
  }

  // ============================================================
  // EVENT HANDLERS
  // ============================================================

  // Record Detail View - Add "Create Task" button
  kintone.events.on('app.record.detail.show', function(event) {
    var record = event.record;

    injectStyles();

    // Check group authorization before rendering the button
    checkUserAuthorization().then(function(authorized) {
      if (!authorized) return;

      // Try space element first, then fall back to header right area for top-right positioning
      var container = kintone.app.record.getSpaceElement('task_button_space');

      if (!container) {
        // Position at top-right of the record header
        var headerSpace = kintone.app.record.getHeaderMenuSpaceElement();
        if (headerSpace) {
          container = document.createElement('div');
          container.style.position = 'absolute';
          container.style.top = '10px';
          container.style.right = '20px';
          container.style.zIndex = '1000';
          headerSpace.style.position = 'relative';
          headerSpace.appendChild(container);
        } else {
          // Fallback to menu statusbar
          var menuEl = document.querySelector('.gaia-argoui-app-menu-statusbar');
          if (menuEl) {
            container = document.createElement('div');
            container.style.display = 'inline-block';
            container.style.marginLeft = 'auto';
            container.style.cssFloat = 'right';
            menuEl.appendChild(container);
          }
        }
      }

      if (!container) return;

      container.innerHTML = '';

      var button = document.createElement('button');
      button.className = 'crb-flag-btn';
      button.innerHTML = '\uD83D\uDEA9 Create Task';

      button.onclick = function() {
        if (document.getElementById('crb-task-overlay')) return;
        var recordId = kintone.app.record.getId();
        var recordName = getFieldValue(record, CONFIG.DARB_FIELDS.COMPANY_NAME, 'Record #' + recordId);
        var recordUrl = getRecordUrl(CONFIG.DARB_APP_ID, recordId);

        createTaskModal({
          recordId: recordId,
          recordName: recordName,
          recordUrl: recordUrl,
          isBulk: false,
          onSubmit: function(taskData) {
            return createTask(taskData).then(function(taskId) {
              // Update Drop_down_27 when current value is "JF to Confirm Active - New Profiles"
              var jfStatus = record[CONFIG.DARB_FIELDS.JF_CONFIRM_STATUS];
              if (jfStatus && jfStatus.value === 'JF to Confirm Active - New Profiles') {
                var newValue = null;
                if (taskData.taskName.indexOf('Approved for Inclusion: ') === 0) {
                  newValue = 'JF Approved Active';
                } else if (taskData.taskName.indexOf('Confirmed for Exclusion: ') === 0) {
                  newValue = 'JF Approved Inactive';
                }
                if (newValue) {
                  return kintone.api(
                    kintone.api.url('/k/v1/record', true),
                    'PUT',
                    {
                      app: CONFIG.DARB_APP_ID,
                      id: recordId,
                      record: {
                        [CONFIG.DARB_FIELDS.JF_CONFIRM_STATUS]: { value: newValue }
                      }
                    }
                  ).then(function() { return taskId; });
                }
              }
              return taskId;
            });
          }
        });
      };

      container.appendChild(button);
    });

    return event;
  });

  // Record List View - Add "Create Bulk Task" button
  kintone.events.on('app.record.index.show', function(event) {
    if (event.viewType !== 'list' && event.viewType !== 'custom') return event;

    injectStyles();

    // Check if button already exists
    if (document.getElementById('crb-bulk-task-btn')) return event;

    // Check group authorization before rendering the button
    checkUserAuthorization().then(function(authorized) {
      if (!authorized) return;

      // Re-check after async call in case button was added by concurrent event
      if (document.getElementById('crb-bulk-task-btn')) return;

      var headerMenuEl = kintone.app.getHeaderMenuSpaceElement();
      if (!headerMenuEl) return;

      var button = document.createElement('button');
      button.id = 'crb-bulk-task-btn';
      button.className = 'crb-flag-btn';
      button.innerHTML = '\uD83D\uDEA9 Create Task from View';

      button.onclick = function() {
        if (document.getElementById('crb-task-overlay')) return;
        var viewUrl = getCurrentViewUrl();
        var viewRecords = event.records || [];
        var recordCount = viewRecords.length;
        var viewName = event.viewName || 'Current View';

        createTaskModal({
          recordId: null,
          recordName: viewName,
          recordUrl: viewUrl,
          isBulk: true,
          viewUrl: viewUrl,
          recordCount: recordCount,
          onSubmit: function(taskData) {
            return createTask(taskData).then(function(taskId) {
              // Bulk-update Drop_down_27 for all view records where value is "JF to Confirm Active - New Profiles"
              var newValue = null;
              if (taskData.taskName.indexOf('Approved for Inclusion: ') === 0) {
                newValue = 'JF Approved Active';
              } else if (taskData.taskName.indexOf('Confirmed for Exclusion: ') === 0) {
                newValue = 'JF Approved Inactive';
              }
              if (!newValue) return taskId;

              var idsToUpdate = [];
              for (var ri = 0; ri < viewRecords.length; ri++) {
                var rec = viewRecords[ri];
                var jfVal = rec[CONFIG.DARB_FIELDS.JF_CONFIRM_STATUS];
                if (jfVal && jfVal.value === 'JF to Confirm Active - New Profiles') {
                  idsToUpdate.push(rec.$id.value);
                }
              }
              if (idsToUpdate.length === 0) return taskId;

              // Kintone bulk PUT supports up to 100 records at a time
              var batches = [];
              for (var bi = 0; bi < idsToUpdate.length; bi += 100) {
                batches.push(idsToUpdate.slice(bi, bi + 100));
              }

              var chain = Promise.resolve();
              batches.forEach(function(batch) {
                chain = chain.then(function() {
                  var records = batch.map(function(id) {
                    return {
                      id: id,
                      record: {
                        [CONFIG.DARB_FIELDS.JF_CONFIRM_STATUS]: { value: newValue }
                      }
                    };
                  });
                  return kintone.api(
                    kintone.api.url('/k/v1/records', true),
                    'PUT',
                    { app: CONFIG.DARB_APP_ID, records: records }
                  );
                });
              });

              return chain.then(function() { return taskId; });
            });
          }
        });
      };

      headerMenuEl.appendChild(button);
    });

    return event;
  });

  // ============================================================
  // PART 2: AUTO-CREATE REVIEW RECORDS IN APPS 101 & 102
  // ============================================================

  // Round-robin: App 101 (Tier 2/3 only - Tier 1 always Tamara)
  function getNextReviewer101(tier) {
    if (tier === '1A' || tier === '1B') {
      return kintone.Promise.resolve(CONFIG.TIER_REVIEW.TIER_1);
    }
    var pool = CONFIG.TIER_REVIEW.TIER_23_POOL;
    return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app: CONFIG.APP_101,
      query: 'reviewer in ("Tim","Isaac") order by Record_number desc limit 1',
      fields: ['reviewer']
    }).then(function(resp) {
      if (resp.records.length > 0) {
        var last = resp.records[0].reviewer.value;
        var idx = pool.indexOf(last);
        return pool[(idx + 1) % pool.length];
      }
      return pool[0];
    }).catch(function() {
      return pool[0];
    });
  }

  // Round-robin: App 102 (Mel / Jaypee)
  function getNextReviewer102() {
    var pool = CONFIG.OPS_REVIEW.POOL;
    return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app: CONFIG.APP_102,
      query: 'order by Record_number desc limit 1',
      fields: ['reviewer']
    }).then(function(resp) {
      if (resp.records.length > 0 && resp.records[0].reviewer.value.length > 0) {
        var lastCode = resp.records[0].reviewer.value[0].code;
        var idx = pool.findIndex(function(u) { return u.code === lastCode; });
        return pool[(idx + 1) % pool.length];
      }
      return pool[0];
    }).catch(function() {
      return pool[0];
    });
  }

  // Check if review records already exist for this App 23 record
  function reviewRecordExists(appId, recordId) {
    return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app: appId,
      query: 'Lookup = "' + recordId + '" limit 1',
      fields: ['$id']
    }).then(function(resp) {
      return resp.records.length > 0;
    }).catch(function() {
      return false;
    });
  }

  function createReviewRecords(record, recordId) {
    var profileStatus = record[CONFIG.DARB_FIELDS.PROFILE_STATUS].value;
    if (profileStatus !== 'Active') {
      console.log('[Auto-Review] Skipped - Profile Status is not Active');
      return;
    }

    var tier = record[CONFIG.DARB_FIELDS.TIER].value || '';
    var companyName = record[CONFIG.DARB_FIELDS.COMPANY_NAME].value || '';
    var ticker = record[CONFIG.DARB_FIELDS.TICKER].value || '';
    var sector = record[CONFIG.DARB_FIELDS.SECTOR].value || '';
    var purePlay = record[CONFIG.DARB_FIELDS.PURE_PLAY].value || '';
    var domicile = record[CONFIG.DARB_FIELDS.DOMICILE].value || '';
    var lastTierReview = record[CONFIG.DARB_FIELDS.LAST_TIER_REVIEW].value || null;
    var today = new Date().toISOString().split('T')[0];
    var now = new Date().toISOString();

    // App 101: Tier Review (skip if already exists)
    reviewRecordExists(CONFIG.APP_101, recordId).then(function(exists) {
      if (exists) {
        console.log('[Auto-Review] App 101 record already exists for App 23 #' + recordId);
        return;
      }
      return getNextReviewer101(tier).then(function(reviewer101) {
        return kintone.api(kintone.api.url('/k/v1/record', true), 'POST', {
          app: CONFIG.APP_101,
          record: {
            Lookup: { value: String(recordId) },
            company_name: { value: companyName },
            ticker: { value: ticker },
            sector: { value: sector },
            tier: { value: tier },
            pure_play: { value: purePlay },
            profile_status: { value: profileStatus },
            Date: { value: lastTierReview },
            reviewer: { value: reviewer101 },
            assigned_by: { value: 'Peter' },
            date_assigned: { value: today },
            review_status: { value: 'Not Started' },
            review_outcome: { value: 'No Changes Needed' },
            audit_log: {
              value: [{
                value: {
                  audit_action: { value: 'Record Created' },
                  audit_user: { value: 'System (Auto)' },
                  audit_timestamp: { value: now },
                  audit_notes: { value: 'Auto-created from App 23 #' + recordId + ' | Reviewer: ' + reviewer101 }
                }
              }]
            }
          }
        });
      }).then(function() {
        console.log('[Auto-Review] App 101 record created for: ' + companyName);
      });
    }).catch(function(e) {
      console.error('[Auto-Review] App 101 failed:', e.message || e);
    });

    // App 102: Ops Data Review (skip if already exists)
    reviewRecordExists(CONFIG.APP_102, recordId).then(function(exists) {
      if (exists) {
        console.log('[Auto-Review] App 102 record already exists for App 23 #' + recordId);
        return;
      }
      return getNextReviewer102().then(function(reviewer102) {
        return kintone.api(kintone.api.url('/k/v1/record', true), 'POST', {
          app: CONFIG.APP_102,
          record: {
            Lookup: { value: String(recordId) },
            company_name: { value: companyName },
            sector: { value: sector },
            crbm_tier: { value: tier },
            pure_play: { value: purePlay },
            Text: { value: profileStatus },
            Text_0: { value: domicile },
            reviewer: { value: [{ code: reviewer102.code }] },
            review_status: { value: 'Not Started' },
            priority: { value: 'Medium' },
            audit_log: {
              value: [{
                value: {
                  audit_action: { value: 'Record Created' },
                  audit_user: { value: 'System (Auto)' },
                  audit_timestamp: { value: now },
                  audit_notes: { value: 'Auto-created from App 23 #' + recordId + ' | Reviewer: ' + reviewer102.name }
                }
              }]
            }
          }
        });
      }).then(function() {
        console.log('[Auto-Review] App 102 record created for: ' + companyName);
      });
    }).catch(function(e) {
      console.error('[Auto-Review] App 102 failed:', e.message || e);
    });
  }

  // Fires AFTER successful save - App 23 record is already committed
  // Handles both new record creation and edits (e.g. status changed to Active)
  kintone.events.on([
    'app.record.create.submit.success',
    'app.record.edit.submit.success'
  ], function(event) {
    createReviewRecords(event.record, event.recordId);
    return event;
  });

})();
