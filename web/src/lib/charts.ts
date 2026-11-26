/**
 * ECharts option builders. Data is integer cents end to end; labels are made
 * with the integer formatters in format.ts. Colors come from tokens via theme.ts.
 */
import type { EChartsCoreOption } from 'echarts/core';
import { echarts } from '../components/Chart';
import { chartBase, cssVar, seriesColor, withAlpha } from './theme';
import { escapeHtml, formatBasisPoints, formatCents, formatCompactCents, formatDate } from './format';
import type { NetWorth } from './types';

function verticalFade(hex: string, top: number, bottom = 0) {
  return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
    { offset: 0, color: withAlpha(hex, top) },
    { offset: 1, color: withAlpha(hex, bottom) },
  ]);
}

function timeAxes(base: ReturnType<typeof chartBase>) {
  return {
    xAxis: {
      type: 'time',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        ...base.axisLabel,
        hideOverlap: true,
        formatter: (v: number) => {
          const d = new Date(v);
          return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
        },
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { ...base.axisLabel, formatter: (v: number) => formatCompactCents(v) },
      splitLine: base.splitLine,
    },
  };
}

const dateOf = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getTime();
};
const isoOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------- V2 Phase 2: price states on investment charts ----------

export type PriceState = 'known' | 'estimated' | 'stale' | 'unavailable';
export interface PriceStatePoint {
  date: string;
  priceState?: PriceState | null;
  staleDays?: number;
  estimated?: string[];
  stale?: string[];
  missing?: string[];
}

/** Shaded bands behind a chart: estimated (silver), stale (bronze), no price data (pewter). */
export const PRICE_STATE_STYLE: Record<Exclude<PriceState, 'known'>, { token: string; alpha: number; label: string }> = {
  estimated: { token: '--silver', alpha: 0.12, label: 'Estimated prices' },
  stale: { token: '--bronze', alpha: 0.16, label: 'Stale prices' },
  unavailable: { token: '--pewter', alpha: 0.2, label: 'No price data' },
};

/** Runs of days with the same non-known state, as ECharts markArea ranges. */
export function priceStateAreas(points: readonly PriceStatePoint[]) {
  const areas: [Record<string, unknown>, Record<string, unknown>][] = [];
  let i = 0;
  while (i < points.length) {
    const s = points[i]!.priceState;
    if (!s || s === 'known') {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < points.length && points[j + 1]!.priceState === s) j++;
    const st = PRICE_STATE_STYLE[s];
    const end = points[Math.min(j + 1, points.length - 1)]!.date;
    areas.push([{ xAxis: dateOf(points[i]!.date), itemStyle: { color: withAlpha(cssVar(st.token), st.alpha) } }, { xAxis: dateOf(end) }]);
    i = j + 1;
  }
  return { silent: true, data: areas };
}

/** One plain-language line for a tooltip, or '' when every price that day was real. */
export function priceStateNote(p: PriceStatePoint | undefined): string {
  if (!p?.priceState || p.priceState === 'known') return '';
  const list = (xs?: string[]) => escapeHtml((xs ?? []).join(', '));
  if (p.priceState === 'unavailable') {
    return `<div class="tt-note tt-note-unavailable">No price data for ${list(p.missing)}: showing money put in, not market value</div>`;
  }
  const parts: string[] = [];
  if (p.stale?.length) parts.push(`Stale: last real price for ${list(p.stale)} is ${p.staleDays} days old`);
  if (p.estimated?.length) parts.push(`Estimated: ${list(p.estimated)} drawn straight between two real prices`);
  return `<div class="tt-note tt-note-${p.priceState}">${parts.join('<br>')}</div>`;
}

