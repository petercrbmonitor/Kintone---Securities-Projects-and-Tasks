/**
 * CRB Monitor - Projects/Tasks App (App 57) Enhancements
 * 
 * Adds visual enhancements, status tracking, and notifications
 * for the task management system.
 * 
 * Installation:
 * 1. Go to App 57 Settings → Customization and Integration → JavaScript and CSS
 * 2. Upload this file
 * 3. Save and Update App
 */

(function() {
  'use strict';

  // ============================================================
  // CONFIGURATION
  // ============================================================
  
  const CONFIG = {
    DARB_APP_ID: 23,
    
    // Field codes in App 57 - matched to your actual field codes
    FIELDS: {
      TASK_NAME: 'Project_Name',
      TASK_TYPE: 'Project_Field',
      ASSIGNEE: 'Task_Assignee',       // Assignee field
      STATUS: 'status',               // lowercase
      DUE_DATE: 'end_date',           // lowercase
      START_DATE: 'start_date',       // lowercase
      NOTES: 'project_description',   // lowercase
      SCOPE: 'Scope',                 // New dropdown field
      RECORD_LINK: 'Link',
      RECORD_COUNT: 'Record_Count',   // New number field
      SOURCE_APP: 'Source_App',       // Which app created this task
      SOURCE_RECORD_ID: 'Source_Record_ID',
      PERCENT_COMPLETE: 'Percent_Complete',
      PROJECT_LEAD: 'project_manager',
      COLLABORATORS: 'project_team_members_0',
      HOURS_SPENT: 'hours_spent'             // Number field for time tracking
    },
    
    // Status options
    STATUS: {
      NOT_STARTED: 'Not started - Committed',
      IN_PROGRESS: 'Ongoing',
      COMPLETE: 'Complete',
      ON_HOLD: 'On Hold'
    },
    
    // Colors for visual indicators
    COLORS: {
      HIGH_PRIORITY: '#ef4444',
      OVERDUE: '#ef4444',
      DUE_SOON: '#f59e0b',
      IN_PROGRESS: '#3b82f6',
      COMPLETE: '#22c55e'
    }
  };

  // ============================================================
  // STYLES
  // ============================================================
  
  const STYLES = `
    /* Status badges */
    .crb-status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    
    .crb-status-not-started { background: #f1f5f9; color: #64748b; }
    .crb-status-in-progress { background: #3b82f6; color: white; }
    .crb-status-complete { background: #22c55e; color: white; }
    .crb-status-on-hold { background: #f59e0b; color: white; }
    
    /* Scope badges */
    .crb-scope-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
      margin-left: 8px;
    }
    
    .crb-scope-single { background: #e8f4f8; color: #2980b9; }
    .crb-scope-batch { background: #fef3e2; color: #d68910; }
    .crb-scope-view { background: #f5e6ff; color: #8e44ad; }

    /* Source app badges */
    .crb-source-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
      margin-left: 8px;
    }

    .crb-source-darb { background: #fef3c7; color: #92400e; }
    .crb-source-tier { background: #dbeafe; color: #1e40af; }
    .crb-source-ops { background: #d1fae5; color: #065f46; }
    .crb-source-default { background: #f1f5f9; color: #64748b; }
    
    /* Due date highlighting */
    .crb-overdue {
      color: #ef4444 !important;
      font-weight: 600;
    }

    .crb-due-soon {
      color: #f59e0b !important;
    }
    
    /* Quick action buttons */
    .crb-quick-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 12px;
    }
    
    .crb-action-btn {
      padding: 8px 16px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s;
    }
    
    .crb-action-btn:hover {
      transform: translateY(-1px);
    }
    
    .crb-btn-start {
      background: #3b82f6;
      color: white;
    }

    .crb-btn-complete {
      background: #22c55e;
      color: white;
    }

    .crb-btn-hold {
      background: #f59e0b;
      color: white;
    }
    
    .crb-btn-open-link {
      background: #9b59b6;
      color: white;
    }
    
    /* List view row highlighting */
    .crb-row-overdue {
      background-color: #fef2f2 !important;
      border-left: 4px solid #ef4444 !important;
    }

    .crb-row-due-soon {
      border-left: 4px solid #f59e0b !important;
    }
    
    .crb-row-complete {
      opacity: 0.7;
    }
    
    /* Record link button */
    .crb-link-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      background: #9b59b6;
      color: white;
      border-radius: 6px;
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s;
    }
    
    .crb-link-btn:hover {
      background: #8e44ad;
      color: white;
      text-decoration: none;
    }
    
    /* Assignee display */
    .crb-assignee-tag {
      display: inline-block;
      padding: 4px 10px;
      background: #ecf0f1;
      border-radius: 4px;
      font-size: 13px;
      margin-right: 6px;
      margin-bottom: 4px;
    }
  `;

  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================
  
  function injectStyles() {
    if (document.getElementById('crb-projects-styles')) return;
    const style = document.createElement('style');
    style.id = 'crb-projects-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  function isOverdue(dateStr, status) {
    if (!dateStr) return false;
    if (status === CONFIG.STATUS.COMPLETE) return false;
    const due = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return due < today;
  }

  function isDueSoon(dateStr, days = 3) {
    if (!dateStr) return false;
    const due = new Date(dateStr);
    const today = new Date();
    const soon = new Date();
    soon.setDate(soon.getDate() + days);
    return due >= today && due <= soon;
  }

  function getFieldValue(record, fieldCode, defaultVal = '') {
    if (!record || !record[fieldCode]) return defaultVal;
    return record[fieldCode].value || defaultVal;
  }

  // ============================================================
  // VISUAL ENHANCEMENTS
  // ============================================================
  
  function addScopeBadge(record, spaceId) {
    const space = kintone.app.record.getSpaceElement(spaceId);
    if (!space) return;
    
    const scope = getFieldValue(record, CONFIG.FIELDS.SCOPE);
    const recordCount = getFieldValue(record, CONFIG.FIELDS.RECORD_COUNT, 1);
    
    if (!scope) return;
    
    const badge = document.createElement('span');
    badge.className = `crb-scope-badge crb-scope-${scope.toLowerCase().replace(' ', '-')}`;
    
    if (scope === 'Single Record') {
      badge.textContent = '📄 Single Record';
    } else if (scope === 'Batch') {
      badge.textContent = `📦 Batch (${recordCount} records)`;
    } else if (scope === 'View') {
      badge.textContent = `📋 View (${recordCount} records)`;
    }
    
    space.appendChild(badge);
  }

  function addSourceAppBadge(record, spaceId) {
    const space = kintone.app.record.getSpaceElement(spaceId);
    if (!space) return;

    const sourceApp = getFieldValue(record, CONFIG.FIELDS.SOURCE_APP);
    if (!sourceApp) return;

    const badge = document.createElement('span');
    badge.className = 'crb-source-badge';

    if (sourceApp.indexOf('DARB') > -1 || sourceApp.indexOf('23') > -1) {
      badge.className += ' crb-source-darb';
    } else if (sourceApp.indexOf('Tier') > -1 || sourceApp.indexOf('101') > -1) {
      badge.className += ' crb-source-tier';
    } else if (sourceApp.indexOf('Ops') > -1 || sourceApp.indexOf('102') > -1) {
      badge.className += ' crb-source-ops';
    } else {
      badge.className += ' crb-source-default';
    }

    badge.textContent = sourceApp;
    space.appendChild(badge);
  }

  function addRecordLinkButton(record, spaceId) {
    const space = kintone.app.record.getSpaceElement(spaceId);
    if (!space) return;

    const link = getFieldValue(record, CONFIG.FIELDS.RECORD_LINK);
    if (!link) return;

    const sourceApp = getFieldValue(record, CONFIG.FIELDS.SOURCE_APP);
    let linkLabel = 'Open in DARB Database';
    if (sourceApp.indexOf('Tier') > -1 || sourceApp.indexOf('101') > -1) {
      linkLabel = 'Open in Tier Review';
    } else if (sourceApp.indexOf('Ops') > -1 || sourceApp.indexOf('102') > -1) {
      linkLabel = 'Open in Ops Review';
    }

    const container = document.createElement('div');
    container.style.marginTop = '12px';

    const linkBtn = document.createElement('a');
    linkBtn.className = 'crb-link-btn';
    linkBtn.href = link;
    linkBtn.target = '_blank';
    linkBtn.textContent = '🔗 ' + linkLabel;

    container.appendChild(linkBtn);
    space.appendChild(container);
  }

  function addQuickActions(record, spaceId) {
    const space = kintone.app.record.getSpaceElement(spaceId);
    if (!space) return;
    
    const status = getFieldValue(record, CONFIG.FIELDS.STATUS);
    
    // Don't show actions for completed tasks
    if (status === CONFIG.STATUS.COMPLETE) return;
    
    const container = document.createElement('div');
    container.className = 'crb-quick-actions';
    
    // Start button (if not started)
    if (status === CONFIG.STATUS.NOT_STARTED || status === 'Unprocessed') {
      const startBtn = document.createElement('button');
      startBtn.className = 'crb-action-btn crb-btn-start';
      startBtn.innerHTML = '▶️ Start Task';
      startBtn.onclick = () => updateStatus(CONFIG.STATUS.IN_PROGRESS);
      container.appendChild(startBtn);
    }

    // Resume button (if on hold)
    if (status === CONFIG.STATUS.ON_HOLD) {
      const resumeBtn = document.createElement('button');
      resumeBtn.className = 'crb-action-btn crb-btn-start';
      resumeBtn.innerHTML = '▶️ Resume Task';
      resumeBtn.onclick = () => updateStatus(CONFIG.STATUS.IN_PROGRESS);
      container.appendChild(resumeBtn);
    }

    // Complete button
    const completeBtn = document.createElement('button');
    completeBtn.className = 'crb-action-btn crb-btn-complete';
    completeBtn.innerHTML = '✓ Mark Complete';
    completeBtn.onclick = () => updateStatus(CONFIG.STATUS.COMPLETE);
    container.appendChild(completeBtn);

    // Hold button (if in progress)
    if (status === CONFIG.STATUS.IN_PROGRESS) {
      const holdBtn = document.createElement('button');
      holdBtn.className = 'crb-action-btn crb-btn-hold';
      holdBtn.innerHTML = '⏸️ Put On Hold';
      holdBtn.onclick = () => updateStatus(CONFIG.STATUS.ON_HOLD);
      container.appendChild(holdBtn);
    }
    
    space.appendChild(container);
  }

  async function updateStatus(newStatus) {
    const recordId = kintone.app.record.getId();
    
    const body = {
      app: kintone.app.getId(),
      id: recordId,
      record: {
        [CONFIG.FIELDS.STATUS]: { value: newStatus }
      }
    };
    
    // Set completion percentage
    if (newStatus === CONFIG.STATUS.COMPLETE) {
      if (CONFIG.FIELDS.PERCENT_COMPLETE) {
        body.record[CONFIG.FIELDS.PERCENT_COMPLETE] = { value: '100' };
      }
    }
    
    try {
      await kintone.api(kintone.api.url('/k/v1/record', true), 'PUT', body);
      
      if (typeof kintone.showNotification === 'function') {
        kintone.showNotification({
          text: `Status updated to: ${newStatus}`,
          type: 'success'
        });
      } else {
        alert(`Status updated to: ${newStatus}`);
      }
      
      location.reload();
    } catch (error) {
      alert('Error updating status: ' + error.message);
    }
  }

  // ============================================================
  // LIST VIEW ENHANCEMENTS
  // ============================================================
  
  function enhanceListView(records) {
    setTimeout(() => {
      const rows = document.querySelectorAll('.recordlist-row-gaia');
      
      rows.forEach((row, index) => {
        if (index >= records.length) return;
        
        const record = records[index];
        const status = getFieldValue(record, CONFIG.FIELDS.STATUS);
        const dueDate = getFieldValue(record, CONFIG.FIELDS.DUE_DATE);
        
        // Complete rows
        if (status === CONFIG.STATUS.COMPLETE) {
          row.classList.add('crb-row-complete');
          return;
        }
        
        // Overdue rows
        if (isOverdue(dueDate, status)) {
          row.classList.add('crb-row-overdue');
        }
        // Due soon rows
        else if (isDueSoon(dueDate)) {
          row.classList.add('crb-row-due-soon');
        }
      });
    }, 300);
  }


  // ============================================================
  // EVENT HANDLERS
  // ============================================================
  
  // Record Detail View
  kintone.events.on('app.record.detail.show', function(event) {
    const record = event.record;
    
    injectStyles();
    
    // Add visual enhancements (create these space elements in your form)
    addSourceAppBadge(record, 'source_app_space');
    addScopeBadge(record, 'scope_badge_space');
    addRecordLinkButton(record, 'record_link_space');
    addQuickActions(record, 'quick_actions_space');
    
    return event;
  });

  // Record List View
  kintone.events.on('app.record.index.show', function(event) {
    injectStyles();
    
    if (event.records && event.records.length > 0) {
      enhanceListView(event.records);
    }
    
    return event;
  });

  // Auto-set defaults on create
  kintone.events.on('app.record.create.show', function(event) {
    const record = event.record;
    
    // Set default status
    if (CONFIG.FIELDS.STATUS && record[CONFIG.FIELDS.STATUS]) {
      if (!record[CONFIG.FIELDS.STATUS].value) {
        record[CONFIG.FIELDS.STATUS].value = CONFIG.STATUS.NOT_STARTED;
      }
    }
    
    // Set default scope
    if (CONFIG.FIELDS.SCOPE && record[CONFIG.FIELDS.SCOPE]) {
      if (!record[CONFIG.FIELDS.SCOPE].value) {
        record[CONFIG.FIELDS.SCOPE].value = 'Single Record';
      }
    }
    
    return event;
  });

})();
