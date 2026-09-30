/**
 * Alicia's identity — data only. No personality engine, no lifecycle, no
 * avatar: those belong to later phases (docs/LA_PITAYA_ALICIA_ARCHITECTURE_04.md §16).
 *
 * `actorId` is the id Alicia uses wherever she is an actor (hive sender,
 * governance ledger). It carries NO privilege: governance, the autonomy policy
 * and the CIMA rules never special-case it (asserted by ALICIA-05/06).
 */

import { LA_PITAYA_ORGANIZATION, LA_PITAYA_ORIGIN } from '../brand';
import { LA_PITAYA_AGENT_BY_ID } from '../agents';

export const ALICIA_ACTOR_ID = 'alicia';
export const ALICIA_VERSION = '0.4.0-architecture';

export interface AliciaIdentity {
  readonly actorId: typeof ALICIA_ACTOR_ID;
  readonly name: string;
  /** Stable English label; the UI localizes via `lapitaya:roles.companion`. */
  readonly role: string;
  readonly organization: string;
  readonly origin: string;
  readonly version: string;
}

const registryEntry = LA_PITAYA_AGENT_BY_ID.alicia;

export const ALICIA_IDENTITY: AliciaIdentity = Object.freeze({
  actorId: ALICIA_ACTOR_ID,
  name: registryEntry.name,
  role: registryEntry.roleLabel,
  organization: LA_PITAYA_ORGANIZATION,
  origin: LA_PITAYA_ORIGIN,
  version: ALICIA_VERSION
});
