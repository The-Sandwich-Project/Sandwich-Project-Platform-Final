# Updating an app event from the planning sheet

After an event is pushed to the planning sheet, the team keeps editing that row
there. This flow brings those edits back into the app. It runs **only when a
person clicks it** on the sheet. Nothing runs on a timer.

## How it works

1. Someone selects a row on the planning sheet and runs **Update row in app**.
2. The script sends the row to `POST /api/event-requests/import-from-sheets/preview-update`.
   This call is read-only: the app finds the matching event and returns what would change.
3. The script shows the changes. The person picks the right event if there's
   more than one, then confirms.
4. The script sends the row plus the preview's `token` to
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
| Drivers, speakers, volunteers | Updated from the Staffing cell. People already assigned are kept, matched by name (first name is enough). New names become a user only if exactly one active user matches; otherwise they're saved as typed. A role removed from the cell is cleared. `VD` sets "van driver needed". |
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

  var lines = pick.changes.map(function (c) {
    return '- ' + c.label + ': ' + (c.from || '(empty)') + ' -> ' + c.to;
  });
  var msg = 'Update "' + pick.organizationName + '" (' + (pick.appDate || 'no date') + ') in the app?\n\n' +
    lines.join('\n');
  if (!pick.dateMatches) msg = 'Heads up: the app has a different date for this event.\n\n' + msg;
  if (pick.notes.length) msg += '\n\nNot changed:\n- ' + pick.notes.join('\n- ');
  if (ui.alert(msg, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  payload.eventId = pick.eventId;
  payload.token = pick.token;
  var applied = callApp_('/import-from-sheets/apply-update', payload);
  if (applied.status === 200) {
    ui.alert(applied.body.updated ? 'Updated in the app.' : (applied.body.message || 'Nothing to update.'));
  } else {
    ui.alert('Not updated: ' + (applied.body.error || applied.status));
  }
}
```

## Known gaps

- If the **group name** is changed on the sheet, the preview won't find the event by name.
  The script can send `eventId` directly; a small "match by ID" prompt can be added if this comes up.
- The older `/import-from-sheets` create path still uses the legacy staffing parser, which
  misreads `D: ` (needed, nobody assigned) as an assignee with an empty name and drops the
  second name in `D: Katie, Kim`. The update flow uses the fixed parser in
  `server/services/planning-sheet-row-update.ts`.
