/**
 * UP Reporting - Weekly Outputs
 * Pulls each output tab straight from a BigQuery view in importdata-494110.JobLogic.
 *
 * First run:  setup()      creates/renames tabs, adds the menu and a daily trigger
 * Each run:   refreshAll() pushes Engineer List up, then pulls every view
 *             (SF statuses come from the Salesforce dataset, not a tab)
 */

const CONFIG = {
  projectId: 'importdata-494110',
  dataset: 'JobLogic',
  location: 'US',
  triggerHour: 7                                          // daily refresh, UK time
};

// Friendlier headers for columns BigQuery can't name with spaces
const HEADER_LABELS = {
  No_Visits: 'No Visits',
  No_Completed_Jobs: 'No Completed Jobs',
  Pct_Completed: '% Completed',
  Total_Jobs_Completed: 'Total Jobs Completed',
  Actually_Completed_Date: 'Actually Completed Date',
  SF_Status: 'SF Status'
};

const CATEGORY_PROMPT = 'Categorise the job from the Description from the following list: \n' + [
  'General', 'Plumbing', 'Doors', 'Heating and Cooling (HVAC)', 'Electrical', 'Glass', 'Lighting',
  'Painting and Wall Repair', 'Restrooms', 'Flooring', 'Install', 'Appliances', 'Signage', 'Phone Booth',
  'Cleaning', 'Other', 'Furniture', 'Member Labor Request', 'Carpentry/Handyman', 'Fire, Life, Safety',
  'Furniture/Accessories', 'BMS', 'Glass & Windows', 'Bathroom Accessory', 'Water Treatment', 'Main Plant',
  'Access', 'Andel Leak Alarms', 'Decommission', 'Facilities & Amenity Information', 'Elevator/Lift',
  'Add On - subject to charge', 'Attendance', 'Specialist Repairs', 'Equipment', 'PPM', 'Pest Control',
  'Audit / Assessment', 'Logistics (Removals, Relocations, Disposals etc.)', 'Add Ons Store', 'Survey',
  'whiteboard', 'Spare part Acquisition', 'Ventilation', 'A/C Split System (Inc F Gas)', 'Reset or Move',
  'Plants', 'Fall arrest system', 'Lifting Equipment', 'Controls'
].join('\n');

/**
 * One entry per output tab.
 *  view     BigQuery view to read
 *  orderBy  sort order for the rows
 *  drop     view columns not shown on the tab
 *  extras   columns added after the view's columns:
 *             keep: true   values typed into the tab are kept, matched on column A
 *             formula(r)   formula for row r when there is no kept value
 *  side     formulas written to fixed cells after the data
 */
