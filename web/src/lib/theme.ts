/**
 * Chart colors come from the CSS tokens in tokens.css, so a future theme change
 * updates charts automatically. Never hard-code colors here.
 */

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Adds an alpha channel to a 6-digit hex token value (gold + 0.4 opacity gives the 8-digit hex form). */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  // The production build may write a 6-digit token in its 3-digit short form: expand it first.
  const full = /^#[0-9a-fA-F]{3,4}$/.test(hex) ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  return `${full.slice(0, 7)}${a}`;
}

/** Series colors, in order: alternate light and warm tones so neighbors are easy to tell apart. */
export const SERIES_TOKENS = [
  '--gold',
  '--silver',
  '--bronze',
  '--sage', // 4th so it never sits next to silver/platinum (two near-white lines looked alike)
  '--copper',
  '--platinum',
  '--gold-bright',
  '--pewter',
] as const;

export function seriesColor(index: number): string {
  return cssVar(SERIES_TOKENS[index % SERIES_TOKENS.length]!);
}

/** Shared look for every chart: fonts, axes, tooltip. */
export function chartBase() {
  const text2 = cssVar('--text-2');
  const line = cssVar('--line');
  return {
    textStyle: { fontFamily: cssVar('--font-body'), color: text2 },
    animationDuration: 1100,
    animationEasing: 'cubicOut' as const,
    tooltip: {
      backgroundColor: cssVar('--glass-strong'),
      borderColor: cssVar('--line-strong'),
      borderWidth: 1,
      padding: [10, 14],
      textStyle: { color: cssVar('--text-0'), fontFamily: cssVar('--font-body'), fontSize: 13 },
      extraCssText: 'backdrop-filter: blur(14px); border-radius: 12px; box-shadow: var(--shadow-card);',
    },
    axisLabel: { color: cssVar('--text-3'), fontFamily: cssVar('--font-mono'), fontSize: 11 },
    splitLine: { lineStyle: { color: line, type: [3, 5] as number[] } },
  };
}
