// ============================================================
//  UI — router minimale + schermate: home, chat (conversazione/lezione/lettura),
//  onboarding, impostazioni. Rendering via innerHTML + event delegation.
// ============================================================
import { S, save, activeProfile, addProfile, updateProfile, removeProfile,
  getConvo, pushMsg, resetConvo, getDiary, clearDiary, diarizedLen, setDiarizedLen,
  getLab, setLab, exportState, importState } from '../core/store.js';
import { LANGS, LANG_CODES, LEVELS, levelLabel, langName, uiLang, t } from '../core/lang.js';
import { configured, MODELS } from '../core/gemini.js';
import { ask, askJSON } from '../core/gemini.js';
import { systemFor, seedFor, lessonSeed, memoryContext, maybeDiarize, chatSchema,
  writingSystem, writingSchema, speechSystem, speechSchema, speechPhraseSeed,
  PERSONAS, PERSONA_LABEL } from '../core/tutor.js';
import { speakTutor, speakSample, ttsStop, ttsAvailable, micAvailable, startDictation, voicesForLang, bestVoice } from '../core/tts.js';
import { GEMINI_TTS_VOICES } from '../core/neural.js';
import { icon } from './icons.js';

// Badge lingua (sostituisce le bandiere emoji): sigla in un chip discreto.
function langBadge(code) { return `<span class="lbadge">${LANGS[code] ? code.toUpperCase() : '?'}</span>`; }

const app = () => document.getElementById('app');
let view = { route: 'main', mode: 'chat', editId: null };
let busy = false;
let rec = null;   // riconoscimento vocale attivo

// ── Utility ──
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderMsgHtml(text) {
  let html = esc(text);
  html = html.replace(/^\s*✏️.*$/gm, (m) => `<span class="corr">${m}</span>`);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return html;
}
// Etichette extra localizzate (oltre al dizionario principale in lang.js).
const SL = {
  neuralOn: { it: 'Voce neurale IA [beta]', en: 'AI neural voice [beta]', ja: 'AIニューラル音声［ベータ］' },
  neuralHelp: { it: 'Più naturale e uguale su ogni dispositivo. Consuma la quota Gemini.', en: 'More natural and identical on every device. Uses Gemini quota.', ja: 'より自然で、全端末で同じ音声。Geminiの無料枠を消費します。' },
  neuralVoice: { it: 'Voce neurale', en: 'Neural voice', ja: 'ニューラル音声' },
  memory: { it: 'Memoria del tutor', en: 'Tutor memory', ja: '先生の記憶' },
  memoryHelp: { it: 'Il tutor ricorda le vostre conversazioni per personalizzare e correggere gli errori ricorrenti.', en: 'The tutor remembers your sessions to personalise lessons and fix recurring mistakes.', ja: '先生は会話を記憶し、レッスンを個別化して繰り返す間違いを直します。' },
  clearMemoryConfirm: { it: 'Cancellare tutta la memoria di questo profilo?', en: 'Clear all memory for this profile?', ja: 'このプロフィールの記憶をすべて消しますか？' },
  writingTab: { it: 'Scrittura', en: 'Writing', ja: '作文' },
  speechTab: { it: 'Pronuncia', en: 'Speaking', ja: '発音' },
  persona: { it: 'Personalità del tutor', en: 'Tutor personality', ja: '先生のタイプ' },
  suggested: { it: 'Risposte suggerite', en: 'Suggested replies', ja: '返答の候補' },
  showTranslation: { it: 'Traduzione', en: 'Translation', ja: '翻訳' },
  showRomaji: { it: 'Rōmaji', en: 'Rōmaji', ja: 'ローマ字' },
  writingPlaceholder: { it: 'Scrivi qui il tuo testo da correggere…', en: 'Write your text to be reviewed here…', ja: '添削してほしい文章をここに…' },
  writingGoal: { it: 'Obiettivo (facoltativo): es. email di lavoro, diario…', en: 'Goal (optional): e.g. work email, diary…', ja: '目的（任意）：仕事のメール、日記など…' },
  analyze: { it: 'Analizza', en: 'Analyze', ja: '分析する' },
  analyzing: { it: 'Analizzo il testo…', en: 'Analyzing…', ja: '分析中…' },
  score: { it: 'Punteggio', en: 'Score', ja: 'スコア' },
  polished: { it: 'Versione migliorata', en: 'Polished version', ja: '改善後' },
  grammarNotes: { it: 'Note grammaticali', en: 'Grammar notes', ja: '文法メモ' },
  vocabTips: { it: 'Vocaboli utili', en: 'Vocabulary', ja: '語彙のヒント' },
  register: { it: 'Registro / tono', en: 'Register / tone', ja: '文体・トーン' },
  targetPhrase: { it: 'Frase da leggere', en: 'Phrase to read', ja: '読む文' },
  newPhrase: { it: 'Nuova frase', en: 'New phrase', ja: '新しい文' },
  record: { it: 'Premi e leggi ad alta voce', en: 'Tap and read aloud', ja: 'タップして音読' },
  listening: { it: 'Ti ascolto…', en: 'Listening…', ja: '聞いています…' },
  evaluating: { it: 'Valuto la pronuncia…', en: 'Evaluating…', ja: '評価中…' },
  accuracy: { it: 'Accuratezza', en: 'Accuracy', ja: '正確さ' },
  fluency: { it: 'Scioltezza', en: 'Fluency', ja: '流暢さ' },
  youSaid: { it: 'Hai detto', en: 'You said', ja: 'あなたの発話' },
  phonetic: { it: 'Guida fonetica', en: 'Phonetic guide', ja: '発音ガイド' },
  feedbackLabel: { it: 'Consiglio', en: 'Feedback', ja: 'アドバイス' },
  micNeeded: { it: 'Il microfono non è supportato su questo browser (usa Android/Chrome).', en: 'Microphone not supported in this browser (use Android/Chrome).', ja: 'このブラウザではマイクを使えません（Android/Chrome推奨）。' },
};
const CAT_LABEL = {
  grammar: { it: 'grammatica', en: 'grammar', ja: '文法' },
  vocabulary: { it: 'vocabolo', en: 'vocabulary', ja: '語彙' },
  politeness_register: { it: 'registro', en: 'register', ja: '敬語・文体' },
  kanji_spelling: { it: 'ortografia', en: 'spelling', ja: '表記' },
  pronunciation: { it: 'pronuncia', en: 'pronunciation', ja: '発音' },
  word_order: { it: 'ordine parole', en: 'word order', ja: '語順' },
};
function catLabel(c) { return (CAT_LABEL[c] && CAT_LABEL[c][uiLang()]) || c || ''; }
function sl(k) { return (SL[k] && SL[k][uiLang()]) || (SL[k] && SL[k].it) || k; }
function errMsg(e) {
  const c = String(e && e.message || e);
  const u = uiLang();
  const M = {
    MISSING_KEY: { it: 'Manca la chiave Gemini: aprila nelle Impostazioni (è gratuita).', en: 'Missing Gemini key: add it in Settings (it’s free).', ja: 'Gemini キーがありません。設定で追加してください（無料）。' },
    BAD_KEY: { it: 'Chiave Gemini non valida. Controllala nelle Impostazioni.', en: 'Invalid Gemini key. Check it in Settings.', ja: 'Gemini キーが無効です。設定を確認してください。' },
    QUOTA: { it: 'Quota gratuita esaurita per ora. Riprova tra un minuto o domani.', en: 'Free quota used up for now. Try again in a minute or tomorrow.', ja: '無料枠を使い切りました。少し待つか明日お試しください。' },
    OVERLOAD: { it: 'Servizio momentaneamente sovraccarico. Riprova tra qualche secondo.', en: 'Service is busy right now. Try again in a few seconds.', ja: 'サーバーが混雑しています。少し待ってからお試しください。' },
    OFFLINE: { it: 'Nessuna connessione: il tutor ha bisogno di internet.', en: 'No connection: the tutor needs internet.', ja: 'インターネット接続が必要です。' },
    PARSE: { it: 'Risposta non valida dal modello. Riprova.', en: 'Invalid response from the model. Try again.', ja: 'モデルの応答が不正です。もう一度お試しください。' },
  };
  if (c.startsWith('LIMIT:')) return { it: `Hai raggiunto il limite di ${c.slice(6)} domande al giorno (modificabile nelle Impostazioni).`, en: `You reached your daily limit of ${c.slice(6)} questions (change it in Settings).`, ja: `1日の質問上限（${c.slice(6)}）に達しました。設定で変更できます。` }[u];
  if (M[c]) return M[c][u];
  return c;
}