const OUTPUTS = [
  {
    tab: 'Engineer Completed Visit',
    view: 'vw_Out_Engineer_Completed_Visit',
    orderBy: 'Row_Num',
    drop: ['Row_Num'],
    extras: [{ header: 'Email Sent', keep: true }]
  },
  {
    tab: 'Closed on SF',
    view: 'vw_Out_Closed_on_SF',
    orderBy: 'Date_Logged, ID'
  },
  {
    tab: 'Jobs Missing Closed Dates',
    view: 'vw_Out_Jobs_Missing_Closed_Dates',
    orderBy: 'ID, VisitDateTime',
    side: { W1: '=UNIQUE(FILTER({D:D,T:U},T:T<>""))' }
  },
  {
    tab: 'Project Jobs Missing Closed Dates',
    view: 'vw_Out_Project_Jobs_Missing_Closed_Dates',
    orderBy: 'ID, VisitDateTime'
  },
  {
    tab: 'Missing Categories',
    view: 'vw_Out_Missing_Categories',
    orderBy: 'Job_Number',
    extras: [
      { header: 'Job Number again', formula: r => '=A' + r },
      { header: 'Correct Job Category', keep: true,
        formula: r => '=AI("' + CATEGORY_PROMPT.replace(/"/g, '""') + '",B' + r + ')' }
    ]
  },
  {
    tab: 'Proj Jobs with Child Quote',
    view: 'vw_Out_Proj_Jobs_with_Child_Quote',
    orderBy: 'DateLogged, Job_Number'
  },
  {
    tab: 'H&S Issues',
    view: 'vw_Out_HS_Issues',
    orderBy: 'Date_Logged, ID'
  },
  {
    tab: 'Near Misses',
    view: 'vw_Out_Near_Misses',
    orderBy: 'FormDate'
  }
];

// Input tabs pushed to BigQuery before the views are read
const INPUTS = [
  {
    tab: 'Engineer List',
    table: 'Engineer_List',
    columns: [
      { header: 'Engineer', name: 'Engineer' },
      { header: 'Recipient', name: 'Recipient' }
    ]
  }
];

const CONTROL_TAB = 'Control';
const FONT = 'Arial';


// ---------------------------------------------------------------------
// Menu, setup and trigger
// ---------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('UP Reporting')
    .addItem('Refresh all tabs', 'refreshAll')
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone('Europe/London');

  // Excel caps tab names at 31 characters, so the upload shortened this one
  const short = ss.getSheetByName('Project Jobs Missing Closed Dat');
  if (short && !ss.getSheetByName('Project Jobs Missing Closed Dates')) {
    short.setName('Project Jobs Missing Closed Dates');
  }
  OUTPUTS.forEach(o => getOrCreateSheet_(ss, o.tab));
  INPUTS.forEach(i => getOrCreateSheet_(ss, i.tab));
  getOrCreateSheet_(ss, CONTROL_TAB);

  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'refreshAll')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('refreshAll').timeBased().everyDays(1).atHour(CONFIG.triggerHour).create();

  SpreadsheetApp.getActive().toast('Setup done. Daily refresh at ' + CONFIG.triggerHour + ':00.', 'UP Reporting', 8);
}


// ---------------------------------------------------------------------
// Main refresh
// ---------------------------------------------------------------------

function refreshAll() {
  const ss = SpreadsheetApp.getActive();
  const log = [];
  const started = new Date();

  INPUTS.forEach(input => {
    try {
      const n = pushInput_(ss, input);
      log.push([input.tab, 'Pushed to ' + input.table, n, '']);
    } catch (e) {
      log.push([input.tab, 'Push failed', '', String(e.message || e)]);
    }
  });

  OUTPUTS.forEach(cfg => {
    try {
      const n = refreshOutput_(ss, cfg);
      log.push([cfg.tab, 'Refreshed from ' + cfg.view, n, '']);
    } catch (e) {
      log.push([cfg.tab, 'Refresh failed', '', String(e.message || e)]);
    }
  });

  writeControl_(ss, started, log);
}


// ---------------------------------------------------------------------
// Outputs: BigQuery view -> tab
// ---------------------------------------------------------------------

