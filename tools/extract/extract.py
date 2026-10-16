#!/usr/bin/env python3
"""Structured extraction of a rulebook plain-text dump into rules.json records.

This file contains ONLY code: regexes, glyph maps and structural logic.  All
names and prose are discovered from the input text at runtime; line ranges and
column split positions live in layout.json next to this file.

Usage:
    python3 -I extract.py BOOK.txt OUTDIR [--handport FILE] [--debug-splits]

Record schema (rules.json is an array of these):
    {kind, group, name, text, meta, vis, src: [firstLine, lastLine]}
"""
import json
import re
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent

# ---------------------------------------------------------------- glyph map --
G_HEAD = '\uf046'      # private-use ornament around centred move headings
G_BULLET = '\x8a'      # hidden bullet control char
G_CHECK = '\x84'       # hidden checkbox control char
G_BOX = '\u25a0'       # filled square: advance / special count boxes
ZERO_WIDTH = '\ufeff\u200b'
FF = '\x0c'

FOOTER_RES = [
    re.compile(r'^\s*RAPSCALLION\s+\u2013\s+.+?\s{2,}\d+\s{2,}\S.*$'),
    re.compile(r'^\s*\S.*?\s{2,}\d+\s{2,}RAPSCALLION\s+\u2013\s+.+$'),
    re.compile(r'^\s*\d+\s+RAPSCALLION\s+\u2013\s+.+$'),
]

# list markers at the start of a line -> markup
BULLET_RE = re.compile(r'^(\s*)([\x8a\x84\u2022]|\)(?=\s))\s*(.*)$')
INDENT_RE = re.compile(r'^(\s*)')
MARK_RE = re.compile(r'^\s*(?:[\x8a\x84\u2022]|\)(?=\s))\s*')

# structural regexes
CAPS_HEAD_RE = re.compile(r"^\s{0,8}([A-Z][A-Z\u2019' ]*[A-Z\u2019])\s*((?:\u25a0\s*)*)$")
HARM_LUCK_RE = re.compile(r'^\s*HARM\s+(\d+)\s+LUCK\s+(\d+)\s*$')
MOVE_ITEM_RE = re.compile(r'^\s*(xz|z)\s+(?=[A-Z])')
ITEM_NAME_RE = re.compile(r"^([A-Z0-9][A-Z0-9\u2019'\-, ]*?[A-Z\u2019])\s*(\(([^)]*)\))?\.\s*")
NUM_ITEM_RE = re.compile(r'^\s*(\d+)[.)]\s+')
TRAITS_RE = re.compile(r'^\(\s*([+\-]?\d(?:\s*,\s*[+\-]?\d)+)\s*\)\s*')
LEVEL_RE = re.compile(r'^\s*([A-Z][a-z]+ \d):\s*$')


def indent(s):
    return len(INDENT_RE.match(s).group(1))


class V:
    """A virtual (de-interleaved) line: source line number + text."""
    __slots__ = ('src', 'text', 'side')

    def __init__(self, src, text, side=None):
        self.src, self.text, self.side = src, text, side

    def __repr__(self):
        return f'V({self.src},{self.side},{self.text!r})'


