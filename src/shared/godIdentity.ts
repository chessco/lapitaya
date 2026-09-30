import { EL_INGE_NAME } from './lapitaya/agents';

/** God's identity before anyone has customized it — the app's own default,
 *  not a magic string sprinkled at every spawn call site. In La Pitaya the
 *  orchestrator is El Inge (was "Michael" upstream); a user rename still wins. */
export const DEFAULT_GOD_NAME = EL_INGE_NAME;

/**
 * Resolve god's display name for a (re)spawn.
 *
 * `renameAgent()` (`store.ts`) persists a rename straight into `registry.json`
 * via `hive.ts`'s `renameAgent()` — but the god-spawn effect used to rebuild
 * god's agent object from scratch with `name: DEFAULT_GOD_NAME` hardcoded in
 * three places, so a custom name reverted to "Michael" on every app restart
 * even though the registry still had it right. Reading the persisted name
 * back here (instead of hardcoding the default) is what keeps a rename from
 * reverting. Falls back to the default only when nothing has been persisted
 * yet — a fresh hive, or a registry not yet written this run.
 *
 * La Pitaya migration: a hive created by the upstream app persisted ITS
 * default ("Michael") — not a choice the user made. That exact legacy default
 * is read as "never customized" and resolves to El Inge; the next spawn writes
 * the new name back. Every other persisted name is a real rename and still wins.
 */
export const LEGACY_DEFAULT_GOD_NAMES: readonly string[] = ['Michael'];

export function resolveGodName(persistedName: string | undefined | null): string {
  const trimmed = persistedName?.trim();
  if (!trimmed || LEGACY_DEFAULT_GOD_NAMES.includes(trimmed)) return DEFAULT_GOD_NAME;
  return trimmed;
}