function refreshOutput_(ss, cfg) {
  const sh = getOrCreateSheet_(ss, cfg.tab);
  const fq = '`' + CONFIG.projectId + '.' + CONFIG.dataset + '.' + cfg.view + '`';
  const select = cfg.drop && cfg.drop.length ? 'SELECT * EXCEPT(' + cfg.drop.join(', ') + ')' : 'SELECT *';
  const sql = select + ' FROM ' + fq + (cfg.orderBy ? ' ORDER BY ' + cfg.orderBy : '');

  const q = runQuery_(sql);
  const extras = cfg.extras || [];
  const headers = q.fields.map(f => HEADER_LABELS[f.name] || f.name).concat(extras.map(e => e.header));
  const width = headers.length;

  // Values typed into "keep" columns, keyed on column A
  const kept = readKeptValues_(sh, extras);

  // Build rows
  const rows = q.rows.map((r, i) => {
    const sheetRow = i + 2;
    const key = String(r[0]);
    const extraVals = extras.map(e => {
      if (e.keep && kept[e.header] && kept[e.header][key] !== undefined) return kept[e.header][key];
      return e.formula ? e.formula(sheetRow) : '';
    });
    return r.concat(extraVals);
  });

  // Clear and write
  sh.clearContents();
  const maxRows = Math.max(rows.length + 1, 2);
  if (sh.getMaxRows() < maxRows) sh.insertRowsAfter(sh.getMaxRows(), maxRows - sh.getMaxRows());
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());

  // Text columns as plain text so phone numbers, refs and descriptions are not reinterpreted
  q.fields.forEach((f, c) => {
    const fmt = numberFormatFor_(f);
    if (fmt) sh.getRange(2, c + 1, maxRows - 1, 1).setNumberFormat(fmt);
  });

  sh.getRange(1, 1, 1, width).setValues([headers])
    .setFontWeight('bold').setBackground('#d9e2f3');
  if (rows.length) sh.getRange(2, 1, rows.length, width).setValues(rows);

  if (cfg.side) {
    Object.keys(cfg.side).forEach(a1 => sh.getRange(a1).setFormula(cfg.side[a1]));
  }

  sh.getDataRange().setFontFamily(FONT);
  sh.setFrozenRows(1);
  return rows.length;
}

function readKeptValues_(sh, extras) {
  const kept = {};
  const keepCols = extras.filter(e => e.keep);
  if (!keepCols.length || sh.getLastRow() < 2) return kept;
  const data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const header = data[0];
  keepCols.forEach(e => {
    const idx = header.indexOf(e.header);
    if (idx < 0) return;
    kept[e.header] = {};
    for (let r = 1; r < data.length; r++) {
      const key = String(data[r][0]);
      const v = data[r][idx];
      const isError = typeof v === 'string' && v.charAt(0) === '#';   // e.g. an AI cell not generated yet
      if (key && v !== '' && v !== null && !isError && kept[e.header][key] === undefined) kept[e.header][key] = v;
    }
  });
  return kept;
}

function numberFormatFor_(field) {
  switch (field.type) {
    case 'STRING': return '@';
    case 'DATE': return 'dd/mm/yyyy';
    case 'DATETIME':
    case 'TIMESTAMP': return 'dd/mm/yyyy hh:mm';
    default:
      return field.name === 'Pct_Completed' ? '0%' : null;
  }
}


// ---------------------------------------------------------------------
// Inputs: tab -> BigQuery table (overwritten each run)
// ---------------------------------------------------------------------

function pushInput_(ss, input) {
  const sh = ss.getSheetByName(input.tab);
  if (!sh || sh.getLastRow() < 2) throw new Error('Tab "' + input.tab + '" is empty');

  const data = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const header = data[0].map(h => String(h).trim());
  const idx = input.columns.map(c => {
    const i = header.indexOf(c.header);
    if (i < 0) throw new Error('Column "' + c.header + '" not found on ' + input.tab);
    return i;
  });

  const out = [];
  for (let r = 1; r < data.length; r++) {
    const vals = input.columns.map((c, k) => cellToText_(data[r][idx[k]], c.ref));
    if (vals.every(v => v === '')) continue;
    out.push([String(r)].concat(vals));   // Row_Num keeps the tab's order
  }

  const schema = [{ name: 'Row_Num', type: 'INTEGER' }]
    .concat(input.columns.map(c => ({ name: c.name, type: 'STRING' })));
  loadTable_(input.table, schema, out);
  return out.length;
}

function cellToText_(v, isRef) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'Europe/London', 'yyyy-MM-dd HH:mm:ss');
  if (typeof v === 'number' && isRef) return String(Math.round(v));   // avoids 1.2102412E7
  return String(v).trim();
}