/** Net worth over time: one glowing gold area, or stacked areas by account. */
export function netWorthOption(nw: NetWorth, mode: 'total' | 'accounts'): EChartsCoreOption {
  const base = chartBase();
  const nwByDate = new Map<string, PriceStatePoint>(nw.series.map((p) => [p.date, p]));
  const gold = cssVar('--gold');
  const axes = timeAxes(base);

  if (mode === 'total') {
    return {
      ...base,
      grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
      ...axes,
      tooltip: {
        ...base.tooltip,
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: withAlpha(gold, 0.5), width: 1 } },
        formatter: (params: { value: [number, number] }[]) => {
          const p = params[0]!;
          const note = priceStateNote(nwByDate.get(isoOf(p.value[0])));
          return `<div class="tt-date">${formatDate(isoOf(p.value[0]))}</div><div class="tt-big">${formatCents(p.value[1])}</div>${note ? note.replace('tt-note', 'tt-note tt-note-small') : ''}`;
        },
      },
      series: [
        {
          type: 'line',
          name: 'Net worth',
          data: nw.series.map((p) => [dateOf(p.date), p.totalCents]),
          showSymbol: false,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { width: 2.5, color: gold, shadowColor: withAlpha(gold, 0.55), shadowBlur: 14 },
          itemStyle: { color: gold, borderColor: cssVar('--bg-0'), borderWidth: 2 },
          areaStyle: { color: verticalFade(gold, 0.32, 0) },
          emphasis: { focus: 'none' },
        },
      ],
    };
  }

  const ids = nw.accounts.map((a) => a.id);
  return {
    ...base,
    grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
    ...axes,
    yAxis: { ...axes.yAxis, scale: false },
    legend: {
      top: 0,
      left: 0,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: cssVar('--text-2'), fontFamily: cssVar('--font-body') },
    },
    tooltip: {
      ...base.tooltip,
      trigger: 'axis',
      formatter: (params: { seriesName: string; color: string; value: [number, number] }[]) => {
        const rows = params
          .filter((p) => p.value[1] !== 0)
          .map(
            (p) =>
              `<div class="tt-row"><span class="tt-dot" style="background:${p.color}"></span>${escapeHtml(p.seriesName)}<b>${formatCents(p.value[1])}</b></div>`,
          )
          .join('');
        const total = params.reduce((s, p) => s + p.value[1], 0);
        return `<div class="tt-date">${formatDate(isoOf(params[0]!.value[0]))}</div>${rows}<div class="tt-row tt-total">Total<b>${formatCents(total)}</b></div>`;
      },
    },
    series: nw.accounts.map((a) => {
      const color = seriesColor(ids.indexOf(a.id));
      return {
        type: 'line',
        name: a.name,
        // NOT stacked: each line sits at that account's own balance (a stacked top layer looked
        // like the Roth IRA held the whole total).
        data: nw.series.map((p) => [dateOf(p.date), p.byAccount[a.id] ?? 0]),
        showSymbol: false,
        lineStyle: { width: 2, color, shadowColor: withAlpha(color, 0.4), shadowBlur: 8 },
        itemStyle: { color },
        areaStyle: { color: verticalFade(color, 0.14, 0) },
      };
    }),
  };
}

/** Where the money sits: donut by group (cash, investments, debt). */
export function allocationOption(nw: NetWorth): EChartsCoreOption {
  const base = chartBase();
  const colors: Record<string, string> = {
    cash: cssVar('--silver'),
    investments: cssVar('--gold'),
    debt: cssVar('--garnet'),
  };
  const total = nw.allocation.reduce((s, a) => s + a.cents, 0);
  return {
    ...base,
    tooltip: {
      ...base.tooltip,
      trigger: 'item',
      formatter: (p: { name: string; value: number; percent: number }) =>
        `<div class="tt-date">${escapeHtml(p.name)}</div><div class="tt-big">${formatCents(p.value)}</div><div class="tt-sub">${Math.round(p.percent)}% of total</div>`,
    },
    series: [
      {
        type: 'pie',
        radius: ['66%', '84%'],
        center: ['50%', '50%'],
        padAngle: 3,
        itemStyle: { borderRadius: 6 },
        label: { show: false },
        emphasis: { scale: true, scaleSize: 6 },
        animationType: 'expansion',
        data: nw.allocation.map((a) => ({
          name: a.label,
          value: a.cents,
          itemStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 1, 1, [
              { offset: 0, color: colors[a.group]! },
              { offset: 1, color: withAlpha(colors[a.group]!, 0.55) },
            ]),
            shadowBlur: 18,
            shadowColor: withAlpha(colors[a.group]!, 0.35),
          },
        })),
      },
    ],
    graphic: [
      {
        type: 'text',
        left: 'center',
        top: '40%',
        style: { text: 'TOTAL', fill: cssVar('--text-3'), font: `500 11px ${cssVar('--font-mono')}`, letterSpacing: 2 } as object,
      },
      {
        type: 'text',
        left: 'center',
        top: '50%',
        style: { text: formatCompactCents(total), fill: cssVar('--text-0'), font: `600 22px ${cssVar('--font-display')}` },
      },
    ],
  };
}

