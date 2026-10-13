/**
 * Gherkin feature DISCOVERY + PARSE-ONCE loader (ADR-0046, WP02).
 *
 * Walks every configured source directory for `*.feature` files, parses each
 * one exactly once with `@cucumber/gherkin`, and returns an Astro-free
 * {@link FeatureModel} that the pure metadata core (`feature-core.mjs`), the
 * renderer (`render.mjs`) and the generator (`generate.mjs`) all consume. Both
 * the Astro integration (`config.ts`) and the bare-Node drift gate
 * (`generate-feature-pages.mjs --check`) call this same function, so the model
 * they see is identical by construction.
 *
 * DETERMINISM: files are ordered by source index, then by `compareCodeUnit` on
 * the source-relative POSIX path — never locale or filesystem order. Every file
 * gets a FRESH `IdGenerator.incrementing()`, so AST ids depend only on that
 * file's own contents (adding a file elsewhere never renumbers another file).
 *
 * ERRORS (house posture, glossary FR-002): malformed source and
 * misconfiguration are build-fatal. Every syntax error in every file is
 * collected first, then ONE `Error` is thrown listing them all, one line each:
 * `[dk-gherkin] <path-from-root>:<line>:<col> <parser message>`. A missing
 * source directory is fatal immediately. A document with no `Feature:` (empty
 * or comments only) is a warning and is skipped.
 *
 * PURITY CONTRACT: imports only `node:fs`, `node:path`, `node:crypto`,
 * `@cucumber/gherkin`, `@cucumber/messages` and `../vocabulary-core.mjs`. NO
 * `astro`/`@astrojs/*`, so it loads under plain `node`.
 *
 * TYPING: JSDoc only — the repo forbids `.d.ts` sidecars (see the header of
 * `../vocabulary-core.mjs`).
 *
 * @module gherkin/load
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';
import { compareCodeUnit } from '../vocabulary-core.mjs';

/** Prefix on every log line / error message this feature emits. */
export const GHERKIN_LOG_PREFIX = '[dk-gherkin]';

/**
 * One parsed `.feature` file.
 *
 * @typedef {{
 *   relPath: string,
 *   absPath: string,
 *   sourceDir: string,
 *   sourceDirIndex: number,
 *   bytes: string,
 *   sha256: string,
 *   document: import('@cucumber/messages').GherkinDocument,
 * }} FeatureFile
 *
 * - `relPath`: POSIX path relative to its own source dir (`shipping/x.feature`).
 * - `absPath`: absolute path of the file.
 * - `sourceDir`: absolute path of the source dir it was found under.
 * - `sourceDirIndex`: index of that source in the `sources` option.
 * - `bytes`: the file contents decoded as UTF-8, exactly as read (no BOM/CRLF
 *   normalisation).
 * - `sha256`: full lowercase hex SHA-256 of the RAW file bytes.
 * - `document`: the parsed `GherkinDocument`; `document.feature` is always set.
 */

/** @typedef {{ files: FeatureFile[] }} FeatureModel */

/**
 * @typedef {object} LoadFeaturesOptions
 * @property {string[]} sources Source directories, resolved against `root`.
 * @property {string} root Absolute directory the sources (and reported paths) are relative to.
 * @property {(msg: string) => void} [warn] Warning sink (default: no-op).
 */

/** Directory names never descended into (besides any dot-directory). */
const SKIP_DIRS = new Set(['node_modules']);

/** A `.feature` file name (case-sensitive, as the Cucumber runners match it). */
const FEATURE_FILE = /\.feature$/;

/** The `(line:col): ` prefix the parser puts on every error message. */
const LOCATION_PREFIX = /^\((\d+):(\d+)\):\s*/;

/**
 * Convert a platform path to POSIX separators.
 *
 * @param {string} p
 * @returns {string}
 */
function toPosix(p) {
  return p.split(path.sep).join('/');
}

/**
 * Recursively collect the `*.feature` files under `absBase`, as POSIX paths
 * relative to it, sorted with `compareCodeUnit`. Mirrors the
 * `walkMarkdownPaths` shape in `schema.ts` (plain fs, no glob dependency).
 * Skips dot-directories and `node_modules`; follows symlinks but never visits
 * the same real directory twice (cycle-safe).
 *
 * @param {string} absBase
 * @returns {string[]}
 */
