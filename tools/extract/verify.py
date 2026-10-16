#!/usr/bin/env python3
"""Verify rules.json against the book text dump.

Usage:
    python3 -I verify.py BOOK.txt OUTDIR

Reads OUTDIR/rules.json (and OUTDIR/extract_log.json if present) and writes
OUTDIR/verify.json, OUTDIR/report.md and OUTDIR/proof.html.  Contains no book
text; everything shown in the outputs is read from the inputs at runtime.
"""
import html
import importlib.util
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True      # keep the repo free of __pycache__
_spec = importlib.util.spec_from_file_location('rx_extract', HERE / 'extract.py')
X = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(X)

QUOTES = {'\u2019': "'", '\u2018': "'", '\u201c': '"', '\u201d': '"',
          '\u2013': '\u2014', '\u2014': '\u2014'}
DROP = set('-*~^\x8a\x84\u25a0\uf046\ufeff\u200b\u2022')


def norm_pairs(pairs):
    """Normalise a sequence of (char, src) pairs; returns (string, srcmap)."""
    out, src = [], []
    for ch, s in pairs:
        ch = QUOTES.get(ch, ch)
        if ch in DROP:
            continue
        if ch.isspace():
            if not out or out[-1] in (' ', '\u2014'):
                continue
            out.append(' ')
            src.append(s)
            continue
        if ch == '\u2014' and out and out[-1] == ' ':
            out.pop()
            src.pop()
        low = ch.lower()
        if len(low) != 1:
            low = ch
        out.append(low)
        src.append(s)
    while out and out[-1] == ' ':
        out.pop()
        src.pop()
    return ''.join(out), src


def norm(s):
    return norm_pairs((c, 0) for c in s)[0].strip()


def strip_markup(text):
    t = re.sub(r'^\s*(?:- |\[[ x]\] )', '', text, flags=re.M)
    return t


def book_norm(bk):
    """Normalised, footer-stripped, de-interleaved book with a src map."""
    pairs = []
    prev_hyph = False
    for v in bk.stream:
        t = v.text
        if not t.strip():
            if not prev_hyph:          # a hyphenated word may straddle a blank line
                pairs.append(('\n', v.src))
            continue
        m = X.BULLET_RE.match(t)
        if m:
            t = m.group(3)
        m = X.MOVE_ITEM_RE.match(t)
        if m:
            t = t[m.end():]
        t = t.strip()
        if pairs and not prev_hyph:
            pairs.append((' ', v.src))
        pairs.extend((c, v.src) for c in t)
        prev_hyph = t.endswith('-')
    return norm_pairs(pairs)


def tokens_with_pos(s):
    return [(m.start(), m.end()) for m in re.finditer(r"[a-z0-9']+", s)]


