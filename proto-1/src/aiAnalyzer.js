/**
 * AI Threat Analyzer
 * ─────────────────────────────────────────────────────────────────────────────
 * Hooks into WAF and rate-limit event buses, sends each blocked request to
 * Google Gemini for real-time threat analysis, and emits enriched events for
 * the /ai-events SSE stream.
 *
 * Events emitted on aiEvents:
 *   'ai:incoming'  — fires immediately when a threat is detected (before Gemini)
 *   'ai:analysis'  — fires when Gemini returns analysis for a specific threat
 *   'ai:summary'   — fires when a session summary is generated
 */

const { EventEmitter }      = require('events');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { wafEvents }         = require('./wafEvents');

const aiEvents = new EventEmitter();
aiEvents.setMaxListeners(100);

// Rolling buffer of raw threats for session summary
const threatBuffer = [];
const MAX_BUFFER   = 100;

let model = null;

// ── Init ───────────────────────────────────────────────────────────────────
function init(apiKey) {
  if (!apiKey) {
    console.warn('[AI Analyzer] GEMINI_API_KEY not set — analysis will show raw events only.');
    return;
  }
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    console.log('[AI Analyzer] Gemini 1.5 Flash ready.');
  } catch (err) {
    console.error('[AI Analyzer] Failed to init Gemini:', err.message);
  }
}

// ── Per-threat analysis ────────────────────────────────────────────────────
async function analyzeThreat(threatData) {
  if (!model) return null;

  const prompt =
    `You are a cybersecurity analyst AI embedded in a web application firewall.\n` +
    `Analyze this blocked request and return a structured threat assessment.\n\n` +
    `Blocked request:\n` +
    `  Attack type  : ${threatData.type}\n` +
    `  Source IP    : ${threatData.ip}\n` +
    `  HTTP method  : ${threatData.method}\n` +
    `  URL          : ${threatData.url}\n` +
    `  Field        : ${threatData.field  || 'N/A'}\n` +
    `  Rule hit     : ${threatData.rule   || 'N/A'}\n` +
    `  Raw payload  : ${threatData.payload || 'N/A'}\n\n` +
    `Respond with ONLY valid JSON (no markdown fences, no extra text):\n` +
    `{\n` +
    `  "severity": <integer 1-10>,\n` +
    `  "attack_name": "<specific attack name, e.g. 'Boolean-based SQL Injection'>",\n` +
    `  "intent": "<one sentence — what the attacker was trying to achieve>",\n` +
    `  "technique": "<one sentence — the exact technique or vector used>",\n` +
    `  "recommendation": "<one sentence — the single most important defensive action>"\n` +
    `}`;

  try {
    const result = await model.generateContent(prompt);
    const text   = result.response.text().trim();
    const match  = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (err) {
    console.error('[AI Analyzer] Gemini per-threat error:', err.message);
  }
  return null;
}

// ── Session summary ────────────────────────────────────────────────────────
async function generateSessionSummary() {
  if (threatBuffer.length === 0) {
    return { summary: 'No threats have been recorded in this session yet.' };
  }

  // Fall back to a simple stats object if Gemini is unavailable
  if (!model) {
    const counts = {};
    threatBuffer.forEach(t => { counts[t.type] = (counts[t.type] || 0) + 1; });
    return {
      total_attacks:   threatBuffer.length,
      threat_level:    threatBuffer.length > 20 ? 'HIGH' : threatBuffer.length > 5 ? 'MEDIUM' : 'LOW',
      dominant_attack: Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Unknown',
      summary:         `${threatBuffer.length} threats blocked this session. AI analysis disabled — set GEMINI_API_KEY.`,
      top_ips:         [],
      key_insights:    [`${threatBuffer.length} total attacks detected.`],
      recommendations: ['Enable Gemini analysis by setting GEMINI_API_KEY.'],
    };
  }

  const recent = threatBuffer.slice(-30);
  const list   = recent.map(t =>
    `  - ${t.type} | IP: ${t.ip} | ${t.method} ${t.url}${t.rule ? ' | rule: ' + t.rule : ''}`
  ).join('\n');

  const prompt =
    `You are a cybersecurity analyst writing an executive threat summary.\n` +
    `Session had ${threatBuffer.length} blocked requests. Recent sample:\n\n` +
    `${list}\n\n` +
    `Respond with ONLY valid JSON (no markdown, no extra text):\n` +
    `{\n` +
    `  "total_attacks": ${threatBuffer.length},\n` +
    `  "threat_level": "<LOW|MEDIUM|HIGH|CRITICAL>",\n` +
    `  "dominant_attack": "<most common attack category>",\n` +
    `  "summary": "<2-3 sentence executive summary — patterns, risk, what was targeted>",\n` +
    `  "top_ips": ["<up to 3 most active attacker IPs>"],\n` +
    `  "key_insights": ["<insight 1>", "<insight 2>", "<insight 3>"],\n` +
    `  "recommendations": ["<action 1>", "<action 2>"]\n` +
    `}`;

  try {
    const result = await model.generateContent(prompt);
    const text   = result.response.text().trim();
    const match  = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    return { total_attacks: threatBuffer.length, summary: 'Gemini returned an unexpected format.' };
  } catch (err) {
    console.error('[AI Analyzer] Gemini summary error:', err.message);
    throw err; // bubble up so the endpoint can surface the real message
  }
}

// ── Start subscribing to threat events ────────────────────────────────────
function start(rlEventsEmitter) {
  // WAF blocks
  wafEvents.on('waf:blocked', async (evt) => {
    const threat = { source: 'WAF', ...evt };
    _buffer(threat);

    const id = `${evt.ts}-${Math.random().toString(36).slice(2, 6)}`;
    aiEvents.emit('ai:incoming', { id, ...threat });

    const analysis = await analyzeThreat(threat);
    aiEvents.emit('ai:analysis', { id, ...threat, analysis });
  });

  // Rate-limit blocks
  if (rlEventsEmitter) {
    rlEventsEmitter.on('rl:blocked', async (evt) => {
      const threat = {
        source:  'RATE_LIMIT',
        type:    'RATE_LIMIT',
        ts:      Date.now(),
        rule:    `Rate limit exceeded on ${evt.ruleName || evt.ruleId || 'unknown rule'}`,
        payload: `${evt.count || '?'} requests in window`,
        ...evt,
      };
      _buffer(threat);

      const id = `${threat.ts}-${Math.random().toString(36).slice(2, 6)}`;
      aiEvents.emit('ai:incoming', { id, ...threat });

      const analysis = await analyzeThreat(threat);
      aiEvents.emit('ai:analysis', { id, ...threat, analysis });
    });
  }
}

function _buffer(threat) {
  threatBuffer.push(threat);
  if (threatBuffer.length > MAX_BUFFER) threatBuffer.shift();
}

module.exports = { init, start, aiEvents, generateSessionSummary, threatBuffer };