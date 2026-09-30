/**
 * Evidence presentation — EVIDENCE FIRST, from Alicia's side.
 *
 * Alicia presents only what the runtime recorded on a CimaRecord: every item is
 * copied verbatim (type, source, result, verified flag, trace id), the counts
 * are counted from those items, and the headline lines are the only words she
 * adds. No item, count or claim is ever synthesized — a record with no
 * evidence is presented as "no evidence", never filled in.
 */

import type { CimaRecord, VerifiedEvidence } from '../cimaRuntime';
import { aliciaText, displayAgent, type AgentNameResolver } from './messages';

export interface PresentedEvidenceItem {
  readonly type: string;
  readonly source: string;
  readonly result?: string;
  readonly description?: string;
  readonly verified: boolean;
  /** The harness trace that backs this item (the audit link). */
  readonly traceId?: string;
}

export interface EvidencePresentation {
  readonly taskId: string;
  readonly phase: string;
  readonly verdict: string;
  readonly agentId: string;
  readonly total: number;
  readonly verified: number;
  readonly items: readonly PresentedEvidenceItem[];
  /** Localized headline lines, e.g. "✓ El Beni completó BUILD", "✓ 3/3 evidencias verificadas por el harness". */
  readonly lines: readonly string[];
}

function item(e: VerifiedEvidence): PresentedEvidenceItem {
  return Object.freeze({
    type: e.type,
    source: e.source,
    ...(e.result !== undefined ? { result: e.result } : {}),
    ...(e.description !== undefined ? { description: e.description } : {}),
    verified: e.verified,
    ...(e.traceId !== undefined ? { traceId: e.traceId } : {})
  });
}

export function presentEvidence(record: CimaRecord, locale: string | null | undefined, resolve?: AgentNameResolver): EvidencePresentation {
  const items = record.evidence.map(item);
  const verified = items.filter((i) => i.verified).length;
  const agent = displayAgent(record.agentId, locale, resolve);
  const ok = record.verdict === 'PASS';
  const lines = [
    `${ok ? '✓' : '✗'} ${ok
      ? aliciaText(locale, 'alicia.evidence.completed', { agent, phase: record.phase })
      : aliciaText(locale, 'alicia.evidence.recorded', { agent, phase: record.phase, verdict: record.verdict })}`,
    items.length
      ? `${verified === items.length ? '✓' : '✗'} ${aliciaText(locale, 'alicia.evidence.verified', { verified, total: items.length })}`
      : `✗ ${aliciaText(locale, 'alicia.evidence.none')}`
  ];
  return Object.freeze({
    taskId: record.taskId,
    phase: record.phase,
    verdict: record.verdict,
    agentId: record.agentId,
    total: items.length,
    verified,
    items: Object.freeze(items),
    lines: Object.freeze(lines)
  });
}
