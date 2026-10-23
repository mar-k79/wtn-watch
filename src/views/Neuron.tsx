import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { CloudCheck } from 'lucide-react';
import { ArrowDownLeft, ArrowUpRight, Lock, RefreshCw, Search, Star } from 'lucide-react';
import { loadNeuron, localSnaps, myNeuron, mySnaps, myToken, setMyNeuron, setMyToken, snapOf, validAccount, HALF_YEAR, type Flow, type Snap } from '../lib/neuron';
import { neuronState } from '../lib/data';
import { useAsync } from '../lib/useAsync';
import { date, opt, short } from '../lib/format';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Ext, Mono, Skeleton, cx } from '../components/ui';

const n2 = (v: number, d = 2) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const dur = (s: number) => {
  const y = Math.floor(s / 31_557_600);
  const d = Math.floor((s % 31_557_600) / 86_400);
  return s < 86_400 ? `${Math.round(s / 3600)} h` : [y && `${y} year${y > 1 ? 's' : ''}`, d && `${d} day${d > 1 ? 's' : ''}`].filter(Boolean).join(', ') || '0 days';
};
const TYPE: Record<number, string> = { 1: 'Seed', 2: 'ECT' };
const VIS: Record<number, string> = { 1: 'Private', 2: 'Public' };

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted">{k}</span>
      <span className="tabular text-right">{v}</span>
    </div>
  );
}

