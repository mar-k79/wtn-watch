import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { cyclesTopups, type TopUp } from '../lib/data';
import { cycles } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { Button, Card, CardHeader, Empty, ErrorBox, Mono, Spinner } from './ui';
import { Select } from './Filters';

const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function TopUpsCard({ tick }: { tick: number }) {
  const { data, error, loading, reload } = useAsync(cyclesTopups, [tick]);
  const [who, setWho] = useState('all');
  const [n, setN] = useState(25);

  const opts = useMemo(
    () => [['all', 'All canisters'] as const, ...[...new Set((data ?? []).map((e) => e.name))].sort().map((x) => [x, x] as const)],
    [data],
  );
  const rows = (data ?? []).filter((e) => who === 'all' || e.name === who);
  const total = rows.reduce((s, e) => s + e.amount, 0n);
  const by = useMemo(() => {
    const m = new Map<string, { n: number; sum: bigint }>();
    rows.forEach((e) => {
      const c = m.get(e.name) ?? { n: 0, sum: 0n };
      m.set(e.name, { n: c.n + 1, sum: c.sum + e.amount });
    });
    return [...m.entries()].sort((a, b) => Number(b[1].sum - a[1].sum));
  }, [rows]);

  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><History className="size-4 text-accent" /> Top-up history</span>}
        sub="Every detected top-up, stored permanently by the worker (checked hourly, also when nobody has the app open)"
        right={data && data.length > 0 ? <Select value={who} onChange={setWho} options={opts} label="Canister" /> : undefined}
      />
      {error ? (
        <div className="p-4"><ErrorBox error={error} onRetry={reload} /></div>
      ) : loading && !data ? (
        <div className="px-5 py-6"><Spinner label="Loading top-up history…" /></div>
      ) : !rows.length ? (
        <Empty>No top-ups recorded yet. History starts from the first hourly check after this update.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-line px-5 py-3 text-xs text-muted">
            <span>
              <b className="text-fg">{rows.length}</b> top-ups · <b className="text-fg">{cycles(total)}</b> total
            </span>
            {by.slice(0, 6).map(([name, v]) => (
              <span key={name}>
                {name}: {v.n}× · {cycles(v.sum)}
              </span>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-2 pr-3 pl-5 font-medium">Detected</th>
                  <th className="px-3 py-2 font-medium">Canister</th>
                  <th className="px-3 py-2 text-right font-medium">Added</th>
                  <th className="px-5 py-2 text-right font-medium">Balance before → after</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.slice(0, n).map((e: TopUp, i) => (
                  <tr key={`${e.at}-${e.id}-${i}`}>
                    <td className="py-2 pr-3 pl-5 text-xs whitespace-nowrap text-muted" title={`between ${when(e.prev)} and ${when(e.at)}`}>
                      {when(e.at)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{e.name}</div>
                      <Mono className="text-[11px] text-muted">{e.id}</Mono>
                    </td>
                    <td className="tabular px-3 py-2 text-right font-medium text-yes">+{cycles(e.amount)}</td>
                    <td className="tabular px-5 py-2 text-right text-xs text-muted whitespace-nowrap">
                      {cycles(e.before)} → {cycles(e.after)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > n && (
            <div className="flex justify-center p-3">
              <Button variant="ghost" onClick={() => setN((x) => x + 50)}>Show more ({rows.length - n})</Button>
            </div>
          )}
          <p className="px-5 pb-3 text-[11px] text-muted">
            A top-up is a rise in balance between two hourly checks, so the time is accurate to about an hour and the amount is net of burn in that hour.
          </p>
        </>
      )}
    </Card>
  );
}
