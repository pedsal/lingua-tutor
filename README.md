# Lingua Tutor

Tutor IA multilingua per **giapponese, inglese e italiano**: conversazione, lezioni,
lettura, laboratorio di scrittura e pronuncia — con correzione degli errori in tempo
reale, memoria del tutor tra le sessioni e profili personalizzati.

App **client-side** (nessun server): PWA installabile, funziona offline una volta
aperta, interfaccia in italiano / inglese / giapponese.

## Funzioni

- **Conversazione, Lezione del giorno, Lettura** — con correzioni strutturate
  (categoria, forma corretta, spiegazione, furigana/rōmaji) e risposte suggerite.
- **Scrittura** — analisi di un testo con punteggio, versione migliorata, note.
- **Pronuncia** — lettura ad alta voce con valutazione di accuratezza e fluidità.
- **Diario del tutor** — ricorda argomenti ed errori ricorrenti per personalizzare.
- **Voce** — pronuncia con voce del dispositivo o voce neurale IA (opzionale).
- **Profili** con lingua-obiettivo, lingua di spiegazione, livello (CEFR) e personalità.

## Chiave Gemini (BYOK)

Il tutor usa l'API di Google Gemini. Ogni utente inserisce **la propria chiave**
(gratuita) una sola volta per dispositivo, in **Impostazioni**; la chiave resta
salvata solo su quel dispositivo (IndexedDB) e **non** è inclusa nel codice né nei
backup. Ottieni una chiave: <https://aistudio.google.com/apikey>.

## Sviluppo

```bash
npm install
npm run dev      # http://localhost:5174
npm run build    # output in dist/
npm run preview
```

## Stack

Vanilla JS + [Vite](https://vitejs.dev), [localforage](https://github.com/localForage/localForage)
(IndexedDB), Web Speech API, PWA (service worker). Nessuna dipendenza runtime pesante.

## Deploy

Progetto statico: build con Vite, output in `dist/`. Su Vercel il framework viene
rilevato automaticamente (vedi `vercel.json`).
