// A made-up game for tests and the dev server. All "rules" text here is invented
// placeholder prose; the real rulebook text only ever lives in the spreadsheet.

const R = (kind, group, name, text, meta = '', vis = 'crew') => [kind, group, name, text, meta, vis];

// A game's own wording for a book row: [...row, Override name, Override text, Override meta].
const O = (row, oname = '', otext = '', ometa = '') => [...row, oname, otext, ometa];

export const RULES_HEADER = ['Kind', 'Group', 'Name', 'Text', 'Meta', 'Vis', 'Override name', 'Override text', 'Override meta'];
export const HEADER = ['Kind', 'Name', 'Value', 'Notes'];

export const rules = [
  R('move', 'basic', 'POKE AROUND', 'When you *poke around* somewhere odd, roll +VINEGAR. On a 10+, ask 2. On a 7-9, ask 1.\n\n- what is hidden here?\n- who is watching?'),
  R('move', 'basic', 'START TROUBLE', 'When you *start trouble*, roll +BLOOD. On a hit, deal your harm.'),
  R('move', 'basic', 'SWEET TALK', 'When you *sweet talk* someone, roll +POLISH. On a hit, they listen.'),
  R('move', 'basic', 'FLIP A COIN', 'When you *flip a coin*, pay **1-luck** and invent a helpful detail.'),
  R('move', 'special', 'CHEAT DEATH', 'When you *cheat death*, **roll blank**. ^Take -1 per scar.^'),
  R('move', 'special', 'COUNT THE LOOT', 'When your crew *counts the loot*, one of the crew rolls **1d6**.'),
  R('move', 'ship', 'RAM IT', 'When your crew *rams something*, roll +STEADFAST.'),
  R('move', 'ship', 'CHART A COURSE', 'When your crew *charts a course*, the navigator rolls +SPITFIRE.'),
  R('move', 'downtime', 'BEGIN DOWNTIME', 'When you *make port*, begin a downtime.'),
  R('move', 'downtime', 'LEAVE DOWNTIME', 'When you *set sail*, finish your downtime and **heal all harm** taken before it began.'),
  R('move', 'downtime', 'DICE GAME', 'When you play dice during downtime, roll +SPITFIRE.'),
  R('move', 'downtime', 'FIX IT UP', 'When you fix something during downtime, roll +VINEGAR.'),

  R('procedure', 'session', 'SESSION START', 'At the start of a session, luck refills up to your SPITFIRE.'),
  R('procedure', 'chapter', 'CHAPTER CLOSE', 'When a chapter closes, refresh every bond and pick two.\n\n- One experience.\n- Two luck.\n- Two harm healed.'),
  R('procedure', 'downtime', 'DOWNTIME LIMITS', 'Two downtime moves in port, one at sea.'),
  R('procedure', 'advance', 'LEVELS', 'Fill your tally to level up, then wipe it and pick an advance.'),
  R('procedure', 'experience', 'EXPERIENCE', '- Miss a roll.\n- Fill a bond.'),
  R('house', 'session', 'LUCK FLOOR', 'House rule: take at least 1 luck at session start.', 'luckfloor=1'),

  R('advance', 'all', 'Raise a trait (three times at most).', '', 'kind=trait max=3'),
  R('advance', 'all', 'Gain a bond.', '', 'kind=bond'),
  R('advance', 'all', 'Take an unmarked playbook move.', '', 'kind=move'),
  R('advance', 'all', 'Gain a new oddity.', '', 'kind=oddity'),

  R('playbook', 'Trickster', 'Trickster', 'A sly one with a passenger in their head.', 'type=pirate harm=6 luck=8 pick=0'),
  R('vice', 'Trickster', 'HAUNTED', 'While Haunted, you do as the passenger says. Endpoint: say no.'),
  R('oddity', 'Trickster', 'THIRD EYE', 'You can see secrets, at a price.', 'traits=0,-1,0,+2'),
  R('oddity', 'Trickster', 'CARD SHARP', 'You never lose at cards, almost.', 'traits=-2,+1,+1,+1'),
  R('kit', 'Trickster', 'Kit 1', 'Dagger, cloak, tarot deck'),
  R('lastwords', 'Trickster', 'Last Words', 'When you speak your last words, choose one:\n\n- Go out in fire.\n- Make one more deal.'),
  R('question', 'Trickster', '1', 'What does your passenger want?'),
  R('pmove', 'Trickster', 'SUMMON', 'Mark 2 powers. When you summon a power, spend 1-luck and roll +SPITFIRE.\n\n[ ] Shadow cloak.\n[ ] Fire burst.\n[ ] Shape change.', 'start'),
  R('pmove', 'Trickster', 'HAGGLE', 'When you haggle with your passenger, spend a bond and roll +POLISH.', 'start'),
  R('pmove', 'Trickster', 'HEX', 'Your enemy has a run of bad luck.', 'adv'),
  R('pmove', 'Trickster', 'LUCKY BREAK', 'Mark 1-luck when you end a session Haunted.', 'adv'),

  R('playbook', 'Brute', 'Brute', 'Big and loud.', 'type=pirate harm=8 luck=5 pick=1'),
  R('vice', 'Brute', 'ANGRY', 'While Angry, you hit first. Endpoint: walk away.'),
  R('oddity', 'Brute', 'IRON SKIN', 'Nothing small hurts you.', 'traits=+2,0,-1,0'),
  R('pmove', 'Brute', 'SMASH', 'When you smash something, roll +BLOOD.', 'start'),
  R('pmove', 'Brute', 'ROAR', 'When you roar, enemies flinch.', 'adv'),

  R('playbook', 'Skiff', 'Skiff', 'A small fast boat.', 'type=ship'),
  R('oddity', 'Skiff', 'PATCHED SAIL', 'It always gets there, somehow.'),
  R('kit', 'Skiff', 'Kit 1', 'Two oars, a lantern', 'traits=0,+2,+1'),
  R('smove', 'Skiff', 'SLIP AWAY', 'When the skiff slips away, roll +SPEED.'),

  R('tag', 'item', 'shiny', 'Worth more than it looks.'),
  R('tag', 'weapon', 'loud', 'Everyone hears it.'),
  R('tag', 'npc', 'jumpy', 'Startles easily.'),
  R('trouble', 'table', 'Soaked', 'Everything you carry is wet.'),
  R('fate', 'move', 'SPRING A TRAP', 'Something closes in.\n\n- The floor gives way.', '', 'gm'),
  R('fate', 'compass', 'BE CURIOUS', 'Ask questions.', '', 'gm'),
  R('table', 'Gear', 'Rope', 'A coil of rope.', 'cost=1'),

  O(R('kit', 'Brute', 'Kit 1', 'Club, sack, rope'), '', 'Club, sack, data cable'),
  O(R('location', 'locations', 'Gull Rock', 'A rock full of gulls.'), 'Packet Reef', 'A reef of lost packets.', 'img=assets/world/vega-server.jpg'),
  O(R('location', 'locations', 'Old Mill', 'A mill nobody uses.'), '', '', 'hide'),
  R('location', 'Vega Server', 'Scrap Town', 'A town of scrap.'),
  R('location', 'Vega Server', 'Hidden Dock', 'Only the GM knows.', '', 'gm'),
  R('level', 'Scrap Town', 'Level 1', 'The docks.', 'img=assets/world/hackers-haven-level-1.jpg'),
  R('level', 'Scrap Town', 'Level 2', 'The market.', 'img=assets/world/hackers-haven-level-2.jpg'),
  R('map', 'Vega Server', 'The Test Server', 'Everything, all at once.', 'img=assets/world/vega-server.jpg'),
];