/** One account's balance history. */
export function balanceOption(points: ({ date: string; cents: number } & PriceStatePoint)[], toneToken = '--gold'): EChartsCoreOption {
  const base = chartBase();
  const byDate = new Map(points.map((p) => [p.date, p]));
  const color = cssVar(toneToken);
  const axes = timeAxes(base);
  return {
    ...base,
    grid: { left: 8, right: 16, top: 20, bottom: 8, containLabel: true },
    ...axes,
    tooltip: {
      ...base.tooltip,
      trigger: 'axis',
      formatter: (params: { value: [number, number] }[]) => {
        const p = params[0]!;
        return `<div class="tt-date">${formatDate(isoOf(p.value[0]))}</div><div class="tt-big">${formatCents(p.value[1])}</div>${priceStateNote(byDate.get(isoOf(p.value[0])))}`;
      },
    },
    series: [
      {
        type: 'line',
        markArea: priceStateAreas(points),
        data: points.map((p) => [dateOf(p.date), p.cents]),
        showSymbol: points.length < 40,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2.5, color, shadowColor: withAlpha(color, 0.5), shadowBlur: 12 },
        itemStyle: { color, borderColor: cssVar('--bg-0'), borderWidth: 2 },
        areaStyle: { color: verticalFade(color, 0.28, 0) },
      },
    ],
  };
}

// ---------- Milestone 4 ----------

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (iso: string) => `${MONTH_ABBR[Number(iso.slice(5, 7)) - 1]} '${iso.slice(2, 4)}`;

/** Income vs spending bars per month, with the savings rate as a gold line (right axis). */
export function cashflowOption(months: import('./types').CashflowMonth[]): EChartsCoreOption {
  const base = chartBase();
  const sage = cssVar('--sage');
  const garnet = cssVar('--garnet');
  const gold = cssVar('--gold');
  const bar = (hex: string) =>
    new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: hex },
      { offset: 1, color: withAlpha(hex, 0.35) },
    ]);
  return {
    ...base,
    grid: { left: 8, right: 8, top: 40, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: cssVar('--text-2') } },
    tooltip: {
      ...base.tooltip,
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: withAlpha(gold, 0.06) } },
      formatter: (ps: { dataIndex: number }[]) => {
        const m = months[ps[0]!.dataIndex]!;
        const rate = m.savingsRateBp === null ? 'No income' : formatBasisPoints(m.savingsRateBp, { sign: false });
        return `<div class="tt-date">${monthLabel(m.month)}</div>
          <div class="tt-row"><span class="tt-dot" style="background:${sage}"></span>Income<b>${formatCents(m.incomeCents)}</b></div>
          <div class="tt-row"><span class="tt-dot" style="background:${garnet}"></span>Spending<b>${formatCents(m.spendingCents)}</b></div>
          <div class="tt-row tt-total">Savings rate<b>${rate}</b></div>`;
      },
    },
    xAxis: {
      type: 'category',
      data: months.map((m) => monthLabel(m.month)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: base.axisLabel,
    },
    yAxis: [
      { type: 'value', axisLabel: { ...base.axisLabel, formatter: (v: number) => formatCompactCents(v) }, splitLine: base.splitLine },
      {
        type: 'value',
        min: -10000,
        max: 10000,
        interval: 5000,
        axisLabel: { ...base.axisLabel, formatter: (v: number) => `${v / 100}%` },
        splitLine: { show: false },
      },
    ],
    series: [
      { name: 'Income', type: 'bar', data: months.map((m) => m.incomeCents), barMaxWidth: 18, itemStyle: { color: bar(sage), borderRadius: [4, 4, 0, 0] } },
      { name: 'Spending', type: 'bar', data: months.map((m) => m.spendingCents), barMaxWidth: 18, itemStyle: { color: bar(garnet), borderRadius: [4, 4, 0, 0] } },
      {
        name: 'Savings rate',
        type: 'line',
        yAxisIndex: 1,
        // Clamp the line to -100%..100% so one bad month does not flatten the chart; the tooltip shows the real value.
        data: months.map((m) => {
          if (m.savingsRateBp === null) return null;
          const v = Math.max(-10000, Math.min(10000, m.savingsRateBp));
          // Off the scale: draw an arrow in garnet so it is clearly "beyond -100%", not exactly -100%.
          return v === m.savingsRateBp ? v : { value: v, symbol: 'triangle', symbolRotate: 180, symbolSize: 11, itemStyle: { color: garnet, borderColor: garnet } };
        }),
        connectNulls: false,
        smooth: 0.3,
        smoothMonotone: 'x', // never curve beyond the real points
        symbol: 'circle',
        symbolSize: 7,
        lineStyle: { width: 2.5, color: gold, shadowColor: withAlpha(gold, 0.5), shadowBlur: 10 },
        itemStyle: { color: gold, borderColor: cssVar('--bg-0'), borderWidth: 2 },
      },
    ],
  };
}

