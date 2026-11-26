import { Moon, Palette, Sun } from 'lucide-react';
import { Segmented } from './Controls';
import { THEME_OPTIONS, useTheme, type ThemeChoice } from '../lib/themeMode';

/** Sidebar sun/moon button: flips between Dark and Light (from Match Mac it picks the opposite of what shows). */
export function ThemeToggle() {
  const { resolved, change } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';
  const label = next === 'light' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button
      type="button"
      className="btn btn-ghost icon-btn theme-toggle"
      aria-label={label}
      title={label}
      onClick={(e) => change(next, e.currentTarget)}
    >
      {resolved === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

/** Settings card: Dark / Light / Match Mac. */
export function ThemeCard() {
  const { choice, change } = useTheme();
  return (
    <section className="card rise stack" style={{ animationDelay: '20ms' }}>
      <h3 className="icon-title">
        <Palette size={18} /> Appearance
      </h3>
      <p className="muted">
        Dark is the classic black and metals look. Light is the Platinum theme. Match Mac follows your Mac's appearance setting and
        switches with it. Your choice is saved for every tab, in real and demo mode.
      </p>
      <div>
        <Segmented<ThemeChoice>
          ariaLabel="Theme"
          value={choice}
          options={THEME_OPTIONS}
          // The clicked option has focus, so the reveal grows out of it.
          onChange={(v) => change(v, document.activeElement)}
        />
      </div>
    </section>
  );
}
