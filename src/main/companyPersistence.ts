import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  VirtualCompany,
  CompanyOperationsCenterState,
  PriorityDefinition,
  CrossProjectDependency,
  CompanyResource,
  OperationDetail
} from '../shared/lapitaya/company/osTypes';
import type { VirtualCompanyOSService } from './virtualCompanyOS';

export interface PersistedCompanyState {
  schemaVersion: 1;
  savedAt: number;
  company: VirtualCompany;
  operationsCenter: CompanyOperationsCenterState;
  priorities: readonly (PriorityDefinition & { projectId: string })[];
  dependencies: readonly CrossProjectDependency[];
  resources: readonly CompanyResource[];
}

export function serializeCompanyState(service: VirtualCompanyOSService): PersistedCompanyState {
  return {
    schemaVersion: 1,
    savedAt: Date.now(),
    company: service.getCompany(),
    operationsCenter: service.getOperationsCenter(),
    priorities: service.getPriorityManager().listPriorities(),
    dependencies: service.getDependencyEngine().listDependencies(),
    resources: service.getResourceManager().listResources()
  };
}

export function deserializeCompanyState(jsonString: string): {
  ok: boolean;
  state?: PersistedCompanyState;
  error?: string;
} {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: 'INVALID_JSON_OBJECT: State payload is not a valid JSON object' };
    }

    if (parsed.schemaVersion !== 1) {
      return {
        ok: false,
        error: `UNSUPPORTED_SCHEMA_VERSION: Expected schemaVersion 1, got ${parsed.schemaVersion}`
      };
    }

    if (!parsed.company || parsed.company.companyId !== 'lapitaya') {
      return {
        ok: false,
        error: 'INVALID_COMPANY_IDENTITY: Missing or invalid lapitaya company identifier'
      };
    }

    return { ok: true, state: parsed as PersistedCompanyState };
  } catch (err) {
    return {
      ok: false,
      error: `JSON_PARSE_ERROR: ${(err as Error).message}`
    };
  }
}

export function rehydrateCompanyState(
  service: VirtualCompanyOSService,
  persisted: PersistedCompanyState
): { ok: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Enforce Axiom: RESTART != REAUTHORIZATION
  // Any operations that were previously RUNNING in activeOperations must be rehydrated into PAUSED state
  const rehydratedActive: OperationDetail[] = [];
  const rehydratedPaused: OperationDetail[] = [...(persisted.operationsCenter?.pausedOperations ?? [])];

  for (const op of persisted.operationsCenter?.activeOperations ?? []) {
    if (op.status === 'RUNNING') {
      warnings.push(`RESTART_FREEZE: Active operation ${op.operationId} rehydrated to PAUSED status.`);
      rehydratedPaused.push({
        ...op,
        status: 'PAUSED'
      });
    } else {
      rehydratedActive.push(op);
    }
  }

  // Restore priorities
  const priorityMgr = service.getPriorityManager();
  for (const prio of persisted.priorities ?? []) {
    priorityMgr.setPriority(prio);
  }

  // Restore dependencies
  const depEngine = service.getDependencyEngine();
  depEngine.clear();
  for (const dep of persisted.dependencies ?? []) {
    depEngine.addDependency(dep);
  }

  // Restore resources
  const resMgr = service.getResourceManager();
  for (const res of persisted.resources ?? []) {
    resMgr.registerResource(res);
  }

  // Restore attention items
  const attn = service.getHumanAttentionManager();
  attn.clear();
  for (const item of persisted.company.humanAttention?.items ?? []) {
    attn.addAttentionItem(item);
  }

  // Re-apply core company state including portfolio, work queue, and config
  service.restoreCompanyState(persisted.company);

  // Apply frozen operations: nothing persisted as RUNNING may resume without reauthorization
  const persistedOps = persisted.operationsCenter;
  service.setOperationsCenter({
    activeOperations: rehydratedActive,
    pausedOperations: rehydratedPaused,
    recentCompletions: [...(persistedOps?.recentCompletions ?? [])],
    concurrency: {
      maxLimit: persistedOps?.concurrency?.maxLimit ?? 2,
      current: rehydratedActive.filter((op) => op.status === 'RUNNING').length
    }
  });
  service.setOperatingMode(persisted.company.operatingMode ?? 'AUTONOMOUS_WITHIN_ENVELOPES');
  if (persisted.company.isPaused) {
    service.pauseCompany('Persisted state was paused');
  }

  return { ok: true, warnings };
}

export function saveCompanyStateSync(
  service: VirtualCompanyOSService,
  storagePath: string
): { ok: boolean; path: string; error?: string } {
  try {
    const dir = path.dirname(storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const state = serializeCompanyState(service);
    const json = JSON.stringify(state, null, 2);
    const tmpPath = `${storagePath}.tmp.${Date.now()}`;

    fs.writeFileSync(tmpPath, json, 'utf8');
    fs.renameSync(tmpPath, storagePath);

    return { ok: true, path: storagePath };
  } catch (err) {
    return { ok: false, path: storagePath, error: (err as Error).message };
  }
}

export function loadCompanyStateSync(
  service: VirtualCompanyOSService,
  storagePath: string
): { ok: boolean; warnings?: string[]; error?: string } {
  try {
    if (!fs.existsSync(storagePath)) {
      return { ok: false, error: `FILE_NOT_FOUND: Storage file does not exist at ${storagePath}` };
    }

    const raw = fs.readFileSync(storagePath, 'utf8');
    const deserialized = deserializeCompanyState(raw);
    if (!deserialized.ok || !deserialized.state) {
      return { ok: false, error: deserialized.error ?? 'DESERIALIZATION_FAILED' };
    }

    const result = rehydrateCompanyState(service, deserialized.state);
    return { ok: true, warnings: result.warnings };
  } catch (err) {
    return { ok: false, error: `LOAD_FAILED: ${(err as Error).message}` };
  }
}
