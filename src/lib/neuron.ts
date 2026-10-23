import { Actor } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { sha224 } from '@noble/hashes/sha2.js';
import { idlFactory as indexIdl } from '../declarations/icp_index.idl.js';
import { nnsGov, IDS, BUILDS_REPO, EXPLAIN_URL } from './ic';
import { opt, pool } from './format';
import type { Neuron, NeuronInfo } from '../declarations/nns_governance';

/* ---------- per-browser state (never leaves this device) ---------- */
const LS_MY = 'wtn-my-neuron';
const lsGet = <T>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const lsSet = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};
export const myNeuron = (): string | undefined => lsGet<string | undefined>(LS_MY, undefined);
export const setMyNeuron = (id: string | undefined) => {
  try {
    id ? localStorage.setItem(LS_MY, JSON.stringify(id)) : localStorage.removeItem(LS_MY);
  } catch {}
};
/** merge a backup into this browser's history; returns how many new snapshots were added */
export function importSnaps(id: string, raw: unknown): number {
  const j = raw as { neuron?: unknown; snaps?: unknown };
  if (!j || j.neuron !== id || !Array.isArray(j.snaps)) throw new Error(`This file is not a backup of neuron ${id}`);
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const ok = j.snaps.filter(
    (x): x is Snap => !!x && num(x.t) && num(x.stake) && num(x.staked) && num(x.dd) && num(x.state) && (x.maturity === null || num(x.maturity)),
  );
  const cur = localSnaps(id);
  const seen = new Set(cur.map((x) => x.t));
  const add = ok.filter((x) => !seen.has(x.t)).map((x) => ({ t: x.t, stake: x.stake, maturity: x.maturity, staked: x.staked, vp: num(x.vp) ? x.vp : 0, dd: x.dd, state: x.state }));
  const merged = [...cur, ...add].sort((a, b) => a.t - b.t).slice(-5000);
  lsSet(`wtn-snaps:${id}`, merged);
  return add.length;
}