# ------------------------------------------------------------------- book --
class Book:
    def __init__(self, path, layout):
        raw = Path(path).read_text(encoding='utf-8').split('\n')
        self.n = len(raw)
        self.raw = [''] + raw
        self.lines = [''] + [self._clean(l) for l in raw]
        self.layout = layout
        self.footer = {i for i in range(1, self.n + 1)
                       if any(r.match(self.lines[i]) for r in FOOTER_RES)}
        self.dropped = set(self.footer)
        for i in sorted(self.footer):           # bottom-of-page padding
            j = i - 1
            while j > 0 and not self.lines[j].strip():
                self.dropped.add(j)
                j -= 1
        self.page_start = {f + 1 for f in self.footer}
        self.words = set()
        self.dehyphen_kept = Counter()
        self.dehyphen_stem = Counter()
        self.dehyphen_soft = Counter()
        self.stream = self._build_stream()
        self.words = self._wordset()
        self.stream = self._build_stream()     # again, so table cells see the word set
        self.dehyphen_kept = Counter()
        self.dehyphen_stem = Counter()
        self.dehyphen_soft = Counter()

    @staticmethod
    def _clean(l):
        for ch in FF + ZERO_WIDTH:
            l = l.replace(ch, '')
        return l.rstrip()

    def _wordset(self):
        """Whole words of the de-interleaved text (line-break fragments excluded)."""
        words = set()
        prev_hyph = False
        for v in self.stream:
            l = v.text
            toks = list(re.finditer(r'[A-Za-z]+', l))
            hyph = bool(re.search(r'[A-Za-z]-$', l))
            for k, m in enumerate(toks):
                if k == 0 and prev_hyph:
                    continue
                if k == len(toks) - 1 and hyph:
                    continue
                words.add(m.group(0).lower())
            if l.strip():
                prev_hyph = hyph
        return words

    # -- two-column splitting -------------------------------------------
    def split_line(self, i, col):
        """Return (left, right, rel) for source line i split near column col."""
        l = self.lines[i]
        over = self.layout.get('split_lines', {}).get(str(i))
        if over is not None:
            p = int(over)
            return l[:p].rstrip(), l[p:].strip(), max(0, indent(l[p:]))
        if not l.strip():
            return '', '', 0
        first = indent(l)
        if first >= col - 4:
            return '', l[first:], first - col
        cands = [m.start(1) for m in re.finditer(r'\s{2,}(\S)', l)
                 if m.start(1) > first]
        cands = [p for p in cands if col - 12 <= p <= col + 14]
        if not cands:
            return l, '', 0
        p = min(cands, key=lambda p: (abs(p - col), p))
        return l[:p].rstrip(), l[p:], p - col

    def _build_stream(self):
        splits = self.layout.get('splits', [])
        in_split = {}
        inserts = {}
        head_re = re.compile(G_HEAD + r'\s*[A-Z]+')
        for sp in splits:
            a, b, col = sp['a'], sp['b'], sp['col']
            right_at = sp.get('right_at', b + 1)
            rights = []
            lefts = []
            for i in range(a, b + 1):
                if i in self.dropped:
                    continue
                left, right, rel = self.split_line(i, col)
                in_split[i] = []
                if left.strip() or not self.lines[i].strip():
                    v = V(i, left, 'L')
                    in_split[i].append(v)
                    lefts.append(v)
                if right.strip():
                    rights.append(V(i, ' ' * max(0, rel) + right.strip(), 'R'))
                elif not self.lines[i].strip():
                    rights.append(V(i, '', 'R'))
            while rights and not rights[0].text.strip():
                rights.pop(0)
            while rights and not rights[-1].text.strip():
                rights.pop()
            if sp.get('lift'):
                # move inline glyph headings to the front of their column
                for col_lines, is_left in ((lefts, True), (rights, False)):
                    for v in col_lines:
                        m = head_re.search(v.text)
                        if m:
                            hv = V(v.src, m.group(0), v.side)
                            v.text = head_re.sub('', v.text)
                            if is_left:
                                first = next(i for i in range(a, b + 1) if in_split.get(i))
                                in_split[first].insert(0, hv)
                            else:
                                rights.insert(0, hv)
                            break
            inserts.setdefault(right_at, []).append(V(b, '', 'R'))
            inserts[right_at].extend(rights)
            inserts[right_at].append(V(b, '', 'R'))
        tables = {}
        for tb in self.layout.get('tables', []):
            for i in range(tb['a'], tb['b'] + 1):
                tables[i] = tb
        out = []
        done_tables = set()
        for i in range(1, self.n + 1):
            if i in inserts:
                out.extend(inserts.pop(i))
            if i in self.dropped:
                continue
            if i in tables:
                tb = tables[i]
                if id(tb) not in done_tables:
                    done_tables.add(id(tb))
                    for row in self.table_rows(tb):
                        for cell, src in row:
                            out.append(V(src, cell, 'T'))
                        out.append(V(row[-1][1], '', 'T'))
                continue
            if i in in_split:
                out.extend(in_split[i])
                continue
            out.append(V(i, self.lines[i]))
        for k in sorted(inserts):
            out.extend(inserts[k])
        return out

    # -- tables -------------------------------------------------------------
    def table_columns(self, tb):
        head = self.lines[tb['header']]
        starts = [m.start(1) for m in re.finditer(r'(?:^\s*|\s{2,})(\S)', head)]
        names = [head[s:].split('  ')[0].strip() for s in starts]
        return starts, names

    def table_rows(self, tb):
        """Rows as lists of (cell_text, src_line) in column order (incl. header)."""
        starts, _ = self.table_columns(tb)
        rows, cur = [], None
        for i in range(tb['a'], tb['b'] + 1):
            if i in self.dropped:
                continue
            l = self.lines[i]
            if not l.strip():
                cur = None
                continue
            cells = []
            for k, s in enumerate(starts):
                e = starts[k + 1] if k + 1 < len(starts) else None
                seg = l[max(0, s - 1):(e - 1) if e else None]
                cells.append(seg.strip())
            if cur is None:
                cur = [[[], i, i] for _ in starts]
                rows.append(cur)
            for k, c in enumerate(cells):
                if c:
                    if not cur[k][0]:
                        cur[k][1] = i
                    cur[k][0].append(c)
                    cur[k][2] = i
        self.table_last = {}
        result = []
        for r in rows:
            result.append([(self.join_parts(c[0]), c[1]) for c in r])
            self.table_last[r[0][1]] = max(c[2] for c in r)
        return result

    # -- text joining ---------------------------------------------------------
    def join2(self, a, b):
        if not a:
            return b
        if not b:
            return a
        if re.search(r'[0-9]-$', a) or (re.search(r'[A-Za-z]-$', a) and b[:1].isdigit()):
            return a + b
        m = re.search(r'([A-Za-z]+)-$', a)
        if m and b[:1].isalpha():
            n = re.match(r'[A-Za-z]+', b)
            joined = (m.group(1) + n.group(0)).lower()
            if joined in self.words:
                return a[:-1] + b
            if self.stem_known(joined):
                self.dehyphen_stem[m.group(1) + '-' + n.group(0)] += 1
                return a[:-1] + b
            # Third tier: a real compound when both halves are words, otherwise a line-break
            # split. layout.json "hyphens" overrides either way after a human look.
            key = (m.group(1) + '-' + n.group(0)).lower()
            over = self.layout.get('hyphens', {})
            compound = m.group(1).lower() in self.words and n.group(0).lower() in self.words
            if key in over.get('keep', []) or (compound and key not in over.get('join', [])):
                self.dehyphen_kept[m.group(1) + '-' + n.group(0)] += 1
                return a + b
            self.dehyphen_soft[m.group(1) + '-' + n.group(0)] += 1
            return a[:-1] + b
        if a.endswith(('\u2014', '/')):
            return a + b
        return a + ' ' + b

    def stem_known(self, w):
        """Second tier: an inflected form whose stem occurs in the book."""
        for suf in ('ing', 'ed', 'es', 's', 'ly', 'd'):
            if w.endswith(suf) and len(w) - len(suf) >= 4:
                st = w[:-len(suf)]
                if st in self.words or st + 'e' in self.words or (
                        len(st) > 4 and st[-1] == st[-2] and st[:-1] in self.words):
                    return True
        return False

    def join_parts(self, parts):
        out = ''
        for p in parts:
            out = self.join2(out, p.strip())
        return out

    # -- selection ---------------------------------------------------------------
    def seg(self, a, b, side=None, exclude=()):
        """Stream lines whose source line is within [a, b], in stream order."""
        res = []
        for v in self.stream:
            if a <= v.src <= b:
                if side == 'LN' and v.side == 'R':
                    continue
                if side in ('L', 'R') and v.side != side:
                    continue
                if v.src in exclude:
                    continue
                res.append(v)
        return res

    # -- rendering to markup ---------------------------------------------------
    def items(self, vls, box=False, bullets=True):
        """Group virtual lines into paragraphs ('p') and list items ('-', '[ ]').

        Returns dicts {k, text, src:[a,b]}."""
        nb = [v for v in vls if v.text.strip()]
        if not nb:
            return []
        inds = [indent(v.text) for v in nb
                if not (bullets and BULLET_RE.match(v.text))]
        base = min(inds) if inds else 0
        maxlen = max(len(v.text.rstrip()) for v in nb)
        items = []
        cur = None
        prev = None
        for v in vls:
            t = v.text.rstrip()
            if not t.strip():
                cur = None
                prev = None
                continue
            m = BULLET_RE.match(t) if bullets else None
            if m and m.group(2) == '\u2022' and prev is not None and \
                    not re.search(r'[.!?:\u201d]$', prev.rstrip()):
                m = None   # an inline separator that happens to start a line
            ind = indent(t)
            if m:
                kind = '[ ]' if m.group(2) == G_CHECK else '-'
                cur = {'k': kind, 'ind': len(m.group(1)), 'parts': [m.group(3)],
                       'src': [v.src, v.src]}
                items.append(cur)
                prev = t
                continue
            s = t.strip()
            if cur is not None:
                if cur['k'] != 'p':
                    cont = ind >= cur['ind'] if cur['ind'] > base else ind > cur['ind']
                    if cont:
                        cur['parts'].append(s)
                        cur['src'][1] = max(cur['src'][1], v.src)
                        cur['src'][0] = min(cur['src'][0], v.src)
                        prev = t
                        continue
                else:
                    newpara = ind >= base + 2 and ind > indent(prev or '')
                    if box and prev is not None:
                        ps = prev.strip()
                        if (re.search(r'[.!?:\u201d)]$', ps) and len(prev) < 0.72 * maxlen
                                and s[:1].isupper()):
                            newpara = True
                    if not newpara:
                        cur['parts'].append(s)
                        cur['src'][1] = max(cur['src'][1], v.src)
                        cur['src'][0] = min(cur['src'][0], v.src)
                        prev = t
                        continue
            cur = {'k': 'p', 'ind': ind, 'parts': [s], 'src': [v.src, v.src]}
            items.append(cur)
            prev = t
        for it in items:
            it['text'] = self.join_parts(it['parts'])
        return items

    @staticmethod
    def markup(items):
        out = ''
        last = None
        for it in items:
            block = it['text'] if it['k'] == 'p' else f"{it['k']} {it['text']}"
            if last is None:
                out = block
            elif last != 'p' and it['k'] != 'p':
                out += '\n' + block
            else:
                out += '\n\n' + block
            last = it['k']
        return out

    def render(self, vls, box=False):
        """Render virtual lines to markup: paragraphs, '- ' bullets, '[ ] ' checks."""
        return self.markup(self.items(vls, box))


