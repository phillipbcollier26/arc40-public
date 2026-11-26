/**
 * Dark / Light ("Platinum") / Match Mac. The choice is saved on the server (data/preferences.json)
 * so every tab and browser agrees. `data-theme` on <html> picks the token set in tokens.css.
 *
 * Switch animation (Chrome's View Transitions API):
 *   1. a circle of the new theme grows out of the button you clicked (460 ms), then
 *   2. a thin gold-and-platinum light sweep crosses the screen (240 ms).
 * Reduced motion, Match Mac following the system, or a change from another tab: a quick 160 ms
 * cross-fade instead. Browsers without View Transitions just swap.
 */
import { createContext, useContext } from 'react';

export type ThemeChoice = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'Match Mac' },
];

export const systemQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): ResolvedTheme {
  return choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;
}

/** Sets the token set on <html>. Safe to call repeatedly. */
export function setDocumentTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  if (root.dataset.theme !== theme) root.dataset.theme = theme;
}

export interface ThemeState {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  /** Changes and saves the theme. `origin` is the control that was clicked (the reveal grows from it). */
  change: (next: ThemeChoice, origin?: Element | null) => void;
}

export const ThemeContext = createContext<ThemeState>({ choice: 'dark', resolved: 'dark', change: () => {} });
export const useTheme = () => useContext(ThemeContext);

/**
 * The active theme, for charts. Chart options built in `useMemo` MUST list this in their
 * dependencies, or they keep the previous theme's colors (theme.ts reads the tokens when called).
 */
export const useChartTheme = () => useContext(ThemeContext).resolved;

type VTDocument = Document & {
  startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> };
};

const REVEAL_MS = 460;

/**
 * Runs `apply` (which must update the DOM synchronously, e.g. with flushSync) inside the switch
 * animation. With an `origin` element: circular reveal + sheen. Without: a quick cross-fade.
 */
export function runThemeTransition(apply: () => void, origin?: Element | null): void {
  const doc = document as VTDocument;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!doc.startViewTransition || document.visibilityState !== 'visible') {
    apply();
    return;
  }
  const root = document.documentElement;
  const rect = origin?.getBoundingClientRect();
  const reveal = !!rect && !reduce;
  root.dataset.themeAnim = reveal ? 'reveal' : 'fade';
  const t = doc.startViewTransition(apply);
  if (reveal && rect) {
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    t.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
          { duration: REVEAL_MS, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
        );
      })
      .catch(() => {});
    t.finished.then(sheen, () => {});
  }
  t.finished.finally(() => delete root.dataset.themeAnim).catch(() => {});
}

/** A short metallic light sweep across the whole window (pure decoration, removed when done). */
function sheen(): void {
  const el = document.createElement('div');
  el.className = 'theme-sheen';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  const done = () => el.remove();
  el.addEventListener('animationend', done);
  window.setTimeout(done, 800);
}
