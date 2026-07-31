// ============================================================
//  Voce — pronuncia via Web Speech API (gratuita, voci del dispositivo).
//  Generalizzato da Dojo_V5: sceglie la voce giusta per giapponese / inglese /
//  italiano e, nei messaggi misti, legge i tratti giapponesi con la voce ja e
//  il resto con la voce della lingua "latina" pertinente.
//  Include anche il riconoscimento vocale (dettatura) dove supportato.
// ============================================================
import { S, save } from './store.js';
import { LANGS } from './lang.js';
import { neuralAvailable, speakNeural } from './neural.js';

let _voices = [];
function refresh() { try { _voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; } catch (e) { _voices = []; } }
if ('speechSynthesis' in window) { refresh(); try { speechSynthesis.onvoiceschanged = refresh; } catch (e) {} }

export function ttsAvailable() { return 'speechSynthesis' in window; }
export function voicesForLang(code) { refresh(); return _voices.filter((v) => new RegExp('^' + code + '(-|_|$)', 'i').test(v.lang)); }

const PREFER = {
  ja: [/nanami/i, /google\s*(日本語|japanese)/i, /keita/i, /kyoko/i, /otoya/i, /ayumi/i, /haruka/i, /ichiro/i],
  en: [/aria/i, /jenny/i, /guy/i, /google\s*us\s*english/i, /samantha/i, /daniel/i, /libby/i, /ryan/i],
  it: [/alice/i, /federica/i, /luca/i, /google.*ital/i, /elsa/i, /isabella/i, /cosimo/i],
};
export function bestVoice(code) {
  const list = voicesForLang(code);
  if (!list.length) return null;
  const wanted = (S().cfg.ttsVoices || {})[code];
  if (wanted) { const v = list.find((x) => x.name === wanted); if (v) return v; }
  for (const re of (PREFER[code] || [])) { const v = list.find((x) => re.test(x.name)); if (v) return v; }
  const online = list.find((v) => v.localService === false); if (online) return online;
  return list[0];
}

const _clampRate = (x) => Math.min(1.4, Math.max(0.5, x));
const _JA_CH = /[぀-ヿ㐀-䶿一-龯ｦ-ﾟ々〆ヶー]/;
const _JA_WORD = /[぀-ヿ㐀-䶿一-龯]/;

// Ripulisce il testo per la lettura: toglie markdown, glosse in parentesi solo-latine,
// emoji e simboli rumorosi; conserva la punteggiatura utile alla prosodia.
function cleanForTTS(raw) {
  return String(raw || '')
    .replace(/[*_`#>]+/g, ' ')
    .replace(/[（(][^）)]*[)）]/g, (mm) => (_JA_WORD.test(mm) ? mm : ' '))
    .replace(/[（）()［］\[\]｛｝{}]/g, ' ')
    .replace(/[—–]/g, ', ')
    .replace(/[«»「」『』“”"<>|~^=/\\•·◦▪●○►▶★☆♪→←✏️]/g, ' ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}️]/gu, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?、。！？])/g, '$1')
    .replace(/([,.;:!?、。！？])\1+/g, '$1')
    .trim();
}

// Determina la lingua "latina" da usare per il profilo: se studi una lingua
// latina (en/it) usa quella per i tratti latini (così gli esempi suonano bene),
// altrimenti (studi giapponese) usa la lingua di spiegazione.
function latinLangFor(profile) {
  if (!profile) return 'it';
  return LANGS[profile.target].latin ? profile.target : profile.expl;
}

function segmentMixed(raw, latinCode) {
  const t = cleanForTTS(raw);
  const out = [];
  let cur = '', curJa = null;
  for (const ch of t) {
    const isJa = _JA_CH.test(ch) || /[、。！？]/.test(ch);
    if (/\s/.test(ch)) { cur += ch; continue; }
    if (curJa === null) { curJa = isJa; cur += ch; }
    else if (isJa === curJa) { cur += ch; }
    else { if (cur.trim()) out.push({ code: curJa ? 'ja' : latinCode, text: cur.trim() }); cur = ch; curJa = isJa; }
  }
  if (cur.trim()) out.push({ code: curJa ? 'ja' : latinCode, text: cur.trim() });
  return out.filter((s) => (s.code === 'ja' ? _JA_WORD.test(s.text) : /[a-zA-Zàèéìòùáéíóúñ]/.test(s.text)));
}

let _chain = 0, _utter = null, _audio = null;
export function ttsStop() {
  _chain++;
  try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {}
  if (_audio) { try { _audio.pause(); } catch (e) {} _audio = null; }
}

// Legge un messaggio del tutor con le voci appropriate. force = riproduzione
// manuale (bottone "Ascolta"): suona anche se l'auto-lettura è spenta.
export function speakMsg(text, profile, force) {
  if ((!force && S().cfg.tts === false) || !ttsAvailable()) return;
  ttsStop();
  const latin = latinLangFor(profile);
  const segs = segmentMixed(text, latin);
  if (!segs.length) return;
  const token = ++_chain;
  const rate = _clampRate(+S().cfg.ttsRate || 1.0);
  const ss = window.speechSynthesis;
  let i = 0;
  const next = () => {
    if (token !== _chain || i >= segs.length) return;
    const s = segs[i++];
    const u = new SpeechSynthesisUtterance(s.text);
    u.lang = LANGS[s.code] ? LANGS[s.code].bcp : 'en-US';
    const v = bestVoice(s.code); if (v) u.voice = v;
    u.rate = s.code === 'ja' ? Math.min(rate, 1.1) : rate; u.pitch = 1;
    u.onend = next; u.onerror = next;
    _utter = u;
    try { ss.speak(u); } catch (e) { next(); }
  };
  try { ss.resume(); } catch (e) {}
  next();
}

// Prova voce: legge una frase campione nella lingua indicata.
export function speakSample(code) {
  const samples = { ja: 'こんにちは、今日はいい天気ですね。', en: 'Hello, this is a voice test.', it: 'Ciao, questa è una prova di voce.' };
  const text = samples[code] || 'Test';
  if (!ttsAvailable()) return;
  ttsStop();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = LANGS[code].bcp; const v = bestVoice(code); if (v) u.voice = v;
  u.rate = _clampRate(+S().cfg.ttsRate || 1.0); u.pitch = 1;
  _utter = u;
  try { const ss = window.speechSynthesis; ss.resume(); ss.speak(u); } catch (e) {}
}

// Router della voce del tutor: usa la voce neurale se attiva (con fallback alla
// voce del dispositivo su errore), altrimenti la voce del dispositivo.
export function speakTutor(text, profile, force) {
  if (!force && S().cfg.tts === false) return null;
  if (neuralAvailable()) return speakNeural(text).catch(() => { speakMsg(text, profile, force); });
  speakMsg(text, profile, force);
  return null;
}

// ── Riconoscimento vocale (dettatura) ──
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export function micAvailable() { return !!SR; }
export function startDictation(code, { onResult, onEnd, onError } = {}) {
  if (!SR) { onError && onError(new Error('UNSUPPORTED')); return null; }
  const rec = new SR();
  rec.lang = LANGS[code] ? LANGS[code].bcp : 'en-US';
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
    }
    onResult && onResult(finalText + interim, finalText);
  };
  rec.onerror = (e) => onError && onError(e);
  rec.onend = () => onEnd && onEnd(finalText);
  try { rec.start(); } catch (e) { onError && onError(e); }
  return rec;
}