/** Spending by category for one month (category colors are token names). */
export function spendingDonutOption(rows: { name: string; color: string; cents: number }[]): EChartsCoreOption {
  const base = chartBase();
  const total = rows.reduce((s, r) => s + r.cents, 0);
  return {
    ...base,
    tooltip: {
      ...base.tooltip,
      trigger: 'item',
      formatter: (p: { name: string; value: number; percent: number }) =>
        `<div class="tt-date">${escapeHtml(p.name)}</div><div class="tt-big">${formatCents(p.value)}</div><div class="tt-sub">${Math.round(p.percent)}% of spending</div>`,
    },
    series: [
      {
        type: 'pie',
        radius: ['62%', '84%'],
        padAngle: 2,
        itemStyle: { borderRadius: 5 },
        label: { show: false },
        animationType: 'expansion',
        data: rows.map((r) => {
          const c = cssVar(`--${r.color}`) || cssVar('--pewter');
          return { name: r.name, value: r.cents, itemStyle: { color: c, shadowBlur: 12, shadowColor: withAlpha(c, 0.3) } };
        }),
      },
    ],
    graphic: [
      { type: 'text', left: 'center', top: '40%', style: { text: 'SPENT', fill: cssVar('--text-3'), font: `500 11px ${cssVar('--font-mono')}` } },
      { type: 'text', left: 'center', top: '50%', style: { text: formatCompactCents(total), fill: cssVar('--text-0'), font: `600 22px ${cssVar('--font-display')}` } },
    ],
  };
}

// ---------- Milestone 5 ----------

/** Investment value (gold area) vs money put in (silver step line). The gap is growth. */
export function growthOption(series: ({ date: string; valueCents: number; putInCents: number } & PriceStatePoint)[]): EChartsCoreOption {
  const base = chartBase();
  const byDate = new Map(series.map((p) => [p.date, p]));
  const gold = cssVar('--gold');
  const silver = cssVar('--silver');
  const axes = timeAxes(base);
  return {
    ...base,
    grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
    ...axes,
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: cssVar('--text-2') } },
    tooltip: {
      ...base.tooltip,
      trigger: 'axis',
      formatter: (ps: { value: [number, number] }[]) => {
        const v = ps[0]?.value[1] ?? 0;
        const p = ps[1]?.value[1] ?? 0;
        return `<div class="tt-date">${formatDate(isoOf(ps[0]!.value[0]))}</div>
          <div class="tt-row"><span class="tt-dot" style="background:${gold}"></span>Value<b>${formatCents(v)}</b></div>
          <div class="tt-row"><span class="tt-dot" style="background:${silver}"></span>Money put in<b>${formatCents(p)}</b></div>
          <div class="tt-row tt-total">Growth<b>${formatCents(v - p, { sign: true })}</b></div>
          ${priceStateNote(byDate.get(isoOf(ps[0]!.value[0])))}`;
      },
    },
    series: [
      {
        name: 'Value',
        type: 'line',
        markArea: priceStateAreas(series),
        data: series.map((p) => [dateOf(p.date), p.valueCents]),
        showSymbol: false,
        lineStyle: { width: 2.5, color: gold, shadowColor: withAlpha(gold, 0.5), shadowBlur: 12 },
        itemStyle: { color: gold },
        areaStyle: { color: verticalFade(gold, 0.3, 0) },
      },
      {
        name: 'Money put in',
        type: 'line',
        step: 'end',
        data: series.map((p) => [dateOf(p.date), p.putInCents]),
        showSymbol: false,
        lineStyle: { width: 1.5, color: silver, type: [6, 4] },
        itemStyle: { color: silver },
      },
    ],
  };
}

