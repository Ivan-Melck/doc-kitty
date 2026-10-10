/**
 * pin-toolkit-integrity.mjs — point the fixture lockfile's `toolkit.tgz` entry at
 * the tarball that was JUST packed, before a `--frozen-lockfile` install.
 *
 * Why: `npm pack` output is not byte-reproducible across machines. Node's bundled
 * zlib picks CPU-specific deflate paths, so the same sources gzip to different
 * bytes (and a different sha512) locally and on a GitHub runner. A committed
 * integrity for the LOCAL tarball therefore fails with ERR_PNPM_TARBALL_INTEGRITY
 * wherever it was not generated (PR #108, run 38047798038).
 *
 * The toolkit tarball is our own freshly built artifact, not registry content, so
 * locking its hash protects nothing. Every OTHER lockfile entry, including all
 * registry integrities, stays frozen. Only this one `file:toolkit.tgz` resolution
 * line is rewritten, and the caller restores the committed text afterwards.
 * Fails closed when the entry is not found exactly once.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ENTRY =
  /^( {2}'@spec-kitty\/doc-toolkit@file:toolkit\.tgz':\n {4}resolution: \{integrity: )(sha512-[A-Za-z0-9+/=]+)(, tarball: file:toolkit\.tgz\})$/gm;

/**
 * Rewrite `<fixtureDir>/pnpm-lock.yaml` so the toolkit entry carries the sha512
 * of `<fixtureDir>/toolkit.tgz`. Returns the original lockfile text so the
 * caller can restore it.
 * @param {string} fixtureDir
 * @returns {{ original: string, lockPath: string, integrity: string }}
 */
export function pinToolkitIntegrity(fixtureDir) {
  const lockPath = path.join(fixtureDir, 'pnpm-lock.yaml');
  const original = readFileSync(lockPath, 'utf8');
  const tarball = readFileSync(path.join(fixtureDir, 'toolkit.tgz'));
  const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
  const matches = original.match(ENTRY) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one '@spec-kitty/doc-toolkit@file:toolkit.tgz' resolution in ${lockPath}, found ${matches.length}`,
    );
  }
  writeFileSync(lockPath, original.replace(ENTRY, `$1${integrity}$3`));
  return { original, lockPath, integrity };
}
