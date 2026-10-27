# Korean Hover Dictionary

A Chrome extension that lets you hover over Korean words on any web page and see the English meaning and definition.

Korean words are inflected (particles, verb endings), so the extension can't look up a hovered word directly. A small local backend first reduces each word to its dictionary form (for example 먹었습니다 → 먹다), then looks that form up in a Wiktionary-derived dictionary.

## How it works

1. The content script finds Korean text on the page and sends it to the backend.
2. `/analyze` splits the text into words and lemmatizes each one with [Kiwi](https://github.com/bab2min/kiwipiepy).
3. The content script wraps each recognized word in a span.
4. When you hover over a word and then press shift, `/lookup` finds its entry in a local SQLite dictionary, and a tooltip shows the English gloss and definition.

Page text is only ever sent to your own `localhost` server.

## Project layout

```
backend/     FastAPI server (lemmatizer + dictionary lookup) and dictionary builder
extension/   Chrome extension (Manifest V3)
```

## Setup

### 1. Backend

```
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python build_dictionary.py
uvicorn main:app --port 8000 --reload
```

`build_dictionary.py` downloads about 195 MB of Wiktionary data the first time and builds `dictionary.db`. You only need to run it once. Leave the server running while you use the extension.

You can try the API at <http://localhost:8000/docs>.

### 2. Extension

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the `extension/` folder.
4. Open a Korean web page and hover over a word.

After editing any extension file, click the refresh icon on the extension's card and reload the page.

## Known limitations

- Text that loads after the page (infinite scroll, many single-page sites) isn't processed yet.
- There is no on/off toggle; it runs on every page that contains Korean.
- Lemmatization is automatic and sometimes wrong, especially for rare words and names.
- The backend must be running on port 8000.

## Data sources and license

Dictionary data comes from [Wiktionary](https://en.wiktionary.org/), extracted into JSON by [kaikki.org](https://kaikki.org/) using [wiktextract](https://github.com/tatuylonen/wiktextract). Wiktionary content is available under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), so the generated `dictionary.db` carries the same license and requires attribution.