/** Generic donut with metal series colors (holdings mix). */
export function mixDonutOption(rows: { name: string; cents: number }[], centerLabel: string): EChartsCoreOption {
  const base = chartBase();
  const total = rows.reduce((s, r) => s + r.cents, 0);
  return {
    ...base,
    tooltip: {
      ...base.tooltip,
      trigger: 'item',
      formatter: (p: { name: string; value: number; percent: number }) =>
        `<div class="tt-date">${escapeHtml(p.name)}</div><div class="tt-big">${formatCents(p.value)}</div><div class="tt-sub">${Math.round(p.percent)}%</div>`,
    },
    series: [
      {
        type: 'pie',
        radius: ['62%', '84%'],
        padAngle: 2,
        itemStyle: { borderRadius: 5 },
        label: { show: false },
        animationType: 'expansion',
        data: rows.map((r, i) => {
          const c = seriesColor(i);
          return { name: r.name, value: r.cents, itemStyle: { color: c, shadowBlur: 12, shadowColor: withAlpha(c, 0.3) } };
        }),
      },
    ],
    graphic: [
      { type: 'text', left: 'center', top: '40%', style: { text: centerLabel, fill: cssVar('--text-3'), font: `500 11px ${cssVar('--font-mono')}` } },
      { type: 'text', left: 'center', top: '50%', style: { text: formatCompactCents(total), fill: cssVar('--text-0'), font: `600 22px ${cssVar('--font-display')}` } },
    ],
  };
}

// ---------- Milestone 6: dashboard ----------

const tokenColor = (name: string) => cssVar(`--${name}`) || cssVar('--pewter');

/** Spending by category as a treemap, grouped by category group. */
export function treemapOption(rows: { name: string; group: string; color: string; cents: number }[]): EChartsCoreOption {
  const base = chartBase();
  const groups = [...new Set(rows.map((r) => r.group))];
  const total = rows.reduce((s, r) => s + r.cents, 0);
  return {
    ...base,
    tooltip: {
      ...base.tooltip,
      formatter: (p: { name: string; value: number; treePathInfo: { name: string }[] }) =>
        `<div class="tt-date">${p.treePathInfo.length > 2 ? escapeHtml(p.treePathInfo[1]!.name) : 'Group'}</div><div class="tt-big">${escapeHtml(p.name)}</div><div class="tt-sub">${formatCents(p.value)} · ${total ? Math.round((p.value * 100) / total) : 0}%</div>`,
    },
    series: [
      {
        type: 'treemap',
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        width: '100%',
        height: '100%',
        top: 0,
        left: 0,
        itemStyle: { borderColor: cssVar('--bg-0'), borderWidth: 2, gapWidth: 2, borderRadius: 6 },
        upperLabel: { show: false },
        label: {
          show: true,
          // Tiny tiles get no label (hover still shows them), so names never get squeezed into slivers.
          formatter: (p: { name: string; value: number }) => (total && p.value * 25 < total ? '' : `{n|${p.name}}\n{v|${formatCompactCents(p.value)}}`),
          overflow: 'truncate',
          rich: {
            n: { color: cssVar('--tile-text'), fontFamily: cssVar('--font-body'), fontSize: 12, fontWeight: 600, textShadowColor: cssVar('--tile-text-shadow'), textShadowBlur: 4 },
            v: { color: cssVar('--tile-text-2'), fontFamily: cssVar('--font-mono'), fontSize: 11, padding: [4, 0, 0, 0], textShadowColor: cssVar('--tile-text-shadow'), textShadowBlur: 4 },
          },
        },
        levels: [{ itemStyle: { borderWidth: 0, gapWidth: 4 } }, { itemStyle: { gapWidth: 2 } }],
        // Tile depth is per theme: deep tiles with white text on light, translucent on black.
        data: groups.map((g) => ({
          name: g,
          children: rows
            .filter((r) => r.group === g)
            .map((r) => {
              const c = tokenColor(r.color);
              return {
                name: r.name,
                value: r.cents,
                itemStyle: {
                  color: new echarts.graphic.LinearGradient(0, 0, 1, 1, [
                    { offset: 0, color: withAlpha(c, Number(cssVar('--tile-alpha-from'))) },
                    { offset: 1, color: withAlpha(c, Number(cssVar('--tile-alpha-to'))) },
                  ]),
                },
              };
            }),
        })),
      },
    ],
  };
}

