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
  if (clone.cfg) delete clone.cfg.geminiKey;
  return JSON.stringify(clone, null, 2);
}
export function importState(json) {
  const data = JSON.parse(json);
  const key = _m.cfg.geminiKey;   // conserva la chiave locale
  _m = defaults(data);
  _m.cfg.geminiKey = key;
  save();
}