def src_of(vls):
    s = [v.src for v in vls if v.text.strip()]
    return [min(s), max(s)] if s else [0, 0]


def meta_str(**kw):
    parts = []
    for k, v in kw.items():
        if v is None or v == '':
            continue
        v = str(v)
        if re.search(r'[\s"]', v):
            v = '"' + v.replace('"', "'") + '"'
        parts.append(f'{k}={v}')
    return ' '.join(parts)


def rec(kind, group, name, text, src, meta='', vis='crew'):
    return {'kind': kind, 'group': group, 'name': name, 'text': text,
            'meta': meta, 'vis': vis, 'src': list(src)}


# ---------------------------------------------------------------- helpers --
def blocks(vls):
    """Split virtual lines into blocks separated by blank lines."""
    out, cur = [], []
    for v in vls:
        if v.text.strip():
            cur.append(v)
        elif cur:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def strip_first(vls, n):
    """Return a copy of vls with the first n characters (after indent) of the
    first non-blank line removed."""
    out = list(vls)
    for k, v in enumerate(out):
        if v.text.strip():
            t = v.text
            ind = indent(t)
            out[k] = V(v.src, ' ' * ind + t[ind + n:].lstrip(), v.side)
            break
    return out


def hang(vls):
    """Re-indent the first line of a hanging-indent item to its continuation."""
    nb = [k for k, v in enumerate(vls) if v.text.strip()]
    if len(nb) < 2:
        return vls
    cont = min(indent(vls[k].text) for k in nb[1:])
    out = list(vls)
    v = out[nb[0]]
    out[nb[0]] = V(v.src, ' ' * cont + v.text.strip(), v.side)
    return out


def title_case(s):
    return ' '.join(w[:1] + w[1:].lower() for w in s.split())


def caps_heading(text):
    m = CAPS_HEAD_RE.match(text)
    if not m:
        return None
    name = m.group(1).strip()
    if len(name) < 3:
        return None
    return name, m.group(2).count(G_BOX)



def group_by_start(vls, start_re):
    """Split lines into (pre, groups) where each group begins at a line
    matching start_re."""
    pre, groups = [], []
    for v in vls:
        if v.text.strip() and start_re.match(v.text):
            groups.append([v])
        elif groups:
            groups[-1].append(v)
        else:
            pre.append(v)
    return pre, groups


def strip_marker(vls, marker_re):
    out = list(vls)
    for k, v in enumerate(out):
        if v.text.strip():
            m = marker_re.match(v.text)
            if m:
                ind = indent(v.text)
                out[k] = V(v.src, ' ' * ind + v.text[m.end():], v.side)
            break
    return out


TRAIT_ROLL_RE = re.compile(r'\brolls? \+([A-Z]{4,})\b')
LABEL_RE = re.compile(r'(?<=[.!?])\s+([A-Z][a-z]+):\s+')


def roll_trait(text):
    m = TRAIT_ROLL_RE.search(text)
    return m.group(1) if m else None


def split_name(text):
    """'NAME (x, y). rest' -> (NAME, paren, rest)."""
    m = ITEM_NAME_RE.match(text)
    if not m:
        return None, None, text
    return m.group(1).strip(), m.group(3), text[m.end():]


def traits_meta(paren):
    if not paren:
        return None
    vals = [x.strip() for x in paren.split(',')]
    if all(re.fullmatch(r'[+\-]?\d', x) for x in vals):
        return ','.join(vals)
    return None


# ------------------------------------------------------------- ch.5 moves --
def parse_handport(path):
    """Parse the MOVES array of the hand-ported sheet: (cat, NAME) -> text."""
    s = Path(path).read_text(encoding='utf-8')
    out = {}
    for m in re.finditer(r"\['(\w+)','([^']+)',`\n?(.*?)`", s, re.S):
        out[(m.group(1), m.group(2))] = m.group(3).strip('\n')
    return out


def norm_cmp(s):
    s = re.sub(r'^\s*(?:- |\[[ x]\] )', '', s, flags=re.M)
    s = re.sub(r'[*~^]', '', s)
    s = s.replace('\u2019', "'").replace('\u2018', "'")
    s = s.replace('\u201c', '"').replace('\u201d', '"')
    s = s.replace('-', '')
    s = re.sub(r'\s+', ' ', s)
    return s.strip().lower()


def glyph_boxes(bk, vls):
    """Yield (name, box_lines, heading_vline) for glyph-headed move boxes."""
    k = 0
    while k < len(vls):
        t = vls[k].text
        if G_HEAD in t:
            head = vls[k]
            name = t.replace(G_HEAD, '').strip()
            box = []
            base = None
            k += 1
            while k < len(vls):
                tt = vls[k].text
                if not tt.strip():
                    break
                ind = indent(tt)
                if base is None:
                    base = ind
                elif ind < base:
                    break
                box.append(vls[k])
                k += 1
            yield name, box, head
        else:
            k += 1


