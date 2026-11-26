/** Arc40 mark: a gradient arc around a core dot. */
export function LogoMark({ size = 36, spin = false }: { size?: number; spin?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className={spin ? 'logo-spin' : undefined}>
      <defs>
        <linearGradient id="arc40-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--gold-bright)' }} />
          <stop offset="55%" style={{ stopColor: 'var(--gold)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--bronze)' }} />
        </linearGradient>
        <linearGradient id="arc40-core" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--platinum)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--pewter)' }} />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="19" fill="none" strokeWidth="3" style={{ stroke: 'var(--line-strong)' }} />
      <circle
        cx="24"
        cy="24"
        r="19"
        fill="none"
        stroke="url(#arc40-g)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray="88 120"
        transform="rotate(-210 24 24)"
      />
      <circle cx="24" cy="24" r="4" fill="url(#arc40-core)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      Arc<span className="gradient-text">40</span>
    </span>
  );
}
