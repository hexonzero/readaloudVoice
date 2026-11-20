# Read Aloud

Created by **hexonzero**.

A private web reader that **reads documents to you out loud**. Open a PDF, EPUB, DOCX, TXT, Markdown or HTML file, paste a web link, or paste text, and listen using the natural voices built into your browser. No account, no server, and your files never leave your device.

## Features

- **Many sources**: PDF, EPUB, DOCX, TXT, MD, HTML, web page links, or pasted text
- **Natural browser voices**: uses the voices already on your device, with natural / online ones (for example Google US English, or Microsoft "Natural" voices in Edge) listed first
- **Gap-free reading**: the next few sentences are queued in the speech engine while the current one plays
- **Follow along**: the current sentence is highlighted and scrolled into view; tap any sentence to jump there
- **Library**: books are remembered with progress (chapter, sentence, % read), plus a wishlist
- **Player**: speed control, previous/next sentence and chapter, seek bar, time-left estimate, lock-screen / media-key controls
- **Themes**: light, dark and sepia, with a "Read from here" selection shortcut

## Run it

Open `index.html` through any static host, for example GitHub Pages, or locally:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

No build step and nothing to install. JSZip and pdf.js load from a CDN.

## Voices

Pick a voice from the **Voice** dropdown in the player. The list comes from your browser, so it differs by device:

| Browser / device | Best voices you will see |
|---|---|
| Chrome (desktop, Android) | Google US English and other Google voices |
| Edge | Microsoft Aria, Jenny, Guy and other "Online (Natural)" voices |
| Safari (iPhone, Mac) | Siri and Enhanced / Premium voices, if downloaded in system settings |

Natural / online voices are listed first, and the default is the first US English one found.

### How the gaps are avoided

Browser voices cannot be pre-generated ahead of time, so the app queues the next 3 sentences with the speech engine while the current one is speaking. The engine can prepare them in advance, so one sentence runs straight into the next. Tune it in `app.js`:

```js
const AHEAD=3;  // sentences queued ahead of the one being read
```

Online voices still need a network connection, and a very slow connection can still cause a short pause. A local (offline) voice never will.

## Controls

| Action | Desktop | Touch |
|---|---|---|
| Play / pause | `Space` | Double-tap the text |
| Next / previous sentence | `→` / `←` | Player buttons |
| Next / previous chapter | `Shift+→` / `Shift+←` | Player buttons |
| Jump to a sentence | Click it | Tap it |
| Read from selection | Select text, then **Read from here** | Same |



## Project structure

```
index.html   page markup and script includes
styles.css   themes, layout and player
app.js       file parsing, chapters, reader and speech
```

## Troubleshooting

| Problem | Fix |
|---|---|
| No natural voices listed | Your browser only exposes basic voices. Try Chrome or Edge, or install better voices in system settings |
| Voice list is empty at first | Some browsers load voices late; wait a second or reload |
| Reading stops after a while (Chrome) | Reload the page and press play again; some online voices time out |
| Page looks stale after an update | Hard refresh (`Ctrl+Shift+R`) |
| No sound on mobile | Tap play once; browsers require a tap before audio starts |

## Privacy

Documents are parsed in your browser. Library, progress, settings and wishlist are stored in your browser's `localStorage`. Online voices send the text being spoken to the voice provider (for example Google or Microsoft); pick an offline voice if you want nothing sent anywhere.

## Credits

Idea and creation: hexonzero. Libraries:

[pdf.js](https://mozilla.github.io/pdf.js/), [JSZip](https://stuk.github.io/jszip/), Literata typeface.

## License

NA
