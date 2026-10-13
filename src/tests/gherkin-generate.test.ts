/**
 * WP05 — Gherkin feature-page generator: golden output, hubs, owned-output
 * pruning and single ownership (ADR-0046; mapping contract §1, §6, §7).
 *
 * Every run writes into a fresh `mkdtemp` directory; nothing here writes into
 * the repo tree. `example/docs` is only ever READ (ADR listing + section
 * registry) — the output directory is always a temp dir.
 *
 * The golden fixture under `fixtures/gherkin/generate/` is a verbatim copy of
 * the plan's worked example (`examples/features/**` → `examples/expected/**`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { loadFeatures } from '../lib/gherkin/load.mjs';
import {
  DEFAULT_GHERKIN_SECTION,
  diffFeaturePages,
  generateFeaturePages,
  hubBasename,
  planFeaturePages,
  scanOutputDir,
} from '../lib/gherkin/generate.mjs';

const FIXTURE = fileURLToPath(new URL('./fixtures/gherkin/generate/', import.meta.url));
/** Site root of the worked example: `features/shipping/book-consignment.feature`. */
const GOLDEN_SITE = path.join(FIXTURE, 'site');
/** The three expected output files, relative to `<docsRoot>/behaviour`. */
const GOLDEN_EXPECTED = path.join(FIXTURE, 'expected', 'behaviour');
/** The example docs root: READ-ONLY (ADR listing + section registry). */
const EXAMPLE_DOCS = fileURLToPath(new URL('../../example/docs/', import.meta.url));

// Temp dirs created per test; torn down afterEach.
const temps: string[] = [];
afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(prefix = 'dk-gherkin-gen-'): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** Write `files` (POSIX rel path → contents) under `root`. */
function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text, 'utf8');
  }
}

/** Every file under `dir` as `relPath → contents`, keys in code-unit order. */
function readTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  const walk = (d: string, prefix: string): void => {
    for (const name of readdirSync(d).sort()) {
      const abs = path.join(d, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(abs).isDirectory()) walk(abs, rel);
      else out[rel] = readFileSync(abs, 'utf8');
    }
  };
  walk(dir, '');
  return out;
}

/** Files AND directories under `dir` (so a created/pruned empty dir shows up too). */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  const walk = (d: string, prefix: string): void => {
    for (const name of readdirSync(d).sort()) {
      const abs = path.join(d, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (statSync(abs).isDirectory()) {
        out[`${rel}/`] = '<dir>';
        walk(abs, rel);
      } else {
        out[rel] = readFileSync(abs, 'utf8');
      }
    }
  };
  walk(dir, '');
  return out;
}

/** A minimal valid feature: description gives a clean first sentence, no warnings. */
function feature(name: string, opts: { tags?: string; step?: string } = {}): string {
  return [
    ...(opts.tags ? [opts.tags] : []),
    `Feature: ${name}`,
    `  ${name} is specified here.`,
    '',
    '  Scenario: It works',
    `    Given ${opts.step ?? 'a precondition'}`,
    '    Then it works',
    '',
  ].join('\n');
}

interface Site {
  /** Site root: sources resolve against it, `sources[0].resource` is relative to it. */
  root: string;
  /** `<root>/docs` (empty: no registry, no ADRs) unless overridden per run. */
  docsRoot: string;
  /** `<docsRoot>/behaviour`. */
  outDir: string;
}

/** A temp site with `files` written under its root and an empty `docs/`. */
function makeSite(files: Record<string, string>): Site {
  const root = tmp();
  writeTree(root, files);
  const docsRoot = path.join(root, 'docs');
  mkdirSync(docsRoot, { recursive: true });
  return { root, docsRoot, outDir: path.join(docsRoot, DEFAULT_GHERKIN_SECTION) };
}

type GenOpts = Partial<Parameters<typeof generateFeaturePages>[1]> & { sources?: string[] };

/** Load + generate for `site`; collects every warning (loader AND generator). */
function gen(site: Site, opts: GenOpts = {}) {
  const warnings: string[] = [];
  const warn = (msg: string): void => {
    warnings.push(msg);
  };
  const { sources = ['features'], ...rest } = opts;
  const model = loadFeatures({ sources, root: site.root, warn });
  const result = generateFeaturePages(model, {
    docsRoot: site.docsRoot,
    outDir: site.outDir,
    sourceRoot: site.root,
    warn,
    ...rest,
  });
  return { result, warnings, model };
}

