# LA PITAYA — DESKTOP COMPANIONS
## Architectural Specification & Operational Reference — FASE 1 & FASE 2

---

## 1. SYSTEM VISION & ARCHITECTURE

Desktop Companions introduces a living desktop presence layer for La Pitaya (combining the delightful desktop creature dynamics of Shimeji, Tamagotchi, Clippy, and Virtual Company AI Agents).

In **FASE 2 (Living Desktop Experience)**, companions transition from static UI card windows to **floating, living creatures** that sit, breathe, walk, sleep, celebrate, and interact directly on the user's desktop screen.

```
┌─────────────────────────────────────────────────────────────┐
│                    GOVERNANCE LAYER                         │
│  CIMA / CimaRuntimeService / IntentBoundary (UNTOUCHED)     │
└──────────────────────────────┬──────────────────────────────┘
                               │ Observability Tap (Read-Only)
┌──────────────────────────────▼──────────────────────────────┐
│                 MAIN PROCESS SERVICE                        │
│                DesktopPresenceService                       │
│  (Window Geometry, Mode Engine, Verified Fact Event Tap)    │
└──────────────────────────────┬──────────────────────────────┘
                               │ IPC Push (CompanionPresentation)
┌──────────────────────────────▼──────────────────────────────┐
│              UNTRUSTED COMPANION RENDERER                   │
│          BrowserWindow (100% transparent, frameless)        │
│   Preload: companionPreload.ts (No nodeIntegration)          │
│   Component: CompanionApp.tsx (Living Creature & Bubbles)   │
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

Alicia's companion engine (`aliciaCompanion`) exposes a read-only observability tap (`subscribeObservability`). `DesktopPresenceService` subscribes to these updates and translates presence events into visual states.

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

In FASE 2, the renderer container background is completely transparent. The animal creature is rendered directly over the OS desktop with ambient glow shadows.

---

## 6. PROCESS ISOLATION & CONTEXT BRIDGE STRATEGY

To ensure complete safety against untrusted script execution or renderer compromise:

- `sandbox: true`
- `contextIsolation: true`
- `nodeIntegration: false`

The companion window runs under its own dedicated preload script (`src/preload/companionPreload.ts`).

---

## 7. COMPANION PRELOAD & RENDERER BOUNDARIES

The companion preload exposes ONLY `window.companionBridge` containing safe presentation bridge methods:

```typescript
export interface CompanionBridgeAPI {
  onSnapshot: (callback: (snapshot: CompanionPresentation) => void) => () => void;
  onSetState: (callback: (state: CompanionVisualState) => void) => () => void;
  positionChanged: (pos: CompanionPosition) => void;
  open: () => void;
  triggerBubble: (text: string) => void;
  dismissBubble: () => void;
  setMode: (mode: CompanionMode) => void;
  hide: () => void;
}
```

It explicitly omits all file system, terminal, PTY, ledger, CIMA, and main-window IPC channels.

---

## 8. DESKTOPPRESENCESERVICE LIFECYCLE & STATE MODEL

`DesktopPresenceService` manages:
1. Mode transitions (`OFF`, `MINI`, `COMPANY`, `FOCUS`, `PAUSED`).
2. Window instantiation and teardown.
3. Verified runtime fact tap (`triggerVerifiedRuntimeFact`).
4. Display boundary validation (`ensureOnScreen`).
5. Persistence of companion positions (`desktopCompanion.position.<agentId>`).
6. Safe snapshot generation (`getPresentation`).

---

## 9. COMPANION MODES

| Mode | Description | Window State |
|---|---|---|
| `OFF` | Companions hidden completely | Window hidden / closed |
| `MINI` | Single primary companion (Alicia) | Floating creature mini (340x340) |
| `COMPANY` | Multi-agent desktop roster | Max visible companions = 3 |
| `FOCUS` | Active phase agent (e.g. `el-beni` during BUILD) | Focused active agent |
| `PAUSED` | Temporarily frozen state | Frozen visuals |

---

## 10. COMPANION VISUAL STATES & ANIMATIONS

- `IDLE`: Gentle breathing / floating bobbing animation (`idle`).
- `WALKING`: Slow pacing motion across window bounds (`walk`).
- `SLEEPING`: Low activity / dormant state with floating `zZz` particles (`sleep`).
- `THINKING`: Glowing aura pulse + subtle rotation (`think`).
- `WORKING`: Active pulse + tool indicator (`work`).
- `CELEBRATING`: Bouncy sparkle animation (`celebrate`).
- `SUGGESTING`: Proposing action to user (`think`).
- `CONCERNED`: Amber warning glow + side-to-side shake (`concern`).
- `ATTENTION` / `NOTIFYING`: Energetic bounce + pink notification glow (`attention`).
- `OFFLINE`: Dormant state (`offline`).

---

## 11. TAMAGOTCHI MOOD LAYER

`CompanionMood` adds visual personality expression without affecting CIMA or governance authority:

- `HAPPY`: Content, cheerful glow.
- `CURIOUS`: Observant, interested gaze.
- `FOCUSED`: Deep work mode.
- `CALM`: Relaxed desktop presence.
- `SLEEPY`: Dormant pre-sleep state.
- `EXCITED`: Task success / celebration.

---

## 12. ANIMAL AVATAR SYSTEM & SPECIES MAPPING

Each agent in La Pitaya maps to a unique animal species:

| Agent | Species | Emoji | Color | Role | Personality |
|---|---|---|---|---|---|
| `alicia` | Fox | 🦊 | `#E65100` | AI Companion | Curious, friendly, smart, calm |
| `el-inge` | Beaver | 🦫 | `#795548` | Orchestrator | Methodical, leader |
| `el-beni` | Cat | 🐱 | `#FF9800` | Builder | Energetic, practical |
| `valentin` | Owl | 🦉 | `#3F51B5` | Architect | Wise, observant |
| `margarito` | Hamster | 🐹 | `#8D6E63` | Tester | Meticulous, alert |
| `jose-juan` | Turtle | 🐢 | `#2E7D32` | Auditor | Careful, deliberate |
| `el-tutu` | Rabbit | 🐰 | `#9E9E9E` | Learner | Quick, eager |

