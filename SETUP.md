# Setting up a game

Each game is one Google Sheet. The site (these pages) reads and writes that sheet through a
small script attached to it. Setting up a game means copying the template sheet and deploying its
script: about five minutes, once.

The template already has the rules, the tabs and the script in it:
**[Cybersea game template](https://docs.google.com/spreadsheets/d/1AmAkrjylcTcy5kSTqKIoY6fteysFN6FNFn1LP5lA2vk/edit?usp=sharing)**.
Access to it is restricted because it holds the rulebook text, so ask its owner to share it with
you. The rulebook text is never put in this repository.

## 1. Copy the template

1. Open the template and choose **File → Make a copy**. The script comes with the copy.
2. Name the copy. The spreadsheet's name is the game's name on the site.

## 2. Set the GM passphrase

1. In your copy, open **Extensions → Apps Script**.
2. Open **Project Settings** (the gear on the left).
3. Under **Script properties**, set `GM_KEY` to a passphrase for the GM. If `GM_KEY` is already
   there (copied from the template), change its value.

Players don't need a passphrase: the invite link is enough. If you'd rather they needed one too,
also add `CREW_KEY` with the players' passphrase.

## 3. Deploy it

1. Still in Apps Script, click **Deploy → New deployment**.
2. Next to "Select type", click the gear and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**. "Anyone" is needed for the site to
   reach it. The web app URL is long and unguessable; only people you give the invite link to
   can find the game.
4. Click **Deploy**, then **Authorize access** and pick your Google account.
   - Google will warn that it "hasn't verified this app". It's your own script, so click
     **Advanced → Go to (project name)** and **Allow**.
   - It asks for access to "the spreadsheet it's attached to" only.
5. Copy the **Web app URL**. It ends in `/exec`.

## 4. Check it and open the game

1. Open `diag.html` on the site.
2. Paste the URL and the **GM** passphrase, and click **Run checks**.
3. Every line should be green. If one isn't, it says what to fix.
4. Click **Open this game**. You're signed in as the GM.

## 5. Invite the crew

- In the GM's **⋯** menu, click **Copy crew invite** and send it to the players. It has no
  passphrase in it. Anyone with it can open the crew pages, so share it only with your crew.
- **Copy GM link** carries the GM passphrase. Keep it to yourself; it's how you open the game on
  another device.
- Opening an invite link once remembers the game in that browser.

### Signing in as a character

Players click their character to sign in, either on the Crew page or from the button at the top
right (it shows **Sign in**, the character's name, or **GM**). Clicking the character again signs
out. Everyone sees who's signed in, and it stays that way until someone signs out.

Signing in is what lets you edit: your own character's sheet, plus the shared Ship and Lore
pages. Until then (and on other characters' sheets) pages are read-only. The GM can edit
everything. It's the honor system: the site keeps to these rules, but the sheet itself doesn't
check, and anyone can still read any sheet.

On the sheet, signing in sets a `signin | Signed in | yes` row on the character's tab. Clearing
that cell signs them out.

### In Notion

On a character's sheet, open its **⋯** menu and click **Copy Notion embed link**. Then paste the
link into a Notion `/embed` block. Notion embeds keep their own browser storage, so the link
carries the game (and the passphrase, if you copied it as the GM).

## Editing the sheet directly

You can edit any tab in Google Sheets as well; the site picks up changes within about 15
seconds. The README tab explains the columns and symbols. Keep **Kind + Name** unique on each
tab: that pair is how the site finds a row.

## Updating the script later

When [`apps-script/Code.gs`](apps-script/Code.gs) changes in this repository:
1. Paste the new version over `Code.gs` in the game's Apps Script editor and save.
2. Open **Deploy → Manage deployments**, click the pencil, set **Version: New version**, and
   click **Deploy**.

Editing the deployment keeps the same URL. Creating a *new* deployment gives a new URL, and
everyone would need a new invite link.

Whoever owns the template should paste the new `Code.gs` into the template's script too, so new
games start with the current version.

## Handing the game to someone else (e.g. the GM)

1. They open the Google Sheet and choose **File → Make a copy**. The script is copied with it.
2. In their copy, they do steps 2 (GM passphrase) and 3 (deploy) again.
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
pre-commit hook where the rulebook text file is available. The template sheet was first built
from `tools/xlsx/build.py`, which needs the private `rules.json`.
