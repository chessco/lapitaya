/**
 * Desktop Companion creature — pure presentational component (no hooks), FASE 2 remediation.
 *
 * Interaction layout (fixes the gate's click-vs-drag defect):
 *  - the AVATAR owns the click handler; nothing in the window is `-webkit-app-region: drag`, so DOM
 *    clicks always reach it;
 *  - a small DRAG HANDLE below the creature (never overlapping the avatar, never animated) moves the
 *    window with a pointer-captured drag reported to the main process. A native drag region was not
 *    used: it receives no DOM pointer events, which breaks the hover tracking that keeps the
 *    transparent rest of the window click-through.
 *
 * Bubbles say what they are: a `runtime-fact` bubble shows its verified source; a `conversation`
 * bubble is friendly talk and never claims runtime state.
 */

import React from 'react';
import type {
  CompanionAnimationState,
  CompanionPresentationEntry,
  CompanionSpeechBubbleData,
  CompanionVisualState
} from '@shared/lapitaya/desktopCompanions/types';
import type { CompanySnapshot } from '@shared/lapitaya/company/types';

export const SPECIES_EMOJI_MAP: Record<string, string> = {
  fox: '🦊',
  beaver: '🦫',
  cat: '🐱',
  dog: '🐶',
  owl: '🦉',
  hamster: '🐹',
  turtle: '🐢',
  rabbit: '🐰'
};

/** Data attribute naming each interactive part (tests and the real-app validation use it). */
export const ROLE_ATTR = 'data-companion-role';

export interface CompanionCreatureProps {
  entry: CompanionPresentationEntry;
  /** Localized companion name (agentDisplayName). */
  displayName: string;
  /** Localized job title for agents that have one (Rosalba → "Desarrolladora Senior"); else the species is shown. */
  title?: string | null;
  /** FASE 3: the ambient beat while the runtime state is IDLE (presentation only). */
  ambient?: 'IDLE' | 'WALKING' | 'THINKING' | 'RESTING';
  /** FASE 3: personality cue shown while WORKING (⌨️ 🧪 🔍 …). */
  workCue?: string | null;
  /** FASE 3: calm Execution Awake indicator text (Alicia only, while the blocker is held). */
  awakeLabel?: string | null;
  /** FASE 3: celebration strength 0–1 (personality). */
  celebrationIntensity?: number;
  /** FASE 4: read-only company projection shown by Alicia. */
  company?: CompanySnapshot;
  /** FASE 3: switch the companions to FOCUS mode (presentation action). */
  onFocusMode?: (e: React.MouseEvent) => void;
  /** Localized name of the companion Alicia is relaying, if any. */
  relayedName?: string | null;
  relayedSpecies?: string | null;
  bubble: CompanionSpeechBubbleData | null;
  showMenu: boolean;
  showGallery: boolean;
  isSleeping: boolean;
  walkOffset: number;
  galleryEntries: readonly CompanionPresentationEntry[];
  onAvatarClick: (e: React.MouseEvent) => void;
  onSpeak: (e: React.MouseEvent) => void;
  onOpenApp: (e: React.MouseEvent) => void;
  onToggleGallery: (e: React.MouseEvent) => void;
  onHide: (e: React.MouseEvent) => void;
  onDismissBubble: (e: React.MouseEvent) => void;
  /** Pointer entered (true) / left (false) an interactive part; the rest of the window is click-through. */
  onInteractiveChange?: (interactive: boolean) => void;
  onHandlePointerDown?: (e: React.PointerEvent) => void;
  onHandlePointerMove?: (e: React.PointerEvent) => void;
  onHandlePointerUp?: (e: React.PointerEvent) => void;
}

const KEYFRAMES = `
  @keyframes companionBob {
    0%, 100% { transform: translateY(0px) scale(1); }
    50% { transform: translateY(-8px) scale(1.03); }
  }
  @keyframes companionCelebrate {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    25% { transform: translateY(-16px) rotate(-6deg); }
    75% { transform: translateY(-16px) rotate(6deg); }
  }
  @keyframes companionPulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }
  @keyframes companionShake {
    0%, 100% { transform: translateX(0); }
    20%, 60% { transform: translateX(-4px); }
    40%, 80% { transform: translateX(4px); }
  }
  @keyframes companionSleep {
    0%, 100% { transform: translateY(0) scale(0.95); opacity: 0.85; }
    50% { transform: translateY(4px) scale(0.97); opacity: 1; }
  }
  @keyframes companionRest {
    0%, 100% { transform: translateY(2px) scale(0.97); }
    50% { transform: translateY(4px) scale(0.96); }
  }
  @keyframes thinkDots {
    0%, 100% { opacity: 0.35; transform: translateY(0); }
    50% { opacity: 1; transform: translateY(-3px); }
  }
  @keyframes floatZzz {
    0% { transform: translate(0, 0) scale(0.6); opacity: 0; }
    50% { opacity: 1; }
    100% { transform: translate(14px, -24px) scale(1.2); opacity: 0; }
  }
`;

