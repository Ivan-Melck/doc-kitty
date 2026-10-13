/**
 * Gherkin feature-page generator — codegen INTO the docs collection (ADR-0046,
 * the ADR-0026 glossary seam). From the {@link FeatureModel} the loader built,
 * this writes real Markdown files under `<docsRoot>/<section>/`:
 *
 *   - `<section>/<dir…>/<feature>.md`   — one `kind: Specification` page per feature;
 *   - `<section>/<dir…>/<indexBasename[0]>.md` — a `kind: Hub` page for the section
 *     root and for every directory that (recursively) holds a feature.
 *
 * Because the files land under the globbed docs base, the existing loader,
 * sidebar, sitemap draft filter, `llms.txt` and agent API pick them up with zero
 * new wiring — and so do the bare-Node gates, which walk files on disk.
 *
 * OWNERSHIP (contract §7, risk R4): every page carries
 * `generated.by: "doc-kitty/gherkin"`. Before writing, the generator scans the
 * output directory; a file WITHOUT that stamp is authored content and the run
 * fails BEFORE any write. Stale owned files are deleted, then empty directories.
 *
 * DETERMINISM (risk R3): {@link planFeaturePages} is a pure function of the model
 * and the docs tree it reads (ADR listing, section registry) — no clock, no
 * locale, code-unit ordering throughout — and {@link generateFeaturePages} only
 * rewrites a file whose bytes changed, so a dev-server restart that regenerates
 * the same input never touches the tree (no restart loop).
 *
 * Plain `.mjs` (JSDoc-typed, no `.d.ts`) so the Astro integration and the
 * bare-Node `generate-feature-pages.mjs --check` drift gate share ONE
 * implementation: parity holds by construction.
 *
 * @module gherkin/generate
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { compareCodeUnit, DEFAULT_INDEX_BASENAME, slug } from '../vocabulary-core.mjs';
import { loadSectionRegistry } from '../vocabulary-loader.mjs';
import {
  GENERATED_BY,
  buildFrontmatter,
  missionPrefix,
  serializeFrontmatter,
  serializeHubFrontmatter,
} from './feature-core.mjs';
import { escapeInline, renderFeatureBody } from './render.mjs';

/** @typedef {import('./load.mjs').FeatureModel} FeatureModel */
/** @typedef {import('./load.mjs').FeatureFile} FeatureFile */

/** Default section id (folder under the docs root) the pages are generated into. */
export const DEFAULT_GHERKIN_SECTION = 'behaviour';

/** The one-line intro every generated hub carries (contract §6). */
const HUB_INTRO = "Behaviour specifications generated from the repository's Gherkin feature files.";

/**
 * A directory hub's `description`. Long enough (≥50 chars for any title) to clear
 * the frontmatter gate's soft minimum, so generated hubs never add warnings.
 *
 * @param {string} title
 * @returns {string}
 */
function hubDescription(title) {
  return `Behaviour specifications for ${title}, generated from Gherkin feature files.`;
}

/**
 * @typedef {object} PlanOptions
 * @property {string} docsRoot Absolute docs root (`<site>/<docsDir>`): the ADR
 *   listing and section registry are read from here.
 * @property {string} [section] Section id the pages land under. Default `behaviour`.
 * @property {string | readonly string[]} [indexBasename] The site's index
 *   basename(s); the hub file is `<first>.md`. Default `README`.
 * @property {string} [sourceRoot] Absolute directory `sources[0].resource` paths
 *   are relative to. Default `process.cwd()`.
 * @property {string} [sourceUrlPrefix] Optional browse-URL prefix prepended to
 *   the source path (e.g. `https://github.com/o/r/blob/main/`).
 * @property {(msg: string) => void} [warn] Warning sink. Default no-op.
 */

/**
 * @typedef {object} GenerateOptions
 * @property {string} outDir Absolute output directory (`<docsRoot>/<section>`).
 */

/**
 * The first configured index basename — the hub file stem. Taking the first
 * makes README-as-index collapse the hub to its directory route under either
 * loader setting (contract §1).
 *
 * @param {string | readonly string[] | undefined} indexBasename
 * @returns {string}
 */
