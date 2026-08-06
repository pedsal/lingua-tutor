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
import { S, getDiary } from './store.js';
import { LANGS } from './lang.js';
import { PERSONA_PROMPT } from './tutor.js';

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
export function liveSystem(profile) {
  const target = LANGS[profile.target], expl = LANGS[profile.expl];
  const lvl = profile.level;
  const beginner = lvl === 'intro' || lvl === 'N5' || lvl === 'A1';
  const elementary = lvl === 'N4' || lvl === 'A2';
  const levelText = lvl === 'intro' ? 'absolute beginner, starting from zero' : (profile.target === 'ja' ? `JLPT ${lvl}` : `CEFR ${lvl}`);

  // Quanta lingua-obiettivo usare (stessa calibrazione delle altre modalità).
  let policy;
  if (lvl === 'intro') policy = `The student does NOT understand ${target.name.en} yet. Speak almost entirely in ${expl.native}. Introduce only a FEW ${target.name.en} words or greetings, say each one slowly, give its meaning in ${expl.native}, and ask the student to repeat it. Never hold a conversation in ${target.name.en} at this level.`;
  else if (beginner) policy = `Speak MOSTLY in ${expl.native}. Introduce short ${target.name.en} phrases slowly, always giving the meaning in ${expl.native}. Invite the student to say very short phrases.`;
  else if (elementary) policy = `Use a balance of ${expl.native} and simple ${target.name.en}; briefly explain new words in ${expl.native}.`;
  else policy = `Speak mostly in ${target.name.en}, switching to ${expl.native} only for brief help.`;

  // ── Memoria: sessioni precedenti + errori ricorrenti (così riprende da dove
  //    avete interrotto invece di ricominciare da zero ogni volta) ──
  const diary = getDiary(profile.id) || [];
  const lastLive = diary.filter((d) => d.mode === 'live').slice(-3);
  const recent = diary.slice(-5);
  const errs = diary.slice(-12).map((d) => d.errors).filter((e) => e && !/^\s*nessun/i.test(e)).slice(-5);
  let memory = '';
  if (recent.length) {
    memory += `\n\nMEMORY — what you already did with ${profile.name} (do NOT start from scratch, build on this and avoid repeating):\n`
      + recent.map((d) => `- ${d.date}: ${d.topic}${d.summary ? ' — ' + d.summary : ''}`).join('\n');
  }
  if (lastLive.length) {
    const l = lastLive[lastLive.length - 1];
    memory += `\n\nYour LAST spoken conversation was about "${l.topic}"${l.next ? ` and you planned to practise next: ${l.next}` : ''}. At the start, briefly recall it in one short sentence and CONTINUE from there.`;
  }
  if (errs.length) memory += `\n\nRECURRING MISTAKES to listen for: ${errs.join('; ')}. If they come up again, correct them kindly.`;

  const custom = (S().cfg.liveInstructions || '').trim();
  const extra = custom ? `\n\nEXTRA INSTRUCTIONS FROM THE STUDENT (follow these carefully): ${custom}` : '';

  // ── Modalità: assistente che chiacchiera, oppure tutor che corregge ──
  if ((S().cfg.liveMode || 'tutor') === 'assistant') {
    return `You are a friendly, easy-going conversation partner speaking live with ${profile.name}, who is learning ${target.name.en} (level ${levelText}). Explanation language: ${expl.native}.
Personality: ${PERSONA_PROMPT[profile.persona || 'friendly'] || PERSONA_PROMPT.friendly}

HOW MUCH OF EACH LANGUAGE TO SPEAK: ${policy}

YOUR ROLE — just talk with them, do NOT act as a teacher:
- Have a relaxed, natural chat: react to what they say, share small opinions, ask about their day, interests, plans.
- Do NOT correct their mistakes and do NOT give grammar explanations, unless they explicitly ask. Let the conversation flow.
- If you truly don't understand them, just ask them to repeat in a friendly way.

HOW TO SPEAK:
- Keep every reply SHORT (1-3 sentences), like a real conversation.
- Speak clearly, at a calm pace, with correct native pronunciation.
- Always end with a question, so the conversation keeps going and they talk more than you.${memory}${extra}`;
  }

  return `You are ${profile.name}'s personal LANGUAGE TEACHER, in a live spoken lesson. You are not a generic assistant: you teach, you listen, and you correct.
Student: ${profile.name}. Learning: ${target.name.en}. Level: ${levelText}. Explanation language: ${expl.native}.
Teaching style: ${PERSONA_PROMPT[profile.persona || 'friendly'] || PERSONA_PROMPT.friendly}

HOW MUCH OF EACH LANGUAGE TO SPEAK: ${policy}

HOW TO CORRECT (very important — this is your main job):
1. Listen to what the student says in ${target.name.en}.
2. If there is ANY mistake (grammar, wrong word, particle, verb form, word order, politeness level, or clearly wrong pronunciation), correct it IMMEDIATELY and briefly: say the correct version clearly ONCE, add a very short reason in ${expl.native} (a few words), then ask the student to repeat it.
3. If what they said was correct and natural, say so specifically and briefly ("bravo, corretto: ...") — do not invent mistakes.
4. Correct at most 1-2 things per turn: pick the most important. Never lecture.
5. Adapt everything to level ${levelText}: never use words or structures above their level.

HOW TO SPEAK:
- Keep every reply SHORT (1-3 sentences). This is a conversation, not a monologue.
- Speak clearly, at a calm pace, with correct native pronunciation.
- When you say a word in ${target.name.en} that is new, say it slowly and give its meaning in ${expl.native}.
- ALWAYS end your turn with a question or an invitation to try something, so the student keeps speaking. Make them talk more than you.${memory}${extra}`;
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