/** Plan only (no fs writes) for `site`. */
function plan(site: Site, opts: GenOpts = {}) {
  const warnings: string[] = [];
  const warn = (msg: string): void => {
    warnings.push(msg);
  };
  const { sources = ['features'], ...rest } = opts;
  const model = loadFeatures({ sources, root: site.root, warn });
  const out = planFeaturePages(model, {
    docsRoot: site.docsRoot,
    sourceRoot: site.root,
    warn,
    ...rest,
  });
  return { plan: out, warnings };
}

/** Capture the error thrown by `fn` (fails the test if nothing throws). */
function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the call to throw');
}

/** The `(href)` of every `- [title](href) — …` list item in a hub body. */
function hubLinks(contents: string): string[] {
  return [...contents.matchAll(/^- \[[^\]]*\]\(([^)]*)\) — /gm)].map((m) => m[1] as string);
}

/** Parsed frontmatter of a generated page. */
function fm(contents: string): Record<string, unknown> {
  return matter(contents).data as Record<string, unknown>;
}

function generatedAt(contents: string): string {
  return (fm(contents).generated as { at: string }).at;
}

// ---------------------------------------------------------------------------

describe('golden: the worked example (contract §1/§3/§6)', () => {
  it('generates exactly the 3 expected files, byte-identical', () => {
    const outDir = path.join(tmp(), 'behaviour');
    const warnings: string[] = [];
    const model = loadFeatures({ sources: ['features'], root: GOLDEN_SITE });
    const result = generateFeaturePages(model, {
      docsRoot: EXAMPLE_DOCS,
      outDir,
      sourceRoot: GOLDEN_SITE,
      indexBasename: ['README', 'index'],
      warn: (m) => warnings.push(m),
    });

    const expected = readTree(GOLDEN_EXPECTED);
    expect(Object.keys(expected)).toEqual([
      'README.md',
      'shipping/README.md',
      'shipping/book-consignment.md',
    ]);
    expect(readTree(outDir)).toEqual(expected);
    expect(result).toEqual({
      written: ['README.md', 'shipping/README.md', 'shipping/book-consignment.md'],
      unchanged: [],
      removed: [],
    });
    expect(warnings).toEqual([]);
  });

  it('planFeaturePages yields the same bytes without touching the filesystem', () => {
    const model = loadFeatures({ sources: ['features'], root: GOLDEN_SITE });
    const planned = planFeaturePages(model, {
      docsRoot: EXAMPLE_DOCS,
      sourceRoot: GOLDEN_SITE,
      indexBasename: ['README', 'index'],
    });
    expect(Object.fromEntries(planned)).toEqual(readTree(GOLDEN_EXPECTED));
  });
});

