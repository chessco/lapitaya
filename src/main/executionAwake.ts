/**
 * Execution Awake — FASE 3. Keeps the computer from AUTOMATIC suspension while La Pitaya's
 * agents are really working, and only if the user wants it (`keepAwakeDuringExecution`).
 *
 * This is infrastructure, not governance and not a companion behavior:
 *
 *  - The only inputs are authoritative lifecycle signals that already reach the main process:
 *      · CIMA runtime events (`cima-record`): a phase ASSIGNMENT opens an execution; that
 *        agent's verdict for the phase (PASS / FAIL / BLOCKED), a PASS of the phase by anyone,
 *        or a DECISION for the task closes it;
 *      · ephemeral worker lifetime: spawned → torn down (teardownPty covers done, reap, crash);
 *      · agent turns from the token-authenticated hook stream: UserPromptSubmit … Stop/SessionEnd.
 *    A companion's visual state is NOT an input, and nothing the renderer sends can add,
 *    remove or name an execution (there is no IPC for it).
 *  - It drives Electron's supported `powerSaveBlocker` with `prevent-app-suspension` (the
 *    display may still sleep and the session may still lock). It never moves the mouse, never
 *    sends keys, never simulates presence, and cannot override a manual Sleep, shutdown,
 *    restart or sign-out — those are the user's and the OS's.
 *  - It writes nothing to the CIMA ledger and influences no verdict, risk, approval or gate.
 *
 * Reference-safe: executions live in a Set keyed by id. The blocker starts on 0 → 1, stays
 * while any execution remains, and stops on the last one (or when the user turns it off).
 * Every start/end is idempotent.
 */

export type KeepAwakeMode = 'prevent-app-suspension' | 'prevent-display-sleep';

/** The subset of Electron's powerSaveBlocker this service uses (injectable for tests). */
export interface PowerBlockerLike {
  start(type: KeepAwakeMode): number;
  stop(id: number): boolean;
  isStarted(id: number): boolean;
}

export type ExecutionSource = 'cima' | 'worker' | 'turn';

export interface ExecutionEntry {
  id: string;
  source: ExecutionSource;
  agentId: string;
  taskId?: string;
  phase?: string;
  since: number;
}

export interface ExecutionAwakeState {
  enabled: boolean;
  /** The OS power blocker is currently held. */
  active: boolean;
  activeExecutionCount: number;
  mode: KeepAwakeMode | null;
  executions: readonly { id: string; source: ExecutionSource; agentId: string; taskId?: string; phase?: string; since: number }[];
}

export interface ExecutionAwakeDeps {
  blocker: PowerBlockerLike;
  enabled: boolean;
  /** Blocker type to hold while active (re-read on every sync; default prevent-app-suspension). */
  mode?: () => KeepAwakeMode;
  now?: () => number;
  /** Safety cap: an execution with no terminal signal for this long is dropped (default 6 h). */
  maxExecutionMs?: number;
  onChange?: (state: ExecutionAwakeState) => void;
  log?: (line: string) => void;
}

