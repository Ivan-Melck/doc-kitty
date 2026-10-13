/**
 * `slug(name)` — the **single** deterministic anchor function for the glossary
 * (D6, NFR-004). It is the shared contract used by the page generator (WP03), the
 * resolver (WP02), and the `:term` directive (WP05): every one of them turns a term
 * `name` into the same `#<anchor>` click target. Do **not** duplicate this rule
 * anywhere — a second slug function is a review finding (drift risk).
 *
 * The implementation lives in `../vocabulary-core.mjs` (hoisted for ADR-0046 so the
 * bare-Node Gherkin drift gate can share it); this module re-exports it unchanged
 * so every existing glossary import keeps working.
 */
export { slug } from '../vocabulary-core.mjs';
