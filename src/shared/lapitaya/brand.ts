/**
 * La Pitaya brand — the ONE place the product's visible identity lives.
 *
 * Every user-facing "La Pitaya" (window title, logo alt, release toast, agent
 * prompts that name the app) reads from here, so a rename is a one-line change.
 *
 * What deliberately does NOT come from here: identifiers that are persisted on
 * disk or baked into links other installs already hold — the package name, the
 * electron `appId`, the `munderdifflin://` deep-link scheme, the
 * `munder-difflin/hire@1` manifest spec, `cth.*` storage keys. Renaming those
 * would orphan existing data and break shared hires; see
 * docs/LA_PITAYA_IDENTITY.md for the migration plan.
 *
 * The brand name is a proper noun: it is never translated, in any locale.
 */

export const LA_PITAYA_NAME = 'La Pitaya';
export const LA_PITAYA_TAGLINE = 'Sonoran Multi-Agent AI Harness';
export const LA_PITAYA_ORGANIZATION = 'PitayaCode';
export const LA_PITAYA_ORIGIN = 'Sonora, Mexico';
/** Version of the La Pitaya layer (identity, agents, CIMA). The app/runtime
 *  version stays the one in package.json, which the updater compares against. */
export const LA_PITAYA_VERSION = '0.1.0-foundation';
export const LA_PITAYA_REPOSITORY = 'chessco/lapitaya';
export const LA_PITAYA_REPOSITORY_URL = `https://github.com/${LA_PITAYA_REPOSITORY}`;

/** The upstream this fork is built on — kept for attribution (MIT notice). */
export const LA_PITAYA_UPSTREAM = {
  name: 'Munder Difflin',
  repository: 'chaitanyagiri/munder-difflin',
  author: 'Chaitanya Giri',
  license: 'MIT'
} as const;

/** "La Pitaya — Sonoran Multi-Agent AI Harness" */
export const LA_PITAYA_FULL_TITLE = `${LA_PITAYA_NAME} — ${LA_PITAYA_TAGLINE}`;
