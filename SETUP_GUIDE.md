# CRB Monitor - Task Assignment System

## Complete Setup Guide

A flexible task system for assigning data work from App 23 (DARB) to team members, with tracking in App 57 (Projects/Tasks).

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        App 23 (DARB Database)                   │
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │  Record A   │    │  Record B   │    │  Record C   │  ...    │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘         │
│         │                  │                  │                 │
│         └──────────────────┼──────────────────┘                 │
│                            │                                    │
│              [🚩 Create Task Button]                            │
│                            │                                    │
└────────────────────────────┼────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    App 57 (Projects/Tasks)                      │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Task: "Update Company Names"                              │  │
│  │ Assignee: Tim                                             │  │
│  │ Scope: Batch (47 records)                                 │  │
│  │ Link: [View in DARB] → opens filtered view                │  │
│  │ Status: In Progress                                       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Task: "Review: Coinbase Global Inc"                       │  │
│  │ Assignee: Isaac                                           │  │
│  │ Scope: Single Record                                      │  │
│  │ Link: [View in DARB] → opens specific record              │  │
│  │ Status: Not Started                                       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                             │
                             ▼
                    📧 Email Notification
                    "You've been assigned a task..."
```

---

## Part 1: Add New Fields to App 57 (Projects)

Go to **App 57 → Settings → Form** and add these fields:

### Required New Fields

| Field Name | Field Type | Field Code | Options/Notes |
|------------|-----------|------------|---------------|
| Assignee | User selection | `Assignee` | Allow multiple users |
| Scope | Drop-down | `Scope` | See options below |
| Record Count | Number | `Record_Count` | Optional but useful |
| Source Record ID | Number | `Source_Record_ID` | For linking back |

### Scope Field Options
```
Single Record
Batch
View
```

### Space Elements (for UI enhancements)

Add these **Blank Space** fields with Element IDs:

| Element ID | Purpose |
|------------|---------|
| `scope_badge_space` | Shows scope indicator |
| `record_link_space` | Shows "Open in DARB" button |
| `quick_actions_space` | Shows status update buttons |

### Verify Existing Fields

Make sure these existing fields have the correct field codes:

| Field | Expected Code |
|-------|---------------|
| Project Name | `Project_Name` |
| Project Field | `Project_Field` |
| Status | `Status` |
| End Date | `End_Date` |
| Project Description | `Project_Description` |
| Link | `Link` |
| Percent Complete | `Percent_Complete` |

---

## Part 2: Add Space Element to App 23 (DARB)

Go to **App 23 → Settings → Form** and add:

| Element ID | Purpose |
|------------|---------|
| `task_button_space` | Where "Create Task" button appears |

Place this near the top of your form, after your main identifier fields.

*If you skip this, the button will appear in the menu bar instead.*

---

## Part 3: Configure Email Notifications

### In App 57 (Projects/Tasks)

Go to **Settings → Notifications → Per Record Notifications**

**Add Rule: Task Assignment**

```
Name: New Task Assignment

Condition: 
  Assignee is not empty

Recipients:
  ✓ Assignee field
  ✓ Additional: peter@crbmonitor.com (optional)

Subject: [CRB Task] {{Project_Name}}

Body:
Hi {{Assignee}},

You've been assigned a new task:

📋 Task: {{Project_Name}}
📁 Type: {{Project_Field}}
📅 Due: {{End_Date}}
📊 Scope: {{Scope}}

{{Project_Description}}

🔗 View Task: {{Record URL}}
🔗 Work Link: {{Link}}

Please update the status when you begin and complete this task.
```

**Add Rule: Task Completed (Optional)**

```
Name: Task Completed

Condition:
  Status = Complete

Recipients:
  ✓ peter@crbmonitor.com
  ✓ Project_Lead (if populated)

Subject: ✓ Complete: {{Project_Name}}

Body:
Task "{{Project_Name}}" has been marked complete.

