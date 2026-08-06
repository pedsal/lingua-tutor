// ============================================================
//  Storage — stato in memoria (_m), persistito su IndexedDB (localforage).
//  initStore() lo carica una volta al boot; S() lo restituisce in modo
//  sincrono; save() lo riscrive in modo asincrono (debounce).
// ============================================================
import localforage from 'localforage';

const SK = 'lingua_tutor_state';
let _m = null;
let _t = null;

localforage.config({ name: 'LinguaTutor', storeName: 'state' });

// Chiave del giorno locale (YYYY-MM-DD) per contatori e diario.
export function todayK(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
export function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

// Forma di default dello stato (idempotente: normalizza uno stato caricato).
function defaults(m) {
  if (!m || typeof m !== 'object') m = {};
  if (!m.cfg) m.cfg = {};
  const c = m.cfg;
  if (c.geminiKey === undefined) c.geminiKey = '';         // chiave BYOK, resta su questo dispositivo
  if (c.geminiKeyTTS === undefined) c.geminiKeyTTS = '';   // chiave dedicata alla voce neurale (quota separata)
  if (c.geminiModel === undefined) c.geminiModel = 'auto';
  if (/gemini-2/.test(c.geminiModel || '')) c.geminiModel = 'auto';   // rimuovi i vecchi modelli 2.x
  if (c.tutorLen === undefined) c.tutorLen = 'media';
  if (c.tutorDailyMax === undefined) c.tutorDailyMax = 80;  // tetto domande/giorno (0 = illimitato)
  if (c.tts === undefined) c.tts = true;                   // pronuncia attiva
  if (c.autoSpeak === undefined) c.autoSpeak = true;       // legge da solo le risposte del tutor
  if (c.ttsRate === undefined) c.ttsRate = 1.0;
  if (!c.ttsVoices) c.ttsVoices = {};                      // { ja:'nome voce', en:'...', it:'...' }
  if (c.ttsNeural === undefined) c.ttsNeural = false;      // voce neurale IA (Gemini TTS), opt-in
  if (c.ttsNeuralVoice === undefined) c.ttsNeuralVoice = 'Kore';
  if (c.micGemini === undefined) c.micGemini = false;      // microfono via IA Gemini (bypassa il servizio vocale di sistema)
  if (c.liveVoice === undefined) c.liveVoice = 'Kore';     // voce della modalità Conversazione live
  if (c.liveInstructions === undefined) c.liveInstructions = '';   // istruzioni extra per il tutor live
  if (c.liveMode === undefined) c.liveMode = 'tutor';       // 'tutor' (corregge) | 'assistant' (chiacchiera)
  if (c.showUsage === undefined) c.showUsage = true;        // barra con i token consumati
  if (c.uiLang === undefined) c.uiLang = 'it';             // lingua dell'interfaccia
  if (c.introSeen === undefined) c.introSeen = false;      // introduzione guidata già vista
  if (!Array.isArray(m.profiles)) m.profiles = [];
  // Migrazione: i profili giapponesi con vecchi livelli CEFR passano a JLPT.
  const CEFR2JLPT = { A1: 'N5', A2: 'N5', B1: 'N4', B2: 'N3', C1: 'N2' };
  m.profiles.forEach((p) => {
    if (!p.persona) p.persona = 'friendly';
    if (p.target === 'ja' && CEFR2JLPT[p.level]) p.level = CEFR2JLPT[p.level];
  });
  if (m.activeId === undefined) m.activeId = null;
  if (!m.convos) m.convos = {};                            // `${profileId}:${mode}` -> [{role,text,ts}]
  if (!m.diaries) m.diaries = {};                          // profileId -> [{ts,date,mode,topic,errors,summary}]
  if (!m.diarized) m.diarized = {};                        // `${profileId}:${mode}` -> lunghezza convo già riassunta
  if (!m.labs) m.labs = {};                                // profileId -> { writing:{...}, speech:{...} } (risultati laboratori)
  if (!m.daily) m.daily = { d: todayK(), n: 0 };
  return m;
}

export async function initStore() {
  let raw = null;
  try { raw = await localforage.getItem(SK); } catch (e) { raw = null; }
  _m = defaults(raw || {});
  // Migrazione soft da un eventuale backup in localStorage.
  save();
}

export function S() { return _m; }

export function save() {
  clearTimeout(_t);
  _t = setTimeout(() => { localforage.setItem(SK, _m).catch(() => {}); }, 250);
}

// ── Profili ──
export function activeProfile() {
  const m = S();
  return m.profiles.find((p) => p.id === m.activeId) || m.profiles[0] || null;
}
export function addProfile(p) {
  const prof = { id: uid(), name: p.name || 'Studente', target: p.target, expl: p.expl, level: p.level || 'A2', persona: p.persona || 'friendly' };
  S().profiles.push(prof);
  S().activeId = prof.id;
  save();
  return prof;
}
export function updateProfile(id, patch) {
  const p = S().profiles.find((x) => x.id === id);
  if (p) { Object.assign(p, patch); save(); }
  return p;
}
export function removeProfile(id) {
  const m = S();
  m.profiles = m.profiles.filter((p) => p.id !== id);
  delete m.diaries[id];
  Object.keys(m.convos).forEach((k) => { if (k.startsWith(id + ':')) delete m.convos[k]; });
  if (m.activeId === id) m.activeId = m.profiles[0] ? m.profiles[0].id : null;
  save();
}

// ── Conversazioni (per profilo + modalità) ──
export function convoKey(mode) { const p = activeProfile(); return p ? `${p.id}:${mode}` : `none:${mode}`; }
export function getConvo(mode) { const k = convoKey(mode); return S().convos[k] || (S().convos[k] = []); }
export function pushMsg(mode, role, text, data) {
  const arr = getConvo(mode);
  const msg = { role, text, ts: Date.now() };
  if (data) msg.data = data;
  arr.push(msg);
  save();
  return arr;
}
export function resetConvo(mode) { S().convos[convoKey(mode)] = []; save(); }

// ── Diario del tutor (memoria per profilo, tutte le modalità) ──
export function getDiary(id) { return S().diaries[id] || (S().diaries[id] = []); }
export function pushDiary(id, entry) {
  const arr = getDiary(id);
  arr.push({ ts: Date.now(), date: todayK(), ...entry });
  if (arr.length > 80) arr.splice(0, arr.length - 80);
  save();
}
export function clearDiary(id) { S().diaries[id] = []; Object.keys(S().diarized).forEach((k) => { if (k.startsWith(id + ':')) delete S().diarized[k]; }); save(); }

// Marker: quante voci di conversazione sono già state riassunte per non ripetere.
export function diarizedLen(id, mode) { return S().diarized[`${id}:${mode}`] || 0; }
export function setDiarizedLen(id, mode, n) { S().diarized[`${id}:${mode}`] = n; save(); }

// ── Laboratori (Writing Lab / Pronuncia): ultimo risultato per profilo ──
export function getLab(id, kind) { return (S().labs[id] || {})[kind] || null; }
export function setLab(id, kind, val) { const l = S().labs[id] || (S().labs[id] = {}); l[kind] = val; save(); }

// ── Contatore token (consumo reale, da usageMetadata delle risposte) ──
// Le quote giornaliere gratuite di Google si azzerano a mezzanotte del Pacifico:
// per questo il "giorno" dei token è calcolato su quel fuso.
export function pacificDayKey(d = new Date()) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
  catch (e) { return todayK(d); }
}
// Millisecondi che restano fino al prossimo azzeramento (mezzanotte del Pacifico).
export function msToQuotaReset(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now);
    const g = (t) => +(parts.find((p) => p.type === t) || {}).value || 0;
    const h = g('hour') % 24, m = g('minute'), s = g('second');
    return ((24 - h) * 3600 - m * 60 - s) * 1000;
  } catch (e) { return 0; }
}
function usageBucket() {
  const m = S(), dk = pacificDayKey();
  if (!m.usage || m.usage.d !== dk) m.usage = { d: dk, tokens: 0, req: 0, byKind: {}, min: { t: 0, tokens: 0, req: 0 } };
  if (!m.usage.byKind) m.usage.byKind = {};
  if (!m.usage.min) m.usage.min = { t: 0, tokens: 0, req: 0 };
  return m.usage;
}
// kind: 'chat' | 'tts' | 'live' | 'mic'. meta = usageMetadata della risposta.
export function addUsage(kind, meta) {
  const u = usageBucket();
  const tot = meta ? (+meta.totalTokenCount || ((+meta.promptTokenCount || 0) + (+meta.candidatesTokenCount || 0) + (+meta.responseTokenCount || 0))) : 0;
  const minute = Math.floor(Date.now() / 60000);
  if (u.min.t !== minute) u.min = { t: minute, tokens: 0, req: 0 };
  u.tokens += tot; u.req += 1;
  u.min.tokens += tot; u.min.req += 1;
  u.byKind[kind] = (u.byKind[kind] || 0) + tot;
  save();
}
export function usageStats() {
  const u = usageBucket();
  const minute = Math.floor(Date.now() / 60000);
  const min = u.min.t === minute ? u.min : { tokens: 0, req: 0 };
  return { day: u.d, tokens: u.tokens, req: u.req, byKind: { ...u.byKind }, minuteTokens: min.tokens, minuteReq: min.req, resetMs: msToQuotaReset() };
}
export function resetUsage() { const m = S(); m.usage = { d: pacificDayKey(), tokens: 0, req: 0, byKind: {}, min: { t: 0, tokens: 0, req: 0 } }; save(); }

// ── Contatore giornaliero ──
function daily() {
  const m = S(), tk = todayK();
  if (!m.daily || m.daily.d !== tk) m.daily = { d: tk, n: 0 };
  return m.daily;
}
export function usage() {
  const d = daily(), max = Math.max(0, +S().cfg.tutorDailyMax || 0);
  return { used: d.n, max, left: max ? Math.max(0, max - d.n) : Infinity };
}
export function bumpUsage() { const d = daily(); d.n++; save(); }

// ── Backup (export / import JSON) — la chiave Gemini NON viene inclusa ──
export function exportState() {
  const clone = JSON.parse(JSON.stringify(_m));
  if (clone.cfg) { delete clone.cfg.geminiKey; delete clone.cfg.geminiKeyTTS; }
  return JSON.stringify(clone, null, 2);
}
export function importState(json) {
  const data = JSON.parse(json);
  const key = _m.cfg.geminiKey, keyTts = _m.cfg.geminiKeyTTS;   // conserva le chiavi locali
  _m = defaults(data);
  _m.cfg.geminiKey = key;
  _m.cfg.geminiKeyTTS = keyTts;
  save();
}