def main(argv):
    book_path, outdir = argv[1], Path(argv[2])
    L = json.loads((HERE / 'layout.json').read_text())
    bk = X.Book(book_path, L)
    R = json.loads((outdir / 'rules.json').read_text(encoding='utf-8'))
    try:
        log = json.loads((outdir / 'extract_log.json').read_text(encoding='utf-8'))
    except OSError:
        log = {}
    B, bsrc = book_norm(bk)

    # 1. substring check ---------------------------------------------------
    fails = []
    para_level = []
    covered = bytearray(len(B))
    placed = {}
    for i, r in enumerate(R):
        t = norm(strip_markup(r['text']))
        if not t:
            continue
        a, b = r['src']
        best = None
        pos = B.find(t)
        while pos >= 0:
            s = bsrc[pos]
            d = 0 if a - 3 <= s <= b + 3 else min(abs(s - a), abs(s - b))
            if best is None or d < best[0]:
                best = (d, pos)
            if d == 0:
                break
            pos = B.find(t, pos + 1)
        if best is None:
            # records that omit skipped examples/sidebars between paragraphs:
            # every paragraph must be verbatim, in order, inside the src window
            paras = [norm(strip_markup(p)) for p in re.split(r'\n\s*\n', r['text'])]
            paras = [p for p in paras if p]
            lo = next((k for k, s in enumerate(bsrc) if s >= a - 3), 0)
            hi = max((k for k, s in enumerate(bsrc) if s <= b + 3), default=len(B) - 1)
            pos, ok, spans = lo, True, []
            for p in paras:
                q = B.find(p, pos, hi + 1)
                if q < 0:
                    ok = False
                    break
                spans.append((q, q + len(p)))
                pos = q + len(p)
            if ok and len(paras) > 1:
                para_level.append(i)
                placed[i] = spans[0][0]
                for q0, q1 in spans:
                    for k in range(q0, q1):
                        covered[k] = 1
                continue
        if best is None:
            # locate the first diverging point (longest prefix found near src)
            lo, hi = 0, len(t)
            wl = next((k for k, s in enumerate(bsrc) if s >= a - 3), 0)
            wh = max((k for k, s in enumerate(bsrc) if s <= b + 3), default=len(B) - 1)
            while lo < hi:
                mid = (lo + hi + 1) // 2
                if B.find(t[:mid], wl, wh + 1) >= 0:
                    lo = mid
                else:
                    hi = mid - 1
            k = lo
            fails.append({'id': i, 'kind': r['kind'], 'group': r['group'],
                          'name': r['name'], 'src': r['src'],
                          'matched_prefix': t[:k][-60:], 'next': t[k:k + 80]})
            continue
        placed[i] = best[1]
        for k in range(best[1], best[1] + len(t)):
            covered[k] = 1
    # names and quoted meta values located near the record also count as covered
    starts = {}
    for k, sline in enumerate(bsrc):
        starts.setdefault(sline, k)
    srcs_sorted = sorted(starts)
    import bisect

    def window(a, b):
        i0 = bisect.bisect_left(srcs_sorted, a - 3)
        i1 = bisect.bisect_right(srcs_sorted, b + 3)
        lo = starts[srcs_sorted[i0]] if i0 < len(srcs_sorted) else len(B)
        hi = starts[srcs_sorted[i1]] if i1 < len(srcs_sorted) else len(B)
        return lo, hi
    for i, r in enumerate(R):
        lo, hi = window(*r['src'])
        vals = [r['name']] + [m.group(2) for m in re.finditer(r'(\w+)="?([^" ]*(?:"|$)?)', r['meta'])
                              if m.group(1) not in ('specials', 'cols')]
        vals += [m.group(1) for m in re.finditer(r'\w+="([^"]*)"', r['meta'])]
        for val in vals:
            t = norm(val.strip('"'))
            if len(t) < 2:
                continue
            q = B.find(t, lo, hi)
            if q >= 0:
                for k in range(q, q + len(t)):
                    covered[k] = 1
    # meta values quoted from the text (e.g. endpoint) must also be verbatim
    meta_fails = []
    for i, r in enumerate(R):
        for m in re.finditer(r'(\w+)="([^"]*)"', r['meta']):
            if m.group(1) in ('specials', 'cols'):
                continue
            if norm(m.group(2)) not in B:
                meta_fails.append({'id': i, 'key': m.group(1), 'value': m.group(2)})

    # 2. coverage ------------------------------------------------------------
    skip = set()
    for s in L.get('skip', []):
        skip.update(range(s['a'], s['b'] + 1))
    gaps = []
    for tgt in L.get('coverage', []):
        a, b = tgt['a'], tgt['b']
        run = []
        for (s, e) in tokens_with_pos(B):
            src = bsrc[s]
            inside = a <= src <= b and src not in skip
            if inside and not any(covered[s:e]):
                run.append((s, e, src))
                continue
            if len(run) >= 8:
                gaps.append({'target': tgt.get('name', f'{a}-{b}'),
                             'lines': [run[0][2], run[-1][2]], 'words': len(run),
                             'text': B[run[0][0]:run[-1][1]][:160]})
            run = []
        if len(run) >= 8:
            gaps.append({'target': tgt.get('name', f'{a}-{b}'),
                         'lines': [run[0][2], run[-1][2]], 'words': len(run),
                         'text': B[run[0][0]:run[-1][1]][:160]})

    # 3. counts ------------------------------------------------------------------
    by_kind = Counter(r['kind'] for r in R)
    checks = []

    def check(label, ok, detail=''):
        checks.append({'check': label, 'ok': bool(ok), 'detail': detail})

    mv = Counter(r['group'] for r in R if r['kind'] == 'move')
    check('ch.5 moves = 26 (9/3/5/9)',
          sum(mv.values()) == 26 and [mv['basic'], mv['special'], mv['ship'], mv['downtime']] == [9, 3, 5, 9],
          dict(mv))
    pirates = [r['group'] for r in R if r['kind'] == 'playbook' and 'type=pirate' in r['meta']]
    ships = [r['group'] for r in R if r['kind'] == 'playbook' and 'type=ship' in r['meta']]
    check('9 pirate playbooks', len(pirates) == 9, ', '.join(pirates))
    check('3 ship playbooks', len(ships) == 3, ', '.join(ships))
    per = defaultdict(Counter)
    for r in R:
        per[r['group']][r['kind']] += 1
        if r['kind'] == 'pmove':
            per[r['group']]['start' if 'start=1' in r['meta'] else 'adv'] += 1
    for pb in pirates:
        c = per[pb]
        want_v = 4 if any('matelot=1' in r['meta'] for r in R if r['group'] == pb and r['kind'] == 'vice') else 1
        ok = (c['vice'] == want_v and c['oddity'] == 3 and
              sum(1 for r in R if r['group'] == pb and r['kind'] == 'kit' and 'extra=1' not in r['meta']) == 3
              and c['lastwords'] == 1 and c['question'] >= 3 and c['start'] >= 1 and c['pnote'] == 1)
        check(f'pirate playbook {pb}', ok,
              f"vice={c['vice']} oddity={c['oddity']} kit={c['kit']} lastwords={c['lastwords']} "
              f"questions={c['question']} start={c['start']} adv={c['adv']} pnote={c['pnote']} rule={c['rule']}")
    for pb in ships:
        c = per[pb]
        ok = (c['oddity'] == 3 and c['kit'] >= 3 and c['smove'] == 1 and c['question'] >= 3
              and c['renown'] == 5 and c['pnote'] == 2)
        check(f'ship playbook {pb}', ok,
              f"oddity={c['oddity']} kit={c['kit']} smove={c['smove']} questions={c['question']} "
              f"renown={c['renown']} pnote={c['pnote']}")
    check('17 specials', by_kind['special'] == 17, by_kind['special'])
    check('10 troubles', by_kind['trouble'] == 10, by_kind['trouble'])
    check('4 generic advances', by_kind['advance'] == 4, by_kind['advance'])
    fm = sum(1 for r in R if r['kind'] == 'fate' and r['group'] == 'move' and 'intro=1' not in r['meta'])
    check('13 Fate moves (P2)', fm == 13, fm)
    fm3 = [r['name'] for r in R if r['kind'] == 'fate' and r['group'] == 'move' and 'intro=1' not in r['meta']
           and len(re.findall(r'^- ', r['text'], re.M)) != 3]
    check('each Fate move has 3 example bullets (P2)', fm and not fm3, ', '.join(fm3))
    ap = sum(1 for r in R if r['kind'] == 'fate' and r['group'] == 'appropriate')
    check('APPROPRIATE FATES MOVES lists = 9 (P2)', ap == 9, ap)
    bad = [i for i, r in enumerate(R) if set(r) != {'kind', 'group', 'name', 'text', 'meta', 'vis', 'src'}
           or r['vis'] not in ('crew', 'gm')]
    check('schema keys / vis values', not bad, bad[:20])

    res = {'counts': dict(by_kind), 'substring_failures': fails, 'meta_failures': meta_fails,
           'paragraph_level': [{'id': i, 'kind': R[i]['kind'], 'group': R[i]['group'],
                                'name': R[i]['name']} for i in para_level],
           'coverage_gaps': gaps, 'checks': checks}
    (outdir / 'verify.json').write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding='utf-8')
    write_report(outdir, R, res, log, L, bk.words)
    write_proof(outdir, R, bk, fails, set(para_level))
    print(f"records={len(R)} substring_failures={len(fails)} paragraph_level={len(para_level)} meta_failures={len(meta_fails)} "
          f"coverage_gaps={len(gaps)} checks_failed={sum(not c['ok'] for c in checks)}")


