/**
 * Desktop Companion Renderer Root Component — FASE 2: Living Desktop Experience.
 *
 * One companion per window: the window's `?agent=` names which entry of the presentation
 * snapshot it renders. State, bubbles and runtime facts come from the main process; the only
 * thing this renderer creates on its own is a CONVERSATION bubble (greeting / "Hablar"), which
 * never states runtime facts.
 *
 * Zero access to CIMA or main process governance authority: the bridge exposes presentation
 * calls only (open main window, dismiss bubble, set mode, hide).
 */

import React, { useEffect, useRef, useState } from 'react';
import i18n from '../i18n';
import { agentDisplayName, type LaPitayaAgentId } from '@shared/lapitaya/agents';
import type {
  CompanionPresentation,
  CompanionPresentationEntry,
  CompanionSpeechBubbleData
} from '@shared/lapitaya/desktopCompanions/types';
import { CompanionCreature } from './CompanionCreature';
import { CONVERSATION_LINES, GREETING_LINE, companionAgentFromSearch } from './companionConversation';

const SLEEP_AFTER_MS = 45000;
const CONVERSATION_BUBBLE_MS = 6000;

/** The presentation-only bridge exposed by companionPreload.ts. */
interface CompanionBridge {
  onSnapshot: (callback: (snapshot: CompanionPresentation) => void) => () => void;
  open: () => void;
  dismissBubble: () => void;
  setMode: (mode: string) => void;
  hide: () => void;
  setInteractive: (interactive: boolean) => void;
  drag: (phase: 'start' | 'move' | 'end', dx: number, dy: number) => void;
}

const bridge = (): CompanionBridge | undefined =>
  (window as unknown as { companionBridge?: CompanionBridge }).companionBridge;

export const CompanionApp: React.FC = () => {
  const [agentId] = useState<LaPitayaAgentId>(() => companionAgentFromSearch(window.location.search));
  const [snapshot, setSnapshot] = useState<CompanionPresentation | null>(null);
  const [localBubble, setLocalBubble] = useState<CompanionSpeechBubbleData | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [isSleeping, setIsSleeping] = useState(false);
  const [walkOffset, setWalkOffset] = useState(0);
  const walkDirection = useRef<1 | -1>(1);
  const sleepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localBubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const b = bridge();
    if (!b) return;
    const unsub = b.onSnapshot((next) => setSnapshot(next));
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  // Close the menu when the companion window loses focus.
  useEffect(() => {
    const onBlur = () => setShowMenu(false);
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  const entry: CompanionPresentationEntry | undefined = snapshot?.entries.find((e) => e.agentId === agentId);
  const runtimeBubble = entry?.bubble ?? null;
  const visualState = entry?.visualState ?? 'IDLE';

  const wake = () => {
    setIsSleeping(false);
    if (sleepTimer.current) clearTimeout(sleepTimer.current);
    sleepTimer.current = setTimeout(() => setIsSleeping(true), SLEEP_AFTER_MS);
  };

  // Any real change (state or a new bubble) wakes the companion up.
  useEffect(() => {
    wake();
    return () => {
      if (sleepTimer.current) clearTimeout(sleepTimer.current);
    };
  }, [visualState, runtimeBubble?.id]);

  useEffect(() => () => {
    if (localBubbleTimer.current) clearTimeout(localBubbleTimer.current);
  }, []);

  // Gentle idle walk (the avatar only; the drag handle never moves).
  useEffect(() => {
    if (visualState !== 'IDLE' || isSleeping || snapshot === null) {
      setWalkOffset(0);
      return;
    }
    const interval = setInterval(() => {
      setWalkOffset((prev) => {
        let next = prev + walkDirection.current * 2;
        if (next > 30) {
          walkDirection.current = -1;
          next = 30;
        } else if (next < -30) {
          walkDirection.current = 1;
          next = -30;
        }
        return next;
      });
    }, 120);
    return () => clearInterval(interval);
  }, [visualState, isSleeping, snapshot === null]);

  const say = (text: string) => {
    if (localBubbleTimer.current) clearTimeout(localBubbleTimer.current);
    const bubble: CompanionSpeechBubbleData = {
      id: `conv-${Date.now()}`,
      text,
      kind: 'conversation',
      timestamp: Date.now(),
      autoDismissMs: CONVERSATION_BUBBLE_MS
    };
    setLocalBubble(bubble);
    localBubbleTimer.current = setTimeout(() => setLocalBubble(null), CONVERSATION_BUBBLE_MS);
  };

  if (!snapshot || snapshot.mode === 'OFF' || !entry) return null;

  const locale = i18n.language;
  const displayName = agentDisplayName(entry.agentId, locale);
  const relayed = entry.relayedFrom ? snapshot.entries.find((e) => e.agentId === entry.relayedFrom) : undefined;

  return (
    <CompanionCreature
      entry={entry}
      displayName={displayName}
      relayedName={entry.relayedFrom ? agentDisplayName(entry.relayedFrom, locale) : null}
      relayedSpecies={relayed?.species ?? null}
      bubble={localBubble ?? runtimeBubble}
      showMenu={showMenu}
      showGallery={showGallery}
      isSleeping={isSleeping}
      walkOffset={walkOffset}
      galleryEntries={snapshot.entries}
      onAvatarClick={(e) => {
        e.stopPropagation();
        wake();
        setShowMenu((open) => !open);
        if (!runtimeBubble && !localBubble) say(GREETING_LINE);
      }}
      onSpeak={(e) => {
        e.stopPropagation();
        say(CONVERSATION_LINES[Math.floor(Math.random() * CONVERSATION_LINES.length)]);
      }}
      onOpenApp={(e) => {
        e.stopPropagation();
        setShowMenu(false);
        bridge()?.open();
      }}
      onToggleGallery={(e) => {
        e.stopPropagation();
        setShowGallery((open) => !open);
      }}
      onHide={(e) => {
        e.stopPropagation();
        setShowMenu(false);
        bridge()?.hide();
      }}
      onInteractiveChange={(interactive) => {
        // While dragging, the pointer is captured: keep the window interactive until release.
        if (!interactive && dragStart.current) return;
        bridge()?.setInteractive(interactive);
      }}
      onHandlePointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragStart.current = { x: e.screenX, y: e.screenY };
        bridge()?.drag('start', 0, 0);
      }}
      onHandlePointerMove={(e) => {
        if (!dragStart.current) return;
        bridge()?.drag('move', e.screenX - dragStart.current.x, e.screenY - dragStart.current.y);
      }}
      onHandlePointerUp={() => {
        if (!dragStart.current) return;
        dragStart.current = null;
        bridge()?.drag('end', 0, 0);
      }}
      onDismissBubble={(e) => {
        e.stopPropagation();
        if (localBubble) {
          setLocalBubble(null);
          return;
        }
        bridge()?.dismissBubble();
      }}
    />
  );
};