def parse_moves(bk, L, out, log, handport):
    for group, (a, b) in L['moves'].items():
        for name, box, head in glyph_boxes(bk, bk.seg(a, b)):
            text = bk.render(box, box=True)
            status = 'no-handport'
            mk = None
            hp = handport.get((group, name)) if handport else None
            if hp is not None:
                if norm_cmp(hp) == norm_cmp(text):
                    status = 'match'
                    text = hp
                    mk = 'handport'
                else:
                    status = 'differs'
            log.setdefault('handport', []).append(
                {'group': group, 'name': name, 'status': status,
                 'ours': norm_cmp(text) if status == 'differs' else None,
                 'theirs': norm_cmp(hp) if status == 'differs' else None})
            out.append(rec('move', group, name, text,
                           [head.src, src_of(box)[1]],
                           meta_str(trait=roll_trait(text), markup=mk)))


# ------------------------------------------------------------- procedures --
def parse_procedures(bk, L, out):
    P = L['procedures']
    # session anatomy: numbered steps
    a, b = P['session']
    pre, groups = group_by_start(bk.seg(a, b), NUM_ITEM_RE)
    for g in groups:
        g2 = strip_marker(g, NUM_ITEM_RE)
        text = bk.render(g2)
        m = re.search(r'\b([A-Z]{2,}(?: [A-Z]+)+)\b', text)
        name = m.group(1) if m else NUM_ITEM_RE.match(g[0].text).group(1)
        if m and m.start() == 0:
            text = re.sub(r'^[A-Z ]+\.\s*', '', text)
        out.append(rec('procedure', 'session', name, text, src_of(g)))
    # chapter's end box
    a, b = P['chapter']
    for name, box, head in glyph_boxes(bk, bk.seg(a, b)):
        out.append(rec('procedure', 'chapter', name, bk.render(box, box=True),
                       [head.src, src_of(box)[1]]))
    # simple paragraphs named by a heading line
    for key in ('downtime', 'advance', 'experience'):
        spec = P[key]
        a, b = spec['lines']
        vls = bk.seg(a, b)
        if spec.get('name_from_first'):
            name = vls[0].text.strip()
            vls = vls[1:]
        else:
            name = bk.lines[spec['name_line']].strip()
        out.append(rec('procedure', key, name, bk.render(vls), [a, b]))


def parse_advances(bk, L, out):
    a, b = L['advances']
    for v in bk.seg(a, b):
        m = re.match(r'^\s*((?:\u25a0\s*)+)(.*)$', v.text)
        if not m:
            continue
        boxes = m.group(1).count(G_BOX)
        text = m.group(2).strip()
        low = text.lower()
        kind = next((k for k in ('trait', 'bond', 'oddity', 'move') if k in low), 'other')
        out.append(rec('advance', 'all', text, text, [v.src, v.src],
                       meta_str(kind=kind, max=boxes if boxes > 1 else None)))


# --------------------------------------------------------------- playbooks --
SECTION_KINDS = [('VICE', 'vice'), ('ODDITIES', 'oddity'), ('KIT', 'kit'),
                 ('LAST WORDS', 'lastwords'), ('QUESTIONS', 'question'),
                 ('PLAYBOOK MOVES', 'pmove'), ('NOTES', 'pnote'),
                 ('EPILOGUE', 'pnote'), ('RENOWN', 'renown'),
                 ('SPECIALS', 'specials')]


def section_kind(label):
    for k, v in SECTION_KINDS:
        if label == k or (k == 'NOTES' and label.startswith(k + ' ')):
            return v
    return None


def split_sections(vls):
    secs = []
    cur = None
    harm = luck = None
    for v in vls:
        t = v.text
        hl = HARM_LUCK_RE.match(t) if t.strip() else None
        if hl:
            harm, luck = hl.group(1), hl.group(2)
            cur = {'label': '_stats', 'boxes': 0, 'head': v, 'lines': []}
            secs.append(cur)
            continue
        h = caps_heading(t) if t.strip() else None
        if h:
            cur = {'label': h[0], 'boxes': h[1], 'head': v, 'lines': []}
            secs.append(cur)
            continue
        if cur is not None:
            cur['lines'].append(v)
    return secs, harm, luck


def vice_records(bk, pb, sec, out):
    its = bk.items(sec['lines'])
    if any(it['k'] != 'p' for it in its):
        intro = [it for it in its if it['k'] == 'p' and it is its[0]]
        if intro:
            out.append(rec('rule', pb, sec['label'], intro[0]['text'], intro[0]['src']))
        for it in its:
            if it['k'] == 'p':
                continue
            name, _, rest = split_name(it['text'])
            out.append(rec('vice', pb, name, LABEL_RE.sub(r'\n\n**\1:** ', rest),
                           it['src'], 'matelot=1'))
    else:
        text = Book.markup(its)
        name, _, rest = split_name(text)
        rest = LABEL_RE.sub(r'\n\n**\1:** ', rest)
        out.append(rec('vice', pb, name, rest, src_of(sec['lines'])))


def oddity_records(bk, pb, sec, out, ship=False):
    pre, groups = group_by_start(sec['lines'], MOVE_ITEM_RE)
    if any(v.text.strip() for v in pre):
        out.append(rec('rule', pb, sec['label'], bk.render(pre), src_of(pre)))
    for g in groups:
        g2 = strip_marker(g, MOVE_ITEM_RE)
        text = bk.render(g2)
        name, paren, rest = split_name(text)
        tm = traits_meta(paren)
        if paren and not tm:
            rest = text[len(name):].lstrip()
        out.append(rec('oddity', pb, name, rest, src_of(g), meta_str(traits=tm)))


def kit_records(bk, pb, sec, out):
    its = bk.items(sec['lines'])
    first = next((k for k, it in enumerate(its) if it['k'] != 'p'), len(its))
    head = its[:first]
    if head:
        out.append(rec('rule', pb, sec['label'], Book.markup(head),
                       [head[0]['src'][0], head[-1]['src'][1]]))
    n = 0
    extra = 0
    for it in its[first:]:
        if it['k'] != 'p':
            n += 1
            text = it['text']
            m = TRAITS_RE.match(text)
            tm = None
            if m:
                tm = ','.join(x.strip() for x in m.group(1).split(','))
                text = text[m.end():]
            out.append(rec('kit', pb, f'Kit {n}', text, it['src'], meta_str(traits=tm)))
        else:
            extra += 1
            out.append(rec('kit', pb, 'Kit extra' + (f' {extra}' if extra > 1 else ''),
                           it['text'], it['src'], 'extra=1'))


