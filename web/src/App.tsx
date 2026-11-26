import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { api, scheduleTrophyCheck, setCsrfToken, setOnAuthLost, setTabMode, type AuthStatus, type Mode } from './lib/api';
import { ModeContext } from './lib/demo';
import { broadcast, onTabMessage } from './lib/tabSync';
import {
  resolveTheme,
  runThemeTransition,
  setDocumentTheme,
  systemQuery,
  ThemeContext,
  type ThemeChoice,
  type ThemeState,
} from './lib/themeMode';
import { useIdleLock } from './lib/useIdleLock';
import { AuthScreen } from './pages/AuthScreen';
import { Shell } from './components/Shell';
import { WorkCostProvider } from './lib/workCost';
import { PlanningProvider } from './lib/planning';
import { DashboardPage } from './pages/DashboardPage';
import { AccountsPage } from './pages/AccountsPage';
import { AccountDetailPage } from './pages/AccountDetailPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { ImportPage } from './pages/ImportPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { BudgetPage } from './pages/BudgetPage';
import { RecurringPage } from './pages/RecurringPage';
import { InvestmentsPage } from './pages/InvestmentsPage';
import { GoalsPage } from './pages/GoalsPage';
import { WhatIfPage } from './pages/WhatIfPage';
import { TrophiesPage } from './pages/TrophiesPage';
import { SettingsPage } from './pages/SettingsPage';
import { LogoMark } from './components/Logo';
import { UnlockProvider } from './components/TrophyUnlock';

// Dev-only trophy drawing preview (#/dev/trophies). In a production build this is `null` and the file is left out.
const TrophyPreview = import.meta.env.DEV ? lazy(() => import('./trophies/TrophyPreview')) : null;

type Phase = 'loading' | 'setup' | 'login' | 'app';

