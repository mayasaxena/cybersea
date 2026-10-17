#!/usr/bin/env python3
"""Build a game workbook (.xlsx), to bring into a game's sheet with Cybersea > Replace with an xlsx….

The template carries rulebook text and player data, so it is built locally and shared
privately, never committed (.gitignore blocks *.xlsx).

  python3 -I tools/xlsx/build.py --rules rules.json --out blank-game.xlsx
  python3 -I tools/xlsx/build.py --rules rules.json --tab Nexa=nexa-rows.json \
      --house house.json --theme cybersea-theme.json --out cybersea.xlsx
  python3 -I tools/xlsx/build.py --theme cybersea-theme.json --out theme-only.xlsx

rules.json: [{kind, group, name, text, meta, vis}, ...] (from tools/extract)
--tab Name=rows.json: a tab's rows as [[Kind, Name, Value, Notes], ...]
--house house.json: extra Rules rows (same shape as rules.json), e.g. house rules
--theme theme.json: a setting laid over the book, {rules, lore, gm}:
  rules: Rules rows, optionally with override_name, override_text, override_meta. One with the
    same Kind + Group + Name as a book row fills in that row's Override columns from those (or
    from its own text and meta); the book's columns stay as they are. One with only overrides
    (no text) that matches no book row goes in the _Overrides tab, to copy across by hand. Any
    other is a new row.
  lore, gm: rows for the Lore and GM tabs, as [[Kind, Name, Value, Notes], ...].
  map: rows for the Map tab, as [[Region, Location, Level, Image, Text, GM notes, Shown], ...]
    (Image: blank, or the name of a picture in the Images tab).
The workbook also gets an empty Images tab (Name | Image): pictures are placed in its cells in
Sheets, and Replace with an xlsx… never replaces it once the sheet has one.
Without --rules, the workbook holds only the theme's rows, to paste into an existing game.
"""
import argparse
import json

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

HEADER = ['Kind', 'Name', 'Value', 'Notes']
RULES_HEADER = ['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis', 'Override name', 'Override text', 'Override meta']
MAP_HEADER = ['Region', 'Location', 'Level', 'Image', 'Text', 'GM notes', 'Shown']
OVERRIDES = ['override_name', 'override_text', 'override_meta']
# As SHEET_KINDS in Code.gs and mechanics.py (tests/kinds.test.mjs).
CHARACTER_KINDS = 'info,stat,track,bond,sheet,notes,jot,kit,item,cargo,move,special,advance,log,state,signin'
BOLD = Font(bold=True)
HEAD_FILL = PatternFill('solid', fgColor='E8EEF3')

README = [
    'This spreadsheet is one game for the Cybersea crew site.',
    '',
    'Tabs',
    '  Rules: the game’s rules text (Kind | Group | Name | Text | Meta | Vis). Vis "gm" rows are only shown with the GM passphrase.',
    '    Override name | Override text | Override meta: the game’s own wording for a row (e.g. the Cybersea theme). The site uses',
    '    them instead of the book’s and keeps the book’s under "Rapscallion original". Override meta adds to Meta; "hide" there',
    '    hides the row. Moves keep the book’s name (character sheets remember moves by name). Leave the book’s columns as they are.',
    '    What a row does is in its Meta: roll=, session=, gain=, spend=, action= (see SETUP.md, "The game’s mechanics").',
    '  System: the game’s mechanics (Kind | Group | Name | Text | Meta): stat, track, section and choice rows. The site has no',
    '    stat names or numbers of its own. Cybersea > Replace with an xlsx… protects Rules and System and adds checks.',
    '  GM: the GM’s NPCs (npc), NPC harm (track), notes, secrets and clocks. Only shown with the GM passphrase.',
    '  Lore: shared lore. Kind = category, Name = title, Value = text, Notes = who added it, Image = a picture for the entry',
    '    (placed in the cell, =IMAGE("https://…"), or the name of a picture in the Images tab).',
    '  Ship: the crew’s ship (the site offers to set it up if this tab is missing).',
    '  Map: the world (Region | Location | Level | Image | Text | GM notes | Shown). A row with no Location is a region’s map;',
    '    one with a Location and no Level is a place; one with both is a floor of that place, in order (no Level rows: one picture).',
    '    Image: a picture placed in the cell (Insert > Image > Insert image in cell), =IMAGE("https://…"), or the name of a picture',
    '    in the Images tab. GM notes: GM only. The GM can also add and edit places and their pictures on the Map page.',
    '    Shown: "on" puts a place on the crew’s map (the GM’s button on the Map page sets it). Every place starts hidden.',
    '  Images: every picture once (Name | Image). Type a Name into a Map or Lore Image cell to show it there.',
    '    Replace with an xlsx… never replaces or removes this tab, so pictures put here stay.',
    '  Every other tab is a character sheet. Tabs starting with _ are ignored.',
    '  A character tab’s "signin | Signed in | yes" row means someone has signed in as them on the site (blank = nobody).',
    '',
    'Rows on every tab except Rules and Map: Kind | Name | Value | Notes. Kind + Name identify a row, so keep them unique.',
    'The site adds a hidden Version column to the tabs it edits, so a late edit (from a page that was offline) can’t undo a newer one. Leave it alone.',
    'To remove a row, clear its cells rather than deleting the row: a deleted row isn’t noticed, so a page that missed it could add it back.',
    '',
    'Symbols',
    '  Tracks and clocks: ● marked, ○ open, ✕ crossed out. Typing x, o, 1 or 0 also works.',
    '  Bonds: ● marked, ○ marked but used, · not marked.',
    '',
    'Text: a blank line starts a new paragraph; "- " starts a bullet (indent two spaces to nest);',
    '"[ ] " and "[x] " are checklist items; **bold**, *trigger*, ~tag~, ^italic^.',
    '',
    'Keep the columns formatted as plain text (Format > Number > Plain text) so Sheets doesn’t turn +2 into 2 or a date.',
]


