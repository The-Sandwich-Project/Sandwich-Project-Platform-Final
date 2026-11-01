# Updating an app event from the planning sheet

After an event is pushed to the planning sheet, the team keeps editing that row
there. This flow brings those edits back into the app. It runs **only when a
person clicks it** on the sheet. Nothing runs on a timer.

## How it works

1. Someone selects a row on the planning sheet and runs **Update row in app**.
2. The script sends the row to `POST /api/event-requests/import-from-sheets/preview-update`.
   This call is read-only: the app finds the matching event and returns what would change.
3. The script shows the changes as a checklist, all ticked. The person picks the
   right event if there's more than one, unticks anything they don't want sent, and
   clicks **Update selected**. Values can't be edited in the dialog on purpose: to
   change one, fix the cell on the sheet and run it again, so the sheet and the app agree.
4. The script sends the row, the preview's `token` and the ticked `fields` to
   `POST /api/event-requests/import-from-sheets/apply-update`. The app works out the
   changes again and **refuses** if they no longer match what was shown (someone edited
   the event or the row in between).

Both endpoints use the same `x-api-key` header (`GOOGLE_SHEETS_API_KEY`) and the same
row payload as the existing "send row to app" (`/import-from-sheets`).

## What can change

| Field | Rule |
|---|---|
| Date | Updated. The app matches by group name and the nearest date, so a moved date still finds its event. |
| Start, end and pick-up times | Updated, normalized to `HH:MM` |
| Sandwich estimate | Updated (ranges like `200-300` are kept) |
| Sandwich types | Updated when the *set* of types differs. If there are several types, the count is split evenly between them. |
| Final # sandwiches | Updated. This is the reference-only `actualSandwichCount`. Official totals still come from the collections log. |
| Drivers, speakers, volunteers, van driver | Updated from the Staffing cell. Several names per role are fine, separated by commas, `;`, `&` or `and` (`D: Katie & Kim`). People already assigned are kept, matched by name (first name is enough). New names become a user only if exactly one active user matches; otherwise they're saved as typed. A role removed from the cell is cleared. `VD` sets "van driver needed". |
| Contact name, email, phone, address, recipient | **Fill-only.** Added if the app has nothing. Never overwritten. A difference shows up as a note. |

Never touched: status, TSP contact, notes, group name, toolkit, anything else.
**A blank sheet cell never clears an app value.** A blank Staffing cell leaves staffing alone.

Every applied update writes an audit-log entry (`actionType: PLANNING_SHEET_UPDATE`)
listing each field's old and new value.

## Apps Script

Add this to the planning sheet's Apps Script project, next to the existing
"send row to app" function. It assumes the existing script already has:

- `APP_URL`: the app's base URL, for example `https://<your-app>`
- `API_KEY`: the same key "send row to app" sends as `x-api-key`

If those have different names in your script, rename them below. If your script
already has a function that turns a row into the payload, use it in place of
`buildRowPayload_`, since it already matches what the app expects.