/* ---------------- cumulative stake chart (plain SVG, theme-aware) ---------------- */
function StakeChart({ flows }: { flows: Flow[] }) {
  const [hover, setHover] = useState<number>();
  const pts = useMemo(() => {
    let c = 0;
    return flows.map((f) => ({ t: f.t, v: (c += f.dir === 'in' ? f.amount : -f.amount), f }));
  }, [flows]);
  if (pts.length < 1) return <Empty>No ledger transfers found for this neuron account.</Empty>;
  const W = 800, H = 220, P = 8;
  const t0 = pts[0].t, t1 = Math.max(Date.now() / 1000, pts[pts.length - 1].t + 1);
  const max = Math.max(...pts.map((p) => p.v), 1) * 1.08;
  const x = (t: number) => P + ((t - t0) / (t1 - t0)) * (W - 2 * P);
  const y = (v: number) => H - P - (Math.max(v, 0) / max) * (H - 2 * P);
  let d = `M${x(t0)},${y(0)}`;
  for (const p of pts) d += ` H${x(p.t)} V${y(p.v)}`;
  d += ` H${x(t1)}`;
  const area = `${d} V${H - P} H${x(t0)} Z`;
  const h = hover !== undefined ? pts[hover] : undefined;
  const near = (cx: number) => {
    let best = 0;
    pts.forEach((p, i) => Math.abs(x(p.t) - cx) < Math.abs(x(pts[best].t) - cx) && (best = i));
    return best;
  };
  return (
    <div className="relative px-5 pt-4 pb-3">
      <div className="mb-1 flex justify-between text-xs text-muted tabular">
        <span>{n2(max / 1.08, 0)} ICP</span>
        {h && (
          <span className={h.f.dir === 'in' ? 'text-yes' : 'text-no'}>
            {new Date(h.t * 1000).toLocaleDateString('en-GB')} · {h.f.dir === 'in' ? '+' : '−'}{n2(h.f.amount)} ICP · total {n2(h.v)}
          </span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-48 w-full text-accent"
        role="img"
        aria-label="Cumulative ICP staked into the neuron over time"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(near(((e.clientX - r.left) / r.width) * W));
        }}
        onMouseLeave={() => setHover(undefined)}
      >
        <line x1={P} x2={W - P} y1={H - P} y2={H - P} className="stroke-line" vectorEffect="non-scaling-stroke" />
        <path d={area} fill="currentColor" opacity={0.08} />
        <path d={d} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {h && <line x1={x(h.t)} x2={x(h.t)} y1={P} y2={H - P} className="stroke-muted" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="mt-1 flex justify-between text-xs text-muted">
        <span>{new Date(t0 * 1000).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</span>
        <span>now</span>
      </div>
    </div>
  );
}

/* ---------------- activity feed: snapshot diffs + ledger transfers ---------------- */
type Ev = { t: number; kind: 'maturity' | 'stake' | 'delay'; text: ReactNode; delta?: number; base?: number };

function events(snaps: Snap[], flows: Flow[]): Ev[] {
  const out: Ev[] = [];
  for (let i = 1; i < snaps.length; i++) {
    const a = snaps[i - 1], b = snaps[i];
    const ch = (k: 'staked' | 'maturity' | 'stake', label: string, kind: Ev['kind']) => {
      if (a[k] == null || b[k] == null || Number.isNaN(a[k]) || Number.isNaN(b[k]) || Math.abs(b[k] - a[k]) < 1e-8) return;
      out.push({ t: b.t, kind, delta: b[k] - a[k], base: a[k], text: <>{label} {b[k] > a[k] ? 'increased' : 'decreased'} from <b>{n2(a[k])}</b> to <b>{n2(b[k])}</b> ICP</> });
    };
    ch('staked', 'Staked maturity', 'maturity');
    ch('maturity', 'Maturity', 'maturity');
    ch('stake', 'Stake', 'stake');
    if (a.dd !== b.dd && Math.abs(a.dd - b.dd) > 86_400 && b.state === a.state) out.push({ t: b.t, kind: 'delay', text: <>Dissolve delay changed from <b>{dur(a.dd)}</b> to <b>{dur(b.dd)}</b></> });
    if (a.state !== b.state) out.push({ t: b.t, kind: 'delay', text: <>State changed: <b>{neuronState(a.state)}</b> → <b>{neuronState(b.state)}</b></> });
  }
  for (const f of flows)
    out.push({ t: f.t, kind: 'stake', delta: f.dir === 'in' ? f.amount : -f.amount, text: <>{f.dir === 'in' ? 'Received' : 'Sent'} <b>{n2(f.amount, 4)}</b> ICP {f.dir === 'in' ? 'from' : 'to'} <Mono>{short(f.peer, 6)}</Mono></> });
  return out.sort((a, b) => b.t - a.t);
}

const FILTERS = [['all', 'All actions'], ['maturity', 'Rewards (maturity)'], ['stake', 'Stake & transfers'], ['delay', 'Delay & state']] as const;

function AccountForm({ id }: { id: string }) {
  const [v, setV] = useState('');
  const ok = validAccount(v.trim().toLowerCase());
  return (
    <form
      className="mx-auto flex max-w-xl flex-col items-center gap-3 px-5 py-8 text-center"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) location.hash = `#/neuron/${id}?acc=${v.trim().toLowerCase()}`;
      }}
    >
      <p className="text-sm text-muted">This neuron is private, so NNS does not reveal its ledger account. Paste the neuron account ID (e.g. from the ICP Dashboard or vpGeek) to load its stake history.</p>
      <div className="flex w-full gap-2">
        <label className="sr-only" htmlFor="acc">Neuron account ID</label>
        <input id="acc" value={v} onChange={(e) => setV(e.target.value)} placeholder="64-character account ID" aria-invalid={!!v && !ok}
          className={cx('h-9 w-full rounded-lg border bg-panel px-3 font-mono text-xs outline-none focus:ring-2 focus:ring-accent/30', v && !ok ? 'border-no' : 'border-line focus:border-accent')} />
        <Button type="submit" disabled={!ok} className="h-9 px-3">Load</Button>
      </div>
      {v && !ok && <span className="text-xs text-no">Not a valid account ID (checksum mismatch)</span>}
    </form>
  );
}

