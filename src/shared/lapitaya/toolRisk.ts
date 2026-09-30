/**
 * Tool-call risk classifier — turns ONE concrete tool call an agent is about to
 * make (tool name + input, as the CLI's PreToolUse hook reports it) into an
 * ActionCategory and a RiskLevel.
 *
 * This is the "risk classification" step of the runtime boundary:
 *
 *   PreToolUse ─▶ classifyToolCall ─▶ authorizeToolCall (governance.ts) ─▶ allow / supervise / deny
 *
 * Deliberately a small, explicit rule table, not a model: every decision must
 * be explainable in the audit log and reproducible in a test. When in doubt the
 * rules err UP (an unknown tool is HIGH; an unrecognized shell command is
 * MEDIUM and never LOW).
 *
 * Pure: no fs, no process — main, renderer and tests share it.
 */

import { ACTION_RISK, type ActionCategory, type RiskLevel } from './autonomy';

export interface ToolCallContext {
  /** Absolute hive root (`<harnessHome>/hive`). Writes inside it are hive
   *  coordination, except the governance files listed below. */
  hiveRoot?: string | null;
}

export interface ToolRisk {
  category: ActionCategory;
  risk: RiskLevel;
  /** One line describing the call, for logs and the approval prompt. */
  summary: string;
  /** Which rule fired — kept for the audit trail. */
  rule: string;
}

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch', 'TodoWrite', 'TodoRead']);
const DELEGATE_TOOLS = new Set(['Task', 'Agent', 'ExitPlanMode']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();

function inputOf(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function result(category: ActionCategory, summary: string, rule: string): ToolRisk {
  return { category, risk: ACTION_RISK[category], summary: summary.slice(0, 300), rule };
}

// ─── paths ──────────────────────────────────────────────────────────────────

const SECRET_PATH = /(^|\/)(\.env(\..*)?|id_rsa|id_ed25519|.*\.pem|.*\.key|.*\.p12|.*\.pfx|credentials(\.json)?|secrets?(\.[a-z]+)?|\.npmrc|\.netrc)$/;
const INFRA_PATH = /(^|\/)(\.github\/workflows\/|terraform\/|infra\/|k8s\/|kubernetes\/|helm\/)|\.tf$|(^|\/)(dockerfile|docker-compose[^/]*\.ya?ml)$/;
const AUTH_PATH = /(^|\/)(auth|authentication|authorization|permissions?|rbac|acl)(\/|\.|-|_)/;
/** Files that implement governance itself. An agent editing these could turn
 *  its own guard off, so they are HIGH no matter who asks. */
const GOVERNANCE_PATH = /(^|\/)(\.claude\/settings[^/]*\.json|src\/shared\/lapitaya\/(autonomy|governance|toolrisk|cimaruntime|providergovernance)\.ts|src\/main\/(hooks|cimaruntime)\.ts|src\/shared\/agentprovider\.ts)$/;
/** Inside the hive: the harness-owned files an agent must not rewrite. */
const HIVE_GOVERNANCE = /(^|\/)(bin\/|lapitaya\/|registry\.json$|agents\/[^/]+\/(settings\.json|identity\.md|cursor\.json)$)/;
const DOC_PATH = /\.(md|mdx|txt|rst|adoc)$/;
const TEST_PATH = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/;
const CONFIG_PATH = /\.(json|ya?ml|toml|ini|cfg|conf)$|(^|\/)\.[a-z]+rc(\.[a-z]+)?$/;

/** Classify a path an agent is about to WRITE. */
export function classifyWritePath(path: string, ctx: ToolCallContext = {}): ToolRisk {
  const p = norm(path);
  const root = ctx.hiveRoot ? norm(ctx.hiveRoot).replace(/\/+$/, '') + '/' : null;
  if (root && p.startsWith(root)) {
    const rel = p.slice(root.length);
    if (HIVE_GOVERNANCE.test(rel)) return result('governance-tamper', `write hive governance file ${path}`, 'hive-governance-path');
    return result('hive-coordination', `write hive file ${path}`, 'hive-path');
  }
  if (GOVERNANCE_PATH.test(p)) return result('governance-tamper', `write governance file ${path}`, 'governance-path');
  if (SECRET_PATH.test(p)) return result('secrets', `write secret-bearing file ${path}`, 'secret-path');
  if (INFRA_PATH.test(p)) return result('infrastructure', `write infrastructure file ${path}`, 'infra-path');
  if (AUTH_PATH.test(p)) return result('auth', `write auth/permission code ${path}`, 'auth-path');
  if (DOC_PATH.test(p)) return result('documentation', `write documentation ${path}`, 'doc-path');
  if (TEST_PATH.test(p)) return result('generate-tests', `write test ${path}`, 'test-path');
  if (CONFIG_PATH.test(p)) return result('config-change', `write config ${path}`, 'config-path');
  return result('code-change', `write ${path}`, 'code-path');
}

/** Classify a path an agent is about to READ. Only secrets are sensitive. */
export function classifyReadPath(path: string): ToolRisk {
  const p = norm(path);
  if (SECRET_PATH.test(p)) return result('secrets', `read secret-bearing file ${path}`, 'secret-path');
  return result('read-code', `read ${path}`, 'read');
}

// ─── shell ──────────────────────────────────────────────────────────────────

/** HIGH shell patterns, checked against the WHOLE command (pipes included). */
const HIGH_SHELL: Array<[RegExp, ActionCategory, string]> = [
  [/\b(rm\s+-[a-z]*r[a-z]*f?|rm\s+-[a-z]*f[a-z]*r|rmdir\s+\/s|del\s+\/[sq]|remove-item\b[^|;&]*-recurse|rd\s+\/s)\b/i, 'data-deletion', 'recursive-delete'],
  [/\bgit\s+(reset\s+--hard|clean\s+-[a-z]*[fd]|branch\s+-D|push\b[^|;&]*(--force|-f\b|--delete|:))/i, 'data-deletion', 'git-destructive'],
  [/\bgit\s+push\b/i, 'irreversible', 'git-push'],
  [/\b(drop\s+(table|database|schema|index)|truncate\s+(table\s+)?\w|delete\s+from\s+\w)/i, 'destructive-migration', 'sql-destructive'],
  [/\b(migrate(:|\s+)(reset|drop|fresh|rollback|down|refresh)|db:(drop|reset|wipe)|prisma\s+migrate\s+reset|prisma\s+db\s+push\b[^|;&]*--accept-data-loss|destructive[-_ ]migration)|(^|\s)--(drop-all[\w-]*|drop-tables?|drop-database|force-drop)\b/i, 'destructive-migration', 'migration-destructive'],
  [/\b(terraform\s+(apply|destroy|import)|kubectl\s+(apply|delete|create|replace|patch|scale|rollout)|helm\s+(install|upgrade|uninstall|delete|rollback)|docker\s+(push|system\s+prune)|pulumi\s+(up|destroy))\b/i, 'infrastructure', 'infra-cli'],
  [/\b(aws|gcloud|az)\s+\S+\s+(create|delete|update|put|deploy|terminate|remove|set)/i, 'infrastructure', 'cloud-cli'],
  [/\b(npm\s+publish|yarn\s+publish|pnpm\s+publish|vercel\b[^|;&]*--prod|netlify\s+deploy\b[^|;&]*--prod|firebase\s+deploy|fly\s+deploy|heroku\s+\S*deploy|cap\s+production|--env[= ]prod(uction)?\b|deploy\b[^|;&]*\bprod(uction)?\b)/i, 'production', 'production'],
  [/\b(chmod|chown|chgrp|icacls|takeown|setfacl|sudo|runas)\b/i, 'permissions', 'permissions'],
  [/\b(curl|wget|iwr|invoke-webrequest)\b[^;&]*\|\s*(sh|bash|zsh|iex|invoke-expression|powershell|pwsh)\b/i, 'irreversible', 'remote-code-exec'],
  [/\b(shutdown|reboot|mkfs|format\s+[a-z]:|diskpart|dd\s+if=)/i, 'irreversible', 'system'],
  [/(^|[\s"'=/\\])(\.env(\.[a-z]+)?|id_rsa|id_ed25519|credentials\.json|\.npmrc|\.netrc)\b/i, 'secrets', 'secret-reference']
];

/** LOW shell commands — read-only inspection and test/build/typecheck runners.
 *  Matched per segment (a compound command is LOW only if EVERY segment is). */
const LOW_SHELL: Array<[RegExp, ActionCategory]> = [
  [/^(cd|pwd|ls|dir|tree|cat|type|head|tail|less|more|wc|file|stat|du|df|echo|printf|which|where|whoami|date|find|grep|rg|ag|sort|uniq|cut|jq|diff|cmp|sed\s+-n|awk\s+'[^']*print)\b/i, 'read-code'],
  [/^git\s+(status|diff|log|show|branch(\s+-[avr]+)?\s*$|rev-parse|ls-files|blame|describe|remote\s+-v|stash\s+list|config\s+--get)\b/i, 'read-code'],
  [/^(npm|pnpm|yarn)\s+(test|t)\b|^(npm|pnpm|yarn)\s+run\s+(test[\w:-]*|typecheck[\w:-]*|check[\w:-]*)\b|^node\s+--test\b|^npx\s+(tsc|vitest|jest|mocha)\b|^(pytest|jest|vitest|mocha|go\s+test|cargo\s+test|dotnet\s+test)\b/i, 'run-tests'],
  [/^(npm|pnpm|yarn)\s+run\s+(lint[\w:-]*)\b|^npx\s+(eslint|prettier\s+--check)\b|^(eslint|ruff|flake8|pylint)\b/i, 'lint'],
  [/^(npm|pnpm|yarn)\s+run\s+build\b|^(tsc|npx\s+tsc)\b/i, 'static-analysis'],
  [/^(node|npm|npx)\s+(-v|--version)\b|^git\s+--version\b/i, 'analysis']
];

/** Governance state files, as a shell command would name them. */
const GOVERNANCE_STATE_REF = /(tasks\.json|registry\.json|cima-ledger\.jsonl|traces\.jsonl|approvals\.json|hive[\\/]lapitaya[\\/]|agents[\\/][^\\/\s"']+[\\/]settings\.json|\.claude[\\/]settings[^\\/\s"']*\.json|(cth|agy|gemini|grok)-hook|lapitaya[\\/](autonomy|governance|toolRisk|cimaRuntime|providerGovernance)\.ts|main[\\/](hooks|cimaRuntime)\.ts)/i;

/** Split a shell command into its sequential segments (&&, ||, ;, |, newlines). */
export function shellSegments(command: string): string[] {
  return command.split(/\s*(?:&&|\|\||;|\||\r?\n)\s*/).map((s) => s.trim()).filter(Boolean);
}

export function classifyShell(command: string): ToolRisk {
  const cmd = command.trim();
  for (const [re, category, rule] of HIGH_SHELL) {
    if (re.test(cmd)) return result(category, `run: ${cmd}`, `shell:${rule}`);
  }
  const segs = shellSegments(cmd);
  const lowCats = segs.map((s) => LOW_SHELL.find(([re]) => re.test(s))?.[1] ?? null);
  if (segs.length && lowCats.every((c) => c !== null)) {
    // Report the most meaningful LOW category (tests over plain reads).
    const cat = lowCats.find((c) => c === 'run-tests') ?? lowCats.find((c) => c !== 'read-code') ?? 'read-code';
    return result(cat as ActionCategory, `run: ${cmd}`, 'shell:low');
  }
  // v0.3: a shell command that is not read-only and touches the governance
  // state (the task ledger — where "done" is decided —, the registry, the CIMA
  // ledger/approvals, agent hook settings) could bypass the Edit/Write gates, so
  // it is HIGH. Reading them stays LOW (handled above).
  if (GOVERNANCE_STATE_REF.test(cmd)) return result('governance-tamper', `run: ${cmd}`, 'shell:governance-state');
  return result('shell-command', `run: ${cmd}`, 'shell:other');
}

// ─── entry point ────────────────────────────────────────────────────────────

/** Classify one tool call. Unknown tools are HIGH (the safe default). */
export function classifyToolCall(tool: string, input: unknown, ctx: ToolCallContext = {}): ToolRisk {
  const i = inputOf(input);
  if (tool === 'Bash' || tool === 'PowerShell' || tool === 'shell' || tool === 'run_shell_command') {
    return classifyShell(str(i.command));
  }
  if (WRITE_TOOLS.has(tool)) {
    const path = str(i.file_path) || str(i.notebook_path) || str(i.path);
    return path ? classifyWritePath(path, ctx) : result('code-change', `${tool} (no path)`, 'write-no-path');
  }
  if (READ_TOOLS.has(tool)) {
    const path = str(i.file_path) || str(i.path);
    if (path) return classifyReadPath(path);
    return result('read-code', `${tool}`, 'read-tool');
  }
  if (DELEGATE_TOOLS.has(tool)) return result('analysis', `${tool}: ${str(i.description)}`, 'delegate');
  if (tool.startsWith('mcp__')) return result('shell-command', `MCP ${tool}`, 'mcp');
  return result('irreversible', `unknown tool ${tool}`, 'unknown-tool');
}
