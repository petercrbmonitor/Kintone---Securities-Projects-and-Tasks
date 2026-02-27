/**
 * App 102 - Ops Data Review Queue: Simplified Audit & Escalation
 * v7 - Fixed: chained promises, error handling, race conditions
 * 
 * Statuses: Pending → Complete / Needs Analyst Review
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

  var USER_MAP = {
    'Peter': 'peter@crbmonitor.com',
    'Tamara': 'tamara.guy@crbmonitor.com'
  };

  var RESEARCH_USERS = ['Peter', 'Tamara'];
  var _snapshot = {};

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
    var headerEl = kintone.app.record.getHeaderMenuSpaceElement();
    if (!headerEl || document.getElementById('crb-102-action-bar')) return event;

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

    // Helper: is this a "completed" status? Handles legacy values like "Complete - No Issues"
    function isComplete(s) { return s && s.indexOf('Complete') === 0; }

    // --- Pending: Complete + Escalate (all users) ---
    if (!isComplete(status) && status !== 'Needs Analyst Review') {
      var completeBtn = document.createElement('button');
      completeBtn.className = 'crb-action-btn crb-btn-complete';
      completeBtn.textContent = '\u2713 Complete';
      completeBtn.onclick = function() {
        completeBtn.disabled = true;
        completeBtn.textContent = 'Saving...';
        saveWithAudit(recordId, r, {
          review_status: { value: 'Complete' },
          review_date: { value: todayStr() }
        }, 'Status: Complete', loginUser, 'Review completed')
          .then(function() { location.reload(); })
          .catch(function(e) {
            alert('Save failed: ' + (e.message || e));
            completeBtn.disabled = false;
            completeBtn.textContent = '\u2713 Complete';
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

    // --- Escalated: Research Complete (all users) ---
    if (status === 'Needs Analyst Review') {
      var researchBtn = document.createElement('button');
      researchBtn.className = 'crb-action-btn crb-btn-research';
      researchBtn.textContent = 'Research Complete';
      researchBtn.onclick = function() {
        researchBtn.disabled = true;
        researchBtn.textContent = 'Saving...';
        saveWithAudit(recordId, r, {
          review_status: { value: 'Complete' },
          review_date: { value: todayStr() }
        }, 'Status: Complete', loginUser, 'Research review completed')
          .then(function() { location.reload(); })
          .catch(function(e) {
            alert('Save failed: ' + (e.message || e));
            researchBtn.disabled = false;
            researchBtn.textContent = 'Research Complete';
          });
      };
      bar.appendChild(researchBtn);
    }

    headerEl.appendChild(bar);
    return event;
  });

  // ============================================================
  // ESCALATION MODAL (simplified: assign to + notes)
  // ============================================================

  function openEscalationModal(record, recordId, loginUser) {
    var companyName = record.company_name ? record.company_name.value : '';
    var darbId = record.Lookup ? record.Lookup.value : '';

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
            <select id="crb-assignee">\
              <option value="Peter">Peter</option>\
              <option value="Tamara">Tamara</option>\
            </select>\
          </div>\
          <div class="crb-form-group">\
            <label>What\'s the issue?</label>\
            <textarea id="crb-notes" placeholder="Describe what needs analyst attention..."></textarea>\
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

    // Close handlers
    overlay.querySelector('#crb-cancel').onclick = function() { closeModal(); };
    overlay.onclick = function(e) { if (e.target === overlay) closeModal(); };
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); }
    });

    // Submit
    overlay.querySelector('#crb-submit').onclick = function() {
      var assignee = overlay.querySelector('#crb-assignee').value;
      var notes = overlay.querySelector('#crb-notes').value;

      if (!notes.trim()) {
        showMsg(overlay, 'Please describe the issue.', 'error');
        return;
      }

      var submitBtn = overlay.querySelector('#crb-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating...';

      // Chain: save record FIRST, then create task
      saveWithAudit(recordId, record, {
        review_status: { value: 'Needs Analyst Review' },
        escalated_to: { value: assignee }
      }, 'Escalated to ' + assignee, loginUser, notes)
        .then(function() {
          return createApp57Task(record, recordId, assignee, loginUser, notes);
        })
        .then(function() {
          showMsg(overlay, '\u2713 Sent to ' + assignee + ' - task created!', 'success');
          setTimeout(function() { closeModal(); location.reload(); }, 1200);
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
  // EDIT VIEW: AUDIT TRAIL
  // ============================================================

  kintone.events.on('app.record.edit.show', function(event) {
    var r = event.record;
    _snapshot = {
      review_status: r.review_status ? r.review_status.value : '',
      escalated_to: r.escalated_to ? r.escalated_to.value : ''
    };
    return event;
  });

  kintone.events.on('app.record.edit.submit', function(event) {
    var r = event.record;
    var now = new Date().toISOString();
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

  function saveWithAudit(recordId, record, updates, action, user, notes) {
    var auditLog = record.audit_log ? record.audit_log.value.map(function(row) {
      return { id: row.id, value: row.value };
    }) : [];
    auditLog.push({
      value: {
        audit_action: { value: action },
        audit_user: { value: user },
        audit_timestamp: { value: new Date().toISOString() },
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

  function createApp57Task(record, recordId, assignee, reviewer, notes) {
    var companyName = record.company_name ? record.company_name.value : '';
    var darbId = record.Lookup ? record.Lookup.value : '';
    var assignTo = USER_MAP[assignee] || 'peter@crbmonitor.com';
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