```javascript
/** Menu entry. Add to your existing onOpen() if you have one. */
function addUpdateMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('TSP App')
    .addItem('Update row in app', 'updateRowInApp')
    .addToUi();
}

/** Turn the selected row into the same payload "send row to app" sends. */
function buildRowPayload_(sheet, rowIndex) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var values = sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];
  var display = sheet.getRange(rowIndex, 1, 1, lastCol).getDisplayValues()[0];
  var payload = {};
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).trim();
    if (!h) continue;
    // Display values keep times as "2:00 PM" instead of 1899 dates.
    payload[h] = display[i];
    if (h.toLowerCase() === 'date') {
      var v = values[i];
      payload.date = v instanceof Date
        ? Utilities.formatDate(v, 'America/New_York', 'yyyy-MM-dd')
        : String(display[i]);
    }
  }
  return payload;
}

function callApp_(path, payload) {
  var res = UrlFetchApp.fetch(APP_URL + '/api/event-requests' + path, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': API_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) {}
  return { status: res.getResponseCode(), body: body };
}

function updateRowInApp() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSheet();
  var rowIndex = sheet.getActiveRange().getRow();
  if (rowIndex < 2) { ui.alert('Select an event row first.'); return; }

  var payload = buildRowPayload_(sheet, rowIndex);
  if (!payload['Group Name']) { ui.alert('This row has no Group Name.'); return; }

  var preview = callApp_('/import-from-sheets/preview-update', payload);
  if (preview.status !== 200) {
    ui.alert('The app could not preview this row: ' + (preview.body.error || preview.status));
    return;
  }
  var candidates = preview.body.candidates || [];
  if (candidates.length === 0) { ui.alert(preview.body.message || 'No matching event in the app.'); return; }

  var pick = candidates[0];
  // Ask which event when it isn't a clean single match on the same date.
  if (preview.body.match === 'ambiguous' || (preview.body.match === 'date_differs' && candidates.length > 1)) {
    var list = candidates.map(function (c, i) {
      return (i + 1) + '. ' + c.organizationName + ' on ' + (c.appDate || 'no date') +
        ' (' + c.status + ', ' + c.changes.length + ' change' + (c.changes.length === 1 ? '' : 's') + ')';
    }).join('\n');
    var answer = ui.prompt('Which app event is this row?', list + '\n\nType the number:', ui.ButtonSet.OK_CANCEL);
    if (answer.getSelectedButton() !== ui.Button.OK) return;
    var n = parseInt(answer.getResponseText(), 10);
    if (!(n >= 1 && n <= candidates.length)) { ui.alert('That is not one of the numbers.'); return; }
    pick = candidates[n - 1];
  }

  if (pick.changes.length === 0) {
    ui.alert('The app is already up to date for this row.' +
      (pick.notes.length ? '\n\nNotes:\n- ' + pick.notes.join('\n- ') : ''));
    return;
  }

  showUpdateDialog_(payload, pick);
}

/** Checkbox dialog: every change starts ticked; untick anything to skip it. */
function showUpdateDialog_(payload, pick) {
  var esc = function (v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  var rows = pick.changes.map(function (c) {
    return '<label class="row"><input type="checkbox" name="f" value="' + esc(c.field) + '" checked>' +
      '<span><b>' + esc(c.label) + '</b><br><span class="from">' + esc(c.from || '(empty)') +
      '</span> &rarr; ' + esc(c.to) + '</span></label>';
  }).join('');
  var notes = pick.notes.length
    ? '<p class="notes"><b>Not changed:</b><br>' + pick.notes.map(esc).join('<br>') + '</p>' : '';
  var warn = pick.dateMatches ? '' : '<p class="warn">The app has a different date for this event (' +
    esc(pick.appDate || 'none') + '). Make sure this is the right one.</p>';

  var html =
    '<style>body{font:13px Arial,sans-serif;margin:12px}.row{display:flex;gap:8px;padding:6px 0;' +
    'border-bottom:1px solid #eee}.from{color:#888;text-decoration:line-through}.warn{color:#b45309}' +
    '.notes{color:#555;font-size:12px}button{margin-top:12px;padding:6px 14px}#msg{margin-top:10px}</style>' +
    '<p>Update <b>' + esc(pick.organizationName) + '</b> in the app. Untick anything you don\'t want sent. ' +
    'To change a value, fix the cell on the sheet and run this again.</p>' + warn +
    '<form id="f">' + rows + '</form>' + notes +
    '<button id="go" onclick="send()">Update selected</button> <button onclick="google.script.host.close()">Cancel</button>' +
    '<div id="msg"></div>' +
    '<script>var DATA=' + JSON.stringify({ payload: payload, eventId: pick.eventId, token: pick.token })
      .replace(/</g, '\\u003c') + ';' +
    'function send(){var fields=[].slice.call(document.querySelectorAll("input[name=f]:checked")).map(function(i){return i.value});' +
    'if(!fields.length){document.getElementById("msg").textContent="Nothing selected.";return;}' +
    'document.getElementById("go").disabled=true;document.getElementById("msg").textContent="Updating...";' +
    'google.script.run.withSuccessHandler(function(m){document.getElementById("msg").textContent=m;})' +
    '.withFailureHandler(function(e){document.getElementById("msg").textContent="Error: "+e.message;' +
    'document.getElementById("go").disabled=false;})' +
    '.applyRowUpdate(DATA.payload,DATA.eventId,DATA.token,fields);}</script>';

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(480).setHeight(Math.min(600, 220 + pick.changes.length * 52)),
    'Update row in app'
  );
}

/** Called from the dialog. (No trailing underscore: google.script.run can't call private functions.) */
function applyRowUpdate(payload, eventId, token, fields) {
  payload.eventId = eventId;
  payload.token = token;
  payload.fields = fields;
  var applied = callApp_('/import-from-sheets/apply-update', payload);
  if (applied.status === 200) {
    return applied.body.updated
      ? 'Updated in the app (' + fields.length + ' change' + (fields.length === 1 ? '' : 's') + '). You can close this.'
      : (applied.body.message || 'Nothing to update.');
  }
  throw new Error(applied.body.error || ('HTTP ' + applied.status));
}
```

## Known gaps

- If the **group name** is changed on the sheet, the preview won't find the event by name.
  The script can send `eventId` directly; a small "match by ID" prompt can be added if this comes up.
- "Send row to app" (`/import-from-sheets`, the create path) reads Staffing and sandwich
  types with the same code as this update flow (`staffingForNewEvent`,
  `sandwichTypesForNewEvent`), so creating an event from a row and then updating it from the
  same row shows no changes.
- `VD: <names>` is read the way the app's push writes it: those people are the event's
  **drivers** on a van event. The names also fill the app's free-text van driver field,
  unless a real van driver is linked in the app. The app's push only writes the van driver
  slot when that person is also a driver; see `formatStaffingColumn` in
  `server/planning-sheet-sync-service.ts`.
