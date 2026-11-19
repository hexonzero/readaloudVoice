# Read Aloud

A private, installable-feeling web reader that **reads documents to you out loud**. Open a PDF, EPUB, DOCX, TXT, Markdown or HTML file, paste a web link, or paste text, and listen with natural AI voices that run **entirely on your device**. No account, no server, and your files never leave your computer.

## Features

- **Many sources**: PDF, EPUB, DOCX, TXT, MD, HTML, web page links, or pasted text
- **Natural voices**: [Kokoro](https://github.com/hexgrad/kokoro) AI voices (Heart, Bella, Nicole, Adam, Emma, George and more) running locally in your browser, plus any voice your OS provides
- **Smooth playback**: audio is generated up to ~3 pages ahead, with a buffering screen and gapless sentence-to-sentence playback
- **Follow along**: the current sentence is highlighted and scrolled into view; tap any sentence to jump there
- **Library**: books are remembered with progress (chapter, sentence, % read), plus a wishlist
- **Player**: speed control, previous/next sentence and chapter, seek bar, time-left estimate, lock-screen / media-key controls
- **Themes**: light, dark and sepia, with a "read from here" selection shortcut
- **Offline**: after the one-time voice download (~90 MB) everything works without internet

## Run it

The voice engine needs `http(s)`, so opening `index.html` by double-click (`file://`) will **not** work.

**Locally**
```bash
# any static server works
python3 -m http.server 8000
# then open http://localhost:8000
```

**GitHub Pages**
1. Push `index.html`, `app.js` and `styles.css` to a repo.
2. Settings → Pages → deploy from your main branch.
3. Open the published URL.

No build step and no dependencies to install. Libraries (JSZip, pdf.js, kokoro-js) load from CDNs.

## Using the Kokoro voice

1. Open the **Voice** dropdown (player sheet) and pick a *Kokoro AI* voice, or tap **Download Heart** on the Add file tab.
2. Wait for the one-time ~90 MB download (cached by the browser afterwards).
3. Press play.

### Smooth reading (buffering)

AI speech is generated sentence by sentence. To avoid pauses between sentences the app:

- **Pre-generates about 3 pages** of upcoming text in the background (crossing chapter boundaries).
- Shows a **"Preparing voice…" screen** before playback starts, or if the buffer runs dry, until about 1 page is ready. From it you can choose **Start now**, **Use device voice**, or **Cancel**.
- **Preloads the next sentence** into a second audio element so one sentence flows straight into the next.
- Keeps generating while paused, so resuming is instant.
- Drops stale queued work when you jump somewhere else, so the engine always works on what you will hear next.

Tune it at the top of the Kokoro section in `app.js`:

```js
const PAGE_CH=1800, START_PAGES=1, AHEAD_PAGES=3, KMAX=600;
//  PAGE_CH      characters counted as one "page"
//  START_PAGES  pages to buffer before (re)starting playback
//  AHEAD_PAGES  pages to keep generated ahead while playing
//  KMAX         max cached sentences (older ones are freed)
```

Rough memory use: about 5 MB per page of audio, so the default 3-page buffer is only ~15 MB. If you have a slower machine, raise `START_PAGES`; if you want a longer runway, raise `AHEAD_PAGES`.

## Controls

| Action | Desktop | Touch |
|---|---|---|
| Play / pause | `Space` | Double-tap the text |
| Next / previous sentence | `→` / `←` | Player buttons |
| Next / previous chapter | `Shift+→` / `Shift+←` | Player buttons |
| Jump to a sentence | Click it | Tap it |
| Read from selection | Select text → **Read from here** | Same |

## Project structure

```
index.html   page markup and script includes
styles.css   themes, layout, player, buffering screen
app.js       file parsing, chapters, reader, speech, Kokoro engine
```

How the voice engine works: `kokoroCore` runs in a Blob **web worker** (so the page doesn't freeze) and turns text into WAV blobs. The main thread keeps a promise cache keyed by `voice|sentence`, a priority queue (the sentence you need now jumps the line), and two alternating `Audio` elements for gapless playback. If workers are unavailable there is a **compatibility mode** on the main thread, which has no lookahead and may freeze the UI.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Opened as a file" error | Serve over `http://localhost` or GitHub Pages (see *Run it*) |
| Voice download fails | Check your connection; the model comes from jsDelivr and Hugging Face. Tap **Retry** |
| Preview inside Claude says network blocked | Use your hosted copy; sandboxed previews block the CDN |
| Still pauses on a slow machine | Increase `START_PAGES`, or choose a device voice |
| Page looks stale after an update | Hard refresh (`Ctrl+Shift+R`) to bypass the cache |
| No sound on mobile | Tap play once; browsers require a user gesture before audio |

## Privacy

Documents are parsed in your browser. The only network requests are loading the libraries and the Kokoro model, and fetching a web page when you paste a link. Library, progress, settings and wishlist are stored in your browser's `localStorage`.

## Credits

[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) and [kokoro-js](https://github.com/hexgrad/kokoro), [pdf.js](https://mozilla.github.io/pdf.js/), [JSZip](https://stuk.github.io/jszip/), Literata typeface.

## License

Add your preferred license here (e.g. MIT).
