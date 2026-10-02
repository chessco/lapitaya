/**
 * Desktop Companion Renderer Root Component — FASE 1.
 *
 * Renders the safe presentation shell for Alicia & Desktop Companions.
 * Uses window.companionBridge for safe communication with DesktopPresenceService.
 * Zero access to CIMA or main process authority.
 */

import React, { useEffect, useState } from 'react';
import type { CompanionPresentation, CompanionVisualState } from '@shared/lapitaya/desktopCompanions/types';

export const CompanionApp: React.FC = () => {
  const [snapshot, setSnapshot] = useState<CompanionPresentation | null>(null);
  const [visualState, setVisualState] = useState<CompanionVisualState>('IDLE');

  useEffect(() => {
    const bridge = (window as any).companionBridge;
    if (!bridge) return;

    const unsubSnapshot = bridge.onSnapshot((newSnapshot: CompanionPresentation) => {
      setSnapshot(newSnapshot);
      if (newSnapshot.entries.length > 0) {
        setVisualState(newSnapshot.entries[0].visualState);
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

  const handleClick = (): void => {
    const bridge = (window as any).companionBridge;
    if (bridge && typeof bridge.open === 'function') {
      bridge.open();
    }
  };

  const primaryEntry = snapshot?.entries[0];
  const mode = snapshot?.mode ?? 'MINI';

  if (mode === 'OFF') {
    return null;
  }

  // Visual state colors & labels
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

  const currentColor = getStateColor(visualState);

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
    width: '180px',
    height: '180px',
    borderRadius: '24px',
    background: 'rgba(26, 19, 32, 0.85)',
    backdropFilter: 'blur(12px)',
    border: `3px solid ${currentColor}`,
    boxShadow: `0 8px 32px rgba(0, 0, 0, 0.4), 0 0 16px ${currentColor}44`,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    cursor: 'pointer',
    color: '#FFF8E7',
    fontFamily: '"Press Start 2P", monospace',
    transition: 'all 0.3s ease',
    WebkitAppRegion: 'drag'
  } as React.CSSProperties;

  const avatarCircleStyle: React.CSSProperties = {
    width: '64px',
    height: '64px',
    borderRadius: '50%',
    background: currentColor,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '32px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    WebkitAppRegion: 'no-drag'
  } as React.CSSProperties;

  const titleStyle: React.CSSProperties = {
    fontSize: '11px',
    color: '#FFF8E7',
    letterSpacing: '0.5px',
    WebkitAppRegion: 'no-drag'
  } as React.CSSProperties;

  const badgeStyle: React.CSSProperties = {
    fontSize: '8px',
    padding: '3px 8px',
    borderRadius: '10px',
    background: `${currentColor}33`,
    color: currentColor,
    border: `1px solid ${currentColor}`,
    textTransform: 'uppercase',
    WebkitAppRegion: 'no-drag'
  } as React.CSSProperties;

  return (
    <div style={containerStyle}>
      <div onClick={handleClick} style={cardStyle}>
        {/* Avatar Icon Container */}
        <div style={avatarCircleStyle}>
          🦊
        </div>

        {/* Companion Title */}
        <div style={titleStyle}>
          {primaryEntry ? primaryEntry.species.toUpperCase() : 'ALICIA'}
        </div>

        {/* State Badge */}
        <div style={badgeStyle}>
          {visualState}
        </div>
      </div>
    </div>
  );
};