// ── Boot ──
export function boot() {
  applyTheme();
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  render();
}
function applyTheme() {
  const th = S().cfg.theme || 'light';
  if (th === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
}
function go(route, patch = {}) { view = { ...view, route, ...patch }; ttsStop(); render(); }

// ── Router ──
function render() {
  const p = activeProfile();
  if (!p && view.route !== 'onboarding') { view.route = 'onboarding'; }
  if (view.route === 'onboarding') return renderOnboarding();
  if (view.route === 'settings') return renderSettings();
  return renderMain();
}

// ── Topbar ──
function topbar(title, sub, opts = {}) {
  const left = opts.back ? `<button class="iconbtn" data-act="back" aria-label="back">${icon('back')}</button>` : '';
  const lang = opts.lang ? `<button class="iconbtn" data-act="cycle-ui" title="lingua / language / 言語">${icon('globe')}</button>` : '';
  const gear = opts.gear ? `<button class="iconbtn" data-act="settings">${icon('settings')}</button>` : '';
  const right = `${lang}${gear}${opts.right || ''}`;
  return `<div class="topbar">${left}<div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div><div class="spacer"></div>${right}</div>`;
}

// ── Schermata principale: header + tab (Chat/Lezione/Lettura/Diario) + pannello ──
// Etichette BREVI per la tab bar (quelle lunghe si sovrappongono su mobile).
const NAV = {
  chat: { it: 'Chat', en: 'Chat', ja: '会話' },
  lesson: { it: 'Lezione', en: 'Lesson', ja: 'レッスン' },
  reading: { it: 'Lettura', en: 'Reading', ja: '読解' },
  writing: { it: 'Scrittura', en: 'Writing', ja: '作文' },
  speech: { it: 'Pronuncia', en: 'Speaking', ja: '発音' },
  diary: { it: 'Diario', en: 'Journal', ja: '記録' },
};
const nav = (k) => (NAV[k] && NAV[k][uiLang()]) || NAV[k].it;
const TABS = [
  { mode: 'chat', ic: 'chat', label: () => nav('chat') },
  { mode: 'lesson', ic: 'lesson', label: () => nav('lesson') },
  { mode: 'reading', ic: 'reading', label: () => nav('reading') },
  { mode: 'scrittura', ic: 'writing', label: () => nav('writing') },
  { mode: 'pronuncia', ic: 'speech', label: () => nav('speech') },
  { mode: 'diario', ic: 'diary', label: () => nav('diary') },
];
const MODE_ICON = { chat: 'chat', lesson: 'lesson', reading: 'reading' };
const CHAT_MODES = ['chat', 'lesson', 'reading'];
function renderMain() {
  const p = activeProfile();
  const tabs = TABS.map((tb) => `<button class="tab ${view.mode === tb.mode ? 'on' : ''}" data-act="tab" data-mode="${tb.mode}"><span class="ti">${icon(tb.ic, { size: 22 })}</span><span class="tl">${tb.label()}</span></button>`).join('');
  const chip = `${langBadge(p.target)}<span class="pn">${esc(p.name)}</span><span class="pm">${langName(p.target)} · ${levelLabel(p.level)}</span>${S().profiles.length > 1 ? icon('swap', { size: 15, cls: 'sw' }) : ''}`;
  app().innerHTML =
    `<div class="topbar main">
       <span class="logo">${icon('logo', { size: 22 })}</span>
       <button class="profilechip" data-act="switch">${chip}</button>
       <div class="spacer"></div>
       <button class="iconbtn" data-act="cycle-ui" title="lingua / language / 言語">${icon('globe')}</button>
       <button class="iconbtn" data-act="settings">${icon('settings')}</button>
     </div>
     <div class="tabbar">${tabs}</div>
     <div id="panel" class="panel"></div>`;
  paintPanel();
}
function paintPanel() {
  const panel = document.getElementById('panel');
  if (!panel) return;
  if (view.mode === 'diario') { panel.innerHTML = diaryHtml(); return; }
  if (view.mode === 'scrittura') return paintWriting(panel);
  if (view.mode === 'pronuncia') return paintSpeech(panel);
  const mode = view.mode;
  const convo = getConvo(mode);
  const actLabel = mode === 'lesson' ? t('newLesson') : mode === 'reading' ? t('newText') : t('resetChat');
  const actName = mode === 'lesson' ? 'new-lesson' : mode === 'reading' ? 'new-text' : 'reset-chat';
  const micBtn = micAvailable() ? `<button class="cbtn mic" data-act="mic" aria-label="mic">${icon('mic', { size: 20 })}</button>` : '';
  const keyBanner = configured() ? '' : `<div class="banner">${t('noKey')} <button data-act="settings">${t('settings')} →</button></div>`;
  panel.innerHTML =
    `${keyBanner}
     <div class="chat-actions"><button data-act="${actName}">${icon('refresh', { size: 15 })} ${actLabel}</button></div>
     <div class="msgs" id="msgs"></div>
     <div class="composer">
       <textarea id="inp" rows="1" placeholder="${t('typeMsg')}"></textarea>
       ${micBtn}
       <button class="cbtn send" data-act="send" aria-label="send">${icon('send', { size: 20 })}</button>
     </div>`;
  paintMsgs();
  const inp = document.getElementById('inp');
  if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
  if (!convo.length) startMode(mode);
}
// Vista Diario: memoria del tutor (errori ricorrenti + cronologia).
function diaryHtml() {
  const p = activeProfile();
  const arr = getDiary(p.id).slice().reverse();
  if (!arr.length) return `<div class="diary-wrap"><div class="empty"><span class="big">${icon('diary', { size: 40, sw: 1.5 })}</span>${t('diaryEmpty')}</div></div>`;
  const errs = getDiary(p.id).slice(-14).map((d) => d.errors).filter((e) => e && !/^\s*nessun/i.test(e));
  const recurring = errs.length ? `<div class="recurring"><div class="rt">${icon('alert', { size: 16 })} ${sl('memory')}</div>${esc(errs.slice(-6).join(' · '))}</div>` : '';
  const items = arr.map((d) => `<div class="di">
      <div class="di-top"><span class="tp">${icon(MODE_ICON[d.mode] || 'chat', { size: 16 })} ${esc(d.topic || '—')}</span><span class="dt">${esc(d.date)}</span></div>
      ${d.summary ? `<div class="di-sum">${esc(d.summary)}</div>` : ''}
      ${d.errors && !/^\s*nessun/i.test(d.errors) ? `<div class="di-err">${icon('alert', { size: 14 })} ${esc(d.errors)}</div>` : ''}
    </div>`).join('');
  return `<div class="diary-wrap">
     <div class="chat-actions"><button class="danger-link" data-act="clear-memory">${icon('trash', { size: 15 })} ${t('clearMemory')}</button></div>
     ${recurring}
     <div class="diary">${items}</div></div>`;
}

// ── Onboarding / creazione-modifica profilo ──
let draft = null;
function renderOnboarding() {
  const editing = !!view.editId;
  const p = editing ? S().profiles.find((x) => x.id === view.editId) : null;
  // Default sensati e sempre validi (target ≠ spiegazione), in base alla lingua UI:
  // UI giapponese → studia italiano, spiega in giapponese (es. la moglie);
  // altrimenti → studia giapponese, spiega nella lingua UI (es. l'utente).
  if (!draft) { const dexpl = uiLang(); draft = p ? { persona: 'friendly', ...p } : { name: '', target: dexpl === 'ja' ? 'it' : 'ja', expl: dexpl, level: 'A2', persona: 'friendly' }; }
  const langBtns = (field) => `<div class="langgrid">${LANG_CODES.map((c) =>
    `<button data-act="draft-${field}" data-v="${c}" class="${draft[field] === c ? 'on' : ''}"><span class="fl">${c.toUpperCase()}</span>${esc(langName(c))}</button>`).join('')}</div>`;
  const personaSeg = `<div class="seg wrap">${PERSONAS.map((pk) => `<button data-act="draft-persona" data-v="${pk}" class="${(draft.persona || 'friendly') === pk ? 'on' : ''}">${PERSONA_LABEL[pk][uiLang()]}</button>`).join('')}</div>`;
  const levelOpts = LEVELS.map((l) => `<option value="${l.id}" ${draft.level === l.id ? 'selected' : ''}>${esc(l[uiLang()] || l.id)}</option>`).join('');
  const canSave = draft.name.trim() && draft.target && draft.expl && draft.target !== draft.expl;
  app().innerHTML =
    topbar(editing ? t('editProfile') : t('appName'), editing ? '' : t('welcome'), { back: S().profiles.length > 0, lang: !editing }) +
    `<div class="content"><div class="form">
      <div class="field"><label>${t('name')}</label><input type="text" id="f-name" value="${esc(draft.name)}" placeholder="${t('name')}"></div>
      <div class="field"><label>${t('iStudy')}</label>${langBtns('target')}</div>
      <div class="field"><label>${t('explainIn')}</label>${langBtns('expl')}</div>
      <div class="field"><label>${t('level')}</label><select id="f-level">${levelOpts}</select></div>
      <div class="field"><label>${sl('persona')}</label>${personaSeg}</div>
      ${draft.target === draft.expl ? `<div class="field hint" style="color:var(--danger)">${t('iStudy')} ≠ ${t('explainIn')}</div>` : ''}
      <button class="btn" data-act="save-profile" ${canSave ? '' : 'disabled style="opacity:.5"'}>${editing ? t('save') : t('createProfile')}</button>
      ${editing && S().profiles.length > 1 ? `<button class="btn danger" data-act="del-profile">${t('delete')}</button>` : ''}
    </div></div>`;
}

function paintMsgs(typing) {
  const box = document.getElementById('msgs');
  if (!box) return;
  const convo = getConvo(view.mode);
  let html = convo.map((m, i) => m.role === 'model' ? renderModelMsg(m, i) : `<div class="msg user">${renderMsgHtml(m.text)}</div>`).join('');
  if (typing) html += `<div class="typing">${busyLabel()} <span class="dots"><span>·</span><span>·</span><span>·</span></span></div>`;
  // Chip "risposte suggerite" dopo l'ultimo turno del tutor.
  const last = convo[convo.length - 1];
  if (!typing && last && last.role === 'model' && last.data && Array.isArray(last.data.suggestedReplies) && last.data.suggestedReplies.length) {
    html += `<div class="chips">${last.data.suggestedReplies.slice(0, 3).map((s) => `<button class="chip" data-act="chip" data-text="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
  }
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}
function speakBtn(i) { return `<button class="speakbtn" data-act="speak" data-i="${i}">${icon('volume', { size: 15 })} ${t('speak')}</button>`; }
function renderCorrections(list) {
  if (!list || !list.length) return '';
  return `<div class="corrs">${list.map((c) => `<div class="corr-card">
      <div class="corr-head"><span class="cat">${esc(catLabel(c.category))}</span></div>
      <div class="corr-body"><span class="was">${esc(c.original || '')}</span> <span class="arr">→</span> <span class="fix">${esc(c.corrected || '')}</span>${c.furigana ? ` <span class="fz">${esc(c.furigana)}</span>` : (c.romaji ? ` <span class="fz">${esc(c.romaji)}</span>` : '')}</div>
      ${c.explanation ? `<div class="why">${esc(c.explanation)}</div>` : ''}
    </div>`).join('')}</div>`;
}
function renderModelMsg(m, i) {
  const d = m.data;
  if (!d) return `<div class="msg model">${renderMsgHtml(m.text)}${ttsAvailable() ? speakBtn(i) : ''}</div>`;
  const corr = renderCorrections(d.corrections);
  const fb = d.feedback && d.feedback.trim() ? `<div class="feedback">${icon('check', { size: 14 })} ${esc(d.feedback)}</div>` : '';
  const reply = `<div class="reply">${renderMsgHtml(d.reply || m.text)}</div>`;
  const romaji = d.romaji && d.romaji.trim() ? `<div class="alt hidden" id="ro-${i}">${esc(d.romaji)}</div>` : '';
  const transl = d.translation && d.translation.trim() ? `<div class="alt hidden" id="tr-${i}">${esc(d.translation)}</div>` : '';
  const tools = `<div class="msgtools">
      ${romaji ? `<button data-act="toggle" data-tid="ro-${i}">${sl('showRomaji')}</button>` : ''}
      ${transl ? `<button data-act="toggle" data-tid="tr-${i}">${sl('showTranslation')}</button>` : ''}
      ${ttsAvailable() ? speakBtn(i) : ''}
    </div>`;
  return `<div class="msg model">${corr}${fb}${reply}${romaji}${transl}${tools}</div>`;
}

// ── Writing Lab ──
function paintWriting(panel) {
  const p = activeProfile();
  const lab = getLab(p.id, 'writing') || {};
  const keyBanner = configured() ? '' : `<div class="banner">${t('noKey')} <button data-act="settings">${t('settings')} →</button></div>`;
  panel.innerHTML = `<div class="lab">
      ${keyBanner}
      <textarea id="w-text" class="lab-input" rows="6" placeholder="${sl('writingPlaceholder')}">${esc(lab.input || '')}</textarea>
      <input type="text" id="w-goal" class="lab-goal" placeholder="${sl('writingGoal')}" value="${esc(lab.goal || '')}">
      <button class="btn" data-act="analyze-writing">${icon('writing', { size: 18 })} ${sl('analyze')}</button>
      <div id="w-result" class="lab-result">${lab.result ? writingResultHtml(lab.result) : ''}</div>
    </div>`;
}
function writingResultHtml(r) {
  const notes = (r.grammarNotes || []).map((n) => `<li>${esc(n)}</li>`).join('');
  const vocab = (r.vocabulary || []).map((n) => `<li>${esc(n)}</li>`).join('');
  return `<div class="scorecard"><div class="score"><span class="num">${Math.round(r.score || 0)}</span><span class="den">/100</span></div><div class="reg">${esc(r.registerTone || '')}</div></div>
    ${renderCorrections(r.corrections)}
    <div class="lab-sec"><h4>${sl('polished')}</h4><div class="polished">${renderMsgHtml(r.polished || '')}</div></div>
    ${r.translation ? `<div class="lab-sec"><h4>${sl('showTranslation')}</h4><div class="muted-block">${esc(r.translation)}</div></div>` : ''}
    ${notes ? `<div class="lab-sec"><h4>${sl('grammarNotes')}</h4><ul>${notes}</ul></div>` : ''}
    ${vocab ? `<div class="lab-sec"><h4>${sl('vocabTips')}</h4><ul>${vocab}</ul></div>` : ''}`;
}
async function analyzeWriting() {
  if (busy) return;
  const p = activeProfile();
  const ta = document.getElementById('w-text'), goalEl = document.getElementById('w-goal');
  const text = (ta ? ta.value : '').trim(), goal = (goalEl ? goalEl.value : '').trim();
  if (!text) return;
  const prev = getLab(p.id, 'writing') || {};
  setLab(p.id, 'writing', { input: text, goal, result: prev.result });
  if (!configured()) { alert(errMsg(new Error('MISSING_KEY'))); return; }
  const res = document.getElementById('w-result');
  if (res) res.innerHTML = `<div class="typing">${sl('analyzing')} <span class="dots"><span>·</span><span>·</span><span>·</span></span></div>`;
  busy = true;
  try {
    const data = await askJSON([{ role: 'user', text }], { system: writingSystem(p, goal) + memoryContext(p), schema: writingSchema, len: 'lunga' });
    setLab(p.id, 'writing', { input: text, goal, result: data });
  } catch (e) { busy = false; if (res) res.innerHTML = `<div class="banner">${esc(errMsg(e))}</div>`; return; }
  busy = false;
  if (view.mode === 'scrittura') paintPanel();
}

// ── Pronuncia (speech eval) ──
function paintSpeech(panel) {
  const p = activeProfile();
  const lab = getLab(p.id, 'speech') || {};
  const micOk = micAvailable();
  const keyBanner = configured() ? '' : `<div class="banner">${t('noKey')} <button data-act="settings">${t('settings')} →</button></div>`;
  panel.innerHTML = `<div class="lab">
      ${keyBanner}
      <div class="lab-sec"><h4>${sl('targetPhrase')}</h4>
        <div class="phrase" id="s-phrase">${lab.phrase ? esc(lab.phrase) : '—'}</div>
        <div class="row" style="margin-top:10px">
          <button class="btn ghost" data-act="new-phrase">${icon('spark', { size: 17 })} ${sl('newPhrase')}</button>
          ${lab.phrase && ttsAvailable() ? `<button class="btn ghost" data-act="speak-phrase" style="flex:0 0 56px" aria-label="listen">${icon('volume', { size: 18 })}</button>` : ''}
        </div>
      </div>
      <button class="btn ${micOk ? '' : 'ghost'}" data-act="record-speech" ${micOk ? '' : 'disabled style="opacity:.6"'}>${icon('mic', { size: 18 })} ${micOk ? sl('record') : sl('micNeeded')}</button>
      <div id="s-result" class="lab-result">${lab.result ? speechResultHtml(lab) : ''}</div>
    </div>`;
}
function speechResultHtml(lab) {
  const r = lab.result;
  return `<div class="scorecard two">
      <div class="score"><span class="lbl">${sl('accuracy')}</span><span class="num">${Math.round(r.accuracyScore || 0)}</span></div>
      <div class="score"><span class="lbl">${sl('fluency')}</span><span class="num">${Math.round(r.fluencyScore || 0)}</span></div>
    </div>
    ${lab.transcript ? `<div class="lab-sec"><h4>${sl('youSaid')}</h4><div class="muted-block">${esc(lab.transcript)}</div></div>` : ''}
    <div class="lab-sec"><h4>${sl('feedbackLabel')}</h4><div>${esc(r.feedback || '')}</div></div>
    ${r.phoneticGuide ? `<div class="lab-sec"><h4>${sl('phonetic')}</h4><div class="muted-block">${esc(r.phoneticGuide)}</div></div>` : ''}
    ${renderCorrections(r.corrections)}`;
}
async function newPhrase() {
  const p = activeProfile();
  if (!configured()) { alert(errMsg(new Error('MISSING_KEY'))); return; }
  const el = document.getElementById('s-phrase'); if (el) el.textContent = '…';
  try {
    const phrase = (await ask([{ role: 'user', text: speechPhraseSeed(p) }], { len: 'breve' })).trim();
    const lab = getLab(p.id, 'speech') || {};
    setLab(p.id, 'speech', { ...lab, phrase, result: null, transcript: '' });
  } catch (e) { alert(errMsg(e)); }
  if (view.mode === 'pronuncia') paintPanel();
}
function recordSpeech(btn) {
  const p = activeProfile();
  if (rec) { try { rec.stop(); } catch (e) {} rec = null; return; }
  if (!micAvailable()) { alert(sl('micNeeded')); return; }
  btn.classList.add('rec'); btn.innerHTML = `${icon('mic', { size: 18 })} ${sl('listening')}`;
  let finalT = '';
  rec = startDictation(p.target, {
    onResult: (txt) => { finalT = txt; },
    onEnd: () => { rec = null; evalSpeech(finalT); },
    onError: () => { rec = null; if (view.mode === 'pronuncia') paintPanel(); },
  });
}
async function evalSpeech(transcript) {
  const p = activeProfile();
  if (!transcript || !transcript.trim()) { if (view.mode === 'pronuncia') paintPanel(); return; }
  if (!configured()) { alert(errMsg(new Error('MISSING_KEY'))); return; }
  const lab = getLab(p.id, 'speech') || {};
  const res = document.getElementById('s-result');
  if (res) res.innerHTML = `<div class="typing">${sl('evaluating')} <span class="dots"><span>·</span><span>·</span><span>·</span></span></div>`;
  try {
    const data = await askJSON([{ role: 'user', text: `Transcript: ${transcript}` }], { system: speechSystem(p, lab.phrase), schema: speechSchema });
    setLab(p.id, 'speech', { ...lab, transcript, result: data });
  } catch (e) { if (res) res.innerHTML = `<div class="banner">${esc(errMsg(e))}</div>`; return; }
  if (view.mode === 'pronuncia') paintPanel();
}
function busyLabel() {
  if (view.mode === 'lesson') return t('preparingLesson');
  if (view.mode === 'reading') return t('preparingText');
  return t('thinking');
}

// Torna alla schermata principale (da impostazioni/onboarding).
function doBack() { draft = null; go(activeProfile() ? 'main' : 'onboarding'); }
// Se la modalità corrente è una conversazione con nuovi scambi, memorizzala nel diario.
function diarizeCurrentIfChat() {
  if (view.route === 'main' && ['chat', 'lesson', 'reading'].includes(view.mode) && configured()) diarizeIfNeeded(activeProfile(), view.mode);
}
// Riassume la conversazione solo se ci sono nuovi scambi non ancora memorizzati.
async function diarizeIfNeeded(profile, mode) {
  if (!profile) return;
  const convo = getConvo(mode);
  const marker = diarizedLen(profile.id, mode);
  if (convo.length - marker < 3) return;
  setDiarizedLen(profile.id, mode, convo.length);
  try { await maybeDiarize(profile, mode, convo); render(); } catch (e) {}
}

// Avvia una modalità vuota con il seme nascosto.
async function startMode(mode) {
  if (!configured()) { pushMsg(mode, 'model', errMsg(new Error('MISSING_KEY'))); paintMsgs(); return; }
  const p = activeProfile();
  const seed = mode === 'lesson' ? lessonSeed(p) : seedFor(p, mode);
  if (!seed) return;
  await callModel(mode, seed);
}
async function doSend() {
  const inp = document.getElementById('inp');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  inp.value = ''; inp.style.height = 'auto';
  return doSendText(text);
}
async function doSendText(text) {
  if (!text || busy) return;
  pushMsg(view.mode, 'user', text);
  paintMsgs();
  if (!configured()) { pushMsg(view.mode, 'model', errMsg(new Error('MISSING_KEY'))); paintMsgs(); return; }
  await callModel(view.mode);
}
// extraHidden: istruzione utente NON memorizzata (seme / "nuovo testo").
// Ogni turno restituisce JSON strutturato (risposta, correzioni tipizzate,
// traduzione, rōmaji, risposte suggerite); memorizzato in msg.data.
async function callModel(mode, extraHidden) {
  if (busy) return;
  busy = true; paintMsgs(true);
  const p = activeProfile();
  const system = systemFor(p, mode) + memoryContext(p);   // memoria iniettata in OGNI modalità
  const convo = getConvo(mode);
  const msgs = convo.map((m) => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text }));
  if (extraHidden) msgs.push({ role: 'user', text: extraHidden });
  let reply, data = null;
  try { data = await askJSON(msgs, { system, schema: chatSchema(p) }); reply = (data.reply || '').trim() || '…'; }
  catch (e) { reply = errMsg(e); data = null; }
  busy = false;
  pushMsg(mode, 'model', reply, data);
  paintMsgs();
  if (S().cfg.tts !== false && S().cfg.autoSpeak) speakTutor(reply, p);
}