export function animationCss(anim: CompanionAnimationState): React.CSSProperties {
  switch (anim) {
    case 'celebrate':
      return { animation: 'companionCelebrate 0.8s ease-in-out infinite' };
    case 'attention':
    case 'work':
      return { animation: 'companionPulse 1.2s ease-in-out infinite' };
    case 'concern':
      return { animation: 'companionShake 0.5s ease-in-out infinite' };
    case 'sleep':
      return { animation: 'companionSleep 2.5s ease-in-out infinite' };
    case 'offline':
      return { opacity: 0.55 };
    case 'idle':
    default:
      return { animation: 'companionBob 3s ease-in-out infinite' };
  }
}

export function themeColor(state: CompanionVisualState): string {
  switch (state) {
    case 'THINKING':
      return '#3F51B5';
    case 'CELEBRATING':
      return '#4CAF50';
    case 'CONCERNED':
      return '#FF9800';
    case 'NOTIFYING':
    case 'ATTENTION':
      return '#E91E63';
    case 'PAUSED':
    case 'OFFLINE':
      return '#9E9E9E';
    case 'WORKING':
      return '#9C27B0';
    case 'IDLE':
    default:
      return '#E65100';
  }
}

const capitalize = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

const menuButton = (accent: string): React.CSSProperties => ({
  background: accent,
  border: '1px solid rgba(255,248,231,0.25)',
  borderRadius: '8px',
  color: '#FFF8E7',
  padding: '6px 6px',
  fontSize: '7px',
  lineHeight: '1.4',
  fontFamily: '"Press Start 2P", monospace',
  cursor: 'pointer',
  textAlign: 'left'
});

const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

