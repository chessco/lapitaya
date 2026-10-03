/**
 * Desktop Companion Renderer Root Component — FASE 2: Living Desktop Experience · FASE 3: living behaviors.
 *
 * One companion per window: the window's `?agent=` names which entry of the presentation
 * snapshot it renders. State, bubbles and runtime facts come from the main process; the only
 * thing this renderer creates on its own is a CONVERSATION bubble (greeting / "Hablar"), which
 * never states runtime facts.
 *
 * FASE 3: ambient beats (walk, rest, think) come from the shared behavior engine and the
 * companion's declarative personality, and only fill the time while the verified runtime state
 * is IDLE. Sleep is shown only when main says it is allowed (nothing executes, nothing waits for
 * the human, the user is away). All of it is presentation: nothing here reaches CIMA.
 *
 * Zero access to CIMA or main process governance authority: the bridge exposes presentation
 * calls only (open main window, dismiss bubble, set mode, hide).
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import i18n from '../i18n';
import { agentDisplayName, agentTitleKey, LA_PITAYA_AGENT_BY_ID, type LaPitayaAgentId } from '@shared/lapitaya/agents';
import type {
  CompanionPresentation,
  CompanionPresentationEntry,
  CompanionSpeechBubbleData
} from '@shared/lapitaya/desktopCompanions/types';
import { CompanionCreature } from './CompanionCreature';
import { CONVERSATION_LINES, GREETING_LINE, companionAgentFromSearch } from './companionConversation';
import { nextAmbientBeat, seededRandom, type AmbientBehavior } from '@shared/lapitaya/desktopCompanions/behavior';
import { getCompanionPersonality, WORK_STYLE_CUE } from '@shared/lapitaya/desktopCompanions/personality';

const CONVERSATION_BUBBLE_MS = 6000;
const WALK_STEP_MS = 120;

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
  const personality = useMemo(() => getCompanionPersonality(agentId), [agentId]);
  const rng = useMemo(() => seededRandom((Date.now() ^ agentId.length * 7919) >>> 0), [agentId]);
  const [snapshot, setSnapshot] = useState<CompanionPresentation | null>(null);
  const [localBubble, setLocalBubble] = useState<CompanionSpeechBubbleData | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [ambient, setAmbient] = useState<AmbientBehavior>('IDLE');
  const [walkOffset, setWalkOffset] = useState(0);
  const walkDirection = useRef<1 | -1>(1);
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
  const living = snapshot?.living;
  // Sleep is decided by main (nothing executes, nothing waits for the human, user away) and only shows on IDLE.
  const isSleeping = visualState === 'IDLE' && living?.sleepAllowed === true;
  const calm = living?.reducedMotion === true || living?.ambientMovement === false;

  // Ambient beats (walk / rest / think) — only while the verified runtime state is IDLE and awake.
  useEffect(() => {
    if (visualState !== 'IDLE' || isSleeping || snapshot === null || calm) {
      setAmbient('IDLE');
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const beat = () => {
      const next = nextAmbientBeat(personality, rng);
      setAmbient(next.behavior);
      timer = setTimeout(beat, next.durationMs);
    };
    beat();
    return () => { if (timer) clearTimeout(timer); };
  }, [visualState, isSleeping, snapshot === null, calm, personality, rng]);

  // In-window walk while the ambient beat is WALKING (the avatar only; the drag handle never moves).
  useEffect(() => {
    if (ambient !== 'WALKING' || personality.walkRange <= 0) {
      setWalkOffset(0);
      return;
    }
    const stepPx = Math.max(1, Math.round(personality.movementSpeed / 40));
    const interval = setInterval(() => {
      setWalkOffset((prev) => {
        let next = prev + walkDirection.current * stepPx;
        if (next > personality.walkRange) {
          walkDirection.current = -1;
          next = personality.walkRange;
        } else if (next < -personality.walkRange) {
          walkDirection.current = 1;
          next = -personality.walkRange;
        }
        return next;
      });
    }, WALK_STEP_MS);
    return () => clearInterval(interval);
  }, [ambient, personality]);

  useEffect(() => () => {
    if (localBubbleTimer.current) clearTimeout(localBubbleTimer.current);
  }, []);

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
  const agent = LA_PITAYA_AGENT_BY_ID[entry.agentId];
  const title = agent?.title ? i18n.t(agentTitleKey(agent), { defaultValue: agent.title }) : null;
  const relayed = entry.relayedFrom ? snapshot.entries.find((e) => e.agentId === entry.relayedFrom) : undefined;
  const awakeLabel = entry.agentId === 'alicia' && living?.executionAwake
    ? i18n.t('lapitaya:executionAwake.indicator', { defaultValue: 'Equipo activo mientras trabajan los agentes' })
    : null;

  return (
    <CompanionCreature
      entry={entry}
      displayName={displayName}
      title={title}
      relayedName={entry.relayedFrom ? agentDisplayName(entry.relayedFrom, locale) : null}
      relayedSpecies={relayed?.species ?? null}
      bubble={localBubble ?? runtimeBubble}
      showMenu={showMenu}
      showGallery={showGallery}
      isSleeping={isSleeping}
      walkOffset={walkOffset}
      ambient={ambient}
      workCue={WORK_STYLE_CUE[personality.workStyle]}
      awakeLabel={awakeLabel}
      celebrationIntensity={personality.celebrationIntensity}
      galleryEntries={snapshot.entries}
      onAvatarClick={(e) => {
        e.stopPropagation();
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
      onFocusMode={(e) => {
        e.stopPropagation();
        setShowMenu(false);
        bridge()?.setMode('FOCUS');
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
