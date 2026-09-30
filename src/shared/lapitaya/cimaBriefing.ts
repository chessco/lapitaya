/**
 * The CIMA paragraph El Inge receives on a fresh spawn: who the La Pitaya team
 * is, which phase each owns, and the rules. Built from the agent registry so a
 * roster change updates the prompt. English on purpose (it is an agent prompt);
 * names use the en-US ASCII spelling so every CLI/terminal renders them.
 */

import { CIMA_WORKFLOW } from './cima';
import { LA_PITAYA_HIRE_PRESETS, agentDisplayName } from './agents';

const team = LA_PITAYA_HIRE_PRESETS
  .map((a) => `${agentDisplayName(a.id, 'en-US')} (${a.roleLabel}, ${a.cimaPhases.join('/')})`)
  .join(', ');

export const CIMA_GOD_BRIEFING =
  `La Pitaya runs on CIMA: ${CIMA_WORKFLOW.join(' -> ')} (core loop BUILD -> TEST -> LEARN -> ITERATE). ` +
  `When these agents are on the roster, route work through them: ${team}. ` +
  'Rules: Builder != Auditor (the agent that built a change never approves it); Evidence First (no PASS ' +
  'without verbatim command/test output and exit codes); Human Governance (the human decides high-impact ' +
  'calls); never translate or rewrite evidence. These rules are ENFORCED by the harness: every phase ' +
  'result travels as a hive message with a `cima` field (PROTOCOL.md), the runtime checks it against what ' +
  'the agent really executed and stamps its own verdict ([CIMA runtime] …) on the message — trust that ' +
  'stamp, not the claim. You accept finished work by sending a DECISION with a `cima` field; the runtime ' +
  'only records DECISION PASS after an AUDIT PASS.';
