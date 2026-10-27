"""
Build dictionary.db (SQLite) from the kaikki.org Korean Wiktionary dump.

It downloads the JSONL file (~195 MB) the first time, then creates
dictionary.db next to this script. Safe to re-run: it rebuilds the table.
"""
import json
import os
import sqlite3
import sys
import urllib.request

URL = "https://kaikki.org/dictionary/Korean/kaikki.org-dictionary-Korean.jsonl"
JSONL = "kaikki-korean.jsonl"
DB = "dictionary.db"

# Entry types that aren't useful for a hover dictionary
SKIP_POS = {"character", "syllable", "romanization", "punct", "symbol",
            "prefix", "suffix", "affix", "infix", "interfix", "root"}

MAX_SENSES = 6


def download():
    if os.path.exists(JSONL):
        print(f"{JSONL} already downloaded, skipping.")
        return
    print("Downloading (about 195 MB)...")

    def progress(blocks, block_size, total):
        if total > 0:
            pct = min(100, blocks * block_size * 100 // total)
            sys.stdout.write(f"\r  {pct}%")
            sys.stdout.flush()

    urllib.request.urlretrieve(URL, JSONL, progress)
    print("\nDone.")


def clean_senses(entry):
    # Return a list of English gloss strings, skipping inflected-form stubs
    out = []
    for sense in entry.get("senses", []):
        if "form_of" in sense:          # e.g. "past tense of 먹다"
            continue
        glosses = sense.get("glosses") or []
        if glosses:
            out.append(glosses[-1].strip())   # last item = most specific
    return out


def build():
    if os.path.exists(DB):
        os.remove(DB)
    conn = sqlite3.connect(DB)
    conn.execute(
        "CREATE TABLE entries (lemma TEXT, pos TEXT, gloss TEXT, definition TEXT)"
    )

    rows, count = [], 0
    with open(JSONL, encoding="utf-8") as f:
        for line in f:
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("lang_code") != "ko":
                continue
            pos = e.get("pos", "")
            if pos in SKIP_POS:
                continue
            senses = clean_senses(e)
            if not senses:
                continue
            senses = senses[:MAX_SENSES]
            gloss = senses[0]
            if len(senses) == 1:
                definition = senses[0]
            else:
                definition = "\n".join(f"{i}. {s}" for i, s in enumerate(senses, 1))
            rows.append((e["word"], pos, gloss, definition))
            if len(rows) >= 10000:
                conn.executemany("INSERT INTO entries VALUES (?,?,?,?)", rows)
                count += len(rows)
                rows = []
    if rows:
        conn.executemany("INSERT INTO entries VALUES (?,?,?,?)", rows)
        count += len(rows)

    conn.execute("CREATE INDEX idx_lemma ON entries(lemma)")
    conn.commit()
    conn.close()
    print(f"Inserted {count} entries into {DB}")


if __name__ == "__main__":
    download()
    build()