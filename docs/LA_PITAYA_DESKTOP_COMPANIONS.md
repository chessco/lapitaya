# LA PITAYA — DESKTOP COMPANIONS
## Architectural Specification & Operational Reference — FASE 1

---

## 1. SYSTEM VISION & ARCHITECTURE

Desktop Companions introduces a living desktop presence layer for La Pitaya (combining the delightful desktop creature dynamics of Shimeji, Tamagotchi, Clippy, and Virtual Company AI Agents).

The primary companion, **Alicia (Fox)**, alongside members of the La Pitaya hive, project themselves onto the user's desktop as floating, interactive creatures.

```
┌─────────────────────────────────────────────────────────────┐
│                    GOVERNANCE LAYER                         │
│  CIMA / CimaRuntimeService / IntentBoundary (UNTOUCHED)     │
└──────────────────────────────┬──────────────────────────────┘
                               │ Observability Tap (Read-Only)
┌──────────────────────────────▼──────────────────────────────┐
│                 MAIN PROCESS SERVICE                        │
│                DesktopPresenceService                       │
│    (Window Geometry, Mode Engine, Safe Presentation)        │
└──────────────────────────────┬──────────────────────────────┘
                               │ IPC Push (CompanionPresentation)
┌──────────────────────────────▼──────────────────────────────┐
│              UNTRUSTED COMPANION RENDERER                   │
│          BrowserWindow (transparent, frameless)             │
│   Preload: companionPreload.ts (No nodeIntegration)          │
│   Component: CompanionApp.tsx (Visual State Renderer)        │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. CORE PRINCIPLE: ZERO GOVERNANCE AUTHORITY IN COMPANION LAYER

The Desktop Companion layer is **strictly an experience and presentation layer**. It MUST NOT become a layer of authority.

- **CIMA** remains the sole **Governance Authority**.
- **CimaRuntimeService** remains the sole **Runtime Authority**.
- **Alicia** remains an **Interface & Intent Requester**.
- **Desktop Companion Renderer** is an **Untrusted Renderer Process**.

The companion process NEVER holds or receives authorization tokens, ledger entries, HMAC keys, or risk evaluation logic.

---

## 3. RELATIONSHIP WITH CIMA & CIMARUNTIMESERVICE

1. Desktop Companions do NOT import or execute CIMA runtime code.
2. Desktop Companions do NOT handle CIMA banners or vote on approvals.
3. Observability signals flow ONE-WAY from CIMA/Alicia to `DesktopPresenceService`.
4. If the companion window is closed or crashes, CIMA governance continues operating without interruption.

---

## 4. RELATIONSHIP WITH ALICIA & INTENTBOUNDARY

Alicia's companion engine (`aliciaCompanion`) exposes a read-only observability tap (`subscribeObservability`). `DesktopPresenceService` subscribes to these updates and translates presence events (`THINKING`, `WAITING_APPROVAL`, `CELEBRATING`, `WARNING`) into companion visual states (`THINKING`, `CONCERNED`, `CELEBRATING`, `PAUSED`).

Interactions in the companion window (e.g. clicking Alicia) trigger `companionBridge.open()`, focusing the primary La Pitaya window where human governance decisions take place.

---

## 5. ELECTRON BROWSERWINDOW & TRANSPARENCY MODEL

The companion window is created with the following Electron settings:

- `transparent: true`
- `frame: false`
- `resizable: false`
- `skipTaskbar: true`
- `alwaysOnTop: true`
- `backgroundColor: '#00000000'`
- `hasShadow: false`

This yields a floating, background-less desktop creature on Windows and macOS.

---

## 6. PROCESS ISOLATION & CONTEXT BRIDGE STRATEGY

To ensure complete safety against untrusted script execution or renderer compromise:

- `sandbox: true`
- `contextIsolation: true`
- `nodeIntegration: false`

The companion window runs under its own dedicated preload script (`src/preload/companionPreload.ts`).

---

## 7. COMPANION PRELOAD & RENDERER BOUNDARIES

The companion preload exposes ONLY `window.companionBridge` containing four functions:

```typescript
export interface CompanionBridgeAPI {
  onSnapshot: (callback: (snapshot: CompanionPresentation) => void) => () => void;
  onSetState: (callback: (state: CompanionVisualState) => void) => () => void;
  positionChanged: (pos: CompanionPosition) => void;
  open: () => void;
}
```

It explicitly omits all file system, terminal, PTY, ledger, CIMA, and main-window IPC channels.

---

## 8. DESKTOPPRESENCESERVICE LIFECYCLE & STATE MODEL

`DesktopPresenceService` manages:
1. Mode transitions (`OFF`, `MINI`, `PAUSED`).
2. Window instantiation and teardown.
3. Display boundary validation (`ensureOnScreen`).
4. Persistence of companion positions (`desktopCompanion.position.<agentId>`).
5. Safe snapshot generation (`getPresentation`).

---

## 9. COMPANION MODES

| Mode | Description | Window State |
|---|---|---|
| `OFF` | Companions hidden completely | Window hidden / closed |
| `MINI` | Single primary companion (Alicia) | Floating mini widget (220x220) |
| `COMPANION` | Primary companion with active status text | Floating widget |
| `COMPANY` | Multi-agent desktop roster (Phase 4+) | Floating multi-creature window |
| `FOCUS` | Compact status indicator during work | Small overlay |
| `PAUSED` | Temporarily frozen state | Frozen visuals |

---

## 10. COMPANION VISUAL STATES

- `IDLE`: Resting state.
- `WALKING`: Moving across screen (Phase 2+).
- `SLEEPING`: Low activity / dormant.
- `THINKING`: Processing AI request.
- `WORKING`: Executing background task.
- `CELEBRATING`: Task succeeded / CIMA phase passed.
- `SUGGESTING`: Proposing action to user.
- `CONCERNED`: CIMA risk or human approval pending.
- `NOTIFYING`: Active notification.
- `PAUSED`: Desktop companion paused.

---

## 11. SAFE PRESENTATION PROJECTION MODEL

`CompanionPresentation` is a clean, sanitized projection object sent to the renderer:

```typescript
export interface CompanionPresentationEntry {
  agentId: LaPitayaAgentId;
  species: string;
  visualState: CompanionVisualState;
  statusText: string;
  isPrimary: boolean;
  position: CompanionPosition;
}