// ── Impostazioni ──
function renderSettings() {
  const c = S().cfg;
  const u = uiLang();
  const seg = (name, opts, cur) => `<div class="seg">${opts.map((o) => `<button data-act="set-${name}" data-v="${o.v}" class="${cur === o.v ? 'on' : ''}">${esc(o.l)}</button>`).join('')}</div>`;
  const voiceSelect = (code) => {
    const list = voicesForLang(code);
    const cur = (c.ttsVoices || {})[code] || '';
    const best = bestVoice(code);
    const opts = `<option value="">${(best ? best.name : '—')} (auto)</option>` + list.map((v) => `<option value="${esc(v.name)}" ${cur === v.name ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
    return `<div class="field"><label>${t('voiceFor')} ${langName(code)}</label>
      <div class="row"><select data-act="voice-sel" data-code="${code}" style="flex:1">${opts}</select>
      <button class="iconbtn" data-act="voice-test" data-code="${code}" aria-label="test">${icon('volume', { size: 18 })}</button></div></div>`;
  };
  const profiles = S().profiles.map((pr) => `<div class="pr ${pr.id === S().activeId ? 'on' : ''}">
      <div class="meta"><strong>${esc(pr.name)}</strong><br><small>${langBadge(pr.target)} ${langName(pr.target)} → ${langName(pr.expl)} · ${levelLabel(pr.level)}</small></div>
      ${pr.id === S().activeId ? '' : `<button class="iconbtn" data-act="pick-profile" data-id="${pr.id}" aria-label="select">${icon('check', { size: 18 })}</button>`}
      <button class="iconbtn" data-act="edit-profile" data-id="${pr.id}" aria-label="edit">${icon('edit', { size: 17 })}</button>
    </div>`).join('');
  app().innerHTML =
    topbar(t('settings'), '', { back: true }) +
    `<div class="content">
      <div class="setblock"><h3>${icon('key', { size: 17 })} ${t('geminiKey')}</h3>
        <div class="field">
          <input type="password" id="s-key" value="${esc(c.geminiKey || '')}" placeholder="AIza…" autocomplete="off">
          <div class="hint">${t('geminiKeyHelp')} <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">${t('getKey')} →</a></div>
        </div>
        <div class="field"><label>${t('model')}</label><select id="s-model">${MODELS.map((m) => `<option value="${m.id}" ${c.geminiModel === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></div>
        <div class="field"><label>${t('responseLen')}</label>${seg('len', [{ v: 'breve', l: t('short') }, { v: 'media', l: t('medium') }, { v: 'lunga', l: t('long') }], c.tutorLen)}</div>
        <div class="field"><label>${t('dailyMax')}</label><input type="number" id="s-max" value="${+c.tutorDailyMax || 0}" min="0"><div class="hint">${t('dailyMaxHelp')}</div></div>
      </div>

      <div class="setblock"><h3>${icon('volume', { size: 17 })} ${t('voice')}</h3>
        <div class="toggle" data-act="tog-tts"><span>${t('ttsOn')}</span><span class="sw ${c.tts !== false ? 'on' : ''}"></span></div>
        <div style="height:8px"></div>
        <div class="toggle" data-act="tog-auto"><span>${t('autoSpeak')}</span><span class="sw ${c.autoSpeak ? 'on' : ''}"></span></div>
        <div style="height:12px"></div>
        <div class="field"><label>${t('rate')} — ${(+c.ttsRate || 1).toFixed(2)}×</label><input type="range" id="s-rate" min="0.6" max="1.3" step="0.05" value="${+c.ttsRate || 1}"></div>
        ${LANG_CODES.map(voiceSelect).join('')}
        <div style="height:12px"></div>
        <div class="toggle" data-act="tog-neural"><span>${sl('neuralOn')}</span><span class="sw ${c.ttsNeural ? 'on' : ''}"></span></div>
        <div class="hint" style="margin:6px 2px 0">${sl('neuralHelp')}</div>
        ${c.ttsNeural ? `<div class="field" style="margin-top:12px"><label>${sl('neuralVoice')}</label>
          <div class="row"><select id="s-neuralvoice" style="flex:1">${GEMINI_TTS_VOICES.map((v) => `<option value="${v}" ${c.ttsNeuralVoice === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <button class="iconbtn" data-act="neural-test" aria-label="test">${icon('volume', { size: 18 })}</button></div></div>` : ''}
      </div>

      <div class="setblock"><h3>${icon('globe', { size: 17 })} ${t('uiLangLabel')}</h3>
        ${seg('ui', [{ v: 'it', l: 'Italiano' }, { v: 'en', l: 'English' }, { v: 'ja', l: '日本語' }], u)}
        <div style="height:12px"></div>
        <div class="field"><label>${t('theme')}</label><div class="seg">
          <button data-act="set-theme" data-v="light" class="${(c.theme || 'light') === 'light' ? 'on' : ''}">${icon('sun', { size: 16 })} Light</button>
          <button data-act="set-theme" data-v="dark" class="${c.theme === 'dark' ? 'on' : ''}">${icon('moon', { size: 16 })} Dark</button>
        </div></div>
      </div>

      <div class="setblock"><h3>${icon('user', { size: 17 })} ${t('profiles')}</h3>
        <div class="profilelist">${profiles}</div>
        <div style="height:10px"></div>
        <button class="btn ghost" data-act="add-profile">${icon('plus', { size: 17 })} ${t('newProfile')}</button>
      </div>

      <div class="setblock"><h3>${icon('diary', { size: 17 })} ${sl('memory')}</h3>
        <div class="hint" style="margin-bottom:10px">${sl('memoryHelp')} ${(() => { const n = getDiary(S().activeId).length; return n ? `(${n})` : ''; })()}</div>
        <button class="btn danger" data-act="clear-memory">${icon('trash', { size: 16 })} ${t('clearMemory')}</button>
      </div>

      <div class="setblock"><h3>${icon('archive', { size: 17 })} ${t('backup')}</h3>
        <div class="row"><button class="btn ghost" data-act="export">${icon('download', { size: 16 })} ${t('exportBk')}</button><button class="btn ghost" data-act="import">${icon('upload', { size: 16 })} ${t('importBk')}</button></div>
      </div>
    </div>`;
}

// ── Event delegation ──
function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act, v = b.dataset.v;
  switch (act) {
    case 'back': return doBack();
    case 'settings': diarizeCurrentIfChat(); return go('settings');
    case 'cycle-ui': { const order = ['it', 'en', 'ja']; S().cfg.uiLang = order[(order.indexOf(uiLang()) + 1) % order.length]; save(); return render(); }
    case 'tab': { const m = b.dataset.mode; if (m === view.mode) return; diarizeCurrentIfChat(); view.mode = m; ttsStop(); return renderMain(); }
    case 'switch': return cycleProfile();
    case 'send': return doSend();
    case 'mic': return toggleMic(b);
    case 'chip': return doSendText(b.dataset.text);
    case 'toggle': { const el = document.getElementById(b.dataset.tid); if (el) el.classList.toggle('hidden'); return; }
    case 'analyze-writing': return analyzeWriting();
    case 'new-phrase': return newPhrase();
    case 'speak-phrase': { const lab = getLab(activeProfile().id, 'speech'); if (lab && lab.phrase) speakTutor(lab.phrase, activeProfile(), true); return; }
    case 'record-speech': return recordSpeech(b);
    case 'speak': { const m = getConvo(view.mode)[+b.dataset.i]; if (m) speakTutor(m.text, activeProfile(), true); return; }
    case 'reset-chat': return restartMode(view.mode);
    case 'new-text': paintMsgs(true); return callModel('reading', 'Please give me a brand-new reading passage now, on a different everyday topic than before.');
    case 'new-lesson': return newLesson();
    // onboarding
    case 'draft-target': draft.target = v; return renderOnboarding();
    case 'draft-expl': draft.expl = v; return renderOnboarding();
    case 'draft-persona': draft.persona = v; return renderOnboarding();
    case 'save-profile': return saveProfile();
    case 'del-profile': return delProfile();
    // settings
    case 'set-len': S().cfg.tutorLen = v; save(); return renderSettings();
    case 'set-ui': S().cfg.uiLang = v; save(); return renderSettings();
    case 'set-theme': S().cfg.theme = v; save(); applyTheme(); return renderSettings();
    case 'tog-tts': S().cfg.tts = !(S().cfg.tts !== false); save(); return renderSettings();
    case 'tog-auto': S().cfg.autoSpeak = !S().cfg.autoSpeak; save(); return renderSettings();
    case 'tog-neural': S().cfg.ttsNeural = !S().cfg.ttsNeural; save(); return renderSettings();
    case 'voice-test': return speakSample(b.dataset.code);
    case 'neural-test': return speakTutor('こんにちは。Hello. Ciao, questa è la voce neurale.', activeProfile(), true);
    case 'clear-memory': if (confirm(sl('clearMemoryConfirm'))) { clearDiary(S().activeId); render(); } return;
    case 'pick-profile': S().activeId = b.dataset.id; save(); return renderSettings();
    case 'edit-profile': draft = null; return go('onboarding', { editId: b.dataset.id });
    case 'add-profile': draft = null; return go('onboarding', { editId: null });
    case 'export': return doExport();
    case 'import': return doImport();
  }
}
function onInput(e) {
  const id = e.target.id;
  if (id === 'inp') { e.target.style.height = 'auto'; e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'; return; }
  if (id === 'f-name') { draft.name = e.target.value; const btn = document.querySelector('[data-act="save-profile"]'); if (btn) { const ok = draft.name.trim() && draft.target !== draft.expl; btn.disabled = !ok; btn.style.opacity = ok ? 1 : .5; } return; }
  if (id === 's-key') { S().cfg.geminiKey = e.target.value.trim(); save(); return; }
  if (id === 's-max') { S().cfg.tutorDailyMax = Math.max(0, +e.target.value || 0); save(); return; }
  if (id === 's-rate') { S().cfg.ttsRate = +e.target.value; save(); const lab = e.target.closest('.field').querySelector('label'); if (lab) lab.textContent = `${t('rate')} — ${(+e.target.value).toFixed(2)}×`; return; }
}
function onChange(e) {
  const id = e.target.id, act = e.target.dataset.act;
  if (id === 'f-level') { draft.level = e.target.value; return; }
  if (id === 's-model') { S().cfg.geminiModel = e.target.value; save(); return; }
  if (id === 's-neuralvoice') { S().cfg.ttsNeuralVoice = e.target.value; save(); return; }
  if (act === 'voice-sel') { const code = e.target.dataset.code; S().cfg.ttsVoices[code] = e.target.value; save(); return; }
}

// ── Azioni ──
function saveProfile() {
  if (!draft.name.trim() || draft.target === draft.expl) return;
  const patch = { name: draft.name.trim(), target: draft.target, expl: draft.expl, level: draft.level, persona: draft.persona || 'friendly' };
  if (view.editId) updateProfile(view.editId, patch);
  else addProfile(patch);
  draft = null; view.editId = null; go('main');
}
function delProfile() {
  if (S().profiles.length <= 1) return;
  if (!confirm(t('delete') + '?')) return;
  removeProfile(view.editId); draft = null; view.editId = null; go('settings');
}
function cycleProfile() {
  const ps = S().profiles; if (ps.length < 2) return;
  const i = ps.findIndex((p) => p.id === S().activeId);
  S().activeId = ps[(i + 1) % ps.length].id; save(); render();
}
async function newLesson() { return restartMode('lesson'); }
// Ricomincia una modalità: prima memorizza (diario) la conversazione uscente,
// poi azzera convo + marker e riparte con un nuovo seme.
async function restartMode(mode) {
  const p = activeProfile();
  await diarizeIfNeeded(p, mode);
  resetConvo(mode);
  setDiarizedLen(p.id, mode, 0);
  paintMsgs();
  startMode(mode);
}
function toggleMic(btn) {
  if (rec) { try { rec.stop(); } catch (e) {} rec = null; btn.classList.remove('rec'); return; }
  const code = activeProfile().target;
  const inp = document.getElementById('inp');
  btn.classList.add('rec');
  rec = startDictation(code, {
    onResult: (text) => { if (inp) { inp.value = text; inp.style.height = 'auto'; inp.style.height = Math.min(120, inp.scrollHeight) + 'px'; } },
    onEnd: () => { rec = null; btn.classList.remove('rec'); if (inp && inp.value.trim()) doSend(); },
    onError: () => { rec = null; btn.classList.remove('rec'); alert(t('micUnsupported')); },
  });
}
function doExport() {
  const blob = new Blob([exportState()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `lingua-tutor-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function doImport() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { importState(r.result); applyTheme(); go('main'); } catch (e) { alert('Backup non valido / Invalid backup'); } };
    r.readAsText(f);
  };
  inp.click();
}
