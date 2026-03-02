/**
 * App 102 - Ops Data Review Queue: Simplified Audit & Escalation
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
 * Works alongside ops_review_app23_link.js and ops_review_gamify.js
 */

(function() {
  'use strict';

  var APP_57 = 57;
  var APP_102 = 102;
  var KINTONE_BASE = location.origin;

  // Group-based roles (matches Kintone People & Groups)
  var ANALYST_GROUP = 'Research Admins';
  var DEFAULT_ASSIGNEE_EMAIL = 'peter@crbmonitor.com';

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
      return _analystMembers;
    }).catch(function() {
      // Don't cache failures so next call retries the API
      return [];
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
              resolution_type: { value: '' }
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
            return saveWithAudit(recordId, r, {
              review_status: { value: 'Complete' },
              review_date: { value: todayStr() },
              review_outcome: { value: 'Analyst Reviewed' },
              resolution_type: { value: resolution }
            }, 'Confirmed by ' + loginUser, loginUser, 'Resolution: ' + resolution)
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

    overlay.querySelector('#crb-confirm-cancel').onclick = function() { overlay.remove(); };
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    document.addEventListener('keydown', function escH(e) {
      if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escH); }
    });

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
          overlay.remove();
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

      // Chain: save record FIRST, then create task
      saveWithAudit(recordId, record, {
        review_status: { value: 'Needs Analyst Review' },
        escalated_to: { value: assignee },
        review_outcome: { value: outcomeVal }
      }, 'Escalated to ' + assignee, loginUser, fullNotes)
        .then(function() {
          return createApp57Task(record, recordId, assignee, loginUser, fullNotes);
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
      query: 'review_status not in ("Complete","Needs Analyst Review") and $id != ' + currentId + ' order by $id asc limit 1',
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
        audit_action: { type: 'SINGLE_LINE_TEXT', value: action },
        audit_user: { type: 'SINGLE_LINE_TEXT', value: user },
        audit_timestamp: { type: 'DATETIME', value: isoTimestamp() },
        audit_notes: { type: 'SINGLE_LINE_TEXT', value: notes || '' }
      }
    });
    updates.audit_log = { value: auditLog };
    return kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', {
      app: APP_102,
      id: recordId,
      record: updates
    });
  }

  function createApp57Task(record, recordId, assignee, reviewer, notes) {
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

      var description = '<div>Ops Review escalated to ' + assignee + '<br>'
        + companyName + ' (DARB #' + darbId + ')<br>'
        + 'Reviewer: ' + reviewer + '<br>'
        + 'Notes: ' + notes
        + '</div>';

      return kintone.api(kintone.api.url('/k/v1/record', true), 'POST', {
        app: APP_57,
        record: {
          Project_Name: { value: 'Ops: ' + companyName },
          Project_Field: { value: 'Database Maintenance' },
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

})();
