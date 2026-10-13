/**
 * Scenario anchors through the REAL Astro Markdown pipeline (ADR-0046, mapping
 * contract §5; final-review finding 1).
 *
 * `scenario-index.test.ts` stubs `render(entry).headings`, so it cannot see what
 * Astro actually does to a heading's `text`. This suite closes that gap: each
 * feature is rendered with the real `renderFeatureBody`, the Markdown is run
 * through Astro's own `createMarkdownProcessor` (from the `@astrojs/markdown-remark`
 * the installed `astro` resolves — the exact pinned build pass) configured like
 * the toolkit (Astro's defaults `gfm: true` + `smartypants: true`, plus the single
 * `remark-directive` owner `config.ts` registers), and the resulting
 * `metadata.headings` are fed to `scenarioRecords`.
 *
 * Two transforms that a stubbed heading list hides:
 *
 *  - `rehypeHeadingIds` (`rehype-collect-headings.js`) does
 *    `text += child.value.replace(/\{/g, "${")` for every non-MDX heading, so
 *    `Scenario: GET /orders/{id}` arrives as `Scenario: GET /orders/${id}`;
 *  - `remark-smartypants` curls quotes (including ``` ``x'' ``` → `“x”`), turns
 *    `--`/`---` into dashes and `...`/`. . .` into `…`.
 *
 * Every scenario must resolve to its OWN heading's id — the oracle is purely
 * positional (the n-th scenario heading at the scenario depth), never a key
 * computed by the code under test.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { Parser, AstBuilder, GherkinClassicTokenMatcher } from '@cucumber/gherkin';
import { IdGenerator, type GherkinDocument } from '@cucumber/messages';
import remarkDirective from 'remark-directive';
import { renderFeatureBody } from '../lib/gherkin/render.mjs';
import type { RenderedHeading } from '../lib/routes/scenario-index.js';

// `scenario-index.ts` imports `astro:content` (unused by the pure
// `scenarioRecords`), which only exists inside an Astro build.
vi.mock('astro:content', () => ({ getCollection: async () => [], render: async () => ({}) }));
const { scenarioRecords } = await import('../lib/routes/scenario-index.js');

type MarkdownProcessor = {
  render: (md: string) => Promise<{ code: string; metadata: { headings: RenderedHeading[] } }>;
};
type MarkdownRemark = {
  createMarkdownProcessor: (opts: Record<string, unknown>) => Promise<MarkdownProcessor>;
  markdownConfigDefaults: Record<string, unknown>;
};

/**
 * Resolve `@astrojs/markdown-remark` off the installed `astro` (it is a
 * transitive dependency under pnpm's strict layout — the same chain
 * `markua-crosslink.test.ts` and `remark-version-pin.test.ts` use), so the
 * processor is the one the build runs.
 */
async function astroMarkdown(): Promise<MarkdownRemark> {
  const req = createRequire(import.meta.url);
  const entry = createRequire(req.resolve('astro/package.json')).resolve('@astrojs/markdown-remark');
  return (await import(entry)) as MarkdownRemark;
}

/** The toolkit's Markdown configuration: Astro defaults + `remark-directive`. */
async function toolkitProcessor(): Promise<MarkdownProcessor> {
  const { createMarkdownProcessor, markdownConfigDefaults } = await astroMarkdown();
  expect(markdownConfigDefaults.gfm).toBe(true);
  expect(markdownConfigDefaults.smartypants).toBe(true);
  return createMarkdownProcessor({ ...markdownConfigDefaults, remarkPlugins: [remarkDirective] });
}

function parseGherkin(source: string): GherkinDocument {
  return new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher()).parse(
    source,
  );
}