/** Daily spending calendar (last 365 days): the --heat-* tokens run from little to a lot (brighter on dark, deeper on light). */
export function calendarOption(daily: { date: string; cents: number }[], from: string, to: string): EChartsCoreOption {
  const base = chartBase();
  const max = Math.max(1, ...daily.map((d) => d.cents));
  return {
    ...base,
    tooltip: {
      ...base.tooltip,
      formatter: (p: { value: [string, number] }) => `<div class="tt-date">${formatDate(p.value[0])}</div><div class="tt-big">${formatCents(p.value[1])}</div>`,
    },
    visualMap: {
      show: false,
      min: 0,
      max,
      inRange: { color: [cssVar('--bg-3'), cssVar('--heat-1'), cssVar('--heat-2'), cssVar('--heat-3')] },
    },
    calendar: {
      range: [from, to],
      top: 24,
      left: 30,
      right: 8,
      cellSize: ['auto', 14],
      splitLine: { show: false },
      itemStyle: { color: cssVar('--bg-2'), borderColor: cssVar('--bg-0'), borderWidth: 3 },
      yearLabel: { show: false },
      dayLabel: { firstDay: 0, nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'], color: cssVar('--text-3'), fontFamily: cssVar('--font-mono'), fontSize: 10 },
      monthLabel: { color: cssVar('--text-2'), fontFamily: cssVar('--font-mono'), fontSize: 10 },
    },
    series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: daily.map((d) => [d.date, d.cents]) }],
  };
}

/** Horizontal bars: refereeing pay by who paid you. */
export function payerOption(rows: { payer: string; cents: number }[]): EChartsCoreOption {
  const base = chartBase();
  const gold = cssVar('--gold');
  const r = [...rows].reverse();
  return {
    ...base,
    grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
    tooltip: { ...base.tooltip, trigger: 'axis', axisPointer: { type: 'none' }, formatter: (ps: { name: string; value: number }[]) => `<div class="tt-date">${escapeHtml(ps[0]!.name)}</div><div class="tt-big">${formatCents(ps[0]!.value)}</div>` },
    // hideOverlap: narrow cards squeezed "$1.2k$1.5k" together.
    xAxis: { type: 'value', axisLabel: { ...base.axisLabel, hideOverlap: true, formatter: (v: number) => formatCompactCents(v) }, splitLine: base.splitLine },
    yAxis: { type: 'category', data: r.map((x) => x.payer), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: cssVar('--text-1'), fontFamily: cssVar('--font-body') } },
    series: [
      {
        type: 'bar',
        data: r.map((x) => x.cents),
        barMaxWidth: 16,
        itemStyle: { borderRadius: [0, 6, 6, 0], color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: withAlpha(gold, 0.4) }, { offset: 1, color: gold }]) },
      },
    ],
  };
}

/** Stacked monthly income by source (shows refereeing seasons). */
export function incomeSourceOption(data: { months: string[]; sources: { name: string; color: string; cents: number[] }[] }): EChartsCoreOption {
  const base = chartBase();
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return {
    ...base,
    grid: { left: 8, right: 8, top: 36, bottom: 8, containLabel: true },
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: cssVar('--text-2') } },
    tooltip: {
      ...base.tooltip,
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: withAlpha(cssVar('--gold'), 0.06) } },
      formatter: (ps: { seriesName: string; value: number; color: string; dataIndex: number }[]) => {
        const rows = ps.filter((p) => p.value).map((p) => `<div class="tt-row"><span class="tt-dot" style="background:${p.color}"></span>${escapeHtml(p.seriesName)}<b>${formatCents(p.value)}</b></div>`).join('');
        const m = data.months[ps[0]!.dataIndex]!;
        return `<div class="tt-date">${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}</div>${rows || '<div class="tt-sub">No income</div>'}`;
      },
    },
    xAxis: { type: 'category', data: data.months.map((m) => `${MON[Number(m.slice(5, 7)) - 1]}`), axisLine: { show: false }, axisTick: { show: false }, axisLabel: base.axisLabel },
    yAxis: { type: 'value', axisLabel: { ...base.axisLabel, formatter: (v: number) => formatCompactCents(v) }, splitLine: base.splitLine },
    series: data.sources.map((s, i) => ({
      name: s.name,
      type: 'bar',
      stack: 'income',
      data: s.cents,
      barMaxWidth: 22,
      itemStyle: { color: tokenColor(s.color), borderRadius: i === data.sources.length - 1 ? [4, 4, 0, 0] : 0 },
    })),
  };
}

