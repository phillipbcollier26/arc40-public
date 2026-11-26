/**
 * Work cost settings for the whole app (V2 Phase 3). Loaded ONCE after login (not per row), refreshed when the
 * window regains focus (the user keeps several tabs open) and after Settings saves. Mode changes reload the page,
 * so demo mode always shows the demo's own fake pay.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { WorkJob, WorkRate } from '../../../shared/workCost';

export interface WorkCostState {
  refPayPerGameCents: number | null;
  jobs: WorkJob[];
  selection: string;
  active: WorkRate | null;
}

interface Ctx {
  state: WorkCostState | null;
  reload: () => void;
}

const WorkCostContext = createContext<Ctx>({ state: null, reload: () => {} });

export function WorkCostProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WorkCostState | null>(null);
  const reload = useCallback(() => {
    api<WorkCostState>('GET', '/api/work-cost')
      .then(setState)
      .catch(() => {});
  }, []);
  useEffect(() => {
    reload();
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);
  return <WorkCostContext.Provider value={{ state, reload }}>{children}</WorkCostContext.Provider>;
}

/** The rate every screen converts spending with, or null when work cost is Off. */
export function useWorkRate(): WorkRate | null {
  return useContext(WorkCostContext).state?.active ?? null;
}

export function useWorkCost(): Ctx {
  return useContext(WorkCostContext);
}
