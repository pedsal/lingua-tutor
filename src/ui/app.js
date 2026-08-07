// ============================================================
//  UI — router minimale + schermate: home, chat (conversazione/lezione/lettura),
//  onboarding, impostazioni. Rendering via innerHTML + event delegation.
// ============================================================
import { S, save, activeProfile, addProfile, updateProfile, removeProfile,
  getConvo, pushMsg, resetConvo, getDiary, clearDiary, diarizedLen, setDiarizedLen,
  getLab, setLab, pushDiary, usageStats, resetUsage, usage, exportState, importState } from '../core/store.js';
import { LANGS, LANG_CODES, levelsFor, defaultLevel, levelLabel, langName, uiLang, t } from '../core/lang.js';
import { configured, MODELS } from '../core/gemini.js';
import { ask, askJSON } from '../core/gemini.js';
import { systemFor, seedFor, lessonSeed, memoryContext, maybeDiarize, chatSchema,
  writingSystem, writingSchema, speechSystem, speechSchema, speechPhraseSeed,
  liveSummarySystem, liveSummarySchema, PERSONAS, PERSONA_LABEL } from '../core/tutor.js';
import { speakTutor, speakSample, ttsStop, ttsAvailable, micAvailable, startDictation, voicesForLang, bestVoice } from '../core/tts.js';
import { GEMINI_TTS_VOICES, NEURAL_TTS_MODEL } from '../core/neural.js';
import { geminiMicAvailable, isRecording, startRecording, stopAndTranscribe, cancelRecording } from '../core/voice-input.js';
import { LiveSession, liveSupported, LIVE_MODEL, LIVE_VOICES } from '../core/live.js';
import { icon } from './icons.js';

// Badge lingua (sostituisce le bandiere emoji): sigla in un chip discreto.
function langBadge(code) { return `<span class="lbadge">${LANGS[code] ? code.toUpperCase() : '?'}</span>`; }

const app = () => document.getElementById('app');
let view = { route: 'main', mode: 'live', editId: null };   // 'live' = modalità principale
let busy = false;
let rec = null;          // riconoscimento vocale attivo
let introStep = 0;       // passo del carosello di introduzione
let deferredPrompt = null;   // evento beforeinstallprompt (Android/Chrome)
let live = null;         // sessione Conversazione live attiva (prototipo)
let liveLog = [];        // trascrizione live: [{role:'user'|'model', text}]

