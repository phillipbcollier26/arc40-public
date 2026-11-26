/**
 * ECharts is tree-shaken: a feature used in an option but not registered in Chart.tsx is silently dropped.
 * (V2 Phase 3 found this: markLine was used by the Roth pace "Today" line and the What if FI lines, but
 * MarkLineComponent was never registered, so neither line showed.) This keeps the two lists in step.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const charts = fs.readFileSync(path.resolve('web/src/lib/charts.ts'), 'utf8');
const chart = fs.readFileSync(path.resolve('web/src/components/Chart.tsx'), 'utf8');

const FEATURES: [RegExp, string][] = [
  [/\bmarkLine\s*:/, 'MarkLineComponent'],
  [/\bmarkArea\s*:/, 'MarkAreaComponent'],
  [/\bvisualMap\s*:/, 'VisualMapComponent'],
  [/\bcalendar\s*:/, 'CalendarComponent'],
  [/\blegend\s*:/, 'LegendComponent'],
  [/type:\s*'bar'/, 'BarChart'],
  [/type:\s*'pie'/, 'PieChart'],
  [/type:\s*'treemap'/, 'TreemapChart'],
  [/type:\s*'heatmap'/, 'HeatmapChart'],
  [/type:\s*'line'/, 'LineChart'],
];

describe('every chart feature used in charts.ts is registered in Chart.tsx', () => {
  it.each(FEATURES.filter(([re]) => re.test(charts)).map(([, name]) => name))('%s is registered', (name) => {
    expect(chart).toMatch(new RegExp(`echarts\\.use\\(\\[[^\\]]*\\b${name}\\b`));
  });
});
