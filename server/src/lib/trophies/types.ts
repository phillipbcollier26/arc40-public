import type { IsoDate } from '../../../../shared/dates.js';

/** How close an On trophy is. `fraction` fills the bar (0..1); `score` sorts "closest" (holding > not yet at the line). */
export interface Progress {
  fraction: number;
  score: number;
  /** "$43,100 of $50,000", "Held 12 of 30 days", "3 of 5 years". */
  text: string;
  /** What is still needed, in plain words. */
  need: string | null;
}

export interface StoryPoint {
  date: IsoDate;
  cents: number;
}

/** The small "How you got there" chart. */
export interface Story {
  label: string;
  points: StoryPoint[];
  /** A dashed line (the trophy's line), if any. */
  lineCents: number | null;
}

export interface RecordEntry {
  /** 'YYYY-MM' or 'YYYY'. */
  period: string;
  amountCents: number;
  setOn: IsoDate;
}

export interface Award {
  date: IsoDate;
  /** One plain sentence about what happened. */
  sentence: string;
  story: Story | null;
}

export interface RuleOutcome {
  /** The first time it qualified (respecting Start from today). */
  earned: Award | null;
  progress: Progress;
  /** Set when the trophy cannot be earned until the user does something ("Enter the limit for 2026 first."). */
  blocked: string | null;
  /** Record plaques: every record from the earning one on, oldest first. */
  records?: RecordEntry[];
  /** For the close-up of a trophy that is not earned yet. */
  story: Story | null;
}

/** What a rule gets: `from` = the turn-on day in Start from today mode, else null. */
export interface RuleArgs {
  today: IsoDate;
  from: IsoDate | null;
  year: number | null;
}