// ---------- V2 Phase 2: recurring charges ----------

/** Yearly cost by subscription: one slice each, colored by its metal tier (lighter for lower ranks within a tier). */
export function recurringDonutOption(rows: { name: string; cents: number; tier: 'gold' | 'silver' | 'bronze' }[]): EChartsCoreOption {
  const base = chartBase();
  const total = rows.reduce((s, r) => s + r.cents, 0);
  const seen: Record<string, number> = {};
  return {
    ...base,
    tooltip: {
      ...base.tooltip,
      trigger: 'item',
      formatter: (p: { name: string; value: number; percent: number }) =>
        `<div class="tt-date">${escapeHtml(p.name)}</div><div class="tt-big">${formatCents(p.value)} a year</div><div class="tt-sub">${Math.round(p.percent)}% of the total</div>`,
    },
    series: [
      {
        type: 'pie',
        radius: ['60%', '84%'],
        padAngle: 2,
        itemStyle: { borderRadius: 6 },
        label: { show: false },
        animationType: 'expansion',
        animationDuration: 900,
        animationEasing: 'cubicOut',
        data: rows.map((r) => {
          const i = (seen[r.tier] = (seen[r.tier] ?? -1) + 1);
          const c = cssVar(`--${r.tier}`);
          const color = withAlpha(c, Math.max(0.45, 1 - i * 0.2));
          return { name: r.name, value: r.cents, itemStyle: { color, shadowBlur: 14, shadowColor: withAlpha(c, 0.35) } };
        }),
      },
    ],
    graphic: [
      { type: 'text', left: 'center', top: '39%', style: { text: 'A YEAR', fill: cssVar('--text-3'), font: `500 11px ${cssVar('--font-mono')}` } },
      { type: 'text', left: 'center', top: '50%', style: { text: formatCompactCents(total), fill: cssVar('--text-0'), font: `600 22px ${cssVar('--font-display')}` } },
    ],
  };
}

// ---------- V2 Phase 3: Roth pace ----------

/**
 * Roth pace: actual contributions (gold steps) against the even pace from Jan 1 to the deadline
 * (platinum dashes), plus the earned-income cap (sage dashes) when it is below the limit, and today.
 */
export function rothPaceOption(p: import('./types').RothPace, today: string, earnedCapCents: number | null): EChartsCoreOption {
  const base = chartBase();
  const gold = cssVar('--gold');
  const plat = cssVar('--platinum');
  const sage = cssVar('--sage');
  const axes = timeAxes(base);
  const start = dateOf(p.start);
  const end = dateOf(p.deadline);
  const series: object[] = [
    {
      name: 'Contributed',
      type: 'line',
      step: 'end',
      data: p.actual.map((a) => [dateOf(a.date), a.cents]),
      showSymbol: false,
      lineStyle: { width: 2.5, color: gold, shadowColor: withAlpha(gold, 0.5), shadowBlur: 10 },
      itemStyle: { color: gold },
      areaStyle: { color: verticalFade(gold, 0.28, 0) },
      markLine:
        today >= p.start && today <= p.deadline
          ? {
              silent: true,
              symbol: 'none',
              label: { formatter: 'Today', color: cssVar('--text-2'), fontFamily: cssVar('--font-mono'), fontSize: 10 },
              lineStyle: { color: cssVar('--line-strong'), type: [2, 4], width: 1 },
              data: [{ xAxis: dateOf(today) }],
            }
          : undefined,
    },
    {
      name: 'Even pace',
      type: 'line',
      data: p.ideal.map((a) => [dateOf(a.date), a.cents]),
      showSymbol: false,
      lineStyle: { width: 1.5, color: plat, type: [6, 4] },
      itemStyle: { color: plat },
    },
  ];
  if (earnedCapCents !== null) {
    series.push({
      name: 'Earned so far',
      type: 'line',
      data: [
        [start, earnedCapCents],
        [end, earnedCapCents],
      ],
      showSymbol: false,
      lineStyle: { width: 1.2, color: sage, type: [2, 4] },
      itemStyle: { color: sage },
    });
  }
  return {
    ...base,
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    ...axes,
    xAxis: { ...axes.xAxis, min: start, max: end },
    yAxis: { ...axes.yAxis, scale: false, min: 0 },
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: cssVar('--text-2') } },
    tooltip: {
      ...base.tooltip,
      trigger: 'axis',
      formatter: (ps: { seriesName: string; value: [number, number]; color: string }[]) => {
        const d = isoOf(ps[0]!.value[0]);
        // The pace line at that day (straight by days), so the tooltip compares like for like.
        const day = (t: number) => Math.round(t / 86_400_000);
        const total = day(end) - day(start);
        const done = Math.min(Math.max(day(ps[0]!.value[0]) - day(start), 0), total);
        const ideal = Math.round((p.ideal[1]!.cents * done) / total); // whole cents, like the server's ideal line
        const got = [...p.actual].reverse().find((a) => a.date <= d)?.cents ?? 0;
        return `<div class="tt-date">${formatDate(d)}</div>
          <div class="tt-row"><span class="tt-dot" style="background:${gold}"></span>Contributed<b>${formatCents(got)}</b></div>
          <div class="tt-row"><span class="tt-dot" style="background:${plat}"></span>Even pace<b>${formatCents(ideal)}</b></div>`;
      },
    },
    series,
  };
}

