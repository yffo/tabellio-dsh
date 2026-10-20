# Panel harness (dev only)

A throwaway host for `client/client.js`: real React, real DOM, canned RPC.
Used to click through the memory panel when the DSH web GUI is not reachable
(and to reproduce UI bugs before touching the live app). **Not part of the npm
package** — it is a development aid, not a shipped surface.

## Run

```bash
cd <repo>
mkdir -p tools/panel-harness/package
(cd tools/panel-harness && npm pack react@18.3.1 react-dom@18.3.1 --silent && tar xzf react-18.3.1.tgz && tar xzf react-dom-18.3.1.tgz)

python3 -m http.server 8765
# open http://127.0.0.1:8765/tools/panel-harness/index.html
```

The harness loads `client/client.js` from the repo, feeds canned responses for
`status / inbox / proposals / search / notes / read / edit / settings / weekly /
judge.recent`, and renders the real `MemoryPanel` with `rpcCall` + `t`.

- `localStorage['tabellio-dsh:wizard-done']` is intentionally **not** seeded, so
  the first-run wizard shows; set it to `'1'` to jump straight to the panel.
- `document.documentElement.setAttribute('data-dark','')` switches the demo token
  set to a dark palette (`--dsw-alias-*` fallbacks).
- Every `t()` returns `[key]` on purpose: the harness pins structure and layout,
  not copy. Real translations are covered by `test/client-i18n.test.mjs`.
