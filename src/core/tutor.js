// ============================================================
//  Tutor — costruzione dei prompt per le tre modalità (conversazione, lezione,
//  lettura), memoria delle lezioni (diario) e generazione della lezione del
//  giorno. Multilingua: adatta lingua-obiettivo, lingua di spiegazione e livello.
// ============================================================
import { ask } from './gemini.js';
import { LANGS, langName } from './lang.js';
import { getDiary, pushDiary, getConvo } from './store.js';

// Nome della lingua in INGLESE (per il modello) e nome nativo (per l'output).
function meta(profile) {
  const target = LANGS[profile.target], expl = LANGS[profile.expl];
  const level = profile.level;
  const levelText = level === 'intro'
    ? (profile.target === 'ja'
        ? 'absolute beginner just starting the language (learning hiragana and katakana and the very first words)'
        : 'absolute beginner just starting the language (learning the alphabet, pronunciation and the very first words)')
    : (profile.target === 'ja' ? `JLPT ${level}` : `CEFR ${level}`);
  return {
    targetEn: target.name.en, targetNative: target.native, targetLatin: target.latin,
    explEn: expl.name.en, explNative: expl.native,
    level, levelText, name: profile.name, persona: profile.persona || 'friendly',
  };
}


// Personalità del tutor (una leva di personalizzazione, come nell'app di riferimento).
export const PERSONAS = ['friendly', 'strict', 'cultural', 'business'];
export const PERSONA_LABEL = {
  friendly: { it: 'Amichevole', en: 'Friendly', ja: 'フレンドリー' },
  strict: { it: 'Severo', en: 'Strict', ja: '厳格' },
  cultural: { it: 'Culturale', en: 'Cultural', ja: '文化的' },
  business: { it: 'Business', en: 'Business', ja: 'ビジネス' },
};
export const PERSONA_PROMPT = {
  friendly: 'Encouraging, warm, endless patience; praise the learner\'s attempts and keep it light.',
  strict: 'Precise and demanding on grammatical accuracy; give formal, detailed, rigorous corrections.',
  cultural: 'Weave in cultural notes, idioms and social context (customs and etiquette in Japan / Italy / UK / USA).',
  business: 'Focus on formal register, work emails and professional etiquette (keigo in Japanese, formal register in Italian/English).',
};

// Fascia didattica dal livello: quanto usare la lingua-obiettivo vs la lingua che
// lo studente capisce già. È la chiave della calibrazione per principianti.
export function tier(profile) {
  const l = profile.level;
  if (l === 'intro') return 'intro';
  if (l === 'N5' || l === 'A1') return 'beginner';
  if (l === 'N4' || l === 'A2') return 'elementary';
  return 'advanced';
}
export const EXPLANATION_VOICE_LEVELS = ['intro', 'N5', 'A1'];   // usato anche dal TTS

function langPolicy(profile) {
  const m = meta(profile);
  const writing = profile.target === 'ja' ? 'hiragana, then katakana' : 'the alphabet and its sounds';
  return {
    intro: `\n\nLANGUAGE POLICY — ABSOLUTE INTRODUCTION: the student does NOT understand ${m.targetEn} yet. Speak and explain ALMOST ENTIRELY in ${m.explNative}. Do NOT hold a conversation in ${m.targetEn} and do NOT dump ${m.targetEn} text on them. Instead, gently INTRODUCE the language: start from the writing system and sounds (${writing}) and the very first essential words/greetings, only a FEW at a time, each with its reading and its meaning in ${m.explNative}. Keep every turn very short, and check the student has understood before adding anything new.`,
    beginner: `\n\nLANGUAGE POLICY — BEGINNER: speak MOSTLY in ${m.explNative}. Introduce short ${m.targetEn} phrases GRADUALLY, always with reading and meaning in ${m.explNative}. Invite the student to try very short phrases; go slowly and build up.`,
    elementary: `\n\nLANGUAGE POLICY — ELEMENTARY: use a balance of ${m.explNative} and simple ${m.targetEn}; gloss every new word in ${m.explNative}. Increase ${m.targetEn} slowly as the student keeps up.`,
    advanced: `\n\nLANGUAGE POLICY: speak mostly in ${m.targetEn}, adding brief ${m.explNative} help only for words likely unknown at this level.`,
  }[tier(profile)];
}