Completed by: {{Updated by}}
```

---

## Part 4: Upload JavaScript Files

### App 23 (DARB Database)

1. Go to **App 23 → Settings → Customization and Integration → JavaScript and CSS**
2. Upload: `darb_app_23_task_button.js`
3. Save → Update App

### App 57 (Projects/Tasks)

1. Go to **App 57 → Settings → Customization and Integration → JavaScript and CSS**
2. Upload: `projects_app_57_enhancements.js`
3. Save → Update App

---

## Part 5: Customize for Your Field Codes

If your field codes differ from the defaults, edit the CONFIG sections in both JS files.

### In `darb_app_23_task_button.js`:

```javascript
const CONFIG = {
  TASK_APP_ID: 57,  // Your Projects app ID
  DARB_APP_ID: 23,  // Your DARB app ID
  
  // Update these to match YOUR App 23 field codes
  DARB_FIELDS: {
    COMPANY_NAME: 'Your_Company_Name_Field',  // Main identifier
    // ...
  },
  
  // Update these to match YOUR App 57 field codes
  TASK_FIELDS: {
    TASK_NAME: 'Project_Name',
    ASSIGNEE: 'Assignee',
    // ...
  }
};
```

### In `projects_app_57_enhancements.js`:

```javascript
const CONFIG = {
  FIELDS: {
    TASK_NAME: 'Project_Name',
    ASSIGNEE: 'Assignee',
    STATUS: 'Status',
    // Update to match your fields
  }
};
```

---

## Part 6: Create Useful Views

### In App 57 - Task Views

**"My Tasks" View:**
- Filter: Assignee contains LOGIN_USER()
- Filter: Status ≠ Complete
- Sort: End_Date (ascending)

**"Tim's Tasks" View:**
- Filter: Assignee contains "timothy.rogers@crbmonitor.com"
- Filter: Status ≠ Complete

**"Isaac's Tasks" View:**
- Filter: Assignee contains "isaac.moriarty@crbmonitor.com"
- Filter: Status ≠ Complete

**"Overdue Tasks" View:**
- Filter: End_Date < TODAY()
- Filter: Status ≠ Complete

**"Data Tasks" View:**
- Filter: Project_Field in ("Data Clean", "Update", "Review", "Verification")
- Filter: Status ≠ Complete

### In App 23 - Save Views for Bulk Tasks

Create and save filtered views that you'll reference in tasks:

- "Tier 3 - Needs Review"
- "Missing CUSIPs"
- "Company Name Updates Needed"
- etc.

---

## How to Use

### Individual Record Task

1. Open any record in App 23
2. Click **🚩 Create Task** button
3. Quick-select template or type task name
4. Select assignee (Tim, Isaac, etc.)
5. Set due date and add notes
6. Click **Create Task & Notify**
7. Assignee receives email with direct link to the record

### Bulk/Batch Task

1. In App 23, filter to the records needing work
2. Save the view (optional but recommended)
3. Click **🚩 Create Task from View** in the header
4. Name the task (e.g., "Update Company Names - Batch")
5. Enter approximate record count
6. Select assignee
7. Click **Create Task & Notify**
8. Assignee receives email with link to the filtered view

### Managing Tasks

1. Assignee opens task in App 57
2. Click **▶️ Start Task** to mark In Progress
3. Click **🔗 Open in DARB** to access the work
4. Complete the data work
5. Click **✓ Mark Complete** when done
6. (Optional) Notification sent on completion

---

## Quick Task Templates

The modal includes three template categories:

**Review**
| Template | Prefix | Type |
|----------|--------|------|
| Securities/CUSIP/ISIN | "ID Check: " | Database Maintenance |
| Pure-Play | "Pure-Play Review: " | Tier/Profile Reviews |
| Tier | "Tier Review: " | Tier/Profile Reviews |
| Sector | "Sector Review: " | Kintone |
| Name Change | "Name Change: " | Kintone |
| Security Status | "Security Status: " | Database Maintenance |
| Pre-IPO | "Pre-IPO: " | Research |
| Business Description | "Biz Desc Review: " | Research |
| Inclusion Rationale | "Inclusion Rationale: " | Tier/Profile Reviews |

**Include**
| Template | Prefix | Type |
|----------|--------|------|
| Possible Inclusion | "Possible Inclusion: " | Tier/Profile Reviews |
| Approved for Inclusion | "Approved for Inclusion: " | Tier/Profile Reviews |

**Exclude**
| Template | Prefix | Type |
|----------|--------|------|
| Possible Exclusion | "Possible Exclusion: " | Tier/Profile Reviews |
| Confirmed for Exclusion | "Confirmed for Exclusion: " | Tier/Profile Reviews |

Click a template to pre-fill the task name and type.

---

## Troubleshooting

### Button Not Appearing

1. Check JavaScript is uploaded and app is updated
2. Verify space element ID exists (or button appears in menu)
3. Check browser console (F12) for errors

### Task Not Creating

1. Verify App 57 ID is correct in CONFIG
2. Check field codes match
3. Ensure you have permission to create records in App 57

### Emails Not Sending

1. Verify Per Record Notifications are configured
2. Check Assignee field has valid Kintone users
3. Check system email settings

### Field Code Errors

1. Go to app Form settings
2. Click on the field
3. Copy exact "Field code" value
4. Update JavaScript CONFIG

---

## Files Reference

| File | Purpose | Upload To |
|------|---------|-----------|
| `darb_app_23_task_button.js` | Adds "Create Task" button | App 23 |
| `projects_app_57_enhancements.js` | Visual enhancements & quick actions | App 57 |
| `SETUP_GUIDE.md` | This document | Reference |

---

## Team Members (Pre-configured)

| Name | Email |
|------|-------|
| Peter | peter@crbmonitor.com |
| Tamara Guy | tamara.guy@crbmonitor.com |
| Timothy Rogers | timothy.rogers@crbmonitor.com |
| Isaac Moriarty | isaac.moriarty@crbmonitor.com |
| Mel Dapanas | mel.dapanas@crbmonitor.com |
| Jaypee Ollos | joephillip.ollos@crbmonitor.com |
| James Francis | james.francis@crbmonitor.com |

To add/remove team members, edit the `TEAM_MEMBERS` array in `darb_app_23_task_button.js`.

---

*Last Updated: March 2026*