function isStandalone() {
  try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch (e) { return false; }
}
function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent || ''); }
function canInstall() { return !!deferredPrompt || (isIOS() && !isStandalone()); }
async function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (e) {}
    deferredPrompt = null;
    render();
    return;
  }
  alert(isIOS() ? sl('installHelpIos') : sl('installHelpAndroid'));
}

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
  neuralModel: { it: 'Modello', en: 'Model', ja: 'モデル' },
  themeToggle: { it: 'Tema chiaro / scuro', en: 'Light / dark theme', ja: 'ライト／ダークテーマ' },
  // Contatore token
  usageTitle: { it: 'Consumo token', en: 'Token usage', ja: 'トークン使用量' },
  usageTokens: { it: 'token', en: 'tokens', ja: 'トークン' },
  levelIntroShort: { it: 'Intro', en: 'Intro', ja: '入門' },
  sheetLevel: { it: 'Livello di padronanza', en: 'Proficiency level', ja: '習熟レベル' },
  sheetLevelSet: { it: 'Livello impostato:', en: 'Level set:', ja: 'レベル設定：' },
  sheetLiveRestart: { it: 'riavvia la conversazione per applicarlo', en: 'restart the conversation to apply it', ja: '適用するには会話を再開してください' },
  usageReq: { it: 'richieste', en: 'requests', ja: 'リクエスト' },
  usageTokensToday: { it: 'token oggi', en: 'tokens today', ja: '今日のトークン' },
  usageReqToday: { it: 'richieste oggi', en: 'requests today', ja: '今日のリクエスト' },
  usageResetIn: { it: 'all’azzeramento', en: 'until reset', ja: 'リセットまで' },
  usageMinute: { it: 'Nell’ultimo minuto', en: 'In the last minute', ja: '直近1分' },
  usageKindChat: { it: 'Chat, lezioni e correzioni', en: 'Chat, lessons & corrections', ja: 'チャット・レッスン・訂正' },
  usageKindLive: { it: 'Conversazione live', en: 'Live conversation', ja: 'ライブ会話' },
  usageKindTts: { it: 'Voce neurale', en: 'Neural voice', ja: 'ニューラル音声' },
  usageKindMic: { it: 'Microfono via IA', en: 'AI microphone', ja: 'AIマイク' },
  usageShowBar: { it: 'Mostra la barra del consumo', en: 'Show the usage bar', ja: '使用量バーを表示' },
  usageReset: { it: 'Azzera il contatore', en: 'Reset the counter', ja: 'カウンターをリセット' },
  usageResetConfirm: { it: 'Azzerare il contatore dei token? (non cambia la quota di Google)', en: 'Reset the token counter? (does not change Google’s quota)', ja: 'トークンカウンターをリセットしますか？（Googleの枠は変わりません）' },
  usageNote: { it: 'Google non comunica quanti token restano: qui vedi quelli che hai consumato tu. Le quote gratuite si azzerano ogni giorno a mezzanotte ora del Pacifico.', en: 'Google doesn’t report how many tokens are left: this shows what you have used. Free quotas reset daily at midnight Pacific time.', ja: 'Googleは残量を通知しません。ここでは使用量を表示します。無料枠は毎日太平洋時間の午前0時にリセットされます。' },
  // Conversazione vocale live (prototipo)
  liveBeta: { it: 'Prototipo sperimentale', en: 'Experimental prototype', ja: '実験的プロトタイプ' },
  liveOff: { it: 'Non connesso', en: 'Not connected', ja: '未接続' },
  liveConnecting: { it: 'Mi collego…', en: 'Connecting…', ja: '接続中…' },
  liveOn: { it: 'In ascolto — parla liberamente', en: 'Listening — just speak', ja: '聞いています — どうぞ話してください' },
  liveStart: { it: 'Inizia conversazione', en: 'Start conversation', ja: '会話を始める' },
  liveStop: { it: 'Termina', en: 'End', ja: '終了' },
  liveYou: { it: 'Tu', en: 'You', ja: 'あなた' },
  liveTutor: { it: 'Tutor', en: 'Tutor', ja: '先生' },
  liveHint: { it: 'Tocca “Inizia conversazione” e parla: il tutor ti risponde a voce, in tempo reale. Puoi anche interromperlo mentre parla.', en: 'Tap “Start conversation” and speak: the tutor answers with its voice, in real time. You can interrupt it while it speaks.', ja: '「会話を始める」をタップして話してください。先生がリアルタイムで音声で答えます。話している途中で割り込んでもOKです。' },
  liveNote: { it: 'In questa modalità non ci sono le card di correzione delle altre schede: il tutor corregge parlando. Consuma quota Gemini.', en: 'This mode has no correction cards like the other tabs: the tutor corrects by speaking. Uses Gemini quota.', ja: 'このモードには他のタブのような訂正カードはありません（先生が話して直します）。Geminiの無料枠を消費します。' },
  liveUnsupported: { it: 'Questo browser non supporta la conversazione live (serve un browser recente con microfono).', en: 'This browser doesn’t support live conversation (needs a recent browser with microphone).', ja: 'このブラウザはライブ会話に対応していません（マイク対応の最新ブラウザが必要）。' },
  liveFailed: { it: 'Non riesco a collegarmi alla conversazione live. Riprova (o la quota è esaurita).', en: 'Couldn’t connect to the live conversation. Try again (or quota is used up).', ja: 'ライブ会話に接続できませんでした。再試行してください（または無料枠切れ）。' },
  liveVoiceLabel: { it: 'Voce della conversazione live', en: 'Live conversation voice', ja: 'ライブ会話の音声' },
  liveVoiceHelp: { it: 'Voce usata nella scheda Live (conversazione a voce in tempo reale).', en: 'Voice used in the Live tab (real-time spoken conversation).', ja: 'ライブタブ（リアルタイム音声会話）で使う声。' },
  liveModeTutor: { it: 'Tutor', en: 'Tutor', ja: '先生' },
  liveModeAssistant: { it: 'Chiacchierata', en: 'Chat', ja: 'おしゃべり' },
  liveModeTutorHelp: { it: 'Fa l’insegnante: ti corregge subito e ti fa ripetere.', en: 'Acts as a teacher: corrects you right away and has you repeat.', ja: '先生として、すぐ直して復唱させます。' },
  liveModeAssistantHelp: { it: 'Chiacchiera con te senza correggere: conversazione libera e scorrevole.', en: 'Just chats with you without correcting: free, flowing conversation.', ja: '訂正せずに自由に会話します。' },
  liveVoiceShort: { it: 'Voce', en: 'Voice', ja: '音声' },
  liveRestart: { it: 'Nuova conversazione', en: 'New conversation', ja: '新しい会話' },
  liveLast: { it: 'Ultima volta:', en: 'Last time:', ja: '前回：' },
  liveNext: { it: 'Prossimo passo:', en: 'Next step:', ja: '次のステップ：' },
  liveSummarizing: { it: 'Preparo il riassunto della conversazione…', en: 'Preparing the conversation summary…', ja: '会話のまとめを作成中…' },
  liveSummaryTitle: { it: 'Riassunto della conversazione', en: 'Conversation summary', ja: '会話のまとめ' },
  liveNoErrors: { it: 'Nessun errore rilevante: bravo! 🎉', en: 'No significant mistakes — well done!', ja: '大きな間違いはありません。よくできました！' },
  liveSessionTopic: { it: 'Conversazione a voce', en: 'Spoken conversation', ja: '音声会話' },
  liveT1b: { it: 'Chiacchiera liberamente con te, senza correggerti (modalità Chiacchierata).', en: 'Chats freely with you, without correcting (Chat mode).', ja: '訂正せずに自由に会話します（おしゃべりモード）。' },
  liveTeacherSummary: { it: 'Come si comporta il tutor (e istruzioni tue)', en: 'How the tutor behaves (and your instructions)', ja: '先生の振る舞い（と自分の指示）' },
  liveT1: { it: 'Fa l’insegnante: ti ascolta e corregge subito gli errori (dice la forma giusta e ti fa ripetere), massimo 1–2 per volta.', en: 'Acts as a teacher: listens and corrects mistakes right away (says the correct form and has you repeat), max 1–2 per turn.', ja: '先生として、間違いをすぐ直します（正しい形を言って復唱させる）。1回に最大1〜2個。' },
  liveT2: { it: 'Si adatta al tuo livello ({{L}}): non usa parole o strutture più avanzate.', en: 'Adapts to your level ({{L}}): no words or structures above it.', ja: 'あなたのレベル（{{L}}）に合わせ、それ以上の語彙や文法は使いません。' },
  liveT3: { it: 'Usa la personalità scelta nel profilo ({{P}}) e ricorda i tuoi errori ricorrenti dal Diario.', en: 'Uses the personality set in your profile ({{P}}) and remembers your recurring mistakes from the Journal.', ja: 'プロフィールで選んだタイプ（{{P}}）で、記録にある繰り返しの間違いも覚えています。' },
  liveCustom: { it: 'Istruzioni personalizzate (facoltative)', en: 'Custom instructions (optional)', ja: 'カスタム指示（任意）' },
  liveCustomPh: { it: 'Es.: correggimi sempre la pronuncia; parliamo di lavoro; usa solo il presente; sii più severo…', en: 'E.g.: always correct my pronunciation; let’s talk about work; use present tense only; be stricter…', ja: '例：発音も必ず直して／仕事の話をしよう／現在形だけ使って／もっと厳しく…' },
  liveCustomHelp: { it: 'Vengono aggiunte alle istruzioni del tutor. Si applicano alla prossima conversazione che avvii.', en: 'Added to the tutor’s instructions. They apply to the next conversation you start.', ja: '先生の指示に追加されます。次に開始する会話から有効です。' },
  voiceKey: { it: 'Chiave per la voce (facoltativa)', en: 'Voice key (optional)', ja: '音声用キー（任意）' },
  voiceKeyHelp: { it: 'Se metti qui una seconda chiave Gemini di un ALTRO account/progetto Google, la voce neurale userà quella: quota separata → meno errori di limite. Vuota = usa la chiave principale.', en: 'Add a second Gemini key from a DIFFERENT Google account/project here and the neural voice will use it: separate quota → fewer rate-limit errors. Empty = use the main key.', ja: '別のGoogleアカウント/プロジェクトの2つ目のGeminiキーをここに入れると、ニューラル音声はそれを使います（quota分離→制限エラー減）。空なら主キーを使用。' },
  fbQuota: { it: 'Voce neurale al limite (troppe richieste ravvicinate): uso la voce del dispositivo.', en: 'Neural voice rate-limited (too many requests): using the device voice.', ja: 'ニューラル音声がレート制限中：端末の音声を使います。' },
  fbGeneric: { it: 'Voce neurale non disponibile ora: uso la voce del dispositivo.', en: 'Neural voice unavailable now: using the device voice.', ja: 'ニューラル音声が使えません：端末の音声を使います。' },
  voiceHelpSummary: { it: 'Come avere una voce più naturale e istantanea', en: 'How to get a more natural, instant voice', ja: 'より自然で瞬時の音声を使うには' },
  voiceHelpAndroid: { it: 'Android: Impostazioni → Gestione generale → Sintesi vocale → motore Google → installa i dati vocali della lingua.', en: 'Android: Settings → General management → Text-to-speech → Google engine → install the language’s voice data.', ja: 'Android: 設定 → 一般管理 → テキスト読み上げ → Googleエンジン → 言語の音声データをインストール。' },
  voiceHelpIos: { it: 'iPhone/iPad: Impostazioni → Accessibilità → Contenuti pronunciati → Voci → scarica una voce “Premium” o “Migliorata”.', en: 'iPhone/iPad: Settings → Accessibility → Spoken Content → Voices → download a “Premium” or “Enhanced” voice.', ja: 'iPhone/iPad: 設定 → アクセシビリティ → 読み上げコンテンツ → 声 → 「プレミアム」または「高品質」の声をダウンロード。' },
  voiceHelpDesktop: { it: 'PC (Edge/Windows): usa le voci Microsoft “…Natural”.', en: 'PC (Edge/Windows): use the Microsoft “…Natural” voices.', ja: 'PC（Edge/Windows）: Microsoftの「…Natural」音声を使用。' },
  voiceHelpNote: { it: 'Se presente, l’app userà automaticamente la voce naturale locale (istantanea, senza consumare quota).', en: 'If available, the app automatically uses the local natural voice (instant, no quota used).', ja: '端末に自然な音声があれば、アプリが自動で使います（瞬時・quota消費なし）。' },
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
  // Introduzione guidata + installazione
  skip: { it: 'Salta', en: 'Skip', ja: 'スキップ' },
  next: { it: 'Avanti', en: 'Next', ja: '次へ' },
  back2: { it: 'Indietro', en: 'Back', ja: '戻る' },
  startApp: { it: 'Inizia', en: 'Get started', ja: 'はじめる' },
  installApp: { it: 'Installa sul telefono', en: 'Install on your phone', ja: 'スマホにインストール' },
  reviewIntro: { it: 'Rivedi l’introduzione', en: 'Replay the intro', ja: 'はじめにを見直す' },
  appSection: { it: 'App', en: 'App', ja: 'アプリ' },
  installedMsg: { it: 'App già installata ✓', en: 'App already installed ✓', ja: 'インストール済み ✓' },
  installHelpIos: { it: 'Su iPhone/iPad: tocca il pulsante Condividi in basso, poi “Aggiungi a Home”.', en: 'On iPhone/iPad: tap the Share button, then “Add to Home Screen”.', ja: 'iPhone/iPadでは、共有ボタンから「ホーム画面に追加」を選びます。' },
  installHelpAndroid: { it: 'Apri il menu del browser (⋮) e scegli “Installa app” o “Aggiungi a schermata Home”.', en: 'Open the browser menu (⋮) and choose “Install app” or “Add to Home screen”.', ja: 'ブラウザのメニュー（⋮）から「アプリをインストール」または「ホーム画面に追加」を選びます。' },
  introWelcomeT: { it: 'Benvenuto in Lingua Tutor', en: 'Welcome to Lingua Tutor', ja: 'Lingua Tutor へようこそ' },
  introWelcomeB: { it: 'Il tuo insegnante IA personale per giapponese, inglese e italiano: conversazione, lezioni, lettura, scrittura e pronuncia.', en: 'Your personal AI teacher for Japanese, English and Italian: conversation, lessons, reading, writing and pronunciation.', ja: '日本語・英語・イタリア語のためのあなた専用のAI先生。会話・レッスン・読解・作文・発音。' },
  introLearnT: { it: 'Impara dai tuoi errori', en: 'Learn from your mistakes', ja: '間違いから学ぶ' },
  introLearnB: { it: 'Scrivi o parla: il tutor risponde e corregge ogni errore spiegandotelo, con risposte suggerite. E nel Diario ricorda i tuoi progressi.', en: 'Write or speak: the tutor replies and corrects every mistake with an explanation and suggested replies. The Journal remembers your progress.', ja: '書いても話してもOK。先生が間違いを説明付きで直し、返答の候補も提案。記録があなたの進歩を覚えています。' },
  introKeyT: { it: 'Una chiave gratuita', en: 'A free key', ja: '無料のキー' },
  introKeyB: { it: 'Per funzionare serve una chiave Google Gemini gratuita: la incolli una sola volta in Impostazioni e resta solo sul tuo dispositivo.', en: 'It runs on a free Google Gemini key: paste it once in Settings — it stays only on your device.', ja: '無料のGoogle Geminiキーで動きます。設定に一度貼るだけ。キーは端末内だけに保存されます。' },
  introInstallT: { it: 'Installala sul telefono', en: 'Install it on your phone', ja: 'スマホにインストール' },
  introInstallB: { it: 'Aggiungila alla schermata Home per usarla come una vera app, a schermo intero e sempre a portata di mano.', en: 'Add it to your Home screen to use it like a real, full-screen app that’s always at hand.', ja: 'ホーム画面に追加すれば、全画面の本物のアプリのようにいつでも使えます。' },
  micDenied: { it: 'Permesso microfono negato. Attivalo per questo sito nelle impostazioni del browser (tocca il lucchetto accanto all’indirizzo).', en: 'Microphone permission denied. Allow it for this site in your browser settings (tap the lock next to the address).', ja: 'マイクの許可がありません。ブラウザの設定（アドレス横の鍵アイコン）でこのサイトに許可してください。' },
  micNoSpeech: { it: 'Non ho sentito nulla. Se il microfono del browser non funziona (capita su alcuni telefoni), detta col tasto 🎤 della tastiera del telefono.', en: 'I didn’t hear anything. If the browser mic doesn’t work (happens on some phones), dictate with the 🎤 key on your phone’s keyboard.', ja: '音声が聞き取れませんでした。ブラウザのマイクが使えない場合は、キーボードの🎤キーで音声入力してください。' },
  micNoDevice: { it: 'Microfono non disponibile su questo dispositivo.', en: 'No microphone available on this device.', ja: 'この端末にマイクがありません。' },
  micNetwork: { it: 'Il riconoscimento vocale ha bisogno di internet.', en: 'Speech recognition needs an internet connection.', ja: '音声認識にはインターネット接続が必要です。' },
  micLang: { it: 'Questa lingua non è supportata dal riconoscimento vocale del dispositivo.', en: 'This language isn’t supported by the device’s speech recognition.', ja: 'この言語は端末の音声認識に対応していません。' },
  micUnsupportedMsg: { it: 'Il riconoscimento vocale non è disponibile su questo browser (funziona su Android/Chrome).', en: 'Speech recognition isn’t available in this browser (works on Android/Chrome).', ja: 'このブラウザでは音声認識を使えません（Android/Chrome推奨）。' },
  micGeneric: { it: 'Non riesco ad avviare il microfono. Riprova.', en: 'Couldn’t start the microphone. Please try again.', ja: 'マイクを起動できませんでした。もう一度お試しください。' },
  micListening: { it: '🎤 Parla ora…', en: '🎤 Speak now…', ja: '🎤 どうぞ話してください…' },
  micTapToStop: { it: '🎤 Registrazione… tocca di nuovo per fermare', en: '🎤 Recording… tap again to stop', ja: '🎤 録音中…もう一度タップで停止' },
  transcribing: { it: 'Trascrivo…', en: 'Transcribing…', ja: '文字起こし中…' },
  micGeminiOn: { it: 'Microfono via IA (Gemini)', en: 'AI microphone (Gemini)', ja: 'AIマイク（Gemini）' },
  micGeminiHelp: { it: 'Registra e trascrive con la tua chiave Gemini: funziona anche dove il microfono del browser non va (es. alcuni Pixel/iPhone). Tocca per iniziare, tocca di nuovo per fermare. Consuma un po’ di quota.', en: 'Records and transcribes with your Gemini key: works even where the browser mic fails (e.g. some Pixel/iPhone). Tap to start, tap again to stop. Uses some quota.', ja: 'あなたのGeminiキーで録音・文字起こし。ブラウザのマイクが使えない端末（一部のPixel/iPhone）でも動きます。タップで開始、もう一度で停止。少し無料枠を消費します。' },
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
  // Installazione PWA: cattura il prompt nativo (Android/Chrome) per offrirlo in-app.
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; if (view.route === 'intro' || view.route === 'settings') render(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; });
  // Voce neurale che ripiega sul dispositivo: avviso visibile invece del silenzio.
  window.addEventListener('lt-tts-fallback', (e) => toast(sl(e && e.detail && e.detail.quota ? 'fbQuota' : 'fbGeneric')));
  startUsageTicker();
  render();
}

