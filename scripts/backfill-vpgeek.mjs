// One-off: import historic stake/maturity changes from vpGeek (shuts down 2026-12-31) into neurons/<id>.json.
// Only known or public neurons (or ids passed in IDS) — private neurons are never published.
// Polite: sequential, ~1 request/s.
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { idlFactory } from '../src/declarations/nns_governance.idl.js';

const opt = (o) => (o && o.length ? o[0] : undefined);
const ST = { NotDissolving: 1, Dissolving: 2, Dissolved: 3 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b) => Math.abs(a - b) < 1e-4;

const agent = await HttpAgent.create({ host: 'https://icp-api.io' });
const gov = Actor.createActor(idlFactory, { agent, canisterId: 'rrkah-fqaaa-aaaaa-aaaaq-cai' });

let ids = (process.env.IDS ?? '').split(/[\s,]+/).filter((x) => /^\d{1,20}$/.test(x));
if (!ids.length) {
  const k = await gov.list_known_neurons();
  ids = k.known_neurons.map((x) => String(opt(x.id)?.id)).filter((x) => /^\d{1,20}$/.test(x));
}
console.log('neurons', ids.length);

let total = 0;
for (const id of ids) {
  const r = await gov.get_neuron_info(BigInt(id)).catch(() => null);
  const n = r && 'Ok' in r ? r.Ok : null;
  if (!n || (opt(n.visibility) !== 2 && !opt(n.known_neuron_data))) { console.log(id, 'skip (private or missing)'); continue; }

  let data;
  try {
    const res = await fetch(`https://api.vpgeek.app/api/1/neuron/${id}/changes`, { headers: { Accept: 'application/json', 'User-Agent': 'wtn-watch-backfill (github.com/mar-k79/wtn-watch)' } });
    if (!res.ok) { console.log(id, 'vpgeek', res.status); await sleep(1500); continue; }
    data = (await res.json()).data ?? [];
  } catch (e) { console.log(id, 'fetch failed', e.message); await sleep(1500); continue; }

  const rows = data.filter((x) => String(x.neuronId) === id && x.updateTimeMillis).sort((a, b) => a.updateTimeMillis - b.updateTimeMillis);
  const old = [];
  for (const x of rows) {
    const t = Math.floor(x.updateTimeMillis / 1000);
    const s = { t, stake: Number(x.stake) / 1e8, maturity: null, staked: Number(x.maturityStake ?? 0) / 1e8, vp: 0, dd: Number(x.dissolveDelaySeconds ?? 0), state: ST[x.neuronStateType] ?? 0 };
    const prev = old[old.length - 1];
    if (x.previousMaturityStake != null && (!prev || !near(prev.staked, x.previousMaturityStake / 1e8)))
      old.push({ ...(prev ?? s), t: t - 1, staked: x.previousMaturityStake / 1e8 });
    old.push(s);
  }

  const file = `neurons/${id}.json`;
  const a = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { neuron: id, since: Math.floor(Date.now() / 1000), snaps: [] };
  const seen = new Set(a.snaps.map((x) => x.t));
  const add = old.filter((x) => !seen.has(x.t));
  a.snaps = [...a.snaps, ...add].sort((x, y) => x.t - y.t).slice(-5000);
  if (add.length) {
    a.since = Math.min(a.since, a.snaps[0].t);
    a.backfill = 'vpgeek';
    a.name = opt(n.known_neuron_data)?.name ?? a.name;
    writeFileSync(file, JSON.stringify(a) + '\n');
  }
  total += add.length;
  console.log(id, a.name ?? '', 'vpgeek rows', rows.length, '→ added', add.length);
  await sleep(1000);
}
console.log('total added', total);
