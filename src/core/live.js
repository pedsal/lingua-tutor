// ============================================================
//  Conversazione vocale LIVE (Gemini Live API) — PROTOTIPO sperimentale.
//
//  Differenza dalle altre modalità: non c'è "genera testo → poi leggilo". Il
//  modello riceve il tuo audio e risponde DIRETTAMENTE in audio (speech-to-speech),
//  quindi la latenza è quella di una telefonata. In cambio non produce le
//  correzioni strutturate (card/furigana/suggerimenti) delle altre modalità.
//
//  Protocollo: WebSocket bidirezionale.
//   → setup, poi realtimeInput con audio PCM16 16kHz (microfono)
//   ← serverContent con audio PCM16 24kHz + trascrizioni (input e output)
// ============================================================
import { S } from './store.js';
import { LANGS } from './lang.js';

export const LIVE_MODEL = 'gemini-3.1-flash-live-preview';
export const LIVE_VOICES = ['Kore', 'Puck', 'Charon', 'Zephyr', 'Aoede', 'Fenrir', 'Leda', 'Orus', 'Sulafat'];

const IN_RATE = 16000;    // il modello vuole PCM16 mono a 16kHz
const OUT_RATE = 24000;   // il modello risponde con PCM16 mono a 24kHz

function liveKey() { const c = S().cfg; return (c.geminiKeyTTS || '').trim() || (c.geminiKey || '').trim(); }
export function liveSupported() {
  return !!(window.WebSocket && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && (window.AudioContext || window.webkitAudioContext));
}

