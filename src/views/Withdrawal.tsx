import { useState, type FormEvent } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { Principal } from '@icp-sdk/core/principal';
import { withdrawalById, withdrawalsOf, type WRow } from '../lib/data';
import { Button, Card, CardHeader, Empty, ErrorBox, Spinner } from '../components/ui';
import { WTable, reqSec } from './Monitor';
import { neuronState } from '../lib/data';
import { date, days, humanize, icp, opt } from '../lib/format';
import { Badge, Ext, Mono, CopyButton } from '../components/ui';

const STEP: Record<string, string> = {
  WaitingToSplitNeuron: 'Your nICP was burned. WaterNeuron will split a neuron with your ICP out of its main neuron.',
  WaitingToStartDissolving: 'A neuron holding your ICP was split off. WaterNeuron still has to start dissolving it.',
  WaitingDissolvement: 'The neuron is dissolving. When the delay reaches 0, the ICP is disbursed to the receiver.',
  ConversionDone: 'Done — the ICP was sent to the receiver.',
  Cancelled: 'The withdrawal was cancelled; its neuron was merged back into the main neuron.',
  NotFound: 'WaterNeuron does not know this withdrawal.',
};

function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="mt-0.5 truncate text-sm tabular">{children}</dd>
    </div>
  );
}

function WDetail({ r }: { r: WRow }) {
  const q = r.w.request;
  const rate = q.nicp_burned ? Number(q.icp_due) / Number(q.nicp_burned) : undefined;
  const sub = opt(q.receiver.subaccount);
  const done = (r.w.status as Record<string, any>).ConversionDone;
  const dd = r.nns ? Number(r.nns.dissolve_delay_seconds) : undefined;
  const eta = r.nns && r.nns.state === 2 && dd !== undefined ? Date.now() / 1000 + dd : undefined;
  return (
    <Card>
      <CardHeader
        title={<span className="inline-flex items-center gap-2">Withdrawal <Mono>#{String(q.withdrawal_id)}</Mono></span>}
        sub={STEP[r.status] ?? humanize(r.status)}
        right={<Badge tone={r.status === 'ConversionDone' ? 'yes' : r.frozen ? 'warn' : 'accent'}>{r.status === 'ConversionDone' ? 'Paid out' : r.frozen ? 'Frozen' : humanize(r.status)}</Badge>}
      />
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-4">
        <Field k="nICP burned">{icp(q.nicp_burned, 4)} nICP</Field>
        <Field k="ICP due">
          <span className="inline-flex items-center gap-1.5">{icp(q.icp_due, 4)} ICP</span>
        </Field>
        <Field k="Rate">{rate ? `1 nICP = ${rate.toFixed(6)} ICP` : '—'}</Field>
        <Field k="Requested">{reqSec(r) ? date(reqSec(r)) : '—'}</Field>
        <Field k="nICP burn block"><Mono>{String(q.nicp_burn_index)}</Mono></Field>
        <Field k="Neuron">
          {r.neuronId !== undefined ? (
            <span className="inline-flex items-center gap-2">
              <a href={`#/neuron/${r.neuronId}`} className="font-mono text-accent hover:underline">{String(r.neuronId)}</a>
              <Ext href={`https://dashboard.internetcomputer.org/neuron/${r.neuronId}`} className="text-muted"><span className="sr-only">ICP Dashboard</span></Ext>
            </span>
          ) : '—'}
        </Field>
        <Field k="NNS state">{r.nns ? (r.frozen ? 'Not dissolving (frozen)' : neuronState(r.nns.state)) : done ? 'Disbursed' : '—'}</Field>
        <Field k={eta ? 'Expected payout' : 'Dissolve delay'}>
          {eta ? <span>{date(eta)} <span className="text-muted">({days(dd!)})</span></span> : dd !== undefined ? days(dd) : '—'}
        </Field>
        {r.nns && <Field k="Neuron stake">{icp(r.nns.stake_e8s, 4)} ICP</Field>}
        {done && <Field k="ICP transfer block"><Mono>{String(done.transfer_block_height)}</Mono></Field>}
        <div className="col-span-2 min-w-0 sm:col-span-4">
          <dt className="text-xs text-muted">Receiver</dt>
          <dd className="mt-0.5 flex items-center gap-2">
            <Mono className="truncate">{q.receiver.owner.toText()}</Mono>
            <ArrowRight className="size-3 shrink-0 text-muted" />
            <span className="text-xs text-muted">{sub ? <>subaccount <Mono>{[...sub].map((b) => b.toString(16).padStart(2, '0')).join('')}</Mono></> : 'default account'}</span>
            <CopyButton get={() => q.receiver.owner.toText()} label="Copy" />
          </dd>
        </div>
      </dl>
    </Card>
  );
}

export function Withdrawal() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<WRow[]>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    const isId = /^\d+$/.test(v);
    if (!isId) {
      try {
        Principal.fromText(v);
      } catch {
        setInvalid(true);
        return;
      }
    }
    setInvalid(false);
    setLoading(true);
    setError(undefined);
    setRows(undefined);
    try {
      setRows(isId ? await withdrawalById(BigInt(v)) : await withdrawalsOf(v));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Check a withdrawal</h1>
        <p className="text-sm text-muted">Enter the principal that receives the ICP, or a withdrawal ID.</p>
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <label className="sr-only" htmlFor="q">Principal or withdrawal ID</label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
          <input
            id="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="xxxxx-xxxxx-…-cai  or  1616"
            aria-invalid={invalid}
            className={`h-10 w-full rounded-lg border bg-panel pr-3 pl-9 font-mono text-sm outline-none focus:ring-2 focus:ring-accent/30 ${invalid ? 'border-no' : 'border-line focus:border-accent'}`}
          />
        </div>
        <Button type="submit" variant="primary" disabled={!q.trim() || loading} className="h-10 px-4">
          Check
        </Button>
      </form>
      {invalid && <p className="text-xs text-no">Not a valid principal or number.</p>}

      {error ? <ErrorBox error={error} /> : null}
      {loading && <Spinner label="Querying WaterNeuron and NNS…" />}
      {rows && (
        <Card>
          <CardHeader title={`${rows.length} withdrawal${rows.length === 1 ? '' : 's'}`} sub="Delay and state are read live from NNS governance" />
          {rows.length ? <WTable rows={rows} /> : <Empty>No withdrawals found</Empty>}
        </Card>
      )}
      {rows && rows.length > 0 && rows.length <= 5 && [...rows].sort((a, b) => Number(b.w.request.withdrawal_id - a.w.request.withdrawal_id)).map((r) => <WDetail key={String(r.w.request.withdrawal_id)} r={r} />)}
    </div>
  );
}