def question_records(bk, pb, sec, out):
    pre, groups = group_by_start(sec['lines'], NUM_ITEM_RE)
    for g in groups:
        num = NUM_ITEM_RE.match(g[0].text).group(1)
        g2 = strip_marker(g, NUM_ITEM_RE)
        text = bk.join_parts([v.text for v in g2 if v.text.strip()])
        out.append(rec('question', pb, num, text, src_of(g)))


def pmove_records(bk, pb, sec, out, pick_lines, kind='pmove'):
    picks = [v for v in sec['lines'] if v.src in pick_lines]
    rest = [v for v in sec['lines'] if v.src not in pick_lines]
    if picks:
        out.append(rec('rule', pb, sec['label'], bk.render(picks), src_of(picks)))
    pre, groups = group_by_start(rest, MOVE_ITEM_RE)
    if any(v.text.strip() for v in pre):
        out.append(rec('rule', pb, sec['label'], bk.render(pre), src_of(pre)))
    starts = 0
    for g in groups:
        mk = MOVE_ITEM_RE.match(g[0].text).group(1)
        g2 = strip_marker(g, MOVE_ITEM_RE)
        text = bk.render(g2)
        name, _, body = split_name(text)
        st = 'start' if mk == 'xz' else 'adv'
        starts += st == 'start'
        out.append(rec(kind, pb, name, body, src_of(g),
                       meta_str(**{st: 1}, trait=roll_trait(body))))
    return starts


def renown_records(bk, pb, sec, out):
    pre, groups = group_by_start(sec['lines'], LEVEL_RE)
    for g in groups:
        name = LEVEL_RE.match(g[0].text).group(1)
        out.append(rec('renown', pb, name, bk.render(g[1:]), src_of(g),
                       meta_str(level=name.split()[-1])))


def parse_playbook(bk, L, spec, out, ship=False):
    a, b = spec['a'], spec['b']
    vls = bk.seg(a, b)
    secs, harm, luck = split_sections(vls)
    title = secs[0]
    pbname = title_case(re.sub(r'^THE\s+', '', title['label']))
    pick_lines = set()
    for pa, pz in spec.get('pick', []):
        pick_lines.update(range(pa, pz + 1))
    intro = bk.render(title['lines'])
    pb_rec = rec('playbook', pbname, pbname, intro,
                 [title['head'].src, src_of(title['lines'])[1]])
    out.append(pb_rec)
    starts = 0
    specials = []
    for sec in secs[1:]:
        label = sec['label']
        kind = section_kind(label)
        src = [sec['head'].src, src_of(sec['lines'])[1] or sec['head'].src]
        if label == '_stats':
            continue
        if kind == 'vice':
            vice_records(bk, pbname, sec, out)
        elif kind == 'oddity':
            oddity_records(bk, pbname, sec, out, ship)
        elif kind == 'kit':
            kit_records(bk, pbname, sec, out)
        elif kind == 'lastwords':
            out.append(rec('lastwords', pbname, label, bk.render(sec['lines']), src))
        elif kind == 'question':
            question_records(bk, pbname, sec, out)
        elif kind == 'pmove':
            starts += pmove_records(bk, pbname, sec, out, pick_lines)
        elif kind == 'pnote':
            out.append(rec('pnote', pbname, label, bk.render(sec['lines']), src))
        elif kind == 'renown':
            renown_records(bk, pbname, sec, out)
        elif kind == 'specials':
            text = bk.render(sec['lines'])
            specials = text
            out.append(rec('rule', pbname, label, text, src))
        else:
            text = bk.render(sec['lines'])
            if ship and text:
                out.append(rec('smove', pbname, label, text, src,
                               meta_str(trait=roll_trait(text))))
            else:
                out.append(rec('rule', pbname, label, text, src,
                               meta_str(boxes=sec['boxes'] or None,
                                        track=1 if not text else None)))
    if ship:
        pb_rec['meta'] = meta_str(type='ship', specials='|'.join(
            special_names_in(specials, L.get('_special_names', []))) or None)
    else:
        pb_rec['meta'] = meta_str(type='pirate', harm=harm, luck=luck,
                                  pick=1 if pick_lines else 0)


def special_names_in(text, names):
    if not text:
        return []
    low = text.lower()
    found = []
    for item in text.split('\n'):
        il = item.lower()
        hits = [(il.rfind(n.lower()), n) for n in names if n.lower() in il]
        if hits:
            pos, n = max(hits)
            found.append(item[pos:pos + len(n)])
    return found


def parse_specials(bk, L, out):
    a, b = L['specials']
    start = re.compile(r"^([A-Z][A-Z\u2019' \-]+?)\s+((?:\u25a0\s*)+)(.*)$")
    pre, groups = group_by_start(bk.seg(a, b), start)
    names = []
    for g in groups:
        m = start.match(g[0].text)
        name, boxes = m.group(1).strip(), m.group(2).count(G_BOX)
        first = V(g[0].src, m.group(3), g[0].side)
        text = bk.render(hang([first] + g[1:]))
        names.append(name)
        out.append(rec('special', 'all', name, text, src_of(g), meta_str(boxes=boxes)))
    L['_special_names'] = names


# -------------------------------------------------------------------- tags --
TAG_START_RE = re.compile(r'^(\S[^:]{0,40}?):\s+\S')


def parse_tags(bk, L, out):
    T = L['tags']
    for group in ('item', 'weapon', 'npc'):
        a, b = T[group]
        pre, groups = group_by_start(bk.seg(a, b), TAG_START_RE)
        for g in groups:
            m = TAG_START_RE.match(g[0].text)
            name = m.group(1)
            first = V(g[0].src, g[0].text[len(name) + 1:].lstrip(), g[0].side)
            out.append(rec('tag', group, name, bk.render(hang([first] + g[1:])), src_of(g)))
    # range tags are defined sentence-by-sentence inside one paragraph
    a, b = T['range']
    para = bk.render(bk.seg(a, b))
    for sent in re.split(r'(?<=[.!?])\s+(?=[A-Z])', para):
        m = re.match(r'^(?:\w+\s+){0,2}?(\w+) weapons?\b', sent)
        if m and m.group(1)[0].islower():
            out.append(rec('tag', 'range', m.group(1), sent, [a, b]))
    a, b = T['armor']
    vls = bk.seg(a, b)
    text = bk.render(vls)
    out.append(rec('tag', 'armor', re.match(r'\w+', text).group(0), text, [a, b]))


