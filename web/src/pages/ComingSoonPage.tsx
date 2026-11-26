import type { LucideIcon } from 'lucide-react';

export function ComingSoonPage({
  title,
  milestone,
  icon: Icon,
  blurb,
}: {
  title: string;
  milestone: number;
  icon: LucideIcon;
  blurb: string;
}) {
  return (
    <div className="page">
      <header className="page-head rise">
        <div>
          <div className="label">Milestone {milestone}</div>
          <h1 className="page-title">{title}</h1>
        </div>
      </header>
      <div className="card empty rise" style={{ animationDelay: '60ms' }}>
        <div className="empty-icon">
          <Icon size={28} strokeWidth={1.5} />
        </div>
        <h3>Coming in Milestone {milestone}</h3>
        <p className="muted">{blurb}</p>
      </div>
    </div>
  );
}
