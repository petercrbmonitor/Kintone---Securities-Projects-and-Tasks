/**
 * App 101 - DARB Tier Review Log: Simplified Audit & Escalation
 * v8.8 - Removed dead code: unused per-analyst pending/escalated/flagged
 *         counters and outcome variable in calculateStats
 * v8.7 - Fixed: gamification STATUS_COLORS and status breakdown aligned to
 *         actual app statuses (Pending/Needs Analyst Review/Complete),
 *         flagged counter now counts all 'Flagged for *' outcomes (not just Peter)
 * v8.6 - Merged gamification (leaderboard, badges, streaks, celebration,
 *         color-coded rows) from standalone file into single deployment
 * v8.5 - Fixed: revert sets review_outcome to default (not empty) to avoid
 *         radio button validation errors, removed type property from
 *         saveWithAudit subtable values (Kintone infers from schema)
 * v8.4 - Fixed: fallback analyst caching, ESC listener leak, XSS in task
 *         descriptions, missing review_outcome on Research Complete
 *         Added: resolution_type tracking (auto on Complete, dropdown on
 *         Research Complete), auto-close App 57 task on Research Complete,
 *         category-to-task-type mapping, safer escalation order, full
 *         field clearing on Revert (escalated_to, confirmation, resolution)
 * v8.3 - Fixed: dropdown caching bug, assignee validation, select appearance
 *         Enhanced: confirmation modal, flag summary, guided escalation,
 *         guidance banner, next-record navigation, readable timestamps
 *
 * Statuses: Pending -> Complete / Needs Analyst Review
 * Junior (Tim/Isaac): Complete + Escalate buttons
 * Analyst (Peter/Tamara): Research Complete button
 * Escalation creates App 57 task (assign to + notes only)
 * All features consolidated into this single file
 */