export function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [timeout, setTimeoutMinutes] = useState(60);
  const [mode, setMode] = useState<Mode>('real');
  const [themeChoice, setThemeChoice] = useState<ThemeChoice>('dark');
  const [systemDark, setSystemDark] = useState(() => systemQuery().matches);
  const choiceRef = useRef(themeChoice);
  choiceRef.current = themeChoice;

  // The login screen is always dark (it shows before login, so it cannot read the saved choice).
  const resolved = phase === 'app' ? resolveTheme(themeChoice, systemDark) : 'dark';
  // Set on <html> DURING render, before the pages below render: charts read the color tokens
  // while building their options, so the attribute must already be the new theme by then.
  setDocumentTheme(resolved);

  const refresh = useCallback(async () => {
    const s = await api<AuthStatus>('GET', '/api/auth/status');
    setTimeoutMinutes(s.idleTimeoutMinutes);
    setCsrfToken(s.csrfToken);
    setMode(s.mode);
    setTabMode(s.mode);
    if (s.theme) setThemeChoice(s.theme);
    setPhase(s.setupRequired ? 'setup' : s.authenticated ? 'app' : 'login');
  }, []);

  // Trophies: check the On trophies once each time the app opens after login (a 30-day hold can finish just by time passing).
  useEffect(() => {
    if (phase === 'app') scheduleTrophyCheck(3000);
  }, [phase]);

  useEffect(() => {
    setOnAuthLost(() => {
      setCsrfToken(null);
      setNotice('Your session ended. Log in again to continue.');
      setPhase('login');
    });
    refresh().catch(() => setPhase('login'));
    // Another tab switched between real and demo data: reload so this tab shows the new mode.
    // Another tab changed the theme: follow it with a quick fade.
    const offTabs = onTabMessage((msg) => {
      if (msg.type === 'mode-changed') window.location.reload();
      if (msg.type === 'theme-changed' && msg.theme !== choiceRef.current) {
        runThemeTransition(() => flushSync(() => setThemeChoice(msg.theme as ThemeChoice)));
      }
    });
    // Match Mac: follow the macOS appearance live.
    const mq = systemQuery();
    const onSystem = (e: MediaQueryListEvent) => runThemeTransition(() => flushSync(() => setSystemDark(e.matches)));
    mq.addEventListener('change', onSystem);
    return () => {
      offTabs();
      mq.removeEventListener('change', onSystem);
    };
  }, [refresh]);

  // Coming back to a tab: pick up a theme changed in another browser (BroadcastChannel only reaches
  // tabs of the same browser).
  useEffect(() => {
    if (phase !== 'app') return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      api<{ theme: ThemeChoice }>('GET', '/api/preferences')
        .then((p) => {
          if (p.theme !== choiceRef.current) runThemeTransition(() => flushSync(() => setThemeChoice(p.theme)));
        })
        .catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [phase]);

  const theme = useMemo<ThemeState>(
    () => ({
      choice: themeChoice,
      resolved,
      change: (next, origin) => {
        const prev = choiceRef.current;
        if (next === prev) return;
        runThemeTransition(() => flushSync(() => setThemeChoice(next)), origin);
        api('PUT', '/api/preferences', { theme: next })
          .then(() => broadcast({ type: 'theme-changed', theme: next }))
          .catch(() => runThemeTransition(() => flushSync(() => setThemeChoice(prev))));
      },
    }),
    [themeChoice, resolved],
  );

  const lock = useCallback(
    async (reason?: string) => {
      await api('POST', '/api/auth/logout').catch(() => {});
      setCsrfToken(null);
      setNotice(reason ?? null);
      setPhase('login');
    },
    [],
  );

  const onIdle = useCallback(() => {
    void lock('Locked after inactivity.');
  }, [lock]);

  if (phase === 'loading') {
    return (
      <div className="auth-wrap">
        <LogoMark size={56} spin />
      </div>
    );
  }
  if (phase === 'setup' || phase === 'login') {
    return (
      <>
        <div className="ambient" />
        <AuthScreen
          mode={phase}
          demo={mode === 'demo'}
          notice={notice}
          onDone={(token) => {
            setCsrfToken(token);
            setNotice(null);
            void refresh();
          }}
        />
      </>
    );
  }

  return (
    <ThemeContext.Provider value={theme}>
    <ModeContext.Provider value={mode}>
      <div className="ambient" />
      <IdleLock timeout={timeout} onIdle={onIdle} />
      <WorkCostProvider>
      <PlanningProvider>
      <HashRouter>
        <UnlockProvider>
        <Routes>
          <Route element={<Shell onLock={() => void lock()} />}>
            <Route index element={<DashboardPage />} />
            <Route path="accounts" element={<AccountsPage />} />
            <Route path="accounts/:id" element={<AccountDetailPage />} />
            <Route path="transactions" element={<TransactionsPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="categories" element={<CategoriesPage />} />
            <Route path="budget" element={<BudgetPage />} />
            <Route path="recurring" element={<RecurringPage />} />
            <Route path="investments" element={<InvestmentsPage />} />
            <Route path="goals" element={<GoalsPage />} />
            <Route path="what-if" element={<WhatIfPage />} />
            <Route path="trophies" element={<TrophiesPage />} />
            {TrophyPreview && (
              <Route
                path="dev/trophies"
                element={
                  <Suspense fallback={null}>
                    <TrophyPreview />
                  </Suspense>
                }
              />
            )}
            <Route
              path="settings"
              element={<SettingsPage idleTimeoutMinutes={timeout} onTimeoutChange={setTimeoutMinutes} />}
            />
          </Route>
        </Routes>
        </UnlockProvider>
      </HashRouter>
      </PlanningProvider>
      </WorkCostProvider>
    </ModeContext.Provider>
    </ThemeContext.Provider>
  );
}

function IdleLock({ timeout, onIdle }: { timeout: number; onIdle: () => void }) {
  useIdleLock(timeout, onIdle);
  return null;
}
