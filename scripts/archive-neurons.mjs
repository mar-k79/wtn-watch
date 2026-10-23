// Hourly snapshot of NNS neurons → neurons/<id>.json (append only when stake/maturity/delay/state change).
// Neurons: neurons/watch.json + all known neurons + neurons opened in WTN Watch (worker /tracked).
// Query calls only — costs no cycles. NNS keeps no per-neuron history, so this builds the rewards history.
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { sha224 } from '@noble/hashes/sha2.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { idlFactory } from '../src/declarations/nns_governance.idl.js';

const GOV = 'rrkah-fqaaa-aaaaa-aaaaq-cai';
const WORKER = 'https://wtn-explain.wtnwatch.workers.dev';
const opt = (o) => (o && o.length ? o[0] : undefined);
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const accountId = (owner, sub) => {
  const h = sha224(new Uint8Array([...new TextEncoder().encode('\x0Aaccount-id'), ...owner.toUint8Array(), ...sub]));
  const c = crc32(h);
  return [c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255, ...h].map((x) => x.toString(16).padStart(2, '0')).join('');
};
const ID = /^\d{1,20}$/;

const agent = await HttpAgent.create({ host: 'https://icp-api.io' });
const gov = Actor.createActor(idlFactory, { agent, canisterId: GOV });

// watch.json: ["<id>", …] or [{ "id": "<id>", "account": "<64-hex, for private neurons>" }, …]
const accounts = new Map();
const ids = new Set();
const watchIds = new Set();
for (const x of JSON.parse(readFileSync('neurons/watch.json', 'utf8'))) {
  const w = typeof x === 'string' ? { id: x } : x;
  if (!ID.test(w.id)) continue;
  ids.add(w.id);
  watchIds.add(w.id);
  if (/^[0-9a-f]{64}$/.test(w.account ?? '')) accounts.set(w.id, w.account);
}
const known = await gov.list_known_neurons().catch(() => ({ known_neurons: [] }));
for (const k of known.known_neurons) { const id = opt(k.id)?.id; if (id !== undefined) ids.add(String(id)); }
try {
  const r = await fetch(`${WORKER}/tracked`);
  if (r.ok) for (const id of (await r.json()).slice(0, 300)) if (ID.test(String(id))) ids.add(String(id));
} catch {}
const all = [...ids];
console.log('neurons', all.length);

// batch: list_neurons returns NeuronInfo for requested ids (+ full neuron when public); fall back per id
const infos = new Map(), fulls = new Map();
for (let i = 0; i < all.length; i += 50) {
  const chunk = all.slice(i, i + 50);
  const r = await gov.list_neurons({ neuron_ids: new BigUint64Array(chunk.map(BigInt)), include_public_neurons_in_full_neurons: [true], include_neurons_readable_by_caller: false, include_empty_neurons_readable_by_caller: [], neuron_subaccounts: [], page_number: [], page_size: [] }).catch(() => null);
  for (const [nid, info] of r?.neuron_infos ?? []) infos.set(String(nid), info);
  for (const f of r?.full_neurons ?? []) { const nid = opt(f.id)?.id; if (nid !== undefined) fulls.set(String(nid), f); }
}
for (const id of all) {
  if (infos.has(id)) continue;
  const r = await gov.get_neuron_info(BigInt(id)).catch(() => null);
  if (r && 'Ok' in r) infos.set(id, r.Ok);
}

const t = Math.floor(Date.now() / 1000);
const KEYS = ['stake', 'maturity', 'staked', 'dd', 'state']; // vp drifts with age every second → not a trigger
let changed = 0;
for (const id of all) {
  const n = infos.get(id);
  if (!n) continue;
  // never publish private neurons unless explicitly listed in watch.json
  if (!accounts.has(id) && !watchIds.has(id) && opt(n.visibility) !== 2 && !opt(n.known_neuron_data)) continue;
  const full = fulls.get(id);
  const file = `neurons/${id}.json`;
  const a = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { neuron: id, since: t, snaps: [] };
  if (full) a.account = accountId(Principal.fromText(GOV), new Uint8Array(full.account));
  else if (accounts.has(id)) a.account = accounts.get(id);
  a.name = opt(n.known_neuron_data)?.name ?? a.name;
  const s = {
    t,
    stake: Number(n.stake_e8s) / 1e8,
    maturity: full ? Number(full.maturity_e8s_equivalent) / 1e8 : null,
    staked: Number(opt(n.staked_maturity_e8s_equivalent) ?? 0n) / 1e8,
    vp: Math.round(Number(opt(n.deciding_voting_power) ?? n.voting_power) / 1e6) / 100,
    dd: Number(n.dissolve_delay_seconds),
    state: n.state,
  };
  const last = a.snaps[a.snaps.length - 1];
  // dissolve delay of a dissolving neuron ticks down every second → only state/large jumps count
  const diff = !last || KEYS.some((k) => (k === 'dd' ? Math.abs(s.dd - last.dd) > 86_400 && s.state === 1 : k === 'state' ? s.state !== last.state : s[k] == null || last[k] == null ? s[k] !== last[k] : Math.abs(s[k] - last[k]) >= 1e-4));
  if (!diff) continue;
  a.snaps.push(s);
  while (a.snaps.length > 3000) a.snaps.shift();
  writeFileSync(file, JSON.stringify(a) + '\n');
  changed++;
}
console.log('changed', changed);
