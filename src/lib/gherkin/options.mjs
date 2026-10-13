/**
 * The `gherkin` option contract (ADR-0046), validated ONCE for both entry points:
 * the Astro integration (`config.ts` `defineDocKittyIntegrations({ gherkin })`)
 * and the bare-Node twin (`src/scripts/generate-feature-pages.mjs`). Before this
 * module only the integration validated `section`, so the CLI accepted
 * `--section ../../x` and wrote (and pruned!) outside the docs tree.
 *
 * PURITY CONTRACT: imports only the import-free `./text.mjs`, so it loads in the
 * Astro config and under plain `node` alike.
 *
 * TYPING: JSDoc-typed `.mjs`, no `.d.ts` sidecar (see `../vocabulary-core.mjs`).
 *
 * @module gherkin/options
 */

import { GHERKIN_LOG_PREFIX } from './text.mjs';

/** Default section id (folder under the docs root) the pages are generated into. */
export const DEFAULT_GHERKIN_SECTION = 'behaviour';

/**
 * Section ids the Gherkin generator may never own: `_meta` (the registry's home)
 * and every OTHER generator's section — today the glossary's `glossary`. It MUST
 * equal `['_meta', ...BUILD_GENERATED_SECTION_IDS]` (`../sections.ts`); `config.ts`
 * passes exactly that list, and a parity test pins this bare-Node default to it
 * (the CLI cannot import the TypeScript constant).
 */
export const RESERVED_GHERKIN_SECTIONS = Object.freeze(['_meta', 'glossary']);

/**
 * The raw option shape (structurally `DocKittyOptions['gherkin']`).
 *
 * @typedef {object} GherkinOptionsInput
 * @property {unknown} [sources]
 * @property {unknown} [section]
 * @property {unknown} [sourceUrlPrefix]
 * @property {unknown} [sourceRoot]
 */

/**
 * The validated option, defaults applied.
 *
 * @typedef {object} ValidatedGherkinOptions
 * @property {string[]} sources Source directories (non-empty, each non-blank).
 * @property {string} section ONE safe folder name under the docs dir.
 * @property {string} [sourceUrlPrefix]
 * @property {string} sourceRoot Site-root-relative (default `'.'`).
 */

/**
 * @typedef {object} ValidateGherkinOptionsConfig
 * @property {readonly string[]} [reservedSections] Section ids to refuse.
 *   Default {@link RESERVED_GHERKIN_SECTIONS}.
 * @property {(key: 'sources' | 'section' | 'sourceUrlPrefix' | 'sourceRoot') => string} [optionName]
 *   How errors name an option: `gherkin.<key>` (default, the astro.config
 *   spelling) or e.g. the CLI flag (`--section`).
 */

/**
 * Validate + default the `gherkin` option. Throws a `[dk-gherkin]` Error for:
 *  - `sources` that is not a non-empty array of non-blank strings;
 *  - a `section` that is not ONE safe path segment (empty, `.`/`..`, a
 *    dot-folder, or containing `/` or `\`), since it becomes
 *    `<docsDir>/<section>` and the generator prunes inside it;
 *  - a `section` in `reservedSections` (`_meta`, or ANOTHER generator's
 *    section): a generated section has a single owner. A collision with an
 *    AUTHORED folder is caught later by the generator itself (it refuses to
 *    write into a directory holding non-generated files);
 *  - a non-string `sourceUrlPrefix`, or a `sourceRoot` that is not a non-empty string.
 *
 * @param {GherkinOptionsInput} raw
 * @param {ValidateGherkinOptionsConfig} [config]
 * @returns {ValidatedGherkinOptions}
 */
export function validateGherkinOptions(
  raw,
  { reservedSections = RESERVED_GHERKIN_SECTIONS, optionName = (key) => `gherkin.${key}` } = {},
) {
  const {
    sources,
    section = DEFAULT_GHERKIN_SECTION,
    sourceUrlPrefix,
    sourceRoot = '.',
  } = raw ?? {};
  if (
    !Array.isArray(sources) ||
    sources.length === 0 ||
    sources.some((s) => typeof s !== 'string' || s.trim() === '')
  ) {
    throw new Error(
      `${GHERKIN_LOG_PREFIX} ${optionName('sources')} must be a non-empty array of directory paths ` +
        `(relative to the site root); got ${JSON.stringify(sources)}`,
    );
  }
  if (
    typeof section !== 'string' ||
    section.trim() === '' ||
    section.startsWith('.') ||
    /[/\\]/.test(section)
  ) {
    throw new Error(
      `${GHERKIN_LOG_PREFIX} ${optionName('section')} must be a single folder name under the docs dir ` +
        `(no '/', '\\', '..' or leading '.'); got ${JSON.stringify(section)}`,
    );
  }
  if (reservedSections.includes(section)) {
    throw new Error(
      `${GHERKIN_LOG_PREFIX} ${optionName('section')} ${JSON.stringify(section)} is reserved ` +
        `(owned by another generator or the section registry); choose another section id`,
    );
  }
  if (sourceUrlPrefix !== undefined && typeof sourceUrlPrefix !== 'string') {
    throw new Error(`${GHERKIN_LOG_PREFIX} ${optionName('sourceUrlPrefix')} must be a string`);
  }
  if (typeof sourceRoot !== 'string' || sourceRoot === '') {
    throw new Error(`${GHERKIN_LOG_PREFIX} ${optionName('sourceRoot')} must be a non-empty path string`);
  }
  return {
    sources: /** @type {string[]} */ ([...sources]),
    section,
    ...(sourceUrlPrefix !== undefined ? { sourceUrlPrefix } : {}),
    sourceRoot,
  };
}

/**
 * Validate the site's index basename(s) as the generator will use them: each
 * becomes a file name INSIDE the generated section (`<first>.md`), so an entry
 * with a path separator or a leading `.` could name a file outside it. Throws a
 * `[dk-gherkin]` Error for such an entry. Blank entries are ignored (the
 * generator drops them too).
 *
 * @param {string | readonly string[] | undefined} indexBasename
 * @param {string} [optionName] How the error names the option.
 * @returns {void}
 */
export function validateIndexBasenames(indexBasename, optionName = 'indexBasename') {
  const list = indexBasename === undefined ? [] : [indexBasename].flat();
  for (const entry of list) {
    if (typeof entry !== 'string' || entry.trim() === '') continue;
    if (entry.startsWith('.') || /[/\\]/.test(entry)) {
      throw new Error(
        `${GHERKIN_LOG_PREFIX} ${optionName} must be a plain file name (no '/', '\\' or leading '.'): ` +
          `a generated page is written as <name>.md inside the section; got ${JSON.stringify(entry)}`,
      );
    }
  }
}
