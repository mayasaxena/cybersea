import test from 'node:test';
import assert from 'node:assert/strict';
import { inline, md, toggleCheck, plain } from '../assets/markup.js';

test('inline emphasis', () => {
  assert.equal(inline('When you *poke*, roll +VINEGAR.'), 'When you <b class="t">poke</b>, roll +<b class="s">VINEGAR</b>.');
  assert.equal(inline('**Bold:** and ~tag~ and ^soft^'), '<b>Bold:</b> and <b class="k">tag</b> and <i>soft</i>');
  assert.equal(inline('climbing gear*, rope*, lantern'), 'climbing gear*, rope*, lantern', 'heavy-item stars stay plain');
  assert.equal(inline('5 * 3 * 2'), '5 * 3 * 2');
  assert.equal(inline('<script>&'), '&lt;script&gt;&amp;');
  assert.equal(inline('^a (~b~) c^'), '<i>a (<b class="k">b</b>) c</i>');
});

test('paragraphs and an intro line followed directly by bullets', () => {
  assert.equal(md('First line\ncontinues.\n\nSecond.'), '<p>First line continues.</p><p>Second.</p>');
  assert.equal(md('Pick one:\n- a\n- b\nAfter.'), '<p>Pick one:</p><ul><li>a</li><li>b</li></ul><p>After.</p>');
});

test('nested lists and wrapped list lines', () => {
  assert.equal(md('- Dagger,\n  - rusty\n  - old\n- Cloak'), '<ul><li>Dagger,<ul><li>rusty</li><li>old</li></ul></li><li>Cloak</li></ul>');
  assert.equal(md('- a long item\n  that wraps\n- next'), '<ul><li>a long item that wraps</li><li>next</li></ul>');
});

test('checklists are numbered and keep their state', () => {
  const src = 'Mark two.\n\n[x] one\n[ ] two\n[X] three';
  assert.equal(md(src), '<p>Mark two.</p><ul class="ck"><li data-ck="0" class="on">one</li><li data-ck="1">two</li><li data-ck="2" class="on">three</li></ul>');
  assert.equal(toggleCheck(src, 1), 'Mark two.\n\n[x] one\n[x] two\n[X] three');
  assert.equal(toggleCheck(src, 0), 'Mark two.\n\n[ ] one\n[ ] two\n[X] three');
  assert.equal(toggleCheck(src, 9), src);
});

test('a bullet list switching to a checklist at the same depth', () => {
  assert.equal(md('- a\n[ ] b'), '<ul><li>a</li></ul><ul class="ck"><li data-ck="0">b</li></ul>');
});

test('plain strips markup for search', () => {
  assert.equal(plain('**Bold:** *x* ~y~ ^z^\n- one\n[x] two'), 'Bold: x y z one two');
  assert.equal(md(''), '');
  assert.equal(md(null), '');
});
