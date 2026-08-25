/**
 * MailMerge Errors — Owner notifier
 * -----------------------------------
 * Reads the "MailMerge Errors" sheet, groups the rows by Owner, and emails
 * each owner the rows that belong to them (a readable HTML table) with a
 * preamble explaining why those lines need attention.
 *
 * Email rule: Firstname.Surname@up-fm.com
 *   - Default: first token = first name, remaining tokens joined (no spaces) = surname
 *     e.g. "Andy Forsyth"          -> Andy.Forsyth@up-fm.com
 *          "mollykate latham james"-> mollykate.lathamjames@up-fm.com
 *   - OWNER_EMAIL_OVERRIDES lets you hard-code any exceptions.
 *
 * Usage:
 *   1. Open the sheet -> Extensions -> Apps Script, paste this file, Save.
 *   2. Reload the sheet. A "MailMerge Errors" menu appears.
 *   3. Run "Preview emails (no send)" first to sanity-check addresses/content,
 *      then "Send emails to owners".
 */

// ----------------------------- CONFIG -----------------------------

var SHEET_NAME = 'MailMerge Errors';
var EMAIL_DOMAIN = 'up-fm.com';

// Column headers as they appear in the sheet (row 1).
var COL_OWNER = 'Owner';
var DISPLAY_COLUMNS = [
  'Job Number',
  'PO Number',
  'JL Total Quote',
  'JL Total Sell',
  'PO amounts'
];

// Any owner name whose email doesn't follow the default rule.
// Key is the exact owner text (case-insensitive), value is the full address.
var OWNER_EMAIL_OVERRIDES = {
  'mollykate latham james': 'mollykate.lathamjames@up-fm.com'
};

// Optional: send everything to a single test inbox instead of the real owners.
// Leave as '' for normal operation.
var TEST_REDIRECT_TO = '';

// ----------------------------- MENU -----------------------------

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('MailMerge Errors')
    .addItem('Preview emails (no send)', 'previewMailMergeErrors')
    .addItem('Send emails to owners', 'sendMailMergeErrors')
    .addToUi();
}

// ----------------------------- ENTRY POINTS -----------------------------

function sendMailMergeErrors() {
  run_(false);
}

function previewMailMergeErrors() {
  run_(true);
}

// ----------------------------- CORE -----------------------------

function run_(previewOnly) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error('Sheet "' + SHEET_NAME + '" not found.');
  }

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    SpreadsheetApp.getUi().alert('No data rows found on "' + SHEET_NAME + '".');
    return;
  }

  var headers = values[0].map(function (h) { return String(h).trim(); });
  var ownerIdx = headers.indexOf(COL_OWNER);
  if (ownerIdx === -1) {
    throw new Error('Could not find an "' + COL_OWNER + '" column.');
  }

  // Group data rows by owner (preserving column order of the sheet).
  var groups = {};      // ownerKey -> { name: displayName, rows: [ [cells...] ] }
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var ownerName = String(row[ownerIdx]).trim();
    if (!ownerName) continue; // skip rows with no owner

    // Skip fully-empty rows (owner blank already handled; guard the rest too).
    var hasContent = row.some(function (c, i) {
      return i !== ownerIdx && String(c).trim() !== '';
    });
    if (!hasContent) continue;

    var key = ownerName.toLowerCase();
    if (!groups[key]) groups[key] = { name: ownerName, rows: [] };
    groups[key].rows.push(row);
  }

  var report = [];
  Object.keys(groups).forEach(function (key) {
    var group = groups[key];
    var email = ownerEmail_(group.name);
    var recipient = TEST_REDIRECT_TO || email;

    var subject = 'Action needed: ' + group.rows.length +
      ' MailMerge mismatch' + (group.rows.length === 1 ? '' : 'es') +
      ' assigned to you';
    var htmlBody = buildHtmlBody_(group.name, group.rows, headers, ownerIdx);
    var plainBody = buildPlainBody_(group.name, group.rows, headers, ownerIdx);

    if (previewOnly) {
      report.push('• ' + group.name + '  ->  ' + recipient +
        '  (' + group.rows.length + ' row' + (group.rows.length === 1 ? '' : 's') + ')');
    } else {
      MailApp.sendEmail({
        to: recipient,
        subject: subject,
        body: plainBody,
        htmlBody: htmlBody
      });
      report.push('Sent to ' + recipient + ' (' + group.rows.length + ' rows)');
    }
  });

  var ui = SpreadsheetApp.getUi();
  if (previewOnly) {
    ui.alert('Preview — no emails sent\n\n' + report.join('\n'));
  } else {
    ui.alert('Done\n\n' + report.join('\n'));
  }
}