/** this browser's history (+ optional extra snapshots) as a downloadable backup */
export function exportSnaps(id: string, extra: Snap[] = []) {
  const all = [...localSnaps(id), ...extra];
  const byT = new Map(all.map((x) => [x.t, x]));
  const snaps = [...byT.values()].sort((a, b) => a.t - b.t);
  const blob = new Blob([JSON.stringify({ app: 'wtn-watch', neuron: id, exported: Math.floor(Date.now() / 1000), snaps })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `neuron-${id}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return snaps.length;
}

const LS_TOKEN = 'wtn-my-token';
export const myToken = () => lsGet<string>(LS_TOKEN, '');
export const setMyToken = (t: string) => (t ? lsSet(LS_TOKEN, t) : localStorage.removeItem(LS_TOKEN));

/** upload snapshots to the private worker history; returns added count, or null if not configured / rejected */
export async function pushMySnaps(id: string, snaps: Snap[]): Promise<number | null> {
  const t = myToken();
  if (!t || !EXPLAIN_URL || !snaps.length) return null;
  try {
    const r = await fetch(`${EXPLAIN_URL}/my`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ neuron: id, snaps }),
    });
    return r.ok ? ((await r.json()) as { added: number }).added : null;
  } catch {
    return null;
  }
}

/** private hourly history kept by the worker (KV, token-gated); null = not configured / wrong token */
export async function mySnaps(id: string): Promise<Snap[] | null> {
  const t = myToken();
  if (!t || !EXPLAIN_URL) return null;
  try {
    const r = await fetch(`${EXPLAIN_URL}/my`, { headers: { Authorization: `Bearer ${t}` }, cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { neuron: string | null; snaps: Snap[] };
    return j.neuron === id ? j.snaps : null;
  } catch {
    return null;
  }
}

/** private neurons are never published — their history is kept only in this browser, one snapshot per visit */
export function localSnaps(id: string, add?: Snap): Snap[] {
  const k = `wtn-snaps:${id}`;
  const list = lsGet<Snap[]>(k, []);
  if (add) {
    const last = list[list.length - 1];
    const near = (a: number | null, b: number | null) => a === b || (a != null && b != null && Math.abs(a - b) < 1e-4);
    const same = last && near(last.stake, add.stake) && near(last.maturity, add.maturity) && near(last.staked, add.staked) && last.state === add.state && Math.abs(last.dd - add.dd) <= 86_400;
    if (!same) {
      list.push(add);
      while (list.length > 2000) list.shift();
      lsSet(k, list);
    }
  }
  return list;
}
export const HALF_YEAR = 15_778_800; // s — min dissolve delay to vote; also the "confirm following" window

/* ---------- account identifier (sha224("\x0Aaccount-id" + owner + subaccount), crc32 prefix) ---------- */
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
export function accountId(owner: Principal, sub: Uint8Array) {
  const h = sha224(new Uint8Array([...new TextEncoder().encode('\x0Aaccount-id'), ...owner.toUint8Array(), ...sub]));
  const c = crc32(h);
  return [c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255, ...h].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** 64-hex account id with a valid crc32 prefix */
export function validAccount(a: string) {
  if (!/^[0-9a-f]{64}$/.test(a)) return false;
  const b = Uint8Array.from(a.match(/../g)!.map((h) => parseInt(h, 16)));
  return crc32(b.slice(4)) === ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
}

/* ---------- ledger flows into / out of the neuron account (ICP index, query) ---------- */
export type Flow = { id: string; t: number; amount: number; dir: 'in' | 'out'; peer: string };

async function flows(acc: string): Promise<Flow[]> {
  const { HttpAgent } = await import('@icp-sdk/core/agent');
  const idx = Actor.createActor<any>(indexIdl, { agent: await HttpAgent.create({ host: 'https://icp-api.io' }), canisterId: 'qhbym-qaaaa-aaaaa-aaafq-cai' });
  const out: Flow[] = [];
  let start: [] | [bigint] = [];
  for (let page = 0; page < 10; page++) {
    const r: any = await idx.get_account_identifier_transactions({ max_results: 500n, start, account_identifier: acc });
    if (!('Ok' in r)) throw new Error(r.Err.message);
    for (const { id, transaction: tx } of r.Ok.transactions) {
      const op = tx.operation;
      const k = Object.keys(op)[0];
      const v = op[k];
      const t = Number((opt<any>(tx.timestamp) ?? opt<any>(tx.created_at_time))?.timestamp_nanos ?? 0n) / 1e9;
      const amount = v.amount ? Number(v.amount.e8s) / 1e8 : 0;
      if (!amount) continue;
      if (k === 'Mint' || ((k === 'Transfer' || k === 'TransferFrom') && v.to === acc)) out.push({ id: String(id), t, amount, dir: 'in', peer: v.from ?? 'mint' });
      else if (k === 'Burn' || v.from === acc) out.push({ id: String(id), t, amount, dir: 'out', peer: v.to ?? 'burn' });
    }
    if (r.Ok.transactions.length < 500) break;
    start = [r.Ok.transactions[r.Ok.transactions.length - 1].id];
  }
  return out.sort((a, b) => a.t - b.t);
}

/* ---------- hourly snapshots archived by .github/workflows/archive-neurons.yml ---------- */
export type Snap = { t: number; stake: number; maturity: number; staked: number; vp: number; dd: number; state: number };
type Archive = { neuron: string; since: number; account?: string; snaps: Snap[] };

async function archive(id: string): Promise<Archive | null> {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${BUILDS_REPO}/main/neurons/${id}.json`, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

export type NeuronView = {
  info: NeuronInfo | null;
  full: Neuron | null;
  account?: string;
  flows: Flow[] | null;
  flowsError?: string;
  archive: Archive | null;
  /** private and not a known neuron → not tracked publicly */
  isPrivate: boolean;
};

/** register the neuron for hourly reward snapshots (worker keeps a capped list; best effort) */
export const track = (id: string) => {
  if (EXPLAIN_URL) fetch(`${EXPLAIN_URL}/track?id=${id}`).catch(() => {});
};

export type KnownRow = { id: string; name: string; description?: string; links: string[]; info?: NeuronInfo };

/** all known neurons + their public info, batched (list_neurons returns NeuronInfo for requested ids) */
export async function knownNeurons(): Promise<KnownRow[]> {
  const gov = await nnsGov();
  const k = await gov.list_known_neurons();
  const rows: KnownRow[] = k.known_neurons.flatMap((x) => {
    const id = opt(x.id)?.id;
    const d = opt(x.known_neuron_data);
    return id === undefined || !d ? [] : [{ id: String(id), name: d.name, description: opt(d.description), links: opt(d.links ?? []) ?? [] }];
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const chunks = Array.from({ length: Math.ceil(rows.length / 50) }, (_, i) => rows.slice(i * 50, i * 50 + 50));
  await Promise.all(
    chunks.map(async (c) => {
      const r = await gov
        .list_neurons({
          neuron_ids: new BigUint64Array(c.map((x) => BigInt(x.id))),
          include_public_neurons_in_full_neurons: [],
          include_neurons_readable_by_caller: false,
          include_empty_neurons_readable_by_caller: [],
          neuron_subaccounts: [],
          page_number: [],
          page_size: [],
        })
        .catch(() => null);
      for (const [nid, info] of r?.neuron_infos ?? []) {
        const row = byId.get(String(nid));
        if (row) row.info = info;
      }
    }),
  );
  // fallback for anything the batch did not return
  const missing = rows.filter((r) => !r.info);
  await pool(missing, 8, async (r) => {
    const x = await gov.get_neuron_info(BigInt(r.id)).catch(() => null);
    if (x && 'Ok' in x) r.info = x.Ok;
  });
  return rows;
}

/** everything is a query call (free) — no cycles are spent by WTN Watch */
export async function loadNeuron(id: string, acc?: string): Promise<NeuronView> {
  const gov = await nnsGov();
  const [r, list, a] = await Promise.all([
    gov.get_neuron_info(BigInt(id)),
    gov
      .list_neurons({
        neuron_ids: new BigUint64Array([BigInt(id)]),
        include_public_neurons_in_full_neurons: [true],
        include_neurons_readable_by_caller: false,
        include_empty_neurons_readable_by_caller: [],
        neuron_subaccounts: [],
        page_number: [],
        page_size: [],
      })
      .catch(() => null),
    archive(id),
  ]);
  const info = 'Ok' in r ? r.Ok : null;
  const isPrivate = !!info && opt(info.visibility) !== 2 && !opt(info.known_neuron_data);
  // only public or known neurons are tracked publicly; private ones stay in this browser
  if (info && !isPrivate) track(id);
  const full = list?.full_neurons.find((n) => opt(n.id)?.id === BigInt(id)) ?? null;
  const account = full ? accountId(Principal.fromText(IDS.nnsGovernance), new Uint8Array(full.account)) : acc && validAccount(acc) ? acc : a?.account;
  let f: Flow[] | null = null;
  let flowsError: string | undefined;
  if (account) {
    try {
      f = await flows(account);
    } catch (e) {
      flowsError = String((e as Error)?.message ?? e);
    }
  }
  return { info, full, account, flows: f, flowsError, archive: isPrivate ? null : a, isPrivate };
}

export const snapOf = (n: NeuronInfo, full: Neuron | null, t: number): Snap => ({
  t,
  stake: Number(n.stake_e8s) / 1e8,
  maturity: full ? Number(full.maturity_e8s_equivalent) / 1e8 : NaN,
  staked: Number(opt(n.staked_maturity_e8s_equivalent) ?? 0n) / 1e8,
  vp: Number(opt(n.deciding_voting_power) ?? n.voting_power) / 1e8,
  dd: Number(n.dissolve_delay_seconds),
  state: n.state,
});