def text_sheet(ws, header, rows, widths, free=()):
    """A tab of plain-text cells, except the columns named in free (an Image column: a picture or
    an =IMAGE() formula, which plain text would show as typed)."""
    ws.append(header)
    for r in rows:
        ws.append([str(v) if v is not None else '' for v in r])
    for col, w in zip('ABCDEFGHI', widths):
        ws.column_dimensions[col].width = w
    for row in ws.iter_rows(min_row=1, max_row=max(ws.max_row, 1000), max_col=len(header)):
        for cell in row:
            if header[cell.column - 1] in free:
                continue
            cell.number_format = '@'
            if cell.row > 1 and isinstance(cell.value, str) and cell.value.startswith('='):
                cell.data_type = 's'  # keep as text, never a formula
            cell.alignment = Alignment(wrap_text=True, vertical='top')
    for cell in ws[1]:
        cell.font = BOLD
        cell.fill = HEAD_FILL
    ws.freeze_panes = 'A2'


def overlay(recs, theme_rules):
    """The book's rows with the theme's laid over them: matching rows get Override columns.
    Returns (rows, overrides for book rows that aren't here: override-only theme rows, to fill in by hand)."""
    key = lambda r: tuple(str(r.get(k, '')).strip().lower() for k in ('kind', 'group', 'name'))
    out = [dict(r) for r in recs]
    loose = []
    at = {}
    for i, r in enumerate(out):
        at.setdefault(key(r), i)
    for t in theme_rules:
        i = at.get(key(t))
        if i is not None:
            # A theme row's own text and meta stand in for the book's, unless it names overrides.
            ov = {'override_text': t.get('text', ''), 'override_meta': t.get('meta', '')}
            ov.update({k: t[k] for k in OVERRIDES if t.get(k)})
            for k, v in ov.items():
                if v and v != out[i].get(k[len('override_'):], ''):
                    out[i][k] = v
        elif not str(t.get('text', '')).strip() and any(t.get(k) for k in OVERRIDES):
            loose.append(t)  # a change to a book row this workbook doesn't have
        else:
            out.append(dict(t))
            at[key(t)] = len(out) - 1
    return out, loose


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rules', help='the book’s rows; leave out for a theme-only workbook')
    ap.add_argument('--theme', help='a setting over the book: {rules, lore, gm}')
    ap.add_argument('--house', help='extra Rules rows, e.g. house rules')
    ap.add_argument('--tab', action='append', default=[], help='Name=rows.json (a character tab)')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    recs = json.load(open(a.rules, encoding='utf-8')) if a.rules else []
    if a.house:
        recs = recs + json.load(open(a.house, encoding='utf-8'))
    theme = json.load(open(a.theme, encoding='utf-8')) if a.theme else {}
    recs, loose = overlay(recs, theme.get('rules', []))
    if loose and a.rules:
        print(f'warning: {len(loose)} override(s) match no book row; see the Overrides tab')
    rules_rows = [[r.get('kind', ''), r.get('group', ''), r.get('name', ''), r.get('text', ''), r.get('meta', ''), r.get('vis', 'crew')]
                  + [r.get(k, '') for k in OVERRIDES] for r in recs]

    wb = Workbook()
    readme = wb.active
    readme.title = 'README'
    for line in README:
        readme.append([line])
    readme.column_dimensions['A'].width = 120
    readme['A1'].font = Font(bold=True, size=13)

    text_sheet(wb.create_sheet('Rules'), RULES_HEADER, rules_rows, [12, 16, 26, 90, 28, 6, 26, 90, 28])
    text_sheet(wb.create_sheet('GM'), HEADER, theme.get('gm', []), [10, 26, 60, 60])
    text_sheet(wb.create_sheet('Lore'), HEADER + ['Image'], theme.get('lore', []), [14, 26, 70, 16, 40], free=('Image',))
    maps = wb.create_sheet('Map')
    text_sheet(maps, MAP_HEADER, theme.get('map', []), [18, 26, 12, 40, 60, 40, 8], free=('Image',))
    shown = DataValidation(type='list', formula1='"on"', allow_blank=True, showErrorMessage=True,
                           error='Type "on" to show the place to the crew, or leave it blank.')
    maps.add_data_validation(shown)
    shown.add('G2:G1000')
    text_sheet(wb.create_sheet('Images'), ['Name', 'Image'], [], [30, 40], free=('Image',))
    if loose:
        # Not a game tab (the site ignores tabs starting with _): copy each into the matching Rules row.
        text_sheet(wb.create_sheet('_Overrides'), ['Kind', 'Group', 'Name', 'Override name', 'Override text', 'Override meta'],
                   [[t.get('kind', ''), t.get('group', ''), t.get('name', '')] + [t.get(k, '') for k in OVERRIDES] for t in loose],
                   [10, 16, 12, 20, 90, 20])

    for spec in a.tab:
        name, path = spec.split('=', 1)
        rows = json.load(open(path, encoding='utf-8'))
        ws = wb.create_sheet(name)
        text_sheet(ws, HEADER, rows, [10, 22, 70, 40])
        dv = DataValidation(type='list', formula1=f'"{CHARACTER_KINDS}"', allow_blank=True, showErrorMessage=False)
        ws.add_data_validation(dv)
        dv.add('A2:A1000')

    wb.save(a.out)
    print(f'wrote {a.out}: Rules {len(rules_rows)} rows; tabs {", ".join(ws.title for ws in wb.worksheets)}')


if __name__ == '__main__':
    main()
