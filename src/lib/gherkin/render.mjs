/**
 * Gherkin → Markdown body renderer (ADR-0046; mapping contract §4/§5, WP04).
 *
 * Turns one parsed `GherkinDocument` (the plain-object AST `@cucumber/gherkin`
 * builds) into the Markdown body of a generated feature page: everything AFTER
 * the frontmatter, starting with `# <Feature name>` and ending with exactly one
 * trailing newline. The frontmatter is WP03's job (`feature-core.mjs`); the page
 * assembly and writes are WP05's.
 *
 * Shape (normative in the mapping contract §4):
 *
 *  - Heading levels: Feature `#`. Without Rules, Background and Scenarios are
 *    `##`. With Rules, Rule is `##` and its children `###`; Background/Scenarios
 *    before the first Rule stay `##` (MD001-safe either way).
 *  - Keywords are rendered as written in the source (trimmed), so i18n keywords
 *    stay localised.
 *  - Steps are list items `- **<Keyword>** <escaped text>` (prose, so glossary
 *    auto-linking can reach them). In a Scenario Outline, `<placeholder>`s become
 *    inline code.
 *  - DataTable / DocString step arguments nest under their list item (2-space
 *    indent, blank line before and after: MD031/MD058).
 *  - Examples are a bold label paragraph + inline tags + description + table.
 *  - Descriptions are dedented and passed through as Markdown (repo-committed
 *    text, the same trust boundary as authored `docs/`). The Feature's leading
 *    narrative block gets hard line breaks.
 *  - A summary line follows the Feature description.
 *
 * Step text, names and table cells are LITERAL text and go through the escapers
 * below, so none of this pipeline's active syntaxes (CommonMark, GFM — including
 * its autolink literals — smartypants aside, `remark-directive`, Markua attribute
 * lists) fire on them.
 *
 * PURITY CONTRACT: the only runtime imports are `./text.mjs` (itself
 * import-free) and the fs-free `../vocabulary-core.mjs` (for THE code-unit
 * comparator), so this module loads in the Astro build AND in the bare-Node
 * `generate-feature-pages.mjs --check` gate. The AST is a plain object; the
 * `@cucumber/messages` references below are type-only JSDoc imports.
 *
 * @module gherkin/render
 */

import { compareCodeUnit } from '../vocabulary-core.mjs';
import { GHERKIN_LOG_PREFIX, dedent, featureTitle, splitNarrative } from './text.mjs';

/** @typedef {import('@cucumber/messages').GherkinDocument} GherkinDocument */
/** @typedef {import('@cucumber/messages').Feature} Feature */
/** @typedef {import('@cucumber/messages').Rule} Rule */
/** @typedef {import('@cucumber/messages').Background} Background */
/** @typedef {import('@cucumber/messages').Scenario} Scenario */
/** @typedef {import('@cucumber/messages').Step} Step */
/** @typedef {import('@cucumber/messages').Examples} Examples */
/** @typedef {import('@cucumber/messages').Tag} Tag */
/** @typedef {import('@cucumber/messages').TableRow} TableRow */
/** @typedef {import('@cucumber/messages').DataTable} DataTable */
/** @typedef {import('@cucumber/messages').DocString} DocString */

/**
 * @typedef {object} RenderOptions
 * @property {string} [file] Source path used in warnings (e.g. `features/a.feature`).
 * @property {(msg: string) => void} [warn] Warning sink (defaults to a no-op).
 */

/**
 * Characters that can NOT start a `remark-directive` name (micromark's
 * `unicodeWhitespace` / `unicodePunctuation`): a `:` followed by anything else
 * would open a text directive.
 */
const DIRECTIVE_NAME_STOP = /[\s\p{P}\p{S}]/u;

/**
 * The inert empty HTML comment that splits a GFM autolink literal. GFM turns
 * `www.x.y`, `http(s)://…` and `a@b.cd` in plain text into links twice over:
 * micromark's literal-autolink tokenizer, and `mdast-util-gfm-autolink-literal`'s
 * post-parse transform over each mdast TEXT NODE's decoded value. A backslash or
 * entity escape (`www\.x.y`, `a&#64;b.cd`) survives only the first — the
 * decoded text is unchanged, so the transform still links it. Splitting the text
 * node is what defeats both, and an empty comment does that while rendering
 * nothing: the visible text, copy-paste, the heading ids and the TOC are all
 * unchanged (MD033 is off; markdownlint's MD034 no longer sees a bare URL).
 */
export const AUTOLINK_BREAK = '<!---->';

