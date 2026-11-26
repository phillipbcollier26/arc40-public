/**
 * Planning settings for the whole app (V2 Phase 3): return rate, birth month, the future-you line switch and the
 * server's today. Loaded ONCE after login, again on window focus and after Settings saves (like work cost), so the
 * expense line on every Transactions row does not ask the server per row.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { PlanningSettings } from './types';

interface Ctx {
  planning: PlanningSettings | null;
  reload: () => void;
}

const PlanningContext = createContext<Ctx>({ planning: null, reload: () => {} });

export function PlanningProvider({ children }: { children: ReactNode }) {
  const [planning, setPlanning] = useState<PlanningSettings | null>(null);
  const reload = useCallback(() => {
    api<PlanningSettings>('GET', '/api/settings/planning')
      .then(setPlanning)
      .catch(() => {});
  }, []);
  useEffect(() => {
    reload();
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);
  return <PlanningContext.Provider value={{ planning, reload }}>{children}</PlanningContext.Provider>;
}

export function usePlanning(): Ctx {
  return useContext(PlanningContext);
}