// ── Contatore token in tempo reale ──────────────────────────────────────────
// NB: Google NON espone la quota residua via API; mostriamo quindi il consumo
// reale (usageMetadata), il tetto di richieste impostato dall'utente e il tempo
// che manca all'azzeramento delle quote gratuite (mezzanotte del Pacifico).
const fmtTok = (n) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '') + 'k' : String(n);
function fmtLeft(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function usageBarHtml() {
  if (!S().cfg.showUsage) return '';
  const u = usageStats(), q = usage();
  const reqTxt = q.max ? `${q.used}/${q.max}` : String(u.req);
  const hot = u.minuteTokens > 20000 || (q.max && q.left <= 3);
  return `<button class="usagebar ${hot ? 'hot' : ''}" data-act="usage-info" title="${sl('usageTitle')}">
      ${icon('spark', { size: 13 })}
      <span class="ui"><b>${fmtTok(u.tokens)}</b> ${sl('usageTokens')}</span>
      <span class="sep">·</span>
      <span class="ui">${reqTxt}<span class="u-long"> ${sl('usageReq')}</span></span>
      <span class="sep">·</span>
      <span class="ui">${icon('refresh', { size: 12 })} ${fmtLeft(u.resetMs)}</span>
    </button>`;
}
function paintUsageBar() {
  const el = document.getElementById('usagebar');
  if (!el) return;
  el.innerHTML = usageBarHtml();
}
let _usageTick = null;
function startUsageTicker() {
  clearInterval(_usageTick);
  _usageTick = setInterval(() => { if (view.route === 'main') paintUsageBar(); }, 3000);
}

// ── Pannello rapido dal chip del profilo: livello, profili, modifica ──
// Vive fuori dal render dell'app (come il toast) per non ri-renderizzare il
// pannello attivo (che potrebbe riavviare una modalità).
function closeSheet() { const el = document.getElementById('sheet'); if (el) el.remove(); }
function openProfileSheet() {
  closeSheet();
  const p = activeProfile();
  if (!p) return;
  const levels = levelsFor(p.target).map((l) => `<button class="sheet-item ${p.level === l.id ? 'on' : ''}" data-act="pick-level" data-v="${l.id}">
      <span>${esc(l[uiLang()] || l.id)}</span>${p.level === l.id ? icon('check', { size: 17 }) : ''}</button>`).join('');
  const others = S().profiles.filter((x) => x.id !== p.id);
  const othersHtml = others.length ? `<div class="sheet-h">${t('switchProfile')}</div>` + others.map((x) => `<button class="sheet-item" data-act="sheet-profile" data-id="${x.id}">
      <span>${langBadge(x.target)} ${esc(x.name)} · ${esc(levelLabel(x.level, x.target))}</span></button>`).join('') : '';
  const el = document.createElement('div');
  el.id = 'sheet'; el.className = 'sheet-wrap';
  el.innerHTML = `<div class="sheet-bd" data-act="sheet-close"></div>
    <div class="sheet">
      <div class="sheet-drag"></div>
      <div class="sheet-h">${sl('sheetLevel')} · ${esc(langName(p.target))}</div>
      ${levels}
      ${othersHtml}
      <div class="sheet-h"></div>
      <button class="sheet-item" data-act="sheet-edit">${icon('edit', { size: 16 })} <span>${t('editProfile')}</span></button>
    </div>`;
  document.body.appendChild(el);
}
function pickLevel(id) {
  const p = activeProfile();
  if (!p || p.level === id) { closeSheet(); return; }
  updateProfile(p.id, { level: id });
  closeSheet();
  renderMain();
  toast(`${sl('sheetLevelSet')} ${levelLabel(id, p.target)}${live ? ' · ' + sl('sheetLiveRestart') : ''}`);
}

let _toastT = null;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastT);
  _toastT = setTimeout(() => el.classList.remove('show'), 4200);
}
function isDark() { return (S().cfg.theme || 'light') === 'dark'; }
function applyTheme() {
  if (isDark()) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
}
function go(route, patch = {}) { view = { ...view, route, ...patch }; cancelRecording(); liveStop(); ttsStop(); render(); }

