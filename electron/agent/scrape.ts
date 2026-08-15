/* Reads a job listing the way a browser would: a hidden window renders the
   page — JS-heavy boards included — and hands over its visible text. No
   external scraping service. When a page won't cooperate (login wall,
   bot check, near-empty shell), the answer is the paste-text recovery, and
   the error says so. */
import { BrowserWindow } from 'electron';
import { KeplerError } from './errors.ts';

const BLOCKED_MESSAGE =
  'Die Stellenanzeige konnte nicht automatisch geladen werden. Bitte füge den Text der Anzeige ein und starte Kepler erneut.';

const LOAD_TIMEOUT = 20_000;
/* SPAs paint after did-finish-load; give the content a moment to arrive. */
const SETTLE_MS = 1_500;
/* Anything shorter is a shell or a wall, not a listing. */
const MIN_TEXT = 200;

const WALL_MARKERS = [
  'sind sie ein mensch',
  'verify you are human',
  'cloudflare',
  'log in to continue',
  'anmelden, um fortzufahren',
  'enable javascript and cookies',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function looksWalled(text: string): boolean {
  const head = text.slice(0, 2_000).toLowerCase();
  return WALL_MARKERS.some((marker) => head.includes(marker));
}

export async function fetchListingText(url: string, signal?: AbortSignal): Promise<string> {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new KeplerError('Der hinterlegte Link ist keine gültige URL.');
  }
  /* Job URLs are untrusted input (same stance as shell:openExternal). */
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new KeplerError('Der hinterlegte Link ist keine Webseite.');
  }

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      /* Non-persist partition: scraped sites get an in-memory session and
         can't drop cookies into the app's own profile. */
      partition: 'scrape',
    },
  });
  /* The page is arbitrary web content — it may not open real windows on the
     user's desktop or request permissions. */
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  /* The user's stop wins the race against the page. */
  const stopped = new Promise<never>((_, reject) => {
    const bail = () => reject(new KeplerError('Abgebrochen.'));
    if (signal?.aborted) bail();
    else signal?.addEventListener('abort', bail, { once: true });
  });
  /* A stop after the page already answered must not surface as unhandled. */
  stopped.catch(() => {});
  try {
    /* loadURL rejects on did-fail-load; a hung page runs into the timeout. */
    await Promise.race([
      win.loadURL(url),
      sleep(LOAD_TIMEOUT).then(() => {
        throw new KeplerError(BLOCKED_MESSAGE);
      }),
      stopped,
    ]);
    await Promise.race([sleep(SETTLE_MS), stopped]);
    const raw = (await win.webContents.executeJavaScript(
      'document.body ? document.body.innerText : ""',
      true,
    )) as string;
    const text = (raw || '').replace(/\n{3,}/g, '\n\n').trim();
    if (text.length < MIN_TEXT || looksWalled(text)) throw new KeplerError(BLOCKED_MESSAGE);
    return text;
  } catch (err) {
    throw err instanceof KeplerError ? err : new KeplerError(BLOCKED_MESSAGE);
  } finally {
    win.destroy();
  }
}
