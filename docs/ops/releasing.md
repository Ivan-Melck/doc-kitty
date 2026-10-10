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

## One-time setup

1. **npm scope access.** The publishing npm account must be a member of the
   `@spec-kitty` npm organization with publish rights. The first publish
   creates the package; `publishConfig.access: public` makes it public.
2. **`NPM_TOKEN` secret.** Create an npm *granular access token* with
   read-and-write access to the `@spec-kitty` scope, then add it as the
   repository secret `NPM_TOKEN` (Settings → Secrets and variables → Actions).
   Only the tag-triggered run reads it, and fork PRs never trigger the release
   workflow.

The workflow already holds `id-token: write`, so npm attaches a signed
provenance attestation to each published version. Provenance requires the
`repository` field in `src/package.json` to point at this repository. Change
that field only if the repository moves.

## Cutting a release

1. **Bump the version.** Set `version` in `src/package.json`. Under `0.x`, use
   the minor number for breaking changes and the patch number for everything else.
2. **Resync the consumption fixture.** A version bump changes the packed
   tarball, so regenerate the fixture lockfile:
   `DK_CONSUMPTION_BOOTSTRAP=1 node tests/consumption/scripts/run-consumption-test.mjs`.
   Commit the resulting `tests/consumption/consumer-fixture/pnpm-lock.yaml` change,
   which should touch only the toolkit's `integrity` and `version` lines.
3. **Update the CHANGELOG.** Move the `[Unreleased]` entries under a
   `## [<version>] — <date>` heading and add the compare link at the bottom. The
   workflow fails if the heading is missing.
4. **Merge through a PR** with `ci-ok` and the consumption test green.
5. **Rehearse (optional).** Run the *Release* workflow manually from the Actions
   tab. A manual run executes every gate plus `npm publish --dry-run` and never
   publishes.
6. **Tag and push** the merged commit on `main`:

   ```sh
   git tag -a v<version> -m "v<version>"
   git push origin v<version>
   ```

   The workflow checks that the tag equals `src/package.json` `version`, re-runs
   typecheck, lint, unit tests, and the clean-room consumption test with its
   self-test, then runs `npm publish --provenance --access public` from `src/`.
7. **Verify** with `npm view @spec-kitty/doc-toolkit@<version>`, then create the
   GitHub release for the tag with the CHANGELOG section as its notes.

## When a release fails

- **Tag/version mismatch.** Delete the tag (`git push origin :v<version>`), fix
  the version on `main` through a PR, and tag again.
- **A gate fails.** Nothing was published. Fix forward through a PR and tag the
  fixed commit. Delete and recreate the tag only when no publish happened.
- **Published by mistake.** npm never lets you reuse a published version
  number. Run `npm deprecate` on the bad version and release the next patch
  instead.