# ------------------------------------------------------------------ tables --
def parse_table(bk, tb, out, kind, group, meta_cols=(), text_cols=None, vis='crew'):
    starts, names = bk.table_columns(tb)
    rows = bk.table_rows(tb)
    for row in rows[1:]:
        cells = [c for c, _ in row]
        srcs = [s for _, s in row]
        name = cells[0]
        tcols = text_cols if text_cols is not None else [k for k in range(1, len(cells))
                                                        if k not in meta_cols]
        text = '\n\n'.join(cells[k] for k in tcols if cells[k])
        meta = {}
        for k in meta_cols:
            meta[re.sub(r'\W+', '', names[k].lower())] = cells[k]
        if len(tcols) > 1:
            meta['cols'] = ','.join(names[k] for k in tcols)
        out.append(rec(kind, group, name, text,
                       [min(srcs), max(max(srcs), bk.table_last.get(srcs[0], 0))],
                       meta_str(**meta), vis))


# ------------------------------------------------------- generic sections --
CAPS_LINE_RE = re.compile(r"^\s{0,16}([A-Z0-9][A-Z0-9’',\-?&! ]*[A-Z0-9?’])\s*$")
TITLE_END_BAD = re.compile(r'[.,;:!)”"—\-]$')


def is_example_line(t):
    return indent(t) >= 4 and not BULLET_RE.match(t)


def is_caps_heading(t):
    m = CAPS_LINE_RE.match(t)
    return bool(m) and sum(c.isalpha() for c in m.group(1)) >= 3 and len(m.group(1)) <= 60


def heading_at(bk, vls, k):
    """Return 'caps' / 'title' / None for vls[k]."""
    v = vls[k]
    t = v.text
    if not t.strip() or v.side == 'R':
        return None
    if is_caps_heading(t):
        return 'caps'
    s = t.strip()
    if indent(t) > 0 or len(s) > 32 or not s[0].isupper() or TITLE_END_BAD.search(s):
        return None
    if len(s.split()) > 8 or BULLET_RE.match(t):
        return None
    prev_ok = k == 0 or not vls[k - 1].text.strip() or v.src in bk.page_start
    nxt = vls[k + 1] if k + 1 < len(vls) else None
    return 'title' if prev_ok and nxt is not None and nxt.text.strip() else None


def prose_sections(bk, vls):
    """Split into sections at caps/title headings; consecutive caps heading
    lines merge into one heading.  Returns [{name, head, lines}]."""
    secs = []
    cur = {'name': None, 'head': None, 'lines': []}
    k = 0
    while k < len(vls):
        h = heading_at(bk, vls, k)
        if (not h and k + 1 < len(vls) and vls[k].side != 'R'
                and vls[k].text.rstrip().endswith(',')
                and is_caps_heading(vls[k].text.rstrip()[:-1])
                and is_caps_heading(vls[k + 1].text)):
            h = 'caps'
        if h:
            names = [vls[k].text.strip()]
            head = vls[k]
            if h == 'caps':
                while k + 1 < len(vls) and is_caps_heading(vls[k + 1].text):
                    k += 1
                    names.append(vls[k].text.strip())
            if cur['lines'] or cur['name']:
                secs.append(cur)
            cur = {'name': ' '.join(names), 'head': head, 'lines': [], 'kind': h}
        else:
            cur['lines'].append(vls[k])
        k += 1
    if cur['lines'] or cur['name']:
        secs.append(cur)
    return secs


def split_examples(vls):
    """Separate example runs (2+ consecutive lines indented >= 4 that are not
    list items or list continuations) from body lines."""
    body, runs, cur = [], [], []
    in_list = None
    for v in vls:
        t = v.text
        if not t.strip():
            if cur:
                cur.append(v)
            else:
                body.append(v)
            in_list = None
            continue
        m = BULLET_RE.match(t)
        if m:
            in_list = len(m.group(1))
        elif in_list is not None and indent(t) > in_list:
            pass
        else:
            in_list = None
        if in_list is None and is_example_line(t):
            cur.append(v)
            continue
        if cur:
            if len([c for c in cur if c.text.strip()]) >= 2:
                runs.append(cur)
            else:
                body.extend(cur)
            cur = []
        body.append(v)
    if cur:
        if len([c for c in cur if c.text.strip()]) >= 2:
            runs.append(cur)
        else:
            body.extend(cur)
    return body, runs


def split_n_examples(bk, run, n):
    """Split one example run into n examples at the most likely boundaries."""
    lines = [v for v in run if v.text.strip()]
    if n <= 1 or len(lines) < n:
        return [lines]
    maxlen = max(len(v.text.rstrip()) for v in lines)
    cands = []
    for k in range(1, len(lines)):
        p, c = lines[k - 1].text.rstrip(), lines[k].text.strip()
        if re.search(r'[.!?”…]$', p) and (c[:1].isupper() or c[:1] in '“"'):
            cands.append((len(p) / maxlen, k))
    cuts = sorted(k for _, k in sorted(cands)[:n - 1])
    out, last = [], 0
    for k in cuts + [len(lines)]:
        out.append(lines[last:k])
        last = k
    return out


