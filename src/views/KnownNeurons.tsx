import { useMemo, useState, type FormEvent } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { knownNeurons, DEFAULT_NEURON } from '../lib/neuron';
import { useAsync } from '../lib/useAsync';
import { compact, opt } from '../lib/format';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Mono, Skeleton, cx } from '../components/ui';

type Sort = 'vp' | 'stake' | 'name';

export function KnownNeurons() {
  const { data, error, loading, reload } = useAsync(knownNeurons, []);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<Sort>('vp');

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const r = (data ?? []).filter((x) => !s || x.name.toLowerCase().includes(s) || x.id.includes(s));
    const vp = (x: (typeof r)[number]) => Number(x.info ? (opt(x.info.deciding_voting_power) ?? x.info.voting_power) : 0n);
    return r.sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : sort === 'stake' ? Number((b.info?.stake_e8s ?? 0n) - (a.info?.stake_e8s ?? 0n)) : vp(b) - vp(a),
    );
  }, [data, q, sort]);
  const totalVp = useMemo(() => (data ?? []).reduce((s, x) => s + Number(x.info ? (opt(x.info.deciding_voting_power) ?? x.info.voting_power) : 0n), 0), [data]);

  const open = (e: FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (/^\d{5,20}$/.test(v)) location.hash = `#/neuron/${v}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Neurons</h1>
          <p className="text-sm text-muted">Known NNS neurons, or open any neuron by ID — its reward history is tracked automatically.</p>
        </div>
        <a href={`#/neuron/${DEFAULT_NEURON}`} className="text-sm text-accent hover:underline">My neuron →</a>
      </div>

      <form onSubmit={open} className="flex gap-2">
        <label className="sr-only" htmlFor="kq">Search by name or neuron ID</label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input id="kq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, or any neuron ID + Enter"
            className="h-10 w-full rounded-lg border border-line bg-panel pr-3 pl-9 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
        </div>
        <Button type="submit" variant="primary" disabled={!/^\d{5,20}$/.test(q.trim())} className="h-10 px-4">Open ID</Button>
      </form>

      {error ? <ErrorBox error={error} onRetry={reload} /> : (
        <Card>
          <CardHeader
            title={loading ? 'Known neurons' : `Known neurons · ${rows.length}`}
            sub="Registered on the NNS via Register Known Neuron proposals"
            right={
              <div className="flex gap-1" role="group" aria-label="Sort">
                {(['vp', 'stake', 'name'] as Sort[]).map((k) => (
                  <Button key={k} variant={sort === k ? 'default' : 'ghost'} onClick={() => setSort(k)} className={cx('h-7 px-2', sort === k && 'text-accent')}>
                    {k === 'vp' ? 'Voting power' : k === 'stake' ? 'Stake' : 'Name'}
                  </Button>
                ))}
              </div>
            }
          />
          {loading ? (
            <div className="space-y-2 p-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : !rows.length ? (
            <Empty>No neuron matches “{q}”. Press Enter to open it by ID.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {rows.map((r) => {
                const vp = r.info ? Number(opt(r.info.deciding_voting_power) ?? r.info.voting_power) : 0;
                const share = totalVp ? (vp / totalVp) * 100 : 0;
                return (
                  <li key={r.id}>
                    <a href={`#/neuron/${r.id}`} className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-fg/[0.03]">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{r.name}</span>
                          {r.info?.state === 2 && <Badge tone="warn">Dissolving</Badge>}
                        </div>
                        <div className="truncate text-xs text-muted">
                          <Mono>{r.id}</Mono>{r.description ? ` · ${r.description}` : ''}
                        </div>
                      </div>
                      <div className="hidden w-28 shrink-0 text-right sm:block">
                        <div className="tabular text-sm">{r.info ? compact(r.info.stake_e8s) : '—'}</div>
                        <div className="text-xs text-muted">ICP staked</div>
                      </div>
                      <div className="w-32 shrink-0 text-right">
                        <div className="tabular text-sm">{r.info ? compact(vp) : '—'}</div>
                        <div className="mt-1 h-1 overflow-hidden rounded-full bg-fg/5">
                          <div className="brand-gradient h-full" style={{ width: `${Math.min(100, share * 4)}%` }} />
                        </div>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" />
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