// ---------- V2 Phase 3: What if ----------

/** Path colors: the current path in platinum, scenarios in gold, silver and bronze (the same order as their cards). */
export const PATH_TOKENS = ['--platinum', '--gold', '--silver', '--bronze'] as const;

/**
 * Projected net worth (or invested money only) for the current path and each scenario, in today's dollars.
 * In "invested" mode each path's FI number is a thin dashed line in its color.
 */
export function whatIfOption(paths: import('./types').WhatIfPath[], mode: 'networth' | 'invested'): EChartsCoreOption {
  const base = chartBase();
  const axes = timeAxes(base);
  const colors = paths.map((_, i) => cssVar(PATH_TOKENS[i] ?? '--pewter'));
  const pick = (p: { netWorthCents: number; investedCents: number }) => (mode === 'networth' ? p.netWorthCents : p.investedCents);
  const fiLines = (p: import('./types').WhatIfPath, i: number) =>
    mode === 'invested' && p.fi.numberCents !== null
      ? {
          silent: true,
          symbol: 'none',
          label: { show: i === 0, formatter: 'FI number', color: cssVar('--text-2'), fontFamily: cssVar('--font-mono'), fontSize: 10, position: 'insideEndTop' },
          lineStyle: { color: colors[i], type: [4, 4], width: 1, opacity: 0.8 },
          data: [{ yAxis: p.fi.numberCents }],
        }
      : undefined;
  return {
    ...base,
    grid: { left: 8, right: 18, top: 40, bottom: 8, containLabel: true },
    ...axes,
    yAxis: { ...axes.yAxis, scale: false },
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: cssVar('--text-2') } },
    tooltip: {
      ...base.tooltip,
      trigger: 'axis',
      formatter: (ps: { seriesName: string; value: [number, number]; color: string }[]) =>
        `<div class="tt-date">${formatDate(isoOf(ps[0]!.value[0]))}</div>` +
        ps
          .map((x) => `<div class="tt-row"><span class="tt-dot" style="background:${x.color}"></span>${escapeHtml(x.seriesName)}<b>${formatCents(x.value[1])}</b></div>`)
          .join(''),
    },
    series: paths.map((p, i) => ({
      name: p.name,
      type: 'line',
      data: p.series.map((s) => [dateOf(s.date), pick(s)]),
      showSymbol: false,
      // The current path is the dashed reference line; scenarios are solid metals with a soft glow.
      lineStyle: { width: i === 0 ? 2 : 2.4, color: colors[i], type: i === 0 ? [7, 5] : 'solid', shadowColor: withAlpha(colors[i]!, 0.45), shadowBlur: i === 0 ? 0 : 10 },
      itemStyle: { color: colors[i] },
      areaStyle: i === 0 ? { color: verticalFade(colors[0]!, 0.14, 0) } : undefined,
      markLine: fiLines(p, i),
      z: i === 0 ? 1 : 2 + i,
    })),
  };
}
