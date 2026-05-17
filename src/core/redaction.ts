const REDACTED = "[redacted]";

const SAFE_OPERATOR_KEYS = new Set([
  "artifactid",
  "browsermsused",
  "cachedtokens",
  "capability",
  "completiontokens",
  "contenttype",
  "credentialtype",
  "errorcode",
  "errorkey",
  "inputtokens",
  "jobid",
  "operationid",
  "outputtokens",
  "prompttokens",
  "requestid",
  "runid",
  "stage",
  "status",
  "tokencount",
  "tokenkind",
  "tokensused",
  "totaltokens",
  "traceid"
]);

const SENSITIVE_KEY_PATTERNS = [
  /^authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /(^|[-_])token$/i,
  /(^|[-_])secret($|[-_])/i,
  /password/i,
  /^credential$/i,
  /^credentials$/i,
  /^api[-_]?key$/i,
  /(^|[-_])api[-_]?key$/i,
  /^private[-_]?key$/i,
  /^refresh[-_]?token$/i,
  /^access[-_]?token$/i,
  /^presigned[-_]?url$/i,
  /^signature$/i,
  /^fileBase64$/i,
  /^code$/i,
  /^content$/i,
  /^descriptor$/i,
  /^descriptorSetup$/i,
  /^setupTasks$/i
];

const SENSITIVE_STRING_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /[?&]X-Amz-Signature=[^&\s]+/i,
  /\btok_[A-Za-z0-9._-]+/i,
  /\bsk-[A-Za-z0-9._-]+/i,
  /\b(token|secret|api[-_ ]?key)\s*[:=]\s*\S+/i
];

function isSensitiveKey(key: string): boolean {
  if (SAFE_OPERATOR_KEYS.has(normalizeKey(key))) return false;
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isCanonicalOperationDiagnosticsCode(path: readonly string[]): boolean {
  if (path.length < 4) return false;
  const tail = path.slice(-4);
  return tail[0] === "structuredContent"
    && tail[1] === "operation"
    && tail[2] === "diagnostics"
    && /^code$/i.test(tail[3] ?? "");
}

export function redactForOutput(value: unknown, keyHint?: string, path: readonly string[] = []): unknown {
  if (keyHint && isSensitiveKey(keyHint) && !isCanonicalOperationDiagnosticsCode(path)) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redactForOutput(item, undefined, path));
  if (typeof value === "string" && SENSITIVE_STRING_PATTERNS.some((pattern) => pattern.test(value))) {
    return REDACTED;
  }
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = redactForOutput(nested, key, [...path, key]);
  }
  return output;
}
