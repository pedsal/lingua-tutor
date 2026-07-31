// ============================================================
//  Lingue supportate + i18n dell'interfaccia.
// ============================================================
import { S } from './store.js';

// name.<uiLang> = come si chiama la lingua nell'interfaccia; native = nome nativo;
// bcp = codice per TTS e riconoscimento vocale; latin = usa alfabeto latino.
export const LANGS = {
  ja: { code: 'ja', bcp: 'ja-JP', latin: false, native: '日本語',   name: { it: 'Giapponese', en: 'Japanese',   ja: '日本語' } },
  en: { code: 'en', bcp: 'en-US', latin: true,  native: 'English',  name: { it: 'Inglese',    en: 'English',    ja: '英語' } },
  it: { code: 'it', bcp: 'it-IT', latin: true,  native: 'Italiano', name: { it: 'Italiano',   en: 'Italian',    ja: 'イタリア語' } },
  es: { code: 'es', bcp: 'es-ES', latin: true,  native: 'Español',  name: { it: 'Spagnolo',   en: 'Spanish',    ja: 'スペイン語' } },
  fr: { code: 'fr', bcp: 'fr-FR', latin: true,  native: 'Français', name: { it: 'Francese',   en: 'French',     ja: 'フランス語' } },
  de: { code: 'de', bcp: 'de-DE', latin: true,  native: 'Deutsch',  name: { it: 'Tedesco',    en: 'German',     ja: 'ドイツ語' } },
  pt: { code: 'pt', bcp: 'pt-BR', latin: true,  native: 'Português',name: { it: 'Portoghese', en: 'Portuguese', ja: 'ポルトガル語' } },
  zh: { code: 'zh', bcp: 'zh-CN', latin: false, native: '中文',     name: { it: 'Cinese',     en: 'Chinese',    ja: '中国語' } },
  ko: { code: 'ko', bcp: 'ko-KR', latin: false, native: '한국어',   name: { it: 'Coreano',    en: 'Korean',     ja: '韓国語' } },
  ru: { code: 'ru', bcp: 'ru-RU', latin: false, native: 'Русский',  name: { it: 'Russo',      en: 'Russian',    ja: 'ロシア語' } },
};
export const LANG_CODES = ['ja', 'en', 'it', 'es', 'fr', 'de', 'pt', 'zh', 'ko', 'ru'];

// Livelli — scala per lingua-obiettivo: JLPT per il giapponese, CEFR per
// inglese/italiano. Entrambe hanno un livello "Introduzione" (alfabeto e basi)
// prima del principiante.
export const LEVEL_SETS = {
  ja: [
    { id: 'intro', it: 'Introduzione — kana e basi', en: 'Introduction — kana & basics', ja: '入門 — かな・基礎' },
    { id: 'N5', it: 'N5 — Principiante',        en: 'N5 — Beginner',            ja: 'N5 — 初級' },
    { id: 'N4', it: 'N4 — Base',                en: 'N4 — Elementary',          ja: 'N4 — 初中級' },
    { id: 'N3', it: 'N3 — Intermedio',          en: 'N3 — Intermediate',        ja: 'N3 — 中級' },
    { id: 'N2', it: 'N2 — Intermedio-alto',     en: 'N2 — Upper-intermediate',  ja: 'N2 — 中上級' },
    { id: 'N1', it: 'N1 — Avanzato',            en: 'N1 — Advanced',            ja: 'N1 — 上級' },
  ],
  cefr: [
    { id: 'intro', it: 'Introduzione — alfabeto e basi', en: 'Introduction — alphabet & basics', ja: '入門 — アルファベット・基礎' },
    { id: 'A1', it: 'A1 — Principiante',        en: 'A1 — Beginner',            ja: 'A1 — 入門' },
    { id: 'A2', it: 'A2 — Elementare',          en: 'A2 — Elementary',          ja: 'A2 — 初級' },
    { id: 'B1', it: 'B1 — Intermedio',          en: 'B1 — Intermediate',        ja: 'B1 — 中級' },
    { id: 'B2', it: 'B2 — Intermedio-alto',     en: 'B2 — Upper-intermediate',  ja: 'B2 — 中上級' },
    { id: 'C1', it: 'C1 — Avanzato',            en: 'C1 — Advanced',            ja: 'C1 — 上級' },
  ],
};
export function levelsFor(target) { return target === 'ja' ? LEVEL_SETS.ja : LEVEL_SETS.cefr; }
export function defaultLevel(target) { return target === 'ja' ? 'N5' : 'A2'; }
export function levelLabel(id, target) {
  const l = levelsFor(target).find((x) => x.id === id);
  return l ? l[uiLang()] : id;
}
export function langName(code, ui = uiLang()) { const l = LANGS[code]; return l ? (l.name[ui] || l.native) : code; }

