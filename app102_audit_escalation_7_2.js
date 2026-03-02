/**
 * App 102 - Ops Data Review Queue: Simplified Audit & Escalation
 * v7.9 - Fixed: revert now clears escalated_to, gamification status values
 *         aligned to action button statuses (Complete not Complete - No Issues),
 *         navigateToNextPending excludes legacy Complete variants,
 *         status breakdown uses actual app statuses (Pending/Complete)
 * v7.8 - Merged App 23 link button, hidden gamification fields, and
 *         gamification dashboard (leaderboard, checklist tracking, quality
 *         badges, streaks, celebration, auto-compute) from standalone files
 * v7.7 - Fixed: removed type property from saveWithAudit subtable values
 *         Added: ANALYST_CONFIRM checkbox logic on Research Complete
 *         (matching App 101 pattern), revert now clears confirmation_date
 *         and analyst checkboxes
 * v7.6 - Fixed: fallback analyst caching (Tamara now resolves correctly),
 *         ESC listener leak in confirm modals, XSS in task descriptions
 *         Added: auto-close App 57 task on Research Complete,
 *         category-to-task-type mapping, safer escalation order
 *         (task created before record updated)
 * v7.5 - Added: resolution_type tracking on Complete and Research Complete
 *         for effectiveness reporting (No Changes Required / Data Corrected /
 *         Information Added / Record Updated)
 * v7.4 - Added: review_outcome tracking for reporting (No Issues Found /
 *         Flagged for [analyst] / Analyst Reviewed)
 *         Fixed: dropdown caching bug, assignee validation, select appearance
 *         Enhanced: confirmation modal, guided escalation, guidance banner,
 *         next-record navigation, readable timestamps
 *
 * Statuses: Pending -> Complete / Needs Analyst Review
 * Ops (Mel/Jaypee): Complete + Escalate buttons
 * Analyst (Peter/Tamara): Research Complete button
 * Escalation creates App 57 task (assign to + notes only)
 * All features consolidated into this single file
 */

