// Finds WTN SNS upgrade proposals whose source commit has not been built yet.
// Prints one 40-char commit per line (max 3), skipping commits attempted in the last 24 h.
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { existsSync, readFileSync } from 'node:fs';
import { idlFactory } from '../src/declarations/sns_governance.idl.js';

const GOV = 'jfnic-kaaaa-aaaaq-aadla-cai';
const opt = (o) => (o && o.length ? o[0] : undefined);

const agent = await HttpAgent.create({ host: 'https://icp-api.io' });
const gov = Actor.createActor(idlFactory, { agent, canisterId: GOV });
const r = await gov.list_proposals({
  limit: 100,
  before_proposal: [],
  exclude_type: new BigUint64Array(),
  include_reward_status: new Int32Array(),
  include_status: new Int32Array(),
  include_topics: [],
});

const queue = existsSync('builds/queue.json') ? JSON.parse(readFileSync('builds/queue.json', 'utf8')) : {};
const DAY = 86_400_000;
const out = [];
for (const p of r.proposals) {
  const prop = opt(p.proposal);
  const action = opt(prop?.action);
  if (!action || !('UpgradeSnsControlledCanister' in action)) continue;
  const commits = [...new Set((prop.summary ?? '').match(/\b[0-9a-f]{40}\b/g) ?? [])];
  for (const c of commits) {
    if (existsSync(`builds/${c}.json`)) continue;
    if (queue[c] && Date.now() - queue[c] < DAY) continue;
    if (!out.includes(c)) out.push(c);
  }
}
console.log(out.slice(0, 3).join('\n'));