function base(profile) {
  const m = meta(profile);
  const scriptNote = profile.target === 'ja'
    ? `\n- When you write ${m.targetEn}, add the reading in rōmaji in parentheses the first time a word appears, e.g. 学校 (gakkō), and keep sentences short at low levels.`
    : '';
  return `You are an expert, warm and patient private language tutor.
The student's name is ${m.name}. They are learning ${m.targetEn} at level: ${m.levelText}.
Explanation language: ${m.explNative}. ALWAYS write your explanations, encouragement and instructions in ${m.explNative}.

Tutor style: ${PERSONA_PROMPT[m.persona] || PERSONA_PROMPT.friendly}

Core rules:
- Adapt vocabulary and grammar strictly to the student's level (${m.levelText}). Do not overwhelm the student.
- Be encouraging but get to the point; no empty filler.
- Never invent facts about the language; if unsure, say so.${scriptNote}${langPolicy(profile)}`;
}

// Istruzione condivisa per l'output STRUTTURATO delle modalità conversazionali.
function structuredNote(profile) {
  const m = meta(profile);
  return `

Return a STRUCTURED JSON object with these fields:
- "reply": your message to the student. ${tier(profile) === 'intro' || tier(profile) === 'beginner'
    ? `Write it MOSTLY in ${m.explNative} (the language the student understands), embedding only the few ${m.targetEn} words/phrases you are introducing, each with its reading and meaning. Do NOT write long ${m.targetEn} text.`
    : `Write it in ${m.targetEn} (the conversation/lesson/passage text the student reads).`}
- "translation": ${tier(profile) === 'intro' || tier(profile) === 'beginner' ? `full ${m.explNative} version if the reply contains ${m.targetEn}, else "".` : `full translation of "reply" into ${m.explNative}.`}
- "romaji": ${profile.target === 'ja' ? 'the rōmaji transliteration of "reply".' : 'empty string "".'}
- "feedback": ONE short sentence in ${m.explNative} assessing the student's last message. If it was perfect, give a specific compliment. If the student has not written yet, leave "".
- "corrections": array of the student's mistakes in their LAST message. For each: "original" (their exact wrong fragment), "corrected", "explanation" (in ${m.explNative}), "category" (one of grammar, vocabulary, politeness_register, kanji_spelling, pronunciation, word_order)${profile.target === 'ja' ? ', "romaji" and "furigana" for the corrected fragment' : ''}. Empty array if no mistakes. Never invent errors.
- "suggestedReplies": array of exactly 3 short natural phrases in ${m.targetEn} the student could say next.`;
}

// ── System prompt per modalità ──
export function systemFor(profile, mode, extra = '') {
  const m = meta(profile);
  const b = base(profile);
  if (mode === 'chat') {
    return `${b}

Mode: FREE CONVERSATION.
- Follow the LANGUAGE POLICY above for how much ${m.targetEn} vs ${m.explNative} to use at this level (at intro/beginner, guide gently and mostly in ${m.explNative} — do NOT launch a target-language conversation).
- Keep it warm and relatable; end by inviting the student to try a small step suited to their level.
- Put any error correction in the "corrections" field (not inside "reply").${structuredNote(profile)}
${extra}`;
  }
  if (mode === 'lesson') {
    return `${b}

Mode: GUIDED LESSON. You are teaching a focused mini-lesson.
- Teach ONE clear point chosen for level ${m.levelText} (at intro: the writing system / sounds / very first words; at beginner: one simple structure or a few words).
- Follow the LANGUAGE POLICY above: at intro/beginner explain mostly in ${m.explNative} and introduce ${m.targetEn} in tiny, glossed steps.
- Structure the turn: short explanation, 1–3 examples with reading and meaning, then a small exercise; keep each turn short like a real lesson.
- Put corrections of the student's attempts in the "corrections" field.${structuredNote(profile)}
${extra}`;
  }
  if (mode === 'reading') {
    return `${b}

Mode: READING PRACTICE.
- At intro/beginner the student can barely read yet: instead of a passage, present just a FEW simple ${m.targetEn} words or characters, each with its reading and meaning in ${m.explNative}, and one tiny recognition task. At elementary and above, give a SHORT reading passage in ${m.targetEn} (4–7 sentences) for level ${m.levelText}, then a short vocabulary list (word — meaning) and 2 comprehension questions.
- When the student answers, put corrections in the "corrections" field and react in "reply".${structuredNote(profile)}
${extra}`;
  }
  return b;
}