function loadTable_(tableId, schemaFields, rows) {
  const csv = rows.map(r => r.map(csvCell_).join(',')).join('\n');
  const blob = Utilities.newBlob(csv, 'application/octet-stream');
  const job = {
    jobReference: { projectId: CONFIG.projectId, location: CONFIG.location },
    configuration: {
      load: {
        destinationTable: { projectId: CONFIG.projectId, datasetId: CONFIG.dataset, tableId: tableId },
        schema: { fields: schemaFields },
        sourceFormat: 'CSV',
        allowQuotedNewlines: true,
        writeDisposition: 'WRITE_TRUNCATE',
        createDisposition: 'CREATE_IF_NEEDED'
      }
    }
  };
  let j = BigQuery.Jobs.insert(job, CONFIG.projectId, blob);
  const jobId = j.jobReference.jobId;
  while (j.status.state !== 'DONE') {
    Utilities.sleep(1000);
    j = BigQuery.Jobs.get(CONFIG.projectId, jobId, { location: CONFIG.location });
  }
  if (j.status.errorResult) throw new Error('Load into ' + tableId + ' failed: ' + j.status.errorResult.message);
}

function csvCell_(v) {
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}


// ---------------------------------------------------------------------
// BigQuery query with paging and type conversion
// ---------------------------------------------------------------------

function runQuery_(sql) {
  let res = BigQuery.Jobs.query(
    { query: sql, useLegacySql: false, location: CONFIG.location, timeoutMs: 60000 },
    CONFIG.projectId
  );
  const jobId = res.jobReference.jobId;
  while (!res.jobComplete) {
    Utilities.sleep(1000);
    res = BigQuery.Jobs.getQueryResults(CONFIG.projectId, jobId, { location: CONFIG.location });
  }
  const fields = res.schema.fields;
  let raw = res.rows || [];
  let token = res.pageToken;
  while (token) {
    const page = BigQuery.Jobs.getQueryResults(CONFIG.projectId, jobId, { location: CONFIG.location, pageToken: token });
    raw = raw.concat(page.rows || []);
    token = page.pageToken;
  }
  const rows = raw.map(r => r.f.map((cell, i) => convert_(cell.v, fields[i].type)));
  return { fields: fields, rows: rows };
}

function convert_(v, type) {
  if (v === null || v === undefined) return '';
  switch (type) {
    case 'INTEGER': case 'INT64': case 'FLOAT': case 'FLOAT64':
    case 'NUMERIC': case 'BIGNUMERIC':
      return Number(v);
    case 'BOOLEAN': case 'BOOL':
      return v === 'true';
    case 'DATE': {
      const p = v.split('-').map(Number);
      return new Date(p[0], p[1] - 1, p[2]);
    }
    case 'DATETIME': {
      const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
      return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : v;
    }
    case 'TIMESTAMP':
      return new Date(parseFloat(v) * 1000);
    default:
      return v;
  }
}


// ---------------------------------------------------------------------
// Control tab and helpers
// ---------------------------------------------------------------------

function writeControl_(ss, started, log) {
  const sh = getOrCreateSheet_(ss, CONTROL_TAB);
  sh.clearContents();
  const top = [
    ['UP Reporting - Weekly Outputs', ''],
    ['Source', CONFIG.projectId + '.' + CONFIG.dataset + ' (' + CONFIG.location + ')'],
    ['Last refresh started', started],
    ['Last refresh finished', new Date()],
    ['', '']
  ];
  sh.getRange(1, 1, top.length, 2).setValues(top);
  sh.getRange(3, 2, 2, 1).setNumberFormat('dd/mm/yyyy hh:mm');
  sh.getRange(6, 1, 1, 4).setValues([['Tab', 'Result', 'Rows', 'Error']])
    .setFontWeight('bold').setBackground('#d9e2f3');
  sh.getRange(7, 1, log.length, 4).setValues(log);
  sh.getRange(1, 1).setFontWeight('bold').setFontSize(12);
  sh.getDataRange().setFontFamily(FONT);
  sh.autoResizeColumns(1, 4);
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
