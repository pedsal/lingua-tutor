// ============================================================
//  Voce — pronuncia via Web Speech API (gratuita, voci del dispositivo).
//  Generalizzato da Dojo_V5: sceglie la voce giusta per giapponese / inglese /
//  italiano e, nei messaggi misti, legge i tratti giapponesi con la voce ja e
//  il resto con la voce della lingua "latina" pertinente.
//  Include anche il riconoscimento vocale (dettatura) dove supportato.
// ============================================================
import { S, save } from './store.js';
import { LANGS } from './lang.js';
import { neuralAvailable, speakNeural, neuralStop } from './neural.js';

let _voices = [];
function refresh() { try { _voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; } catch (e) { _voices = []; } }
if ('speechSynthesis' in window) { refresh(); try { speechSynthesis.onvoiceschanged = refresh; } catch (e) {} }

export function ttsAvailable() { return 'speechSynthesis' in window; }
export function voicesForLang(code) { refresh(); return _voices.filter((v) => new RegExp('^' + code + '(-|_|$)', 'i').test(v.lang)); }

const PREFER = {
  ja: [/nanami/i, /google\s*(日本語|japanese)/i, /keita/i, /kyoko/i, /otoya/i, /ayumi/i, /haruka/i, /ichiro/i],
  en: [/aria/i, /jenny/i, /guy/i, /google\s*us\s*english/i, /samantha/i, /daniel/i, /libby/i, /ryan/i],
  it: [/alice/i, /federica/i, /luca/i, /google.*ital/i, /elsa/i, /isabella/i, /cosimo/i],
  es: [/elvira/i, /alvaro/i, /google.*espa/i, /monica/i, /helena/i, /laura/i],
  fr: [/denise/i, /henri/i, /google.*fran/i, /amelie/i, /thomas/i, /audrey/i],
  de: [/katja/i, /conrad/i, /google.*deutsch/i, /anna/i, /markus/i],
  pt: [/francisca/i, /antonio/i, /google.*portug/i, /luciana/i, /joana/i],
  zh: [/xiaoxiao/i, /yunyang/i, /google.*(中文|mandarin|chinese)/i, /tingting/i, /huihui/i],
  ko: [/sunhi/i, /injoon/i, /google.*korean/i, /heami/i, /yuna/i],
  ru: [/svetlana/i, /dmitry/i, /google.*russ/i, /milena/i, /pavel/i],
  ro: [/alina/i, /emil/i, /google.*roman/i, /andrei/i, /ioana/i],
};
// Voci di qualità "neurale" locali (istantanee): Microsoft "…Natural", voci
// "Neural/Premium/Enhanced" (Windows/Edge/iOS/Android moderni).
const NATURAL = /natural|neural|premium|enhanced|siri/i;
export function bestVoice(code) {
  const list = voicesForLang(code);
  if (!list.length) return null;
  const wanted = (S().cfg.ttsVoices || {})[code];
  if (wanted) { const v = list.find((x) => x.name === wanted); if (v) return v; }
  // 1) voce locale "Natural/Neural" (qualità alta, nessuna latenza di rete)
  const natural = list.find((v) => NATURAL.test(v.name)); if (natural) return natural;
  // 2) voci note di buona qualità per lingua
  for (const re of (PREFER[code] || [])) { const v = list.find((x) => re.test(x.name)); if (v) return v; }
  // 3) voce online (spesso neurale), 4) prima disponibile
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
    // Rimuovi SEMPRE le letture/glosse tra parentesi (es. "日本語 (にほんご - nihongo)"),
    // altrimenti la voce ripete 2-3 volte la stessa parola.
    .replace(/[（(][^）)]*[)）]/g, ' ')
    .replace(/[（）()［］\[\]｛｝{}]/g, ' ')
    .replace(/[—–]/g, ', ')
    .replace(/[«»「」『』“”"<>|~^=/\\•·◦▪●○►▶★☆♪→←✏️]/g, ' ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}️]/gu, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?、。！？])/g, '$1')
    .replace(/([,.;:!?、。！？])\1+/g, '$1')
    .trim();
}

let _chain = 0, _utter = null, _audio = null;
export function ttsStop() {
  _chain++;
  try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (e) {}
  if (_audio) { try { _audio.pause(); } catch (e) {} _audio = null; }
  neuralStop();
}

// Legge la risposta del tutor con la voce della LINGUA-OBIETTIVO. La risposta è
// scritta interamente nella lingua studiata (le spiegazioni stanno in campi a
// parte), quindi una sola voce va bene per qualsiasi lingua, anche non latina.
// force = riproduzione manuale ("Ascolta"): suona anche se l'auto-lettura è spenta.
export function speakMsg(text, profile, force) {
  if ((!force && S().cfg.tts === false) || !ttsAvailable()) return;
  ttsStop();
  const clean = cleanForTTS(text);
  if (!clean.trim()) return;
  const code = (profile && profile.target && LANGS[profile.target]) ? profile.target : 'en';
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = LANGS[code].bcp;
  const v = bestVoice(code); if (v) u.voice = v;
  const rate = _clampRate(+S().cfg.ttsRate || 1.0);
  u.rate = code === 'ja' ? Math.min(rate, 1.1) : rate;
  u.pitch = 1;
  _utter = u;
  try { const ss = window.speechSynthesis; ss.resume(); ss.speak(u); } catch (e) {}
}

// Prova voce: legge una frase campione nella lingua indicata.
export function speakSample(code) {
  const samples = {
    ja: 'こんにちは、今日はいい天気ですね。', en: 'Hello, this is a voice test.', it: 'Ciao, questa è una prova di voce.',
    es: 'Hola, esta es una prueba de voz.', fr: 'Bonjour, ceci est un test de voix.', de: 'Hallo, dies ist ein Sprachtest.',
    pt: 'Olá, este é um teste de voz.', zh: '你好，这是一个语音测试。', ko: '안녕하세요, 음성 테스트입니다.', ru: 'Привет, это проверка голоса.',
    ro: 'Salut, acesta este un test de voce.',
  };
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
  if (neuralAvailable()) return speakNeural(text).catch((e) => {
    // Ripiego sulla voce del dispositivo: segnala il motivo alla UI (niente silenzio).
    const quota = /quota|rate|429/i.test(String(e && e.message || e));
    try { window.dispatchEvent(new CustomEvent('lt-tts-fallback', { detail: { quota } })); } catch (_) {}
    speakMsg(text, profile, force);
  });
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
