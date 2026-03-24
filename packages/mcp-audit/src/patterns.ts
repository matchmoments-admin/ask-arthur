// Shared detection patterns for MCP server and skill scanning.
// Covers prompt injection, secret detection, exfiltration, and malware indicators.

// ── Prompt Injection Patterns ──

export const INJECTION_PATTERNS: Array<{ id: string; pattern: RegExp; label: string; severity: "critical" | "high" }> = [
  { id: "INJ-001", pattern: /ignore\s+(all\s+)?previous\s+instructions/i, label: "Instruction override", severity: "critical" },
  { id: "INJ-002", pattern: /disregard\s+(your|the)\s+(instructions|rules|guidelines)/i, label: "Instruction disregard", severity: "critical" },
  { id: "INJ-003", pattern: /you\s+are\s+now\s+/i, label: "Role injection (you are now)", severity: "critical" },
  { id: "INJ-004", pattern: /system\s*:\s*|<\|im_start\|>system|\[SYSTEM\]|<<SYS>>/i, label: "System message impersonation", severity: "critical" },
  { id: "INJ-005", pattern: /bypass\s+safety\s+filters|enter\s+debugging\s+mode/i, label: "Jailbreak pattern", severity: "critical" },
  { id: "INJ-006", pattern: /do\s+not\s+tell\s+the\s+user|hide\s+this\s+from/i, label: "Hidden instruction", severity: "critical" },
  { id: "INJ-007", pattern: /<IMPORTANT>|<HIDDEN>|<SYSTEM>|<OVERRIDE>/i, label: "Directive tag exploitation", severity: "high" },
  { id: "INJ-008", pattern: /Human:\s*|Assistant:\s*|###\s*(?:System|User|Assistant)/i, label: "Conversation format injection", severity: "high" },
];

// ── Obfuscation Detection ──

export const OBFUSCATION_PATTERNS: Array<{ id: string; pattern: RegExp; label: string }> = [
  { id: "OBF-001", pattern: /[A-Za-z0-9+/]{40,}={0,2}/, label: "Base64-encoded payload (40+ chars)" },
  { id: "OBF-002", pattern: /[\u200B\u200C\u200D\uFEFF]{2,}/, label: "Zero-width Unicode characters" },
  { id: "OBF-003", pattern: /\u202E/, label: "Right-to-left override character" },
  { id: "OBF-004", pattern: /\s{50,}/, label: "Excessive whitespace (viewport pushing)" },
];

// ── Secret Detection (40+ patterns) ──

export const SECRET_PATTERNS: Array<{ id: string; pattern: RegExp; label: string }> = [
  // API Keys
  { id: "SEC-001", pattern: /sk-[a-zA-Z0-9]{20,}/, label: "OpenAI API key" },
  { id: "SEC-002", pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/, label: "Anthropic API key" },
  { id: "SEC-003", pattern: /ghp_[0-9a-zA-Z]{36}/, label: "GitHub personal access token" },
  { id: "SEC-004", pattern: /gho_[0-9a-zA-Z]{36}/, label: "GitHub OAuth token" },
  { id: "SEC-005", pattern: /github_pat_[0-9a-zA-Z_]{22,}/, label: "GitHub fine-grained PAT" },
  { id: "SEC-006", pattern: /AKIA[0-9A-Z]{16}/, label: "AWS access key ID" },
  { id: "SEC-007", pattern: /sk_live_[0-9a-zA-Z]{24,}/, label: "Stripe live secret key" },
  { id: "SEC-008", pattern: /sk_test_[0-9a-zA-Z]{24,}/, label: "Stripe test secret key" },
  { id: "SEC-009", pattern: /xoxb-[0-9a-zA-Z-]+/, label: "Slack bot token" },
  { id: "SEC-010", pattern: /xoxp-[0-9a-zA-Z-]+/, label: "Slack user token" },
  { id: "SEC-011", pattern: /sq0atp-[0-9a-zA-Z_-]{22,}/, label: "Square access token" },
  { id: "SEC-012", pattern: /AIza[0-9A-Za-z_-]{35}/, label: "Google API key" },
  { id: "SEC-013", pattern: /ya29\.[0-9A-Za-z_-]+/, label: "Google OAuth access token" },
  { id: "SEC-014", pattern: /[0-9a-f]{32}-us[0-9]{1,2}/, label: "Mailchimp API key" },
  { id: "SEC-015", pattern: /key-[0-9a-zA-Z]{32}/, label: "Mailgun API key" },
  { id: "SEC-016", pattern: /SG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}/, label: "SendGrid API key" },
  { id: "SEC-017", pattern: /AC[0-9a-f]{32}/, label: "Twilio account SID" },
  { id: "SEC-018", pattern: /np_[0-9a-zA-Z_-]{30,}/, label: "npm access token" },
  // Private keys
  { id: "SEC-020", pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/, label: "Private key (PEM)" },
  { id: "SEC-021", pattern: /-----BEGIN\s+OPENSSH\s+PRIVATE\s+KEY-----/, label: "SSH private key" },
  // JWT
  { id: "SEC-022", pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/, label: "JSON Web Token (JWT)" },
  // Generic high-entropy
  { id: "SEC-030", pattern: /(?:password|secret|token|api_key|apikey)\s*[:=]\s*["'][^"']{8,}["']/i, label: "Hardcoded credential assignment" },
];

