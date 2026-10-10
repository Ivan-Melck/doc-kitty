/**
 * Every bare module the PUBLISHED package imports at runtime must be declared in
 * `dependencies` or `peerDependencies`.
 *
 * A devDependency (or a package that is only present because the workspace root
 * or a hoisted transitive pulls it in) resolves in this repo but not for an
 * adopter whose pnpm install is non-hoisted (`hoist: false`): there the import
 * fails with MODULE_NOT_FOUND. This walks the package.json `files` set (what
 * `npm pack` ships) and checks each value import against the manifest.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_DIR = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8')) as {
  name: string;
  files: string[];
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const CODE = /\.(ts|mts|cts|mjs|cjs|js|tsx|astro)$/;
// Value imports only: `import x from`, `import 'x'`, `export … from`, dynamic
// `import('x')`, `require('x')`. Type-only imports/exports are erased at build.
const SPECIFIER =
  /(?:^|[^\w$.])(?:import(?!\s+type\b)\s[^'"`;]*?from\s*|import\s*\(\s*|import\s*|export(?!\s+type\b)\s[^'"`;]*?from\s*|require\s*\(\s*)['"]([^'"\n]+)['"]/g;

function walk(p: string, out: string[]): void {
  if (!existsSync(p)) return;
  if (statSync(p).isDirectory()) {
    for (const e of readdirSync(p)) walk(path.join(p, e), out);
  } else if (CODE.test(p)) {
    out.push(p);
  }
}

function packageName(spec: string): string | null {
  if (/^(\.|\/|node:|astro:|virtual:|data:|https?:)/.test(spec)) return null;
  const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  if (name === pkg.name || builtinModules.includes(name)) return null;
  return name;
}

describe('published package runtime dependencies', () => {
  it('declares every bare module imported by a shipped file', () => {
    const files: string[] = [];
    for (const entry of pkg.files) walk(path.join(PKG_DIR, entry), files);
    expect(files.length).toBeGreaterThan(0);

    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]);
    const undeclared = new Map<string, Set<string>>();
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(SPECIFIER)) {
        const name = packageName(m[1]);
        if (!name || declared.has(name)) continue;
        if (!undeclared.has(name)) undeclared.set(name, new Set());
        undeclared.get(name)!.add(path.relative(PKG_DIR, file));
      }
    }
    const report = [...undeclared].map(([n, fs]) => `${n} <- ${[...fs].join(', ')}`);
    expect(report, 'undeclared runtime imports (add them to dependencies)').toEqual([]);
  });
});
