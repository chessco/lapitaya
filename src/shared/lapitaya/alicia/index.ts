/**
 * Alicia — La Pitaya's transversal AI companion layer (v0.4: architecture).
 *
 *   HUMAN ──▶ ALICIA ── context ──▶ explanation / notifications / presence
 *                  └── intent ──▶ EL INGE ──▶ CIMA ──▶ agents / governance
 *
 * Alicia is NOT a CIMA agent (no phase, no verdict, no DECISION authority), NOT
 * the orchestrator (El Inge is) and NOT a governance authority. She observes
 * the sources of truth, explains them in the human's language, and relays
 * requests to El Inge. See docs/LA_PITAYA_ALICIA_ARCHITECTURE_04.md.
 *
 *   registry.ts       the v0.1 seam: alicia().notify(event), registerAlicia()
 *   identity.ts       name, role, organization, origin, actor id
 *   events.ts         event model + adapters from existing sources (no new bus)
 *   status.ts         CimaStatus, derived from runtime records
 *   evidence.ts       verbatim evidence presentation
 *   messages.ts       localized text around verbatim technical ids
 *   notifications.ts  AliciaNotification
 *   presence.ts       AliciaPresence (model only)
 *   context.ts        AliciaContext (derived, minimal, scoped, auditable)
 *   intent.ts         the only way out: intents → a request to El Inge
 *   conversation.ts   conversation boundary (interfaces)
 *   provider.ts       model provider boundary (interface)
 *   companion.ts      companion state, preferences and the ports a host lends
 */
export * from './registry';
export * from './identity';
export * from './events';
export * from './status';
export * from './evidence';
export * from './messages';
export * from './notifications';
export * from './presence';
export * from './context';
export * from './intent';
export * from './conversation';
export * from './provider';
export * from './companion';