(function() {
  'use strict';

  var APP_57 = 57;
  var APP_102 = 102;
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
  var _isAnalyst = null;
  var _analystMembers = null;
  var _snapshot = {};

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
    'Source Discrepancy',
    'Company Record Issue',
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
    'Source Discrepancy': 'Database Maintenance',
    'Company Record Issue': 'Database Maintenance',
    'Needs Further Research': 'Research'
  };

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
    if (document.getElementById('crb-102-styles')) return;
    var style = document.createElement('style');
    style.id = 'crb-102-styles';
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
    var headerEl = kintone.app.record.getHeaderMenuSpaceElement();

    // Hide redundant fields - action buttons handle these
    kintone.app.record.setFieldShown('review_status', false);
    kintone.app.record.setFieldShown('review_outcome', false);
    kintone.app.record.setFieldShown('escalated_to', false);
    if (!headerEl || document.getElementById('crb-102-action-bar')) return event;

    // Helper: is this a "completed" status? Handles legacy values like "Complete - No Issues"
    function isComplete(s) { return s && s.indexOf('Complete') === 0; }

    // --- Enhancement 4: Guidance Banner (pending records only) ---
    if (!isComplete(status) && status !== 'Needs Analyst Review') {
      addGuidanceBanner(headerEl);
    }

    var bar = document.createElement('div');
    bar.id = 'crb-102-action-bar';
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
        // Enhancement 1: Confirmation modal with resolution tracking
        openConfirmModal({
          title: 'Confirm Complete',
          subtitle: companyName + ' (DARB #' + darbId + ')',
          headerColor: 'linear-gradient(135deg, #22c55e, #16a34a)',
          outcomePreview: 'Review completed',
          formHtml: buildResolutionDropdown('crb-resolution-type'),
          confirmLabel: '\u2713 Complete Review',
          confirmColor: '#22c55e',
          validate: function(overlay) {
            var val = overlay.querySelector('#crb-resolution-type').value;
            if (!val) return 'Please select whether changes were made.';
            return null;
          },
          onConfirm: function(overlay) {
            var resolution = overlay.querySelector('#crb-resolution-type').value;
            return saveWithAudit(recordId, r, {
              review_status: { value: 'Complete' },
              review_date: { value: todayStr() },
              review_outcome: { value: 'No Issues Found' },
              resolution_type: { value: resolution }
            }, 'Status: Complete', loginUser, 'Resolution: ' + resolution)
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
          subtitle: companyName + ' (DARB #' + darbId + ')',
          headerColor: 'linear-gradient(135deg, #f59e0b, #d97706)',
          outcomePreview: 'Will re-open this record for review',
          confirmLabel: 'Revert to Pending',
          confirmColor: '#f59e0b',
          onConfirm: function() {
            return saveWithAudit(recordId, r, {
              review_status: { value: 'Pending' },
              review_outcome: { value: '' },
              escalated_to: { value: '' },
              resolution_type: { value: '' },
              confirmation_date: { value: null },
              confirmed_peter: { value: [] },
              confirmed_peter_0: { value: [] }
            }, 'Status: Reverted to Pending', loginUser, 'Reverted from Complete')
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
                return closeApp57Task('Ops Review (102)', recordId);
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

  /**
   * Build resolution type dropdown HTML for confirmation modals.
   * @param {string} selectId - The id attribute for the <select> element
   * @returns {string} HTML string
   */
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

  /**
   * options.formHtml     - optional extra HTML to render in the modal body
   * options.validate     - optional function(overlay) returning error string or null
   * options.onConfirm    - function(overlay) called on confirm; receives overlay for reading form values
   */
  function openConfirmModal(options) {
    var overlay = document.createElement('div');
    overlay.id = 'crb-confirm-modal';
    overlay.className = 'crb-modal-overlay';

    var detailsHtml = '<div id="crb-confirm-msg" class="crb-message"></div>';
    if (options.outcomePreview) {
      detailsHtml += '<div class="crb-confirm-detail"><strong>Action:</strong> ' + esc(options.outcomePreview) + '</div>';
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
      // Run optional validation before confirming
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
  // ESCALATION MODAL (Enhancement 3: issue categories)
  // ============================================================

  function openEscalationModal(record, recordId, loginUser) {
    var companyName = record.company_name ? record.company_name.value : '';
    var darbId = record.Lookup ? record.Lookup.value : '';

    // Build category options
    var categoryOptions = '<option value="">-- Select a category --</option>';
    for (var i = 0; i < ISSUE_CATEGORIES.length; i++) {
      categoryOptions += '<option value="' + ISSUE_CATEGORIES[i] + '">' + ISSUE_CATEGORIES[i] + '</option>';
    }

    var modalHtml = '\
      <div class="crb-modal">\
        <div class="crb-modal-header">\
          <h3>\uD83D\uDEA9 Needs Analyst Review</h3>\
          <div class="crb-modal-sub">' + esc(companyName) + ' (DARB #' + esc(darbId) + ')</div>\
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
    if (sessionStorage.getItem('crb-guidance-dismissed-102')) return;

    var banner = document.createElement('div');
    banner.id = 'crb-guidance';
    banner.className = 'crb-guidance-banner';
    banner.innerHTML = '<div class="crb-guidance-text">' +
      '<strong>Review Steps:</strong> Verify this record\'s data matches the source. ' +
      'If everything looks correct, click <strong>Complete</strong>. ' +
      'If something needs analyst attention, click <strong>Escalate</strong> and describe the issue.' +
      '</div>';

    var dismissBtn = document.createElement('button');
    dismissBtn.className = 'crb-guidance-dismiss';
    dismissBtn.innerHTML = '&times;';
    dismissBtn.title = 'Dismiss for this session';
    dismissBtn.onclick = function() {
      banner.remove();
      sessionStorage.setItem('crb-guidance-dismissed-102', '1');
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
      app: APP_102,
      query: 'review_status not in ("Complete","Complete - No Issues","Complete - Changes Needed","Needs Analyst Review") and $id != ' + currentId + ' order by $id asc limit 1',
      fields: ['$id']
    }).then(function(resp) {
      if (resp.records.length > 0) {
        var nextId = resp.records[0].$id.value;
        showToast('\u2713 Done! Loading next record...', [
          { label: 'Back to List', onClick: function() { window.location.href = KINTONE_BASE + '/k/' + APP_102 + '/'; } }
        ]);
        setTimeout(function() {
          window.location.href = KINTONE_BASE + '/k/' + APP_102 + '/show#record=' + nextId;
          location.reload();
        }, 1500);
      } else {
        showToast('\u2713 All done! No more pending records.', [
          { label: 'Back to List', onClick: function() { window.location.href = KINTONE_BASE + '/k/' + APP_102 + '/'; } }
        ]);
        setTimeout(function() {
          window.location.href = KINTONE_BASE + '/k/' + APP_102 + '/';
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
      app: APP_102,
      id: recordId,
      record: updates
    });
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
    // Resolve email from cached group members, fall back to default
    var assignTo = DEFAULT_ASSIGNEE_EMAIL;
    if (_analystMembers) {
      for (var m = 0; m < _analystMembers.length; m++) {
        if (_analystMembers[m].name === assignee) { assignTo = _analystMembers[m].email; break; }
      }
    }
    var reviewLink = KINTONE_BASE + '/k/102/show#record=' + recordId;

    return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
      app: APP_57,
      query: 'Source_App in ("Ops Review (102)") and Source_Record_ID = "' + recordId + '" and status not in ("Complete","Canceled") limit 1'
    }).then(function(resp) {
      if (resp.records.length > 0) {
        console.log('[Escalation] Task already exists for 102 #' + recordId);
        return resp.records[0];
      }

      var description = '<div>Ops Review escalated to ' + esc(assignee) + '<br>'
        + esc(companyName) + ' (DARB #' + esc(darbId) + ')<br>'
        + 'Reviewer: ' + esc(reviewer) + '<br>'
        + 'Notes: ' + esc(notes)
        + '</div>';

      var taskType = (category && CATEGORY_TO_TASK_TYPE[category]) || 'Database Maintenance';

      return kintone.api(kintone.api.url('/k/v1/record', true), 'POST', {
        app: APP_57,
        record: {
          Project_Name: { value: 'Ops: ' + companyName },
          Project_Field: { value: taskType },
          Task_Assignee: { value: [{ code: assignTo }] },
          Source_Record_ID: { value: String(recordId) },
          Source_App: { value: 'Ops Review (102)' },
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
  // APP 23 LINK + FORM CLEANUP
  // ============================================================

  var SUBDOMAIN = 'csl61zqur0t5';
  var SOURCE_APP_ID = 23;

  // Fields to hide from form (auto-computed, only visible in views)
  var HIDDEN_FIELDS = [
    'completion_score',
    'checklist_progress',
    'issues_found_total',
    'quality_badge'
  ];

  function addApp23Link(event) {
    var record = event.record;
    var existing = document.getElementById('app23-link-btn');
    if (existing) existing.remove();
    var recordNum = record.darb_record ? record.darb_record.value : '';
    if (!recordNum) return event;
    var url = 'https://' + SUBDOMAIN + '.kintone.com/k/' + SOURCE_APP_ID + '/show#record=' + recordNum;
    var btn = document.createElement('a');
    btn.id = 'app23-link-btn';
    btn.href = url;
    btn.target = '_blank';
    btn.style.cssText =
      'display: inline-flex; align-items: center; gap: 6px;' +
      'background: linear-gradient(135deg, #0f4c5c 0%, #1a6b7a 100%);' +
      'color: white; padding: 8px 16px; border-radius: 6px;' +
      'font-size: 13px; font-weight: 600; text-decoration: none;' +
      'cursor: pointer; margin-right: 10px;';
    btn.innerHTML = '📂 Open Record in App 23';
    var headerSpace = kintone.app.record.getHeaderMenuSpaceElement();
    if (headerSpace) headerSpace.insertBefore(btn, headerSpace.firstChild);
    return event;
  }

  function hideComputedFields(event) {
    HIDDEN_FIELDS.forEach(function(fieldCode) {
      var el = kintone.app.record.getFieldElement(fieldCode);
      if (el) el.style.display = 'none';
    });
    return event;
  }

  // App 23 link - record detail view
  kintone.events.on('app.record.detail.show', function(event) {
    addApp23Link(event);
    hideComputedFields(event);
    return event;
  });

  // App 23 link - record edit view
  kintone.events.on('app.record.edit.show', function(event) {
    addApp23Link(event);
    hideComputedFields(event);
    return event;
  });

  // App 23 link - record create view
  kintone.events.on('app.record.create.show', function(event) {
    hideComputedFields(event);
    return event;
  });

  // ============================================================
  // GAMIFICATION - Leaderboard, Badges, Streaks, Auto-compute
  // ============================================================

  var OPS_TEAM = ['Mel', 'Jaypee'];
  var ADMINS = ['Tamara', 'Peter'];

  var BADGES = {
    10:  { icon: '🥉', label: '10 Reviews' },
    25:  { icon: '🥈', label: '25 Reviews' },
    50:  { icon: '🥇', label: '50 Reviews' },
    100: { icon: '💎', label: '100 Reviews' },
    250: { icon: '👑', label: '250 Reviews' }
  };

  var STATUS_COLORS = {
    'Pending':              '#f3f4f6',
    'In Progress':          '#dbeafe',
    'Needs Analyst Review': '#fef3c7',
    'Complete':             '#d1fae5'
  };

  function computeGamification(event) {
    var record = event.record;
    // Checklist progress (0-4)
    var progress = 0;
    if (record.name_verified && record.name_verified.value.indexOf('Yes') >= 0) progress++;
    if (record.tickers_verified && record.tickers_verified.value.indexOf('Yes') >= 0) progress++;
    if (record.links_checked && record.links_checked.value.indexOf('Yes') >= 0) progress++;
    if (record.identifiers_verified && record.identifiers_verified.value.indexOf('Yes') >= 0) progress++;
    record.checklist_progress.value = progress;
    // Issues found total
    var issues = 0;
    var nameDisc = record.name_discrepancy ? record.name_discrepancy.value : '';
    if (nameDisc && nameDisc !== 'None') issues++;
    var tickerIss = record.ticker_issue ? record.ticker_issue.value : '';
    if (tickerIss && tickerIss !== 'None') issues++;
    var deadLinks = parseInt(record.dead_links_found ? record.dead_links_found.value : '0') || 0;
    if (deadLinks > 0) issues++;
    var idIssue = record.identifier_issue ? record.identifier_issue.value : '';
    if (idIssue) issues++;
    record.issues_found_total.value = issues;
    // Completion score
    var status = record.review_status ? record.review_status.value : '';
    var score = 0;
    if (status === 'Complete') score = 100;
    else if (status === 'Needs Analyst Review') score = 75;
    else if (status === 'In Progress') score = 25;
    record.completion_score.value = score;
    // Quality badge
    var badge = '--';
    if (status === 'Complete') {
      if (issues >= 3) badge = 'Eagle Eye';
      else if (issues >= 1) badge = 'Sharp';
      else badge = 'Clean';
    }
    record.quality_badge.value = badge;
    return event;
  }

  async function fetchAllRecords() {
    var allRecords = [];
    var offset = 0;
    var limit = 500;
    while (true) {
      var response = await kintone.api('/k/v1/records', 'GET', {
        app: kintone.app.getId(),
        query: 'limit ' + limit + ' offset ' + offset
      });
      allRecords = allRecords.concat(response.records);
      if (response.records.length < limit) break;
      offset += limit;
    }
    return allRecords;
  }

  function calculateGamifyStats(records) {
    var allNames = OPS_TEAM.concat(ADMINS);
    var stats = {};
    allNames.forEach(function(name) {
      stats[name] = {
        name: name,
        total: 0,
        completed: 0,
        inProgress: 0,
        notStarted: 0,
        needsReview: 0,
        issuesFound: 0,
        eagleEyes: 0,
        completedDates: []
      };
    });
    records.forEach(function(record) {
      var reviewerArr = record.reviewer ? record.reviewer.value : [];
      if (!reviewerArr || reviewerArr.length === 0) return;
      var reviewerName = reviewerArr[0].name || '';
      var matched = null;
      allNames.forEach(function(name) {
        if (reviewerName.toLowerCase().indexOf(name.toLowerCase()) >= 0) {
          matched = name;
        }
      });
      if (!matched) return;
      var status = record.review_status ? record.review_status.value : '';
      var reviewDate = record.review_date ? record.review_date.value : '';
      var issuesTotal = parseInt(record.issues_found_total ? record.issues_found_total.value : '0') || 0;
      var qBadge = record.quality_badge ? record.quality_badge.value : '';
      stats[matched].total++;
      if (status === 'Complete') {
        stats[matched].completed++;
        if (reviewDate) stats[matched].completedDates.push(reviewDate);
        stats[matched].issuesFound += issuesTotal;
        if (qBadge === 'Eagle Eye') stats[matched].eagleEyes++;
      } else if (status === 'In Progress') {
        stats[matched].inProgress++;
      } else if (status === 'Not Started') {
        stats[matched].notStarted++;
      } else if (status === 'Needs Analyst Review') {
        stats[matched].needsReview++;
      }
    });
    allNames.forEach(function(name) {
      stats[name].streak = calculateGamifyStreak(stats[name].completedDates);
      stats[name].milestoneBadge = getMilestoneBadge(stats[name].completed);
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

  function getMilestoneBadge(completed) {
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
      'background: linear-gradient(135deg, #0f4c5c 0%, #1a6b7a 100%);' +
      'border-radius: 10px; margin: 10px 0; flex-wrap: wrap;';

    var totalAssigned = allRecords.length;
    var totalCompleted = allRecords.filter(function(r) {
      var s = r.review_status ? r.review_status.value : '';
      return s === 'Complete';
    }).length;
    var completionRate = totalAssigned > 0 ? Math.round((totalCompleted / totalAssigned) * 100) : 0;
    var totalIssues = 0;
    allRecords.forEach(function(r) {
      totalIssues += parseInt(r.issues_found_total ? r.issues_found_total.value : '0') || 0;
    });

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
      '</div>' +
      '<div style="font-size: 12px; color: #fbbf24; margin-top: 8px;">🎯 ' + totalIssues + ' issues caught</div>';
    container.appendChild(overallCard);

    // Leaderboard card
    var leaderboardCard = document.createElement('div');
    leaderboardCard.style.cssText =
      'background: rgba(255,255,255,0.1); border-radius: 8px; padding: 15px; min-width: 350px; color: white; flex-grow: 1;';

    var sortedAnalysts = Object.values(stats)
      .filter(function(s) { return s.total > 0; })
      .sort(function(a, b) { return b.completed - a.completed; });

    var html = '<h3 style="margin: 0 0 10px 0; font-size: 14px; color: #aaa;">🏆 Leaderboard</h3>';
    if (sortedAnalysts.length === 0) {
      html += '<div style="color: #666;">No reviews assigned yet</div>';
    } else {
      html += '<table style="width: 100%; font-size: 13px; border-collapse: collapse;">';
      html += '<tr style="color: #888; text-align: left;">' +
        '<th style="padding: 5px 8px 5px 0;"></th>' +
        '<th style="padding: 5px 8px;">Reviewer</th>' +
        '<th style="padding: 5px 8px;">Done</th>' +
        '<th style="padding: 5px 8px;">Progress</th>' +
        '<th style="padding: 5px 8px;">Streak</th>' +
        '<th style="padding: 5px 8px;">🦅</th></tr>';

      sortedAnalysts.forEach(function(analyst, index) {
        var progress = analyst.total > 0 ? Math.round((analyst.completed / analyst.total) * 100) : 0;
        var medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
        var mb = analyst.milestoneBadge ? analyst.milestoneBadge.icon : '';
        var streak = analyst.streak > 0 ? '🔥' + analyst.streak : '-';
        var barColor = progress === 100 ? '#4ade80' : progress >= 50 ? '#3b82f6' : '#f59e0b';
        html += '<tr style="border-top: 1px solid rgba(255,255,255,0.1);">' +
          '<td style="padding: 8px 8px 8px 0; font-size: 16px;">' + medal + '</td>' +
          '<td style="padding: 8px 8px;">' + analyst.name + ' ' + mb + '</td>' +
          '<td style="padding: 8px 8px;">' + analyst.completed + '/' + analyst.total + '</td>' +
          '<td style="padding: 8px 8px; min-width: 100px;">' +
          '<div style="background: #333; border-radius: 4px; height: 6px; overflow: hidden;">' +
          '<div style="background: ' + barColor + '; height: 100%; width: ' + progress + '%;"></div>' +
          '</div></td>' +
          '<td style="padding: 8px 8px;">' + streak + '</td>' +
          '<td style="padding: 8px 8px;">' + analyst.eagleEyes + '</td></tr>';
      });
      html += '</table>';
    }
    leaderboardCard.innerHTML = html;
    container.appendChild(leaderboardCard);

    // Status card
    var statusCard = document.createElement('div');
    statusCard.style.cssText =
      'background: rgba(255,255,255,0.1); border-radius: 8px; padding: 15px; min-width: 160px; color: white;';
    var pending = allRecords.filter(function(r) { return (r.review_status ? r.review_status.value : '') === 'Pending'; }).length;
    var inProg = allRecords.filter(function(r) { return (r.review_status ? r.review_status.value : '') === 'In Progress'; }).length;
    var needsReview = allRecords.filter(function(r) { return (r.review_status ? r.review_status.value : '') === 'Needs Analyst Review'; }).length;
    statusCard.innerHTML =
      '<h3 style="margin: 0 0 10px 0; font-size: 14px; color: #aaa;">📋 Status</h3>' +
      '<div style="display: flex; flex-direction: column; gap: 8px; font-size: 13px;">' +
      '<div style="display: flex; justify-content: space-between;"><span style="color: #9ca3af;">⏳ Pending</span><span style="font-weight: bold;">' + pending + '</span></div>' +
      '<div style="display: flex; justify-content: space-between;"><span style="color: #60a5fa;">🔄 In Progress</span><span style="font-weight: bold;">' + inProg + '</span></div>' +
      '<div style="display: flex; justify-content: space-between;"><span style="color: #fbbf24;">⚠️ Escalated</span><span style="font-weight: bold;">' + needsReview + '</span></div>' +
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

  function addRecordHeader(event) {
    var record = event.record;
    var existing = document.getElementById('ops-record-header');
    if (existing) existing.remove();
    var nameOk = (record.name_verified && record.name_verified.value.indexOf('Yes') >= 0);
    var tickersOk = (record.tickers_verified && record.tickers_verified.value.indexOf('Yes') >= 0);
    var linksOk = (record.links_checked && record.links_checked.value.indexOf('Yes') >= 0);
    var idsOk = (record.identifiers_verified && record.identifiers_verified.value.indexOf('Yes') >= 0);
    var done = (nameOk ? 1 : 0) + (tickersOk ? 1 : 0) + (linksOk ? 1 : 0) + (idsOk ? 1 : 0);
    var companyName = record.company_name ? record.company_name.value : 'Record';
    var badgeVal = record.quality_badge ? record.quality_badge.value : '--';
    function ci(ok) { return ok ? '✅' : '⬜'; }
    var badgeHTML = '';
    var qb = { 'Eagle Eye': { i: '🦅', c: '#fef3c7', t: '#92400e', b: '#f59e0b' },
                'Sharp': { i: '🔍', c: '#dbeafe', t: '#1e40af', b: '#3b82f6' },
                'Clean': { i: '✨', c: '#d1fae5', t: '#065f46', b: '#10b981' } };
    if (qb[badgeVal]) {
      var bv = qb[badgeVal];
      badgeHTML = '<span style="background:' + bv.c + ';color:' + bv.t + ';border:1px solid ' + bv.b +
        ';padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;">' + bv.i + ' ' + badgeVal + '</span>';
    }
    var header = document.createElement('div');
    header.id = 'ops-record-header';
    header.style.cssText =
      'background: linear-gradient(135deg, #0f4c5c 0%, #1a6b7a 100%);' +
      'color: white; padding: 12px 20px; border-radius: 8px; margin-bottom: 12px;' +
      'display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;';
    header.innerHTML =
      '<div style="display:flex;align-items:center;gap:16px;">' +
      '<span style="font-size:16px;font-weight:600;">' + companyName + '</span>' +
      '<span style="font-size:13px;opacity:0.8;">Progress: ' + done + '/4</span>' +
      badgeHTML + '</div>' +
      '<div style="display:flex;gap:16px;font-size:13px;">' +
      '<span style="' + (nameOk ? 'opacity:1' : 'opacity:0.5') + ';">' + ci(nameOk) + ' Name</span>' +
      '<span style="' + (tickersOk ? 'opacity:1' : 'opacity:0.5') + ';">' + ci(tickersOk) + ' Tickers</span>' +
      '<span style="' + (linksOk ? 'opacity:1' : 'opacity:0.5') + ';">' + ci(linksOk) + ' Links</span>' +
      '<span style="' + (idsOk ? 'opacity:1' : 'opacity:0.5') + ';">' + ci(idsOk) + ' IDs</span>' +
      '</div>';
    var headerSpace = kintone.app.record.getHeaderMenuSpaceElement();
    if (headerSpace) headerSpace.appendChild(header);
    return event;
  }

  function showCelebration(issuesFound) {
    var message = issuesFound >= 3 ? '🦅 Eagle Eye! 3+ Issues Caught! 🦅' :
                  issuesFound >= 1 ? '🔍 Sharp Eye! Issue Caught! 🔍' :
                  '✨ Clean Review! ✨';
    var celebration = document.createElement('div');
    celebration.style.cssText =
      'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);' +
      'background: linear-gradient(135deg, #0f4c5c 0%, #1a6b7a 100%);' +
      'color: white; padding: 30px 50px; border-radius: 15px;' +
      'font-size: 24px; font-weight: bold; z-index: 10000;' +
      'box-shadow: 0 10px 40px rgba(0,0,0,0.3); animation: popIn 0.3s ease-out;';
    celebration.textContent = message;
    var animStyle = document.createElement('style');
    animStyle.textContent =
      '@keyframes popIn {' +
      '0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }' +
      '100% { transform: translate(-50%, -50%) scale(1); opacity: 1; } }';
    document.head.appendChild(animStyle);
    document.body.appendChild(celebration);
    setTimeout(function() {
      celebration.style.transition = 'opacity 0.5s';
      celebration.style.opacity = '0';
      setTimeout(function() { celebration.remove(); }, 500);
    }, 2500);
  }

  // Auto-compute gamification fields on save
  kintone.events.on([
    'app.record.create.submit',
    'app.record.edit.submit'
  ], computeGamification);

  // Live preview on field changes
  kintone.events.on([
    'app.record.create.change.name_verified',
    'app.record.create.change.tickers_verified',
    'app.record.create.change.links_checked',
    'app.record.create.change.identifiers_verified',
    'app.record.create.change.name_discrepancy',
    'app.record.create.change.ticker_issue',
    'app.record.create.change.dead_links_found',
    'app.record.create.change.identifier_issue',
    'app.record.create.change.review_status',
    'app.record.edit.change.name_verified',
    'app.record.edit.change.tickers_verified',
    'app.record.edit.change.links_checked',
    'app.record.edit.change.identifiers_verified',
    'app.record.edit.change.name_discrepancy',
    'app.record.edit.change.ticker_issue',
    'app.record.edit.change.dead_links_found',
    'app.record.edit.change.identifier_issue',
    'app.record.edit.change.review_status'
  ], computeGamification);

  // Gamification - list view dashboard + color coding
  kintone.events.on('app.record.index.show', async function(event) {
    if (document.getElementById('gamification-container')) return event;
    var allRecords = await fetchAllRecords();
    var stats = calculateGamifyStats(allRecords);
    var container = buildGamificationPanel(stats, allRecords);
    var headerSpace = kintone.app.getHeaderSpaceElement();
    if (headerSpace) headerSpace.appendChild(container);
    colorCodeRows();
    return event;
  });

  // Gamification - record detail checklist header
  kintone.events.on('app.record.detail.show', addRecordHeader);

  // Gamification - celebration on completion
  kintone.events.on([
    'app.record.create.submit.success',
    'app.record.edit.submit.success'
  ], function(event) {
    var record = event.record;
    var status = record.review_status ? record.review_status.value : '';
    if (status === 'Complete') {
      var issues = parseInt(record.issues_found_total ? record.issues_found_total.value : '0') || 0;
      showCelebration(issues);
    }
    return event;
  });

})();