def parse_prose(bk, a, b, kind, group, vis, out, exclude=(), name_map=None,
                examples=0, appropriate=False, skip_names=(), boxes=(),
                keep_examples=False, group_by_caps=False, meta_extra=None):
    vls = [v for v in bk.seg(a, b) if v.src not in exclude]
    inbox = set(x for r in boxes for x in range(r[0], r[1] + 1))
    secs = prose_sections(bk, [v for v in vls if v.src not in inbox])
    for r in boxes:
        bsecs = prose_sections(bk, [v for v in vls if r[0] <= v.src <= r[1]])
        for bs in bsecs:
            bs['box'] = True
        secs += bsecs
    cur_group = group
    for sec in sorted(secs, key=lambda x: x['head'].src if x['head'] else 0) if group_by_caps else secs:
        if group_by_caps and sec.get('kind') == 'caps' and not sec.get('box'):
            cur_group = sec['name']
        group_here = cur_group
        lines = sec['lines']
        right = [v for v in lines if v.side == 'R']
        left = [v for v in lines if v.side != 'R']
        if keep_examples:
            body, runs = left, []
        else:
            body, runs = split_examples(left)
        name = sec['name'] or (name_map or {}).get('_intro', group)
        if name in skip_names:
            continue
        text = bk.render(body)
        meta = {}
        if examples and runs:
            exs = []
            for r in runs:
                exs.extend(split_n_examples(bk, r, examples if len(runs) == 1 else 1))
            text = (text + '\n\n' if text else '') + '\n'.join(
                '- ' + bk.join_parts([v.text for v in ex]) for ex in exs)
            meta['examples'] = len(exs)
        elif examples:
            meta['intro'] = 1
        src = [sec['head'].src if sec['head'] else src_of(lines)[0], src_of(lines)[1]]
        if meta_extra:
            meta.update(meta_extra)
        if text.strip():
            out.append(rec(kind, group_here, name, text, src, meta_str(**meta), vis))
        if right and not appropriate:
            rl = [v for v in right if v.text.strip()]
            first = rl[0].text.strip()
            if is_caps_heading(first) or (len(first) < 40 and not TITLE_END_BAD.search(first)):
                rname, rbody = first, right[right.index(rl[0]) + 1:]
            else:
                rname, rbody = f'{name} (sidebar)', right
            rl2 = [v.text.strip() for v in rbody if v.text.strip()]
            if rl2 and all(len(x) <= 45 and not re.search(r'[.!?;:,]$', x) for x in rl2):
                rtext = '\n'.join('- ' + re.sub(r'\s{2,}', ' ', x) for x in rl2)
            else:
                rtext = bk.render(rbody)
            out.append(rec(kind, group, rname, rtext, src_of(right), 'sidebar=1', vis))
        if appropriate and right:
            body_r = [v for v in right if not (v.text.strip() and v.text.strip().endswith(':')
                                               and is_caps_heading(v.text.strip()[:-1]))]
            pb = re.sub(r'^The\s+', '', name)
            out.append(rec(kind, 'appropriate', pb, bk.render(body_r), src_of(right), '', vis))


def parse_fates(bk, L, out):
    F = L['fates']
    ms = F['movescale']
    excl = set(range(ms[0], ms[1] + 1))
    for spec in F['sections']:
        parse_prose(bk, spec['a'], spec['b'], 'fate', spec['group'], 'gm', out,
                    exclude=excl, examples=spec.get('examples', 0),
                    appropriate=spec.get('appropriate', False), boxes=spec.get('boxes', ()))
    # move-scale sidebar: heading line + numbered spectrum
    vls = bk.seg(ms[0], ms[1])
    name = vls[0].text.strip()
    pre, groups = group_by_start(vls[1:], NUM_ITEM_RE)
    parts = [bk.join_parts([v.text for v in pre if v.text.strip()])]
    for g in groups:
        parts.append(bk.join_parts([v.text for v in g if v.text.strip()]))
    out.append(rec('fate', 'movescale', name, '\n\n'.join(p for p in parts if p),
                   [ms[0], ms[1]], '', 'gm'))


def parse_rules(bk, L, out):
    for spec in L['rules']:
        if spec.get('box'):
            for name, box, head in glyph_boxes(bk, bk.seg(spec['a'], spec['b'])):
                out.append(rec('rule', spec['group'], name, bk.render(box, box=True),
                               [head.src, src_of(box)[1]], 'variant=1'))
            continue
        parse_prose(bk, spec['a'], spec['b'], 'rule', spec['group'],
                    spec.get('vis', 'crew'), out, exclude=set(
                        x for r in spec.get('exclude', []) for x in range(r[0], r[1] + 1)))


def parse_traits(bk, L, out):
    """Trait descriptions box: each side of each split block holds one trait."""
    head_re = re.compile(G_HEAD + r'\s*([A-Z]+)')
    for a, b in L['traits']:
        for side in ('L', 'R'):
            vls = bk.seg(a, b, side)
            name = None
            lines = []
            for v in vls:
                m = head_re.search(v.text)
                if m:
                    name = m.group(1)
                    v = V(v.src, head_re.sub('', v.text), v.side)
                if v.text.strip():
                    lines.append(v)
            if name:
                out.append(rec('rule', 'traits', name,
                               bk.join_parts([v.text for v in lines]), src_of(lines)))


def parse_example_oddities(bk, L, out):
    a, b = L['example_oddities']
    start = re.compile(r"^([A-Z][A-Z’' \-]+?)\s+\(")
    pre, groups = group_by_start(bk.seg(a, b), start)
    for g in groups:
        m = start.match(g[0].text)
        name = m.group(1).strip()
        first = V(g[0].src, g[0].text[m.end() - 1:], g[0].side)
        out.append(rec('oddity', 'Example', name, bk.render(hang([first] + g[1:])), src_of(g)))


def parse_tables(bk, L, out):
    for tb in L['tables']:
        kind = tb.get('kind', 'table')
        if kind == 'trouble':
            parse_table(bk, tb, out, 'trouble', 'table', meta_cols=(1,), text_cols=[2])
            continue
        group = title_case(bk.lines[tb['name_line']].strip())
        parse_table(bk, tb, out, 'table', group, meta_cols=tuple(tb.get('meta_cols', [])),
                    text_cols=tb.get('text_cols'), vis=tb.get('vis', 'crew'))
    # derive numeric harm for weapon rows
    for r in out:
        if r['kind'] == 'table':
            m = re.match(r'^(\d+)-harm\b', r['text'])
            if m and 'harm=' not in r['meta']:
                r['meta'] = (r['meta'] + ' ' if r['meta'] else '') + f'harm={m.group(1)}'


# --------------------------------------------------------------------- P3 --
RIGHT_HEAD_RE = re.compile(r'^\s*([A-Z][A-Z ]+[A-Z]):?\s*$')


def entity_name_lines(left):
    """Leading name lines of an entity block (first line always)."""
    nb = [v for v in left if v.text.strip()]
    names = [nb[0].text.strip()] if nb else []
    for v in nb[1:3]:
        s = v.text.strip()
        words = re.findall(r"[^\W\d_][\w’'\-]*", s)
        long_words = [w for w in words if len(w) > 3]
        if (names[-1].endswith(',') or
                (words and all(w[0].isupper() for w in long_words) and words[-1][0].isupper()
                 and not re.search(r'[.;:!?]$', s) and len(s) <= 40)):
            names.append(s)
        else:
            break
    return names


def entity_record(bk, sp):
    a, b = sp['a'], sp['b']
    left = [v for v in bk.seg(a, b, 'L') if v.text.strip()]
    right = [v for v in bk.seg(a, b, 'R')]
    names = entity_name_lines(left)
    body = left[len(names):]
    parts = []
    t = bk.render(body, box=True)
    if t:
        parts.append(t)
    sub, cur = [], None
    for v in right:
        m = RIGHT_HEAD_RE.match(v.text) if v.text.strip() else None
        if m and not BULLET_RE.match(v.text):
            cur = [v.text.strip(), []]
            sub.append(cur)
        elif cur is not None:
            cur[1].append(v)
        elif v.text.strip():
            cur = ['', [v]]
            sub.append(cur)
    for head, lines in sub:
        rt = bk.render(lines)
        parts.append((f'**{head}**\n\n' if head else '') + rt)
    name = ' '.join(names)
    return name, '\n\n'.join(p for p in parts if p), [a, src_of(left + right)[1]]


