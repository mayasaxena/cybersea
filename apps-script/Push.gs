/**
 * Live updates: after every change to the sheet, the script pings a Firebase Realtime Database,
 * and every open page of the game, listening there, reads the sheet again right away instead of
 * waiting for its next poll. The ping holds only the time ("something changed"); the rows still
 * come from the sheet, through read_. It also says which page made the change ("by", a random id
 * the page sends with its requests), so that page can skip it: it has those rows already. Each
 * ping replaces the last, so two changes very close together may reach a page as one ping, the
 * second's; a page that made that one finds the other at its next read (on reconnecting, say).
 *
 * Off unless the script properties have FIREBASE_URL (the database's URL) and FIREBASE_SECRET
 * (a database secret, which lets the script write; see SETUP.md, "Live updates"). Pages hear about
 * the place to listen in their reads: games/<topic>, where the topic is made from the secret, so
 * nobody finds it without being able to read the game. The database's rules let anyone read
 * games/<topic> but nobody list games/ or write.
 *
 * The site's own changes ping when their request is done (handle_ in Code.gs); an import pings
 * when it's done (replaceWithXlsx in Import.gs). Sheets runs no simple trigger that may reach the
 * internet, so edits made in Sheets ping only once pushChange is an installable "On change"
 * trigger (SETUP.md); without it those still show at the next poll.
 */

let pushDue_ = false; // something changed in this run (touched_ sets it)

// Where pages listen for pings, or '' when live updates are off.
function pushUrl_() {
  const p = pushConfig_();
  return p ? p.base + '/games/' + p.topic + '.json' : '';
}

function pushConfig_() {
  const props = PropertiesService.getScriptProperties();
  const base = String(props.getProperty('FIREBASE_URL') || '').trim().replace(/\/+$/, '');
  const secret = String(props.getProperty('FIREBASE_SECRET') || '').trim();
  if (!/^https?:\/\/[^?#\s]+$/.test(base) || !secret) return null;
  const topic = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'cybersea-push:' + secret, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('').slice(0, 32);
  return { base, secret, topic };
}

// Pings if this run changed something; by is the page that asked for the change, if one did. A
// ping that fails only costs speed: pages read again when they reconnect or are shown again.
function pushIfDue_(by) {
  if (!pushDue_) return;
  pushDue_ = false;
  const p = pushConfig_();
  if (!p) return;
  SpreadsheetApp.flush(); // so a page reading on the ping sees the change
  try {
    UrlFetchApp.fetch(p.base + '/games/' + p.topic + '.json?auth=' + encodeURIComponent(p.secret), {
      method: 'put', contentType: 'application/json', payload: JSON.stringify({ at: { '.sv': 'timestamp' }, by: /^[a-z0-9]{1,40}$/i.test(String(by || '')) ? String(by) : '' }), muteHttpExceptions: true,
    });
  } catch (err) {
    console.warn('Live update ping failed: ' + ((err && err.message) || err));
  }
}

/*
 * An installable "On change" trigger runs this after a change made in Sheets (SETUP.md, "Live
 * updates"). Its event doesn't say which tab changed, so every tab's remembered digest is
 * forgotten: pages then get rows back only for tabs whose rows did change. The simple trigger
 * onEdit (Code.gs) still stamps the rows.
 */
function pushChange(e) {
  touched_(...SpreadsheetApp.getActiveSpreadsheet().getSheets().map(sh => sh.getName()));
  pushIfDue_();
}