def write_report(outdir, R, res, log, L, words=frozenset()):
    by_kind = Counter(r['kind'] for r in R)
    lines = ['# Rules extraction report', '']
    lines.append(f'Records: **{len(R)}**')
    lines.append('')
    lines.append('## Counts by kind')
    lines.append('')
    lines.append('| kind | count | groups |')
    lines.append('|---|---:|---|')
    for k, n in sorted(by_kind.items(), key=lambda x: -x[1]):
        groups = Counter(r['group'] for r in R if r['kind'] == k)
        g = ', '.join(f'{a} {b}' for a, b in sorted(groups.items()))
        lines.append(f'| {k} | {n} | {g[:300]} |')
    lines.append('')
    lines.append('## Structural checks')
    lines.append('')
    for c in res['checks']:
        lines.append(f"- {'PASS' if c['ok'] else 'FAIL'}: {c['check']} \u2014 {c['detail']}")
    lines.append('')
    lines.append(f"## Substring check: {len(res['substring_failures'])} failure(s)")
    lines.append('')
    for f in res['substring_failures']:
        lines.append(f"- #{f['id']} {f['kind']}/{f['group']}/{f['name']} src={f['src']}: "
                     f"diverges after `\u2026{f['matched_prefix']}` \u2192 `{f['next']}\u2026`")
    if res['paragraph_level']:
        lines.append('')
        lines.append(f"{len(res['paragraph_level'])} record(s) pass at paragraph level only (each paragraph verbatim and "
                     "in order; skipped examples/sidebars sit between paragraphs in the book): "
                     + ', '.join(f"#{p['id']} {p['group']}/{p['name']}" for p in res['paragraph_level']))
    if res['meta_failures']:
        lines.append('')
        lines.append(f"Meta values not found verbatim: {len(res['meta_failures'])}")
        for f in res['meta_failures']:
            lines.append(f"- #{f['id']} {f['key']}={f['value']}")
    lines.append('')
    lines.append(f"## Coverage: {len(res['coverage_gaps'])} uncovered run(s) of 8+ words")
    lines.append('')
    for g in res['coverage_gaps']:
        lines.append(f"- [{g['target']}] lines {g['lines'][0]}-{g['lines'][1]} ({g['words']} words): `{g['text'][:120]}\u2026`")
    lines.append('')
    lines.append('Skip ranges (deliberately excluded commentary/examples) are listed in layout.json `skip`: '
                 f"{len(L.get('skip', []))} ranges.")
    hp = log.get('handport', [])
    if hp:
        lines.append('')
        lines.append('## Hand-ported move markup (git 47113be nexa.html)')
        lines.append('')
        for h in hp:
            lines.append(f"- {h['group']}/{h['name']}: **{h['status']}**")
            if h['status'] == 'differs':
                o, t = h['ours'], h['theirs']
                k = 0
                while k < min(len(o), len(t)) and o[k] == t[k]:
                    k += 1
                lines.append(f"  - first difference at char {k}: book `\u2026{o[max(0, k - 40):k + 60]}` vs hand-port `\u2026{t[max(0, k - 40):k + 60]}`")
    if log.get('dehyphen_kept') or log.get('dehyphen_stem'):
        lines.append('')
        lines.append('## De-hyphenation')
        lines.append('')
        lines.append('Line-end hyphens are removed when the joined word occurs elsewhere in the book. '
                     'Second tier (flag for review): removed when an inflected form\'s stem occurs elsewhere: '
                     + ', '.join(f'`{k}`' for k in sorted(log.get('dehyphen_stem', {}))) + '.')
        lines.append('')
        kept = sorted(log.get('dehyphen_kept', {}))
        soft = [k for k in kept if any(p.lower() not in words for p in k.split('-'))]
        comp = [k for k in kept if k not in soft]
        lines.append('Kept as written because the joined word occurs nowhere else in the book '
                     '(human judgement needed):')
        lines.append('')
        lines.append(f'- probably soft line-break hyphens (a fragment is not a word elsewhere), {len(soft)}: '
                     + ', '.join(f'`{k}`' for k in soft))
        lines.append(f'- probably real compounds (both parts are words), {len(comp)}: '
                     + ', '.join(f'`{k}`' for k in comp))
    notes = outdir / 'notes.md'
    if notes.exists():
        lines.append('')
        lines.append(notes.read_text(encoding='utf-8').rstrip())
    (outdir / 'report.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')


