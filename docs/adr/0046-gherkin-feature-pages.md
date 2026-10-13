---
title: "ADR-0046: Render Gherkin .feature files as Specification pages by codegen into the docs collection"
description: An opt-in gherkin preset parses .feature sources once and generates one Specification page per feature into the docs collection, reusing the ADR-0026 seam.
doc_status: active
updated: 2026-10-13
type: ADR
kind: ADR
authors:
  - ivan@spec-kitty.ai
related:
  - adr/0026-glossary-source-and-generation-seam
  - adr/0027-auto-link-resolution-scoping-and-term-directive
  - adr/0028-glossary-frontmatter-fields
  - adr/0009-finalize-metadata-contract
  - adr/0033-flexible-section-identity
  - adr/0035-vocabulary-core-consolidation
  - architecture/research/qa-portal
---

# ADR-0046: Render Gherkin `.feature` files as Specification pages by codegen into the docs collection

## Status

Accepted. The preset is switched on in the example site (`gherkin: { sources: ['features'],
section: 'behaviour' }` in `example/astro.config.mjs`), which builds and gates the
generated behaviour section end to end.

## Context

BDD repositories keep their most precise behavioural statements in Gherkin
`.feature` files. The [QA portal research](../architecture/research/qa-portal.md)
names "BDD living documentation" as the higher-value half of that portal, and the
project charter selects `PARADIGM:behaviour-driven-development`,
`TOOLGUIDE:gherkin` and `PROCEDURE:bdd-scenario-lifecycle`.

doc-kitty already has every downstream capability such pages need:

- glossary auto-linking with bounded contexts (ADR-0027/0028);
- `related` and `audience` blocks (ADR-0009);
- registry-derived types (ADR-0033);
- the discovery surfaces (`llms.txt`, agent API).

What it lacks is a way for non-Markdown sources to enter the `docs` collection,
which is a `glob` over `**/*.{md,mdx}`.

ADR-0026 settled the same question for the glossary. Non-authored pages are
codegen'd as Markdown **into** the collection, because an injected route is
invisible to the sidebar, sitemap filter, agent API, `llms.txt` and the bare-Node
gates (ADR-0026's finding AS-6).

## Decision

1. **Opt-in preset.** `defineDocKittyIntegrations({ gherkin: { sources, section? } })`.
   Absent means no integration and unchanged pages, routes and config (the
   release's TOC target-size CSS is a separate, site-wide accessibility fix). Unlike the glossary,
   activation is an explicit option, not presence, because `.feature` files have
   no canonical location.
2. **Parse once with the official parser.** `@cucumber/gherkin` +
   `@cucumber/messages` (exact-pinned) with deterministic incrementing ids. Syntax
   errors are build-fatal, listing every `file:line:col`.
3. **Codegen into the collection (the ADR-0026 seam).** During `astro:config:setup`,
   write one page per feature to `<docsDir>/<section>/<path>.md`, plus one hub
   per directory with a non-draft feature, named with the first configured `indexBasename`. Generated
   pages are committed. A `--check` drift gate keeps them honest.
4. **Single ownership.** Generated pages carry
   `generated: { by: "doc-kitty/gherkin", at: "sha256:<source hash>" }`. The
   generator deletes only owned stale files, and fails if an authored file sits
   in the generated section.
5. **Metadata via namespaced feature tags.** `@dk:context`, `@dk:status`
   (plus the `@wip`/`@deprecated` shorthands), `@dk:persona`, `@dk:mission`,
   `@dk:adr`, `@dk:related`, `@dk:updated`, `@dk:autolink` and `@dk:priority` map
   onto the existing frontmatter. Other feature tags become `tags`. `type` is
   registry-derived, not emitted.
6. **Steps render as prose list items**, not code. That makes them eligible for
   glossary auto-linking (ADR-0027 skips code, headings and links). Literal text
   is escaped against Markdown, raw HTML, remark-directive and Markua attribute
   syntax. Descriptions pass through as Markdown.
7. **Vocabulary.** `Specification` is appended to the canonical `KINDS` and
   `DOC_TYPES` (ADR-0035 single source). The existing `Feature` kind keeps its
   meaning (a roadmap proposal).
8. **Shared pure core in `.mjs`.** The tag contract, renderer and planner are
   JSDoc-typed `.mjs`, imported by both the TS integration and the bare-Node
   `generate-feature-pages.mjs --check`, so build and gate agree by construction.

## Consequences

### Positive

- Sidebar, sitemap, RSS, `llms.txt`, agent API, related and audience blocks,
  draft gating and glossary linking all work with **no new render code** and no
  plugin-order change.
- Ambiguous domain language in specs surfaces as the existing glossary collision
  warning.
- Agents get behavioural contracts through the same discovery surface as the
  docs, with `sources` pointing at the executable file.
- It sets up the QA-portal results overlay (phase 2) without committing to it.

### Negative

- A second generated tree in git (the same trade-off ADR-0026 accepted).
- One new runtime dependency pair (`@cucumber/gherkin`, `@cucumber/messages`).
- The frontmatter gate's generated-page exemption moves from a path rule to a
  marker rule (`generated.by`), keeping the glossary path rule for compatibility.

### Risks

- Imperative, UI-level scenarios read poorly as docs. Mitigated by authoring
  guidance; a lint is a follow-up.
- Committed pages freeze when the preset is turned off. Removal is a manual
  folder delete.
- `generated.at` holding a hash instead of a time stretches the field's meaning.
  This is accepted deliberately: it keeps output deterministic and needs no schema
  change. The value is always `sha256:`-prefixed, so it can't be mistaken for a
  date.

## Alternatives considered

### Option A: `injectRoute` per feature

Rejected for the reasons ADR-0026 gives: invisible to the collection and every
generator.

### Option B: a composite content loader that adds entries to the `docs` store

Rejected. The entries exist only inside the Astro build, so the bare-Node gates
(`validate-frontmatter`, `check-links`, `validate-catalog`, redirect coverage)
never see them. It also depends on the glob loader's internal store bookkeeping.

### Option C: register `.feature` as a content entry type

Rejected. It relies on an undocumented integration API under a capped Starlight
peer range, and has the same gate blindness as Option B.

### Option D: embed `@cucumber/html-formatter` output

Rejected as the page source: a standalone React report outside theme, nav,
glossary and agent API. It could fit phase 2 as an embedded results view.

## References

- [ADR-0026](./0026-glossary-source-and-generation-seam.md): codegen into the collection.
- [ADR-0027](./0027-auto-link-resolution-scoping-and-term-directive.md): auto-link eligibility and sections.
- [ADR-0028](./0028-glossary-frontmatter-fields.md): `glossary_context`, `glossary_autolink`.
- [ADR-0033](./0033-flexible-section-identity.md): registry-derived types and subtypes.
- [ADR-0035](./0035-vocabulary-core-consolidation.md): the single-source vocabulary core.
- [QA portal research](../architecture/research/qa-portal.md).
- [Gherkin reference](https://cucumber.io/docs/gherkin/reference/).