export interface CompanionPresentation {
  mode: CompanionMode;
  entries: readonly CompanionPresentationEntry[];
  updatedAt: number;
}
```

---

## 12. ANIMAL AVATAR SYSTEM & SPECIES MAPPING

Each agent in La Pitaya maps to a unique animal species:

| Agent | Species | Color | Role |
|---|---|---|---|
| `alicia` | Fox | `#E65100` | AI Companion |
| `el-inge` | Beaver | `#795548` | Primary Orchestrator |
| `el-beni` | Cat | `#FF9800` | Builder |
| `valentin` | Owl | `#3F51B5` | Architect |
| `margarito` | Hamster | `#8D6E63` | Tester |
| `jose-juan` | Turtle | `#2E7D32` | Auditor |
| `el-tutu` | Rabbit | `#9E9E9E` | Learner |

---

## 13. ALLOWED AGENT ROSTER ALLOWLIST

Only agent IDs belonging to the union type `LaPitayaAgentId` are accepted by `DesktopPresenceService`. Any unrecognized agent ID passed to `moveCompanion` or presentation builders throws an explicit validation error.

---

## 14. WINDOW DRAGGING & DISPLAY BOUNDARY CLAMPING

Companions can be dragged around the desktop. `DesktopPresenceService.ensureOnScreen()` calculates display workArea bounds (excluding taskbar/dock) and clamps companion coordinates so creatures never wander off-screen or get trapped off-monitor.

---

## 15. IPC CHANNELS & GOVERNANCE ISOLATION ENFORCEMENT

All IPC channels for companions use the namespace `lapitaya:companion:*`.

Forbidden terms in companion IPC:
`approve`, `risk`, `autonomy`, `capability`, `execute`, `ledger`, `cima`, `governance`, `token`, `hmac`, `auth`.

Attempting to transmit any IPC containing these terms via companion channels triggers an immediate security error.

---

## 16. POSITION PERSISTENCE & MULTI-SCREEN BEHAVIOR

Positions are saved per agent ID in `PersistStore` under `desktopCompanion.position.<agentId>`. Upon launch, positions are loaded and verified against the current display layout using `ensureOnScreen()`.

---

## 17. EVENT BRIDGE & OBSERVABILITY SIGNAL TAP

The event bridge is purely unidirectional (`Main Process` -> `Companion BrowserWindow`). The companion renderer cannot emit events back to the hive or main process, except for `POSITION_CHANGED` and `OPEN_MAIN`.

---

## 18. THREAT MODEL & ADVERSARIAL SECURITY CONTROLS

- **Threat**: Compromised renderer script attempts to approve a CIMA action.
  - **Mitigation**: Companion renderer has no IPC channels for approvals or CIMA actions.
- **Threat**: Malicious code sends arbitrary IPC channel names.
  - **Mitigation**: `isAllowedCompanionChannel` rejects non-allowlisted channels.
- **Threat**: Data leak of CIMA ledger / security tokens into desktop window.
  - **Mitigation**: `CompanionPresentation` projection strips all governance fields.

---

## 19. RENDERER COMPONENT ARCHITECTURE

`CompanionApp.tsx` renders the visual representation using React. It registers listeners with `window.companionBridge` on mount, listens for snapshots and state changes, and renders the animal avatar with glassmorphism styling and pixel-font state badges.

---

## 20. INCREMENTAL ROADMAP (PHASES 1 - 8)

- **FASE 1 (Current)**: Desktop Presence Foundation (Window, Preload, Bridge, Types, Registry, IPC, Tests).
- **FASE 2**: Desktop Creature Engine (Shimeji movement & gravity physics).
- **FASE 3**: Expression & Animation System (Sprite sheets & emotion states).
- **FASE 4**: Virtual Company Roster (Multi-agent desktop presence).
- **FASE 5**: Tamagotchi Dynamics (Energy, focus & mood state engine).
- **FASE 6**: Clippy Modernized Contextual Assistance (Proactive suggestions).
- **FASE 7**: Quick Action Ring & Radial Overlay (Context menu).
- **FASE 8**: Full Desktop Company Experience Polish & Themes.

---

## 21. VERIFICATION & TEST SUITE STRATEGY

The test suite (`test/lapitaya-desktop-companions.test.cjs`) implements 25 requirement tests (`COMP-01` to `COMP-25`) plus 8 adversarial security tests (`ADV-01` to `ADV-08`).

Run test suite with:
```bash
node --test test/lapitaya-desktop-companions.test.cjs
```

---

## 22. OPERATIONAL REFERENCE & IPC CHANNEL TABLE

| Channel | Direction | Payload | Description |
|---|---|---|---|
| `lapitaya:companion:snapshot` | Main → Companion | `CompanionPresentation` | Pushes current companion state & positions |
| `lapitaya:companion:setState` | Main → Companion | `CompanionVisualState` | Pushes immediate visual state change |
| `lapitaya:companion:positionChanged` | Companion → Main | `{ x, y }` | Notifies main process of user drag |
| `lapitaya:companion:openMain` | Companion → Main | `void` | Focuses primary La Pitaya app window |