(function() {
  'use strict';

  var APP_57 = 57;
  var APP_101 = 101;
  var KINTONE_BASE = location.origin;

  // Group-based roles (matches Kintone People & Groups)
  var ANALYST_GROUP = 'Research Admins';
  var DEFAULT_ASSIGNEE_EMAIL = 'peter@crbmonitor.com';

  // Fallback analyst list if group API fails (permissions, network, etc.)
  var FALLBACK_ANALYSTS = [
    { name: 'Peter', email: 'peter@crbmonitor.com' },
    { name: 'Tamara', email: 'tamara.guy@crbmonitor.com' }
  ];

  // Confirmation checkbox fields per analyst (Kintone field codes)
  // Only analysts with dedicated checkbox fields need entries here
  var ANALYST_CONFIRM = {
    'Peter': 'confirmed_peter',
    'Tamara': 'confirmed_peter_0'
  };

  // Cached state
  var _isAnalyst = null;       // is current user a Research Admin?
  var _analystMembers = null;  // [{name, email}] from group API
  var _snapshot = {};

  // Fetch group members (cached per page load)
  function getAnalystMembers() {
    if (_analystMembers !== null) return Promise.resolve(_analystMembers);
    return kintone.api(kintone.api.url('/k/v1/group/users', true), 'GET', {
      code: ANALYST_GROUP
    }).then(function(resp) {
      _analystMembers = (resp.users || []).map(function(u) {
        return { name: u.name, email: u.code };
      });
      if (_analystMembers.length === 0) {
        _analystMembers = FALLBACK_ANALYSTS;
      }
      return _analystMembers;
    }).catch(function() {
      // Group API failed — cache fallback so email resolution works on submit
      _analystMembers = FALLBACK_ANALYSTS;
      return FALLBACK_ANALYSTS;
    });
  }

  // Check if current user is in the analyst group (cached)
  function checkIsAnalyst() {
    if (_isAnalyst !== null) return Promise.resolve(_isAnalyst);
    var loginCode = kintone.getLoginUser().code || '';
    return kintone.api(kintone.api.url('/k/v1/user/groups', true), 'GET', {
      code: loginCode
    }).then(function(resp) {
      var groups = resp.groups || [];
      _isAnalyst = groups.some(function(g) {
        return g.code === ANALYST_GROUP || g.name === ANALYST_GROUP;
      });
      return _isAnalyst;
    }).catch(function() {
      _isAnalyst = false;
      return false;
    });
  }

  var ISSUE_CATEGORIES = [
    'Data Mismatch',
    'Missing Information',
    'Tier Classification Question',
    'Securities / Exchange Issue',
    'Needs Further Research'
  ];

  var RESOLUTION_TYPES = [
    'No Changes Required',
    'Data Corrected',
    'Information Added',
    'Record Updated'
  ];

  var CATEGORY_TO_TASK_TYPE = {
    'Data Mismatch': 'Database Maintenance',
    'Missing Information': 'Database Maintenance',
    'Tier Classification Question': 'Tier/Profile Reviews',
    'Securities / Exchange Issue': 'Database Maintenance',
    'Needs Further Research': 'Research'
  };

  var FLAG_DEFS = [
    { code: 'flag_description', label: 'Business Description', note: 'note_description' },
    { code: 'flag_inclusion', label: 'Inclusion Rationale', note: 'note_inclusion' },
    { code: 'flag_tier', label: 'Tier Classification', note: 'note_tier' },
    { code: 'flag_sector', label: 'Sector', note: 'note_sector' },
    { code: 'flag_pureplay', label: 'Pure-Play', note: 'note_pureplay' },
    { code: 'flag_securities', label: 'Securities Data', note: 'note_securities' },
    { code: 'flag_exchange', label: 'Exchange/Domicile', note: 'note_exchange' },
    { code: 'flag_sources', label: 'Sources/Links', note: 'note_sources' },
    { code: 'flag_holdings', label: 'Holdings & BCBS', note: 'note_holdings' },
    { code: 'flag_provider', label: 'ETP Provider', note: 'note_provider' },
    { code: 'flag_custodian', label: 'Custodian', note: 'note_custodian' },
    { code: 'flag_create_redeem', label: 'Create & Redeem', note: 'note_create_redeem' },
    { code: 'flag_liquidation', label: 'Liquidation', note: 'note_liquidation' },
    { code: 'flag_staking', label: 'Staking', note: 'note_staking' },
    { code: 'flag_aum', label: 'AUM/Expense', note: 'note_aum' }
  ];

  // ============================================================
  // STYLES
  // ============================================================

  var STYLES = '\
    .crb-action-bar {\
      display: flex;\
      gap: 10px;\
      align-items: center;\
      padding: 8px 0;\
    }\
    .crb-action-btn {\
      padding: 9px 18px;\
      border: none;\
      border-radius: 6px;\
      cursor: pointer;\
      font-size: 13px;\
      font-weight: 600;\
      transition: all 0.2s;\
      color: white;\
      letter-spacing: 0.02em;\
    }\
    .crb-action-btn:hover { opacity: 0.85; transform: translateY(-1px); }\
    .crb-action-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }\
    .crb-btn-complete {\
      background: linear-gradient(135deg, #22c55e, #16a34a);\
      box-shadow: 0 2px 8px rgba(34,197,94,0.3);\
    }\
    .crb-btn-escalate {\
      background: linear-gradient(135deg, #14b8a6, #0d9488);\
      box-shadow: 0 2px 8px rgba(20,184,166,0.3);\
    }\
    .crb-btn-research {\
      background: linear-gradient(135deg, #6366f1, #4f46e5);\
      box-shadow: 0 2px 8px rgba(99,102,241,0.3);\
    }\
    .crb-btn-revert {\
      background: linear-gradient(135deg, #f59e0b, #d97706);\
      box-shadow: 0 2px 8px rgba(245,158,11,0.3);\
    }\
    .crb-status-pill {\
      display: inline-block;\
      padding: 4px 12px;\
      border-radius: 12px;\
      font-size: 12px;\
      font-weight: 600;\
      margin-left: 8px;\
    }\
    .crb-pill-complete { background: #dcfce7; color: #15803d; }\
    .crb-pill-escalated { background: #fef3c7; color: #92400e; }\
    .crb-pill-pending { background: #f1f5f9; color: #64748b; }\
    \
    .crb-modal-overlay {\
      position: fixed;\
      top: 0; left: 0; width: 100%; height: 100%;\
      background: rgba(0,0,0,0.6);\
      z-index: 10000;\
      display: flex;\
      align-items: center;\
      justify-content: center;\
    }\
    .crb-modal {\
      background: white;\
      border-radius: 12px;\
      width: 420px;\
      max-width: 95%;\
      overflow: hidden;\
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);\
    }\
    .crb-modal-header {\
      background: linear-gradient(135deg, #14b8a6, #0d9488);\
      color: white;\
      padding: 18px 24px;\
    }\
    .crb-modal-header h3 {\
      margin: 0;\
      font-size: 16px;\
      font-weight: 600;\
    }\
    .crb-modal-header .crb-modal-sub {\
      margin-top: 4px;\
      font-size: 13px;\
      opacity: 0.9;\
    }\
    .crb-modal-body {\
      padding: 20px 24px;\
    }\
    .crb-form-group {\
      margin-bottom: 16px;\
    }\
    .crb-form-group label {\
      display: block;\
      margin-bottom: 5px;\
      font-weight: 600;\
      font-size: 13px;\
      color: #333;\
    }\
    .crb-form-group select,\
    .crb-form-group textarea {\
      width: 100%;\
      padding: 9px 12px;\
      border: 1px solid #d1d5db;\
      border-radius: 6px;\
      font-size: 13px;\
      font-family: Calibri, "Segoe UI", system-ui, sans-serif;\
      color: #1e293b;\
      background: #fff;\
      box-sizing: border-box;\
      transition: border-color 0.2s;\
    }\
    .crb-form-group select {\
      -webkit-appearance: menulist;\
      appearance: menulist;\
      cursor: pointer;\
    }\
    .crb-form-group select:focus,\
    .crb-form-group textarea:focus {\
      outline: none;\
      border-color: #14b8a6;\
      box-shadow: 0 0 0 3px rgba(20,184,166,0.15);\
    }\
    .crb-form-group textarea {\
      min-height: 80px;\
      resize: vertical;\
    }\
    .crb-modal-footer {\
      padding: 14px 24px;\
      background: #f8f9fa;\
      display: flex;\
      justify-content: flex-end;\
      gap: 10px;\
      border-top: 1px solid #eee;\
    }\
    .crb-modal-btn {\
      padding: 9px 18px;\
      border: none;\
      border-radius: 6px;\
      cursor: pointer;\
      font-size: 13px;\
      font-weight: 600;\
      transition: all 0.2s;\
    }\
    .crb-modal-btn-primary {\
      background: #14b8a6;\
      color: white;\
    }\
    .crb-modal-btn-primary:hover { background: #0d9488; }\
    .crb-modal-btn-secondary {\
      background: white;\
      color: #333;\
      border: 1px solid #ddd;\
    }\
    .crb-modal-btn-secondary:hover { background: #f0f0f0; }\
    .crb-modal-btn:disabled { opacity: 0.6; cursor: not-allowed; }\
    .crb-message {\
      padding: 10px 14px;\
      border-radius: 6px;\
      font-size: 13px;\
      display: none;\
      margin-bottom: 12px;\
    }\
    .crb-message.show { display: block; }\
    .crb-message-success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }\
    .crb-message-error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }\
    \
    .crb-guidance-banner {\
      background: linear-gradient(135deg, #eff6ff, #dbeafe);\
      border: 1px solid #bfdbfe;\
      border-radius: 8px;\
      padding: 10px 16px;\
      margin-bottom: 8px;\
      font-size: 13px;\
      color: #1e40af;\
      display: flex;\
      align-items: flex-start;\
      gap: 10px;\
      line-height: 1.5;\
    }\
    .crb-guidance-banner strong { color: #1e3a8a; }\
    .crb-guidance-text { flex: 1; }\
    .crb-guidance-dismiss {\
      background: none;\
      border: none;\
      font-size: 18px;\
      cursor: pointer;\
      color: #93c5fd;\
      padding: 0 2px;\
      line-height: 1;\
      flex-shrink: 0;\
    }\
    .crb-guidance-dismiss:hover { color: #1e40af; }\
    \
    .crb-flag-summary {\
      margin: 10px 0;\
      padding: 12px;\
      background: #fafafa;\
      border-radius: 8px;\
      border: 1px solid #e5e7eb;\
    }\
    .crb-flag-summary-title {\
      font-size: 12px;\
      font-weight: 600;\
      color: #64748b;\
      text-transform: uppercase;\
      letter-spacing: 0.03em;\
      margin-bottom: 8px;\
    }\
    .crb-flag-chip {\
      display: inline-block;\
      padding: 3px 10px;\
      border-radius: 12px;\
      font-size: 12px;\
      margin: 2px 4px 2px 0;\
    }\
    .crb-flag-chip-flagged { background: #fef3c7; color: #92400e; }\
    .crb-flag-chip-clear { background: #f1f5f9; color: #94a3b8; font-size: 11px; }\
    .crb-confirm-detail {\
      padding: 8px 0;\
      font-size: 13px;\
      color: #475569;\
    }\
    .crb-confirm-detail strong { color: #1e293b; }\
    \
    .crb-toast {\
      position: fixed;\
      top: 16px;\
      left: 50%;\
      transform: translateX(-50%);\
      z-index: 10001;\
      padding: 14px 22px;\
      border-radius: 10px;\
      font-size: 14px;\
      font-weight: 500;\
      box-shadow: 0 4px 24px rgba(0,0,0,0.18);\
      display: flex;\
      align-items: center;\
      gap: 14px;\
      animation: crb-toast-in 0.3s ease;\
    }\
    @keyframes crb-toast-in {\
      from { opacity: 0; transform: translateX(-50%) translateY(-20px); }\
      to { opacity: 1; transform: translateX(-50%) translateY(0); }\
    }\
    .crb-toast-success { background: #166534; color: white; }\
    .crb-toast-btn {\
      background: rgba(255,255,255,0.2);\
      border: 1px solid rgba(255,255,255,0.3);\
      color: white;\
      padding: 5px 14px;\
      border-radius: 5px;\
      cursor: pointer;\
      font-size: 13px;\
      font-weight: 600;\
      white-space: nowrap;\
    }\
    .crb-toast-btn:hover { background: rgba(255,255,255,0.35); }\
    \
    .crb-category-hint {\
      font-size: 11px;\
      color: #94a3b8;\
      margin-top: 4px;\
    }\
  ';

  function injectStyles() {
    if (document.getElementById('crb-101-styles')) return;
    var style = document.createElement('style');
    style.id = 'crb-101-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  // ============================================================
  // DETAIL VIEW: ACTION BUTTONS
  // ============================================================

  kintone.events.on('app.record.detail.show', function(event) {
    injectStyles();
    var r = event.record;
    var recordId = kintone.app.record.getId();
    var loginUser = kintone.getLoginUser().name || '';
    var status = r.review_status ? r.review_status.value : '';
    var companyName = r.company_name ? r.company_name.value : '';
    var darbId = r.Lookup ? r.Lookup.value : '';
    var tier = r.tier ? r.tier.value : '';
    var headerEl = kintone.app.record.getHeaderMenuSpaceElement();

    // Hide redundant fields - action buttons handle these
    kintone.app.record.setFieldShown('review_status', false);
    kintone.app.record.setFieldShown('review_outcome', false);
    kintone.app.record.setFieldShown('escalated_to', false);
    if (!headerEl || document.getElementById('crb-101-action-bar')) return event;

    // Helper: is this a "completed" status? Handles legacy values
    function isComplete(s) { return s && s.indexOf('Complete') === 0; }

    // --- Enhancement 4: Guidance Banner (pending records only) ---
    if (!isComplete(status) && status !== 'Needs Analyst Review') {
      addGuidanceBanner(headerEl);
    }

    var bar = document.createElement('div');
    bar.id = 'crb-101-action-bar';
    bar.className = 'crb-action-bar';

    // Status pill
    var pill = document.createElement('span');
    pill.className = 'crb-status-pill';
    if (isComplete(status)) {
      pill.className += ' crb-pill-complete';
      pill.textContent = 'Complete';
    } else if (status === 'Needs Analyst Review') {
      pill.className += ' crb-pill-escalated';
      pill.textContent = 'Needs Analyst Review';
    } else {
      pill.className += ' crb-pill-pending';
      pill.textContent = status || 'Pending';
    }
    bar.appendChild(pill);

    // --- Pending: Complete + Escalate (all users) ---
    if (!isComplete(status) && status !== 'Needs Analyst Review') {
      var completeBtn = document.createElement('button');
      completeBtn.className = 'crb-action-btn crb-btn-complete';
      completeBtn.textContent = '\u2713 Complete';
      completeBtn.onclick = function() {
        var hasFlags = hasFlagsSet(r);
        var outcomeVal = hasFlags ? 'Updates Made in Main App' : 'No Changes Needed';

        // Enhancement 1 & 2: Confirmation modal with flag summary
        openConfirmModal({
          title: 'Confirm Complete',
          subtitle: companyName + ' (DARB #' + darbId + ') - Tier ' + tier,
          headerColor: 'linear-gradient(135deg, #22c55e, #16a34a)',
          flagSummaryHtml: buildFlagSummaryHtml(r),
          outcomePreview: outcomeVal,
          confirmLabel: '\u2713 Complete Review',
          confirmColor: '#22c55e',
          onConfirm: function() {
            var resolutionVal = hasFlags ? 'Record Updated' : 'No Changes Required';
            return saveWithAudit(recordId, r, {
              review_status: { value: 'Complete' },
              review_date: { value: todayStr() },
              review_outcome: { value: outcomeVal },
              resolution_type: { value: resolutionVal }
            }, 'Status: Complete', loginUser, 'Resolution: ' + resolutionVal)
              .then(function() {
                navigateToNextPending(recordId);
              });
          }
        });
      };
      bar.appendChild(completeBtn);

      var escalateBtn = document.createElement('button');
      escalateBtn.className = 'crb-action-btn crb-btn-escalate';
      escalateBtn.textContent = '\uD83D\uDEA9 Needs Analyst Review';
      escalateBtn.onclick = function() {
        openEscalationModal(r, recordId, loginUser);
      };
      bar.appendChild(escalateBtn);
    }

    // --- Complete: Revert to Pending ---
    if (isComplete(status)) {
      var revertBtn = document.createElement('button');
      revertBtn.className = 'crb-action-btn crb-btn-revert';
      revertBtn.textContent = '\u21A9 Revert to Pending';
      revertBtn.onclick = function() {
        openConfirmModal({
          title: 'Revert to Pending',
          subtitle: companyName + ' (DARB #' + darbId + ') - Tier ' + tier,
          headerColor: 'linear-gradient(135deg, #f59e0b, #d97706)',
          outcomePreview: 'Will re-open this record for review',
          confirmLabel: 'Revert to Pending',
          confirmColor: '#f59e0b',
          onConfirm: function() {
            var revertUpdates = {
              review_status: { value: 'Pending' },
              review_outcome: { value: 'No Changes Needed' },
              escalated_to: { value: '' },
              resolution_type: { value: '' },
              confirmation_date: { value: null }
            };
            // Clear analyst confirmation checkboxes
            var confirmKeys = Object.keys(ANALYST_CONFIRM);
            for (var ci = 0; ci < confirmKeys.length; ci++) {
              revertUpdates[ANALYST_CONFIRM[confirmKeys[ci]]] = { value: [] };
            }
            return saveWithAudit(recordId, r, revertUpdates,
              'Status: Reverted to Pending', loginUser, 'Reverted from Complete')
              .then(function() {
                location.reload();
              });
          }
        });
      };
      bar.appendChild(revertBtn);
    }

    // --- Escalated: Research Complete (Research Admins only) ---
    if (status === 'Needs Analyst Review') {
      var researchBtn = document.createElement('button');
      researchBtn.className = 'crb-action-btn crb-btn-research';
      researchBtn.textContent = 'Research Complete';
      researchBtn.style.display = 'none';
      checkIsAnalyst().then(function(isAnalyst) {
        if (isAnalyst) researchBtn.style.display = '';
      });
      researchBtn.onclick = function() {
        openConfirmModal({
          title: 'Confirm Research Complete',
          subtitle: companyName + ' (DARB #' + darbId + ')',
          headerColor: 'linear-gradient(135deg, #6366f1, #4f46e5)',
          outcomePreview: 'Research review completed by ' + loginUser,
          formHtml: buildResolutionDropdown('crb-resolution-type'),
          confirmLabel: 'Complete Research',
          confirmColor: '#6366f1',
          validate: function(overlay) {
            var val = overlay.querySelector('#crb-resolution-type').value;
            if (!val) return 'Please select whether changes were made.';
            return null;
          },
          onConfirm: function(overlay) {
            var resolution = overlay.querySelector('#crb-resolution-type').value;
            var updates = {
              review_status: { value: 'Complete' },
              review_date: { value: todayStr() },
              confirmation_date: { value: todayStr() },
              review_outcome: { value: 'Analyst Reviewed' },
              resolution_type: { value: resolution }
            };
            var confirmField = ANALYST_CONFIRM[loginUser];
            if (confirmField) {
              updates[confirmField] = { value: ['Confirmed'] };
            }
            return saveWithAudit(recordId, r, updates,
              'Confirmed by ' + loginUser, loginUser, 'Resolution: ' + resolution)
              .then(function() {
                return closeApp57Task('Tier Review (101)', recordId);
              })
              .then(function() {
                navigateToNextPending(recordId);
              });
          }
        });
      };
      bar.appendChild(researchBtn);
    }

    headerEl.appendChild(bar);
    return event;
  });

  // ============================================================
  // CONFIRMATION MODAL (Enhancement 1)
  // ============================================================

  function buildResolutionDropdown(selectId) {
    var opts = '<option value="">-- Select resolution --</option>';
    for (var i = 0; i < RESOLUTION_TYPES.length; i++) {
      opts += '<option value="' + RESOLUTION_TYPES[i] + '">' + RESOLUTION_TYPES[i] + '</option>';
    }
    return '\
      <div class="crb-form-group" style="margin-top:12px;">\
        <label style="font-weight:600;color:#334155;">Were changes made?</label>\
        <select id="' + selectId + '" style="width:100%;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;">' + opts + '</select>\
      </div>';
  }

  function openConfirmModal(options) {
    var overlay = document.createElement('div');
    overlay.id = 'crb-confirm-modal';
    overlay.className = 'crb-modal-overlay';

    var detailsHtml = '<div id="crb-confirm-msg" class="crb-message"></div>';
    if (options.flagSummaryHtml) {
      detailsHtml += options.flagSummaryHtml;
    }
    if (options.outcomePreview) {
      detailsHtml += '<div class="crb-confirm-detail"><strong>Review Outcome:</strong> ' + esc(options.outcomePreview) + '</div>';
    }
    if (options.formHtml) {
      detailsHtml += options.formHtml;
    }

    var headerBg = options.headerColor || 'linear-gradient(135deg, #22c55e, #16a34a)';
    var btnColor = options.confirmColor || '#22c55e';

    overlay.innerHTML = '\
      <div class="crb-modal" style="width:400px;">\
        <div class="crb-modal-header" style="background:' + headerBg + ';">\
          <h3>' + esc(options.title) + '</h3>\
          <div class="crb-modal-sub">' + esc(options.subtitle || '') + '</div>\
        </div>\
        <div class="crb-modal-body">\
          ' + detailsHtml + '\
        </div>\
        <div class="crb-modal-footer">\
          <button class="crb-modal-btn crb-modal-btn-secondary" id="crb-confirm-cancel">Cancel</button>\
          <button class="crb-modal-btn crb-modal-btn-primary" id="crb-confirm-ok" style="background:' + btnColor + ';">' + esc(options.confirmLabel || 'Confirm') + '</button>\
        </div>\
      </div>';

    document.body.appendChild(overlay);

    function cleanup() {
      document.removeEventListener('keydown', escH);
      overlay.remove();
    }
    function escH(e) {
      if (e.key === 'Escape') cleanup();
    }
    document.addEventListener('keydown', escH);

    overlay.querySelector('#crb-confirm-cancel').onclick = function() { cleanup(); };
    overlay.onclick = function(e) { if (e.target === overlay) cleanup(); };

    overlay.querySelector('#crb-confirm-ok').onclick = function() {
      if (options.validate) {
        var validationError = options.validate(overlay);
        if (validationError) {
          var msgEl = overlay.querySelector('#crb-confirm-msg');
          if (msgEl) {
            msgEl.className = 'crb-message crb-message-error show';
            msgEl.textContent = validationError;
          }
          return;
        }
      }

      var btn = overlay.querySelector('#crb-confirm-ok');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      try {
        var result = options.onConfirm(overlay);
      } catch (syncErr) {
        btn.disabled = false;
        btn.textContent = options.confirmLabel || 'Confirm';
        var msgEl = overlay.querySelector('#crb-confirm-msg');
        if (msgEl) {
          msgEl.className = 'crb-message crb-message-error show';
          msgEl.textContent = 'Save failed: ' + (syncErr.message || syncErr);
        }
        return;
      }
      if (result && typeof result.then === 'function') {
        result.then(function() {
          cleanup();
        }).catch(function(e) {
          btn.disabled = false;
          btn.textContent = options.confirmLabel || 'Confirm';
          var msgEl = overlay.querySelector('#crb-confirm-msg');
          if (msgEl) {
            msgEl.className = 'crb-message crb-message-error show';
            msgEl.textContent = 'Save failed: ' + (e.message || e);
          }
        });
      }
    };
  }

  // ============================================================
  // FLAG SUMMARY (Enhancement 2)
  // ============================================================

  function buildFlagSummaryHtml(record) {
    var flagged = [];
    for (var i = 0; i < FLAG_DEFS.length; i++) {
      var f = FLAG_DEFS[i];
      if (record[f.code] && record[f.code].value &&
          record[f.code].value.indexOf('Needs Update') > -1) {
        flagged.push(f.label);
      }
    }

    var html = '<div class="crb-flag-summary">';
    if (flagged.length === 0) {
      html += '<div class="crb-flag-summary-title">No flags set &mdash; all sections look good</div>';
    } else {
      html += '<div class="crb-flag-summary-title">Flagged for update (' + flagged.length + ' of ' + FLAG_DEFS.length + '):</div>';
      for (var j = 0; j < flagged.length; j++) {
        html += '<span class="crb-flag-chip crb-flag-chip-flagged">' + esc(flagged[j]) + '</span>';
      }
    }
    html += '</div>';
    return html;
  }

  // ============================================================
  // ESCALATION MODAL (Enhancement 3: issue categories)
  // ============================================================

  function openEscalationModal(record, recordId, loginUser) {
    var companyName = record.company_name ? record.company_name.value : '';
    var darbId = record.Lookup ? record.Lookup.value : '';
    var tier = record.tier ? record.tier.value : '';

    // Build category options
    var categoryOptions = '<option value="">-- Select a category --</option>';
    for (var i = 0; i < ISSUE_CATEGORIES.length; i++) {
      categoryOptions += '<option value="' + ISSUE_CATEGORIES[i] + '">' + ISSUE_CATEGORIES[i] + '</option>';
    }

    var modalHtml = '\
      <div class="crb-modal">\
        <div class="crb-modal-header">\
          <h3>\uD83D\uDEA9 Needs Analyst Review</h3>\
          <div class="crb-modal-sub">' + esc(companyName) + ' (DARB #' + esc(darbId) + ') - Tier ' + esc(tier) + '</div>\
        </div>\
        <div class="crb-modal-body">\
          <div id="crb-msg" class="crb-message"></div>\
          <div class="crb-form-group">\
            <label>Assign To</label>\
            <select id="crb-assignee"><option value="">Loading analysts...</option></select>\
          </div>\
          <div class="crb-form-group">\
            <label>Issue Category</label>\
            <select id="crb-category">' + categoryOptions + '</select>\
            <div class="crb-category-hint">Helps the analyst know what to expect</div>\
          </div>\
          <div class="crb-form-group">\
            <label>Describe the Issue <span style="font-weight:normal;color:#94a3b8">(optional)</span></label>\
            <textarea id="crb-notes" placeholder="Additional details for the analyst..."></textarea>\
          </div>\
        </div>\
        <div class="crb-modal-footer">\
          <button class="crb-modal-btn crb-modal-btn-secondary" id="crb-cancel">Cancel</button>\
          <button class="crb-modal-btn crb-modal-btn-primary" id="crb-submit">Submit & Create Task</button>\
        </div>\
      </div>';

    var overlay = document.createElement('div');
    overlay.id = 'crb-escalation-modal';
    overlay.className = 'crb-modal-overlay';
    overlay.innerHTML = modalHtml;
    document.body.appendChild(overlay);

    // Populate analyst dropdown from Research Admins group
    getAnalystMembers().then(function(members) {
      var sel = overlay.querySelector('#crb-assignee');
      if (!sel) return;
      var opts = '<option value="">-- Select analyst --</option>';
      if (members.length === 0) {
        opts = '<option value="">No analysts found</option>';
      } else {
        opts += members.map(function(m) {
          return '<option value="' + esc(m.name) + '">' + esc(m.name) + '</option>';
        }).join('');
      }
      sel.innerHTML = opts;
    });

    // Close handlers
    overlay.querySelector('#crb-cancel').onclick = function() { closeModal(); };
    overlay.onclick = function(e) { if (e.target === overlay) closeModal(); };
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); }
    });

    // Submit
    overlay.querySelector('#crb-submit').onclick = function() {
      var assignee = overlay.querySelector('#crb-assignee').value;
      var category = overlay.querySelector('#crb-category').value;
      var notes = overlay.querySelector('#crb-notes').value;

      if (!assignee) {
        showMsg(overlay, 'Please select an analyst to assign to.', 'error');
        return;
      }
      if (!category) {
        showMsg(overlay, 'Please select an issue category.', 'error');
        return;
      }
      var submitBtn = overlay.querySelector('#crb-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating...';

      // Combine category + notes for audit trail and task description
      var fullNotes = notes.trim()
        ? '[' + category + '] ' + notes
        : '[' + category + ']';
      var outcomeVal = 'Flagged for ' + assignee;

      // Create task first — if it fails, the review record is untouched.
      // If record update then fails, the duplicate check prevents re-creation on retry.
      createApp57Task(record, recordId, assignee, loginUser, fullNotes, category)
        .then(function() {
          return saveWithAudit(recordId, record, {
            review_status: { value: 'Needs Analyst Review' },
            escalated_to: { value: assignee },
            review_outcome: { value: outcomeVal }
          }, 'Escalated to ' + assignee, loginUser, fullNotes);
        })
        .then(function() {
          showMsg(overlay, '\u2713 Sent to ' + assignee + ' - task created!', 'success');
          setTimeout(function() {
            closeModal();
            navigateToNextPending(recordId);
          }, 1200);
        })
        .catch(function(e) {
          showMsg(overlay, 'Error: ' + (e.message || e), 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit & Create Task';
        });
    };

    function closeModal() {
      var el = document.getElementById('crb-escalation-modal');
      if (el) el.remove();
    }
  }

  // ============================================================
  // GUIDANCE BANNER (Enhancement 4)
  // ============================================================

  function addGuidanceBanner(headerEl) {
    if (document.getElementById('crb-guidance')) return;
    if (sessionStorage.getItem('crb-guidance-dismissed-101')) return;

    var banner = document.createElement('div');
    banner.id = 'crb-guidance';
    banner.className = 'crb-guidance-banner';
    banner.innerHTML = '<div class="crb-guidance-text">' +
      '<strong>Review Steps:</strong> Check each section below. ' +
      'Flag anything that needs updating using the checkboxes, then click ' +
      '<strong>Complete</strong> (saves your flags) or ' +
      '<strong>Escalate</strong> (assigns to an analyst with a task).' +
      '</div>';

    var dismissBtn = document.createElement('button');
    dismissBtn.className = 'crb-guidance-dismiss';
    dismissBtn.innerHTML = '&times;';
    dismissBtn.title = 'Dismiss for this session';
    dismissBtn.onclick = function() {
      banner.remove();
      sessionStorage.setItem('crb-guidance-dismissed-101', '1');
    };
    banner.appendChild(dismissBtn);

    headerEl.appendChild(banner);
  }

  // ============================================================
  // EDIT VIEW: AUDIT TRAIL
  // ============================================================

  kintone.events.on('app.record.edit.show', function(event) {
    var r = event.record;
    _snapshot = {
      review_status: r.review_status ? r.review_status.value : '',
      escalated_to: r.escalated_to ? r.escalated_to.value : ''
    };

    // Hide redundant fields - action buttons handle these
    kintone.app.record.setFieldShown('review_status', false);
    kintone.app.record.setFieldShown('review_outcome', false);
    kintone.app.record.setFieldShown('escalated_to', false);

    return event;
  });

  kintone.events.on('app.record.edit.submit', function(event) {
    var r = event.record;
    var now = isoTimestamp();
    var user = kintone.getLoginUser().name || 'Unknown';
    var changes = [];

    var newStatus = r.review_status ? r.review_status.value : '';
    if (newStatus && newStatus !== _snapshot.review_status) {
      changes.push({ action: 'Status: ' + newStatus, notes: 'Changed from: ' + (_snapshot.review_status || 'None') });
    }

    var newEscalated = r.escalated_to ? r.escalated_to.value : '';
    if (newEscalated && newEscalated !== _snapshot.escalated_to) {
      changes.push({ action: 'Escalated to ' + newEscalated, notes: '' });
    }

    if (changes.length > 0) {
      var auditLog = r.audit_log ? r.audit_log.value : [];
      changes.forEach(function(c) {
        auditLog.push({
          value: {
            audit_action: { value: c.action },
            audit_user: { value: user },
            audit_timestamp: { value: now },
            audit_notes: { value: c.notes }
          }
        });
      });
      r.audit_log.value = auditLog;
    }
    return event;
  });

  // ============================================================
  // HELPERS
  // ============================================================

  // Kintone DATETIME fields require ISO 8601 format: YYYY-MM-DDTHH:mm:ssZ
  function isoTimestamp() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  // Enhancement 5: Toast notification
  function showToast(msg, actions) {
    var existing = document.getElementById('crb-toast');
    if (existing) existing.remove();

    var toast = document.createElement('div');
    toast.id = 'crb-toast';
    toast.className = 'crb-toast crb-toast-success';

    var span = document.createElement('span');
    span.textContent = msg;
    toast.appendChild(span);

    if (actions && actions.length) {
      for (var i = 0; i < actions.length; i++) {
        var btn = document.createElement('button');
        btn.className = 'crb-toast-btn';
        btn.textContent = actions[i].label;
        btn.onclick = actions[i].onClick;
        toast.appendChild(btn);
      }
    }
    document.body.appendChild(toast);
    return toast;
  }

  // Enhancement 5: Navigate to next pending record
  function navigateToNextPending(currentId) {
    return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app: APP_101,
      query: 'review_status not in ("Complete","Needs Analyst Review") and $id != ' + currentId + ' order by $id asc limit 1',
      fields: ['$id']
    }).then(function(resp) {
      if (resp.records.length > 0) {
        var nextId = resp.records[0].$id.value;
        showToast('\u2713 Done! Loading next record...', [
          { label: 'Back to List', onClick: function() { window.location.href = KINTONE_BASE + '/k/' + APP_101 + '/'; } }
        ]);
        setTimeout(function() {
          window.location.href = KINTONE_BASE + '/k/' + APP_101 + '/show#record=' + nextId;
          location.reload();
        }, 1500);
      } else {
        showToast('\u2713 All done! No more pending records.', [
          { label: 'Back to List', onClick: function() { window.location.href = KINTONE_BASE + '/k/' + APP_101 + '/'; } }
        ]);
        setTimeout(function() {
          window.location.href = KINTONE_BASE + '/k/' + APP_101 + '/';
        }, 2500);
      }
    }).catch(function() {
      location.reload();
    });
  }

  function saveWithAudit(recordId, record, updates, action, user, notes) {
    var auditLog = record.audit_log ? record.audit_log.value.map(function(row) {
      return { id: row.id, value: row.value };
    }) : [];
    auditLog.push({
      value: {
        audit_action: { value: action },
        audit_user: { value: user },
        audit_timestamp: { value: isoTimestamp() },
        audit_notes: { value: notes || '' }
      }
    });
    updates.audit_log = { value: auditLog };
    return kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
      app: APP_101,
      id: recordId,
      record: updates
    });
  }

  function hasFlagsSet(r) {
    for (var i = 0; i < FLAG_DEFS.length; i++) {
      var code = FLAG_DEFS[i].code;
      if (r[code] && r[code].value && r[code].value.indexOf('Needs Update') > -1) {
        return true;
      }
    }
    return false;
  }

  function closeApp57Task(sourceApp, recordId) {
    return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app: APP_57,
      query: 'Source_App in ("' + sourceApp + '") and Source_Record_ID = "' + recordId + '" and status not in ("Complete","Canceled") limit 1',
      fields: ['$id']
    }).then(function(resp) {
      if (resp.records.length === 0) return;
      return kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
        app: APP_57,
        id: resp.records[0].$id.value,
        record: {
          status: { value: 'Complete' },
          Percent_Complete: { value: '100' }
        }
      });
    }).catch(function() {
      // Non-critical: task stays open if this fails
    });
  }

  function createApp57Task(record, recordId, assignee, reviewer, notes, category) {
    var companyName = record.company_name ? record.company_name.value : '';
    var darbId = record.Lookup ? record.Lookup.value : '';
    var tier = record.tier ? record.tier.value : '';
    // Resolve email from cached group members, fall back to default
    var assignTo = DEFAULT_ASSIGNEE_EMAIL;
    if (_analystMembers) {
      for (var m = 0; m < _analystMembers.length; m++) {
        if (_analystMembers[m].name === assignee) { assignTo = _analystMembers[m].email; break; }
      }
    }
    var reviewLink = KINTONE_BASE + '/k/101/show#record=' + recordId;

    // Gather flagged fields for task description
    var flaggedFields = [];
    FLAG_DEFS.forEach(function(f) {
      if (record[f.code] && record[f.code].value &&
          record[f.code].value.indexOf('Needs Update') > -1) {
        var noteVal = record[f.note] ? record[f.note].value : '';
        flaggedFields.push(f.label + (noteVal ? ': ' + noteVal.substring(0, 80) : ''));
      }
    });

    return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app: APP_57,
      query: 'Source_App in ("Tier Review (101)") and Source_Record_ID = "' + recordId + '" and status not in ("Complete","Canceled") limit 1'
    }).then(function(resp) {
      if (resp.records.length > 0) {
        console.log('[Escalation] Task already exists for 101 #' + recordId);
        return resp.records[0];
      }

      var generalNotes = record.general_notes ? record.general_notes.value : '';
      var flagSummary = flaggedFields.length > 0
        ? 'Flagged: ' + flaggedFields.map(function(f) { return esc(f); }).join(' | ') + '<br>'
        : '';
      var description = '<div>Tier Review escalated to ' + esc(assignee) + '<br>'
        + esc(companyName) + ' (DARB #' + esc(darbId) + ') - Tier ' + esc(tier) + '<br>'
        + flagSummary
        + 'Reviewer: ' + esc(reviewer) + '<br>'
        + 'Notes: ' + esc(notes)
        + (generalNotes ? '<br>General Notes: ' + esc(generalNotes) : '')
        + '</div>';

      var taskType = (category && CATEGORY_TO_TASK_TYPE[category]) || 'Database Maintenance';

      return kintone.api(kintone.api.url('/k/v1/record', true), 'POST', {
        app: APP_57,
        record: {
          Project_Name: { value: 'Tier: ' + companyName },
          Project_Field: { value: taskType },
          Task_Assignee: { value: [{ code: assignTo }] },
          Source_Record_ID: { value: String(recordId) },
          Source_App: { value: 'Tier Review (101)' },
          Link: { value: reviewLink },
          project_description: { value: description },
          Scope: { value: 'Single Record' },
          priority: { value: 'Medium' },
          end_date: { value: getFutureDate(3) }
        }
      });
    });
  }

  function showMsg(overlay, msg, type) {
    var el = overlay.querySelector('#crb-msg');
    el.className = 'crb-message crb-message-' + type + ' show';
    el.textContent = msg;
  }

  function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function todayStr() { return new Date().toISOString().split('T')[0]; }

  function getFutureDate(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  }

  // ============================================================
  // GAMIFICATION - Leaderboard, Badges, Streaks
  // ============================================================

  const ANALYSTS = ['Peter', 'Tamara', 'Jim', 'Isaac', 'Tim', 'Anthony', 'Kyle'];

  const BADGES = {
    10: '🥉',
    25: '🥈',
    50: '🥇',
    100: '💎',
    250: '👑'
  };

  const STATUS_COLORS = {
    'Pending': '#f3f4f6',
    'Needs Analyst Review': '#fef3c7',
    'Complete': '#d4edda'
  };

  async function fetchAllRecords() {
    let allRecords = [];
    let offset = 0;
    const limit = 500;
    while (true) {
      const response = await kintone.api('/k/v1/records', 'GET', {
        app: kintone.app.getId(),
        query: 'limit ' + limit + ' offset ' + offset
      });
      allRecords = allRecords.concat(response.records);
      if (response.records.length < limit) break;
      offset += limit;
    }
    return allRecords;
  }

  function calculateStats(records) {
    const stats = {};
    ANALYSTS.forEach(function(analyst) {
      stats[analyst] = {
        name: analyst,
        total: 0,
        completed: 0,
        completedDates: []
      };
    });
    records.forEach(function(record) {
      var reviewer = record.reviewer ? record.reviewer.value : '';
      var status = record.review_status ? record.review_status.value : '';
      var reviewDate = record.review_date ? record.review_date.value : '';
      if (reviewer && stats[reviewer]) {
        stats[reviewer].total++;
        if (status === 'Complete') {
          stats[reviewer].completed++;
          if (reviewDate) stats[reviewer].completedDates.push(reviewDate);
        }
      }
    });
    ANALYSTS.forEach(function(analyst) {
      stats[analyst].streak = calculateGamifyStreak(stats[analyst].completedDates);
      stats[analyst].badge = getBadge(stats[analyst].completed);
    });
    return stats;
  }

  function calculateGamifyStreak(dates) {
    if (dates.length === 0) return 0;
    var sortedDates = dates
      .map(function(d) { return new Date(d); })
      .sort(function(a, b) { return b - a; });
    var streak = 0;
    var currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    for (var i = 0; i < sortedDates.length; i++) {
      var reviewDate = new Date(sortedDates[i]);
      reviewDate.setHours(0, 0, 0, 0);
      var diffDays = Math.floor((currentDate - reviewDate) / (1000 * 60 * 60 * 24));
      if (diffDays <= 1) {
        streak++;
        currentDate = reviewDate;
      } else {
        break;
      }
    }
    return streak;
  }

  function getBadge(completed) {
    var badge = null;
    var thresholds = Object.keys(BADGES).map(Number).sort(function(a, b) { return b - a; });
    for (var i = 0; i < thresholds.length; i++) {
      if (completed >= thresholds[i]) {
        badge = BADGES[thresholds[i]];
        break;
      }
    }
    return badge;
  }

  function buildGamificationPanel(stats, allRecords) {
    var container = document.createElement('div');
    container.id = 'gamification-container';
    container.style.cssText =
      'display: flex; gap: 20px; padding: 15px;' +
      'background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);' +
      'border-radius: 10px; margin: 10px 0; flex-wrap: wrap;';

    var totalAssigned = allRecords.length;
    var totalCompleted = allRecords.filter(function(r) {
      return r.review_status && r.review_status.value === 'Complete';
    }).length;
    var completionRate = totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : 0;

    // Overall progress card
    var overallCard = document.createElement('div');
    overallCard.style.cssText =
      'background: rgba(255,255,255,0.1); border-radius: 8px; padding: 15px; min-width: 200px; color: white;';
    overallCard.innerHTML =
      '<h3 style="margin: 0 0 10px 0; font-size: 14px; color: #aaa;">📊 Overall Progress</h3>' +
      '<div style="font-size: 28px; font-weight: bold; color: #4ade80;">' + completionRate + '%</div>' +
      '<div style="font-size: 12px; color: #888;">' + totalCompleted + ' / ' + totalAssigned + ' reviews</div>' +
      '<div style="background: #333; border-radius: 4px; height: 8px; margin-top: 10px; overflow: hidden;">' +
      '<div style="background: linear-gradient(90deg, #4ade80, #22c55e); height: 100%; width: ' + completionRate + '%; transition: width 0.5s;"></div>' +
      '</div>';
    container.appendChild(overallCard);

    // Leaderboard card
    var leaderboardCard = document.createElement('div');
    leaderboardCard.style.cssText =
      'background: rgba(255,255,255,0.1); border-radius: 8px; padding: 15px; min-width: 300px; color: white; flex-grow: 1;';

    var sortedAnalysts = Object.values(stats)
      .filter(function(s) { return s.total > 0; })
      .sort(function(a, b) { return b.completed - a.completed; });

    var html = '<h3 style="margin: 0 0 10px 0; font-size: 14px; color: #aaa;">🏆 Leaderboard</h3>';
    if (sortedAnalysts.length === 0) {
      html += '<div style="color: #666;">No reviews assigned yet</div>';
    } else {
      html += '<table style="width: 100%; font-size: 13px; border-collapse: collapse;">';
      html += '<tr style="color: #888; text-align: left;">' +
        '<th style="padding: 5px 10px 5px 0;"></th>' +
        '<th style="padding: 5px 10px;">Analyst</th>' +
        '<th style="padding: 5px 10px;">Done</th>' +
        '<th style="padding: 5px 10px;">Progress</th>' +
        '<th style="padding: 5px 10px;">Streak</th></tr>';

      sortedAnalysts.forEach(function(analyst, index) {
        var progress = analyst.total > 0 ? Math.round((analyst.completed / analyst.total) * 100) : 0;
        var medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
        var badge = analyst.badge || '';
        var streak = analyst.streak > 0 ? '🔥' + analyst.streak : '-';
        html +=
          '<tr style="border-top: 1px solid rgba(255,255,255,0.1);">' +
          '<td style="padding: 8px 10px 8px 0; font-size: 16px;">' + medal + '</td>' +
          '<td style="padding: 8px 10px;">' + analyst.name + ' ' + badge + '</td>' +
          '<td style="padding: 8px 10px;">' + analyst.completed + '/' + analyst.total + '</td>' +
          '<td style="padding: 8px 10px; min-width: 100px;">' +
          '<div style="background: #333; border-radius: 4px; height: 6px; overflow: hidden;">' +
          '<div style="background: ' + (progress === 100 ? '#4ade80' : '#3b82f6') + '; height: 100%; width: ' + progress + '%;"></div>' +
          '</div></td>' +
          '<td style="padding: 8px 10px;">' + streak + '</td></tr>';
      });
      html += '</table>';
    }
    leaderboardCard.innerHTML = html;
    container.appendChild(leaderboardCard);

    // Status breakdown card
    var statusCard = document.createElement('div');
    statusCard.style.cssText =
      'background: rgba(255,255,255,0.1); border-radius: 8px; padding: 15px; min-width: 150px; color: white;';
    var pending = allRecords.filter(function(r) { return r.review_status && r.review_status.value === 'Pending'; }).length;
    var escalated = allRecords.filter(function(r) { return r.review_status && r.review_status.value === 'Needs Analyst Review'; }).length;
    statusCard.innerHTML =
      '<h3 style="margin: 0 0 10px 0; font-size: 14px; color: #aaa;">📋 Status</h3>' +
      '<div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px;">' +
      '<div style="display: flex; justify-content: space-between;"><span style="color: #9ca3af;">⏳ Pending</span><span style="font-weight: bold;">' + pending + '</span></div>' +
      '<div style="display: flex; justify-content: space-between;"><span style="color: #fbbf24;">⚠️ Escalated</span><span style="font-weight: bold;">' + escalated + '</span></div>' +
      '<div style="display: flex; justify-content: space-between;"><span style="color: #4ade80;">✅ Complete</span><span style="font-weight: bold;">' + totalCompleted + '</span></div>' +
      '</div>';
    container.appendChild(statusCard);

    return container;
  }

  function colorCodeRows() {
    setTimeout(function() {
      var rows = document.querySelectorAll('.recordlist-row-gaia');
      rows.forEach(function(row) {
        var cells = row.querySelectorAll('td');
        cells.forEach(function(cell) {
          var text = cell.textContent ? cell.textContent.trim() : '';
          if (STATUS_COLORS[text]) {
            row.style.backgroundColor = STATUS_COLORS[text];
          }
        });
      });
    }, 500);
  }

  function showCelebration() {
    var celebration = document.createElement('div');
    celebration.style.cssText =
      'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);' +
      'background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);' +
      'color: white; padding: 30px 50px; border-radius: 15px;' +
      'font-size: 24px; font-weight: bold; z-index: 10000;' +
      'box-shadow: 0 10px 40px rgba(0,0,0,0.3); animation: popIn 0.3s ease-out;';
    celebration.innerHTML = '🎉 Review Complete! 🎉';
    if (!document.getElementById('crb-popIn-anim')) {
      var animStyle = document.createElement('style');
      animStyle.id = 'crb-popIn-anim';
      animStyle.textContent =
        '@keyframes popIn {' +
        '0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }' +
        '100% { transform: translate(-50%, -50%) scale(1); opacity: 1; } }';
      document.head.appendChild(animStyle);
    }
    document.body.appendChild(celebration);
    setTimeout(function() {
      celebration.style.transition = 'opacity 0.5s';
      celebration.style.opacity = '0';
      setTimeout(function() { celebration.remove(); }, 500);
    }, 2000);
  }

  // Gamification - list view dashboard
  kintone.events.on('app.record.index.show', async function(event) {
    if (document.getElementById('gamification-container')) return event;
    var allRecords = await fetchAllRecords();
    var stats = calculateStats(allRecords);
    var container = buildGamificationPanel(stats, allRecords);
    var headerSpace = kintone.app.getHeaderSpaceElement();
    if (headerSpace) headerSpace.appendChild(container);
    colorCodeRows();
    return event;
  });

  // Gamification - reviewer badge on detail view
  kintone.events.on('app.record.detail.show', function(event) {
    var record = event.record;
    var reviewer = record.reviewer ? record.reviewer.value : '';
    if (!reviewer) return event;
    var headerSpace = kintone.app.record.getHeaderMenuSpaceElement();
    if (headerSpace && !document.getElementById('reviewer-badge')) {
      var badgeDiv = document.createElement('div');
      badgeDiv.id = 'reviewer-badge';
      badgeDiv.style.cssText =
        'background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);' +
        'color: white; padding: 8px 15px; border-radius: 20px;' +
        'font-size: 13px; display: inline-block;';
      badgeDiv.textContent = '👤 Reviewer: ' + reviewer;
      headerSpace.appendChild(badgeDiv);
    }
    return event;
  });

  // Gamification - celebration on completion
  kintone.events.on(['app.record.create.submit.success', 'app.record.edit.submit.success'], function(event) {
    var record = event.record;
    var status = record.review_status ? record.review_status.value : '';
    if (status === 'Complete') showCelebration();
    return event;
  });

})();
