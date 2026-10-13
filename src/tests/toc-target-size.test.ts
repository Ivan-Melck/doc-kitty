/**
 * WCAG 2.5.8 target-size (axe `target-size`, wcag22aa) on Starlight's desktop
 * "On this page" TOC links (review #14).
 *
 * Starlight's `TableOfContentsList.astro` styles each link `display: block`,
 * `padding-block: 0.25rem`, `line-height: 1.25` at the small TOC font size —
 * ~23px tall. A densely nested TOC (a generated behaviour page: Rule → Scenario
 * entries) then fails axe `target-size` (needs 24px, or 24px spacing). The fix
 * lives in the global `toc-rail.css` sheet (a GLOBAL_COMPONENT_SHEETS entry, so it
 * survives the branded token-sheet swap). The real proof is the axe scan of the
 * behaviour route (`tests/a11y/axe.spec.ts`); this is the static guard that the
 * rule exists, targets ONLY the desktop TOC nav, and outranks Starlight's
 * zero-specificity `:where()`-scoped `a` rule.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('../styles/toc-rail.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

describe('TOC link target size (WCAG 2.5.8)', () => {
  it('the desktop "On this page" links get a ≥24px block size', () => {
    const rule = /nav\[aria-labelledby=(['"])starlight__on-this-page\1\]\s+a\s*\{([^}]*)\}/.exec(CSS);
    expect(rule, 'a rule for nav[aria-labelledby="starlight__on-this-page"] a').not.toBeNull();
    const body = rule?.[2] ?? '';
    const min = /min-(?:height|block-size)\s*:\s*(\d+(?:\.\d+)?)px/.exec(body);
    expect(Number(min?.[1])).toBeGreaterThanOrEqual(24);
  });

  it('it is scoped to the desktop TOC only (the mobile TOC nav id has a --mobile suffix)', () => {
    expect(CSS).not.toMatch(/aria-labelledby\^=/);
    expect(CSS).not.toMatch(/starlight__on-this-page--mobile/);
  });
});
