import type {
  HumanAttentionItem,
  HumanAttentionReason,
  HumanAttentionCenterState
} from '../shared/lapitaya/company/osTypes';

export interface CreateAttentionItemParams {
  reason: HumanAttentionReason;
  severity: 'CRITICAL' | 'HIGH' | 'NORMAL';
  projectId: string | null;
  missionId: string | null;
  operationId: string | null;
  summary: string;
  context?: Record<string, unknown>;
}

export class HumanAttentionManager {
  private readonly items = new Map<string, HumanAttentionItem>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private generateId(params: CreateAttentionItemParams): string {
    const proj = params.projectId ?? 'global';
    const miss = params.missionId ?? 'all';
    const op = params.operationId ?? 'none';
    return `attn-${params.reason}-${proj}-${miss}-${op}`;
  }

  public addItem(params: CreateAttentionItemParams): HumanAttentionItem {
    const id = this.generateId(params);
    const existing = this.items.get(id);
    if (existing) {
      // Deduplicate: update summary/context if needed, but preserve original creation time
      const updated: HumanAttentionItem = {
        ...existing,
        severity: params.severity,
        summary: params.summary,
        context: params.context ?? existing.context
      };
      this.items.set(id, updated);
      return updated;
    }

    const item: HumanAttentionItem = {
      id,
      reason: params.reason,
      severity: params.severity,
      projectId: params.projectId,
      missionId: params.missionId,
      operationId: params.operationId,
      summary: params.summary,
      context: params.context ?? {},
      createdAt: this.now(),
      verified: true
    };
    this.items.set(id, item);
    return item;
  }

  public addAttentionItem(item: HumanAttentionItem): void {
    this.items.set(item.id, { ...item });
  }

  public clear(): void {
    this.items.clear();
  }

  public removeItem(id: string): boolean {
    return this.items.delete(id);
  }

  public resolveItemsForMission(missionId: string, reason?: HumanAttentionReason): void {
    for (const [id, item] of this.items.entries()) {
      if (item.missionId === missionId) {
        if (!reason || item.reason === reason) {
          this.items.delete(id);
        }
      }
    }
  }

  public resolveItemsForProject(projectId: string, reason?: HumanAttentionReason): void {
    for (const [id, item] of this.items.entries()) {
      if (item.projectId === projectId) {
        if (!reason || item.reason === reason) {
          this.items.delete(id);
        }
      }
    }
  }

  public getItems(): readonly HumanAttentionItem[] {
    const list = Array.from(this.items.values());
    const severityWeight: Record<'CRITICAL' | 'HIGH' | 'NORMAL', number> = {
      CRITICAL: 1,
      HIGH: 2,
      NORMAL: 3
    };
    list.sort((a, b) => {
      const wa = severityWeight[a.severity] ?? 99;
      const wb = severityWeight[b.severity] ?? 99;
      if (wa !== wb) return wa - wb;
      return a.createdAt - b.createdAt;
    });
    return list;
  }

  public getState(): HumanAttentionCenterState {
    const items = this.getItems();
    const criticalCount = items.filter((i) => i.severity === 'CRITICAL').length;
    const highCount = items.filter((i) => i.severity === 'HIGH').length;
    const normalCount = items.filter((i) => i.severity === 'NORMAL').length;

    return {
      items,
      criticalCount,
      highCount,
      normalCount,
      hasBlockingIssues: criticalCount > 0 || highCount > 0
    };
  }
}
