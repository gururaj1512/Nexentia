/**
 * WAF — Pattern Library & Detection Engine
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides:
 *   detectSqlInjection(value)  → { matched: bool, pattern: string } | null
 *   detectXss(value)           → { matched: bool, pattern: string } | null
 *   flattenValues(obj)         → [{ field, value }]
 *   scanPayload(data, cfg)     → { blocked, type, field, pattern, payload } | null
 *
 * All patterns are compiled once at module load so hot-path overhead is minimal.
 */

// ── SQL Injection Signatures ───────────────────────────────────────────────
// Each entry: { label, re } — label is shown in the WAF incident log.
const SQL_RULES = [
  {
    label: 'Classic OR bypass',
    re: /'\s*or\s*'[\w\d]+'\s*=\s*'[\w\d]+/i,
  },
  {
    label: 'Numeric OR bypass',
    re: /'\s*or\s+\d+\s*=\s*\d+/i,
  },
  {
    label: 'UNION SELECT exfil',
    re: /\bunion\b[\s\S]{0,40}\bselect\b/i,
  },
  {
    label: 'Stacked statement (semicolon)',
    re: /;\s*(drop|delete|update|insert|create|alter|truncate|exec)\b/i,
  },
  {
    label: 'DROP / TRUNCATE statement',
    re: /\b(drop|truncate)\s+(table|database|schema)\b/i,
  },
  {
    label: 'SQL comment terminator',
    re: /(--|#)[\s]*$/,
  },
  {
    label: 'Block comment obfuscation',
    re: /\/\*[\s\S]*?\*\//,
  },
  {
    label: 'MSSQL dangerous procs',
    re: /\b(xp_cmdshell|sp_executesql|sp_makewebtask|openrowset)\b/i,
  },
  {
    label: 'Hex-encoded payload',
    re: /0x[0-9a-f]{4,}/i,
  },
  {
    label: 'Type-cast / char functions',
    re: /\b(cast|convert|char|nchar|varchar)\s*\(/i,
  },
  {
    label: 'Time-based blind injection',
    re: /\b(benchmark|sleep|pg_sleep|waitfor\s+delay)\s*\(/i,
  },
  {
    label: 'File read/write',
    re: /\b(load_file|into\s+outfile|into\s+dumpfile)\b/i,
  },
  {
    label: 'Information schema probe',
    re: /\binformation_schema\b/i,
  },
  {
    label: 'Conditional error injection',
    re: /\b(if|iif)\s*\([\s\S]{0,60}(select|update|delete)/i,
  },
];

// ── XSS Signatures ────────────────────────────────────────────────────────
const XSS_RULES = [
  {
    label: '<script> tag',
    re: /<\s*script[\s\S]*?>/i,
  },
  {
    label: 'javascript: URI',
    re: /javascript\s*:/i,
  },
  {
    label: 'Inline event handler (onXxx=)',
    re: /\bon\w{2,20}\s*=\s*["']?[^"'\s>]{1,200}/i,
  },
  {
    label: '<iframe> / <frame>',
    re: /<\s*(i?frame|embed|object)\b/i,
  },
  {
    label: '<img> with JS src',
    re: /<\s*img\b[^>]*src\s*=\s*["']?\s*(javascript|data\s*:)/i,
  },
  {
    label: 'eval() call',
    re: /\beval\s*\(/i,
  },
  {
    label: 'document.cookie / document.write',
    re: /document\s*\.\s*(cookie|write|location)/i,
  },
  {
    label: 'SVG onload vector',
    re: /<\s*svg\b[\s\S]*?\bon\w+\s*=/i,
  },
  {
    label: 'CSS expression()',
    re: /\bexpression\s*\(/i,
  },
  {
    label: 'vbscript: URI',
    re: /vbscript\s*:/i,
  },
  {
    label: 'data:text/html exfil',
    re: /data\s*:\s*text\/html/i,
  },
  {
    label: 'URL-encoded <script',
    re: /(%3c|&#x3c;|&#60;)\s*script/i,
  },
  {
    label: 'HTML entity evasion chain',
    re: /&#\d{2,4};.*&#\d{2,4};/,
  },
  {
    label: '<link> / <meta> injection',
    re: /<\s*(link|meta|base)\b/i,
  },
];

// ── Detection functions ────────────────────────────────────────────────────

/**
 * Test a single string value against SQL injection rules.
 * @param {string} value
 * @returns {{ rule: string } | null}
 */
function detectSqlInjection(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  for (const { label, re } of SQL_RULES) {
    if (re.test(value)) return { rule: label };
  }
  return null;
}

/**
 * Test a single string value against XSS rules.
 * @param {string} value
 * @returns {{ rule: string } | null}
 */
function detectXss(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  for (const { label, re } of XSS_RULES) {
    if (re.test(value)) return { rule: label };
  }
  return null;
}

/**
 * Recursively walk any value and collect { field, value } pairs for scanning.
 * Arrays and nested objects are flattened with dotted / bracket notation.
 *
 * @param {*}      obj
 * @param {string} [prefix]
 * @returns {{ field: string, value: string }[]}
 */
function flattenValues(obj, prefix = '') {
  if (obj === null || obj === undefined) return [];
  const type = typeof obj;

  if (type === 'string' || type === 'number' || type === 'boolean') {
    return [{ field: prefix || 'value', value: String(obj) }];
  }
  if (Array.isArray(obj)) {
    return obj.flatMap((item, i) =>
      flattenValues(item, prefix ? `${prefix}[${i}]` : `[${i}]`),
    );
  }
  if (type === 'object') {
    return Object.entries(obj).flatMap(([k, v]) =>
      flattenValues(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [];
}

/**
 * Scan a flat record of { field, value } pairs.
 * Returns the FIRST hit found, or null if clean.
 *
 * @param {{ field: string, value: string }[]} pairs
 * @param {{ block_sql_injection: bool, block_xss: bool }} cfg
 * @returns {{ type: string, field: string, rule: string, payload: string } | null}
 */
function scanPairs(pairs, cfg) {
  for (const { field, value } of pairs) {
    if (cfg.block_sql_injection) {
      const hit = detectSqlInjection(value);
      if (hit) {
        return {
          type:    'SQL_INJECTION',
          field,
          rule:    hit.rule,
          payload: value.slice(0, 200),
        };
      }
    }
    if (cfg.block_xss) {
      const hit = detectXss(value);
      if (hit) {
        return {
          type:    'XSS',
          field,
          rule:    hit.rule,
          payload: value.slice(0, 200),
        };
      }
    }
  }
  return null;
}

module.exports = { detectSqlInjection, detectXss, flattenValues, scanPairs, SQL_RULES, XSS_RULES };
