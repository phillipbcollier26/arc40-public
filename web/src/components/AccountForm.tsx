import { useState, type FormEvent } from 'react';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_KEYS, GROUP_LABELS, type AccountType } from '../../../shared/accounts';
import { api, ApiError } from '../lib/api';
import { todayIso } from '../lib/format';

const PICKABLE = ACCOUNT_TYPE_KEYS.filter((k) => ACCOUNT_TYPES[k].available);

/** Create a new account (with an optional starting balance). */
export function AddAccountForm({ onDone }: { onDone: (id: number) => void }) {
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [balance, setBalance] = useState('');
  const [date, setDate] = useState(todayIso());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ account: { id: number } }>('POST', '/api/accounts', {
        name,
        institution,
        type,
        ...(balance.trim() ? { openingBalance: balance, openingDate: date } : {}),
      });
      onDone(res.account.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label className="field">
        <span className="label">Account name</span>
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Everyday Checking" />
      </label>
      <label className="field">
        <span className="label">Bank or broker</span>
        <input className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="e.g. Hometown Credit Union" />
      </label>
      <label className="field">
        <span className="label">Type</span>
        <select className="input" value={type} onChange={(e) => setType(e.target.value as AccountType)} aria-label="Account type">
          {(['cash', 'investments'] as const).map((g) => (
            <optgroup key={g} label={GROUP_LABELS[g]}>
              {PICKABLE.filter((k) => ACCOUNT_TYPES[k].group === g).map((k) => (
                <option key={k} value={k}>
                  {ACCOUNT_TYPES[k].label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="form-row">
        <label className="field">
          <span className="label">Current balance</span>
          <MoneyInput value={balance} onChange={setBalance} />
        </label>
        <label className="field">
          <span className="label">As of</span>
          <input className="input" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          Add account
        </button>
      </div>
    </form>
  );
}

/** Text box for money. Sends exactly what you type to the server, which parses it to cents. */
export function MoneyInput({
  value,
  onChange,
  ariaLabel = 'Amount',
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="money-input">
      <span>$</span>
      <input
        className="input"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,\-()]/g, ''))}
      />
    </div>
  );
}
