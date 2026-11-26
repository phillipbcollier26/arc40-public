import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { LineChart, PieChart, BarChart, TreemapChart, HeatmapChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, GraphicComponent, LegendComponent, CalendarComponent, VisualMapComponent, MarkAreaComponent, MarkLineComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { useChartTheme } from '../lib/themeMode';

// Only the chart types Arc40 uses are bundled. Add new ones here.
echarts.use([LineChart, PieChart, BarChart, TreemapChart, HeatmapChart, GridComponent, TooltipComponent, GraphicComponent, LegendComponent, CalendarComponent, VisualMapComponent, MarkAreaComponent, MarkLineComponent, CanvasRenderer]);

export { echarts };

/** Thin React wrapper around ECharts with automatic resizing. */
export function Chart({
  option,
  height = 320,
  className,
  ariaLabel,
  onPick,
}: {
  option: EChartsCoreOption;
  height?: number;
  className?: string;
  ariaLabel: string;
  /** Called with the category index when a bar/point (or its column) is clicked. */
  onPick?: (index: number) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  // Keep the latest onPick without re-registering chart listeners every render.
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' });
    chart.current = c;
    // The tooltip's axis pointer tracks which column the mouse is over; a click picks that
    // column. Works anywhere in the column, not only on the thin bars. Listeners live and die
    // with the chart instance (disposing removes them).
    let hovered: number | null = null;
    c.on('updateAxisPointer', ((e: { axesInfo?: { value?: number }[] }) => {
      const v = e.axesInfo?.[0]?.value;
      hovered = typeof v === 'number' ? v : null;
    }) as never);
    c.getZr().on('click', () => {
      if (hovered !== null) pickRef.current?.(hovered);
    });
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  // A theme change clears the chart first, so it draws in again in the new colors with its
  // usual entrance animation (instead of silently swapping colors).
  const theme = useChartTheme();
  const drawnTheme = useRef(theme);
  useEffect(() => {
    if (!chart.current) return;
    if (drawnTheme.current !== theme) {
      drawnTheme.current = theme;
      chart.current.clear();
    }
    chart.current.setOption(option, { notMerge: true });
  }, [option, theme]);

  return <div ref={el} className={className} style={{ height, width: '100%', minWidth: 0, overflow: 'hidden' }} role="img" aria-label={ariaLabel} />;
}
