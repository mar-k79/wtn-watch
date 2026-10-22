import { EXPLAIN_URL } from './ic';

export type Verdict = { consistency: 'match' | 'partial' | 'mismatch'; risks: number };

const base = () => EXPLAIN_URL?.replace(/\/$/, '');

export async function fetchExplain(id: bigint) {
  const r = await fetch(`${base()}/explain?id=${id}&lang=en`);
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

export async function fetchVerdicts(ids: bigint[]): Promise<Record<string, Verdict>> {
  if (!base() || !ids.length) return {};
  const r = await fetch(`${base()}/verdicts?ids=${ids.join(',')}`);
  return r.ok ? r.json() : {};
}

export const verdictInfo = {
  match: {
    tone: 'yes',
    label: 'AI: no contradiction',
    help: 'The AI compared the proposer\'s description with what the proposal actually does on-chain and found no conflict. AI can be fooled, so treat it as a hint.',
  },
  partial: {
    tone: 'warn',
    label: 'Unconfirmed claims',
    help: 'The description says things the on-chain action cannot prove, usually background or the current state of the protocol. Not necessarily wrong, but check those claims yourself.',
  },
  mismatch: {
    tone: 'no',
    label: 'Summary mismatch',
    help: 'The description contradicts what the proposal actually does on-chain, or tries to manipulate the reader. Be very careful.',
  },
} as const;