/** Scenario names that the pipeline rewrites (or that the escapers touch). */
const NAMES = [
  'GET /orders/{id}',
  'render {{x}} twice',
  'a template ${name} literal',
  "a ``quoted'' value",
  'a "double" quote',
  "a 'single' quote",
  "it's the shipper's list",
  'wait . . . then go',
  'trailing dots...',
  'an en -- dash',
  'an em --- dash',
  'markup <b>bold</b>',
  'a & b',
  'a `code` span',
  '*emph* and _under_',
  '[x] box',
  'visit www.example.com now',
  'mail bob@example.com',
  // Duplicate-ish pairs: identical after folding, so only document order can
  // tell them apart — each must still land on its OWN heading.
  'Retry -- once',
  'Retry — once',
  'Same name',
  'Same name',
];

function flatFeature(): string {
  return [
    'Feature: Anchors',
    '',
    '  Background:',
    '    Given a site',
    '',
    ...NAMES.flatMap((n) => [`  Scenario: ${n}`, '    Given a step', '']),
  ].join('\n');
}

function ruleFeature(): string {
  return [
    'Feature: Anchors in rules',
    '',
    '  Rule: Everything inside a rule',
    '',
    ...NAMES.flatMap((n, i) =>
      i % 2 === 0
        ? [`    Scenario: ${n}`, '      Given a step', '']
        : [
            `    Scenario Outline: ${n}`,
            '      Given <n> steps',
            '',
            '      Examples:',
            '        | n |',
            '        | 1 |',
            '',
          ],
    ),
  ].join('\n');
}

/** Render `source` and run the body through the toolkit's Astro processor. */
async function pipelineHeadings(source: string) {
  const doc = parseGherkin(source);
  const body = renderFeatureBody(doc, { file: 'anchors.feature' });
  const { metadata } = await (await toolkitProcessor()).render(body);
  return { doc, headings: metadata.headings };
}

async function anchorsThroughPipeline(source: string, depth: number) {
  const { doc, headings } = await pipelineHeadings(source);
  // Positional oracle: the scenario headings, in document order, at the
  // scenario depth (a Background/Rule heading never starts with "Scenario").
  const expected = headings.filter((h) => h.depth === depth && h.text.startsWith('Scenario'));
  expect(expected).toHaveLength(NAMES.length);
  const records = scenarioRecords(doc, headings, { page: 'p/anchors', source: 'anchors.feature' });
  return { records, expected };
}

describe('scenario anchors through the real Astro Markdown pipeline', () => {
  it('the pipeline really does rewrite these headings (non-vacuity)', async () => {
    const { headings } = await pipelineHeadings(flatFeature());
    const texts = headings.map((h) => h.text);
    expect(texts).toContain('Scenario: GET /orders/${id}');
    expect(texts).toContain('Scenario: render ${${x}} twice');
    expect(texts).toContain('Scenario: a “quoted” value');
    expect(texts).toContain('Scenario: wait … then go');
  });

  it.each(NAMES.filter((n, i) => NAMES.indexOf(n) === i))(
    'a lone scenario named %j resolves to its heading id',
    async (name) => {
      const { doc, headings } = await pipelineHeadings(
        `Feature: One\n\n  Scenario: ${name}\n    Given a step\n`,
      );
      const [scenarioHeading] = headings.filter((h) => h.depth === 2);
      const [record] = scenarioRecords(doc, headings, { page: 'p/one', source: 'one.feature' });
      expect(record.anchor).toBe(scenarioHeading.slug);
    },
  );

  it('every scenario outside a rule resolves to its own heading id', async () => {
    const { records, expected } = await anchorsThroughPipeline(flatFeature(), 2);
    expect(records.map((r) => r.name)).toEqual(NAMES);
    expect(records.map((r) => r.anchor)).toEqual(expected.map((h) => h.slug));
    // The duplicate-ish pairs got distinct anchors.
    expect(new Set(records.map((r) => r.anchor)).size).toBe(NAMES.length);
  });

  it('every scenario inside a rule resolves to its own heading id', async () => {
    const { records, expected } = await anchorsThroughPipeline(ruleFeature(), 3);
    expect(records.map((r) => r.anchor)).toEqual(expected.map((h) => h.slug));
    expect(records.every((r) => r.rule === 'Everything inside a rule')).toBe(true);
  });
});
