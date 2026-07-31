// ============================================================
//  Voce neurale via IA (Gemini TTS, BYOK) — opzionale, opt-in.
//  Una sola voce multilingue legge giapponese, inglese e italiano; più naturale
//  e uguale su ogni dispositivo, ma consuma la quota Gemini. In caso di errore il
//  chiamante ripiega sulla voce del dispositivo (vedi speakTutor in tts.js).
// ============================================================
import { S } from './store.js';

export const GEMINI_TTS_VOICES = ['Kore', 'Puck', 'Charon', 'Zephyr', 'Aoede', 'Fenrir', 'Leda', 'Orus', 'Sulafat'];

// Toglie markdown/simboli che una voce leggerebbe letteralmente.
function clean(raw) {
  return String(raw || '')
    .replace(/[*_`#>]+/g, ' ')
    .replace(/[«»「」『』“”"•·◦▪●○►▶★☆♪→←✏️]/g, ' ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}️]/gu, ' ')
    .replace(/[ \t]{2,}/g, ' ').trim();
}

function decodeB64(b64) {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// PCM 16-bit mono → contenitore WAV riproducibile nel browser.
function wrapWav(bytes, rate) {
  const buf = new ArrayBuffer(44 + bytes.length), dv = new DataView(buf);
  const put = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  put(0, 'RIFF'); dv.setUint32(4, 36 + bytes.length, true); put(8, 'WAVE'); put(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true); put(36, 'data'); dv.setUint32(40, bytes.length, true);
  new Uint8Array(buf, 44).set(bytes);
  return new Blob([buf], { type: 'audio/wav' });
}

// TTS solo su modello moderno 3.x (niente 2.5, che ha quota gratuita minuscola).
export const NEURAL_TTS_MODEL = 'gemini-3.1-flash-tts-preview';
const MODEL = NEURAL_TTS_MODEL;

let _player = null;
let _ntoken = 0;   // token: incrementando si annulla la catena in corso
export function neuralStop() { _ntoken++; if (_player) { try { _player.pause(); } catch (e) {} _player = null; } }
export function neuralAvailable() { return !!(S().cfg.ttsNeural && (S().cfg.geminiKey || '').trim()); }

// Genera l'audio (throw su errore, es. 429).
async function genAudio(text, voice, key) {
  if (!text) return null;
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + encodeURIComponent(key);
  const req = { contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } };
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 30000);
  let data;
  try {
    const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal: ctrl.signal });
    data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data && data.error && data.error.message) || ('Errore TTS (' + r.status + ').'));
  } finally { clearTimeout(to); }
  const part = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0];
  const inline = part && part.inlineData;
  if (!inline || !inline.data) throw new Error('Nessun audio ricevuto dal modello TTS.');
  const rate = +((/rate=(\d+)/.exec(inline.mimeType || '') || [])[1]) || 24000;
  return wrapWav(decodeB64(inline.data), rate);
}

function playBlob(blob, token) {
  return new Promise((resolve) => {
    if (token !== _ntoken || !blob) { resolve(); return; }
    const audio = new Audio(URL.createObjectURL(blob));
    _player = audio;
    const done = () => { try { URL.revokeObjectURL(audio.src); } catch (e) {} resolve(); };
    audio.onended = done; audio.onerror = done;
    audio.play().catch(() => done());
  });
}

// Genera l'audio dell'INTERA risposta con una sola chiamata, poi la riproduce
// tutta di fila (nessuno stacco tra le frasi). Piccola attesa iniziale mentre
// l'audio si genera. Throw su errore, così il chiamante ripiega sulla voce del
// dispositivo.
export async function speakNeural(text) {
  const key = (S().cfg.geminiKey || '').trim();
  if (!key) throw new Error('Manca la chiave Gemini.');
  const body = clean(text);
  if (!body) return null;
  const voice = S().cfg.ttsNeuralVoice || 'Kore';
  neuralStop();
  try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
  const token = ++_ntoken;
  const blob = await genAudio(body, voice, key);   // errore propagato → fallback dispositivo
  if (token !== _ntoken) return;
  await playBlob(blob, token);
  return true;
}
