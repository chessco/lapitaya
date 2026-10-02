/**
 * Desktop Companion Renderer Root Component — FASE 1.
 *
 * Renders the interactive safe presentation shell for Alicia & Desktop Companions.
 * Allows switching between all virtual pets (Alicia, El Inge, El Beni, Valentin, Margarito, Jose Juan, El Tutu)
 * and testing visual states.
 * Zero access to CIMA or main process authority.
 */

import React, { useEffect, useState } from 'react';
import type { CompanionPresentation, CompanionVisualState } from '@shared/lapitaya/desktopCompanions/types';

const SPECIES_EMOJI_MAP: Record<string, string> = {
  fox: '🦊',
  beaver: '🦫',
  cat: '🐱',
  owl: '🦉',
  hamster: '🐹',
  turtle: '🐢',
  rabbit: '🐰'
};

const TEST_STATES: CompanionVisualState[] = [
  'IDLE',
  'THINKING',
  'WORKING',
  'CELEBRATING',
  'CONCERNED',
  'NOTIFYING',
  'PAUSED'
];

export const CompanionApp: React.FC = () => {
  const [snapshot, setSnapshot] = useState<CompanionPresentation | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [overrideState, setOverrideState] = useState<CompanionVisualState | null>(null);

  useEffect(() => {
    const bridge = (window as any).companionBridge;
    if (!bridge) return;

    const unsubSnapshot = bridge.onSnapshot((newSnapshot: CompanionPresentation) => {
      setSnapshot(newSnapshot);
    });

    const unsubState = bridge.onSetState((newState: CompanionVisualState) => {
      setOverrideState(newState);
    });

    return () => {
      if (typeof unsubSnapshot === 'function') unsubSnapshot();
      if (typeof unsubState === 'function') unsubState();
    };
  }, []);

  const handleClick = (): void => {
    const bridge = (window as any).companionBridge;
    if (bridge && typeof bridge.open === 'function') {
      bridge.open();
    }
  };

  const entries = snapshot?.entries ?? [];
  const activeEntry = entries[currentIndex] ?? entries[0] ?? {
    agentId: 'alicia',
    species: 'fox',
    visualState: 'IDLE',
    statusText: 'Alicia (Fox)',
    isPrimary: true,
    position: { x: 100, y: 100 }
  };

  const currentVisualState = overrideState ?? activeEntry.visualState ?? 'IDLE';

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (entries.length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + entries.length) % entries.length);
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (entries.length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % entries.length);
  };

  const handleSelectState = (state: CompanionVisualState, e: React.MouseEvent) => {
    e.stopPropagation();
    setOverrideState(state);
  };

  const mode = snapshot?.mode ?? 'MINI';
  if (mode === 'OFF') {
    return null;
  }

  const getStateColor = (state: CompanionVisualState): string => {
    switch (state) {
      case 'THINKING':
        return '#3F51B5'; // Blue
      case 'CELEBRATING':
        return '#4CAF50'; // Green
      case 'CONCERNED':
        return '#FF9800'; // Orange
      case 'NOTIFYING':
        return '#E91E63'; // Pink
      case 'PAUSED':
        return '#9E9E9E'; // Grey
      case 'WORKING':
        return '#9C27B0'; // Purple
      case 'IDLE':
      default:
        return '#E65100'; // Fox Orange
    }
  };

  const currentColor = getStateColor(currentVisualState);
  const emoji = SPECIES_EMOJI_MAP[activeEntry.species] ?? '🦊';

  const containerStyle: React.CSSProperties = {
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
  };

  const cardStyle: React.CSSProperties = {
    width: '240px',
    height: '270px',
    borderRadius: '24px',
    background: 'rgba(26, 19, 32, 0.90)',
    backdropFilter: 'blur(16px)',
    border: `3px solid ${currentColor}`,
    boxShadow: `0 8px 32px rgba(0, 0, 0, 0.5), 0 0 20px ${currentColor}55`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 12px',
    cursor: 'pointer',
    color: '#FFF8E7',
    fontFamily: '"Press Start 2P", monospace',
    transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
    WebkitAppRegion: 'drag'
  } as React.CSSProperties;

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    WebkitAppRegion: 'no-drag'
  } as React.CSSProperties;

  const navBtnStyle: React.CSSProperties = {
    background: 'rgba(255, 248, 231, 0.15)',
    border: 'none',
    color: '#FFF8E7',
    borderRadius: '8px',
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: '12px'
  };

  const avatarCircleStyle: React.CSSProperties = {
    width: '72px',
    height: '72px',
    borderRadius: '50%',
    background: currentColor,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '36px',
    boxShadow: '0 6px 16px rgba(0, 0, 0, 0.4)',
    WebkitAppRegion: 'no-drag',
    transition: 'background 0.3s ease'
  } as React.CSSProperties;

  const titleStyle: React.CSSProperties = {
    fontSize: '10px',
    color: '#FFF8E7',
    letterSpacing: '0.5px',
    textAlign: 'center',
    WebkitAppRegion: 'no-drag'
  } as React.CSSProperties;

  const badgeStyle: React.CSSProperties = {
    fontSize: '8px',
    padding: '4px 10px',
    borderRadius: '12px',
    background: `${currentColor}33`,
    color: currentColor,
    border: `1px solid ${currentColor}`,
    textTransform: 'uppercase',
    WebkitAppRegion: 'no-drag'
  } as React.CSSProperties;

  const stateSelectorContainer: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px',
    justifyContent: 'center',
    width: '100%',
    WebkitAppRegion: 'no-drag'
  } as React.CSSProperties;

  return (
    <div style={containerStyle}>
      <div onClick={handleClick} style={cardStyle}>
        {/* Header Navigation for Pets */}
        <div style={headerStyle}>
          <button style={navBtnStyle} onClick={handlePrev} title="Previous pet">
            ◀
          </button>
          <span style={{ fontSize: '9px', opacity: 0.8 }}>
            {currentIndex + 1} / {entries.length || 7}
          </span>
          <button style={navBtnStyle} onClick={handleNext} title="Next pet">
            ▶
          </button>
        </div>

        {/* Avatar Icon Container */}
        <div style={avatarCircleStyle}>
          {emoji}
        </div>

        {/* Companion Title & Agent ID */}
        <div style={titleStyle}>
          <div>{activeEntry.agentId.toUpperCase()}</div>
          <div style={{ fontSize: '7px', opacity: 0.6, marginTop: '4px' }}>
            ({activeEntry.species})
          </div>
        </div>

        {/* Active State Badge */}
        <div style={badgeStyle}>
          {currentVisualState}
        </div>

        {/* State Selector Chips for Testing */}
        <div style={stateSelectorContainer}>
          {TEST_STATES.slice(0, 5).map((st) => (
            <button
              key={st}
              onClick={(e) => handleSelectState(st, e)}
              style={{
                fontSize: '6px',
                padding: '2px 4px',
                borderRadius: '4px',
                border: '1px solid rgba(255,255,231,0.2)',
                background: currentVisualState === st ? currentColor : 'rgba(0,0,0,0.3)',
                color: '#FFF8E7',
                cursor: 'pointer'
              }}
            >
              {st.slice(0, 4)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