export const sampleCharacter = [
  ['info', 'Name', 'Testa', ''],
  ['info', 'Playbook', 'Trickster', ''],
  ['info', 'Player', 'Sam', ''],
  ['info', 'Level', '0', ''],
  ['stat', 'Blood', '0', ''],
  ['stat', 'Vinegar', '-1', ''],
  ['stat', 'Polish', '0', ''],
  ['stat', 'Spitfire', '+2', ''],
  ['track', 'Harm', '●○○✕✕✕', ''],
  ['track', 'Luck', '●●●●○○○○', ''],
  ['track', 'Vice', '○', ''],
  ['track', 'Experience', '●●○○○○', ''],
  ['bond', 'Ship', '●●·', ''],
  ['bond', 'Passenger', '●○·', ''],
  ['sheet', 'Vice', '**Haunted:** a made-up vice for testing.', ''],
  ['sheet', 'Kit', '- Dagger\n  - rusty\n- Cloak', ''],
  ['sheet', 'Troubles', '', ''],
  ['sheet', 'Experience', '- 1 (a test)', '(6 exp = 1 advancement)'],
  ['notes', 'Story', '- Once a librarian.', ''],
  ['move', 'SUMMON', '●', 'Mark 2 powers. When you summon a power, spend 1-luck and roll +SPITFIRE.\n\n[x] Shadow cloak.\n[ ] Fire burst.\n[x] Shape change.'],
  ['move', 'HAGGLE', '●', ''],
];

export const sampleShip = [
  ['info', 'Name', 'The Gull', ''],
  ['info', 'Playbook', 'Skiff', ''],
  ['stat', 'Steadfast', '0', ''],
  ['stat', 'Speed', '+2', ''],
  ['stat', 'Fortune', '+1', ''],
  ['track', 'Wreck', '○○○', ''],
  ['track', 'Renown', '●○○○○', ''],
  ['sheet', 'Cargo', '- Crate of limes', ''],
];

// Tabs for the fake spreadsheet, as they'd be typed in (row 1 = header).
export function gameTabs({ withCharacter = true } = {}) {
  return {
    Rules: [RULES_HEADER, ...rules],
    Lore: [HEADER, ['place', 'Gull Harbor', 'A rainy port.', 'Sam']],
    GM: [HEADER, ['npc', 'Captain Vex', 'jumpy, loud', 'Owes the crew money.'], ['secret', 'Twist', 'The map is fake.', '']],
    Ship: [HEADER, ...sampleShip],
    Map: [HEADER, ['place', 'Gull Rock', 'on', 'Packet Reef'], ['place', 'Hidden Dock', 'on', '']],
    ...(withCharacter ? { Testa: [HEADER, ...sampleCharacter] } : {}),
  };
}

// Crew need no passphrase unless CREW_KEY is set; the fixture game leaves it unset.
export const KEYS = { GM_KEY: 'gm-pass' };

// Code.gs as it was at version 2 (before row versions), as a deployment that hasn't been updated
// still runs it.
export const CODE_V2 = new URL('./code-v2.gs', import.meta.url);

// Code.gs as deployed before version 2: every request needed a passphrase, and a missing one was
// answered "Wrong passphrase." Apply it to CODE_V2.
export function asOldScript(src) {
  const swap = (s, a, b) => { if (!s.includes(a)) throw new Error(`asOldScript: no ${a}`); return s.replace(a, b); };
  src = swap(src, 'const API_VERSION = 2;', 'const API_VERSION = 1;');
  src = swap(src, "if (keys.crew ? key === keys.crew : !key) return 'crew';", "if (keys.crew && key === keys.crew) return 'crew';");
  return swap(src, "if (!req.key) return { ok: false, code: 'auth', error: 'This game needs a passphrase.' };", '');
}
