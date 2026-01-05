/**
 * CRB Monitor - DARB App (App 23) Quick Task Assignment
 * 
 * Adds a "Flag for Review" / "Create Task" button to DARB records
 * that creates a task in App 57 (Projects/Tasks) with email notification.
 * 
 * Works for both individual records and can reference bulk views.
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
    
    // Fields in App 23 (DARB) - matched to your field codes
    DARB_FIELDS: {
      COMPANY_NAME: 'Text',               // Primary Business Name
      RECORD_ID: '$id',                   // System field
      TICKER: 'Ticker',                   // Optional
      SECURITY_TYPE: 'Security_Type'      // Optional
    },
    
    // Fields in App 57 (Tasks) - matched to your actual field codes
    TASK_FIELDS: {
      TASK_NAME: 'Project_Name',          // Project Name field
      TASK_TYPE: 'Project_Field',         // Project Field dropdown
      ASSIGNEE: 'Task_Assignee',           // Assignee field
      STATUS: 'status',                   // Dropdown (lowercase)
      DUE_DATE: 'end_date',               // End Date (lowercase)
      NOTES: 'project_description',       // Project Description (lowercase)
      SCOPE: 'Scope',                     // New: "Single Record" / "Batch" / "View"
      RECORD_LINK: 'Link',                // Link field - already exists
      RECORD_COUNT: 'Record_Count',       // Number - ADD THIS
      SOURCE_RECORD_ID: 'Source_Record_ID', // Number - ADD THIS (optional)
      SAVED_IN: 'Saved_In'                // Saved In field - already exists
    },
    
    // Task type options (consolidated list)
    TASK_TYPES: [
      'Kintone',
      'Documentation',
      'Client Requests',
      'Daily Process',
      'Weekly Process',
      'Database Maintenance',
      'Tier/Profile Reviews',
      'Research',
      'BCBS Data',
      'VASPs'
    ],
    
    // Team members
    TEAM_MEMBERS: [
      { name: 'Peter', email: 'peter@crbmonitor.com' },
      { name: 'Tamara Guy', email: 'tamara.guy@crbmonitor.com' },
      { name: 'Timothy Rogers', email: 'timothy.rogers@crbmonitor.com' },
      { name: 'Isaac Moriarty', email: 'isaac.moriarty@crbmonitor.com' },
      { name: 'Mel Dapanas', email: 'mel.dapanas@crbmonitor.com' },
      { name: 'Jaypee Ollos', email: 'joephillip.ollos@crbmonitor.com' },
      { name: 'James Francis', email: 'james.francis@crbmonitor.com' }
    ],
    
    // Default values
    DEFAULT_STATUS: 'Not started - Committed',
    DEFAULT_DUE_DAYS: 7
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
      width: 520px;
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
    
    .crb-flag-btn-small {
      padding: 6px 12px;
      font-size: 12px;
    }
    
    /* Quick task templates */
    .crb-quick-templates {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 16px;
      padding-bottom: 16px;
      border-bottom: 1px solid #eee;
    }
    
    .crb-template-btn {
      padding: 6px 12px;
      background: #f0f0f0;
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
    
    /* List view button */
    .crb-list-actions {
      margin-bottom: 10px;
    }
  `;

  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================
  
  function injectStyles() {
    if (document.getElementById('crb-task-styles')) return;
    const style = document.createElement('style');
    style.id = 'crb-task-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  function getDefaultDueDate(days = CONFIG.DEFAULT_DUE_DAYS) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }

  function getRecordUrl(appId, recordId) {
    const domain = window.location.hostname;
    return `https://${domain}/k/${appId}/show#record=${recordId}`;
  }

  function getCurrentViewUrl() {
    return window.location.href;
  }

  function getFieldValue(record, fieldCode, defaultVal = '') {
    if (!record || !record[fieldCode]) return defaultVal;
    const field = record[fieldCode];
    if (field.value === null || field.value === undefined) return defaultVal;
    return field.value;
  }

  // ============================================================
  // TASK TEMPLATES - Common tasks for quick selection
  // ============================================================
  
  const TASK_TEMPLATES = [
    { name: 'Review Profile', type: 'Review', prefix: 'Review: ' },
    { name: 'Update Data', type: 'Update', prefix: 'Update: ' },
    { name: 'Verify Info', type: 'Verification', prefix: 'Verify: ' },
    { name: 'Clean Data', type: 'Data Clean', prefix: 'Clean: ' },
    { name: 'Research', type: 'Research', prefix: 'Research: ' },
    { name: 'Fix Error', type: 'Data Clean', prefix: 'Fix: ' }
  ];

  // ============================================================
  // MODAL COMPONENT
  // ============================================================
  
  function createTaskModal(options) {
    const { 
      recordId, 
      recordName, 
      recordUrl,
      isBulk = false,
      viewUrl = '',
      recordCount = 1,
      onSubmit, 
      onCancel 
    } = options;

    const overlay = document.createElement('div');
    overlay.className = 'crb-task-modal-overlay';
    
    overlay.innerHTML = `
      <div class="crb-task-modal">
        <div class="crb-modal-header">
          <h2>🚩 Create Task</h2>
          <div class="crb-record-info">
            ${isBulk 
              ? `Bulk Task: ${recordCount} records from current view` 
              : `Record: ${recordName || 'ID ' + recordId}`}
          </div>
        </div>
        
        <div class="crb-modal-body">
          <div id="crb-message"></div>
          
          <div class="crb-quick-templates">
            <span style="font-size: 12px; color: #666; margin-right: 8px;">Quick:</span>
            ${TASK_TEMPLATES.map(t => 
              `<button type="button" class="crb-template-btn" data-prefix="${t.prefix}" data-type="${t.type}">${t.name}</button>`
            ).join('')}
          </div>
          
          <div class="crb-form-group">
            <label>Task Name <span class="required">*</span></label>
            <input type="text" id="crb-task-name" placeholder="e.g., Update Company Names, Review Tier 3 Profiles..." 
                   value="${!isBulk && recordName ? 'Review: ' + recordName : ''}">
          </div>
          
          <div class="crb-form-row">
            <div class="crb-form-group">
              <label>Task Type</label>
              <select id="crb-task-type">
                ${CONFIG.TASK_TYPES.map(t => 
                  `<option value="${t}">${t}</option>`
                ).join('')}
              </select>
            </div>
            
            <div class="crb-form-group">
              <label>Assign To <span class="required">*</span></label>
              <select id="crb-assignee">
                <option value="">-- Select --</option>
                ${CONFIG.TEAM_MEMBERS.map(m => 
                  `<option value="${m.email}">${m.name}</option>`
                ).join('')}
              </select>
            </div>
          </div>
          
          <div class="crb-form-row">
            <div class="crb-form-group">
              <label>Due Date</label>
              <input type="date" id="crb-due-date" value="${getDefaultDueDate()}">
            </div>
            
            <div class="crb-form-group">
              <label>Scope</label>
              <select id="crb-scope">
                <option value="Single Record" ${!isBulk ? 'selected' : ''}>Single Record</option>
                <option value="Batch" ${isBulk ? 'selected' : ''}>Batch / Multiple</option>
                <option value="View">Saved View</option>
              </select>
            </div>
          </div>
          
          ${isBulk ? `
          <div class="crb-form-group">
            <label>Record Count (approx)</label>
            <input type="number" id="crb-record-count" value="${recordCount}" min="1">
          </div>
          ` : ''}
          
          <div class="crb-form-group">
            <label>Notes / Instructions</label>
            <textarea id="crb-notes" placeholder="Add specific instructions, criteria, or context..."></textarea>
          </div>
        </div>
        
        <div class="crb-modal-footer">
          <button type="button" class="crb-btn crb-btn-secondary" id="crb-cancel">Cancel</button>
          <button type="button" class="crb-btn crb-btn-primary" id="crb-submit">
            Create Task & Notify
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Template button handlers
    overlay.querySelectorAll('.crb-template-btn').forEach(btn => {
      btn.onclick = () => {
        const prefix = btn.dataset.prefix;
        const type = btn.dataset.type;
        const nameInput = overlay.querySelector('#crb-task-name');
        const typeSelect = overlay.querySelector('#crb-task-type');
        
        if (!isBulk && recordName) {
          nameInput.value = prefix + recordName;
        } else {
          nameInput.value = prefix;
          nameInput.focus();
        }
        typeSelect.value = type;
      };
    });

    // Cancel handler
    overlay.querySelector('#crb-cancel').onclick = () => {
      overlay.remove();
      if (onCancel) onCancel();
    };

    // Submit handler
    overlay.querySelector('#crb-submit').onclick = async () => {
      const taskName = overlay.querySelector('#crb-task-name').value.trim();
      const taskType = overlay.querySelector('#crb-task-type').value;
      const assignee = overlay.querySelector('#crb-assignee').value;
      const dueDate = overlay.querySelector('#crb-due-date').value;
      const scope = overlay.querySelector('#crb-scope').value;
      const notes = overlay.querySelector('#crb-notes').value;
      const count = isBulk ? (overlay.querySelector('#crb-record-count')?.value || recordCount) : 1;

      // Validation
      if (!taskName) {
        showMessage(overlay, 'Please enter a task name.', 'error');
        return;
      }
      if (!assignee) {
        showMessage(overlay, 'Please select an assignee.', 'error');
        return;
      }

      const submitBtn = overlay.querySelector('#crb-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating...';

      try {
        const result = await onSubmit({
          taskName,
          taskType,
          assignee,
          dueDate,
          scope,
          notes,
          recordCount: count,
          recordUrl: isBulk ? viewUrl : recordUrl,
          sourceRecordId: isBulk ? null : recordId
        });
        
        const assigneeName = CONFIG.TEAM_MEMBERS.find(m => m.email === assignee)?.name || assignee;
        showMessage(overlay, `✓ Task created and assigned to ${assigneeName}!`, 'success');
        
        setTimeout(() => overlay.remove(), 1500);
      } catch (error) {
        showMessage(overlay, `Error: ${error.message}`, 'error');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Task & Notify';
      }
    };

    // Close on overlay click
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.remove();
        if (onCancel) onCancel();
      }
    };

    // Focus first input
    setTimeout(() => {
      const nameInput = overlay.querySelector('#crb-task-name');
      if (!nameInput.value) nameInput.focus();
    }, 100);

    return overlay;
  }

  function showMessage(overlay, message, type) {
    const msgEl = overlay.querySelector('#crb-message');
    msgEl.className = `crb-message crb-message-${type}`;
    msgEl.textContent = message;
  }

  // ============================================================
  // API FUNCTIONS
  // ============================================================
  
  async function createTask(taskData) {
    const body = {
      app: CONFIG.TASK_APP_ID,
      record: {}
    };

    // Map task data to App 57 fields
    const fields = CONFIG.TASK_FIELDS;
    
    if (fields.TASK_NAME) {
      body.record[fields.TASK_NAME] = { value: taskData.taskName };
    }
    if (fields.TASK_TYPE) {
      body.record[fields.TASK_TYPE] = { value: taskData.taskType };
    }
    if (fields.ASSIGNEE) {
      body.record[fields.ASSIGNEE] = { value: [{ code: taskData.assignee }] };
    }
    if (fields.STATUS) {
      body.record[fields.STATUS] = { value: CONFIG.DEFAULT_STATUS };
    }
    if (fields.DUE_DATE && taskData.dueDate) {
      body.record[fields.DUE_DATE] = { value: taskData.dueDate };
    }
    if (fields.NOTES && taskData.notes) {
      body.record[fields.NOTES] = { value: `<div>${taskData.notes}</div>` };
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
    if (fields.SAVED_IN) {
      body.record[fields.SAVED_IN] = { value: 'Kintone' };
    }

    const response = await kintone.api(
      kintone.api.url('/k/v1/record', true),
      'POST',
      body
    );

    return response.id;
  }

  // ============================================================
  // EVENT HANDLERS
  // ============================================================
  
  // Record Detail View - Add "Create Task" button
  kintone.events.on('app.record.detail.show', function(event) {
    const record = event.record;

    injectStyles();

    // Try space element first, then fall back to header right area for top-right positioning
    let container = kintone.app.record.getSpaceElement('task_button_space');

    if (!container) {
      // Position at top-right of the record header
      const headerSpace = kintone.app.record.getHeaderMenuSpaceElement();
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
        const menuEl = document.querySelector('.gaia-argoui-app-menu-statusbar');
        if (menuEl) {
          container = document.createElement('div');
          container.style.display = 'inline-block';
          container.style.marginLeft = 'auto';
          container.style.float = 'right';
          menuEl.appendChild(container);
        }
      }
    }

    if (!container) return event;

    container.innerHTML = '';

    const button = document.createElement('button');
    button.className = 'crb-flag-btn';
    button.innerHTML = '🚩 Create Task';

    button.onclick = function() {
      const recordId = kintone.app.record.getId();
      const recordName = getFieldValue(record, CONFIG.DARB_FIELDS.COMPANY_NAME, 'Record #' + recordId);
      const recordUrl = getRecordUrl(CONFIG.DARB_APP_ID, recordId);

      createTaskModal({
        recordId,
        recordName,
        recordUrl,
        isBulk: false,
        onSubmit: createTask
      });
    };

    container.appendChild(button);

    return event;
  });

  // Record List View - Add "Create Bulk Task" button
  kintone.events.on('app.record.index.show', function(event) {
    if (event.viewType !== 'list' && event.viewType !== 'custom') return event;
    
    injectStyles();
    
    // Check if button already exists
    if (document.getElementById('crb-bulk-task-btn')) return event;
    
    const headerMenuEl = kintone.app.getHeaderMenuSpaceElement();
    if (!headerMenuEl) return event;
    
    const button = document.createElement('button');
    button.id = 'crb-bulk-task-btn';
    button.className = 'crb-flag-btn';
    button.innerHTML = '🚩 Create Task from View';
    
    button.onclick = function() {
      const viewUrl = getCurrentViewUrl();
      const recordCount = event.records ? event.records.length : 0;
      const viewName = event.viewName || 'Current View';
      
      createTaskModal({
        recordId: null,
        recordName: viewName,
        recordUrl: viewUrl,
        isBulk: true,
        viewUrl: viewUrl,
        recordCount: recordCount,
        onSubmit: createTask
      });
    };
    
    headerMenuEl.appendChild(button);
    
    return event;
  });

})();