describe('rename / delete: owned-output pruning (02 "Owned output and pruning")', () => {
  it('renaming a source removes the old page, writes the new one, updates hubs, prunes empty dirs', () => {
    const site = makeSite({
      'features/shipping/book.feature': feature('Book a slot'),
      'features/billing/invoice.feature': feature('Send an invoice'),
    });
    gen(site);
    expect(Object.keys(readTree(site.outDir))).toEqual([
      'README.md',
      'billing/README.md',
      'billing/invoice.md',
      'shipping/README.md',
      'shipping/book.md',
    ]);

    // A file rename inside a directory, and a directory rename that empties `billing/`.
    renameSync(
      path.join(site.root, 'features/shipping/book.feature'),
      path.join(site.root, 'features/shipping/book-slot.feature'),
    );
    mkdirSync(path.join(site.root, 'features/invoicing'));
    renameSync(
      path.join(site.root, 'features/billing/invoice.feature'),
      path.join(site.root, 'features/invoicing/invoice.feature'),
    );
    rmSync(path.join(site.root, 'features/billing'), { recursive: true });

    const { result } = gen(site);
    expect(result.removed).toEqual(['billing/README.md', 'billing/invoice.md', 'shipping/book.md']);
    expect(result.written).toEqual([
      'README.md',
      'invoicing/README.md',
      'invoicing/invoice.md',
      'shipping/README.md',
      'shipping/book-slot.md',
    ]);
    const tree = readTree(site.outDir);
    expect(Object.keys(tree)).toEqual([
      'README.md',
      'invoicing/README.md',
      'invoicing/invoice.md',
      'shipping/README.md',
      'shipping/book-slot.md',
    ]);
    // The now-empty `billing/` directory is pruned, not left behind.
    expect(existsSync(path.join(site.outDir, 'billing'))).toBe(false);
    // Hubs follow the rename.
    expect(hubLinks(tree['README.md'] as string)).toEqual(['./invoicing/', './shipping/']);
    expect(hubLinks(tree['shipping/README.md'] as string)).toEqual(['./book-slot/']);
  });

  it('empty sources: owned leftovers are removed, exactly one warning, no stale files kept', () => {
    const site = makeSite({
      'features/shipping/book.feature': feature('Book a slot'),
      'features/a/b/deep.feature': feature('Deep one'),
    });
    gen(site);
    const before = Object.keys(readTree(site.outDir));
    expect(before).toHaveLength(6);

    rmSync(path.join(site.root, 'features'), { recursive: true });
    mkdirSync(path.join(site.root, 'features')); // the source dir exists, but is empty

    const { result, warnings } = gen(site);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^\[dk-gherkin\] no \.feature files/);
    expect(warnings[0]).toContain('6 previously generated page(s) will be removed');
    expect(result.written).toEqual([]);
    expect(result.removed).toEqual(before);
    // No stale file survives (the emptied section dir itself is pruned).
    expect(readTree(site.outDir)).toEqual({});
  });

  it('empty sources with no prior output: one warning, nothing created', () => {
    const site = makeSite({ 'features/.keep': '' });
    const { result, warnings } = gen(site);
    expect(warnings).toHaveLength(1);
    expect(result).toEqual({ written: [], unchanged: [], removed: [] });
    expect(existsSync(site.outDir)).toBe(false);
  });

  it('a directory holding only a dotfile is kept when its pages are pruned', () => {
    const site = makeSite({
      'features/shipping/book.feature': feature('Book a slot'),
      'features/billing/invoice.feature': feature('Send an invoice'),
    });
    gen(site);
    writeFileSync(path.join(site.outDir, 'billing', '.gitkeep'), '');
    rmSync(path.join(site.root, 'features/billing'), { recursive: true });
    const { result } = gen(site);
    expect(result.removed).toEqual(['billing/README.md', 'billing/invoice.md']);
    expect(snapshot(path.join(site.outDir, 'billing'))).toEqual({ '.gitkeep': '' });
  });
});