// ----------------------------- EMAIL ADDRESS -----------------------------

function ownerEmail_(ownerName) {
  var override = OWNER_EMAIL_OVERRIDES[ownerName.toLowerCase()];
  if (override) return override;

  var parts = ownerName.trim().split(/\s+/);
  var first = parts[0];
  var surname = parts.slice(1).join(''); // join remaining tokens, no spaces
  if (!surname) surname = ''; // single-word name fallback
  var local = surname ? (first + '.' + surname) : first;
  return local + '@' + EMAIL_DOMAIN;
}

// ----------------------------- BODY BUILDERS -----------------------------

function preambleLines_(firstName) {
  return [
    'Hi ' + firstName + ',',
    '',
    'The rows below are lines in Monday that are not matching between the PO ' +
    'and the costs/quotes on the associated jobs in Joblogic.',
    '',
    'This usually means one of the following:',
    '  • the PO is missing, or',
    '  • the job(s) do not have the right amounts on the associated jobs in JL, or',
    '  • the job(s) have not yet been added to Monday to be checked.',
    '',
    'Please make these amendments yourself in Monday.com to ensure invoicing can ' +
    'proceed — add the missing PO, correct the amounts in JL, or add the job to ' +
    'Monday so the line can be matched.'
  ];
}

function displayColIndexes_(headers, ownerIdx) {
  // Build the list of column indexes to display, in the configured order,
  // falling back to "all columns except Owner" if a configured header is missing.
  var idxs = [];
  DISPLAY_COLUMNS.forEach(function (name) {
    var i = headers.indexOf(name);
    if (i !== -1) idxs.push(i);
  });
  if (idxs.length === 0) {
    for (var i = 0; i < headers.length; i++) {
      if (i !== ownerIdx) idxs.push(i);
    }
  }
  return idxs;
}

function cellText_(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function buildHtmlBody_(ownerName, rows, headers, ownerIdx) {
  var firstName = ownerName.trim().split(/\s+/)[0];
  var idxs = displayColIndexes_(headers, ownerIdx);

  var html = [];
  html.push('<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;">');
  preambleLines_(firstName).forEach(function (line) {
    if (line === '') {
      html.push('<div style="height:8px;"></div>');
    } else {
      html.push('<div>' + escapeHtml_(line) + '</div>');
    }
  });

  html.push('<div style="height:14px;"></div>');
  html.push('<table cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-size:13px;">');

  // Header row
  html.push('<tr style="background:#0b5394;color:#ffffff;">');
  idxs.forEach(function (i) {
    html.push('<th style="border:1px solid #cccccc;text-align:left;">' +
      escapeHtml_(headers[i]) + '</th>');
  });
  html.push('</tr>');

  // Data rows
  rows.forEach(function (row, r) {
    var bg = (r % 2 === 0) ? '#ffffff' : '#f2f6fc';
    html.push('<tr style="background:' + bg + ';">');
    idxs.forEach(function (i) {
      html.push('<td style="border:1px solid #cccccc;">' +
        escapeHtml_(cellText_(row[i])) + '</td>');
    });
    html.push('</tr>');
  });

  html.push('</table>');
  html.push('<div style="height:14px;"></div>');
  html.push('<div style="color:#666;">Thanks,<br>Finance / MailMerge automation</div>');
  html.push('</div>');
  return html.join('');
}

function buildPlainBody_(ownerName, rows, headers, ownerIdx) {
  var firstName = ownerName.trim().split(/\s+/)[0];
  var idxs = displayColIndexes_(headers, ownerIdx);

  var lines = preambleLines_(firstName).slice();
  lines.push('');

  // Column widths
  var widths = idxs.map(function (i) { return headers[i].length; });
  rows.forEach(function (row) {
    idxs.forEach(function (i, c) {
      widths[c] = Math.max(widths[c], cellText_(row[i]).length);
    });
  });

  function pad(s, w) {
    s = String(s);
    while (s.length < w) s += ' ';
    return s;
  }
  function fmtRow(cells) {
    return cells.map(function (s, c) { return pad(s, widths[c]); }).join('  |  ');
  }

  lines.push(fmtRow(idxs.map(function (i) { return headers[i]; })));
  lines.push(idxs.map(function (i, c) {
    var d = ''; for (var k = 0; k < widths[c]; k++) d += '-'; return d;
  }).join('--+--'));
  rows.forEach(function (row) {
    lines.push(fmtRow(idxs.map(function (i) { return cellText_(row[i]); })));
  });

  lines.push('');
  lines.push('Thanks,');
  lines.push('Finance / MailMerge automation');
  return lines.join('\n');
}

// ----------------------------- UTIL -----------------------------

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