const b64encode = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); };
const b64decode = (b64) => { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

// Istruzioni per il tutor in modalità vocale, calibrate sul livello (come le
// altre modalità: ai livelli iniziali parla soprattutto nella lingua nota).
function liveSystem(profile) {
  const target = LANGS[profile.target], expl = LANGS[profile.expl];
  const lvl = profile.level;
  const beginner = lvl === 'intro' || lvl === 'N5' || lvl === 'A1';
  const elementary = lvl === 'N4' || lvl === 'A2';
  const levelText = lvl === 'intro' ? 'absolute beginner (just starting)' : (profile.target === 'ja' ? `JLPT ${lvl}` : `CEFR ${lvl}`);
  let policy;
  if (lvl === 'intro') policy = `The student does NOT understand ${target.name.en} yet. Speak almost entirely in ${expl.native}. Introduce only a FEW ${target.name.en} words or greetings, saying each slowly and giving its meaning in ${expl.native}. Ask them to repeat, and praise attempts.`;
  else if (beginner) policy = `Speak MOSTLY in ${expl.native}. Introduce short ${target.name.en} phrases slowly, always giving the meaning in ${expl.native}. Invite the student to say very short phrases.`;
  else if (elementary) policy = `Use a balance of ${expl.native} and simple ${target.name.en}; briefly explain new words in ${expl.native}.`;
  else policy = `Speak mostly in ${target.name.en}, switching to ${expl.native} only for brief help.`;
  return `You are a warm, patient private language tutor having a SPOKEN conversation with ${profile.name}, who is learning ${target.name.en} at level ${levelText}.
${policy}
Rules for speech:
- Keep every reply SHORT (1-3 sentences): this is a live conversation, not a lecture.
- Speak clearly and not too fast, with natural pronunciation.
- If the student makes a mistake speaking ${target.name.en}, gently say the correct version once and let them repeat. Do not interrupt their flow with long grammar explanations.
- Always end by asking something or inviting them to try, so the conversation continues.`;
}

export class LiveSession {
  constructor(profile, handlers = {}) {
    this.profile = profile;
    this.h = handlers;                 // { onState, onUserText, onTutorText, onError }
    this.ws = null;
    this.state = 'idle';               // idle | connecting | live | closed
    this.micStream = null;
    this.inCtx = null; this.node = null; this.source = null;
    this.outCtx = null; this.nextAt = 0; this.sources = [];
    this.muted = false;
  }

  setState(s) { this.state = s; this.h.onState && this.h.onState(s); }

  async start() {
    const key = liveKey();
    if (!key) throw new Error('MISSING_KEY');
    this.setState('connecting');
    // 1) microfono PRIMA della connessione: se nega, non apriamo il socket
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // 2) WebSocket
    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(key)}`;
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      const to = setTimeout(() => reject(new Error('TIMEOUT')), 20000);
      ws.onopen = () => {
        clearTimeout(to);
        ws.send(JSON.stringify({ setup: {
          model: 'models/' + LIVE_MODEL,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: S().cfg.liveVoice || 'Kore' } } },
          },
          systemInstruction: { parts: [{ text: liveSystem(this.profile) }] },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        } }));
        resolve();
      };
      ws.onerror = () => { clearTimeout(to); reject(new Error('WS_ERROR')); };
      ws.onclose = (e) => { this.cleanupAudio(); if (this.state !== 'closed') { this.setState('closed'); if (e && e.code !== 1000 && e.reason) this.h.onError && this.h.onError(e.reason); } };
      ws.onmessage = (ev) => this.onMessage(ev);
    });
  }

  async onMessage(ev) {
    let raw;
    if (typeof ev.data === 'string') raw = ev.data;
    else if (ev.data instanceof Blob) raw = await ev.data.text();
    else raw = new TextDecoder().decode(ev.data);
    let m; try { m = JSON.parse(raw); } catch (e) { return; }

    if (m.setupComplete) { this.startMic(); this.setState('live'); return; }
    if (m.error) { this.h.onError && this.h.onError(m.error.message || 'errore'); return; }
    const sc = m.serverContent;
    if (!sc) return;
    if (sc.interrupted) this.stopPlayback();                                   // l'utente ha parlato sopra: zittisci
    if (sc.inputTranscription && sc.inputTranscription.text) this.h.onUserText && this.h.onUserText(sc.inputTranscription.text);
    if (sc.outputTranscription && sc.outputTranscription.text) this.h.onTutorText && this.h.onTutorText(sc.outputTranscription.text);
    const parts = (sc.modelTurn && sc.modelTurn.parts) || [];
    for (const p of parts) {
      if (p.inlineData && p.inlineData.data) this.play(b64decode(p.inlineData.data));
      else if (p.text) this.h.onTutorText && this.h.onTutorText(p.text);
    }
    if (sc.turnComplete) this.h.onTurnComplete && this.h.onTurnComplete();
  }

  // ── Microfono → PCM16 16kHz → WebSocket ──
  startMic() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.inCtx = new AC();
    this.source = this.inCtx.createMediaStreamSource(this.micStream);
    const BUF = 4096;
    // ScriptProcessor: deprecato ma disponibile su tutti i browser mobili.
    this.node = this.inCtx.createScriptProcessor(BUF, 1, 1);
    const ratio = this.inCtx.sampleRate / IN_RATE;
    this.node.onaudioprocess = (e) => {
      if (this.muted || !this.ws || this.ws.readyState !== 1) return;
      const input = e.inputBuffer.getChannelData(0);
      const outLen = Math.floor(input.length / ratio);
      const pcm = new Int16Array(outLen);
      for (let i = 0; i < outLen; i++) {
        const s = Math.max(-1, Math.min(1, input[Math.floor(i * ratio)]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      const data = b64encode(new Uint8Array(pcm.buffer));
      try { this.ws.send(JSON.stringify({ realtimeInput: { audio: { data, mimeType: `audio/pcm;rate=${IN_RATE}` } } })); } catch (err) {}
    };
    const sink = this.inCtx.createGain(); sink.gain.value = 0;   // non ri-suonare il microfono
    this.source.connect(this.node); this.node.connect(sink); sink.connect(this.inCtx.destination);
  }

  // ── Riproduzione: accoda i blocchi PCM24k in sequenza (senza buchi) ──
  play(bytes) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!this.outCtx) { this.outCtx = new AC(); this.nextAt = 0; }
    const ctx = this.outCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const n = Math.floor(bytes.length / 2);
    if (!n) return;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const buf = ctx.createBuffer(1, n, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = dv.getInt16(i * 2, true) / 0x8000;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination);
    const now = ctx.currentTime;
    if (this.nextAt < now) this.nextAt = now + 0.04;   // piccolo margine anti-glitch
    src.start(this.nextAt);
    this.nextAt += buf.duration;
    this.sources.push(src);
    src.onended = () => { this.sources = this.sources.filter((x) => x !== src); };
  }
  stopPlayback() {
    this.sources.forEach((s) => { try { s.stop(); } catch (e) {} });
    this.sources = [];
    this.nextAt = 0;
  }

  // Invia un messaggio di testo (utile per far partire la conversazione).
  sendText(text) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }));
  }
  setMuted(v) { this.muted = !!v; }

  cleanupAudio() {
    this.stopPlayback();
    if (this.node) { try { this.node.disconnect(); this.node.onaudioprocess = null; } catch (e) {} this.node = null; }
    if (this.source) { try { this.source.disconnect(); } catch (e) {} this.source = null; }
    if (this.inCtx) { try { this.inCtx.close(); } catch (e) {} this.inCtx = null; }
    if (this.outCtx) { try { this.outCtx.close(); } catch (e) {} this.outCtx = null; }
    if (this.micStream) { try { this.micStream.getTracks().forEach((t) => t.stop()); } catch (e) {} this.micStream = null; }
  }
  stop() {
    this.setState('closed');
    this.cleanupAudio();
    if (this.ws) { try { this.ws.close(1000); } catch (e) {} this.ws = null; }
  }
}