describe('single ownership: authored content is never clobbered (contract §7)', () => {
  const intruders: Array<[string, string, string]> = [
    ['an authored .md at the section root', 'notes.md', '---\ntitle: Notes\n---\n\n# Notes\n'],
    ['an authored .md nested in a subdir', 'shipping/extra.md', '# No frontmatter at all\n'],
    ['a non-.md file', 'shipping/diagram.png', 'not really a png'],
    [
      'a .md generated by ANOTHER generator (doc-kitty/glossary)',
      'glossary-ish.md',
      '---\ntitle: "X"\ngenerated:\n  by: "doc-kitty/glossary"\n  at: "sha256:000000000000"\n---\n',
    ],
    ['a .md whose frontmatter does not parse', 'broken.md', '---\ngenerated: [unclosed\n---\n'],
  ];

  it.each(intruders)('%s → throws naming it; NOTHING is written or deleted', (_label, rel, body) => {
    const site = makeSite({
      'features/shipping/book.feature': feature('Book a slot'),
      'features/billing/invoice.feature': feature('Send an invoice'),
    });
    gen(site);
    writeTree(site.outDir, { [rel]: body });

    // Change the sources so a successful run WOULD write (new page + hubs) and
    // delete (the stale billing pages): the throw must happen before either.
    rmSync(path.join(site.root, 'features/billing'), { recursive: true });
    writeTree(site.root, { 'features/shipping/cancel.feature': feature('Cancel a booking') });
    const before = snapshot(site.outDir);

    const err = thrown(() => gen(site));
    expect(err.message).toMatch(/^\[dk-gherkin\] refusing to write into /);
    expect(err.message).toContain(site.outDir);
    expect(err.message).toContain(`${rel} is not generated by doc-kitty/gherkin`);
    expect(snapshot(site.outDir)).toEqual(before);
  });

  it('names EVERY authored file, in code-unit order', () => {
    const site = makeSite({ 'features/shipping/book.feature': feature('Book a slot') });
    writeTree(site.outDir, { 'b.md': '# b\n', 'a/z.txt': 'z', 'B.md': '# B\n' });
    const err = thrown(() => gen(site));
    expect(err.message).toContain('B.md, a/z.txt, b.md are not generated by doc-kitty/gherkin');
    expect(Object.keys(readTree(site.outDir))).toEqual(['B.md', 'a/z.txt', 'b.md']);
  });

  it('an authored file blocks even the empty-sources cleanup', () => {
    const site = makeSite({ 'features/shipping/book.feature': feature('Book a slot') });
    gen(site);
    writeTree(site.outDir, { 'mine.md': '# mine\n' });
    rmSync(path.join(site.root, 'features/shipping'), { recursive: true });
    const before = snapshot(site.outDir);
    expect(() => gen(site)).toThrow(/mine\.md is not generated/);
    expect(snapshot(site.outDir)).toEqual(before);
  });

  it('scanOutputDir: owned by generated.by only; dotfiles ignored; missing dir is empty', () => {
    const site = makeSite({ 'features/shipping/book.feature': feature('Book a slot') });
    gen(site);
    writeTree(site.outDir, {
      '.gitkeep': '',
      'shipping/.hidden/x.md': '# hidden\n',
      'other.md': '---\ngenerated:\n  by: "doc-kitty/glossary"\n---\n',
    });
    expect(scanOutputDir(site.outDir)).toEqual({
      owned: ['README.md', 'shipping/README.md', 'shipping/book.md'],
      authored: ['other.md'],
    });
    expect(scanOutputDir(path.join(site.root, 'nope'))).toEqual({ owned: [], authored: [] });
  });
});

describe('hub basename follows indexBasename (contract §1)', () => {
  it('hubBasename: the first configured basename, README otherwise', () => {
    expect(hubBasename(undefined)).toBe('README');
    expect(hubBasename('')).toBe('README');
    expect(hubBasename([])).toBe('README');
    expect(hubBasename('README')).toBe('README');
    expect(hubBasename('index')).toBe('index');
    expect(hubBasename(['index', 'README'])).toBe('index');
    expect(hubBasename(['README', 'index'])).toBe('README');
  });

  it('README.md hubs by default', () => {
    const site = makeSite({ 'features/shipping/book.feature': feature('Book a slot') });
    gen(site);
    expect(Object.keys(readTree(site.outDir))).toEqual([
      'README.md',
      'shipping/README.md',
      'shipping/book.md',
    ]);
  });

  it("index.md hubs when indexBasename is ['index', 'README']", () => {
    const site = makeSite({ 'features/shipping/book.feature': feature('Book a slot') });
    gen(site, { indexBasename: ['index', 'README'] });
    expect(Object.keys(readTree(site.outDir))).toEqual([
      'index.md',
      'shipping/book.md',
      'shipping/index.md',
    ]);
  });

  it('switching the basename replaces the old hubs (they are owned, so they are pruned)', () => {
    const site = makeSite({ 'features/shipping/book.feature': feature('Book a slot') });
    gen(site);
    const { result } = gen(site, { indexBasename: 'index' });
    expect(result.removed).toEqual(['README.md', 'shipping/README.md']);
    expect(Object.keys(readTree(site.outDir))).toEqual([
      'index.md',
      'shipping/book.md',
      'shipping/index.md',
    ]);
  });
});