def vis_glyphs(s):
    return (s.replace(X.G_BULLET, '\u2023').replace(X.G_CHECK, '\u2610')
            .replace(X.G_HEAD, '\u2766').replace('\x0c', '').replace('\ufeff', ''))


def write_proof(outdir, R, bk, fails, para=frozenset()):
    failed = {f['id'] for f in fails}
    css = """
:root{--bg:#fbfaf7;--fg:#1f1d1a;--muted:#6b665e;--line:#e3ded4;--card:#fff;--bad:#b3261e;--ok:#2e7d32;--src:#f3f0e8}
@media (prefers-color-scheme: dark){:root{--bg:#161513;--fg:#ece8e1;--muted:#a39d93;--line:#34312c;--card:#1e1d1a;--bad:#ff8a80;--ok:#81c784;--src:#24221e}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
header{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 16px;z-index:2}
input{width:min(420px,100%);padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
main{padding:12px 16px}
.r{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px;margin:0 0 10px}
@media (max-width:800px){.r{grid-template-columns:minmax(0,1fr)}}
.h{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.h b{font-size:15px}.k{color:var(--muted);font-size:12px}
.bad{color:var(--bad);font-weight:600}.ok{color:var(--ok)}
.t{white-space:pre-wrap;overflow-wrap:anywhere}
pre{margin:0;background:var(--src);padding:8px;border-radius:6px;overflow-x:auto;font:12px/1.35 ui-monospace,monospace}
nav a{margin-right:10px;color:var(--muted)}
"""
    out = ['<!doctype html><html lang="en"><head><meta charset="utf-8">',
           '<meta name="viewport" content="width=device-width,initial-scale=1">',
           '<title>Rules Extraction Proof</title><style>', css, '</style></head><body>',
           '<header><input id="q" placeholder="filter by kind / group / name" oninput="f()"> ',
           f'<span class="k">{len(R)} records, {len(failed)} substring failure(s)</span></header><main>']
    for i, r in enumerate(R):
        a, b = r['src']
        a0, b0 = max(1, a), min(bk.n, max(a, b))
        if b0 - a0 > 80:
            b0 = a0 + 80
        src = '\n'.join(f'{k:5d} {vis_glyphs(bk.raw[k])}' for k in range(a0, b0 + 1))
        st = ('<span class="bad">NOT VERBATIM</span>' if i in failed else
              '<span class="ok">verbatim per paragraph</span>' if i in para else
              '<span class="ok">verbatim</span>')
        key = html.escape(f"{r['kind']} {r['group']} {r['name']}".lower())
        out.append(f'<section class="r" data-k="{key}"><div class="h"><b>{html.escape(r["name"])}</b>'
                   f'<span class="k">#{i} {html.escape(r["kind"])} / {html.escape(r["group"])} \u00b7 {r["vis"]} \u00b7 '
                   f'{html.escape(r["meta"])} \u00b7 src {a}-{b}</span>{st}</div>'
                   f'<div class="t">{html.escape(r["text"])}</div><pre>{html.escape(src)}</pre></section>')
    out.append('</main><script>function f(){const q=document.getElementById("q").value.toLowerCase();'
               'document.querySelectorAll("section.r").forEach(s=>{s.style.display=s.dataset.k.includes(q)?"":"none"})}'
               '</script></body></html>')
    (outdir / 'proof.html').write_text('\n'.join(out), encoding='utf-8')


if __name__ == '__main__':
    main(sys.argv)