export function hubBasename(indexBasename) {
  if (Array.isArray(indexBasename)) return indexBasename[0] ?? DEFAULT_INDEX_BASENAME;
  return typeof indexBasename === 'string' && indexBasename !== ''
    ? indexBasename
    : DEFAULT_INDEX_BASENAME;
}

/** `shipping-ops` → `Shipping ops`: a hub title for a directory with no registry label. */
function humanise(segment) {
  const words = segment.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Full lowercase hex sha256 of a string. */
function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** POSIX-normalise a path (Windows separators → `/`). */
function toPosix(p) {
  return p.split(path.sep).join('/');
}

/**
 * Plan every generated file WITHOUT touching the output tree: a map from the
 * output path (POSIX, relative to `<docsRoot>/<section>`) to its exact contents,
 * in code-unit order. The single source the writer and the `--check` gate share.
 *
 * Fatal (throws): two sources mapping to the same output path.
 *
 * @param {FeatureModel} model
 * @param {PlanOptions} opts
 * @returns {Map<string, string>}
 */
export function planFeaturePages(model, opts) {
  const {
    docsRoot,
    section = DEFAULT_GHERKIN_SECTION,
    indexBasename,
    sourceRoot = process.cwd(),
    sourceUrlPrefix,
    warn = () => {},
  } = opts;
  /** @type {Map<string, string>} */
  const plan = new Map();
  if (model.files.length === 0) return plan;

  const hubFile = `${hubBasename(indexBasename)}.md`;
  // Every configured index basename, lowercased. The loader matches index
  // basenames case-insensitively, so a feature whose leaf slug is one of them
  // (`README.feature` → `readme.md`, or `index.feature` under
  // `['README','index']`) would be routed as its directory's index and collide
  // with the generated hub — and on a case-insensitive filesystem overwrite it.
  const indexLeaves = new Set(
    [hubBasename(indexBasename), ...(Array.isArray(indexBasename) ? indexBasename : [])].map((b) =>
      b.toLowerCase(),
    ),
  );
  const adrDir = path.join(docsRoot, 'adr');
  const adrFileNames = existsSync(adrDir)
    ? readdirSync(adrDir).filter((f) => f.endsWith('.md')).sort(compareCodeUnit)
    : [];
  const registry = loadSectionRegistry(docsRoot);
  const mission = missionPrefix(registry);
  const sectionLabel = registry?.find((s) => s.id === section)?.label ?? humanise(section);

  /** Output path → the source that claimed it (for the collision message). */
  /** @type {Map<string, string>} */
  const claimedBy = new Map();
  /** Directory (POSIX, '' = section root) → its children. */
  /** @type {Map<string, Array<{ out: string, title: string, description: string, href: string }>>} */
  const children = new Map([['', []]]);
  /** @type {Map<string, string>} */
  const dirTitles = new Map([['', sectionLabel]]);

  for (const file of model.files) {
    const feature = file.document.feature;
    if (!feature) continue;
    const sourceLabel = toPosix(path.relative(sourceRoot, file.absPath));
    const segments = file.relPath.replace(/\.feature$/, '').split('/');
    const slugged = segments.map((s) => slug(s));
    if (slugged.some((s) => s === '')) {
      throw new Error(`[dk-gherkin] ${sourceLabel}: path has a segment with no slug-able characters`);
    }
    const out = `${slugged.join('/')}.md`;
    if (indexLeaves.has(slugged[slugged.length - 1])) {
      const hubOut = [...slugged.slice(0, -1), hubFile].join('/');
      throw new Error(
        `[dk-gherkin] output collision: ${sourceLabel} maps to ${section}/${out}, an index ` +
          `basename that collides with the generated hub ${section}/${hubOut}; rename the feature file`,
      );
    }
    const prior = claimedBy.get(out);
    if (prior !== undefined) {
      throw new Error(
        `[dk-gherkin] output collision: ${prior} and ${sourceLabel} both map to ${section}/${out}`,
      );
    }
    claimedBy.set(out, sourceLabel);

    const { fields, warnings } = buildFrontmatter({
      featureName: feature.name,
      description: feature.description,
      tags: feature.tags,
      file: sourceLabel,
      sourceResource: sourceUrlPrefix ? `${sourceUrlPrefix}${sourceLabel}` : sourceLabel,
      hash: file.sha256,
      missionPrefix: mission,
      adrFileNames,
      location: feature.location,
    });
    for (const w of warnings) warn(w);
    const body = renderFeatureBody(file.document, { file: sourceLabel, warn });
    plan.set(out, `${serializeFrontmatter(fields)}\n\n${body}`);

    // Register the page with its directory hub, and every ancestor directory
    // with ITS parent hub (a directory with a feature anywhere below it).
    const dirs = slugged.slice(0, -1);
    const parent = dirs.join('/');
    if (!children.has(parent)) children.set(parent, []);
    // A DRAFT page (`@wip`, `@dk:status=draft`) is still generated, but never
    // listed in its hub: the Hub layout's own child listing drops drafts
    // (`hub-children.mjs`, INV-1), and the hub's raw Markdown is served to agents
    // (`/api/pages/<hub>.json`), so a listed draft would leak past draft gating.
    if (fields.doc_status !== 'draft') {
      children.get(parent)?.push({
        out,
        title: fields.title,
        description: fields.description,
        href: `./${slugged[slugged.length - 1]}/`,
      });
    }
    for (let depth = dirs.length; depth > 0; depth -= 1) {
      const dir = dirs.slice(0, depth).join('/');
      if (dirTitles.has(dir)) continue;
      dirTitles.set(dir, humanise(segments[depth - 1]));
      const up = dirs.slice(0, depth - 1).join('/');
      if (!children.has(up)) children.set(up, []);
      if (!children.has(dir)) children.set(dir, []);
    }
  }

  // Hubs: link every child directory hub into its parent (titles are known now).
  for (const dir of dirTitles.keys()) {
    if (dir === '') continue;
    const up = dir.split('/').slice(0, -1).join('/');
    const title = /** @type {string} */ (dirTitles.get(dir));
    children.get(up)?.push({
      out: `${dir}/${hubFile}`,
      title,
      description: hubDescription(title),
      href: `./${dir.split('/').pop()}/`,
    });
  }
  for (const [dir, list] of children) {
    const title = /** @type {string} */ (dirTitles.get(dir));
    const description = dir === '' ? HUB_INTRO : hubDescription(title);
    const sorted = [...list].sort((a, b) => compareCodeUnit(a.out, b.out));
    // `generated.at` hashes the sorted child list (contract §6): it changes
    // exactly when a child is added, removed or renamed.
    const hash = sha256(sorted.map((c) => c.out).join('\n'));
    const items = sorted.map(
      (c) => `- [${escapeInline(c.title)}](${c.href}) — ${c.description}`,
    );
    const out = dir === '' ? hubFile : `${dir}/${hubFile}`;
    if (claimedBy.has(out)) {
      throw new Error(
        `[dk-gherkin] output collision: ${claimedBy.get(out)} maps onto the generated hub ${section}/${out}`,
      );
    }
    plan.set(
      out,
      `${serializeHubFrontmatter({ title, description, hash })}\n\n` +
        `# ${escapeInline(title)}\n\n${HUB_INTRO}\n\n${items.join('\n')}\n`,
    );
  }

  return new Map([...plan].sort(([a], [b]) => compareCodeUnit(a, b)));
}

/**
 * Walk `outDir` and classify every file: OWNED (a `.md` whose frontmatter has
 * `generated.by === "doc-kitty/gherkin"`) or AUTHORED (anything else). Dotfiles
 * are ignored. Returns POSIX paths relative to `outDir`, code-unit sorted.
 *
 * @param {string} outDir
 * @returns {{ owned: string[], authored: string[] }}
 */
export function scanOutputDir(outDir) {
  /** @type {string[]} */
  const owned = [];
  /** @type {string[]} */
  const authored = [];
  if (!existsSync(outDir)) return { owned, authored };
  /** @param {string} dir */
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      const rel = toPosix(path.relative(outDir, abs));
      if (entry.name.endsWith('.md') && isOwnedPage(readFileSync(abs, 'utf8'))) owned.push(rel);
      else authored.push(rel);
    }
  };
  walk(outDir);
  return { owned: owned.sort(compareCodeUnit), authored: authored.sort(compareCodeUnit) };
}