function walkFeaturePaths(absBase) {
  /** @type {string[]} */
  const out = [];
  /** @type {Set<string>} */
  const seen = new Set();
  /**
   * @param {string} dir
   * @param {string} rel
   */
  const walk = (dir, rel) => {
    let real;
    try {
      real = realpathSync(dir);
    } catch {
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);
    /** @type {string[]} */
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const abs = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue; // dangling symlink / editor lock file
      }
      if (stat.isDirectory()) {
        if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
        walk(abs, relPath);
        continue;
      }
      if (stat.isFile() && FEATURE_FILE.test(name)) out.push(relPath);
    }
  };
  walk(absBase, '');
  return out.sort(compareCodeUnit);
}

/**
 * Format one parser error as `[dk-gherkin] <path>:<line>:<col> <message>`,
 * dropping the parser's own `(line:col): ` message prefix (it duplicates the
 * location). When the error carries no location, the prefix is used instead;
 * when neither exists the location is omitted.
 *
 * @param {string} displayPath
 * @param {unknown} err
 * @returns {string}
 */
function formatParseError(displayPath, err) {
  const e = /** @type {{ message?: unknown, location?: { line?: number, column?: number } }} */ (
    err ?? {}
  );
  const raw = typeof e.message === 'string' ? e.message : String(err);
  const m = LOCATION_PREFIX.exec(raw);
  const message = m ? raw.slice(m[0].length) : raw;
  const line = e.location?.line ?? (m ? Number(m[1]) : undefined);
  const column = e.location?.column ?? (m ? Number(m[2]) : undefined);
  const where = line === undefined ? displayPath : `${displayPath}:${line}:${column ?? 0}`;
  return `${GHERKIN_LOG_PREFIX} ${where} ${message}`;
}

/**
 * Discover and parse every `*.feature` file under `sources`.
 *
 * @param {LoadFeaturesOptions} options
 * @returns {FeatureModel}
 * @throws {Error} `[dk-gherkin] source directory not found: …` for a missing
 *   source; otherwise one `Error` listing every Gherkin syntax error.
 */
export function loadFeatures({ sources, root, warn = () => {} }) {
  /** @param {string} abs */
  const fromRoot = (abs) => toPosix(path.relative(root, abs)) || '.';

  /** @type {{ relPath: string, absPath: string, sourceDir: string, sourceDirIndex: number }[]} */
  const found = [];
  sources.forEach((source, sourceDirIndex) => {
    const sourceDir = path.resolve(root, source);
    let isDir = false;
    try {
      isDir = statSync(sourceDir).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) {
      throw new Error(
        `${GHERKIN_LOG_PREFIX} source directory not found: ${source} (resolved to ${sourceDir})`,
      );
    }
    for (const relPath of walkFeaturePaths(sourceDir)) {
      found.push({
        relPath,
        absPath: path.join(sourceDir, ...relPath.split('/')),
        sourceDir,
        sourceDirIndex,
      });
    }
  });

  /** @type {FeatureFile[]} */
  const files = [];
  /** @type {string[]} */
  const errors = [];
  for (const entry of found) {
    const raw = readFileSync(entry.absPath);
    const bytes = raw.toString('utf8');
    const sha256 = createHash('sha256').update(raw).digest('hex');
    const display = fromRoot(entry.absPath);

    const parser = new Parser(
      new AstBuilder(IdGenerator.incrementing()),
      new GherkinClassicTokenMatcher(),
    );
    /** @type {import('@cucumber/messages').GherkinDocument} */
    let document;
    try {
      document = parser.parse(bytes);
    } catch (err) {
      const nested = /** @type {{ errors?: unknown }} */ (err ?? {}).errors;
      const list = Array.isArray(nested) && nested.length > 0 ? nested : [err];
      for (const e of list) errors.push(formatParseError(display, e));
      continue;
    }
    if (!document.feature) {
      warn(`${GHERKIN_LOG_PREFIX} ${display}: no Feature, skipped`);
      continue;
    }
    files.push({ ...entry, bytes, sha256, document });
  }

  if (errors.length > 0) throw new Error(errors.join('\n'));
  return { files };
}