describe('nested directories: one hub per directory, direct children only (contract §6)', () => {
  it('a/b/c.feature → hubs at root, a/ and a/b/, each linking only its direct children', () => {
    const site = makeSite({ 'features/a/b/c.feature': feature('Charlie') });
    gen(site);
    const tree = readTree(site.outDir);
    expect(Object.keys(tree)).toEqual(['README.md', 'a/README.md', 'a/b/README.md', 'a/b/c.md']);
    expect(hubLinks(tree['README.md'] as string)).toEqual(['./a/']);
    expect(hubLinks(tree['a/README.md'] as string)).toEqual(['./b/']);
    expect(hubLinks(tree['a/b/README.md'] as string)).toEqual(['./c/']);
    for (const hub of ['README.md', 'a/README.md', 'a/b/README.md']) {
      const data = fm(tree[hub] as string);
      expect(data.kind, hub).toBe('Hub');
      expect(data.doc_status, hub).toBe('active');
      expect(data.generated, hub).toEqual({ by: 'doc-kitty/gherkin', at: expect.stringMatching(/^sha256:[0-9a-f]{12}$/) });
    }
    expect(fm(tree['a/README.md'] as string).title).toBe('A');
    expect(fm(tree['a/b/README.md'] as string).description).toBe('Behaviour specifications for B, generated from Gherkin feature files.');
  });

  it('a directory hub lists both feature pages and sub-directory hubs, sorted', () => {
    const site = makeSite({
      'features/a/zulu.feature': feature('Zulu'),
      'features/a/b/c.feature': feature('Charlie'),
      'features/a/alpha.feature': feature('Alpha'),
    });
    gen(site);
    expect(hubLinks(readTree(site.outDir)['a/README.md'] as string)).toEqual([
      './alpha/',
      './b/',
      './zulu/',
    ]);
  });

  it('hub generated.at changes when a child is added, not when a child only changes content', () => {
    const site = makeSite({ 'features/a/b/c.feature': feature('Charlie') });
    gen(site);
    const t0 = readTree(site.outDir);

    // Content-only change: the page is rewritten, every hub is untouched.
    writeTree(site.root, { 'features/a/b/c.feature': feature('Charlie', { step: 'a different precondition' }) });
    const edit = gen(site);
    expect(edit.result.written).toEqual(['a/b/c.md']);
    const t1 = readTree(site.outDir);
    for (const hub of ['README.md', 'a/README.md', 'a/b/README.md']) {
      expect(t1[hub], hub).toBe(t0[hub]);
    }
    expect(generatedAt(t1['a/b/c.md'] as string)).not.toBe(generatedAt(t0['a/b/c.md'] as string));

    // Add a child to a/b: only that hub's child list (and so its generated.at) changes.
    writeTree(site.root, { 'features/a/b/d.feature': feature('Delta') });
    const add = gen(site);
    expect(add.result.written).toEqual(['a/b/README.md', 'a/b/d.md']);
    const t2 = readTree(site.outDir);
    expect(generatedAt(t2['a/b/README.md'] as string)).not.toBe(
      generatedAt(t1['a/b/README.md'] as string),
    );
    expect(t2['a/README.md']).toBe(t1['a/README.md']);
    expect(t2['README.md']).toBe(t1['README.md']);
    expect(hubLinks(t2['a/b/README.md'] as string)).toEqual(['./c/', './d/']);
  });
});

