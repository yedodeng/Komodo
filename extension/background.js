// Relays requests from the content script to the local backend.
// Going through the service worker avoids the page's own CORS / mixed-content rules.
const API = "http://localhost:8000";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "api") return;

  fetch(API + msg.path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(msg.body),
  })
    .then((r) => {
      if (!r.ok) throw new Error("Server returned " + r.status);
      return r.json();
    })
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err) }));

  return true; // keep the message channel open for the async response
});
