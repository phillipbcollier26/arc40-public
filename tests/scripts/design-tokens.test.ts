import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Collects web source files (except the tokens file itself). */
function webFiles(dir = path.resolve('web/src')): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...webFiles(p));
    else if (/\.(css|tsx?)$/.test(p) && !p.endsWith('tokens.css')) out.push(p);
  }
  return out;
}

describe('design tokens', () => {
  it('no color is hard-coded outside web/src/styles/tokens.css', () => {
    for (const f of webFiles()) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b(?![\w-])/);
      expect(src, f).not.toMatch(/\brgba?\(/);
      expect(src, f).not.toMatch(/\bhsla?\(/);
    }
  });

  it('every var(--x) used is defined in tokens.css', () => {
    const tokens = fs.readFileSync(path.resolve('web/src/styles/tokens.css'), 'utf8');
    const defined = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    for (const f of webFiles()) {
      for (const m of fs.readFileSync(f, 'utf8').matchAll(/var\((--[\w-]+)\)/g)) {
        expect(defined.has(m[1]!), `${f} uses undefined ${m[1]}`).toBe(true);
      }
    }
  });

  it('the light theme defines exactly the same color tokens as the dark theme', () => {
    const { dark, light } = themeBlocks();
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
    expect(Object.keys(dark).length).toBeGreaterThan(40);
  });

  it('light theme text and accents meet WCAG AA (4.5:1) on cards, the page and hover rows', () => {
    const { light } = themeBlocks();
    const surfaces = ['--bg-2', '--bg-0', '--bg-3'];
    const text = ['--text-0', '--text-1', '--text-2', '--text-3', '--accent-text', '--gold', '--gold-deep', '--silver', '--pewter', '--bronze', '--copper', '--sage', '--garnet'];
    for (const t of text) {
      for (const bg of surfaces) {
        const ratio = contrast(light[t]!, light[bg]!);
        expect(ratio, `${t} ${light[t]} on ${bg} ${light[bg]} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Gold text on a gold-tinted notice (--gold-soft over the page) must stay readable too.
    const soft = light['--gold-soft']!.match(/rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/)!.slice(1).map(Number) as [number, number, number, number];
    const page = [1, 3, 5].map((i) => parseInt(light['--bg-0']!.slice(i, i + 2), 16));
    const tinted = '#' + page.map((c, i) => Math.round(c * (1 - soft[3]) + soft[i]! * soft[3]).toString(16).padStart(2, '0')).join('');
    expect(contrast(light['--accent-text']!, tinted)).toBeGreaterThanOrEqual(4.5);
    // Platinum is for chart lines only: WCAG asks 3:1 for graphics.
    expect(contrast(light['--platinum']!, light['--bg-2']!)).toBeGreaterThanOrEqual(3);
  });

  it('no purple or cyan anywhere in either theme', () => {
    const css = fs.readFileSync(path.resolve('web/src/styles/tokens.css'), 'utf8');
    const colors = [
      ...[...css.matchAll(/#([0-9a-fA-F]{6})\b/g)].map((m) => [parseInt(m[1]!.slice(0, 2), 16), parseInt(m[1]!.slice(2, 4), 16), parseInt(m[1]!.slice(4, 6), 16)]),
      ...[...css.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]),
    ] as [number, number, number][];
    expect(colors.length).toBeGreaterThan(80);
    for (const [r, g, b] of colors) {
      const { h, s } = hsl(r, g, b);
      const label = `rgb(${r}, ${g}, ${b}) hue ${Math.round(h)} saturation ${s.toFixed(2)}`;
      if (s < 0.2) continue; // greys, silvers and graphite are fine
      expect(h >= 165 && h <= 205, `${label} looks cyan`).toBe(false);
      expect(h >= 245 && h <= 335, `${label} looks purple`).toBe(false);
    }
  });

  it('chart options cached with useMemo rebuild when the theme changes', () => {
    // theme.ts reads the color tokens when an option is built, so a cached option keeps old colors
    // unless the memo depends on useChartTheme().
    for (const f of webFiles().filter((x) => x.endsWith('.tsx'))) {
      const src = fs.readFileSync(f, 'utf8');
      let i = src.indexOf('useMemo(');
      while (i !== -1) {
        const call = balanced(src, i + 'useMemo'.length);
        if (/\w+Option\(/.test(call)) {
          const deps = call.slice(call.lastIndexOf('['));
          expect(deps, `${path.basename(f)}: ${call.slice(0, 60)}...`).toContain('chartTheme');
        }
        i = src.indexOf('useMemo(', i + 1);
      }
    }
  });
});

/** Token name -> value for the dark and the light blocks of tokens.css. */
function themeBlocks() {
  const css = fs.readFileSync(path.resolve('web/src/styles/tokens.css'), 'utf8');
  const block = (selector: string) => {
    const start = css.indexOf(selector);
    expect(start, selector).toBeGreaterThan(-1);
    const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
    return Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
  };
  return { dark: block(":root,\n[data-theme='dark'] {"), light: block(":root[data-theme='light'] {") };
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  expect(a, 'contrast needs 6-digit hex').toMatch(/^#[0-9a-f]{6}$/i);
  expect(b, 'contrast needs 6-digit hex').toMatch(/^#[0-9a-f]{6}$/i);
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
function hsl(r: number, g: number, b: number) {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s };
}
/** The text of a call's parenthesized arguments starting at `open` (index of "("). */
function balanced(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')' && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}
