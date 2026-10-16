# Setting up a game

Each game is one Google Sheet. The site (these pages) reads and writes that sheet through a
small script attached to it. Setting up a game takes about ten minutes, once.

You need the template spreadsheet (`cybersea.xlsx` or `blank-game.xlsx`). It's shared
privately because it holds the rulebook text. It is never put in this repository.

## 1. Make the spreadsheet

1. Upload the template `.xlsx` to Google Drive.
2. Open it, then choose **File → Save as Google Sheets**. Work in the new copy, not the `.xlsx`:
   the next step's menu only exists in a real Google Sheet.
3. Rename it if you like. The spreadsheet's name is the game's name on the site.

## 2. Add the script

1. In the Google Sheet, open **Extensions → Apps Script**.
2. Delete what's in `Code.gs` and paste in the whole of
   [`apps-script/Code.gs`](apps-script/Code.gs) from this repository. Save (Ctrl/Cmd+S).
3. Choose two passphrases: one for the players and one for the GM.
   - Open **Project Settings** (the gear on the left).
   - Under **Script properties**, add `CREW_KEY` with the players' passphrase.
   - Add `GM_KEY` with the GM's passphrase.

## 3. Deploy it

1. Click **Deploy → New deployment**.
2. Next to "Select type", click the gear and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**. "Anyone" is needed for the site to
   reach it; the passphrases are what keep it private.
4. Click **Deploy**, then **Authorize access** and pick your Google account.
   - Google will warn that it "hasn't verified this app". It's your own script, so click
     **Advanced → Go to (project name)** and **Allow**.
   - It asks for access to "the spreadsheet it's attached to" only.
5. Copy the **Web app URL**. It ends in `/exec`.

## 4. Check it and open the game

1. Open `diag.html` on the site.
2. Paste the URL and the **GM** passphrase, and click **Run checks**.
3. Every line should be green. If one isn't, it says what to fix.
4. Click **Open this game**.

## 5. Invite the crew

- On any page, open the **⋯** menu and click **Copy invite link**. The link carries your
  passphrase, so anyone who opens it gets your access level.
- The GM's menu also has **Copy crew invite**, which uses the players' passphrase. Send that one
  to players. Keep the GM link to yourself.
- Opening an invite link once remembers the game in that browser.

### In Notion

On a character's sheet, open its **⋯** menu and click **Copy Notion embed link**. Then paste the
link into a Notion `/embed` block. The link includes the passphrase because Notion embeds keep
their own separate browser storage.

## Editing the sheet directly

You can edit any tab in Google Sheets as well; the site picks up changes within about 15
seconds. The README tab explains the columns and symbols. Keep **Kind + Name** unique on each
tab: that pair is how the site finds a row.

## Updating the script later

When `Code.gs` changes:
1. Paste the new version into the Apps Script editor.
2. Open **Deploy → Manage deployments**, click the pencil, set **Version: New version**, and
   click **Deploy**.

Editing the deployment keeps the same URL. Creating a *new* deployment gives a new URL, and
everyone would need a new invite link.

## Handing the game to someone else (e.g. the GM)

1. They open the Google Sheet and choose **File → Make a copy**. The script is copied with it.
2. In their copy, they do steps 2.3 (passphrases) and 3 (deploy) again.
3. They send everyone new invite links. The old URL keeps working until the old owner deletes
   the deployment or the sheet.

## Running the site locally (developers)

```
node tools/dev-server.mjs            # site on :8080, a test game on :8081
npm test                             # unit tests
npm run e2e                          # browser tests (Playwright + Chromium)
```

The dev server runs the real `Code.gs` against an in-memory sheet with made-up rules. Nothing in
this repository contains rulebook text: `tools/check-booktext.mjs` checks for it, and runs as a
pre-commit hook where the rulebook text file is available.