export function Neuron({ id, acc }: { id: string; acc?: string }) {
  const [q, setQ] = useState(id);
  const [mine, setMine] = useState(() => myNeuron() === id);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all');
  const [limit, setLimit] = useState(30);
  const { data, error, loading, reload } = useAsync(() => loadNeuron(id, acc), [id, acc]);
  const [tok, setTok] = useState('');
  const priv = useAsync(() => (mine ? mySnaps(id) : Promise.resolve(null)), [id, mine, tok]);
  const n = data?.info;
  const full = data?.full;
  const now = Date.now() / 1000;

  const feed = useMemo(() => {
    if (!data) return [];
    const cur = n ? snapOf(n, full ?? null, Math.floor(now)) : undefined;
    const local = localSnaps(id, cur);
    const snaps = [...(data.archive?.snaps ?? []), ...(priv.data ?? []), ...local].sort((a, b) => a.t - b.t);
    if (cur && snaps[snaps.length - 1] !== cur) snaps.push(cur);
    return events(snaps, data.flows ?? []);
  }, [data, priv.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = feed.filter((e) => filter === 'all' || e.kind === filter);
  const vin = (data?.flows ?? []).filter((f) => f.dir === 'in').reduce((s, f) => s + f.amount, 0);
  const vout = (data?.flows ?? []).filter((f) => f.dir === 'out').reduce((s, f) => s + f.amount, 0);

  const refreshed = n ? Number(opt(n.voting_power_refreshed_timestamp_seconds) ?? 0n) : 0;
  const confirmIn = refreshed ? refreshed + HALF_YEAR - now : undefined;
  const sk = <Skeleton className="h-4 w-24" />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (/^\d{1,20}$/.test(v)) location.hash = `#/neuron/${v}`;
  };

  let lastDay = '';
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">{(n && opt(n.known_neuron_data)?.name) || 'NNS neuron'}</h1>
          <p className="text-sm text-muted">
            <a href="#/neuron" className="hover:text-fg">Known neurons</a> / <Mono>{id}</Mono> · <Ext href={`https://dashboard.internetcomputer.org/neuron/${id}`}>Dashboard</Ext>
          </p>
        </div>
        <form onSubmit={submit} className="flex w-full gap-2 sm:w-auto">
          <label className="sr-only" htmlFor="nid">Neuron ID</label>
          <div className="relative flex-1 sm:w-72">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input id="nid" value={q} onChange={(e) => setQ(e.target.value)} inputMode="numeric"
              className="h-9 w-full rounded-lg border border-line bg-panel pr-3 pl-9 font-mono text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/30" />
          </div>
          <Button type="submit" className="h-9 px-3">Open</Button>
          <Button
            onClick={() => {
              setMyNeuron(mine ? undefined : id);
              setMine(!mine);
            }}
            className={cx('h-9 px-2.5', mine && 'text-warn')}
            aria-pressed={mine}
            aria-label={mine ? 'Unmark as my neuron' : 'Mark as my neuron (saved only in this browser)'}
          >
            <Star className={cx('size-4', mine && 'fill-current')} />
          </Button>
          <Button onClick={reload} className="h-9 px-2.5" aria-label="Refresh"><RefreshCw className={cx('size-4', loading && 'animate-spin')} /></Button>
        </form>
      </div>

      {error ? <ErrorBox error={error} onRetry={reload} /> : !loading && !n ? <ErrorBox error="Neuron not found" /> : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="px-5 py-2 divide-y divide-line">
            <Row k="State" v={n ? <Badge tone={n.state === 2 ? 'warn' : n.state === 1 ? 'yes' : 'neutral'}>{n.state === 1 ? 'Not dissolving' : neuronState(n.state)}</Badge> : sk} />
            <Row k="Type" v={n ? TYPE[opt(n.neuron_type) ?? 0] ?? 'Regular' : sk} />
            <Row k="Age" v={n ? dur(Number(n.age_seconds)) : sk} />
            <Row k="Created" v={n ? date(n.created_timestamp_seconds) : sk} />
            <Row k="Visibility" v={n ? VIS[opt(n.visibility) ?? 0] ?? '—' : sk} />
            <Row k="Tracked here since" v={!data ? sk : data.isPrivate ? <span className="text-muted">this browser only</span> : data.archive ? date(data.archive.since) : 'not archived yet'} />
          </Card>
          <Card className="px-5 py-2 divide-y divide-line">
            <Row k="Staked ICP" v={n ? `${n2(Number(n.stake_e8s) / 1e8, 4)} ICP` : sk} />
            <Row k="Staked maturity" v={n ? `${n2(Number(opt(n.staked_maturity_e8s_equivalent) ?? 0n) / 1e8, 4)} ICP` : sk} />
            <Row k="Maturity" v={!data ? sk : full ? `${n2(Number(full.maturity_e8s_equivalent) / 1e8, 4)} ICP${opt(full.auto_stake_maturity) ? ' · auto-stake' : ''}` : <span className="text-muted">hidden (private)</span>} />
            <Row k="Voting power" v={n ? n2(Number(opt(n.deciding_voting_power) ?? n.voting_power) / 1e8) : sk} />
            <Row k="Dissolve delay" v={n ? <span>{dur(Number(n.dissolve_delay_seconds))} · {Number(n.dissolve_delay_seconds) >= HALF_YEAR ? <span className="text-yes">can vote</span> : <span className="text-no">cannot vote</span>}</span> : sk} />
            <Row k="Following" v={confirmIn === undefined ? (n ? '—' : sk) : confirmIn > 0
              ? <span className={confirmIn < 30 * 86_400 ? 'text-warn' : ''}>confirm within {Math.floor(confirmIn / 86_400)} days</span>
              : <span className="text-no">overdue — voting power decaying</span>} />
          </Card>
        </div>
      )}

      <Card>
        <CardHeader
          title="Stake change over time"
          sub={data?.account ? <>Ledger transfers of neuron account <Ext href={`https://dashboard.internetcomputer.org/account/${data.account}`}><Mono>{short(data.account, 8)}</Mono></Ext>{!data.full && ' (provided manually)'}</> : data && !data.full ? 'Account hidden — neuron is private' : undefined}
          right={data?.flows && (
            <div className="flex gap-5 text-right">
              <div><div className="text-xs text-muted">In</div><div className="tabular font-semibold text-yes">{n2(vin, 0)}</div></div>
              <div><div className="text-xs text-muted">Out</div><div className="tabular font-semibold text-no">{n2(vout, 0)}</div></div>
            </div>
          )}
        />
        {loading ? <div className="p-5"><Skeleton className="h-48 w-full" /></div>
          : data?.flowsError ? <div className="p-5"><ErrorBox error={data.flowsError} onRetry={reload} /></div>
          : data?.flows ? <StakeChart flows={data.flows} />
          : <AccountForm id={id} />}
      </Card>

      <Card>
        <CardHeader
          title="Rewards & activity"
          sub={data?.isPrivate && priv.data
            ? <span className="inline-flex items-center gap-1"><CloudCheck className="size-3 text-yes" />Private hourly history · {priv.data.length} snapshots{priv.data[0] ? ` since ${date(priv.data[0].t)}` : ''} · not public</span>
            : data?.isPrivate
            ? <span className="inline-flex items-center gap-1"><Lock className="size-3" />Private neuron — not tracked publicly; history is kept only in this browser (one snapshot per visit)</span>
            : data?.archive ? `Hourly snapshots since ${date(data.archive.since)}` : 'Now tracked — reward history starts with the next hourly snapshot'}
          right={
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter actions"
              className="h-8 rounded-lg border border-line bg-panel px-2 text-xs outline-none focus:border-accent">
              {FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          }
        />
        {mine && data?.isPrivate && !priv.loading && !priv.data && (
          <form
            className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              const t = new FormData(e.currentTarget).get('t')?.toString().trim() ?? '';
              setMyToken(t);
              setTok(t);
            }}
          >
            <span className="text-xs text-muted">{myToken() ? 'Sync token rejected.' : 'Paste your private sync token to load the hourly history:'}</span>
            <label className="sr-only" htmlFor="tok">Sync token</label>
            <input id="tok" name="t" type="password" autoComplete="off" className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-panel px-2 font-mono text-xs outline-none focus:border-accent" />
            <Button type="submit" className="h-8">Save</Button>
          </form>
        )}
        {loading ? <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
          : !shown.length ? <Empty>No activity recorded yet.</Empty> : (
          <ul className="px-5 py-2">
            {shown.slice(0, limit).map((e, i) => {
              const day = new Date(e.t * 1000).toLocaleDateString('en-GB', { dateStyle: 'medium' });
              const head = day !== lastDay ? (lastDay = day) : null;
              return (
                <li key={i}>
                  {head && <div className="pt-3 pb-1 text-xs font-medium text-muted">{head}</div>}
                  <div className="flex items-start gap-3 py-1.5 text-sm">
                    <span className="w-12 shrink-0 tabular text-xs text-muted pt-0.5">{new Date(e.t * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                    {e.delta !== undefined ? (e.delta > 0 ? <ArrowDownLeft className="mt-0.5 size-4 shrink-0 text-yes" /> : <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-no" />) : <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />}
                    <span className="min-w-0 flex-1">
                      {e.text}
                      {e.delta !== undefined && e.base ? (
                        <span className={cx('ml-1.5 text-xs tabular', e.delta > 0 ? 'text-yes' : 'text-no')}>
                          ({e.delta > 0 ? '+' : ''}{n2((e.delta / e.base) * 100)}%, {e.delta > 0 ? '+' : ''}{n2(e.delta)})
                        </span>
                      ) : null}
                    </span>
                  </div>
                </li>
              );
            })}
            {shown.length > limit && (
              <li className="py-2"><Button variant="ghost" onClick={() => setLimit((l) => l + 50)}>Show more ({shown.length - limit})</Button></li>
            )}
          </ul>
        )}
      </Card>
      <p className="px-1 text-xs text-muted">All data comes from free query calls to NNS governance and the ICP index — no cycles are spent.</p>
    </div>
  );
}
