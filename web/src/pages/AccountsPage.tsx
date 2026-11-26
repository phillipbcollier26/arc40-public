import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, Landmark, LineChart, Plus, Wallet } from 'lucide-react';
import { useApi } from '../lib/useApi';
import type { AccountSummary } from '../lib/types';
import { Modal } from '../components/Modal';
import { AddAccountForm } from '../components/AccountForm';
import { BigMoney, ChangePill, Sparkline } from '../components/Money';
import { formatCents, formatDate } from '../lib/format';
import { GROUP_LABELS, type AccountGroup } from '../../../shared/accounts';

const GROUP_ICON = { cash: Wallet, investments: LineChart, debt: Landmark } as const;
const GROUP_TONE = { cash: 'silver', investments: 'gold', debt: 'garnet' } as const;

export function AccountsPage() {
  const [params, setParams] = useSearchParams();
  const [showArchived, setShowArchived] = useState(false);
  const navigate = useNavigate();
  const { data, reload } = useApi<{ accounts: AccountSummary[] }>('/api/accounts?archived=1');
  const adding = params.get('add') === '1';

  const all = data?.accounts ?? [];
  const active = all.filter((a) => !a.archived);
  const archived = all.filter((a) => a.archived);
  const groups = (['cash', 'investments', 'debt'] as AccountGroup[])
    .map((g) => ({ group: g, accounts: active.filter((a) => a.group === g) }))
    .filter((g) => g.accounts.length);
  const total = (list: AccountSummary[]) =>
    list.reduce((s, a) => s + (a.class === 'liability' ? -1 : 1) * (a.balanceCents ?? 0), 0);

  return (
    <div className="page">
      <header className="page-head rise">
        <div>
          <div className="label">Money</div>
          <h1 className="page-title">Accounts</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setParams({ add: '1' })}>
          <Plus size={16} /> Add account
        </button>
      </header>

      {data && active.length === 0 && (
        <div className="card empty rise">
          <div className="empty-icon">
            <Landmark size={28} strokeWidth={1.5} />
          </div>
          <h3>No accounts yet</h3>
          <p className="muted">Start with your checking account. You can add balances from past dates later to fill in your history.</p>
        </div>
      )}

      {groups.length > 0 && (
        <section className="summary-strip card rise" style={{ animationDelay: '60ms' }}>
          {groups.map((g) => (
            <div key={g.group} className={`summary-item tone-${GROUP_TONE[g.group]}`}>
              <div className="label">{GROUP_LABELS[g.group]}</div>
              <div className="summary-num num">{formatCents(total(g.accounts))}</div>
            </div>
          ))}
          <div className="summary-item summary-total">
            <div className="label">Net worth</div>
            <BigMoney cents={total(active)} size="md" />
          </div>
        </section>
      )}

      {groups.map((g, gi) => {
        const Icon = GROUP_ICON[g.group];
        return (
          <section key={g.group} className="rise" style={{ animationDelay: `${120 + gi * 60}ms` }}>
            <h2 className="group-title">
              <Icon size={18} /> {GROUP_LABELS[g.group]}
            </h2>
            <div className="acct-grid">
              {g.accounts.map((a) => (
                <AccountCard key={a.id} a={a} tone={GROUP_TONE[g.group]} />
              ))}
            </div>
          </section>
        );
      })}

      {archived.length > 0 && (
        <section>
          <button className="btn btn-ghost" onClick={() => setShowArchived((s) => !s)}>
            <Archive size={16} /> {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
          </button>
          {showArchived && (
            <div className="acct-grid" style={{ marginTop: 14 }}>
              {archived.map((a) => (
                <AccountCard key={a.id} a={a} tone="silver" />
              ))}
            </div>
          )}
        </section>
      )}

      {adding && (
        <Modal title="Add account" onClose={() => setParams({})}>
          <AddAccountForm
            onDone={(id) => {
              reload();
              navigate(`/accounts/${id}`);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function AccountCard({ a, tone }: { a: AccountSummary; tone: 'gold' | 'silver' | 'garnet' }) {
  return (
    <Link to={`/accounts/${a.id}`} className={`acct-card card tone-${tone} ${a.archived ? 'is-archived' : ''}`}>
      <div className="acct-card-top">
        <div>
          <div className="acct-name">{a.name}</div>
          <div className="acct-inst">{a.institution || a.typeLabel}</div>
        </div>
        <span className="chip">{a.typeLabel}</span>
      </div>
      <div className="acct-card-mid">
        <div className="acct-bal num">{a.balanceCents === null ? 'No balance yet' : formatCents(a.balanceCents)}</div>
        <Sparkline values={a.trend.map((p) => p.cents)} tone={tone === 'garnet' ? 'garnet' : tone} width={110} height={38} />
      </div>
      <div className="acct-card-foot">
        {a.change30dCents !== null ? <ChangePill cents={a.change30dCents} suffix="30d" /> : <span />}
        {a.balanceAsOf && <span className="acct-asof">Updated {formatDate(a.balanceAsOf, { year: false })}</span>}
      </div>
    </Link>
  );
}