/**
 * Whether a Markdown file's frontmatter stamps it as generated by this pipeline.
 * A file whose frontmatter does not parse is NOT owned (never delete it).
 *
 * @param {string} contents
 * @returns {boolean}
 */
function isOwnedPage(contents) {
  try {
    const { data } = matter(contents);
    return data?.generated?.by === GENERATED_BY;
  } catch {
    return false;
  }
}

/**
 * Compare the plan against the committed tree without writing (`--check`).
 *
 * @param {Map<string, string>} plan
 * @param {string} outDir
 * @returns {{ added: string[], changed: string[], stale: string[], authored: string[] }}
 */
export function diffFeaturePages(plan, outDir) {
  const { owned, authored } = scanOutputDir(outDir);
  /** @type {string[]} */
  const added = [];
  /** @type {string[]} */
  const changed = [];
  for (const [rel, contents] of plan) {
    const abs = path.join(outDir, rel);
    if (!existsSync(abs)) added.push(rel);
    else if (readFileSync(abs, 'utf8') !== contents) changed.push(rel);
  }
  const stale = owned.filter((rel) => !plan.has(rel));
  return { added, changed, stale, authored };
}

/**
 * Generate the section: plan, refuse to clobber authored content, write changed
 * files, delete stale owned files, then remove emptied directories.
 *
 * Fatal (throws, before ANY write): an output collision, or a non-generated file
 * inside `outDir` (a generated section has a single owner).
 *
 * @param {FeatureModel} model
 * @param {PlanOptions & GenerateOptions} opts
 * @returns {{ written: string[], unchanged: string[], removed: string[] }}
 */
