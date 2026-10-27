(() => {
  const HANGUL = /[가-힣]/;
  // Splits an eojeol like "민주공화국이다." into leading junk, Hangul core, trailing junk
  const WORD_PARTS = /^([^가-힣]*)([\s\S]*?[가-힣])([^가-힣]*)$/;
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE", "PRE",
  ]);
  const CHUNK = 40; // text nodes per /analyze request
  const HOVER_DELAY_MS = 100;

  // ---------- talking to the backend (via background.js) ----------
  function callApi(path, body) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "api", path, body }, (resp) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!resp || !resp.ok) {
          return reject(new Error(resp ? resp.error : "No response"));
        }
        resolve(resp.data);
      });
    });
  }

  // ---------- page processing ----------
  function collectTextNodes(root) {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!HANGUL.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (
          !p ||
          SKIP_TAGS.has(p.tagName) ||
          p.isContentEditable ||
          p.closest(".kh-word, #kh-host")
        ) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function wrapNode(node, words) {
    const text = node.nodeValue;
    const frag = document.createDocumentFragment();
    let cursor = 0;
    let wrapped = 0;

    for (const w of words) {
      if (!w.lemma) continue; // particles, punctuation, unknowns: leave alone
      // Find by text rather than by offset: Python counts code points, JS counts UTF-16 units
      const idx = text.indexOf(w.text, cursor);
      if (idx === -1) continue;
      const m = WORD_PARTS.exec(w.text);
      if (!m) continue;
      const lead = m[1];
      const core = m[2];
      const coreStart = idx + lead.length;

      if (coreStart > cursor) frag.append(text.slice(cursor, coreStart));
      const span = document.createElement("span");
      span.className = "kh-word";
      span.textContent = core;
      span.dataset.lemma = w.lemma;
      span.dataset.parts = JSON.stringify(w.parts || []);
      frag.append(span);
      cursor = coreStart + core.length;
      wrapped++;
    }

    if (!wrapped) return;
    if (cursor < text.length) frag.append(text.slice(cursor));
    node.replaceWith(frag);
  }

  async function processPage() {
    if (!document.body) return;
    const nodes = collectTextNodes(document.body);
    for (let i = 0; i < nodes.length; i += CHUNK) {
      const chunk = nodes.slice(i, i + CHUNK);
      const texts = chunk.map((n) => n.nodeValue);
      let results;
      try {
        results = await callApi("/analyze", { texts });
      } catch (err) {
        console.warn("[Korean Hover] Could not reach the backend:", err.message);
        return;
      }
      chunk.forEach((node, j) => {
        // Skip nodes the page changed or removed while we were waiting
        if (node.isConnected && node.nodeValue === texts[j]) {
          wrapNode(node, results[j] || []);
        }
      });
    }
  }

  // ---------- tooltip (Shadow DOM so page CSS can't break it) ----------
  const host = document.createElement("div");
  host.id = "kh-host";
  host.style.cssText = "all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647;";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .tip {
        display: none;
        position: fixed;
        max-width: 320px;
        box-sizing: border-box;
        padding: 10px 12px;
        background: #1f2937;
        color: #f9fafb;
        border-radius: 8px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
        pointer-events: none;
      }
      .tip.show { display: block; }
      .head { font-size: 16px; font-weight: 600; }
      .lemma { margin-left: 6px; font-size: 13px; font-weight: 400; color: #9ca3af; }
      .entry { margin-top: 8px; }
      .pos { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #9ca3af; }
      .gloss { font-weight: 600; }
      .def { margin-top: 2px; color: #d1d5db; white-space: pre-line; }
      .msg { margin-top: 6px; color: #d1d5db; }
    </style>
    <div class="tip"></div>`;
  document.documentElement.append(host);
  const tip = shadow.querySelector(".tip");

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text; // textContent, never innerHTML
    return e;
  }

  function render(wordText, lemma, result, errorMsg) {
    tip.replaceChildren();
    const head = el("div", "head", wordText);
    if (lemma && lemma !== wordText) head.append(el("span", "lemma", lemma));
    tip.append(head);

    if (errorMsg) {
      tip.append(el("div", "msg", errorMsg));
      return;
    }
    if (!result || !result.found) {
      tip.append(el("div", "msg", "Not found in the dictionary."));
      return;
    }
    if (result.matched && result.matched !== lemma) {
      tip.append(el("div", "msg", "Showing: " + result.matched));
    }
    for (const entry of result.entries.slice(0, 3)) {
      const box = el("div", "entry");
      box.append(el("div", "pos", entry.pos));
      box.append(el("div", "gloss", entry.gloss));
      if (entry.definition && entry.definition !== entry.gloss) {
        box.append(el("div", "def", entry.definition));
      }
      tip.append(box);
    }
  }

  function place(target) {
    const r = target.getBoundingClientRect();
    tip.style.left = "0px";
    tip.style.top = "0px";
    const t = tip.getBoundingClientRect();
    const x = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - t.width - 8));
    let y = r.bottom + 6;
    if (y + t.height > window.innerHeight - 8) y = Math.max(8, r.top - t.height - 6);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }

  function hide() {
    tip.classList.remove("show");
  }

  // ---------- lookups with an in-memory cache ----------
  const cache = new Map();
  async function lookup(lemma, parts) {
    const key = lemma + "|" + parts.join(",");
    if (cache.has(key)) return cache.get(key);
    const data = await callApi("/lookup", { items: [{ lemma, parts }] });
    cache.set(key, data[0]);
    return data[0];
  }

  let hoverTimer = null;
  let currentEl = null;
  let shiftEl = null;

  async function showFor(target) {
    const lemma = target.dataset.lemma;
    let parts = [];
    try {
      parts = JSON.parse(target.dataset.parts || "[]");
    } catch (_) {}
    const wordText = target.textContent;

    let result = null;
    let errorMsg = null;
    try {
      result = await lookup(lemma, parts);
    } catch (_) {
      errorMsg = "Can't reach the dictionary server";
    }
    if (currentEl !== target) return; // mouse moved on while we waited
    render(wordText, lemma, result, errorMsg);
    tip.classList.add("show");
    place(target);
  }

  // One delegated listener pair instead of one per word
  document.addEventListener("mouseover", (e) => {
    const target = e.target instanceof Element ? e.target.closest(".kh-word") : null;
    if (!target || target === currentEl) return;
    currentEl = target;
  });

  document.addEventListener("keydown", (e) => {
    if (!e.shiftKey || !currentEl || currentEl === shiftEl) return;
    shiftEl = currentEl;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => showFor(shiftEl), HOVER_DELAY_MS);
  });

  document.addEventListener("mouseout", (e) => {
    const target = e.target instanceof Element ? e.target.closest(".kh-word") : null;
    if (!target) return;
    if (e.relatedTarget instanceof Node && target.contains(e.relatedTarget)) return;
    clearTimeout(hoverTimer);
    currentEl = null;
    shiftEl = null;
    hide();
  });

  processPage();
})();
