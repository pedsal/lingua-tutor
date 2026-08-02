// ============================================================
//  Microfono via IA (Gemini) — registra l'audio dal microfono e lo fa trascrivere
//  a Gemini con la chiave BYOK. Utile dove il riconoscimento vocale di SISTEMA è
//  rotto/mal configurato (es. alcuni Pixel: non va né in Gboard né nel browser),
//  perché usa direttamente il microfono (getUserMedia) + i server Gemini.
// ============================================================
import { S } from './store.js';
import { apiKey } from './gemini.js';

let _stream = null, _recorder = null, _chunks = [];

export function geminiMicAvailable() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}
export function isRecording() { return !!(_recorder && _recorder.state === 'recording'); }

function stopStream() { if (_stream) { try { _stream.getTracks().forEach((t) => t.stop()); } catch (e) {} _stream = null; } }
export function cancelRecording() { try { if (_recorder && _recorder.state !== 'inactive') _recorder.stop(); } catch (e) {} _recorder = null; _chunks = []; stopStream(); }

// Avvia la registrazione (throw se il microfono è negato/non disponibile).
export async function startRecording() {
  _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  _chunks = [];
  let mime = '';
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) { mime = m; break; }
  }
  _recorder = mime ? new MediaRecorder(_stream, { mimeType: mime }) : new MediaRecorder(_stream);
  _recorder.ondataavailable = (e) => { if (e.data && e.data.size) _chunks.push(e.data); };
  _recorder.start();
}

// Ferma la registrazione, converte in WAV e chiede a Gemini la trascrizione.
// targetName = nome della lingua parlata (in inglese) per aiutare il modello.
export async function stopAndTranscribe(targetName) {
  if (!_recorder) return '';
  const type = _recorder.mimeType || 'audio/webm';
  const blob = await new Promise((resolve) => {
    _recorder.onstop = () => resolve(new Blob(_chunks, { type }));
    try { _recorder.stop(); } catch (e) { resolve(new Blob(_chunks, { type })); }
  });
  _recorder = null; stopStream();
  if (!blob || !blob.size) return '';
  const wav = await blobToWav(blob);
  const b64 = await blobToBase64(wav);
  return transcribe(b64, targetName);
}

async function blobToWav(blob) {
  const buf = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try {
    const audio = await ac.decodeAudioData(buf);
    return encodeWav(audio);
  } finally { try { ac.close(); } catch (e) {} }
}
// AudioBuffer → WAV mono 16-bit (formato che Gemini accetta con certezza).
function encodeWav(audioBuffer) {
  const sr = audioBuffer.sampleRate, ch = audioBuffer.numberOfChannels, len = audioBuffer.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < ch; c++) { const cd = audioBuffer.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += cd[i] / ch; }
  const bytes = new Uint8Array(len * 2), dv = new DataView(bytes.buffer);
  for (let i = 0; i < len; i++) { const s = Math.max(-1, Math.min(1, mono[i])); dv.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true); }
  const header = new ArrayBuffer(44), h = new DataView(header);
  const put = (o, s) => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)); };
  put(0, 'RIFF'); h.setUint32(4, 36 + bytes.length, true); put(8, 'WAVE'); put(12, 'fmt ');
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
  h.setUint32(24, sr, true); h.setUint32(28, sr * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
  put(36, 'data'); h.setUint32(40, bytes.length, true);
  return new Blob([header, bytes], { type: 'audio/wav' });
}
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function transcribe(b64, targetName) {
  const key = apiKey();
  if (!key) throw new Error('MISSING_KEY');
  const model = 'gemini-3.1-flash-lite';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key);
  const body = {
    contents: [{ parts: [
      { text: `Transcribe this audio${targetName ? ' spoken in ' + targetName : ''}, verbatim. Output ONLY the exact transcription with no quotes, labels or extra words. If there is no speech, output nothing.` },
      { inlineData: { mimeType: 'audio/wav', data: b64 } },
    ] }],
    generationConfig: { temperature: 0, maxOutputTokens: 256 },
  };
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 30000);
  let data;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = (data && data.error && data.error.message) || '';
      if (r.status === 403 || r.status === 401) throw new Error('BAD_KEY');
      if (r.status === 429) throw new Error('QUOTA');
      throw new Error(m || ('HTTP ' + r.status));
    }
  } finally { clearTimeout(to); }
  const t = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts || [])
    .map((p) => p.text || '').join('').trim();
  return t;
}
