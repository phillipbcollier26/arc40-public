import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowLeftRight,
  FlaskConical,
  Trophy,
  Gauge,
  Goal,
  Landmark,
  LineChart,
  Lock,
  PieChart,
  Repeat,
  Settings,
} from 'lucide-react';
import { LogoMark, Wordmark } from './Logo';
import { DemoPill, DemoToggle } from './DemoControls';
import { ThemeToggle } from './ThemeControls';
import { useMode } from '../lib/demo';

export const NAV = [
  { to: '/', label: 'Dashboard', icon: Gauge },
  { to: '/accounts', label: 'Accounts', icon: Landmark },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/budget', label: 'Budget', icon: PieChart },
  { to: '/recurring', label: 'Recurring', icon: Repeat },
  { to: '/investments', label: 'Investments', icon: LineChart },
  { to: '/goals', label: 'Goals', icon: Goal },
  { to: '/what-if', label: 'What if', icon: FlaskConical },
  { to: '/trophies', label: 'Trophies', icon: Trophy },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

/** Pages that live "under" a nav item, so it stays highlighted there. */
const CHILD_PATHS: Record<string, string[]> = { '/transactions': ['/import', '/categories'] };

export function Shell({ onLock }: { onLock: () => void }) {
  const { pathname } = useLocation();
  const mode = useMode();
  return (
    <div className={`shell ${mode === 'demo' ? 'is-demo' : ''}`}>
      {mode === 'demo' && <div className="demo-bar" aria-hidden="true" />}
      <aside className="sidebar">
        <div className="brand">
          <LogoMark size={30} />
          <Wordmark />
        </div>
        <nav className="nav">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `nav-item ${isActive || CHILD_PATHS[to]?.some((p) => pathname.startsWith(p)) ? 'active' : ''}`
              }
            >
              <Icon size={18} strokeWidth={1.75} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          {mode === 'demo' && <DemoPill />}
          <div className="local-pill">
            <span className="dot" /> Local only · 127.0.0.1
          </div>
          <DemoToggle variant="sidebar" />
          <div className="side-row">
            <button className="btn btn-ghost lock-btn side-btn" onClick={onLock}>
              <Lock size={16} /> Lock
            </button>
            <ThemeToggle />
          </div>
        </div>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
