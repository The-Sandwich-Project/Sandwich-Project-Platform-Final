# Updating an app event from the planning sheet

After an event is pushed to the planning sheet, the team keeps editing that row
there. This flow brings those edits back into the app. It runs **only when a
person clicks it** on the sheet. Nothing runs on a timer.

## How it works

1. Someone runs **Update Row in App** from the sheet's menu and enters the row number
   (or answers "yes" when **Send Row to App** says the event already exists).
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

Both endpoints use the same `x-api-key` header (`GOOGLE_SHEETS_API_KEY` on the server,
`APP_API_KEY` in the sheet's script properties) and the same row payload as the existing
"send row to app" (`/import-from-sheets`). The staffing column arrives as
`'Volunteer/Driver Needed'`; the server reads that key (and `'Staffing'`).

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

This replaces the existing **SEND ROW TO APP** section of the planning sheet's Apps Script.
It builds on what that script already has, so nothing new needs setting up:

- `COL`, `ROW_WIDTH`, `isDate_`, `fmtDate_`, `formatTime_`: the existing column map and helpers
- `CONFIG.APP_IMPORT_URL`: the existing `.../api/event-requests/import-from-sheets` URL.
  The two new endpoints sit under it (`/preview-update`, `/apply-update`).
- The `APP_API_KEY` script property: the existing key

What changes:

1. The payload is moved into `buildAppPayload_()` so "send" and "update" send exactly the
   same row data. **The payload itself is unchanged.**
2. `sendRowToApp()` works as before. When the app answers "already exists" (409), it now
   offers to run an update instead.
3. New **`updateRowInApp()`**: asks for a row number (like send does), shows the checklist,
   and applies what's ticked.

Add `updateRowInApp` to the sheet's custom menu next to `sendRowToApp`, for example
`.addItem('Update Row in App', 'updateRowInApp')` in your existing `onOpen()`.

```javascript
// ============================= SEND ROW TO APP ============================
//
// Column layout confirmed: N = "Total in App" (index 13). Reads the full
// 27-column width (through AA) via COL and deliberately omits N (Total in App)
// and O (Social Post) from the payload: neither is an event-request field the
// app expects. This matches the original working map.

/** The row payload, shared by send and update so both send the same data. */
function buildAppPayload_(sheet, rowNum) {
  const data = sheet.getRange(rowNum, 1, 1, ROW_WIDTH).getValues()[0];
  return {
    'date': isDate_(data[COL.DATE]) ? fmtDate_(data[COL.DATE], 'yyyy-MM-dd') : data[COL.DATE],
    'Day of Week': data[COL.DAY],
    'Group Name': data[COL.GROUP],
    'Event Start time (MUST when volunteer needed)': formatTime_(data[COL.START]),
    'Event end time (MUST when volunteer needed)': formatTime_(data[COL.END]),
    'Pick up time': formatTime_(data[COL.PICKUP]),
    'ALL DETAILS': data[COL.DETAILS],
    'Van Booked?': data[COL.VAN],
    'Volunteer/Driver Needed': data[COL.VOLUNTEER],
    'Estimate # sandwiches': data[COL.ESTIMATE],
    'Deli or PBJ?': data[COL.SANDWICH_TYPE],
    'Final # sandwiches made': data[COL.FINAL],
    'Sent toolkit': data[COL.TOOLKIT_SENT],
    'Contact Name': data[COL.CONTACT_NAME],
    'Email Address': data[COL.CONTACT_EMAIL],
    'Contact Cell Number': data[COL.CONTACT_PHONE],
    'TSP Contact': data[COL.TSP_CONTACT],
    'Address': data[COL.ADDRESS],
    'Planned Recipient/Host Home': data[COL.PLANNED_RECIPIENT],
    'Cancelled': data[COL.CANCELLED],
    'Notes': data[COL.NOTES],
    "Add'l Notes": data[COL.ADDL_NOTES],
    'Waiting On': data[COL.WAITING_ON]
  };
}

function getApiKey_() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('APP_API_KEY');
  if (!apiKey) {
    SpreadsheetApp.getUi().alert('Missing API key.\n\nSet it once: Project Settings > Script Properties > add a property named APP_API_KEY with your key as the value. Then try again.');
  }
  return apiKey;
}

/** Ask for a row number. Returns the number, or null if cancelled/invalid. */
function promptRowNumber_(title) {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const response = ui.prompt(title, 'Enter the row number:', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return null;
  const rowNum = parseInt(response.getResponseText().trim(), 10);
  if (isNaN(rowNum) || rowNum < 2) { ui.alert('Please enter a valid row number (2 or higher)'); return null; }
  if (rowNum > sheet.getLastRow()) { ui.alert('Row ' + rowNum + " doesn't exist. Last row is " + sheet.getLastRow()); return null; }
  return rowNum;
}

/** POST to the import URL plus an optional suffix. Returns { code, body, text }. */
function postToApp_(suffix, payload, apiKey) {
  const url = CONFIG.APP_IMPORT_URL.replace(/\/+$/, '') + (suffix || '');
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const text = res.getContentText();
  let body = {};
  try { body = JSON.parse(text); } catch (e) {}
  return { code: res.getResponseCode(), body: body, text: text };
}

function sendRowToApp() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSheet();
  const rowNum = promptRowNumber_('Send Row to App');
  if (!rowNum) return;
  const apiKey = getApiKey_();
  if (!apiKey) return;

  try {
    const res = postToApp_('', buildAppPayload_(sheet, rowNum), apiKey);
    if (res.code === 201) {
      ui.alert('Success! Event sent to app.\n\n' + res.text);
    } else if (res.code === 409) {
      // Already in the app: offer to update it from this row instead.
      const again = ui.alert(
        'This event is already in the app.\n\n' + (res.body.error || '') +
        '\n\nUpdate it from this row instead?', ui.ButtonSet.YES_NO);
      if (again === ui.Button.YES) runRowUpdate_(sheet, rowNum, apiKey);
    } else {
      ui.alert('Response: ' + res.code + '\n\n' + res.text.substring(0, 500));
    }
  } catch (err) {
    ui.alert('Error: ' + err.toString());
  }
}

// ============================ UPDATE ROW IN APP ===========================
//
// For a row that's already in the app: shows what would change as a checklist,
// and applies only what's ticked. Blank cells never clear anything in the app.

function updateRowInApp() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const rowNum = promptRowNumber_('Update Row in App');
  if (!rowNum) return;
  const apiKey = getApiKey_();
  if (!apiKey) return;
  try {
    runRowUpdate_(sheet, rowNum, apiKey);
  } catch (err) {
    SpreadsheetApp.getUi().alert('Error: ' + err.toString());
  }
}

function runRowUpdate_(sheet, rowNum, apiKey) {
  const ui = SpreadsheetApp.getUi();
  const payload = buildAppPayload_(sheet, rowNum);
  if (!payload['Group Name']) { ui.alert('Row ' + rowNum + ' has no Group Name.'); return; }

  const preview = postToApp_('/preview-update', payload, apiKey);
  if (preview.code !== 200) {
    ui.alert('The app could not preview this row: ' + (preview.body.error || preview.code));
    return;
  }
  const candidates = preview.body.candidates || [];
  if (candidates.length === 0) { ui.alert(preview.body.message || 'No matching event in the app.'); return; }

  let pick = candidates[0];
  // Ask which event when it isn't a clean single match on the same date.
  if (preview.body.match === 'ambiguous' || (preview.body.match === 'date_differs' && candidates.length > 1)) {
    const list = candidates.map(function (c, i) {
      return (i + 1) + '. ' + c.organizationName + ' on ' + (c.appDate || 'no date') +
        ' (' + c.status + ', ' + c.changes.length + ' change' + (c.changes.length === 1 ? '' : 's') + ')';
    }).join('\n');
    const answer = ui.prompt('Which app event is row ' + rowNum + '?', list + '\n\nType the number:', ui.ButtonSet.OK_CANCEL);
    if (answer.getSelectedButton() !== ui.Button.OK) return;
    const n = parseInt(answer.getResponseText(), 10);
    if (!(n >= 1 && n <= candidates.length)) { ui.alert('That is not one of the numbers.'); return; }
    pick = candidates[n - 1];
  }

  if (pick.changes.length === 0) {
    ui.alert('The app is already up to date for row ' + rowNum + '.' +
      (pick.notes.length ? '\n\nNotes:\n- ' + pick.notes.join('\n- ') : ''));
    return;
  }

  showUpdateDialog_(payload, pick);
}

/** Checkbox dialog: every change starts ticked; untick anything to skip it. */
function showUpdateDialog_(payload, pick) {
  const esc = function (v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
  const rows = pick.changes.map(function (c) {
    return '<label class="row"><input type="checkbox" name="f" value="' + esc(c.field) + '" checked>' +
      '<span><b>' + esc(c.label) + '</b><br><span class="from">' + esc(c.from || '(empty)') +
      '</span> &rarr; ' + esc(c.to) + '</span></label>';
  }).join('');
  const notes = pick.notes.length
    ? '<p class="notes"><b>Not changed:</b><br>' + pick.notes.map(esc).join('<br>') + '</p>' : '';
  const warn = pick.dateMatches ? '' : '<p class="warn">The app has a different date for this event (' +
    esc(pick.appDate || 'none') + '). Make sure this is the right one.</p>';

  const html =
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
  const apiKey = getApiKey_();
  if (!apiKey) throw new Error('Missing APP_API_KEY script property.');
  payload.eventId = eventId;
  payload.token = token;
  payload.fields = fields;
  const res = postToApp_('/apply-update', payload, apiKey);
  if (res.code === 200) {
    return res.body.updated
      ? 'Updated in the app (' + fields.length + ' change' + (fields.length === 1 ? '' : 's') + '). You can close this.'
      : (res.body.message || 'Nothing to update.');
  }
  throw new Error(res.body.error || ('HTTP ' + res.code));
}

function setApiKeyHelp() {
  SpreadsheetApp.getUi().alert(
    'To set the app API key:\n\n' +
    '1. Extensions > Apps Script\n' +
    '2. Project Settings (gear icon)\n' +
    '3. Scroll to Script Properties > Add property\n' +
    '4. Property: APP_API_KEY   Value: <your key>\n\n' +
    'sendRowToApp() reads it from there so the key is never stored in the code.');
}
```

## Known gaps

- **Use Update Row in App for rows already in the app.** Send Row to App only recognizes an
  existing event when the group name *and* the date both match. If the date was changed on
  the sheet, Send creates a **second** event instead of offering an update.

- If the **group name** is changed on the sheet, the preview won't find the event by name.
  The script can send `eventId` directly; a small "match by ID" prompt can be added if this comes up.
- "Send row to app" (`/import-from-sheets`, the create path) reads Staffing and sandwich
  types with the same code as this update flow (`staffingForNewEvent`,
  `sandwichTypesForNewEvent`), so creating an event from a row and then updating it from the
  same row shows no changes.
- Events created by "send row to app" before that fix stored sandwich types as a JSON string
  of labels like `"Pbj"`. `migrations/20261101_heal_sheet_import_sandwich_types.sql` converts
  them to real arrays with the app's keys on the next boot.
- `VD: <names>` is read the way the app's push writes it: those people are the event's
  **drivers** on a van event. The names also fill the app's free-text van driver field,
  unless a real van driver is linked in the app. The app's push only writes the van driver
  slot when that person is also a driver; see `formatStaffingColumn` in
  `server/planning-sheet-sync-service.ts`.