export function uiLang() { return S().cfg.uiLang || 'it'; }

// ── Dizionario UI ──
const DICT = {
  it: {
    appName: 'Lingua Tutor', tagline: 'Il tuo insegnante di lingue, sempre con te',
    home: 'Home', settings: 'Impostazioni', back: 'Indietro',
    chat: 'Conversazione', chatDesc: 'Parla liberamente e ricevi correzioni',
    lesson: 'Lezione del giorno', lessonDesc: 'Una mini-lezione su misura, ogni giorno',
    reading: 'Lettura', readingDesc: 'Un testo al tuo livello con domande',
    diaryTab: 'Diario', diaryEmpty: 'Il tutor annoterà qui i progressi e gli errori ricorrenti man mano che studiate.',
    newProfile: 'Nuovo profilo', createProfile: 'Crea profilo', editProfile: 'Modifica profilo',
    name: 'Nome', iStudy: 'Voglio studiare', explainIn: 'Spiegami in', level: 'Livello',
    save: 'Salva', cancel: 'Annulla', delete: 'Elimina', start: 'Inizia',
    typeMsg: 'Scrivi un messaggio…', send: 'Invia', mic: 'Parla', speak: 'Ascolta',
    newLesson: 'Nuova lezione', newText: 'Nuovo testo', resetChat: 'Ricomincia',
    thinking: 'Sto pensando…', preparingLesson: 'Preparo la lezione…', preparingText: 'Preparo il testo…',
    geminiKey: 'Chiave Gemini (gratuita)', geminiKeyHelp: 'La chiave resta su questo dispositivo. Serve per far funzionare il tutor.',
    getKey: 'Ottieni una chiave gratis', model: 'Modello', responseLen: 'Lunghezza risposte',
    dailyMax: 'Limite domande al giorno', dailyMaxHelp: '0 = nessun limite', voice: 'Voce',
    ttsOn: 'Pronuncia attiva', autoSpeak: 'Leggi da solo le risposte', rate: 'Velocità voce',
    voiceFor: 'Voce per', uiLangLabel: 'Lingua dell’interfaccia', theme: 'Tema',
    profiles: 'Profili', backup: 'Backup', exportBk: 'Esporta backup', importBk: 'Importa backup',
    noKey: 'Aggiungi la tua chiave Gemini nelle Impostazioni per iniziare.',
    lessonsPast: 'Lezioni recenti', clearMemory: 'Cancella memoria',
    short: 'Breve', medium: 'Media', long: 'Lunga', on: 'Sì', off: 'No',
    micUnsupported: 'Il microfono non è supportato su questo browser (funziona su Android/Chrome).',
    welcome: 'Ciao! Crea un profilo per iniziare.', greeting: 'Bentornato',
    correction: 'Correzione', switchProfile: 'Cambia profilo',
  },
  en: {
    appName: 'Lingua Tutor', tagline: 'Your language teacher, always with you',
    home: 'Home', settings: 'Settings', back: 'Back',
    chat: 'Conversation', chatDesc: 'Talk freely and get corrections',
    lesson: 'Lesson of the day', lessonDesc: 'A tailored mini-lesson, every day',
    reading: 'Reading', readingDesc: 'A text at your level with questions',
    diaryTab: 'Journal', diaryEmpty: 'The tutor will note your progress and recurring mistakes here as you study.',
    newProfile: 'New profile', createProfile: 'Create profile', editProfile: 'Edit profile',
    name: 'Name', iStudy: 'I want to study', explainIn: 'Explain to me in', level: 'Level',
    save: 'Save', cancel: 'Cancel', delete: 'Delete', start: 'Start',
    typeMsg: 'Type a message…', send: 'Send', mic: 'Speak', speak: 'Listen',
    newLesson: 'New lesson', newText: 'New text', resetChat: 'Restart',
    thinking: 'Thinking…', preparingLesson: 'Preparing the lesson…', preparingText: 'Preparing the text…',
    geminiKey: 'Gemini key (free)', geminiKeyHelp: 'The key stays on this device. It powers the tutor.',
    getKey: 'Get a free key', model: 'Model', responseLen: 'Response length',
    dailyMax: 'Daily question limit', dailyMaxHelp: '0 = no limit', voice: 'Voice',
    ttsOn: 'Pronunciation on', autoSpeak: 'Auto-read replies', rate: 'Voice speed',
    voiceFor: 'Voice for', uiLangLabel: 'Interface language', theme: 'Theme',
    profiles: 'Profiles', backup: 'Backup', exportBk: 'Export backup', importBk: 'Import backup',
    noKey: 'Add your Gemini key in Settings to get started.',
    lessonsPast: 'Recent lessons', clearMemory: 'Clear memory',
    short: 'Short', medium: 'Medium', long: 'Long', on: 'On', off: 'Off',
    micUnsupported: 'The microphone is not supported in this browser (works on Android/Chrome).',
    welcome: 'Hi! Create a profile to begin.', greeting: 'Welcome back',
    correction: 'Correction', switchProfile: 'Switch profile',
  },
  ja: {
    appName: 'Lingua Tutor', tagline: 'いつでもそばにいる語学の先生',
    home: 'ホーム', settings: '設定', back: '戻る',
    chat: '会話', chatDesc: '自由に話して、間違いを直してもらおう',
    lesson: '今日のレッスン', lessonDesc: '毎日あなたに合わせたミニレッスン',
    reading: '読解', readingDesc: 'レベルに合った文章と質問',
    diaryTab: '記録', diaryEmpty: '学習が進むと、先生がここに進捗や繰り返す間違いを記録します。',
    newProfile: '新しいプロフィール', createProfile: 'プロフィールを作成', editProfile: 'プロフィールを編集',
    name: '名前', iStudy: '勉強したい言語', explainIn: '説明の言語', level: 'レベル',
    save: '保存', cancel: 'キャンセル', delete: '削除', start: '始める',
    typeMsg: 'メッセージを入力…', send: '送信', mic: '話す', speak: '聞く',
    newLesson: '新しいレッスン', newText: '新しい文章', resetChat: 'やり直す',
    thinking: '考え中…', preparingLesson: 'レッスンを準備中…', preparingText: '文章を準備中…',
    geminiKey: 'Gemini キー（無料）', geminiKeyHelp: 'キーはこの端末に保存されます。先生を動かすために必要です。',
    getKey: '無料キーを取得', model: 'モデル', responseLen: '返答の長さ',
    dailyMax: '1日の質問上限', dailyMaxHelp: '0＝無制限', voice: '音声',
    ttsOn: '発音を有効化', autoSpeak: '返答を自動で読み上げる', rate: '読み上げ速度',
    voiceFor: '音声（言語別）', uiLangLabel: '表示言語', theme: 'テーマ',
    profiles: 'プロフィール', backup: 'バックアップ', exportBk: 'バックアップを書き出す', importBk: 'バックアップを読み込む',
    noKey: '設定で Gemini キーを追加すると始められます。',
    lessonsPast: '最近のレッスン', clearMemory: '記憶を消す',
    short: '短い', medium: '普通', long: '長い', on: 'オン', off: 'オフ',
    micUnsupported: 'このブラウザではマイクを使えません（Android/Chrome で動きます）。',
    welcome: 'ようこそ！まずプロフィールを作成してください。', greeting: 'おかえりなさい',
    correction: '訂正', switchProfile: 'プロフィールを切り替え',
  },
};

export function t(key) {
  const u = uiLang();
  return (DICT[u] && DICT[u][key]) || DICT.it[key] || key;
}
