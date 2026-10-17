/**
 * Live updates: after every change to the sheet, the script pings a Firebase Realtime Database,
 * and every open page of the game, listening there, reads the sheet again right away instead of
 * waiting for its next poll. The ping holds only the time ("something changed"); the rows still
 * come from the sheet, through read_. It also says which page made the change ("by", a random id
 * the page sends with its requests), so that page can skip it: it has those rows already. Each
 * ping counts up ("n", which the database adds one to), so a page that hears a ping of its own
 * after missing one (the database may send only the latest of two quick changes) reads anyway.
 * Its time ("at") is the script's clock, the one reads' times are on.
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

// Kept in the cache like the passphrases (keys_ in Code.gs), so most requests read no properties.
function pushConfig_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('push');
  if (hit) return JSON.parse(hit);
  const props = PropertiesService.getScriptProperties().getProperties();
  const base = String(props.FIREBASE_URL || '').trim().replace(/\/+$/, '');
  const secret = String(props.FIREBASE_SECRET || '').trim();
  let p = null;
  if (/^https?:\/\/[^?#\s]+$/.test(base) && secret) {
    const topic = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'cybersea-push:' + secret, Utilities.Charset.UTF_8)
      .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('').slice(0, 32);
    p = { base, secret, topic };
  }
  cache.put('push', JSON.stringify(p), KEY_CACHE_SECONDS);
  return p;
}

// Pings if this run changed something; by is the page that asked for the change, if one did. A
// ping that fails only costs speed: pages read again when they reconnect or are shown again.
function pushIfDue_(by) {
  if (!pushDue_) return;
  pushDue_ = false;
  try {
    const p = pushConfig_();
    if (!p) return;
    SpreadsheetApp.flush(); // so a page reading on the ping sees the change
    const ping = { at: Date.now(), by: /^[a-z0-9]{1,40}$/i.test(String(by || '')) ? String(by) : '', n: { '.sv': { increment: 1 } } };
    UrlFetchApp.fetch(p.base + '/games/' + p.topic + '.json?auth=' + encodeURIComponent(p.secret), {
      method: 'patch', contentType: 'application/json', payload: JSON.stringify(ping), muteHttpExceptions: true,
    });
  } catch (err) {
    console.warn('Live update ping failed: ' + ((err && err.message) || err));
  }
}

/*
 * An installable "On change" trigger runs this after a change made in Sheets (SETUP.md, "Live
 * updates"). Its event doesn't say which tab changed, so every tab's remembered digest is
 * forgotten: pages then get rows back only for tabs whose rows did change. Sheets runs it and the
 * simple trigger onEdit (Code.gs) in no set order, so it stamps the edited rows too, before the
 * ping: otherwise pages could read a row before onEdit stamps it and keep its old version, and
 * their next change to it would be turned away. Whichever runs second finds the rows stamped.
 */
function pushChange(e) {
  const sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  sheetLock_(() => sheets.forEach(sh => { if (sh.getLastRow() >= 2) stampRows_(sh, 2, sh.getLastRow() - 1); }));
  touched_(...sheets.map(sh => sh.getName()));
  pushIfDue_();
}
