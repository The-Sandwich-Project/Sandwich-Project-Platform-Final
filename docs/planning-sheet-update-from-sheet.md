# Updating an app event from the planning sheet

After an event is pushed to the planning sheet, the team keeps editing that row
there. This flow brings those edits back into the app. It runs **only when a
person clicks it** on the sheet. Nothing runs on a timer.

## How it works

1. Someone runs **Update Row in App** from the sheet's menu and enters the row number
   (or answers "yes" when **Send Row to App** says the event already exists).
2. The script sends the row to `POST /api/event-requests/import-from-sheets/preview-update`.
   This call is read-only: the app finds the matching event and returns what would change.
3. The script asks Yes/No about each change (plain pop-ups, not an HTML checklist,
   which breaks for people signed into several Google accounts). The person picks the
   right event if there's more than one, and answers No to anything they don't want sent.
   Values can't be edited in the pop-ups on purpose: to change one, fix the cell on
   the sheet and run it again, so the sheet and the app agree.
4. The script sends the row, the preview's `token` and the `fields` answered Yes to
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
| Drivers, volunteers, van driver | Updated from the Volunteer/Driver Needed cell. Several names per role are fine, separated by commas, `;`, `&` or `and` (`D: Katie & Kim`). People already assigned are kept, matched by name (first name is enough). New names become a user only if exactly one active user matches; otherwise they're saved as typed. A role removed from the cell is cleared. `VD` sets "van driver needed". The speaker role was retired, so an old `S` counts as a volunteer and the speaker columns are never touched. |
| Notes (ALL DETAILS, Notes, Add'l Notes, Waiting On) | **Appended** to planning notes, never replacing them. Only text the event doesn't already have is added; text the app itself pushed (the request message in ALL DETAILS, the next action in Waiting On) is skipped. |
| Cancelled | A "yes" cancels the app event, recording "Marked cancelled on the planning sheet" as the reason if none is set. One-way: a blank or "no" never un-cancels, and a completed event is left alone (shown as a note). |
| Contact name, email, phone, address, recipient | **Fill-only.** Added if the app has nothing. Never overwritten. A difference shows up as a note. |

Never touched: any other status change, TSP contact, group name, toolkit, anything else.
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
3. New **`updateRowInApp()`**: asks for a row number (like send does), asks Yes/No per change,
   and applies the Yes answers.

Add `updateRowInApp` to the sheet's custom menu next to `sendRowToApp`, for example
`.addItem('Update Row in App', 'updateRowInApp')` in your existing `onOpen()`.

```javascript
// ============================= SEND ROW TO APP ============================
//
// Live sheet layout (checked Nov 2026): A=Date ... N="Final # of Sandwiches",
// O="#'s added to app", P="Follow-up email sent", Z="Planning/Contact Notes",
// AA="sync_id" (a row ID), AB=no header. COL still names P as SOCIAL_POST and
// AA/AB as ADDL_NOTES/WAITING_ON from the older layout.
//
// The payload deliberately leaves out:
//   O  (#'s added to app)    - maintained on the sheet, not an event field
//   P  (Follow-up email sent) - not an event field the app reads
//   AA (sync_id)             - a row ID, not notes; sending it as "Add'l Notes"
//                              put "Additional Notes: <id>" into planning notes
//
// buildAppPayload_ is shared by Send Row to App and Update Row in App, so both
// always send exactly the same data.

/** The row payload (see the notes above for what's left out and why). */
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
// For a row that's already in the app: asks Yes/No about each change,
// and applies only the Yes answers. Blank cells never clear anything in the app.

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

  // The exact same-day match when there is one (don't assume it's first).
  let pick = (preview.body.match === 'exact' && candidates.find(function (c) { return c.dateMatches; })) || candidates[0];
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

  // One Yes/No per change. (Plain pop-ups, not an HTML checklist: an HTML
  // dialog's button runs under Chrome's FIRST signed-in Google account, which
  // breaks for anyone signed into more than one account. These pop-ups run as
  // the person using the sheet.)
  const intro =
    'Row ' + rowNum + ' → "' + pick.organizationName + '" in the app.\n\n' +
    (pick.dateMatches ? '' : '⚠ The app has a different date for this event (' + (pick.appDate || 'none') +
      '). Make sure this is the right one.\n\n') +
    pick.changes.length + ' change' + (pick.changes.length === 1 ? '' : 's') +
    ' found. You\'ll be asked about each one.' +
    (pick.notes.length ? '\n\nNot changed:\n- ' + pick.notes.join('\n- ') : '');
  if (ui.alert('Update row in app', intro, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;

  const fields = [];
  for (let i = 0; i < pick.changes.length; i++) {
    const c = pick.changes[i];
    const answer = ui.alert(
      'Change ' + (i + 1) + ' of ' + pick.changes.length + ': ' + c.label,
      'App now:  ' + (c.from || '(empty)') + '\nSheet says:  ' + c.to +
        '\n\nSend this to the app?\n(Cancel stops without sending anything.)',
      ui.ButtonSet.YES_NO_CANCEL
    );
    if (answer === ui.Button.CANCEL || answer === ui.Button.CLOSE) {
      ui.alert('Stopped. Nothing was sent to the app.');
      return;
    }
    if (answer === ui.Button.YES) fields.push(c.field);
  }
  if (fields.length === 0) { ui.alert('Nothing was picked, so nothing was sent.'); return; }

  // Re-read the row: if someone edited it while the questions were open, stop
  // instead of sending what the person saw (which is no longer the sheet).
  const fresh = buildAppPayload_(sheet, rowNum);
  if (rowFingerprint_(fresh) !== rowFingerprint_(payload)) {
    ui.alert('Row ' + rowNum + ' was edited while you were answering, so nothing was sent. Run Update Row in App again.');
    return;
  }
  fresh.eventId = pick.eventId;
  fresh.token = pick.token;
  fresh.fields = fields;
  const res = postToApp_('/apply-update', fresh, apiKey);
  if (res.code === 200) {
    ui.alert(res.body.updated
      ? 'Updated in the app (' + fields.length + ' change' + (fields.length === 1 ? '' : 's') + ').'
      : (res.body.message || 'Nothing to update.'));
    return;
  }
  ui.alert('The app did not update: ' + (res.body.error || ('HTTP ' + res.code)));
}

/** A short fingerprint of the row payload, made the same way every time. */
function rowFingerprint_(payload) {
  const keys = Object.keys(payload).sort();
  const text = keys.map(function (k) {
    const v = payload[k];
    const s = v instanceof Date ? v.toISOString() : (v == null ? '' : String(v).trim());
    return k + '=' + s;
  }).join('\n');
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8));
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

- **Live column layout (checked Nov 2026).** The script's `COL` map and the app's
  `PLANNING_SHEET_COLUMNS` were written for an older layout. On the live sheet,
  P is "Follow-up email sent" (was Social Post), AA is `sync_id` (a per-row ID, was
  "Add'l Notes") and AB has no header (was "Waiting On"). The payload no longer sends
  AA as "Add'l Notes", the server ignores any note that's only an ID, and the app never
  writes O, P, AA or AB (`SHEET_OWNED_COLUMNS`). Where `sync_id` comes from is still
  being investigated; once it's known to be stable it can replace name + date matching.

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