// ── Router ──
function render() {
  const p = activeProfile();
  if (view.route === 'intro') return renderIntro();
  if (!S().cfg.introSeen && !p) { view.route = 'intro'; return renderIntro(); }
  if (!p && view.route !== 'onboarding') { view.route = 'onboarding'; }
  if (view.route === 'onboarding') return renderOnboarding();
  if (view.route === 'settings') return renderSettings();
  return renderMain();
}

// ── Introduzione guidata (primo avvio, o "Rivedi" dalle Impostazioni) ──
function introSlides() {
  const installExtra = isStandalone()
    ? `<div class="intro-note">${sl('installedMsg')}</div>`
    : `<button class="btn ghost intro-install" data-act="install-app">${icon('download', { size: 18 })} ${sl('installApp')}</button>`;
  return [
    { icon: 'logo', title: sl('introWelcomeT'), body: esc(sl('introWelcomeB')) },
    { icon: 'chat', title: sl('introLearnT'), body: esc(sl('introLearnB')) },
    { icon: 'key', title: sl('introKeyT'), body: esc(sl('introKeyB')), extra: `<a class="intro-link" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">${icon('key', { size: 15 })} ${t('getKey')}</a>` },
    { icon: 'download', title: sl('introInstallT'), body: esc(sl('introInstallB')), extra: installExtra },
  ];
}
function renderIntro() {
  const slides = introSlides();
  const i = Math.max(0, Math.min(introStep, slides.length - 1));
  const s = slides[i];
  const last = i === slides.length - 1;
  const dots = slides.map((_, k) => `<span class="dot ${k === i ? 'on' : ''}"></span>`).join('');
  app().innerHTML =
    `<div class="intro">
       <div class="intro-top">
         <button class="iconbtn" data-act="cycle-ui" title="lingua / language / 言語">${icon('globe')}</button>
         <div class="spacer"></div>
         <button class="linkbtn" data-act="intro-skip">${sl('skip')}</button>
       </div>
       <div class="intro-body">
         <div class="intro-ic">${icon(s.icon, { size: 42, sw: 1.6 })}</div>
         <h2>${esc(s.title)}</h2>
         <p>${s.body}</p>
         ${s.extra || ''}
       </div>
       <div class="intro-dots">${dots}</div>
       <div class="intro-nav">
         ${i > 0 ? `<button class="btn ghost" data-act="intro-prev">${sl('back2')}</button>` : ''}
         <button class="btn" data-act="${last ? 'intro-finish' : 'intro-next'}">${last ? sl('startApp') : sl('next')}</button>
       </div>
     </div>`;
}
function endIntro() {
  S().cfg.introSeen = true; save(); introStep = 0;
  go(activeProfile() ? 'main' : 'onboarding');
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
  live: { it: 'Live', en: 'Live', ja: 'ライブ' },
};
const nav = (k) => (NAV[k] && NAV[k][uiLang()]) || NAV[k].it;
// La conversazione live è la modalità PRINCIPALE (prima scheda, sempre presente).
const TABS = [
  { mode: 'live', ic: 'volume', label: () => nav('live') },
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
  const tabsHtml = TABS.map((tb) => `<button class="tab ${view.mode === tb.mode ? 'on' : ''}" data-act="tab" data-mode="${tb.mode}"><span class="ti">${icon(tb.ic, { size: 22 })}</span><span class="tl">${tb.label()}</span></button>`).join('');
  // Su schermi stretti mostriamo la versione breve (il badge già dice la lingua).
  const lvlShort = p.level === 'intro' ? sl('levelIntroShort') : p.level;
  const chip = `${langBadge(p.target)}<span class="pn">${esc(p.name)}</span>`
    + `<span class="pm"><span class="pm-long">${langName(p.target)} · ${levelLabel(p.level, p.target)}</span><span class="pm-short">${esc(lvlShort)}</span></span>`
    + icon('chevron', { size: 15, cls: 'sw' });
  app().innerHTML =
    `<div class="topbar main">
       <span class="logo">${icon('logo', { size: 22 })}</span>
       <button class="profilechip" data-act="switch">${chip}</button>
       <button class="iconbtn" data-act="cycle-theme" title="${sl('themeToggle')}">${icon(isDark() ? 'sun' : 'moon')}</button>
       <button class="iconbtn" data-act="cycle-ui" title="lingua / language / 言語">${icon('globe')}</button>
       <button class="iconbtn" data-act="settings">${icon('settings')}</button>
     </div>
     <div class="tabbar">${tabsHtml}</div>
     <div id="usagebar">${usageBarHtml()}</div>
     <div id="panel" class="panel"></div>`;
  paintPanel();
}
function paintPanel() {
  const panel = document.getElementById('panel');
  if (!panel) return;
  if (view.mode === 'diario') { panel.innerHTML = diaryHtml(); return; }
  if (view.mode === 'scrittura') return paintWriting(panel);
  if (view.mode === 'pronuncia') return paintSpeech(panel);
  if (view.mode === 'live') return paintLive(panel);
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
  if (!draft) { const dexpl = uiLang(); const dtarget = dexpl === 'ja' ? 'it' : 'ja'; draft = p ? { persona: 'friendly', ...p } : { name: '', target: dtarget, expl: dexpl, level: defaultLevel(dtarget), persona: 'friendly' }; }
  const langBtns = (field) => `<div class="langgrid">${LANG_CODES.map((c) =>
    `<button data-act="draft-${field}" data-v="${c}" class="${draft[field] === c ? 'on' : ''}"><span class="fl">${c.toUpperCase()}</span>${esc(langName(c))}</button>`).join('')}</div>`;
  const personaSeg = `<div class="seg wrap">${PERSONAS.map((pk) => `<button data-act="draft-persona" data-v="${pk}" class="${(draft.persona || 'friendly') === pk ? 'on' : ''}">${PERSONA_LABEL[pk][uiLang()]}</button>`).join('')}</div>`;
  const levelOpts = levelsFor(draft.target).map((l) => `<option value="${l.id}" ${draft.level === l.id ? 'selected' : ''}>${esc(l[uiLang()] || l.id)}</option>`).join('');
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
  if (S().cfg.micGemini && geminiMicAvailable()) return geminiMicSpeech(btn);
  if (rec) { try { rec.stop(); } catch (e) {} rec = null; return; }
  if (!micAvailable()) { toast(sl('micUnsupportedMsg')); return; }
  ttsStop();
  btn.classList.add('rec'); btn.innerHTML = `${icon('mic', { size: 18 })} ${sl('listening')}`;
  let finalT = '';
  rec = startDictation(p.target, {
    onStart: () => { toast(sl('micListening')); },
    onResult: (txt) => { finalT = txt; },
    onEnd: () => { rec = null; evalSpeech(finalT); },
    onError: (code) => { rec = null; if (view.mode === 'pronuncia') paintPanel(); micError(code); },
  });
}
async function geminiMicSpeech(btn) {
  if (isRecording()) {
    btn.innerHTML = `${icon('mic', { size: 18 })} ${sl('transcribing')}`;
    let txt = '';
    try { txt = await stopAndTranscribe(LANGS[activeProfile().target].name.en); }
    catch (e) { if (view.mode === 'pronuncia') paintPanel(); toast(errMsg(e)); return; }
    if (view.mode === 'pronuncia') paintPanel();
    evalSpeech(txt);
    return;
  }
  ttsStop();
  try { await startRecording(); btn.classList.add('rec'); btn.innerHTML = `${icon('mic', { size: 18 })} ${sl('micTapToStop')}`; }
  catch (e) { toast(sl('micDenied')); }
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
// ── Conversazione vocale LIVE (prototipo, tab separata) ──
function paintLive(panel) {
  const p = activeProfile();
  const c = S().cfg;
  const st = live ? live.state : 'idle';
  const running = st === 'live' || st === 'connecting';
  const supported = liveSupported();
  const keyBanner = configured() ? '' : `<div class="banner">${t('noKey')} <button data-act="settings">${t('settings')} →</button></div>`;
  const dot = st === 'live' ? 'on' : (st === 'connecting' ? 'wait' : '');
  const stateLabel = st === 'live' ? sl('liveOn') : (st === 'connecting' ? sl('liveConnecting') : sl('liveOff'));
  const logHtml = liveLog.length
    ? liveLog.map((l) => `<div class="lv-line ${l.role}"><span class="who">${l.role === 'user' ? sl('liveYou') : sl('liveTutor')}</span>${esc(l.text)}</div>`).join('')
    : `<div class="empty" style="padding:24px 10px">${sl('liveHint')}</div>`;
  // Ripresa: ultima sessione live salvata nel Diario.
  const lastLive = getDiary(p.id).filter((d) => d.mode === 'live').slice(-1)[0];
  const resume = lastLive && !liveLog.length
    ? `<div class="lv-resume">${icon('diary', { size: 15 })} <span><b>${sl('liveLast')}</b> ${esc(lastLive.topic || '—')}${lastLive.next ? ` · ${sl('liveNext')} ${esc(lastLive.next)}` : ''}</span></div>` : '';
  // Controlli (modalità, voce, personalità) — disabilitati durante la conversazione.
  const dis = running ? 'disabled' : '';
  const controls = `<div class="lv-ctrls ${running ? 'off' : ''}">
      <div class="seg">
        <button data-act="live-mode" data-v="tutor" class="${(c.liveMode || 'tutor') === 'tutor' ? 'on' : ''}" ${dis}>${icon('lesson', { size: 15 })} ${sl('liveModeTutor')}</button>
        <button data-act="live-mode" data-v="assistant" class="${c.liveMode === 'assistant' ? 'on' : ''}" ${dis}>${icon('chat', { size: 15 })} ${sl('liveModeAssistant')}</button>
      </div>
      <div class="row">
        <div class="field" style="flex:1"><label>${sl('liveVoiceShort')}</label>
          <select id="lv-voice" ${dis}>${LIVE_VOICES.map((v) => `<option value="${v}" ${c.liveVoice === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="field" style="flex:1"><label>${sl('persona')}</label>
          <select id="lv-persona" ${dis}>${PERSONAS.map((k) => `<option value="${k}" ${(p.persona || 'friendly') === k ? 'selected' : ''}>${PERSONA_LABEL[k][uiLang()]}</option>`).join('')}</select></div>
      </div>
      <div class="hint">${(c.liveMode || 'tutor') === 'tutor' ? sl('liveModeTutorHelp') : sl('liveModeAssistantHelp')}</div>
    </div>`;
  panel.innerHTML = `<div class="lab live">
      ${keyBanner}
      <div class="lv-badge">${icon('spark', { size: 14 })} ${sl('liveBeta')}</div>
      ${controls}
      <div class="lv-status"><span class="lv-dot ${dot}"></span>${stateLabel}</div>
      ${resume}
      <div class="lv-log" id="lv-log">${logHtml}</div>
      ${supported ? `<div class="row">
          ${running
            ? `<button class="btn danger" data-act="live-stop">${icon('mic', { size: 18 })} ${sl('liveStop')}</button>
               <button class="btn ghost" data-act="live-mute" style="flex:0 0 60px" aria-label="mute">${icon(live && live.muted ? 'mic' : 'volume', { size: 18 })}</button>`
            : `<button class="btn" data-act="live-start">${icon('mic', { size: 18 })} ${liveLog.length ? sl('liveRestart') : sl('liveStart')}</button>`}
        </div>` : `<div class="banner">${sl('liveUnsupported')}</div>`}
      <div id="lv-summary">${liveSummaryHtml()}</div>
      <details class="help"><summary>${sl('liveTeacherSummary')}</summary>
        <ul>
          <li>${(c.liveMode || 'tutor') === 'tutor' ? sl('liveT1') : sl('liveT1b')}</li>
          <li>${sl('liveT2').replace('{{L}}', esc(levelLabel(p.level, p.target)))}</li>
          <li>${sl('liveT3').replace('{{P}}', esc(PERSONA_LABEL[p.persona || 'friendly'][uiLang()]))}</li>
        </ul>
        <div class="field" style="margin-bottom:10px"><label>${sl('liveCustom')}</label>
          <textarea id="lv-instr" rows="3" placeholder="${sl('liveCustomPh')}">${esc(c.liveInstructions || '')}</textarea>
          <div class="hint">${sl('liveCustomHelp')}</div>
        </div>
      </details>
      <div class="hint">${sl('liveNote')}<br><code>${LIVE_MODEL}</code></div>
    </div>`;
  const box = document.getElementById('lv-log'); if (box) box.scrollTop = box.scrollHeight;
}
// Riassunto di fine conversazione (errori da rivedere + cosa fare la prossima volta).
let liveSummary = null;      // { pending:true } | oggetto risultato | null
function liveSummaryHtml() {
  if (!liveSummary) return '';
  if (liveSummary.pending) return `<div class="typing">${sl('liveSummarizing')} <span class="dots"><span>·</span><span>·</span><span>·</span></span></div>`;
  if (liveSummary.error) return `<div class="banner">${esc(liveSummary.error)}</div>`;
  const r = liveSummary;
  const corr = (r.corrections && r.corrections.length) ? renderCorrections(r.corrections) : `<div class="hint">${sl('liveNoErrors')}</div>`;
  return `<div class="lab-sec"><h4>${sl('liveSummaryTitle')}</h4>
      ${r.summary ? `<div style="margin-bottom:8px">${esc(r.summary)}</div>` : ''}
      ${r.praise ? `<div class="feedback" style="margin-bottom:10px">${icon('check', { size: 14 })} ${esc(r.praise)}</div>` : ''}
      ${corr}
      ${r.next ? `<div class="hint" style="margin-top:10px"><b>${sl('liveNext')}</b> ${esc(r.next)}</div>` : ''}
    </div>`;
}
function paintLiveOnly() { if (view.route === 'main' && view.mode === 'live') { const el = document.getElementById('panel'); if (el) paintLive(el); } }
// Accoda il testo al turno corrente (le trascrizioni arrivano a frammenti).
function liveAppend(role, text) {
  if (!text) return;
  const last = liveLog[liveLog.length - 1];
  if (last && last.role === role) last.text += text; else liveLog.push({ role, text });
  if (liveLog.length > 60) liveLog.splice(0, liveLog.length - 60);
  paintLiveOnly();
}
async function liveStart() {
  if (live) return;
  if (!configured()) { toast(errMsg(new Error('MISSING_KEY'))); return; }
  ttsStop();
  const p = activeProfile();
  liveLog = []; liveSummary = null;
  live = new LiveSession(p, {
    onState: () => paintLiveOnly(),
    onUserText: (txt) => liveAppend('user', txt),
    onTutorText: (txt) => liveAppend('model', txt),
    onError: (msg) => { toast(String(msg).slice(0, 160)); },
  });
  paintLiveOnly();
  try {
    await live.start();
    // Fa aprire la lezione al tutor (così non resta un silenzio imbarazzato).
    live.sendText('Inizia tu la lezione parlata: saluta in una frase, di\' in poche parole cosa faremo adesso, e poi fai la prima domanda o fammi ripetere qualcosa — tutto adatto al mio livello.');
  } catch (e) {
    const c = String(e && e.message || e);
    live = null;
    toast(c === 'MISSING_KEY' ? errMsg(new Error('MISSING_KEY')) : (/NotAllowed|Permission|denied/i.test(c) ? sl('micDenied') : sl('liveFailed')));
    paintLiveOnly();
  }
}
function liveStop() {
  if (!live) return;
  const p = activeProfile();
  const log = liveLog.slice();
  live.stop(); live = null;
  paintLiveOnly();
  // Alla fine: riassunto degli errori + salvataggio nel Diario (memoria del tutor).
  if (p && log.length >= 3 && configured()) liveWrapUp(p, log);
}
// Chiude la sessione: chiede all'IA il riassunto (errori + prossimo passo) e lo
// registra nel Diario, così la volta dopo il tutor riprende da dove eravate.
async function liveWrapUp(profile, log) {
  liveSummary = { pending: true };
  paintLiveOnly();
  const transcript = log.slice(-40).map((l) => `${l.role === 'user' ? 'STUDENT' : 'TUTOR'}: ${l.text}`).join('\n').slice(0, 7000);
  let r = null;
  try {
    r = await askJSON([{ role: 'user', text: transcript }], { system: liveSummarySystem(profile), schema: liveSummarySchema, len: 'lunga', noCount: true, temperature: 0.2 });
  } catch (e) { liveSummary = { error: errMsg(e) }; paintLiveOnly(); return; }
  liveSummary = r;
  // Nel Diario: argomento, errori sintetici e cosa fare la prossima volta.
  const errs = (r.corrections || []).map((c) => `${c.original} → ${c.corrected}`).slice(0, 5).join('; ');
  pushDiary(profile.id, {
    mode: 'live',
    topic: (r.summary || '').split(/[.!?]/)[0].slice(0, 70) || sl('liveSessionTopic'),
    errors: errs || 'nessuno',
    summary: r.summary || '',
    next: r.next || '',
  });
  paintLiveOnly();
}
function liveToggleMute() { if (!live) return; live.setMuted(!live.muted); paintLiveOnly(); }

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
  paintUsageBar();
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
      <div class="meta"><strong>${esc(pr.name)}</strong><br><small>${langBadge(pr.target)} ${langName(pr.target)} → ${langName(pr.expl)} · ${levelLabel(pr.level, pr.target)}</small></div>
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
        ${(() => { const used = [...new Set(S().profiles.flatMap((p) => [p.target, p.expl]))].filter(Boolean); return (used.length ? used : ['ja', 'it']).map(voiceSelect).join(''); })()}
        <div style="height:12px"></div>
        <div class="toggle" data-act="tog-neural"><span>${sl('neuralOn')}</span><span class="sw ${c.ttsNeural ? 'on' : ''}"></span></div>
        <div class="hint" style="margin:6px 2px 0">${sl('neuralHelp')}</div>
        <div class="hint" style="margin:6px 2px 0">${sl('neuralModel')}: <code>${NEURAL_TTS_MODEL}</code></div>
        <div class="field" style="margin-top:12px"><label>${sl('voiceKey')}</label>
          <input type="password" id="s-key-tts" value="${esc(c.geminiKeyTTS || '')}" placeholder="AIza… / AQ.…" autocomplete="off">
          <div class="hint">${sl('voiceKeyHelp')}</div>
        </div>
        <div style="height:14px"></div>
        <div class="toggle" data-act="tog-micgemini"><span>${sl('micGeminiOn')}</span><span class="sw ${c.micGemini ? 'on' : ''}"></span></div>
        <div class="hint" style="margin:6px 2px 0">${sl('micGeminiHelp')}</div>
        <div style="height:14px"></div>
        <div class="field"><label>${sl('liveVoiceLabel')}</label>
          <select id="s-livevoice">${LIVE_VOICES.map((v) => `<option value="${v}" ${c.liveVoice === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <div class="hint">${sl('liveVoiceHelp')}</div>
        </div>
        ${c.ttsNeural ? `<div class="field" style="margin-top:12px"><label>${sl('neuralVoice')}</label>
          <div class="row"><select id="s-neuralvoice" style="flex:1">${GEMINI_TTS_VOICES.map((v) => `<option value="${v}" ${c.ttsNeuralVoice === v ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <button class="iconbtn" data-act="neural-test" aria-label="test">${icon('volume', { size: 18 })}</button></div></div>` : ''}
        <details class="help"><summary>${sl('voiceHelpSummary')}</summary>
          <ul><li>${sl('voiceHelpAndroid')}</li><li>${sl('voiceHelpIos')}</li><li>${sl('voiceHelpDesktop')}</li></ul>
          <div class="hint">${sl('voiceHelpNote')}</div>
        </details>
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

      <div class="setblock"><h3>${icon('spark', { size: 17 })} ${sl('usageTitle')}</h3>
        ${(() => {
          const u = usageStats(), q = usage();
          const kinds = [['chat', sl('usageKindChat')], ['live', sl('usageKindLive')], ['tts', sl('usageKindTts')], ['mic', sl('usageKindMic')]]
            .filter(([k]) => u.byKind[k]).map(([k, lab]) => `<li>${lab}: <b>${fmtTok(u.byKind[k])}</b></li>`).join('');
          return `<div class="usagegrid">
              <div class="ub"><span class="n">${fmtTok(u.tokens)}</span><span class="l">${sl('usageTokensToday')}</span></div>
              <div class="ub"><span class="n">${q.max ? `${q.used}/${q.max}` : u.req}</span><span class="l">${sl('usageReqToday')}</span></div>
              <div class="ub"><span class="n">${fmtLeft(u.resetMs)}</span><span class="l">${sl('usageResetIn')}</span></div>
            </div>
            ${kinds ? `<ul class="usagelist">${kinds}</ul>` : ''}
            <div class="hint" style="margin-top:8px">${sl('usageMinute')}: <b>${fmtTok(u.minuteTokens)}</b> ${sl('usageTokens')} / ${u.minuteReq} ${sl('usageReq')}</div>
            <div class="hint" style="margin-top:8px">${sl('usageNote')}</div>`;
        })()}
        <div style="height:12px"></div>
        <div class="toggle" data-act="tog-usage"><span>${sl('usageShowBar')}</span><span class="sw ${c.showUsage ? 'on' : ''}"></span></div>
        <div style="height:10px"></div>
        <button class="btn danger" data-act="reset-usage">${icon('refresh', { size: 16 })} ${sl('usageReset')}</button>
      </div>

      <div class="setblock"><h3>${icon('logo', { size: 17 })} ${sl('appSection')}</h3>
        ${isStandalone() ? `<div class="hint" style="margin-bottom:10px">${sl('installedMsg')}</div>` : `<button class="btn ghost" data-act="install-app" style="margin-bottom:10px">${icon('download', { size: 16 })} ${sl('installApp')}</button>`}
        <button class="btn ghost" data-act="review-intro">${icon('chat', { size: 16 })} ${sl('reviewIntro')}</button>
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
    case 'intro-next': introStep++; return renderIntro();
    case 'intro-prev': introStep = Math.max(0, introStep - 1); return renderIntro();
    case 'intro-skip': case 'intro-finish': return endIntro();
    case 'install-app': return installApp();
    case 'review-intro': introStep = 0; return go('intro');
    case 'cycle-ui': { const order = ['it', 'en', 'ja']; S().cfg.uiLang = order[(order.indexOf(uiLang()) + 1) % order.length]; save(); return render(); }
    case 'cycle-theme': S().cfg.theme = isDark() ? 'light' : 'dark'; save(); applyTheme(); return render();
    case 'usage-info': return go('settings');
    case 'tog-usage': S().cfg.showUsage = !S().cfg.showUsage; save(); return renderSettings();
    case 'reset-usage': if (confirm(sl('usageResetConfirm'))) { resetUsage(); renderSettings(); } return;
    case 'tab': { const m = b.dataset.mode; if (m === view.mode) return; diarizeCurrentIfChat(); view.mode = m; cancelRecording(); liveStop(); ttsStop(); return renderMain(); }
    case 'switch': return openProfileSheet();
    case 'sheet-close': return closeSheet();
    case 'pick-level': return pickLevel(v);
    case 'sheet-profile': closeSheet(); S().activeId = b.dataset.id; save(); return render();
    case 'sheet-edit': { const p = activeProfile(); closeSheet(); draft = null; return go('onboarding', { editId: p ? p.id : null }); }
    case 'send': return doSend();
    case 'mic': return toggleMic(b);
    case 'chip': return doSendText(b.dataset.text);
    case 'toggle': { const el = document.getElementById(b.dataset.tid); if (el) el.classList.toggle('hidden'); return; }
    case 'live-mode': S().cfg.liveMode = v; save(); return paintLiveOnly();
    case 'live-start': return liveStart();
    case 'live-stop': return liveStop();
    case 'live-mute': return liveToggleMute();
    case 'analyze-writing': return analyzeWriting();
    case 'new-phrase': return newPhrase();
    case 'speak-phrase': { const lab = getLab(activeProfile().id, 'speech'); if (lab && lab.phrase) speakTutor(lab.phrase, activeProfile(), true); return; }
    case 'record-speech': return recordSpeech(b);
    case 'speak': { const m = getConvo(view.mode)[+b.dataset.i]; if (m) speakTutor(m.text, activeProfile(), true); return; }
    case 'reset-chat': return restartMode(view.mode);
    case 'new-text': paintMsgs(true); return callModel('reading', 'Please give me a brand-new reading passage now, on a different everyday topic than before.');
    case 'new-lesson': return newLesson();
    // onboarding
    case 'draft-target': draft.target = v; if (!levelsFor(v).some((l) => l.id === draft.level)) draft.level = defaultLevel(v); return renderOnboarding();
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
    case 'tog-micgemini': S().cfg.micGemini = !S().cfg.micGemini; save(); return renderSettings();
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
  if (id === 's-key-tts') { S().cfg.geminiKeyTTS = e.target.value.trim(); save(); return; }
  if (id === 'lv-instr') { S().cfg.liveInstructions = e.target.value; save(); return; }
  if (id === 's-max') { S().cfg.tutorDailyMax = Math.max(0, +e.target.value || 0); save(); return; }
  if (id === 's-rate') { S().cfg.ttsRate = +e.target.value; save(); const lab = e.target.closest('.field').querySelector('label'); if (lab) lab.textContent = `${t('rate')} — ${(+e.target.value).toFixed(2)}×`; return; }
}
function onChange(e) {
  const id = e.target.id, act = e.target.dataset.act;
  if (id === 'f-level') { draft.level = e.target.value; return; }
  if (id === 's-model') { S().cfg.geminiModel = e.target.value; save(); return; }
  if (id === 's-neuralvoice') { S().cfg.ttsNeuralVoice = e.target.value; save(); return; }
  if (id === 's-livevoice' || id === 'lv-voice') { S().cfg.liveVoice = e.target.value; save(); return; }
  if (id === 'lv-persona') { const p = activeProfile(); if (p) updateProfile(p.id, { persona: e.target.value }); paintLiveOnly(); return; }
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
  if (S().cfg.micGemini && geminiMicAvailable()) return geminiMicChat(btn);
  if (rec) { try { rec.stop(); } catch (e) {} rec = null; btn.classList.remove('rec'); return; }
  const code = activeProfile().target;
  const inp = document.getElementById('inp');
  ttsStop();   // ferma l'eventuale voce in corso: su mobile può bloccare il microfono
  btn.classList.add('rec');
  let got = false;
  rec = startDictation(code, {
    onStart: () => { toast(sl('micListening')); },
    onResult: (text) => { if (text && text.trim()) got = true; if (inp) { inp.value = text; inp.style.height = 'auto'; inp.style.height = Math.min(120, inp.scrollHeight) + 'px'; } },
    onEnd: () => { rec = null; btn.classList.remove('rec'); if (inp && inp.value.trim()) doSend(); else if (!got) toast(sl('micNoSpeech')); },
    onError: (code2) => { rec = null; btn.classList.remove('rec'); micError(code2); },
  });
}
// Microfono via IA Gemini (chat): 1° tap avvia la registrazione, 2° tap ferma e
// trascrive. Bypassa il servizio vocale di sistema (utile su Pixel/iPhone).
async function geminiMicChat(btn) {
  const inp = document.getElementById('inp');
  if (isRecording()) {
    toast(sl('transcribing'));
    let txt = '';
    try { txt = await stopAndTranscribe(LANGS[activeProfile().target].name.en); }
    catch (e) { btn.classList.remove('rec'); toast(errMsg(e)); return; }
    btn.classList.remove('rec');
    if (txt && txt.trim()) { if (inp) inp.value = txt; doSendText(txt); } else toast(sl('micNoSpeech'));
    return;
  }
  ttsStop();
  try { await startRecording(); btn.classList.add('rec'); toast(sl('micTapToStop')); }
  catch (e) { toast(sl('micDenied')); }
}
// Messaggi chiari per i vari errori del riconoscimento vocale (invece del generico
// "non supportato"), così l'utente capisce (permesso, nessun parlato, rete…).
function micError(code) {
  const map = {
    'not-allowed': 'micDenied', 'service-not-allowed': 'micDenied',
    'no-speech': 'micNoSpeech', 'audio-capture': 'micNoDevice',
    'network': 'micNetwork', 'language-not-supported': 'micLang',
    'unsupported': 'micUnsupportedMsg', 'aborted': null,
  };
  const key = code in map ? map[code] : 'micGeneric';
  if (key) toast(sl(key));
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