describe('output collisions are build-fatal (contract §1/§7)', () => {
  it('two sources with the same relative path → throws naming both, writes nothing', () => {
    const site = makeSite({
      'src-a/shipping/book-consignment.feature': feature('Book A'),
      'src-b/shipping/book-consignment.feature': feature('Book B'),
    });
    const err = thrown(() => gen(site, { sources: ['src-a', 'src-b'] }));
    expect(err.message).toContain('[dk-gherkin] output collision');
    expect(err.message).toContain('src-a/shipping/book-consignment.feature');
    expect(err.message).toContain('src-b/shipping/book-consignment.feature');
    expect(err.message).toContain('behaviour/shipping/book-consignment.md');
    expect(existsSync(site.outDir)).toBe(false);
  });

  it('two names in ONE source that slug to the same path → throws naming both', () => {
    const site = makeSite({
      'features/shipping/Book Consignment.feature': feature('Book A'),
      'features/shipping/book-consignment.feature': feature('Book B'),
    });
    const err = thrown(() => gen(site));
    expect(err.message).toContain('[dk-gherkin] output collision');
    expect(err.message).toContain('features/shipping/Book Consignment.feature');
    expect(err.message).toContain('features/shipping/book-consignment.feature');
    expect(existsSync(site.outDir)).toBe(false);
  });

  it('two DIRECTORY names that slug alike merge, and their files still collide', () => {
    const site = makeSite({
      'features/Ship Ping/x.feature': feature('X one'),
      'features/ship-ping/x.feature': feature('X two'),
    });
    expect(() => gen(site)).toThrow(/output collision.*Ship Ping\/x\.feature.*ship-ping\/x\.feature/);
  });

  // The loader matches index basenames CASE-INSENSITIVELY (metadata.ts
  // `indexBasenamePattern`), so `readme.md` / `index.md` next to the generated
  // hub would be a second index candidate (demoted with a loader warning) — and
  // on a case-insensitive filesystem `readme.md` IS `README.md`, so the page and
  // the hub would overwrite each other on every run.
  it.each([
    ['README.feature', undefined, 'shipping/README.md'],
    ['Readme.feature', ['README', 'index'], 'shipping/README.md'],
    ['index.feature', ['README', 'index'], 'shipping/README.md'],
    ['index.feature', 'index', 'shipping/index.md'],
  ] as Array<[string, string | string[] | undefined, string]>)(
    'a feature named like an index basename (%s, indexBasename %j) collides with the hub',
    (name, indexBasename, hub) => {
      const site = makeSite({ [`features/shipping/${name}`]: feature('Index-like') });
      const err = thrown(() => gen(site, { indexBasename }));
      expect(err.message).toContain('[dk-gherkin] output collision');
      expect(err.message).toContain(`features/shipping/${name}`);
      expect(err.message).toContain(`collides with the generated hub behaviour/${hub}`);
      expect(existsSync(site.outDir)).toBe(false);
    },
  );

  it('index.feature is an ordinary page when index is NOT a configured basename', () => {
    const site = makeSite({ 'features/shipping/index.feature': feature('Index-like') });
    gen(site);
    expect(Object.keys(readTree(site.outDir))).toEqual([
      'README.md',
      'shipping/README.md',
      'shipping/index.md',
    ]);
  });

  it('a path segment with no slug-able characters is fatal', () => {
    const site = makeSite({ 'features/!!!/x.feature': feature('X') });
    expect(() => gen(site)).toThrow(/no slug-able characters/);
  });
});

describe('sources[0].resource: sourceRoot and sourceUrlPrefix (contract §3)', () => {
  const files = { 'features/shipping/book.feature': feature('Book a slot') };
  const resourceOf = (p: Map<string, string>): unknown =>
    (fm(p.get('shipping/book.md') as string).sources as Array<{ resource: string; title: string }>)[0];

  it('defaults to the path relative to sourceRoot', () => {
    const site = makeSite(files);
    expect(resourceOf(plan(site).plan)).toEqual({
      resource: 'features/shipping/book.feature',
      title: 'Gherkin source',
    });
  });

  it('a different sourceRoot changes the relative path', () => {
    const site = makeSite(files);
    const p = plan(site, { sourceRoot: path.join(site.root, 'features') }).plan;
    expect(resourceOf(p)).toEqual({ resource: 'shipping/book.feature', title: 'Gherkin source' });
  });

  it('sourceUrlPrefix is prepended verbatim', () => {
    const site = makeSite(files);
    const p = plan(site, { sourceUrlPrefix: 'https://github.com/o/r/blob/main/' }).plan;
    expect(resourceOf(p)).toEqual({
      resource: 'https://github.com/o/r/blob/main/features/shipping/book.feature',
      title: 'Gherkin source',
    });
  });
});

