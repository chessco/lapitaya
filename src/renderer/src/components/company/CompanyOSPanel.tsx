import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelPanel } from '../PixelPanel';
import { PixelButton } from '../PixelButton';
import { Icon } from '../Icon';
import type {
  CompanyOSSnapshot,
  PriorityLevel,
  CompanyOperatingMode
} from '@shared/lapitaya/company/osTypes';
import type { SchedulingDecisionCandidate } from '../../../../main/companyScheduler';

export function CompanyOSPanel() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<CompanyOSSnapshot | null>(null);
  const [candidate, setCandidate] = useState<SchedulingDecisionCandidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      if (!window.cth?.companyOSSnapshot) return;
      const snap = await window.cth.companyOSSnapshot();
      if (snap) {
        setSnapshot(snap);
      }
    } catch (err) {
      console.error('[CompanyOSPanel] Failed to fetch snapshot:', err);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), 4000);
    const unsub = window.cth?.onLapitayaGovernance?.(() => void refresh());
    return () => {
      clearInterval(interval);
      unsub?.();
    };
  }, [refresh]);

  const togglePause = async () => {
    if (!snapshot || actionBusy) return;
    setActionBusy(true);
    setStatusMessage(null);
    try {
      if (snapshot.isPaused) {
        await window.cth.companyOSResume();
        setStatusMessage('Compañía reanudada con éxito');
      } else {
        await window.cth.companyOSPause('Pausa manual desde consola del operador');
        setStatusMessage('Compañía pausada. Operaciones activas congeladas de forma no destructiva.');
      }
      await refresh();
    } catch (err) {
      setStatusMessage(`Error: ${String(err)}`);
    } finally {
      setActionBusy(false);
    }
  };

  const updatePriority = async (projectId: string, level: PriorityLevel) => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await window.cth.companyOSSetPriority(projectId, level, 'Ajuste de prioridad desde panel de control');
      await refresh();
    } catch (err) {
      console.error('Failed to set priority:', err);
    } finally {
      setActionBusy(false);
    }
  };

  const evaluateCandidate = async () => {
    setLoading(true);
    try {
      if (window.cth?.companyOSEvaluateDispatch) {
        const res = await window.cth.companyOSEvaluateDispatch();
        setCandidate(res);
      }
    } catch (err) {
      console.error('Failed to evaluate candidate:', err);
    } finally {
      setLoading(false);
    }
  };

  if (!snapshot) {
    return (
      <PixelPanel style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontFamily: 'var(--cth-font-display)', fontSize: 13, color: 'var(--cth-ink-500)' }}>
          Cargando telemetría de Virtual Company OS...
        </div>
      </PixelPanel>
    );
  }

  const {
    company,
    portfolio,
    workQueue,
    teams,
    capacity,
    health,
    metrics,
    humanAttentionCenter,
    isPaused,
    operatingMode
  } = snapshot;

  const healthColor =
    health.status === 'HEALTHY'
      ? 'var(--cth-mint)'
      : health.status === 'DEGRADED'
      ? 'var(--cth-lemon)'
      : 'var(--cth-coral)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingBottom: 24 }}>
      {/* ─── BANNER SUPERIOR DE CONTROL ─────────────────────────────────── */}
      <PixelPanel
        style={{
          background: 'linear-gradient(135deg, var(--cth-cream-100) 0%, var(--cth-cream-200) 100%)',
          borderLeft: `4px solid ${isPaused ? 'var(--cth-coral)' : 'var(--cth-mint)'}`,
          padding: '14px 18px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontFamily: 'var(--cth-font-display)', fontSize: 13, fontWeight: 700, color: 'var(--cth-ink-900)' }}>
                {company.name.toUpperCase()} · VIRTUAL COMPANY OS v0.9
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--cth-font-mono)',
                  padding: '2px 6px',
                  background: 'var(--cth-ink-900)',
                  color: 'var(--cth-cream-50)',
                  borderRadius: 2
                }}
              >
                SONORA, MÉXICO
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--cth-font-mono)',
                  padding: '2px 6px',
                  background: isPaused ? 'var(--cth-coral)' : 'var(--cth-mint)',
                  color: '#fff',
                  fontWeight: 600,
                  borderRadius: 2
                }}
              >
                {isPaused ? 'COMPAÑÍA PAUSADA' : 'OPERACIÓN ACTIVA'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--cth-ink-600)', fontFamily: 'var(--cth-font-ui)' }}>
              Modo: <b>{operatingMode}</b> · Gobernanza CIMA: <b>v0.16.0</b> (Techo de Riesgo: <b>HIGH</b>)
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <PixelButton
              variant={isPaused ? 'primary' : 'destructive'}
              size="sm"
              disabled={actionBusy}
              onClick={togglePause}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Icon name={isPaused ? 'play' : 'pause'} />
                {isPaused ? 'REANUDAR COMPAÑÍA' : 'PAUSAR COMPAÑÍA'}
              </span>
            </PixelButton>
          </div>
        </div>

        {statusMessage && (
          <div
            style={{
              marginTop: 10,
              padding: '6px 10px',
              background: 'var(--cth-cream-50)',
              border: '1px dashed var(--cth-ink-300)',
              fontSize: 11,
              fontFamily: 'var(--cth-font-mono)',
              color: 'var(--cth-ink-800)'
            }}
          >
            {statusMessage}
          </div>
        )}
      </PixelPanel>

      {/* ─── TARJETAS KPI DE SALUD Y RENDIMIENTO ───────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
        {/* KPI 1: Salud */}
        <PixelPanel style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--cth-font-display)', color: 'var(--cth-ink-500)', marginBottom: 4 }}>
            SALUD DEL SISTEMA
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--cth-font-mono)', color: healthColor }}>
              {health.score}
            </span>
            <span style={{ fontSize: 11, fontWeight: 600, color: healthColor }}>
              {health.status}
            </span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--cth-ink-600)', marginTop: 4, fontFamily: 'var(--cth-font-mono)' }}>
            {health.reasonCodes[0] ?? 'NOMINAL'}
          </div>
        </PixelPanel>

        {/* KPI 2: Portafolio */}
        <PixelPanel style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--cth-font-display)', color: 'var(--cth-ink-500)', marginBottom: 4 }}>
            PORTAFOLIO DE PROYECTOS
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--cth-font-mono)', color: 'var(--cth-ink-900)' }}>
              {portfolio.summary.totalProjects}
            </span>
            <span style={{ fontSize: 11, color: 'var(--cth-ink-600)' }}>
              {portfolio.summary.activeCount} activos · {portfolio.summary.completedCount} listos
            </span>
          </div>
          <div style={{ fontSize: 10, color: portfolio.summary.blockedCount > 0 ? 'var(--cth-coral)' : 'var(--cth-ink-500)', marginTop: 4 }}>
            {portfolio.summary.blockedCount} bloqueados por dependencias
          </div>
        </PixelPanel>

        {/* KPI 3: Cola de Trabajo */}
        <PixelPanel style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--cth-font-display)', color: 'var(--cth-ink-500)', marginBottom: 4 }}>
            COLA ORGANIZACIONAL
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--cth-font-mono)', color: 'var(--cth-sky)' }}>
              {workQueue.totalQueued}
            </span>
            <span style={{ fontSize: 11, color: 'var(--cth-ink-600)' }}>
              {workQueue.readyCount} READY · {workQueue.blockedCount} BLOCKED
            </span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--cth-ink-500)', marginTop: 4 }}>
            Tasa de aprobación: <b>{Math.round(metrics.overallPassRate * 100)}%</b>
          </div>
        </PixelPanel>

        {/* KPI 4: Atención Humana */}
        <PixelPanel style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 10, fontFamily: 'var(--cth-font-display)', color: 'var(--cth-ink-500)', marginBottom: 4 }}>
            ATENCIÓN HUMANA
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span
              style={{
                fontSize: 24,
                fontWeight: 700,
                fontFamily: 'var(--cth-font-mono)',
                color: humanAttentionCenter.hasBlockingIssues ? 'var(--cth-coral)' : 'var(--cth-mint)'
              }}
            >
              {humanAttentionCenter.items.length}
            </span>
            <span style={{ fontSize: 11, color: 'var(--cth-ink-600)' }}>
              {humanAttentionCenter.criticalCount} Críticos · {humanAttentionCenter.highCount} Altos
            </span>
          </div>
          <div style={{ fontSize: 10, color: humanAttentionCenter.hasBlockingIssues ? 'var(--cth-coral)' : 'var(--cth-mint)', marginTop: 4 }}>
            {humanAttentionCenter.hasBlockingIssues ? 'Requiere decisión del operador' : 'Sin bloqueos pendientes'}
          </div>
        </PixelPanel>
      </div>

      {/* ─── INVARIANTE CLAVE: SEPARACIÓN DE RESPONSABILIDADES ─────────── */}
      <div
        style={{
          padding: '8px 12px',
          background: 'var(--cth-cream-200)',
          boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: 11,
          fontFamily: 'var(--cth-font-mono)',
          color: 'var(--cth-ink-800)'
        }}
      >
        <span style={{ color: 'var(--cth-mint)', fontWeight: 700 }}>[AXIOMA DE GOBERNANZA]</span>
        <span>
          <b>BUILDER != AUDITOR:</b> José Juan está asignado estrictamente como Auditor independiente y nunca puede construir código.
        </span>
      </div>

      {/* ─── SECCIÓN: PORTAFOLIO Y COLA DE TRABAJO ─────────────────────── */}
      <PixelPanel title="PORTAFOLIO DE PROYECTOS & ASIGNACIÓN DE PRIORIDADES">
        {portfolio.projects.length === 0 ? (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--cth-ink-500)', fontSize: 11 }}>
            No hay proyectos registrados en el portafolio actual.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {portfolio.projects.map((proj) => {
              const deps = portfolio.dependencies.filter((d) => d.dependentProjectId === proj.projectId);
              return (
                <div
                  key={proj.projectId}
                  style={{
                    padding: '10px 14px',
                    background: 'var(--cth-cream-50)',
                    boxShadow: 'inset 0 0 0 1px var(--cth-ink-200)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 10
                  }}
                >
                  <div style={{ maxWidth: '65%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--cth-ink-900)' }}>
                        {proj.name}
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          fontFamily: 'var(--cth-font-mono)',
                          padding: '1px 5px',
                          background:
                            proj.status === 'ACTIVE'
                              ? 'var(--cth-mint)'
                              : proj.status === 'BLOCKED'
                              ? 'var(--cth-coral)'
                              : 'var(--cth-ink-300)',
                          color: '#fff',
                          borderRadius: 2
                        }}
                      >
                        {proj.status}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--cth-ink-500)', fontFamily: 'var(--cth-font-mono)' }}>
                        ({proj.projectId})
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--cth-ink-700)' }}>
                      {proj.objective}
                    </div>
                    {deps.length > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--cth-coral)', marginTop: 4 }}>
                        Dependencias requeridas: {deps.map((d) => d.prerequisiteProjectId).join(', ')}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, fontFamily: 'var(--cth-font-display)', color: 'var(--cth-ink-600)' }}>
                      PRIORIDAD:
                    </span>
                    <select
                      value={proj.priority}
                      disabled={actionBusy}
                      onChange={(e) => updatePriority(proj.projectId, e.target.value as PriorityLevel)}
                      style={{
                        padding: '4px 8px',
                        fontFamily: 'var(--cth-font-mono)',
                        fontSize: 11,
                        background: 'var(--cth-cream-100)',
                        color: 'var(--cth-ink-900)',
                        border: '1px solid var(--cth-ink-400)',
                        cursor: 'pointer'
                      }}
                    >
                      <option value="CRITICAL">CRITICAL</option>
                      <option value="HIGH">HIGH</option>
                      <option value="NORMAL">NORMAL</option>
                      <option value="LOW">LOW</option>
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Evaluación del Despachador */}
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px dashed var(--cth-ink-200)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontFamily: 'var(--cth-font-display)', color: 'var(--cth-ink-700)' }}>
              PLANIFICADOR ORGANIZACIONAL (SCHEDULER DETERMINISTA)
            </span>
            <PixelButton size="sm" variant="secondary" disabled={loading} onClick={evaluateCandidate}>
              {loading ? 'Evaluando...' : 'Evaluar Siguiente Despacho'}
            </PixelButton>
          </div>

          {candidate && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 12px',
                background: candidate.selectedCandidate ? 'var(--cth-cream-100)' : 'var(--cth-cream-200)',
                boxShadow: 'inset 0 0 0 1px var(--cth-ink-300)',
                fontSize: 11,
                fontFamily: 'var(--cth-font-mono)'
              }}
            >
              <div>
                <b>Estado de planificación:</b> {candidate.status} — {candidate.explanation}
              </div>
              {candidate.selectedCandidate && (
                <div style={{ marginTop: 4, color: 'var(--cth-mint)' }}>
                  ▶ Proyecto seleccionado: <b>{candidate.selectedCandidate.projectId}</b> · Misión: <b>{candidate.selectedCandidate.missionId}</b> (Prioridad: {candidate.selectedCandidate.priority})
                </div>
              )}
            </div>
          )}
        </div>
      </PixelPanel>

      {/* ─── SECCIÓN: EQUIPOS Y CAPACIDAD DE AGENTES ───────────────────── */}
      <PixelPanel title="4 EQUIPOS CANÓNICOS & ESTADO DE CAPACIDAD">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10, marginTop: 8 }}>
          {teams.map((team) => (
            <div
              key={team.teamId}
              style={{
                padding: '10px 12px',
                background: 'var(--cth-cream-50)',
                boxShadow: 'inset 0 0 0 1px var(--cth-ink-200)'
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--cth-ink-900)', marginBottom: 2 }}>
                {team.name}
              </div>
              <div style={{ fontSize: 10, color: 'var(--cth-ink-500)', marginBottom: 6 }}>
                Lead: <b>{team.leadAgentId}</b>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {team.members.map((memberId) => {
                  const cap = capacity.find((c) => c.agentId === memberId);
                  const isAvailable = cap ? (cap.state === 'AVAILABLE' || cap.state === 'IDLE') : true;
                  const isAuditor = memberId === 'jose-juan';
                  return (
                    <span
                      key={memberId}
                      style={{
                        padding: '2px 6px',
                        background: isAuditor
                          ? 'var(--cth-ink-800)'
                          : isAvailable
                          ? 'var(--cth-cream-200)'
                          : 'var(--cth-lemon)',
                        color: isAuditor ? '#fff' : 'var(--cth-ink-900)',
                        fontSize: 10,
                        fontFamily: 'var(--cth-font-mono)',
                        border: '1px solid var(--cth-ink-300)',
                        borderRadius: 2
                      }}
                    >
                      {memberId} {isAuditor && '🛡️ AUDITOR'} {!isAvailable && `· ${cap?.state}`}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </PixelPanel>

      {/* ─── SECCIÓN: CENTRO DE ATENCIÓN HUMANA ────────────────────────── */}
      {humanAttentionCenter.items.length > 0 && (
        <PixelPanel title="CENTRO DE ATENCIÓN HUMANA (ACCIONES BLOQUEADAS)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {humanAttentionCenter.items.map((item) => (
              <div
                key={item.id}
                style={{
                  padding: '8px 12px',
                  background: 'var(--cth-cream-50)',
                  borderLeft: `4px solid ${
                    item.severity === 'CRITICAL'
                      ? 'var(--cth-coral)'
                      : item.severity === 'HIGH'
                      ? 'var(--cth-lemon)'
                      : 'var(--cth-sky)'
                  }`,
                  boxShadow: 'inset 0 0 0 1px var(--cth-ink-200)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: 10, fontFamily: 'var(--cth-font-mono)' }}>
                      [{item.severity}] {item.reason}
                    </span>
                    {item.projectId && (
                      <span style={{ fontSize: 10, color: 'var(--cth-ink-600)' }}>
                        Proyecto: {item.projectId}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--cth-ink-800)', marginTop: 2 }}>
                    {item.summary}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </PixelPanel>
      )}
    </div>
  );
}
