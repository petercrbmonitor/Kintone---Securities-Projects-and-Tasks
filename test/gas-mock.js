/* Minimal Google Apps Script mock: enough of SpreadsheetApp to run Code.gs logic offline. */
'use strict';

function pad(v) { return v === undefined ? '' : v; }

class Range {
  constructor(sheet, row, col, nr, nc) {
    this.sh = sheet; this.row = row; this.col = col; this.nr = nr; this.nc = nc;
  }
  getValues() {
    var out = [];
    for (var r = 0; r < this.nr; r++) {
      var line = [];
      for (var c = 0; c < this.nc; c++) line.push(pad(this.sh._cell(this.row + r, this.col + c)));
      out.push(line);
    }
    return out;
  }
  getValue() { return pad(this.sh._cell(this.row, this.col)); }
  setValues(vals) {
    if (vals.length !== this.nr) throw new Error('setValues rows ' + vals.length + ' != ' + this.nr);
    for (var r = 0; r < this.nr; r++) {
      if (vals[r].length !== this.nc) {
        throw new Error('setValues cols ' + vals[r].length + ' != ' + this.nc + ' on ' + this.sh.name);
      }
      for (var c = 0; c < this.nc; c++) this.sh._set(this.row + r, this.col + c, vals[r][c]);
    }
    return this;
  }
  setValue(v) { this.sh._set(this.row, this.col, v); return this; }
  setFormula(f) { this.sh._set(this.row, this.col, f); return this; }
  clearContent() {
    for (var r = 0; r < this.nr; r++) for (var c = 0; c < this.nc; c++) this.sh._set(this.row + r, this.col + c, '');
    return this;
  }
  insertCheckboxes() {
    for (var r = 0; r < this.nr; r++) for (var c = 0; c < this.nc; c++) {
      var v = this.sh._cell(this.row + r, this.col + c);
      if (v !== true && v !== false) this.sh._set(this.row + r, this.col + c, false);
    }
    return this;
  }
  removeCheckboxes() {   // real behaviour: clears TRUE/FALSE values
    for (var r = 0; r < this.nr; r++) for (var c = 0; c < this.nc; c++) {
      var v = this.sh._cell(this.row + r, this.col + c);
      if (v === true || v === false) this.sh._set(this.row + r, this.col + c, '');
    }
    return this;
  }
  createFilter() { this.sh._filter = { remove: () => { this.sh._filter = null; } }; return this.sh._filter; }
  applyRowBanding() { return { setFirstRowColor: () => ({ setSecondRowColor: () => {} }) }; }
}
['setFontFamily','setFontSize','setFontWeight','setBackground','setFontColor','setBorder',
 'setNote','setWrap','setVerticalAlignment','setFontLine','clearDataValidations',
 'setDataValidation','setNumberFormat','setHorizontalAlignment'].forEach(function (m) {
  Range.prototype[m] = function () { return this; };
});

class Sheet {
  constructor(ss, name) {
    this.ss = ss; this.name = name; this.grid = []; this.hidden = false; this._filter = null;
  }
  _cell(r, c) { var row = this.grid[r - 1]; return row ? pad(row[c - 1]) : ''; }
  _set(r, c, v) {
    while (this.grid.length < r) this.grid.push([]);
    var row = this.grid[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v === undefined ? '' : v;
  }
  getName() { return this.name; }
  setName(n) { this.name = n; }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr === undefined ? 1 : nr, nc === undefined ? 1 : nc); }
  getLastRow() {
    for (var r = this.grid.length; r >= 1; r--) {
      var row = this.grid[r - 1] || [];
      for (var c = 0; c < row.length; c++) if (row[c] !== '' && row[c] !== null && row[c] !== undefined) return r;
    }
    return 0;
  }
  getLastColumn() {
    var m = 0;
    this.grid.forEach(function (row) {
      for (var c = row.length; c >= 1; c--) if (row[c - 1] !== '' && row[c - 1] !== undefined) { m = Math.max(m, c); break; }
    });
    return m;
  }
  getMaxRows() { return Math.max(this.grid.length, 1000); }
  getMaxColumns() { return Math.max(this.getLastColumn(), 26); }
  appendRow(vals) {
    var r = this.getLastRow() + 1;
    for (var c = 0; c < vals.length; c++) this._set(r, c + 1, vals[c]);
  }
  deleteRow(r) { this.grid.splice(r - 1, 1); }
  deleteRows(r, n) { this.grid.splice(r - 1, n); }
  clear() { this.grid = []; }
  clearNotes() {}
  getFilter() { return this._filter; }
  getBandings() { return []; }
  setFrozenRows() {} setColumnWidth() {} autoResizeColumns() {}
  hideSheet() { this.hidden = true; } showSheet() { this.hidden = false; }
  isSheetHidden() { return this.hidden; }
  setTabColor() {}
}

class Spreadsheet {
  constructor() { this.sheets = []; this.active = null; this.toasts = []; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.filter(s => s.name === n)[0] || null; }
  insertSheet(n) { var s = new Sheet(this, n); this.sheets.push(s); if (!this.active) this.active = s; return s; }
  deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  getActiveSheet() { return this.active; }
  setActiveSheet(s) { this.active = s; }
  moveActiveSheet() {}
  toast(msg) { this.toasts.push(msg); }
}

var UI_ANSWER = 'YES';
var UI_LOG = [];
var ss = new Spreadsheet();

global.SpreadsheetApp = {
  getActive: () => ss,
  getActiveSheet: () => ss.getActiveSheet(),
  getUi: () => ({
    createMenu: function () { var m = { addItem: () => m, addSeparator: () => m, addSubMenu: () => m, addToUi: () => m }; return m; },
    alert: function (a, b) { UI_LOG.push(String(a) + ' :: ' + String(b || '')); return UI_ANSWER; },
    ButtonSet: { YES_NO: 'YES_NO' },
    Button: { YES: 'YES', NO: 'NO' },
    showModalDialog: function () { UI_LOG.push('modal'); }
  }),
  newDataValidation: () => ({
    requireValueInList: function () { return this; },
    setAllowInvalid: function () { return this; },
    build: () => ({})
  }),
  BandingTheme: { LIGHT_GREY: 'LIGHT_GREY' },
  BorderStyle: { SOLID: 'SOLID' }
};
global.Utilities = {
  formatDate: (d, tz, f) => new Date(d).toISOString().slice(0, 10),
  parseCsv: (s) => s.split('\n').map(l => l.split(',')),
  base64Decode: () => [], newBlob: () => ({ getBytes: () => [] })
};
global.Session = { getScriptTimeZone: () => 'UTC' };
global.LockService = { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
global.ScriptApp = { getProjectTriggers: () => [], newTrigger: () => ({ forSpreadsheet: () => ({ onEdit: () => ({ create: () => {} }) }) }), getOAuthToken: () => 'x' };
global.HtmlService = { createHtmlOutput: () => ({ setWidth: function () { return this; }, setHeight: function () { return this; } }) };
global.DriveApp = { getFileById: () => ({ setTrashed: () => {} }) };
global.UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200, getContentText: () => '{"id":"x"}' }) };
global.Logger = { log: () => {} };

module.exports = { ss, Sheet, setUiAnswer: (a) => { UI_ANSWER = a; }, uiLog: UI_LOG,
  resetSs: () => { ss.sheets = []; ss.active = null; ss.toasts = []; } };