/** CIMA phases whose assignment means "an agent is working on it now". DECISION is El Inge's verdict, not work. */
const WORK_PHASES = new Set(['CONTEXT', 'ARCHITECT', 'BUILD', 'TEST', 'AUDIT', 'LEARN', 'ITERATE']);
const TERMINAL_VERDICTS = new Set(['PASS', 'FAIL', 'BLOCKED']);
const TURN_START = new Set(['UserPromptSubmit']);
const TURN_END = new Set(['Stop', 'SessionEnd']);

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export class ExecutionAwakeService {
  private readonly executions = new Map<string, ExecutionEntry>();
  /** task:phase:agent keys whose phase already PASSed — a later "release" re-assignment is not new work (O-1). */
  private readonly passed = new Set<string>();
  private enabled: boolean;
  private blockerId: number | null = null;
  private heldMode: KeepAwakeMode | null = null;
  private disposed = false;
  private readonly deps: ExecutionAwakeDeps;

  constructor(deps: ExecutionAwakeDeps) {
    this.deps = deps;
    this.enabled = deps.enabled !== false;
  }

  // ─── authoritative inputs (main process only) ──────────────────────────────

  /** A CimaRuntimeService.onEvent payload. Unknown or malformed payloads are ignored. */
  noteRuntimeEvent(e: { type?: unknown; data?: unknown } | null | undefined): void {
    if (!e || e.type !== 'cima-record') return;
    const d = obj(e.data);
    const taskId = str(d.taskId);
    const phase = str(d.phase);
    if (!taskId || !phase) return;
    if (d.kind === 'cima-assignment') {
      const agentId = str(d.to);
      if (!agentId || !WORK_PHASES.has(phase)) return;
      const key = `${taskId}:${phase}:${agentId}`;
      if (this.passed.has(key)) return; // a re-assignment after PASS is lifecycle noise, not new work
      this.add({ id: `cima:${key}`, source: 'cima', agentId, taskId, phase });
      return;
    }
    if (d.kind === 'cima') {
      const verdict = str(d.verdict);
      const agentId = str(d.agentId);
      if (!verdict || !TERMINAL_VERDICTS.has(verdict)) return;
      if (phase === 'DECISION') {
        // El Inge decided the task: no phase of it is still being worked.
        this.removeWhere((x) => x.source === 'cima' && x.taskId === taskId);
        return;
      }
      if (verdict === 'PASS') {
        for (const x of this.executions.values()) if (x.source === 'cima' && x.taskId === taskId && x.phase === phase) this.passed.add(`${taskId}:${phase}:${x.agentId}`);
        if (agentId) this.passed.add(`${taskId}:${phase}:${agentId}`);
        this.removeWhere((x) => x.source === 'cima' && x.taskId === taskId && x.phase === phase);
        return;
      }
      if (agentId) this.remove(`cima:${taskId}:${phase}:${agentId}`);
    }
  }

  /** A token-authenticated hook event (HookServer onEvent). The agent id is the hook's trusted id. */
  noteHook(agentId: string | undefined, event: string): void {
    if (!agentId) return;
    if (TURN_START.has(event)) this.add({ id: `turn:${agentId}`, source: 'turn', agentId });
    else if (TURN_END.has(event)) this.remove(`turn:${agentId}`);
  }

  /** processSpawnRequest started this ephemeral worker. */
  workerStarted(workerId: string): void {
    if (workerId) this.add({ id: `worker:${workerId}`, source: 'worker', agentId: workerId });
  }

  /** The agent's process is gone (teardownPty: done, reap, crash, manual stop): nothing of it still runs. */
  agentEnded(agentId: string): void {
    if (agentId) this.removeWhere((x) => x.agentId === agentId);
  }

  // ─── user control ──────────────────────────────────────────────────────────

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return; // idempotent
    this.enabled = enabled;
    this.sync();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ─── lifecycle ─────────────────────────────────────────────────────────────

  /** Drop executions older than the safety cap (no terminal signal ever came). */
  sweep(): void {
    const max = this.deps.maxExecutionMs ?? 6 * 60 * 60 * 1000;
    const now = this.now();
    this.removeWhere((x) => now - x.since > max);
  }

  /** Re-evaluate the blocker (also called on mode changes and on system resume). Idempotent. */
  sync(): void {
    if (this.disposed) return;
    const desired: KeepAwakeMode | null = this.enabled && this.executions.size > 0 ? (this.deps.mode?.() ?? 'prevent-app-suspension') : null;
    if (desired === this.heldMode && (desired === null || this.isHeld())) { this.changed(); return; }
    this.release();
    if (desired) {
      try {
        this.blockerId = this.deps.blocker.start(desired);
        this.heldMode = desired;
        this.deps.log?.(`[power] execution awake ON (${desired}) — ${this.executions.size} active execution(s)`);
      } catch (e) {
        this.blockerId = null;
        this.heldMode = null;
        this.deps.log?.(`[power] execution awake could not start: ${String(e)}`);
      }
    } else {
      this.deps.log?.(`[power] execution awake off — ${this.enabled ? 'no active executions' : 'disabled by the user'}`);
    }
    this.changed();
  }

  /** App/runtime shutdown: release the blocker and stop reacting. */
  dispose(): void {
    if (this.disposed) return;
    this.release();
    this.disposed = true;
    this.executions.clear();
    this.changed();
  }

  state(): ExecutionAwakeState {
    return {
      enabled: this.enabled,
      active: this.isHeld(),
      activeExecutionCount: this.executions.size,
      mode: this.isHeld() ? this.heldMode : null,
      executions: [...this.executions.values()].map((x) => ({ ...x }))
    };
  }

  // ─── internals ─────────────────────────────────────────────────────────────

  private add(e: Omit<ExecutionEntry, 'since'>): void {
    if (this.disposed || this.executions.has(e.id)) return; // duplicate start is idempotent
    this.executions.set(e.id, { ...e, since: this.now() });
    this.sync();
  }

  private remove(id: string): void {
    if (!this.executions.delete(id)) return; // duplicate end is idempotent
    this.sync();
  }

  private removeWhere(pred: (x: ExecutionEntry) => boolean): void {
    let any = false;
    for (const [id, x] of this.executions) if (pred(x)) { this.executions.delete(id); any = true; }
    if (any) this.sync();
  }

  private isHeld(): boolean {
    if (this.blockerId === null) return false;
    try { return this.deps.blocker.isStarted(this.blockerId); } catch { return false; }
  }

  private release(): void {
    if (this.blockerId !== null) {
      try { if (this.deps.blocker.isStarted(this.blockerId)) this.deps.blocker.stop(this.blockerId); } catch { /* blocker gone */ }
    }
    this.blockerId = null;
    this.heldMode = null;
  }

  private changed(): void {
    try { this.deps.onChange?.(this.state()); } catch { /* a diagnostic listener never breaks the service */ }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
