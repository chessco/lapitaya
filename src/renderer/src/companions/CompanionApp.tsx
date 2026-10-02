/**
 * Desktop Companion Renderer Root Component — FASE 2: Living Desktop Experience.
 *
 * Renders Alicia and Desktop Companions as floating, living creatures on the user's desktop.
 * Features:
 *  - Pure transparent background (no permanent dashboard/card box)
 *  - Micro-animation controller (idle bobbing, walking, sleeping zZz, celebration bounce, attention pulse)
 *  - Interactive speech bubble (CompanionSpeechBubble) with action menu
 *  - Non-deterministic visual idle & sleep behaviors
 *  - Development Gallery Preview toggleable from menu
 *  - Zero access to CIMA or main process governance authority.
 */

import React, { useEffect, useState, useRef } from 'react';
import type {
  CompanionPresentation,
  CompanionVisualState,
  CompanionAnimationState,
  CompanionSpeechBubbleData
} from '@shared/lapitaya/desktopCompanions/types';

const SPECIES_EMOJI_MAP: Record<string, string> = {
  fox: '🦊',
  beaver: '🦫',
  cat: '🐱',
  owl: '🦉',
  hamster: '🐹',
  turtle: '🐢',
  rabbit: '🐰'
};

export const CompanionApp: React.FC = () => {
  const [snapshot, setSnapshot] = useState<CompanionPresentation | null>(null);
  const [visualState, setVisualState] = useState<CompanionVisualState>('IDLE');
  const [activeBubble, setActiveBubble] = useState<CompanionSpeechBubbleData | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showDevGallery, setShowDevGallery] = useState(false);
  const [isSleeping, setIsSleeping] = useState(false);
  const [walkOffset, setWalkOffset] = useState(0);
  const [walkDirection, setWalkDirection] = useState<1 | -1>(1);

  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const sleepTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize bridge listeners
  useEffect(() => {
    const bridge = (window as any).companionBridge;
    if (!bridge) return;

    const unsubSnapshot = bridge.onSnapshot((newSnapshot: CompanionPresentation) => {
      setSnapshot(newSnapshot);
      if (newSnapshot.entries.length > 0) {
        const primary = newSnapshot.entries[0];
        setVisualState(primary.visualState);
        if (primary.bubble) {
          setActiveBubble(primary.bubble);
        }
      }
    });

    const unsubState = bridge.onSetState((newState: CompanionVisualState) => {
      setVisualState(newState);
    });

    return () => {
      if (typeof unsubSnapshot === 'function') unsubSnapshot();
      if (typeof unsubState === 'function') unsubState();
    };
  }, []);

  // Idle & Sleep timer logic
  const resetInactivityTimers = () => {
    if (isSleeping) setIsSleeping(false);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);

    sleepTimerRef.current = setTimeout(() => {
      setIsSleeping(true);
    }, 45000); // Sleep after 45s of zero user activity
  };

  useEffect(() => {
    resetInactivityTimers();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    };
  }, [visualState]);

  // Non-deterministic gentle walking motion when IDLE or WALKING
  useEffect(() => {
    if (visualState === 'WALKING' || (visualState === 'IDLE' && !isSleeping)) {
      const interval = setInterval(() => {
        setWalkOffset((prev) => {
          let next = prev + walkDirection * 2;
          if (next > 40) {
            setWalkDirection(-1);
            next = 40;
          } else if (next < -40) {
            setWalkDirection(1);
            next = -40;
          }
          return next;
        });
      }, 120);
      return () => clearInterval(interval);
    } else {
      setWalkOffset(0);
    }
  }, [visualState, walkDirection, isSleeping]);

  const handleCreatureClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    resetInactivityTimers();
    setShowMenu((prev) => !prev);
    if (!activeBubble) {
      setActiveBubble({
        id: `bub-click-${Date.now()}`,
        text: 'Hola. ¿En qué puedo ayudarte?',
        timestamp: Date.now()
      });
    }
  };

  const handleOpenApp = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    const bridge = (window as any).companionBridge;
    if (bridge && typeof bridge.open === 'function') {
      bridge.open();
    }
  };

  const handleSpeak = (e: React.MouseEvent) => {
    e.stopPropagation();
    const quotes = [
      'Todo tranquilo en La Pitaya.',
      'El Inge y los agentes están atentos.',
      'Recuerda que tú tienes el control final.',
      '¿Trabajamos en algo nuevo hoy?'
    ];
    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
    setActiveBubble({
      id: `bub-speak-${Date.now()}`,
      text: randomQuote,
      timestamp: Date.now()
    });
  };

  const handleHideCompanion = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    const bridge = (window as any).companionBridge;
    if (bridge && typeof bridge.hide === 'function') {
      bridge.hide();
    }
  };

  const primaryEntry = snapshot?.entries[0] ?? {
    agentId: 'alicia',
    species: 'fox',
    visualState: visualState,
    mood: 'CURIOUS',
    animationState: 'idle',
    statusText: 'Alicia (Fox)',
    isPrimary: true,
    position: { x: 100, y: 100 }
  };

  const mode = snapshot?.mode ?? 'MINI';
  if (mode === 'OFF') return null;

  const currentAnimation: CompanionAnimationState = isSleeping
    ? 'sleep'
    : primaryEntry.animationState ?? 'idle';

  const emoji = SPECIES_EMOJI_MAP[primaryEntry.species] ?? '🦊';

  // CSS Keyframe styles dynamically injected
  const keyframesStyle = `
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
      0%, 100% { transform: scale(1); box-shadow: 0 0 12px rgba(230,81,0,0.4); }
      50% { transform: scale(1.08); box-shadow: 0 0 24px rgba(230,81,0,0.8); }
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
    @keyframes floatZzz {
      0% { transform: translate(0, 0) scale(0.6); opacity: 0; }
      50% { opacity: 1; }
      100% { transform: translate(14px, -24px) scale(1.2); opacity: 0; }
    }
  `;

  const getAnimationCss = (anim: CompanionAnimationState): React.CSSProperties => {
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
      case 'idle':
      default:
        return { animation: 'companionBob 3s ease-in-out infinite' };
    }
  };

  const getThemeColor = (state: CompanionVisualState): string => {
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
        return '#9E9E9E';
      case 'WORKING':
        return '#9C27B0';
      case 'IDLE':
      default:
        return '#E65100';
    }
  };

  const themeColor = getThemeColor(visualState);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        margin: 0,
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'transparent',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        overflow: 'hidden'
      }}
    >
      <style>{keyframesStyle}</style>

      {/* Transparent Creature Floating Box */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transform: `translateX(${walkOffset}px)`,
          transition: 'transform 0.2s linear'
        }}
      >
        {/* Speech Bubble Overlay */}
        {(activeBubble || showMenu) && (
          <div
            style={
              {
                position: 'absolute',
                bottom: '100px',
                background: 'rgba(26, 19, 32, 0.92)',
                backdropFilter: 'blur(16px)',
                border: `2px solid ${themeColor}`,
                borderRadius: '16px',
                padding: '12px 16px',
                color: '#FFF8E7',
                fontSize: '10px',
                fontFamily: '"Press Start 2P", monospace',
                boxShadow: `0 8px 24px rgba(0, 0, 0, 0.5), 0 0 12px ${themeColor}44`,
                maxWidth: '220px',
                minWidth: '160px',
                zIndex: 100,
                WebkitAppRegion: 'no-drag'
              } as any
            }
          >
            {/* Speech Text */}
            {activeBubble && (
              <div style={{ marginBottom: showMenu ? '10px' : '0', lineHeight: '1.4' }}>
                {activeBubble.text}
              </div>
            )}

            {/* Context Menu Items */}
            {showMenu && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  borderTop: activeBubble ? '1px solid rgba(255,248,231,0.15)' : 'none',
                  paddingTop: activeBubble ? '8px' : '0'
                }}
              >
                <button
                  onClick={handleSpeak}
                  style={{
                    background: 'rgba(255,248,231,0.1)',
                    border: '1px solid rgba(255,248,231,0.2)',
                    borderRadius: '8px',
                    color: '#FFF8E7',
                    padding: '6px 10px',
                    fontSize: '8px',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  💬 Hablar
                </button>
                <button
                  onClick={handleOpenApp}
                  style={{
                    background: `${themeColor}44`,
                    border: `1px solid ${themeColor}`,
                    borderRadius: '8px',
                    color: '#FFF8E7',
                    padding: '6px 10px',
                    fontSize: '8px',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  🚀 Abrir La Pitaya
                </button>
                <button
                  onClick={() => setShowDevGallery((p) => !p)}
                  style={{
                    background: 'rgba(255,248,231,0.1)',
                    border: '1px solid rgba(255,248,231,0.2)',
                    borderRadius: '8px',
                    color: '#FFF8E7',
                    padding: '6px 10px',
                    fontSize: '8px',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  ⚙️ {showDevGallery ? 'Ocultar Galería' : 'Ver Galería Dev'}
                </button>
                <button
                  onClick={handleHideCompanion}
                  style={{
                    background: 'rgba(233,30,99,0.2)',
                    border: '1px solid #E91E63',
                    borderRadius: '8px',
                    color: '#FFF8E7',
                    padding: '6px 10px',
                    fontSize: '8px',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                >
                  🙈 Ocultar
                </button>
              </div>
            )}
          </div>
        )}

        {/* Floating zZz Particle when sleeping */}
        {isSleeping && (
          <div
            style={{
              position: 'absolute',
              top: '-20px',
              right: '10px',
              fontSize: '14px',
              fontWeight: 'bold',
              color: '#9E9E9E',
              animation: 'floatZzz 2s infinite ease-out'
            }}
          >
            zZz
          </div>
        )}

        {/* HERO ANIMAL CREATURE */}
        <div
          onClick={handleCreatureClick}
          style={
            {
              width: '88px',
              height: '88px',
              borderRadius: '50%',
              background: `radial-gradient(circle, ${themeColor} 0%, rgba(26,19,32,0.8) 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '48px',
              boxShadow: `0 8px 24px rgba(0, 0, 0, 0.4), 0 0 20px ${themeColor}66`,
              border: `3px solid ${themeColor}`,
              WebkitAppRegion: 'drag',
              ...getAnimationCss(currentAnimation)
            } as any
          }
        >
          {emoji}
        </div>

        {/* Small Creature Name Label */}
        <div
          style={
            {
              marginTop: '6px',
              fontSize: '9px',
              fontFamily: '"Press Start 2P", monospace',
              color: '#FFF8E7',
              background: 'rgba(26, 19, 32, 0.75)',
              padding: '3px 8px',
              borderRadius: '10px',
              border: `1px solid ${themeColor}88`,
              boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
              WebkitAppRegion: 'no-drag'
            } as any
          }
        >
          {primaryEntry.species.toUpperCase()}
        </div>
      </div>

      {/* DEV GALLERY VIEW (Modal/Drawer toggleable from Menu) */}
      {showDevGallery && (
        <div
          style={
            {
              position: 'absolute',
              bottom: '10px',
              background: 'rgba(26, 19, 32, 0.95)',
              backdropFilter: 'blur(20px)',
              border: '2px solid #E65100',
              borderRadius: '16px',
              padding: '12px',
              width: '260px',
              maxHeight: '200px',
              overflowY: 'auto',
              color: '#FFF8E7',
              fontFamily: '"Press Start 2P", monospace',
              fontSize: '8px',
              zIndex: 200,
              WebkitAppRegion: 'no-drag'
            } as any
          }
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span>DEV GALLERY</span>
            <button
              onClick={() => setShowDevGallery(false)}
              style={{ background: 'none', border: 'none', color: '#FFF8E7', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
            {snapshot?.entries.map((entry) => (
              <div
                key={entry.agentId}
                style={{
                  background: 'rgba(255,248,231,0.05)',
                  border: '1px solid rgba(255,248,231,0.1)',
                  borderRadius: '8px',
                  padding: '6px',
                  textAlign: 'center'
                }}
              >
                <div>{SPECIES_EMOJI_MAP[entry.species] ?? '🦊'}</div>
                <div style={{ marginTop: '2px', fontSize: '7px' }}>{entry.agentId}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