export function generateFeaturePages(model, opts) {
  const { outDir, warn = () => {} } = opts;
  const plan = planFeaturePages(model, opts);
  const { owned, authored } = scanOutputDir(outDir);
  if (authored.length > 0) {
    throw new Error(
      `[dk-gherkin] refusing to write into ${outDir}: ${authored.join(', ')} ` +
        `${authored.length === 1 ? 'is' : 'are'} not generated by ${GENERATED_BY} ` +
        '(a generated section has a single owner; move authored pages elsewhere or choose another gherkin.section)',
    );
  }
  if (model.files.length === 0) {
    warn(`[dk-gherkin] no .feature files found; ${owned.length} previously generated page(s) will be removed`);
  }

  /** @type {string[]} */
  const written = [];
  /** @type {string[]} */
  const unchanged = [];
  for (const [rel, contents] of plan) {
    const abs = path.join(outDir, rel);
    if (existsSync(abs) && readFileSync(abs, 'utf8') === contents) {
      unchanged.push(rel);
      continue;
    }
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
    written.push(rel);
  }

  const removed = owned.filter((rel) => !plan.has(rel));
  for (const rel of removed) unlinkSync(path.join(outDir, rel));
  if (removed.length > 0) pruneEmptyDirs(outDir);

  return { written, unchanged, removed };
}

/**
 * Remove empty directories under (and including) `dir`, bottom-up. Only reached
 * after deleting owned files, and the authored-file check guarantees `dir` holds
 * nothing but generated output (dotfiles aside — a dir holding one is kept).
 *
 * @param {string} dir
 * @returns {boolean} Whether `dir` itself was removed.
 */
function pruneEmptyDirs(dir) {
  if (!existsSync(dir)) return false;
  let empty = true;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && pruneEmptyDirs(path.join(dir, entry.name))) continue;
    empty = false;
  }
  if (empty) rmdirSync(dir);
  return empty;
}
