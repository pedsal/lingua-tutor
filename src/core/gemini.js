// ============================================================
//  Client Gemini — chiama Google Gemini DIRETTAMENTE dal browser con la chiave
//  personale dell'utente (BYOK). Nessun server: ognuno usa la propria quota
//  gratuita e la chiave resta sul dispositivo (esclusa dai backup).
//  Adattato da Dojo_V5 (tutor.js), generalizzato per un system prompt arbitrario.
// ============================================================
import { S, usage, bumpUsage } from './store.js';

export const MODELS = [
  { id: 'auto', label: 'Automatico (consigliato)' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite — più domande/giorno' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash — risposte migliori' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash — generazione precedente' },
];
const AUTO_CHAIN = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash'];

export const LEN = {
  breve: { tokens: 1500, hint: 'Keep the reply very concise (max ~80 words).' },
  media: { tokens: 2600, hint: 'Keep the reply concise (max ~160 words).' },
  lunga: { tokens: 4200, hint: 'You may go longer if useful (max ~380 words), staying clear and well organised.' },
};

export function apiKey() { return (S().cfg.geminiKey || '').trim(); }
export function configured() { return !!apiKey(); }

function genConfig(model, tokens) {
  const base = { temperature: 0.6, maxOutputTokens: tokens, topP: 0.95 };
  if (/^gemini-[3-9]/.test(model) || /latest$/.test(model)) return { ...base, thinkingConfig: { thinkingLevel: 'minimal' } };
  if (/^gemini-2\.5/.test(model)) return { ...base, thinkingConfig: { thinkingBudget: 0 } };
  return base;
}

const RETRY = new Set([429, 404, 500, 502, 503]);

// messages: [{ role:'user'|'model', text }]
// opts: { system, len, noCount, temperature, json, schema }
export async function ask(messages, opts = {}) {
  const key = apiKey();
  if (!key) throw new Error('MISSING_KEY');
  const u = usage();
  if (!opts.noCount && u.max && u.used >= u.max) throw new Error(`LIMIT:${u.max}`);

  const len = opts.len || S().cfg.tutorLen || 'media';
  const L = LEN[len] || LEN.media;
  const sel = S().cfg.geminiModel || 'auto';
  const models = sel && sel !== 'auto' ? [sel] : AUTO_CHAIN;

  const systemText = `${opts.system || ''}\n\n- ${L.hint}`.trim();
  const contents = messages.filter((m) => m && m.text)
    .map((m) => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: String(m.text).slice(0, 4000) }] }));

  const call = async (model, noThinking) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
    const gc = noThinking ? { temperature: opts.temperature ?? 0.6, maxOutputTokens: L.tokens, topP: 0.95 } : genConfig(model, L.tokens);
    if (opts.temperature != null) gc.temperature = opts.temperature;
    if (opts.json) { gc.responseMimeType = 'application/json'; if (opts.schema) gc.responseSchema = opts.schema; }
    const payload = { systemInstruction: { parts: [{ text: systemText }] }, contents, generationConfig: gc };
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal });
      const data = await r.json().catch(() => ({}));
      return { r, data };
    } finally { clearTimeout(to); }
  };

  let lastErr = { status: 502, msg: 'Errore Gemini.' };
  for (const model of models) {
    let r, data;
    try { ({ r, data } = await call(model, false)); }
    catch (e) { lastErr = { status: 503, msg: 'timeout/rete' }; continue; }
    if (r.status === 400) {
      try { ({ r, data } = await call(model, true)); }
      catch (e) { lastErr = { status: 503, msg: 'timeout/rete' }; continue; }
    }
    if (!r.ok) {
      lastErr = { status: r.status, msg: (data && data.error && data.error.message) || `Errore Gemini (${r.status}).` };
      if (RETRY.has(r.status)) continue;
      if (r.status === 403 || r.status === 401) throw new Error('BAD_KEY');
      throw new Error(lastErr.msg);
    }
    const cand = data.candidates && data.candidates[0];
    const text = cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || '').join('').trim() : '';
    if (!opts.noCount) bumpUsage();
    if (!text) {
      const why = cand && cand.finishReason && cand.finishReason !== 'STOP' ? ` (${cand.finishReason})` : '';
      return `…${why}`;
    }
    return text;
  }
  const s = lastErr.status, m = lastErr.msg || '';
  if (s === 429) throw new Error('QUOTA');
  if (s === 503 || s === 500 || /demand|overload|unavailable/i.test(m)) throw new Error('OVERLOAD');
  if (/network|failed to fetch/i.test(m)) throw new Error('OFFLINE');
  throw new Error(m);
}

// Come ask(), ma richiede output JSON conforme a `schema` e restituisce l'oggetto
// già parsato. Se il modello non produce JSON valido, lancia PARSE.
export async function askJSON(messages, opts = {}) {
  const raw = await ask(messages, { ...opts, json: true });
  const s = String(raw || '').trim().replace(/^```json|```$/g, '').trim();
  try { return JSON.parse(s); }
  catch (e) {
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e2) {} }
    throw new Error('PARSE');
  }
}