---

## 13. SPEECH BUBBLES & INTERACTION (`CompanionSpeechBubble`)

Clicking a companion toggles a glassmorphic Speech Bubble overlay containing:

- **Verified Facts**: Quotes derived strictly from runtime facts ("El build terminó", "Margarito ejecutando pruebas").
- **Interactive Action Menu**:
  - 💬 **Hablar**: Triggers friendly companion response.
  - 🚀 **Abrir La Pitaya**: Focuses the main application window.
  - ⚙️ **Galería Dev**: Toggles the development/preview gallery drawer.
  - 🙈 **Ocultar**: Hides the desktop companion.

---

## 14. EVENT-DRIVEN VISUAL REACTIONS

`DesktopPresenceService.triggerVerifiedRuntimeFact()` maps real runtime facts to visual reactions:

- `BUILD_STARTED` → `el-beni` (WORKING)
- `BUILD_COMPLETED` → `alicia` (CELEBRATING: "El build terminó con éxito.")
- `TEST_STARTED` → `margarito` (WORKING)
- `TEST_COMPLETED` → `margarito` (CELEBRATING)
- `AUDIT_STARTED` → `jose-juan` (WORKING)
- `AUDIT_COMPLETED` → `jose-juan` (CELEBRATING)
- `REQUEST_PENDING` / `HUMAN_APPROVAL_REQUIRED` → `alicia` (ATTENTION: "Hay una solicitud que necesita tu confirmación.")

Unverified or fake runtime events are strictly ignored.

---

## 15. THREAT MODEL & ADVERSARIAL SECURITY CONTROLS

- **Threat**: Renderer script attempts to execute tools or approve CIMA tasks.
  - **Mitigation**: Preload bridge rejects non-allowlisted IPC. `isGovernanceIpcChannel()` drops any payload with `approve`, `execute`, `risk`, `tokens`, etc.
- **Threat**: Data leak of CIMA ledger or HMAC secrets.
  - **Mitigation**: `CompanionPresentation` projection strips all governance fields.
- **Threat**: Fake runtime event injection.
  - **Mitigation**: Unverified events do not invent runtime facts or governance state.

---

## 16. ACCESSIBILITY & PREFERENCES

Supported preferences in `CompanionPreferences`:

- `soundEnabled`: boolean (default `false`)
- `reducedMotion`: boolean (disables CSS bouncy keyframe animations)
- `maxVisibleCompanions`: number (default `3`)

---

## 17. VERIFICATION & TEST SUITE STRATEGY

The expanded test suite ([`test/lapitaya-desktop-companions.test.cjs`](file:///c:/PitayaCode/LaPitaya/test/lapitaya-desktop-companions.test.cjs)) implements **58 total tests**:

- **`COMP-01` to `COMP-25`**: FASE 1 Presence Foundation tests.
- **`COMP-26` to `COMP-50`**: FASE 2 Living Desktop Experience tests (transparent window, idle/work/celebrate/sleep/attention animations, verified facts, speech bubbles, accessibility, multi-agent limits).
- **`ADV-01` to `ADV-08`**: Adversarial security tests.

Run full suite:
```bash
npm run test:companion
```

---

## 18. OPERATIONAL REFERENCE & IPC CHANNEL TABLE

| Channel | Direction | Payload | Description |
|---|---|---|---|
| `lapitaya:companion:snapshot` | Main → Companion | `CompanionPresentation` | Pushes current companion state & positions |
| `lapitaya:companion:setState` | Main → Companion | `CompanionVisualState` | Pushes immediate visual state change |
| `lapitaya:companion:positionChanged` | Companion → Main | `{ x, y }` | Notifies main process of user drag |
| `lapitaya:companion:openMain` | Companion → Main | `void` | Focuses primary La Pitaya app window |
| `lapitaya:companion:triggerBubble` | Companion → Main | `string` | Triggers a contextual speech bubble |
| `lapitaya:companion:dismissBubble` | Companion → Main | `void` | Dismisses current speech bubble |
| `lapitaya:companion:setMode` | Companion → Main | `CompanionMode` | Switches companion mode |
| `lapitaya:companion:hide` | Companion → Main | `void` | Hides companion window |