/**
 * Indices in `text` before which {@link AUTOLINK_BREAK} goes, one per GFM
 * autolink-literal trigger (mirroring the `unsafe` patterns
 * `mdast-util-gfm-autolink-literal` itself declares for serialising text):
 *
 * - `www` + `.` (any case) → break before the `.`;
 * - `http`/`https` + `://` (any case) → break before the `:`;
 * - an `@` between an email local-part character (`[+\-.\w]`) and a domain
 *   character (`[\-.\w]`) → break before the `@`.
 *
 * @param {string} text Raw (unescaped) literal text.
 * @returns {Set<number>}
 */
function autolinkBreaks(text) {
  /** @type {Set<number>} */
  const at = new Set();
  for (const m of text.matchAll(/www(?=\.)/gi)) at.add((m.index ?? 0) + 3);
  for (const m of text.matchAll(/https?(?=:\/\/)/gi)) at.add((m.index ?? 0) + m[0].length);
  for (const m of text.matchAll(/[-+.\w](?=@[-.\w])/g)) at.add((m.index ?? 0) + 1);
  return at;
}

/**
 * Escape literal text for an inline Markdown context (step text, names).
 *
 * - `\` `` ` `` `*` `_` `[` `]` `{` `}` `~` → backslash (emphasis, code, links,
 *   GFM strikethrough, Markua attribute lists).
 * - `<` `>` `&` → `&lt;` `&gt;` `&amp;` (raw HTML renders: MD033 is off).
 * - `:` followed by a character that can start a directive name → `\:`.
 *   `remark-directive` parses `word:name` (and `10:30`!) as a text directive
 *   even WITHOUT a `[label]`; a name may start with anything but whitespace or
 *   Unicode punctuation/symbols (micromark-extension-directive `factoryName`).
 * - GFM autolink literals (`www.x.y`, `https://…`, `a@b.cd`) → split with
 *   {@link AUTOLINK_BREAK} (see there for why a backslash does not work).
 *
 * `|` is NOT escaped here (only meaningful inside table cells; see
 * {@link escapeCell}). Quotes, dashes and ellipses are left for smartypants.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeInline(text) {
  const breaks = autolinkBreaks(text);
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (breaks.has(i)) out += AUTOLINK_BREAK;
    switch (ch) {
      case '\\':
      case '`':
      case '*':
      case '_':
      case '[':
      case ']':
      case '{':
      case '}':
      case '~':
        out += `\\${ch}`;
        break;
      case '<':
        out += '&lt;';
        break;
      case '>':
        out += '&gt;';
        break;
      case '&':
        out += '&amp;';
        break;
      case ':':
        out += i + 1 < text.length && !DIRECTIVE_NAME_STOP.test(text[i + 1]) ? '\\:' : ':';
        break;
      default:
        out += ch;
    }
  }
  return out;
}

/**
 * Escape literal text for a GFM table cell: {@link escapeInline} plus `\|`. A
 * newline (Gherkin's `\n` cell escape) cannot live in a GFM row, so it becomes
 * `<br>`.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeCell(text) {
  return text
    .split(/\r\n?|\n/)
    .map((line) => escapeInline(line).replace(/\|/g, '\\|'))
    .join('<br>');
}

/**
 * Escape literal text for an ATX heading (or any line-initial position):
 * {@link escapeInline}, plus a leading `#`, `>`, `-` or `+` gets a backslash, a
 * leading ordered-list marker (`1.` / `1)`) gets its `.`/`)` backslashed (a
 * backslash before a digit is not an escape in CommonMark), and a trailing run
 * of `#` that would read as an ATX closing sequence gets a backslash.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeHeading(text) {
  let out = escapeInline(text);
  if (/^[#>+-]/.test(out)) {
    out = `\\${out}`;
  } else {
    out = out.replace(/^(\d+)([.)])/, '$1\\$2');
  }
  // `## foo #` — a space-preceded trailing `#` run is a closing sequence and
  // would be stripped; `\#` breaks it. (A whole-`#` name is handled above.)
  out = out.replace(/([ \t])(#+)$/, '$1\\$2');
  return out;
}

/**
 * The backtick fence for a fenced code block holding `content`: length
 * `max(3, longest backtick run + 1)`.
 *
 * @param {string} content
 * @returns {string}
 */
export function fenceFor(content) {
  return '`'.repeat(Math.max(3, longestBacktickRun(content) + 1));
}

/** @param {string} text */
function longestBacktickRun(text) {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}