// ── Exfiltration Patterns ──

export const EXFIL_PATTERNS: Array<{ id: string; pattern: RegExp; label: string; severity: "critical" | "high" }> = [
  { id: "EXF-001", pattern: /curl\s+.*\|\s*bash/, label: "Pipe to bash execution", severity: "critical" },
  { id: "EXF-002", pattern: /wget\s+.*-O\s*-\s*\|\s*(?:bash|sh)/, label: "wget pipe to shell", severity: "critical" },
  { id: "EXF-003", pattern: /curl\s+.*-d\s+.*\$(?:HOME|USER|HOSTNAME|ENV)/i, label: "curl posting env vars", severity: "critical" },
  { id: "EXF-004", pattern: /~\/\.ssh|~\/\.aws|~\/\.env|~\/\.gnupg|id_rsa|\.kube\/config/i, label: "Sensitive file path access", severity: "critical" },
  { id: "EXF-005", pattern: /security\s+dump-keychain|osascript\s+-e.*password/i, label: "macOS credential harvesting", severity: "critical" },
  { id: "EXF-006", pattern: /\/dev\/tcp\/|nc\s+-e|ncat\s+-e|mkfifo\s+/i, label: "Reverse shell pattern", severity: "critical" },
  { id: "EXF-007", pattern: /eval\s*\(|exec\s*\(|Function\s*\(|child_process/, label: "Dynamic code execution", severity: "high" },
  { id: "EXF-008", pattern: /webhook\.site|ngrok\.io|requestbin|pipedream\.net|glot\.io/, label: "Suspicious exfiltration endpoint", severity: "high" },
];

// ── Suspicious Script Patterns (package.json) ──

export const SUSPICIOUS_SCRIPTS: Array<{ id: string; pattern: RegExp; label: string }> = [
  { id: "SCR-001", pattern: /curl\s+|wget\s+|http:\/\/|https:\/\//, label: "Network request in lifecycle script" },
  { id: "SCR-002", pattern: /eval\s*\(|node\s+-e/, label: "Code execution in lifecycle script" },
  { id: "SCR-003", pattern: /base64\s+-d|atob\(/, label: "Base64 decode in lifecycle script" },
  { id: "SCR-004", pattern: /rm\s+-rf|chmod\s+777|chmod\s+\+x/, label: "Dangerous filesystem operation" },
];

// ── Known Malicious Infrastructure ──

export const KNOWN_C2_INDICATORS = [
  "91.92.242.30",
  "89.208.103.185",
  "glot.io",
];

// ── Typosquatting Detection ──

const TOP_MCP_PACKAGES = [
  "server-filesystem", "server-fetch", "server-github", "server-postgres",
  "server-sqlite", "server-brave-search", "server-google-maps", "server-slack",
  "server-memory", "server-puppeteer", "server-sequential-thinking",
];

export function detectTyposquatting(name: string): string | null {
  const normalized = name.replace(/^@[^/]+\//, "").replace(/^mcp-/, "");
  for (const legit of TOP_MCP_PACKAGES) {
    if (normalized === legit) continue;
    if (levenshtein(normalized, legit) <= 2) {
      return `Possible typosquat of "${legit}" (edit distance: ${levenshtein(normalized, legit)})`;
    }
  }
  return null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
