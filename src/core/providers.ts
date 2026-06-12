/**
 * Provider registry — the single source of truth for which provider ids the
 * collector may emit and the backend will accept.
 *
 * The list lives in `providers.json` (a plain data file) so adding a new
 * provider is a one-line edit, not a code change to the schema. To add a
 * provider end to end:
 *   1. Append its id to `providers.json`.
 *   2. Add an adapter under `src/adapters/<id>/` implementing `Adapter`.
 *   3. Wire it in `src/core/perform-sync.ts` (and a watcher in `cli/start.ts`).
 *
 * The backend (`lambdas/sync/handler.py`) only requires `provider` to be
 * non-empty and stores it verbatim in the session sort key, so no backend
 * change is needed to accept a new id — this registry is the gate.
 */

import registry from "./providers.json" with { type: "json" };

/** Frozen list of known provider ids, loaded from `providers.json`. */
export const KNOWN_PROVIDERS: readonly string[] = Object.freeze([
  ...new Set(registry.providers),
]);

/**
 * A provider id is just a string at the type level — the concrete set is
 * data-driven via `providers.json`, so the compiler cannot enumerate it.
 * Use {@link isKnownProvider} for runtime validation.
 */
export type Provider = string;

/** True when `value` is a non-empty string registered in `providers.json`. */
export function isKnownProvider(value: unknown): value is Provider {
  return typeof value === "string" && KNOWN_PROVIDERS.includes(value);
}
