#!/usr/bin/env python3
"""Build a game spreadsheet template (.xlsx) to upload to Google Drive.

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
    from its own text and meta); the book's columns stay as they are. Any other is a new row.
  lore, gm: rows for the Lore and GM tabs, as [[Kind, Name, Value, Notes], ...]
Without --rules, the workbook holds only the theme's rows, to paste into an existing game.
"""
import argparse
import json

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

HEADER = ['Kind', 'Name', 'Value', 'Notes']
RULES_HEADER = ['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis', 'Override name', 'Override text', 'Override meta']
OVERRIDES = ['override_name', 'override_text', 'override_meta']
CHARACTER_KINDS = 'info,stat,track,bond,sheet,notes,move,special,advance,log,state'
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
    '    Kinds for the Map page: map (img=… a world map), location (Group = region; img=… optional), level (Group = the location’s',
    '    name; img=… one floor or level, in order). img= is a path on the site (assets/world/…) or an https address.',
    '  GM: the GM’s NPCs (npc), NPC harm (track), notes, secrets and clocks. Only shown with the GM passphrase.',
    '  Lore: shared lore. Kind = category, Name = title, Value = text, Notes = who added it.',
    '  Ship: the crew’s ship (the site offers to set it up if this tab is missing).',
    '  Every other tab is a character sheet. Tabs starting with _ are ignored.',
    '  A character tab’s "signin | Signed in | yes" row means someone has signed in as them on the site (blank = nobody).',
    '',
    'Rows on every tab except Rules: Kind | Name | Value | Notes. Kind + Name identify a row, so keep them unique.',
    'The site adds a hidden Version column to the tabs it edits, so a late edit (from a page that was offline) can’t undo a newer one. Leave it alone.',
    'To remove a row, clear its cells rather than deleting the row: a deleted row isn’t noticed, so a page that missed it could add it back.',
    '',
    'Symbols',
    '  Tracks (harm, luck, experience, wreck, clocks): ● marked, ○ open, ✕ crossed out. Typing x, o, 1 or 0 also works.',
    '  Bonds: ● marked, ○ marked but used, · not marked.',
    '',
    'Text: a blank line starts a new paragraph; "- " starts a bullet (indent two spaces to nest);',
    '"[ ] " and "[x] " are checklist items; **bold**, *trigger*, ~tag~, ^italic^.',
    '',
    'Keep the columns formatted as plain text (Format > Number > Plain text) so Sheets doesn’t turn +2 into 2 or a date.',
]


def text_sheet(ws, header, rows, widths):
    ws.append(header)
    for r in rows:
        ws.append([str(v) if v is not None else '' for v in r])
    for col, w in zip('ABCDEFGHI', widths):
        ws.column_dimensions[col].width = w
    for row in ws.iter_rows(min_row=1, max_row=max(ws.max_row, 1000), max_col=len(header)):
        for cell in row:
            cell.number_format = '@'
            if cell.row > 1 and isinstance(cell.value, str) and cell.value.startswith('='):
                cell.data_type = 's'  # keep as text, never a formula
            cell.alignment = Alignment(wrap_text=True, vertical='top')
    for cell in ws[1]:
        cell.font = BOLD
        cell.fill = HEAD_FILL
    ws.freeze_panes = 'A2'


def overlay(recs, theme_rules):
    """The book's rows with the theme's laid over them: matching rows get Override columns."""
    key = lambda r: tuple(str(r.get(k, '')).strip().lower() for k in ('kind', 'group', 'name'))
    out = [dict(r) for r in recs]
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
        else:
            out.append(dict(t))
            at[key(t)] = len(out) - 1
    return out


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
    recs = overlay(recs, theme.get('rules', []))
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
    text_sheet(wb.create_sheet('Lore'), HEADER, theme.get('lore', []), [14, 26, 70, 16])

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