export function CompanionCreature(props: CompanionCreatureProps): React.ReactElement {
  const { entry, bubble, showMenu, showGallery, isSleeping } = props;
  const color = themeColor(entry.visualState);
  const animation: CompanionAnimationState = isSleeping ? 'sleep' : entry.animationState ?? 'idle';
  const emoji = SPECIES_EMOJI_MAP[entry.species] ?? '🦊';
  const sticky = !!bubble && bubble.autoDismissMs === undefined;
  const hover = {
    onMouseEnter: () => props.onInteractiveChange?.(true),
    onMouseLeave: () => props.onInteractiveChange?.(false)
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        margin: 0,
        padding: 0,
        background: 'transparent',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        overflow: 'hidden'
      }}
    >
      <style>{KEYFRAMES}</style>

      {props.company && (
        <div
          {...{ [ROLE_ATTR]: 'company-awareness' }}
          {...hover}
          style={{
            position: 'absolute',
            top: '8px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: '250px',
            boxSizing: 'border-box',
            padding: '8px 10px',
            borderRadius: '12px',
            border: `1px solid ${color}88`,
            background: 'rgba(26, 19, 32, 0.9)',
            color: '#FFF8E7',
            fontFamily: '"Press Start 2P", monospace',
            fontSize: '7px',
            lineHeight: '1.5',
            zIndex: 90,
            ...noDrag
          }}
        >
          <div style={{ color: '#FFCC80', marginBottom: '4px' }}>LA PITAYA · {props.company.status}</div>
          <div>{props.company.project.displayName ?? props.company.session?.taskId ?? 'Sin proyecto verificado'}</div>
          {props.company.currentPhase && <div style={{ opacity: 0.8, marginTop: '3px' }}>Fase: {props.company.currentPhase}</div>}
          {props.company.expectedNext.length > 0 && <div style={{ color: '#B9F6CA', marginTop: '3px' }}>Siguiente esperado: {props.company.expectedNext[0].agentId} · no asignado</div>}
          {props.company.humanAttention && <div style={{ color: '#FFAB91', marginTop: '3px' }}>Requiere atención humana</div>}
        </div>
      )}

      {/* Speech bubble + menu */}
      {(bubble || showMenu) && (
        <div
          {...{ [ROLE_ATTR]: 'bubble' }}
          {...hover}
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '168px',
            transform: 'translateX(-50%)',
            background: 'rgba(26, 19, 32, 0.92)',
            border: `2px solid ${color}`,
            borderRadius: '16px',
            padding: '10px 12px',
            color: '#FFF8E7',
            fontSize: '9px',
            fontFamily: '"Press Start 2P", monospace',
            boxShadow: `0 8px 24px rgba(0, 0, 0, 0.5), 0 0 12px ${color}44`,
            width: '250px',
            boxSizing: 'border-box',
            zIndex: 100,
            ...noDrag
          }}
        >
          {bubble && (
            <div {...{ [ROLE_ATTR]: `bubble-${bubble.kind}` }} style={{ lineHeight: '1.5', marginBottom: showMenu || sticky ? '10px' : 0 }}>
              {bubble.kind === 'runtime-fact' && (
                <div style={{ fontSize: '7px', color: '#B9F6CA', marginBottom: '6px' }}>
                  ✓ hecho verificado{props.relayedName ? ` · ${props.relayedName}` : ''}
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                <span style={{ flex: 1 }}>{bubble.text}</span>
                {!sticky && (
                  <button
                    {...{ [ROLE_ATTR]: 'bubble-dismiss' }}
                    onClick={props.onDismissBubble}
                    style={{ background: 'none', border: 'none', color: '#FFF8E7', cursor: 'pointer', fontSize: '9px', padding: 0 }}
                    aria-label="Cerrar"
                  >
                    ✕
                  </button>
                )}
              </div>
              {sticky && !showMenu && (
                <button {...{ [ROLE_ATTR]: 'bubble-open-main' }} onClick={props.onOpenApp} style={{ ...menuButton(`${color}44`), marginTop: '8px' }}>
                  🚀 Abrir La Pitaya
                </button>
              )}
            </div>
          )}

          {showMenu && (
            <div
              {...{ [ROLE_ATTR]: 'menu' }}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '6px',
                borderTop: bubble ? '1px solid rgba(255,248,231,0.15)' : 'none',
                paddingTop: bubble ? '8px' : 0
              }}
            >
              <button {...{ [ROLE_ATTR]: 'menu-speak' }} onClick={props.onSpeak} style={menuButton('rgba(255,248,231,0.1)')}>
                💬 Hablar
              </button>
              <button {...{ [ROLE_ATTR]: 'menu-open' }} onClick={props.onOpenApp} style={menuButton(`${color}44`)}>
                🚀 Abrir La Pitaya
              </button>
              <button {...{ [ROLE_ATTR]: 'menu-gallery' }} onClick={props.onToggleGallery} style={menuButton('rgba(255,248,231,0.1)')}>
                ⚙️ {showGallery ? 'Cerrar Galería Dev' : 'Galería Dev'}
              </button>
              <button {...{ [ROLE_ATTR]: 'menu-hide' }} onClick={props.onHide} style={menuButton('rgba(233,30,99,0.2)')}>
                🙈 Ocultar
              </button>
              {props.onFocusMode && (
                <button {...{ [ROLE_ATTR]: 'menu-focus' }} onClick={props.onFocusMode} style={menuButton('rgba(255,248,231,0.1)')}>
                  🎯 Enfoque
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Creature: avatar (clickable) + identity label. Walks; never a drag region. */}
      <div
        {...{ [ROLE_ATTR]: 'creature' }}
        {...hover}
        style={{
          position: 'absolute',
          left: '50%',
          bottom: '40px',
          transform: `translateX(calc(-50% + ${props.walkOffset}px))`,
          transition: 'transform 0.2s linear',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          ...noDrag
        }}
      >
        {isSleeping && (
          <div style={{ position: 'absolute', top: '-20px', right: '-6px', fontSize: '14px', fontWeight: 'bold', color: '#9E9E9E', animation: 'floatZzz 2s infinite ease-out' }}>
            zZz
          </div>
        )}
        {!isSleeping && entry.visualState === 'IDLE' && props.ambient === 'THINKING' && (
          <div {...{ [ROLE_ATTR]: 'ambient-thinking' }} style={{ position: 'absolute', top: '-18px', right: '-4px', fontSize: '14px', animation: 'thinkDots 1.6s infinite ease-in-out' }}>
            💭
          </div>
        )}
        {entry.visualState === 'WORKING' && props.workCue && (
          <div {...{ [ROLE_ATTR]: 'work-cue' }} style={{ position: 'absolute', top: '-14px', left: '-8px', fontSize: '16px', animation: 'thinkDots 1.2s infinite ease-in-out' }}>
            {props.workCue}
          </div>
        )}
        {props.awakeLabel && (
          <div
            {...{ [ROLE_ATTR]: 'awake-indicator' }}
            title={props.awakeLabel}
            style={{ position: 'absolute', bottom: '-18px', left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap', fontSize: '6px', fontFamily: '"Press Start 2P", monospace', color: '#FFF8E7', background: 'rgba(26,19,32,0.7)', padding: '2px 5px', borderRadius: '6px', opacity: 0.85 }}
          >
            ☕ {props.awakeLabel}
          </div>
        )}

        {entry.relayedFrom && props.relayedName && (
          <div
            {...{ [ROLE_ATTR]: 'relay-chip' }}
            style={{ marginBottom: '6px', fontSize: '7px', fontFamily: '"Press Start 2P", monospace', color: '#FFF8E7', background: 'rgba(26,19,32,0.8)', padding: '3px 6px', borderRadius: '8px', border: `1px solid ${color}` }}
          >
            {SPECIES_EMOJI_MAP[props.relayedSpecies ?? ''] ?? '•'} {props.relayedName}
          </div>
        )}

        <div
          {...{ [ROLE_ATTR]: 'avatar' }}
          onClick={props.onAvatarClick}
          role="button"
          aria-label={props.displayName}
          title={`${props.displayName}${props.title ? ` · ${props.title}` : ''} · ${entry.visualState}`}
          style={{
            width: '88px',
            height: '88px',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${color} 0%, rgba(26,19,32,0.8) 100%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '48px',
            cursor: 'pointer',
            boxShadow: `0 8px 24px rgba(0, 0, 0, 0.4), 0 0 20px ${color}66`,
            border: `3px solid ${color}`,
            ...animationCss(animation),
            // Living Desktop: a calm resting pose while IDLE, and a celebration paced by personality.
            ...(!isSleeping && entry.visualState === 'IDLE' && props.ambient === 'RESTING' ? { animation: 'companionRest 3.5s ease-in-out infinite' } : {}),
            ...(animation === 'celebrate' && props.celebrationIntensity !== undefined
              ? { animation: `companionCelebrate ${(1.2 - 0.6 * Math.max(0, Math.min(1, props.celebrationIntensity))).toFixed(2)}s ease-in-out infinite` }
              : {}),
            ...noDrag
          }}
        >
          {emoji}
        </div>

        <div
          {...{ [ROLE_ATTR]: 'identity' }}
          style={{
            marginTop: '6px',
            textAlign: 'center',
            fontFamily: '"Press Start 2P", monospace',
            color: '#FFF8E7',
            background: 'rgba(26, 19, 32, 0.78)',
            padding: '4px 8px',
            borderRadius: '10px',
            border: `1px solid ${color}88`,
            boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
          }}
        >
          <div {...{ [ROLE_ATTR]: 'identity-name' }} style={{ fontSize: '9px' }}>{props.displayName}</div>
          <div {...{ [ROLE_ATTR]: 'identity-subtitle' }} style={{ fontSize: '6px', opacity: 0.7, marginTop: '2px' }}>{props.title || capitalize(entry.species)}</div>
        </div>
      </div>

      {/* Drag handle: pointer-captured drag (see header). Static: no animation, no transform. */}
      <div
        {...{ [ROLE_ATTR]: 'drag-handle' }}
        {...hover}
        title="Arrastrar"
        onPointerDown={props.onHandlePointerDown}
        onPointerMove={props.onHandlePointerMove}
        onPointerUp={props.onHandlePointerUp}
        onLostPointerCapture={props.onHandlePointerUp}
        style={{
          position: 'absolute',
          left: '50%',
          bottom: '6px',
          width: '72px',
          height: '22px',
          marginLeft: '-36px',
          borderRadius: '11px',
          background: 'rgba(26, 19, 32, 0.55)',
          border: '1px solid rgba(255,248,231,0.25)',
          color: 'rgba(255,248,231,0.75)',
          fontSize: '10px',
          lineHeight: '22px',
          textAlign: 'center',
          cursor: 'grab',
          touchAction: 'none',
          ...noDrag
        }}
      >
        ⠿⠿
      </div>

      {/* Dev gallery */}
      {showGallery && (
        <div
          {...{ [ROLE_ATTR]: 'gallery' }}
          {...hover}
          style={{
            position: 'absolute',
            top: '8px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(26, 19, 32, 0.95)',
            border: '2px solid #E65100',
            borderRadius: '16px',
            padding: '10px',
            width: '260px',
            boxSizing: 'border-box',
            color: '#FFF8E7',
            fontFamily: '"Press Start 2P", monospace',
            fontSize: '7px',
            zIndex: 200,
            ...noDrag
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span>GALERÍA DEV</span>
            <button onClick={props.onToggleGallery} style={{ background: 'none', border: 'none', color: '#FFF8E7', cursor: 'pointer' }}>
              ✕
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
            {props.galleryEntries.map((g) => (
              <div key={g.agentId} style={{ background: 'rgba(255,248,231,0.05)', border: '1px solid rgba(255,248,231,0.1)', borderRadius: '8px', padding: '6px', textAlign: 'center' }}>
                <div style={{ fontSize: '14px' }}>{SPECIES_EMOJI_MAP[g.species] ?? '🦊'}</div>
                <div style={{ marginTop: '2px' }}>{g.displayName}</div>
                <div style={{ marginTop: '2px', opacity: 0.7 }}>{g.visualState}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
