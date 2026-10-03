/*
 * plan-offline.mjs: run the diorama planner end to end with a canned model, no
 * network. The canned answers are deliberately sloppy (a repeated picture, a
 * headline quoting the narration, the hook reused as scene one, a hero on a
 * type that cannot show it, bad indices) so the post-pass is exercised. The
 * result is written as a renderer fixture that selftest.mjs steps through.
 *
 *   node factory/explainer/plan-offline.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeScenes } from './scenes.mjs';
import { sceneStarts } from './render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const script = {
  hook: 'You tap pay and the bakery gets paid.',
  keyword: 'card payment',
  cta: 'Follow for what happens when it fails.',
  beats: [
    { headline: 'You tap pay.', text: 'You tap pay on your phone at the corner bakery and four hundred and fifty rupees has to move before the cashier looks up.' },
    { headline: 'Like a sealed envelope.', text: 'Think of it as a sealed envelope passed hand to hand, where every hand can read the address but nobody can open it.' },
    { headline: 'The card becomes a token.', text: 'Your phone never sends the real card number. It sends a one time token, encrypted, so a stolen copy is useless.' },
    { headline: 'Cut into packets.', text: 'The request is cut into packets, each numbered, and each stamped with the address of the payment gateway.' },
    { headline: 'Three hops away.', text: 'The packets hop from the shop terminal to the gateway to your bank, which checks the token and your balance.' },
    { headline: 'Approved in a blink.', text: 'The bank says yes in about 300 ms and the answer races back along the same path.' },
  ],
};

const bible = {
  eyebrow: 'PAYMENTS',
  people: { sender: 'Asha', receiver: 'Ravi' },
  map: { nodes: [{ label: 'Terminal', sub: 'at the counter', kind: 'mobile' }, { label: 'Gateway', sub: 'checks the token', kind: 'shield' }, { label: 'Bank', sub: 'your balance', kind: 'database' }] },
  hero: { key: 'payment', kind: 'card', label: '₹450 to Corner Bakery', bytes: '2 KB' },
  stack: { key: 'net', unit: 'LAYER', plates: [
    { label: 'APPLICATION', sub: 'the payment app' }, { label: 'SECURITY', sub: 'token and encryption' },
    { label: 'TRANSPORT', sub: 'chop and number' }, { label: 'NETWORK', sub: 'address and route' }] },
  cover: { type: 'phone', data: { app: 'pay', merchant: 'Corner Bakery', amount: '₹450.00', method: 'Card •••• 0042' } },
  journey: [1, 2, 3, 4, 5, 6].map((beat) => ({ beat, state: ['whole', 'whole', 'encrypted', 'split', 'labelled', 'whole'][beat - 1], change: 'step' })),
};

const batches = [
  { eyebrow: 'PAYMENTS', beats: [
    { beat: 1, scenes: [
      { type: 'phone', headline: 'You tap pay and the bakery gets paid.', data: { app: 'pay', merchant: 'Corner Bakery', amount: '₹450.00' }, hero: { key: 'payment', state: 'whole' } },
      { type: 'stack3d', headline: 'It starts at the top.', subhead: 'the app hands it over', data: { key: 'net', active: 0 }, hero: { key: 'payment', state: 'whole' } } ] },
    { beat: 2, scenes: [
      { type: 'compare', headline: 'Address outside, secret inside.', data: { left: { label: 'Envelope', sub: 'address visible', kind: 'file' }, right: { label: 'Letter', sub: 'sealed', kind: 'lock' }, rows: [{ left: 'anyone reads', right: 'nobody reads' }] } },
      { type: 'stack3d', headline: 'Same picture again.', data: { key: 'net', active: 0 }, hero: { key: 'payment', state: 'whole' } } ] },
    { beat: 3, scenes: [
      { type: 'stack3d', headline: 'It sends a one time token.', subhead: 'the number never leaves', data: { key: 'net', active: 1 }, hero: { key: 'payment', state: 'encrypted', glyphs: 'letters' } },
      { type: 'stat', headline: 'A stolen copy is useless.', data: { value: '0', label: 'card numbers sent', tone: 'good' }, hero: { key: 'payment', state: 'whole' } } ] },
    { beat: 4, scenes: [
      { type: 'stack3d', headline: 'Six pieces, numbered.', data: { key: 'net', active: 2 }, hero: { key: 'payment', state: 'split', n: 6 } },
      { type: 'stack3d', headline: 'Each one addressed.', data: { key: 'net', active: 9 }, hero: { key: 'payment', state: 'labelled', tag: '#{i} → gateway' } } ] },
  ] },
  { beats: [
    { beat: 5, scenes: [
      { type: 'flow', headline: 'Terminal, gateway, bank.', data: { nodes: [{ label: 'Terminal', kind: 'mobile' }, { label: 'Gateway', kind: 'shield' }, { label: 'Bank', kind: 'database' }], edge: 'packets' }, hero: { key: 'payment', state: 'labelled', tag: '#{i}' } },
      { type: 'flow', headline: 'The bank checks it.', data: { nodes: [{ label: 'Gateway', kind: 'shield' }, { label: 'Bank', kind: 'database', state: 'busy', becomes: 'ok' }], active: 1 } } ] },
    { beat: 6, scenes: [
      { type: 'stat', headline: 'Yes, in a blink.', data: { value: '300 ms', label: 'tap to approved', tone: 'plain' } },
      { type: 'list', headline: 'What it never sent.', data: { title: 'never on the wire', items: [{ label: 'your card number', tone: 'good' }, { label: 'your PIN', tone: 'good' }, { label: 'your balance', tone: 'good' }] } } ] },
  ] },
];

let call = 0;
const llm = async ({ prompt }) => JSON.stringify(/planning the visual world/.test(prompt) ? bible : batches[call++]);
const durations = [8, 9, 9, 8, 9, 8];
const notes = [];
const board = await writeScenes('what happens when you pay by card', script, {
  theme: 'diorama', llm, beatDurations: durations, category: 'security', log: (s) => notes.push(s),
});
let t = 3;
const segments = [{ kind: 'hook', duration: 3 }, ...durations.map((d) => ({ kind: 'beat', duration: d })), { kind: 'cta', duration: 3.5 }];
const { starts, titleUntil } = sceneStarts(board.scenes, segments);
t = titleUntil;
const out = path.join(HERE, 'spec.diorama-planned.json');
fs.writeFileSync(out, JSON.stringify({ ...board, starts, titleUntil: t }, null, 2) + '\n');
console.log(notes.join('\n'));
console.log(board.scenes.map((s, i) => `${String(i + 1).padStart(2)} b${s.beat} ${s.type || 'loop'} ${s.hero ? '[' + s.hero.state + ']' : ''} "${s.headline}"`).join('\n'));
console.log('wrote', path.relative(process.cwd(), out));
