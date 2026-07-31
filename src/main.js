// Bootstrap: stili → storage → primo render.
import './ui/styles.css';
import { initStore } from './core/store.js';
import { boot } from './ui/app.js';

async function main() {
  await initStore();
  boot();
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW non registrato:', e));
  });
}

main().catch((err) => {
  console.error('Avvio fallito:', err);
  const el = document.getElementById('app');
  if (el) el.innerHTML = `<div style="padding:24px;color:#ff8a80">Errore di avvio: ${err && err.message ? err.message : err}</div>`;
});