def parse_locations9(bk, L, out):
    a, b = L['locations9']
    for sp in L['splits']:
        if sp.get('entity') == 'place' and a <= sp['a'] <= b:
            name, text, src = entity_record(bk, sp)
            out.append(rec('location', 'locations', name, text, src, 'ch=9', 'gm'))


def parse_world(bk, L, out):
    W = L['world']
    a, b = W['range']
    la, lb = W['locations']
    locs = [v for v in bk.seg(la, lb) if v.src not in
            set(x for r in W.get('boxes', []) for x in range(r[0], r[1] + 1))]
    loc_src = set()
    pre, groups = group_by_start(locs, BULLET_RE)
    for g in groups:
        g2 = strip_marker(g, MARK_RE)
        text = bk.join_parts([v.text for v in g2 if v.text.strip()])
        m = re.match(r'^([A-Z][A-Z’\' \-]+[A-Z]),\s+', text)
        if not m:
            continue
        loc_src.update(v.src for v in g)
        out.append(rec('location', 'locations', m.group(1), text[m.end():], src_of(g), 'ch=1', 'crew'))
    parse_prose(bk, a, b, 'world', 'world', 'crew', out, exclude=loc_src,
                boxes=W.get('boxes', []), keep_examples=True, group_by_caps=True,
                meta_extra={'ch': 1})
    a, b = W['toolbox']
    parse_prose(bk, a, b, 'world', 'world', 'gm', out, boxes=W.get('toolbox_boxes', []),
                keep_examples=True, group_by_caps=True, meta_extra={'ch': 9})


def gname(caps):
    ws = [w[:1] + w[1:].lower() for w in caps.split()]
    return ' '.join(w.lower() if i and w.lower() in ('of', 'the', 'and', 'a', 'an') else w
                    for i, w in enumerate(ws))


def parse_codex(bk, L, out):
    C = L['codex']
    a, b = C['range']
    ents = [sp for sp in L['splits'] if sp.get('entity') and a <= sp['a'] <= b]
    ent_lines = set(x for sp in ents for x in range(sp['a'], sp['b'] + 1))
    vls = [v for v in bk.seg(a, b) if v.src not in ent_lines]
    secs = prose_sections(bk, vls)
    # factions: a caps heading directly preceded by a body-less title heading
    starts = []
    for k, sec in enumerate(secs):
        if (sec.get('kind') == 'caps' and k > 0 and secs[k - 1].get('kind') == 'title'
                and not [v for v in secs[k - 1]['lines'] if v.text.strip()]):
            starts.append((sec['head'].src, sec['name'], secs[k - 1]['name']))

    intro = next((gname(sec['name']) for sec in secs if sec.get('kind') == 'caps'), 'Codex')

    def faction_at(src):
        cur = (None, intro, None)
        for st in starts:
            if st[0] <= src:
                cur = st
        return cur

    for sec in secs:
        body = [v for v in sec['lines'] if v.text.strip()]
        if not body:
            continue
        src0 = sec['head'].src if sec['head'] else body[0].src
        st = faction_at(src0)
        grp = gname(st[1]) if st[0] else st[1]
        is_intro = st[0] == src0
        meta = {'type': 'faction' if is_intro else 'section'}
        if st[2]:
            meta['power'] = re.sub(r'^The\s+', '', st[2])
        out.append(rec('faction', grp, sec['name'] or grp, bk.render(sec['lines']),
                       [src0, src_of(body)[1]], meta_str(**meta), 'gm'))
    caps_heads = [(sec['head'].src, sec['name']) for sec in secs
                  if sec.get('kind') == 'caps' and sec['head'] is not None]
    for sp in ents:
        name, text, src = entity_record(bk, sp)
        st = faction_at(sp['a'])
        grp = gname(st[1]) if st[0] else st[1]
        prev = [h for h in caps_heads if h[0] < sp['a']]
        word = prev[-1][1].split()[-1].lower() if prev else sp['entity']
        word = {'characters': 'npc', 'character': 'npc'}.get(word, word.rstrip('s'))
        meta = {'type': word}
        if st[2]:
            meta['power'] = re.sub(r'^The\s+', '', st[2])
        out.append(rec('faction', grp, name, text, src, meta_str(**meta), 'gm'))


# -------------------------------------------------------------------- main --
def main(argv):
    args = [a for a in argv[1:] if not a.startswith('--')]
    book_path, outdir = args[0], Path(args[1])
    handport = None
    if '--handport' in argv:
        handport = parse_handport(argv[argv.index('--handport') + 1])
        args = [a for a in args if a != argv[argv.index('--handport') + 1]]
    L = json.loads((HERE / 'layout.json').read_text())
    bk = Book(book_path, L)
    out, log = [], {}
    parse_moves(bk, L, out, log, handport)
    parse_procedures(bk, L, out)
    parse_advances(bk, L, out)
    parse_specials(bk, L, out)
    for spec in L['pirate_playbooks']:
        parse_playbook(bk, L, spec, out)
    for spec in L['ship_playbooks']:
        parse_playbook(bk, L, spec, out, ship=True)
    parse_tags(bk, L, out)
    parse_tables(bk, L, out)
    # ---- P2
    parse_fates(bk, L, out)
    parse_rules(bk, L, out)
    parse_traits(bk, L, out)
    parse_example_oddities(bk, L, out)
    # ---- P3
    parse_world(bk, L, out)
    parse_locations9(bk, L, out)
    parse_codex(bk, L, out)
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / 'rules.json').write_text(json.dumps(out, ensure_ascii=False, indent=1),
                                       encoding='utf-8')
    log['dehyphen_kept'] = dict(bk.dehyphen_kept)
    log['dehyphen_stem'] = dict(bk.dehyphen_stem)
    log['dehyphen_soft'] = dict(bk.dehyphen_soft)
    (outdir / 'extract_log.json').write_text(json.dumps(log, ensure_ascii=False, indent=1),
                                             encoding='utf-8')
    print(f'{len(out)} records -> {outdir / "rules.json"}')


if __name__ == '__main__':
    main(sys.argv)