describe('@dk:mission prefix comes from the section registry (contract §2)', () => {
  const files = {
    'features/shipping/book.feature': feature('Book a slot', { tags: '@dk:mission=x' }),
  };

  it('example/docs registry (plans → missions subtype) → plans/missions/x, no warning', () => {
    const site = makeSite(files);
    const { plan: p, warnings } = plan(site, { docsRoot: EXAMPLE_DOCS });
    expect(fm(p.get('shipping/book.md') as string).related).toEqual(['plans/missions/x']);
    expect(warnings).toEqual([]);
  });

  it('a docs root without a registry → plans/x plus a warning', () => {
    const site = makeSite(files);
    const { plan: p, warnings } = plan(site);
    expect(fm(p.get('shipping/book.md') as string).related).toEqual(['plans/x']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^\[dk-gherkin\] .*no Mission subtype/);
  });

  it('no @dk:mission tag → no registry warning even without a registry', () => {
    const site = makeSite({ 'features/shipping/book.feature': feature('Book a slot') });
    expect(plan(site).warnings).toEqual([]);
  });
});

describe('diffFeaturePages (the --check comparison)', () => {
  it('clean / changed / stale / added / authored', () => {
    const site = makeSite({
      'features/shipping/book.feature': feature('Book a slot'),
      'features/shipping/cancel.feature': feature('Cancel a booking'),
    });
    gen(site);
    const diff = () => diffFeaturePages(plan(site).plan, site.outDir);

    expect(diff()).toEqual({ added: [], changed: [], stale: [], authored: [] });

    // Edit a source without regenerating → its page is `changed` (hubs unaffected).
    writeTree(site.root, {
      'features/shipping/book.feature': feature('Book a slot', { step: 'an edited step' }),
    });
    expect(diff()).toEqual({ added: [], changed: ['shipping/book.md'], stale: [], authored: [] });
    gen(site);

    // An owned page with no source → `stale`.
    const owned = readFileSync(path.join(site.outDir, 'shipping/book.md'), 'utf8');
    writeFileSync(path.join(site.outDir, 'shipping/ghost.md'), owned);
    expect(diff()).toEqual({ added: [], changed: [], stale: ['shipping/ghost.md'], authored: [] });
    unlinkSync(path.join(site.outDir, 'shipping/ghost.md'));

    // A planned page missing on disk → `added`.
    unlinkSync(path.join(site.outDir, 'shipping/cancel.md'));
    expect(diff()).toEqual({ added: ['shipping/cancel.md'], changed: [], stale: [], authored: [] });
    gen(site);

    // An authored file is reported, not classified as stale.
    writeFileSync(path.join(site.outDir, 'mine.md'), '# mine\n');
    expect(diff()).toEqual({ added: [], changed: [], stale: [], authored: ['mine.md'] });
  });

  it('a missing output dir → every planned page is added', () => {
    const site = makeSite({ 'features/shipping/book.feature': feature('Book a slot') });
    expect(diffFeaturePages(plan(site).plan, site.outDir)).toEqual({
      added: ['README.md', 'shipping/README.md', 'shipping/book.md'],
      changed: [],
      stale: [],
      authored: [],
    });
  });
});

describe('section label and section id (contract §6)', () => {
  it('the registry label titles the root hub', () => {
    const site = makeSite({
      'features/shipping/book.feature': feature('Book a slot'),
      'docs/_meta/sections.yaml': [
        'version: 1',
        'sections:',
        '  - id: behaviour',
        '    label: Behaviour specs',
        '    order: 70',
        '    type: Specification',
        '',
      ].join('\n'),
    });
    const root = plan(site).plan.get('README.md') as string;
    expect(fm(root).title).toBe('Behaviour specs');
    expect(root).toContain('\n# Behaviour specs\n');
  });

  it('without a registry entry the section id is humanised; a custom section id is honoured', () => {
    const site = makeSite({ 'features/shipping/book.feature': feature('Book a slot') });
    expect(fm(plan(site).plan.get('README.md') as string).title).toBe('Behaviour');
    const custom = plan(site, { section: 'shipping-ops' }).plan.get('README.md') as string;
    expect(fm(custom).title).toBe('Shipping ops');
  });

  it('the collision message uses the configured section id', () => {
    const site = makeSite({
      'a/x.feature': feature('X one'),
      'b/x.feature': feature('X two'),
    });
    expect(() => plan(site, { sources: ['a', 'b'], section: 'specs' })).toThrow(/both map to specs\/x\.md/);
  });
});
