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
   - It asks to see and edit your spreadsheets, to see and edit the Drive files it creates, to
     show menus and dialogs in Sheets, and to "connect to an external service". It uses those
     for the **Cybersea** menu's import (see [Replacing the sheet with a fresh xlsx](#replacing-the-sheet-with-a-fresh-xlsx))
     and to read the pictures in the Map tab (see [The Map tab](#the-map-tab)). It never opens a
     spreadsheet other than this one and the temporary copy it makes while importing. It also
     asks to manage its own Apps Script project and deployments, for the menu's
     [Update the script](#updating-the-script-later).
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

The tabs the site edits also get a hidden **Version** column, which the script keeps up to date,
for edits made in Google Sheets too. If a page sends an edit made to an out-of-date copy of a
row (a player who was offline, say), the sheet keeps the newer row and the player is told their
edit wasn't saved. Leave that column alone. The one change the script can't notice is a whole
row being deleted, so a page that missed it could add the row back: to remove a row, clear its
cells instead.

## Theming the rules (Cybersea over Rapscallion)

The Rules tab keeps the book's rows as they are. Three more columns, after **Vis**, hold the
game's own wording, and the site uses them first:

- **Override name**: a new name. Moves keep the book's name, because character sheets remember
  moves by it; give a move new text instead.
- **Override text**: new text (a kit's items, …).
- **Override meta**: added to **Meta**, key by key. `hide` hides the row everywhere.

The Rules page shows the book's wording under each overridden row, as "Rapscallion original".
The columns are found by their headers, so add the three headers to an existing game's Rules tab
and update the script (below). A script older than version 4 ignores them.

## The Map tab

The **Map** page, open to everyone, shows the **Map** tab. Its columns (found by their headers):

| Region | Location | Level | Image | Text | GM notes | Shown |
|---|---|---|---|---|---|---|
| Vega Server | | | *(picture)* | The server's sea. | | |
| Vega Server | Hacker's Haven | | | A city of scrap. | Who really runs it. | on |
| | Hacker's Haven | Level 1 | *(picture)* | The docks. | | |
| | Hacker's Haven | Level 2 | *(picture)* | The market. | | |
| Vega Server | DeepPort | | *(picture)* | A pool of links. | | |

- A row with a **Region** and no **Location** is that region's own map. It always shows.
- A row with a **Location** and no **Level** is a place, listed under its region.
- A row with a **Location** and a **Level** is a floor or level of that place, in order. The page
  shows a tab for each level. A place with no level rows is a single picture (DeepPort above).
- **Image**: click the cell and use **Insert → Image → Insert image in cell**, or type
  `=IMAGE("https://…")` for a picture that's already online. To change a picture, replace the
  one in the cell. Pictures floating over the grid (**Insert image over cells**) belong to no
  row and aren't read.
  Keep this column's format **Automatic**, not plain text, or Sheets shows a formula as typed.
- **GM notes** are only sent to the GM.
- **Shown**: the GM chooses which places the crew see, with the **On the map** / **Hidden**
  button on each place (only the GM sees it), which writes `on` here; or type it. Every place
  starts hidden. The script never sends the crew a hidden place, its levels or its pictures.

Everything else on the tab is edited in the spreadsheet.

The **Lore** tab can have an **Image** column too, after Notes: a picture for each entry, added
the same way. Players edit lore on the site, but pictures are added in the spreadsheet.

The Map tab and pictures need script version 5.
Deploying it asks you to authorize again, for "connect to an external service": that's how the
script reads a picture out of its cell.

`tools/xlsx/build.py --theme theme.json` lays a theme's rows over the book when building the
template, or, without `--rules`, makes a workbook of just the theme's rows to paste into an
existing game. A theme's change to a book row this workbook doesn't have (a kit's Override text, say)
goes in an `_Overrides` tab, to copy into that row by hand.

## Replacing the sheet with a fresh xlsx

The spreadsheet has a **Cybersea** menu (it appears a few seconds after the sheet opens). Its
**Replace with an xlsx…** picks an `.xlsx` file from your computer, such as a freshly built
workbook, and replaces every tab with that file's tabs, in its order.

- The spreadsheet, its script, the GM passphrase and the deployment stay as they are, so the
  site's URL and everyone's invite links keep working.
- Everything on the old tabs goes, including pictures placed in cells. **File → Version
  history** brings the old tabs back if you need them.
- The file needs a **Rules** tab; anything else is turned down without changing the sheet.
- Hidden tabs and data validation in the file are kept, and so are protected sheets and ranges
  when Google's xlsx conversion brings them over. Protected
  ranges are editable only by the spreadsheet's owner, unless they're set to only warn.
- The first time you use it, Google asks you to authorize the script.

Behind the scenes it turns the file into a temporary Google Sheet in your Drive, copies its tabs
in and deletes it.

## Updating the script later

When a file in [`apps-script/`](apps-script/) changes in this repository, choose **Cybersea →
Update the script** in the spreadsheet. It lists the files that changed, and when you click
**Yes** it copies them over the script's files of the same name (your own extra files stay),
saves a new version and points the web app deployment at it. The URL stays the same.

- The first time, turn on the **Apps Script API** at
  [script.google.com/home/usersettings](https://script.google.com/home/usersettings), and add
  `Update.gs` and the new `appsscript.json` by hand (below), since the menu isn't there yet.
- If the new version needs new permissions, it says so: choose **Update the script** again and
  approve them, or the site can't reach the sheet until you do.
- Files come from `mayasaxena/cybersea@main`. A script property `SCRIPT_SOURCE` (like
  `someone/fork@branch`) picks another repository or branch.

To do it by hand:
1. Paste the new version over the file of the same name in the game's Apps Script editor and
   save (**+ → Script** adds a missing `.gs` file, such as `Import.gs`). To see
   `appsscript.json`, turn on **Project Settings → Show "appsscript.json" manifest file in
   editor**.
2. Open **Deploy → Manage deployments**, click the pencil, set **Version: New version**, and
   click **Deploy**.

Editing the deployment keeps the same URL. Creating a *new* deployment gives a new URL, and
everyone would need a new invite link.

The site keeps working with an older script, without what came later; `diag.html` says when
there's a newer one.

Whoever owns the template should paste the new files into the template's script too, so new
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
