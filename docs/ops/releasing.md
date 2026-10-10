---
title: Releasing the toolkit to npm
description: How a maintainer publishes @spec-kitty/doc-toolkit to npm by pushing a version tag, and the one-time registry setup it needs.
doc_status: active
updated: 2026-10-10
type: Operations
kind: How-To
authors:
  - stijn@sddevelopment.be
tags: [release, npm, ops, github-actions]
related:
  - ops/ci-cd
  - guides/consumer-setup
---

# Releasing the toolkit to npm

For a maintainer. The toolkit package in `src/` (`@spec-kitty/doc-toolkit`) is
published to npm by the release workflow, `.github/workflows/release.yml`, when
you push a `v<version>` tag. This page covers the one-time setup and the steps
for each release.

## How the workflow is built

The workflow has two jobs:

- **`verify`** holds only read access. It checks that the tag equals
  `src/package.json` `version`, that the tagged commit is on `main`, and that the
  CHANGELOG has a `## [<version>]` section. It then runs typecheck, lint, unit
  tests, and the clean-room consumption test, and packs the tarball it verified.
- **`publish`** is the only job with `id-token: write` and the `NPM_TOKEN`
  secret. It installs no dependencies, so no package lifecycle script ever sees
  the token or the OIDC credential. It publishes the exact tarball `verify` built.

A version with a prerelease suffix (`0.2.0-rc.1`, `0.2.0-alpha.0`) publishes
under the `next` dist-tag, so `latest` never moves to a prerelease. A manual run
from the Actions tab is a rehearsal on any ref: it runs `verify` and
`npm publish --dry-run`, and never publishes, even when started on a tag.

## One-time setup

1. **npm scope access.** The publishing npm account must be a member of the
   `@spec-kitty` npm organization with publish rights. The first publish
   creates the package; `publishConfig.access: public` makes it public.
2. **Create the token.** On npmjs.com, create a *granular access token* with:
   - **Packages and scopes:** read and write, limited to the `@spec-kitty` scope
     (or to `@spec-kitty/doc-toolkit` once the package exists). No other
     packages and no organization-admin permissions.
   - **Expiration:** the shortest period you are willing to rotate, for example
     90 days. Put the renewal on the calendar; an expired token fails the
     publish step and nothing else.
   - **IP allowlist:** none. GitHub-hosted runner addresses change.
   - **Two-factor authentication:** CI cannot answer a one-time-password
     prompt. If the account or the package requires 2FA for publishing, turn on
     the token's *bypass two-factor authentication* option. Otherwise the
     publish step fails with an OTP error.
3. **Store it.** Add the token as the repository secret `NPM_TOKEN` (Settings →
   Secrets and variables → Actions). Fork PRs never trigger the release
   workflow, so fork code never reads it.

The `publish` job requests `id-token: write`, so npm attaches a signed
provenance attestation to each published version. Provenance requires the
`repository` field in `src/package.json` to point at this repository. Change
that field only if the repository moves.

npm *trusted publishing* (OIDC, no long-lived token) can replace `NPM_TOKEN`
later. It needs npm 11.5 or newer in the `publish` job and a trusted-publisher
entry for this repository and workflow on npmjs.com.

## Cutting a release

1. **Bump the version.** Set `version` in `src/package.json`. Under `0.x`, use
   the minor number for breaking changes and the patch number for everything else.
2. **Resync the consumption fixture** when the version or the toolkit's
   `dependencies` changed:
   `DK_CONSUMPTION_BOOTSTRAP=1 node tests/consumption/scripts/run-consumption-test.mjs`.
   Commit the resulting `tests/consumption/consumer-fixture/pnpm-lock.yaml`.
   The toolkit's own `integrity` line in that file does not need to match your
   machine: packed tarballs differ in bytes between machines, so the test
   points that one entry at the tarball it just packed before each install.
3. **Update the CHANGELOG.** Move the `[Unreleased]` entries under a
   `## [<version>] — <date>` heading and add the compare link at the bottom. The
   workflow fails if the heading is missing.
4. **Merge through a PR** with `ci-ok` and the consumption test green.
5. **Rehearse (optional).** Run the *Release* workflow manually from the Actions
   tab.
6. **Tag and push** the merged commit on `main`:

   ```sh
   git tag -a v<version> -m "v<version>"
   git push origin v<version>
   ```

7. **Verify** with `npm view @spec-kitty/doc-toolkit@<version>`, then create the
   GitHub release for the tag with the CHANGELOG section as its notes.

## When a release fails

- **Tag/version mismatch, or the tag is off `main`.** Nothing was published.
  Delete the tag (`git push origin :v<version>`), fix it on `main` through a PR,
  and tag again.
- **A gate fails.** Nothing was published. Fix forward through a PR and tag the
  fixed commit. Delete and recreate the tag only when no publish happened.
- **A known local flake.** In a full `pnpm test` run on a loaded machine,
  `src/tests/glossary-build-warning.test.ts` sometimes misses its pinned
  collision warning, while the build itself succeeds. It passes on its own, so
  confirm with `cd src && ./node_modules/.bin/vitest run --project build`
  before treating it as a regression. CI on `main` has been green with it.
- **Published by mistake.** npm never lets you reuse a published version
  number. Run `npm deprecate` on the bad version and release the next patch
  instead.