/**
 * An inline code span holding `text` verbatim (fence one longer than its longest
 * backtick run; padded when it starts/ends with a backtick).
 *
 * @param {string} text
 * @returns {string}
 */
function codeSpan(text) {
  const fence = '`'.repeat(longestBacktickRun(text) + 1);
  const pad = /^`|`$/.test(text) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/** Outline placeholder, as the pickle compiler substitutes it. */
const PLACEHOLDER = /<[^<>\n]+>/g;

/**
 * Step text: escaped prose, with `<placeholder>`s as inline code in an outline.
 *
 * @param {string} text
 * @param {boolean} outline
 */
function renderStepText(text, outline) {
  if (!outline) return escapeInline(text);
  let out = '';
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    const at = m.index ?? 0;
    out += escapeInline(text.slice(last, at)) + codeSpan(m[0]);
    last = at + m[0].length;
  }
  return out + escapeInline(text.slice(last));
}

/**
 * A heading/label title: `<Keyword>: <name>`, or just `<Keyword>` when unnamed.
 *
 * @param {string} keyword
 * @param {string} name
 */
function titled(keyword, name) {
  const k = escapeHeading(keyword.trim());
  const n = name.trim();
  return n ? `${k}: ${escapeHeading(n)}` : k;
}

/**
 * A described block's description: dedented Markdown passthrough, with runs of
 * blank lines collapsed to one (MD012). `''` when there is none.
 *
 * @param {string | undefined} description
 */
function passthrough(description) {
  return dedent(description).replace(/\n{3,}/g, '\n\n');
}

/**
 * Tags as sorted, de-duplicated inline code (`` `@a` `@b` ``); `''` when none.
 *
 * @param {readonly Tag[] | undefined} tags
 */
function renderTags(tags) {
  const names = [...new Set((tags ?? []).map((t) => t.name))].sort(compareCodeUnit);
  return names.map(codeSpan).join(' ');
}

/**
 * GFM table lines (header = first row; a 1-row table is header + delimiter).
 *
 * @param {readonly TableRow[]} rows
 * @returns {string[]}
 */
function tableLines(rows) {
  if (rows.length === 0) return [];
  const row = (/** @type {TableRow} */ r) =>
    `|${r.cells.map((c) => (c.value === '' ? ' ' : ` ${escapeCell(c.value)} `)).join('|')}|`;
  const [head, ...body] = rows;
  const delimiter = `|${head.cells.map(() => ' --- ').join('|')}|`;
  return [row(head), delimiter, ...body.map(row)];
}

/**
 * A step argument's lines (DataTable or DocString), un-indented.
 *
 * @param {Step} step
 * @returns {string[] | null}
 */
function argumentLines(step) {
  if (step.dataTable) return tableLines(step.dataTable.rows);
  if (step.docString) {
    const { content } = step.docString;
    const fence = fenceFor(content);
    // Sanitised media type; MD040 requires a language on every fence, so a
    // DocString without one is labelled `text`.
    const info = (step.docString.mediaType ?? '').replace(/[^A-Za-z0-9+.#-]/g, '') || 'text';
    return [`${fence}${info}`, ...(content === '' ? [] : content.split(/\r\n?|\n/)), fence];
  }
  return null;
}

/**
 * The steps list. An item carrying an argument nests it (2-space indent) behind
 * a blank line and is followed by a blank line before the next item.
 *
 * @param {readonly Step[]} steps
 * @param {boolean} outline
 */
function renderSteps(steps, outline) {
  let out = '';
  steps.forEach((step, i) => {
    out += `- **${escapeInline(step.keyword.trim())}** ${renderStepText(step.text, outline)}`;
    const arg = argumentLines(step);
    if (arg) {
      out += `\n\n${arg.map((l) => (l === '' ? '' : `  ${l}`)).join('\n')}`;
    }
    if (i < steps.length - 1) out += arg ? '\n\n' : '\n';
  });
  return out;
}

/**
 * One Examples block: bold label (+ inline tags), description, table.
 *
 * @param {Examples} examples
 * @returns {string[]}
 */
function renderExamples(examples) {
  const tags = renderTags(examples.tags);
  const label = `**${titled(examples.keyword, examples.name)}**${tags ? ` ${tags}` : ''}`;
  const blocks = [label];
  const description = passthrough(examples.description);
  if (description) blocks.push(description);
  const rows = examples.tableHeader ? [examples.tableHeader, ...examples.tableBody] : [];
  if (rows.length > 0) blocks.push(tableLines(rows).join('\n'));
  return blocks;
}

/**
 * A Background or Scenario (incl. Outline) section.
 *
 * @param {Background | Scenario} node
 * @param {number} level Heading depth.
 * @returns {string[]}
 */
function renderSection(node, level) {
  const blocks = [`${'#'.repeat(level)} ${titled(node.keyword, node.name)}`];
  const description = passthrough(node.description);
  if (description) blocks.push(description);
  const examples = 'examples' in node ? node.examples : [];
  if ('tags' in node) {
    const tags = renderTags(node.tags);
    if (tags) blocks.push(tags);
  }
  if (node.steps.length > 0) blocks.push(renderSteps(node.steps, examples.length > 0));
  for (const ex of examples) blocks.push(...renderExamples(ex));
  return blocks;
}

/**
 * Pluralised count (`1 rule`, `2 rules`).
 *
 * @param {number} n
 * @param {string} noun
 */
function count(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * Warn on duplicate sibling scenario headings (MD024 `siblings_only` rejects
 * them; the scenario anchor would also be suffixed).
 *
 * @param {readonly Scenario[]} scenarios Siblings under one parent.
 * @param {string} file
 * @param {(msg: string) => void} warn
 */
function warnDuplicates(scenarios, file, warn) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  for (const s of scenarios) {
    const key = titled(s.keyword, s.name);
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, s.location.line);
    } else {
      warn(
        `${GHERKIN_LOG_PREFIX} ${file}:${s.location.line} duplicate scenario name "${s.name.trim()}" ` +
          `(also at line ${first}) — markdownlint MD024 will reject the duplicate heading`,
      );
    }
  }
}