// ── Schema JSON per l'output conversazionale strutturato ──
export function chatSchema(profile) {
  const corrProps = {
    original: { type: 'STRING' }, corrected: { type: 'STRING' },
    explanation: { type: 'STRING' }, category: { type: 'STRING' },
  };
  if (profile.target === 'ja') { corrProps.romaji = { type: 'STRING' }; corrProps.furigana = { type: 'STRING' }; }
  return {
    type: 'OBJECT',
    properties: {
      reply: { type: 'STRING' }, translation: { type: 'STRING' }, romaji: { type: 'STRING' }, feedback: { type: 'STRING' },
      corrections: { type: 'ARRAY', items: { type: 'OBJECT', properties: corrProps, required: ['original', 'corrected', 'explanation', 'category'] } },
      suggestedReplies: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['reply', 'feedback', 'corrections', 'suggestedReplies'],
  };
}

// ── Writing Lab: analisi di un testo scritto ──
export function writingSystem(profile, goal) {
  const m = meta(profile);
  return `You are a native-level writing reviewer and professor of ${m.targetEn}, correcting for an ${m.explNative}-speaking student at level ${m.levelText}.${m.persona ? ` Style: ${PERSONA_PROMPT[m.persona]}` : ''}
Writing goal: ${goal || 'general'}.
Analyse the student's text and return STRUCTURED JSON:
- "score": integer 0-100 for overall quality at their level.
- "polished": a natural, fluent, native rewrite in ${m.targetEn}.
- "corrections": array of {original, corrected, explanation (in ${m.explNative}), category}.
- "grammarNotes": array of 3-4 key grammar tips (in ${m.explNative}) drawn from the text.
- "vocabulary": array of more natural/advanced words or expressions the student could use (in ${m.targetEn}, with a short gloss in ${m.explNative}).
- "registerTone": the register/tone of the text (e.g. Formale, Informale, Keigo).
- "translation": full translation of the corrected text into ${m.explNative}.`;
}
export const writingSchema = {
  type: 'OBJECT',
  properties: {
    score: { type: 'NUMBER' }, polished: { type: 'STRING' }, registerTone: { type: 'STRING' }, translation: { type: 'STRING' },
    corrections: { type: 'ARRAY', items: { type: 'OBJECT', properties: { original: { type: 'STRING' }, corrected: { type: 'STRING' }, explanation: { type: 'STRING' }, category: { type: 'STRING' } }, required: ['original', 'corrected', 'explanation'] } },
    grammarNotes: { type: 'ARRAY', items: { type: 'STRING' } },
    vocabulary: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['score', 'polished', 'corrections', 'grammarNotes', 'vocabulary', 'registerTone', 'translation'],
};

// ── Pronuncia: valuta la trascrizione (da riconoscimento vocale) ──
export function speechSystem(profile, targetPhrase) {
  const m = meta(profile);
  return `You are a friendly pronunciation and fluency coach for ${m.targetEn}, explaining to an ${m.explNative} speaker.
${targetPhrase ? `The phrase the student was asked to say was: "${targetPhrase}".` : 'The student spoke freely.'}
Their speech was captured by speech-recognition (so judge wording/likely pronunciation from the transcript). Return STRUCTURED JSON:
- "accuracyScore": 0-100 (how close to correct/natural).
- "fluencyScore": 0-100.
- "feedback": practical, encouraging advice in ${m.explNative} about intonation, tricky sounds (double consonants in Italian, pitch accent in Japanese, th/vowels in English).
- "phoneticGuide": a simple phonetic guide for the phrase (rōmaji with stress for Japanese; simple syllable/IPA hints for English/Italian).
- "corrections": array of {original, corrected, explanation (in ${m.explNative}), category} for any wording/grammar issues (empty if none).`;
}
export const speechSchema = {
  type: 'OBJECT',
  properties: {
    accuracyScore: { type: 'NUMBER' }, fluencyScore: { type: 'NUMBER' }, feedback: { type: 'STRING' }, phoneticGuide: { type: 'STRING' },
    corrections: { type: 'ARRAY', items: { type: 'OBJECT', properties: { original: { type: 'STRING' }, corrected: { type: 'STRING' }, explanation: { type: 'STRING' }, category: { type: 'STRING' } } } },
  },
  required: ['accuracyScore', 'fluencyScore', 'feedback', 'phoneticGuide'],
};

// Genera una frase-bersaglio per l'esercizio di pronuncia (testo semplice, non JSON).
export function speechPhraseSeed(profile) {
  const m = meta(profile);
  return `Give ONE short, natural sentence in ${m.targetEn} suitable for a level ${m.levelText} student to read aloud for pronunciation practice. Output ONLY the sentence, nothing else${profile.target === 'ja' ? ' (include the sentence in Japanese script only)' : ''}.`;
}

// Primo messaggio "seme" per far partire la modalità (istruzione nascosta al modello).
export function seedFor(profile, mode) {
  const m = meta(profile);
  const T = tier(profile);
  if (mode === 'chat') {
    if (T === 'intro') return `Warmly welcome ${m.name} in ${m.explNative}. In a few short lines, in ${m.explNative}, say what ${m.targetEn} is and how you'll start together (its writing system and a first greeting). Teach just ONE greeting with its reading and meaning. Do NOT start a conversation in ${m.targetEn}. End by gently inviting them to try repeating that one greeting.`;
    if (T === 'beginner') return `Greet ${m.name} mostly in ${m.explNative} and introduce yourself as their tutor. Teach ONE very simple ${m.targetEn} phrase with its reading and meaning, and invite them to try it. Keep it tiny and reassuring.`;
    return `Greet ${m.name} warmly in ${m.explNative}, then start a simple conversation in ${m.targetEn} with one easy opening question for level ${m.levelText}.`;
  }
  if (mode === 'reading') return `Give me a brand-new reading item now, following the reading-practice rules for my level.`;
  return null;
}

// ── Diario del tutor: riassume una conversazione (qualsiasi modalità) per la
//    memoria di lungo periodo. Chiamata INTERNA (noCount): non intacca il tetto. ──
const MODE_LABEL = { lesson: 'guided lesson', reading: 'reading-practice session', chat: 'free conversation' };
export async function maybeDiarize(profile, mode, convoArg) {
  const convo = convoArg || getConvo(mode);
  if (!convo || convo.length < 3) return;
  const transcript = convo.slice(-26).map((x) => `${x.role === 'user' ? 'STUDENT' : 'TUTOR'}: ${x.text}`).join('\n').slice(0, 6500);
  const m = meta(profile);
  const sys = `You summarise a ${MODE_LABEL[mode] || 'session'} for the tutor's long-term memory of the student ${m.name} (learning ${m.targetEn}). Reply in ${m.explNative} ONLY as compact JSON, no code fences:
{"topic":"<main topic, 3-6 words>","errors":"<the student's concrete mistakes seen here — grammar/particles/vocabulary/spelling/unnatural phrasing — one short phrase; write 'nessuno' if none>","summary":"<1 short sentence: what was covered and how ${m.name} did>"}`;
  try {
    const raw = await ask([{ role: 'user', text: transcript }], { system: sys, len: 'breve', noCount: true, temperature: 0.2 });
    const json = raw.replace(/```json|```/g, '').trim();
    const obj = JSON.parse(json.slice(json.indexOf('{'), json.lastIndexOf('}') + 1));
    pushDiary(profile.id, { mode, topic: obj.topic || '—', errors: obj.errors || '', summary: obj.summary || '' });
  } catch (e) { /* memoria best-effort: se fallisce non blocca la conversazione */ }
}

// Contesto di memoria iniettato nel system prompt di OGNI modalità: elenca i temi
// recenti e gli errori ricorrenti, così il tutor personalizza per la persona,
// non ripete, e rivede gli errori senza risultare pedante.
export function memoryContext(profile) {
  const arr = getDiary(profile.id);
  if (!arr || !arr.length) return '';
  const m = meta(profile);
  const recent = arr.slice(-6).map((d) => `- ${d.date} [${MODE_LABEL[d.mode] || d.mode || '—'}] ${d.topic}${d.errors && !/^\s*nessun/i.test(d.errors) ? ` — errori: ${d.errors}` : ''}`).join('\n');
  const errs = arr.slice(-14).map((d) => d.errors).filter((e) => e && !/^\s*nessun/i.test(e));
  const recurring = errs.length ? `\nRecurring mistakes to revisit gently with ${m.name}: ${errs.slice(-6).join('; ')}.` : '';
  return `\n\nLONG-TERM MEMORY of ${m.name} — use it to PERSONALISE this session: build on what was already done, do not repeat the same material, and quietly reinforce their recurring weak points.\nRecent history:\n${recent}${recurring}`;
}

// Seme della lezione del giorno: sceglie un argomento nuovo tenendo conto del diario.
export function lessonSeed(profile) {
  const m = meta(profile);
  if (tier(profile) === 'intro') {
    const start = profile.target === 'ja'
      ? 'begin with the first hiragana (e.g. あ い う え お) and how each sounds'
      : 'begin with the alphabet and pronunciation basics';
    return `Start the VERY FIRST lesson for ${m.name}, learning ${m.targetEn} from zero. Teaching mostly in ${m.explNative}, ${start}. Introduce only a few items, each with its reading/sound and meaning, then a tiny practice. Do NOT lecture in ${m.targetEn}. Keep it short and encouraging.`;
  }
  return `Start today's lesson now for ${m.name} (level ${m.levelText}, learning ${m.targetEn}). Pick ONE fresh, useful point that fits their level and has not been covered in the recent lessons above. Begin the guided lesson.`;
}
