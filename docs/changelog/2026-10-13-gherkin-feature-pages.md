---
title: Gherkin feature pages
description: "An opt-in gherkin preset turns .feature files into glossary-linked Specification pages, with owned-output pruning and a --check drift gate."
doc_status: active
updated: 2026-10-13
type: Changelog
kind: Changelog
authors:
  - ivan@spec-kitty.ai
tags: [gherkin, bdd, living-documentation, glossary, codegen, ci]
related:
  - adr/0046-gherkin-feature-pages
  - architecture/gherkin-pages
  - plans/features/gherkin-feature-pages
  - guides/authoring
  - guides/consumer-setup
---

# 2026-10-13 — Gherkin feature pages

A site can now publish its Gherkin `.feature` files as documentation. Setting
`gherkin: { sources: ['features'] }` in `defineDocKittyIntegrations` parses each
feature once with `@cucumber/gherkin` and generates one `kind: Specification`
page per feature, plus a hub per directory, into `docs/behaviour/`. The pages ride
the existing pipeline, so they reach the sidebar, sitemap, RSS, `llms.txt`, the
agent API and glossary auto-linking with no new plugins. With the option unset,
the build is byte-identical to before. See
[ADR-0046](../adr/0046-gherkin-feature-pages.md) and the
[architecture page](../architecture/gherkin-pages.md).

## What ships

- **Tags become metadata.** Feature-level `@dk:<key>=<value>` tags set the glossary
  context, status, personas, mission and ADR links, `updated`, the auto-link
  opt-out and the agent priority. `@wip` and `@deprecated` set the status, and
  other tags pass through as page tags. A misspelt `@dk:` key warns with a
  suggestion.
- **Escaped, lint-clean bodies.** Steps render as list items so glossary terms in
  step text get linked. Step text, names and table cells are escaped against
  Markdown, HTML, directives and Markua attributes; descriptions pass through as
  Markdown. The output passes the repo's markdownlint config.
- **A new `Specification` kind and type** in the canonical vocabulary.
- **Safe ownership.** Every generated page carries
  `generated.by: "doc-kitty/gherkin"`, and `generated.at` holds a source content
  hash, not a timestamp. Pages whose source is gone are pruned; an authored file
  in the section fails the build before anything is written. Output is
  deterministic and only changed files are rewritten, so dev-server restarts
  don't loop.
- **Gate parity and a drift gate.** `validate-frontmatter.mjs` recognises generated
  pages by their `generated.by` stamp. The new `generate-feature-pages.mjs` script,
  shipped as the `dockitty-generate-feature-pages` binary, regenerates the pages or,
  with `--check`, fails on any added, changed, stale or authored path. CI runs it
  as `pnpm validate:features`.

## Limits

A new `.feature` file needs a dev-server restart. Narrative detection
(`As a / I want / So that`) is English-only. Scenario Outlines render once with
their examples table, not expanded per row. Removing the option freezes the
committed pages rather than deleting them. Pass/fail results per scenario are
phase 2, under the QA portal.
