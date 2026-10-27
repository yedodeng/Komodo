import re
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from kiwipiepy import Kiwi
import sqlite3
from pathlib import Path

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_methods=["*"], allow_headers=["*"])
kiwi = Kiwi()

NOUNS = {"NNG", "NNP", "NNB", "NP", "NR"}
PREDICATES = {"VV", "VA", "VX"}
OTHER = {"MAG", "MAJ", "MM"}
DERIVING = {"XSV", "XSA"}          # 하/되/시키 + noun -> verb/adjective


def base_tag(tag: str) -> str:
    return tag.split("-")[0]

def pick_lemma(toks):
    # Choose the dictionary form for one eojeol (space-delimited word).
    i = 0
    while i < len(toks):
        tag = base_tag(toks[i].tag)

        if tag in PREDICATES:
            return toks[i].form + "다", "verb" if tag != "VA" else "adj", []

        if tag in NOUNS or tag == "XR":
            # collect a run of consecutive nouns (compounds like 민주+공화국)
            j = i
            parts = []
            while j < len(toks) and base_tag(toks[j].tag) in NOUNS | {"XR"}:
                parts.append(toks[j].form)
                j += 1
            stem = "".join(parts)
            if j < len(toks) and base_tag(toks[j].tag) in DERIVING:
                kind = "verb" if base_tag(toks[j].tag) == "XSV" else "adj"
                return stem + toks[j].form + "다", kind, parts
            if tag != "XR":
                return stem, "noun", parts if len(parts) > 1 else []

        if tag in OTHER:
            return toks[i].form, "other", []
        i += 1
    return None, None, []

def analyze_text(text: str):
    tokens = kiwi.tokenize(text)
    results, k = [], 0
    for m in re.finditer(r"\S+", text):
        s, e = m.span()
        group = []
        while k < len(tokens) and tokens[k].start < e:
            if tokens[k].start >= s:
                group.append(tokens[k])
            k += 1
        lemma, pos, parts = pick_lemma(group)
        results.append({"text": m.group(), "start": s, "end": e,
                        "lemma": lemma, "pos": pos, "parts": parts})
    return results


class Req(BaseModel):
    texts: list[str]     # one entry per page text node

@app.post("/analyze")
def analyze(req: Req):
    return [analyze_text(t) for t in req.texts]

DB_PATH = Path(__file__).with_name("dictionary.db")

class LookupItem(BaseModel):
    lemma: str
    parts: list[str] = []      # pass along the "parts" from /analyze


class LookupReq(BaseModel):
    items: list[LookupItem]


def find_entries(conn, lemma, parts):
    # Try the full lemma first, then fallbacks. Returns (matched_form, entries)
    candidates = [lemma]
    # 공부하다 / 시작되다 -> try the bare noun 공부 / 시작
    if len(lemma) > 2 and lemma.endswith(("하다", "되다")):
        candidates.append(lemma[:-2])
    candidates += parts         # compounds: 민주공화국 -> 민주, 공화국

    for cand in candidates:
        rows = conn.execute(
            "SELECT pos, gloss, definition FROM entries WHERE lemma = ?", (cand,)
        ).fetchall()
        if rows:
            return cand, [{"pos": p, "gloss": g, "definition": d} for p, g, d in rows]
    return None, []


@app.post("/lookup")
def lookup(req: LookupReq):
    conn = sqlite3.connect(DB_PATH)      
    try:
        out = []
        for item in req.items:
            matched, entries = find_entries(conn, item.lemma, item.parts)
            out.append({"lemma": item.lemma, "matched": matched,
                        "found": bool(entries), "entries": entries})
        return out
    finally:
        conn.close()