/**
 * Render a parsed Gherkin document as the Markdown body of its feature page.
 *
 * @param {GherkinDocument} document The parser output.
 * @param {RenderOptions} [opts]
 * @returns {string} The body (from `# <Feature name>`), ending in exactly one
 *   newline; `''` when the document has no Feature.
 */
export function renderFeatureBody(document, opts = {}) {
  const { file = '<unknown>', warn = () => {} } = opts;
  const feature = document.feature;
  if (!feature) return '';

  /** @type {string[]} */
  // The ONE unnamed-Feature fallback (`featureTitle`), shared with the page title.
  const blocks = [`# ${escapeHeading(featureTitle(feature.name, feature.keyword))}`];

  const { narrative, rest } = splitNarrative(feature.description);
  if (narrative.length > 0) blocks.push(narrative.join('\\\n'));
  const restBody = rest.replace(/\n{3,}/g, '\n\n');
  if (restBody) blocks.push(restBody);

  // Summary counts.
  let rules = 0;
  let scenarios = 0;
  let exampleRows = 0;
  /** @param {Scenario} s */
  const tally = (s) => {
    scenarios += 1;
    for (const ex of s.examples) exampleRows += ex.tableBody.length;
  };
  for (const child of feature.children) {
    if (child.scenario) tally(child.scenario);
    if (child.rule) {
      rules += 1;
      for (const rc of child.rule.children) if (rc.scenario) tally(rc.scenario);
    }
  }
  if (scenarios > 0) {
    const parts = [];
    if (rules > 0) parts.push(count(rules, 'rule'));
    parts.push(count(scenarios, 'scenario'));
    if (exampleRows > 0) parts.push(count(exampleRows, 'example row'));
    blocks.push(`*${parts.join(' · ')}*`);
  }

  /** @type {Scenario[]} */
  const topScenarios = [];
  /** Sibling groups for the duplicate check, in document order. */
  const siblingGroups = [topScenarios];
  for (const child of feature.children) {
    if (child.background) blocks.push(...renderSection(child.background, 2));
    if (child.scenario) {
      topScenarios.push(child.scenario);
      blocks.push(...renderSection(child.scenario, 2));
    }
    if (child.rule) {
      const rule = child.rule;
      blocks.push(`## ${titled(rule.keyword, rule.name)}`);
      const description = passthrough(rule.description);
      if (description) blocks.push(description);
      const tags = renderTags(rule.tags);
      if (tags) blocks.push(tags);
      /** @type {Scenario[]} */
      const ruleScenarios = [];
      for (const rc of rule.children) {
        if (rc.background) blocks.push(...renderSection(rc.background, 3));
        if (rc.scenario) {
          ruleScenarios.push(rc.scenario);
          blocks.push(...renderSection(rc.scenario, 3));
        }
      }
      siblingGroups.push(ruleScenarios);
    }
  }
  for (const group of siblingGroups) warnDuplicates(group, file, warn);

  return `${blocks.join('\n\n')}\n`;
}
