'use strict';
/**
 * FASE 2.1 live-agent gate — read-only observer.
 * Tails the REAL hive ledger and, on every companion-relevant runtime event, captures every visible
 * companion window (OS screenshot, per-monitor DPI aware). It never writes to the hive.
 *   node watch_ledger.cjs <ledgerPath> <scratchScriptsDir>
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const [ledger, scripts] = process.argv.slice(2);
const OUT = path.join(__dirname, 'captures');
fs.mkdirSync(OUT, { recursive: true });
const timelineFile = path.join(__dirname, 'timeline.jsonl');
let offset = fs.statSync(ledger).size;
let seq = Number(process.env.SEQ_START || 0);
let busy = false;

const ps = (file, args) => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(scripts, file), ...args], { encoding: 'utf8' });

function companionRects() {
  return ps('pm_wins.ps1', []).split('\n').map((l) => l.trim()).filter(Boolean).flatMap((l) => {
    const m = /rect=(-?\d+),(-?\d+),(-?\d+),(-?\d+)/.exec(l);
    if (!m) return [];
    const [x1, y1, x2, y2] = m.slice(1).map(Number);
    const w = x2 - x1, h = y2 - y1;
    return w === h && (w === 340 || w === 510) ? [{ x: x1, y: y1, w }] : [];
  });
}

function relevant(e) {
  if (e.kind === 'cima' || e.kind === 'cima-assignment' || e.kind === 'request') return true;
  if (e.kind === 'governance') return !['ALLOW', 'SUPERVISED'].includes(e.decision ?? e.eventType);
  return false;
}

function summarize(e) {
  const { evidence, eventMac, eventHash, previousEventHash, reasons, ...r } = e;
  return { ...r, evidence: Array.isArray(evidence) ? evidence.map((x) => ({ type: x.type, source: String(x.source).slice(0, 120), verified: x.verified })) : undefined, reasons: Array.isArray(reasons) ? reasons.map((s) => String(s).slice(0, 200)) : undefined };
}

async function capture(label, event) {
  // v2: ONE screenshot of the union of all companion windows (~1.5 s after the event), so short-lived
  // bubbles (6 s) are not missed; then per-window shots at ~4 s for detail.
  const n = String(++seq).padStart(3, '0');
  const shots = [];
  await new Promise((r) => setTimeout(r, 600));
  const rects = companionRects();
  if (rects.length) {
    const x1 = Math.min(...rects.map((r) => r.x)), y1 = Math.min(...rects.map((r) => r.y));
    const x2 = Math.max(...rects.map((r) => r.x + r.w)), y2 = Math.max(...rects.map((r) => r.y + r.w));
    const file = `${n}-${label}-union-${x1}_${y1}.png`;
    try { ps('pm_shot.ps1', ['-out', path.join(OUT, file), '-x', String(x1), '-y', String(y1), '-w', String(x2 - x1), '-h', String(y2 - y1)]); shots.push(file); } catch (err) { shots.push(`ERR ${err.message}`); }
  }
  for (const r of rects) {
    const file = `${n}-${label}-win-${r.x}_${r.y}.png`;
    try { ps('pm_shot.ps1', ['-out', path.join(OUT, file), '-x', String(r.x), '-y', String(r.y), '-w', String(r.w), '-h', String(r.w)]); shots.push(file); } catch (err) { shots.push(`ERR ${err.message}`); }
  }
  fs.appendFileSync(timelineFile, JSON.stringify({ seq: n, at: new Date().toISOString(), label, event: summarize(event), shots }) + '\n');
  console.log(`[${n}] ${label} → ${shots.length} shots`);
}

setInterval(async () => {
  if (busy) return;
  const size = fs.statSync(ledger).size;
  if (size <= offset) return;
  busy = true;
  try {
    const fd = fs.openSync(ledger, 'r');
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl < 0) return;
    offset += Buffer.byteLength(text.slice(0, lastNl + 1));
    for (const line of text.slice(0, lastNl).split('\n').filter(Boolean)) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (!relevant(e)) continue;
      const label = [e.kind, e.phase, e.verdict ?? e.decision ?? e.eventType ?? e.transition, e.agentId ?? e.to].filter(Boolean).join('_').replace(/[^\w-]+/g, '-').slice(0, 80);
      await capture(label, e);
    }
  } finally {
    busy = false;
  }
}, 300);
console.log(`watching ${ledger} from byte ${offset}`);
