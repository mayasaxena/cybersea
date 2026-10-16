#!/usr/bin/env python3
"""Build a game spreadsheet template (.xlsx) to upload to Google Drive.

The template carries rulebook text and player data, so it is built locally and shared
privately, never committed (.gitignore blocks *.xlsx).

  python3 -I tools/xlsx/build.py --rules rules.json --out blank-game.xlsx
  python3 -I tools/xlsx/build.py --rules rules.json --tab Nexa=nexa-rows.json \
      --house house.json --out cybersea.xlsx

rules.json: [{kind, group, name, text, meta, vis}, ...] (from tools/extract)
--tab Name=rows.json: a tab's rows as [[Kind, Name, Value, Notes], ...]
--house house.json: extra Rules rows (same shape as rules.json), e.g. house rules
"""
import argparse
import json

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.datavalidation import DataValidation

HEADER = ['Kind', 'Name', 'Value', 'Notes']
RULES_HEADER = ['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis']
CHARACTER_KINDS = 'info,stat,track,bond,sheet,notes,move,special,advance,log,state'
BOLD = Font(bold=True)
HEAD_FILL = PatternFill('solid', fgColor='E8EEF3')

README = [
    'This spreadsheet is one game for the Cybersea crew site.',
    '',
    'Tabs',
    '  Rules: the game’s rules text (Kind | Group | Name | Text | Meta | Vis). Vis "gm" rows are only shown with the GM passphrase.',
    '  GM: the GM’s NPCs (npc), NPC harm (track), notes, secrets and clocks. Only shown with the GM passphrase.',
    '  Lore: shared lore. Kind = category, Name = title, Value = text, Notes = who added it.',
    '  Ship: the crew’s ship (the site offers to set it up if this tab is missing).',
    '  Every other tab is a character sheet. Tabs starting with _ are ignored.',
    '',
    'Rows on every tab except Rules: Kind | Name | Value | Notes. Kind + Name identify a row, so keep them unique.',
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
    for col, w in zip('ABCDEF', widths):
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rules', required=True)
    ap.add_argument('--house', help='extra Rules rows, e.g. house rules')
    ap.add_argument('--tab', action='append', default=[], help='Name=rows.json (a character tab)')
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    recs = json.load(open(a.rules, encoding='utf-8'))
    if a.house:
        recs = recs + json.load(open(a.house, encoding='utf-8'))
    rules_rows = [[r.get('kind', ''), r.get('group', ''), r.get('name', ''), r.get('text', ''), r.get('meta', ''), r.get('vis', 'crew')] for r in recs]

    wb = Workbook()
    readme = wb.active
    readme.title = 'README'
    for line in README:
        readme.append([line])
    readme.column_dimensions['A'].width = 120
    readme['A1'].font = Font(bold=True, size=13)

    text_sheet(wb.create_sheet('Rules'), RULES_HEADER, rules_rows, [12, 16, 26, 90, 28, 6])
    text_sheet(wb.create_sheet('GM'), HEADER, [], [10, 26, 60, 60])
    text_sheet(wb.create_sheet('Lore'), HEADER, [], [14, 26, 70, 16])

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
