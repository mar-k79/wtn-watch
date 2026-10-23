import { Cpu, RefreshCcw } from 'lucide-react';
import { cycleLevel, managed, snsCanisters, type CanRow } from '../lib/data';
import { cycles, relative } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { Badge, Card, CardHeader, ErrorBox, Mono, Spinner, cx } from './ui';

const dot = { red: 'bg-no', orange: 'bg-warn', green: 'bg-yes', gray: 'bg-fg/20' } as const;
const tone = { red: 'no', orange: 'warn', green: 'yes', gray: 'neutral' } as const;
const KEY = new Set(['water_neuron', 'SNS governance', 'SNS root', 'WTN ledger', 'nICP ledger', 'boomerang']);

export function CyclesCard({ tick }: { tick: number }) {
  const { data, error, loading, reload } = useAsync(() => snsCanisters(tick > 0), [tick]);
  const rows = [...(data?.rows ?? [])].sort((a, b) => (a.runway ?? 1e9) - (b.runway ?? 1e9));
  const red = rows.filter((r) => cycleLevel(r) === 'red');
  const orange = rows.filter((r) => cycleLevel(r) === 'orange');

  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><Cpu className="size-4 text-accent" /> Canister cycles</span>}
        sub={
          data
            ? `${rows.length} DAO canisters · updated ${relative(data.at / 1000)} · shared 15-min cache (each check costs the DAO root cycles)`
            : 'All canisters controlled by the WaterNeuron SNS'
        }
        right={red.length ? <Badge tone="no">{red.length} critical</Badge> : orange.length ? <Badge tone="warn">{orange.length} need top-ups</Badge> : data ? <Badge tone="yes">all healthy</Badge> : undefined}
      />
      {error ? (
        <div className="p-4"><ErrorBox error={error} onRetry={reload} /></div>
      ) : loading && !data ? (
        <div className="px-5 py-6"><Spinner label="Reading canister status…" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="py-2 pr-3 pl-5 font-medium">Canister</th>
                <th className="px-3 py-2 text-right font-medium">Cycles</th>
                <th className="px-3 py-2 text-right font-medium">Burn / day</th>
                <th className="px-3 py-2 text-right font-medium">Runway</th>
                <th className="px-3 py-2 font-medium">Top-ups (7d)</th>
                <th className="px-5 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => <Row key={r.id} r={r} />)}
            </tbody>
          </table>
          <p className="px-5 py-3 text-[11px] text-muted">
            Burn is measured from hourly snapshots over the last 7 days, with top-ups excluded (includes message and compute costs). Until enough data exists it falls back to the idle estimate (*), which is much lower than real usage. Red: under 7 days and nobody topped it up in the last 3 days. Orange: under 30 days or relies on regular top-ups.
          </p>
        </div>
      )}
    </Card>
  );
}

function Row({ r }: { r: CanRow }) {
  const lvl = cycleLevel(r);
  return (
    <tr className={lvl === 'red' ? 'bg-no/[0.04]' : lvl === 'orange' ? 'bg-warn/[0.04]' : ''}>
      <td className="py-2 pr-3 pl-5">
        <div className="flex items-center gap-2">
          <span className={cx('size-2 shrink-0 rounded-full', dot[lvl])} />
          <span className={cx(KEY.has(r.name) && 'font-medium')}>{r.name}</span>
        </div>
        <Mono className="text-[11px] text-muted">{r.id}</Mono>
      </td>
      <td className="tabular px-3 py-2 text-right">{r.cycles !== undefined ? cycles(r.cycles) : '—'}</td>
      <td className="tabular px-3 py-2 text-right text-muted">
        {r.burn !== undefined ? `${(Number(r.burn) / 1e9).toFixed(1)} B` : '—'}
        {r.measured === undefined && r.burn !== undefined && '*'}
      </td>
      <td className={cx('tabular px-3 py-2 text-right', lvl === 'red' && 'font-semibold text-no', lvl === 'orange' && 'font-semibold text-warn')}>
        {r.runway !== undefined ? `${r.runway.toLocaleString()} d` : '—'}
      </td>
      <td className="px-3 py-2 text-xs whitespace-nowrap text-muted">
        {r.topups ? (
          <span className={cx('inline-flex items-center gap-1', managed(r) && 'text-yes')} title={r.lastTopup ? `last ${new Date(r.lastTopup).toLocaleString('en-GB')}` : undefined}>
            <RefreshCcw className="size-3" />
            {r.topups}× · +{r.topupTotal !== undefined ? cycles(r.topupTotal) : '?'}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="px-5 py-2"><Badge tone={r.status === 'running' ? tone[lvl === 'gray' ? 'green' : lvl] : 'no'}>{r.status}</Badge></td>
    </tr>
  );
}
