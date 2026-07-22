/**
 * Monday upgrade-link relay (Google Apps Script web app).
 * Part of the JobLogic -> Monday integration (see MONDAY_SYNC_SPEC.md, Path B / step 3).
 *
 * The TamperMonkey userscript (joblogic-monday-upgrade.user.js) POSTs, at quote-upgrade time:
 *   { secret, jobNumber, parentJobStringId, quoteNumber? }
 * This relay matches the Monday item by parentJobStringId (against BOTH the Original Job Ref and
 * Upgraded Job Ref columns) and writes jobNumber into "Upgraded Job Ref". Fill-blank policy: it
 * never overwrites a different existing value; it reports a mismatch instead. If quoteNumber is
 * given and the Quote cell is blank, it fills that too (instant quote update).
 *
 * The Monday token lives ONLY here (Script Properties), never in the browser.
 *
 * SETUP (once):
 *  1. script.google.com -> New project, paste this file.
 *  2. Project Settings -> Script Properties, add:
 *       MONDAY_TOKEN   = <your Monday API token>
 *       SHARED_SECRET  = <a long random string; also goes in the userscript>
 *     (BOARD_ID / column ids default below; override as properties only if they change.)
 *  3. Deploy -> New deployment -> type "Web app":
 *       Execute as: Me ; Who has access: Anyone.
 *     Copy the /exec URL -> that goes in the userscript (RELAY_URL).
 *  Test:  GET the /exec URL in a browser -> should return {"ok":true,...}.
 */

var CFG = {
  API: 'https://api.monday.com/v2',
  API_VERSION: '2024-10',
  BOARD_ID: '5084790211',
  COL_ANCHOR: 'text_mkyrcb16',   // Original Job Ref.
  COL_UPGRADED: 'text_mm5gxah5', // Upgraded Job Ref
  COL_QUOTE: 'text__1'           // Quote
};

function props_() { return PropertiesService.getScriptProperties(); }
function cfg_(k) { return props_().getProperty(k) || CFG[k]; }

function mondayQuery_(query, variables) {
  var res = UrlFetchApp.fetch(CFG.API, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'Authorization': props_().getProperty('MONDAY_TOKEN'), 'API-Version': CFG.API_VERSION },
    payload: JSON.stringify({ query: query, variables: variables || {} })
  });
  var body = JSON.parse(res.getContentText());
  if (body.errors) throw new Error('Monday error: ' + JSON.stringify(body.errors).slice(0, 300));
  return body.data;
}

function norm_(s) { return (s == null ? '' : String(s)).trim(); }

// All items whose Original OR Upgraded Job Ref equals any of `vals` (original or upgraded job#),
// de-duplicated by id. A project may be split across several Monday items, so return them all.
function findItems_(vals) {
  var cols = [cfg_('COL_ANCHOR'), cfg_('COL_UPGRADED')];
  var ids = '"' + cfg_('COL_ANCHOR') + '","' + cfg_('COL_UPGRADED') + '","' + cfg_('COL_QUOTE') + '"';
  var q = 'query($b:ID!,$c:String!,$v:[String!]!){items_page_by_column_values(board_id:$b,' +
          'columns:[{column_id:$c,column_values:$v}],limit:25){items{id name ' +
          'column_values(ids:[' + ids + ']){id text}}}}';
  var seen = {}, out = [];
  for (var i = 0; i < cols.length; i++) {
    for (var j = 0; j < vals.length; j++) {
      if (!vals[j]) continue;
      var items = mondayQuery_(q, { b: cfg_('BOARD_ID'), c: cols[i], v: [vals[j]] }).items_page_by_column_values.items;
      (items || []).forEach(function (it) { if (!seen[it.id]) { seen[it.id] = 1; out.push(it); } });
    }
  }
  return out;
}

function applyToItem_(item, parent, jobNumber, quote) {
  var cv = {};
  item.column_values.forEach(function (c) { cv[c.id] = norm_(c.text); });
  var curOrig = cv[cfg_('COL_ANCHOR')] || '', curUpg = cv[cfg_('COL_UPGRADED')] || '', curQuote = cv[cfg_('COL_QUOTE')] || '';
  var toWrite = {}, mismatch = {};
  if (!curOrig) toWrite[cfg_('COL_ANCHOR')] = parent;
  else if (curOrig !== parent && curOrig !== jobNumber) mismatch.original = { current: curOrig, incoming: parent };
  if (!curUpg) toWrite[cfg_('COL_UPGRADED')] = jobNumber;
  else if (curUpg !== jobNumber) mismatch.upgraded = { current: curUpg, incoming: jobNumber };
  if (quote) {
    if (!curQuote) toWrite[cfg_('COL_QUOTE')] = quote;
    else if (curQuote.toUpperCase().indexOf(quote.toUpperCase()) === -1) mismatch.quote = { current: curQuote, incoming: quote };
  }
  if (Object.keys(toWrite).length) writeCols_(item.id, toWrite);
  return { itemId: item.id, itemName: item.name, wrote: toWrite, mismatch: mismatch };
}

function writeCols_(itemId, vals) {
  var m = 'mutation($b:ID!,$i:ID!,$v:JSON!){change_multiple_column_values(board_id:$b,item_id:$i,column_values:$v){id}}';
  mondayQuery_(m, { b: cfg_('BOARD_ID'), i: String(itemId), v: JSON.stringify(vals) });
}

function handle_(data) {
  if (norm_(data.secret) !== norm_(props_().getProperty('SHARED_SECRET')))
    return { ok: false, error: 'bad secret' };
  var jobNumber = norm_(data.jobNumber);
  var parent = norm_(data.parentJobStringId);
  var quote = norm_(data.quoteNumber);
  if (!jobNumber || !parent) return { ok: false, error: 'jobNumber and parentJobStringId required' };

  var items = findItems_([parent, jobNumber]);   // items may be keyed by original OR upgraded job#
  if (!items.length) return { ok: true, status: 'no_matching_item', parentJobStringId: parent, jobNumber: jobNumber };

  var results = items.map(function (it) { return applyToItem_(it, parent, jobNumber, quote); });
  return { ok: true, status: 'ok', matched: results.length, results: results };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try { return json_(handle_(JSON.parse(e.postData.contents))); }
  catch (err) { return json_({ ok: false, error: String(err) }); }
}

function doGet() {
  return json_({ ok: true, service: 'monday-upgrade-relay', board: cfg_('BOARD_ID') });
}
