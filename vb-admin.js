/* Portfolio admin layer: URL-gated edit mode + content overrides.
   Visitor  → plain URL. Nothing extra renders, no click log, nothing editable.
   Admin    → append ?admin=1 once; the flag lives in sessionStorage for that tab only.
   Publishing → Save keeps edits in this browser; Download writes content.json,
   which every visitor's page fetches on load. Commit that file to publish. */
(function () {
  if (window.VBAdmin) return; // helmet scripts can evaluate twice — keep one editor
  var OV_KEY = 'vb-content-overrides';
  var ADMIN_KEY = 'vb-admin-session';
  var local = {};
  var remote = {};
  var editing = false;
  var hidden = false;
  var dirty = false;
  var notify = null;

  try { local = JSON.parse(localStorage.getItem(OV_KEY) || '{}') || {}; } catch (e) { local = {}; }

  function isAdmin() {
    var q = '';
    try { q = new URLSearchParams(location.search).get('admin'); } catch (e) {}
    try {
      if (q === '1') { sessionStorage.setItem(ADMIN_KEY, '1'); return true; }
      if (q === '0') { sessionStorage.removeItem(ADMIN_KEY); return false; }
      return sessionStorage.getItem(ADMIN_KEY) === '1';
    } catch (e) { return q === '1'; }
  }

  function exitAdmin() {
    try { sessionStorage.removeItem(ADMIN_KEY); } catch (e) {}
    location.href = location.pathname + location.hash;
  }

  /* Admin UI is visible only when unlocked and not previewing as a visitor.
     ⌘/Ctrl + Shift + E unlocks or hides it — nothing on the page hints at it. */
  function panelVisible() { return isAdmin() && !hidden; }

  function previewVisitor() {
    setEditing(false);
    hidden = true;
    announce();
  }

  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
    if (String(e.key).toLowerCase() !== 'e') return;
    if (!isAdmin()) return; // never an unlock path — ?admin=1 is the only way in
    e.preventDefault();
    hidden = !hidden;
    if (hidden) setEditing(false);
    announce();
  });

  function merged() {
    var out = {};
    Object.keys(remote).forEach(function (k) { out[k] = remote[k]; });
    Object.keys(local).forEach(function (k) { out[k] = local[k]; });
    return out;
  }

  function root() { return document.body; }

  function announce() {
    try { document.dispatchEvent(new CustomEvent('vb-edit-change')); } catch (e) {}
    if (notify) { try { notify(); } catch (e) {} }
  }

  function pathOf(el) {
    var parts = [], n = el, r = root();
    while (n && n !== r) {
      var p = n.parentElement;
      if (!p) return null;
      parts.push(Array.prototype.indexOf.call(p.children, n));
      n = p;
    }
    if (n !== r) return null;
    return parts.reverse().join('-');
  }

  function nodeAt(key) {
    var n = root(), parts = key.split('-');
    for (var i = 0; i < parts.length; i++) {
      n = n && n.children[+parts[i]];
      if (!n) return null;
    }
    return n;
  }

  var INLINE = { A: 1, SPAN: 1, STRONG: 1, EM: 1, B: 1, I: 1, BR: 1, SMALL: 1, CODE: 1 };

  /* Editable = a leaf of text, or a block whose only children are inline
     formatting (a paragraph with a link stays one editable unit). */
  function isCandidate(el) {
    var t = el.textContent;
    if (!t || !t.trim() || t.length > 600) return false;
    if (el.closest('[data-no-edit]')) return false;
    for (var i = 0; i < el.children.length; i++) {
      if (!INLINE[el.children[i].tagName]) return false;
    }
    return true;
  }

  function candidates() {
    var sel = 'h1,h2,h3,h4,h5,p,span,li,td,th,a,strong,em,blockquote,figcaption,div';
    var hits = Array.prototype.filter.call(root().querySelectorAll(sel), isCandidate);
    var set = new Set(hits);
    return hits.filter(function (el) {
      for (var p = el.parentElement; p && p !== root(); p = p.parentElement) {
        if (set.has(p)) return false;
      }
      return true;
    });
  }

  /* Overrides are stored with the original text so a stale key can never
     rewrite the wrong element after a markup change. */
  function apply() {
    var all = merged();
    Object.keys(all).forEach(function (k) {
      var ov = all[k];
      if (!ov || typeof ov.v !== 'string') return;
      var el = nodeAt(k);
      if (!el) return;
      var cur = el.innerHTML.trim();
      if (cur === ov.v.trim()) return;
      if (cur !== (ov.o || '').trim()) return;
      el.innerHTML = ov.v;
    });
  }

  function paint(el, on) {
    el.contentEditable = on ? 'true' : 'false';
    el.style.outline = on ? '1px dashed var(--color-accent)' : '';
    el.style.outlineOffset = on ? '3px' : '';
    el.style.borderRadius = on ? '4px' : el.style.borderRadius;
    el.style.cursor = on ? 'text' : '';
  }

  function record(el) {
    var key = pathOf(el);
    if (!key) return;
    var orig = el.getAttribute('data-vb-orig');
    if (orig === null) orig = el.innerHTML;
    local[key] = { o: orig, v: el.innerHTML };
    if (local[key].v.trim() === (orig || '').trim()) delete local[key];
    dirty = true;
    announce();
  }

  function setEditing(on) {
    editing = isAdmin() ? !!on : false; // never editable for a visitor
    try {
      candidates().forEach(function (el) {
        if (editing && el.getAttribute('data-vb-orig') === null) {
          var all = merged(), key = pathOf(el);
          var known = key && all[key] ? all[key].o : null;
          el.setAttribute('data-vb-orig', known !== null && known !== undefined ? known : el.innerHTML);
        }
        paint(el, editing);
      });
    } catch (e) { console.warn('vb-admin: edit paint failed', e); }
    announce();
  }

  document.addEventListener('input', function (e) {
    if (!editing) return;
    var el = e.target;
    if (el && el.nodeType === 1 && el.isContentEditable) record(el);
  }, true);

  document.addEventListener('click', function (e) {
    if (!editing) return;
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    if (a) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  function save() {
    try { localStorage.setItem(OV_KEY, JSON.stringify(local)); dirty = false; } catch (e) {}
    announce();
    /* A local save alone is invisible to visitors — GitHub Pages serves static
       files and a browser cannot write to it. Push the change to the repo so
       the published site actually changes. */
    if (getToken()) return publish();
    setStatus('warn', 'Saved in this browser only — add a token to publish.');
    return Promise.resolve(false);
  }

  function reset() {
    try { localStorage.removeItem(OV_KEY); } catch (e) {}
    location.reload();
  }

  function download() {
    save();
    var blob = new Blob([JSON.stringify(merged(), null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'content.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function loadRemote() {
    try {
      return fetch('content.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (j) { remote = j && typeof j === 'object' ? j : {}; })
        .catch(function () {});
    } catch (e) { return Promise.resolve(); }
  }

  /* ── Publishing ────────────────────────────────────────────────────────
     GitHub Pages is a static host: nothing the page does in a browser can
     write a file back to it. For an edit to become permanent for every
     visitor it has to be committed to the repository, so Save commits
     content.json (and the image sidecar) through the GitHub contents API.

     The token is supplied by the admin and kept in this browser's
     localStorage. It is never part of the deployed source. Use a
     fine-grained token limited to this one repository with Contents:
     read and write, and nothing else. */
  var TOKEN_KEY = 'vb-gh-token';
  var REPO_KEY = 'vb-gh-repo';
  var IMG_STATE_FILE = '.image-slots.state.json';
  var status = { kind: 'idle', text: '' };
  var imgState = null;   // newest sidecar payload seen from <image-slot>
  var imgTimer = null;
  var lastPub = {};      // path -> text last committed, to skip no-op commits

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(v) {
    try {
      if (v) localStorage.setItem(TOKEN_KEY, v);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
    announce();
  }
  function setStatus(kind, text) { status = { kind: kind, text: text }; announce(); }

  /* owner/repo inferred from the Pages URL, overridable when the guess is
     wrong (a custom domain, say). vik-exl.github.io/Vikram.github.io/ is a
     project site; vik-exl.github.io/ is the user site. */
  function repoInfo() {
    var over = '';
    try { over = localStorage.getItem(REPO_KEY) || ''; } catch (e) {}
    if (over.indexOf('/') > 0) {
      var bits = over.split('/');
      return { owner: bits[0], repo: bits[1], branch: 'main' };
    }
    var host = location.hostname || '';
    var owner = host.indexOf('.github.io') > 0 ? host.split('.')[0] : '';
    var seg = location.pathname.split('/').filter(Boolean);
    var first = seg.length ? seg[0] : '';
    var isFile = /\.(x?html?|json|js|css|png|jpe?g|webp|avif|pdf|svg)$/i.test(first);
    return { owner: owner, repo: (first && !isFile) ? first : host, branch: 'main' };
  }

  function b64(str) {
    var bytes = new TextEncoder().encode(str), bin = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }

  function ghHeaders(token) {
    return {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    };
  }

  function ghUrl(info, path) {
    return 'https://api.github.com/repos/' + info.owner + '/' + info.repo + '/contents/' + path;
  }

  /* The contents API needs the blob sha of the file being replaced; absent
     means create. A missing file is a 404, which is not an error here. */
  function ghSha(info, token, path) {
    return fetch(ghUrl(info, path) + '?ref=' + encodeURIComponent(info.branch),
                 { headers: ghHeaders(token), cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return j && j.sha ? j.sha : null; })
      .catch(function () { return null; });
  }

  function ghPut(info, token, path, text, message) {
    return ghSha(info, token, path).then(function (sha) {
      var body = { message: message, content: b64(text), branch: info.branch };
      if (sha) body.sha = sha;
      return fetch(ghUrl(info, path), {
        method: 'PUT', headers: ghHeaders(token), body: JSON.stringify(body)
      }).then(function (r) {
        if (r.ok) return true;
        return r.json().catch(function () { return {}; }).then(function (e) {
          var msg = e && e.message ? e.message : '';
          if (r.status === 401) msg = 'token rejected — expired or mistyped';
          if (r.status === 403) msg = 'token lacks Contents: read and write on this repo';
          if (r.status === 404) msg = 'repo not found as ' + info.owner + '/' + info.repo;
          if (r.status === 409) msg = 'the file changed since this page loaded — reload and retry';
          throw new Error(path + ': ' + (msg || ('HTTP ' + r.status)));
        });
      });
    });
  }

  function publish() {
    var token = getToken();
    if (!token) {
      setStatus('error', 'No token set.');
      return Promise.resolve(false);
    }
    var info = repoInfo();
    if (!info.owner || !info.repo) {
      setStatus('error', 'Could not work out the repository — set it manually.');
      return Promise.resolve(false);
    }
    setStatus('busy', 'Publishing to ' + info.owner + '/' + info.repo + '…');
    var work = [];
    var text = JSON.stringify(merged(), null, 2);
    if (lastPub['content.json'] !== text) {
      work.push(['content.json', text, 'Update site content via admin']);
    }
    if (imgState !== null && lastPub[IMG_STATE_FILE] !== imgState) {
      work.push([IMG_STATE_FILE, imgState, 'Update image slots via admin']);
    }
    if (!work.length) {
      setStatus('ok', 'Nothing new to publish.');
      return Promise.resolve(true);
    }
    return Promise.all(work.map(function (w) {
      return ghPut(info, token, w[0], w[1], w[2]).then(function () { lastPub[w[0]] = w[1]; });
    })).then(function () {
      setStatus('ok', 'Published. Live in about a minute.');
      return true;
    }).catch(function (err) {
      setStatus('error', err && err.message ? err.message : String(err));
      return false;
    });
  }

  window.VBAdmin = {
    isAdmin: isAdmin,
    panelVisible: panelVisible,
    previewVisitor: previewVisitor,
    exitAdmin: exitAdmin,
    editing: function () { return editing; },
    dirty: function () { return dirty; },
    count: function () { return Object.keys(local).length; },
    setEditing: setEditing,
    toggleEditing: function () { setEditing(!editing); },
    apply: apply,
    save: save,
    reset: reset,
    download: download,
    publish: publish,
    status: function () { return status; },
    hasToken: function () { return !!getToken(); },
    setToken: setToken,
    repoInfo: repoInfo,
    setRepo: function (v) { try { localStorage.setItem(REPO_KEY, v || ''); } catch (e) {} announce(); },
    onChange: function (fn) { notify = fn; },
    init: function (fn) {
      notify = fn || null;
      return loadRemote().then(function () {
        apply();
        [60, 250, 800].forEach(function (ms) { setTimeout(apply, ms); });
      });
    }
  };

  /* ── <image-slot> bridge ───────────────────────────────────────────────
     image-slot.js persists through window.omelette.writeFile, an API that
     only exists inside the design-canvas editor. On GitHub Pages it is
     absent, so every dropped image was silently discarded. Stand in for it:
     capture the sidecar and commit it, so a dropped image survives a reload
     and reaches visitors. A visitor's write is ignored outright. */
  if (!window.omelette) window.omelette = {};
  if (!window.omelette.writeFile) {
    window.omelette.writeFile = function (path, text) {
      if (String(path).indexOf('.state.json') === -1) return Promise.resolve();
      imgState = text;
      if (!isAdmin()) return Promise.resolve();
      clearTimeout(imgTimer);
      imgTimer = setTimeout(function () {
        if (getToken()) publish();
        else setStatus('warn', 'Image held locally — add a token to publish it.');
      }, 1500);
      return Promise.resolve();
    };
  }

  /* ── Visitor guard ─────────────────────────────────────────────────────
     image-slot.js has no notion of an admin, so its drop zones invited every
     visitor to "drop an image". Make slots inert for visitors and collapse
     the empty ones, wrapper included, so the layout closes up instead of
     showing a dashed hole. */
  function guardVisitor() {
    if (isAdmin()) return;
    var st = document.createElement('style');
    st.textContent = 'image-slot{pointer-events:none!important}';
    (document.head || document.documentElement).appendChild(st);

    fetch(IMG_STATE_FILE, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (state) {
        state = state && typeof state === 'object' ? state : {};
        var hide = function () {
          var slots = document.querySelectorAll('image-slot');
          for (var i = 0; i < slots.length; i++) {
            var el = slots[i], id = el.getAttribute('id');
            var v = id ? state[id] : null;
            var filled = !!(v && (typeof v === 'string' ? v : v.u)) || !!el.getAttribute('src');
            if (filled) { el.style.display = ''; continue; }
            /* Each slot sits alone in a sized wrapper (a .washed div or a
               figure). Hiding the wrapper is what actually closes the gap. */
            var box = el.parentElement;
            var alone = box && box.children.length === 1 && !(box.textContent || '').trim();
            (alone ? box : el).style.display = 'none';
          }
        };
        hide();
        [200, 600, 1400].forEach(function (ms) { setTimeout(hide, ms); });
        try {
          new MutationObserver(hide).observe(document.body, { childList: true, subtree: true });
        } catch (e) {}
      });
  }

  /* ── Publish bar ───────────────────────────────────────────────────────
     Rendered here rather than in the page templates, so the seven .dc.html
     files need no edits and every page gets it. */
  function bar() {
    if (!isAdmin()) return;
    var el = document.getElementById('vb-pub');
    if (!panelVisible()) { if (el) el.style.display = 'none'; return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'vb-pub';
      el.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483000;' +
        'width:290px;padding:10px 12px;border-radius:10px;font:12px/1.45 system-ui,sans-serif;' +
        'background:#201e1d;color:#f5ead8;box-shadow:0 8px 28px rgba(0,0,0,.34)';
      el.innerHTML =
        '<div style="font-weight:700;margin-bottom:6px">Publish</div>' +
        '<div id="vb-pub-repo" style="opacity:.72;margin-bottom:7px;word-break:break-all"></div>' +
        '<input id="vb-pub-tok" type="password" placeholder="GitHub token (ghp_… / github_pat_…)" ' +
        'style="width:100%;box-sizing:border-box;padding:6px 7px;margin-bottom:6px;border:0;' +
        'border-radius:6px;font:12px system-ui,sans-serif" />' +
        '<div style="display:flex;gap:6px;margin-bottom:7px">' +
        '<button id="vb-pub-go" style="flex:1;padding:6px;border:0;border-radius:6px;' +
        'background:#c67139;color:#fff;font-weight:700;cursor:pointer">Publish now</button>' +
        '<button id="vb-pub-clr" style="padding:6px 9px;border:0;border-radius:6px;' +
        'background:#4a4540;color:#f5ead8;cursor:pointer">Forget</button>' +
        '</div>' +
        '<div id="vb-pub-msg" style="min-height:15px;opacity:.9"></div>';
      document.body.appendChild(el);
      var tok = el.querySelector('#vb-pub-tok');
      tok.value = getToken();
      tok.addEventListener('change', function () { setToken(tok.value.trim()); });
      el.querySelector('#vb-pub-go').addEventListener('click', function () {
        setToken(tok.value.trim());
        publish();
      });
      el.querySelector('#vb-pub-clr').addEventListener('click', function () {
        tok.value = ''; setToken('');
        setStatus('idle', 'Token removed from this browser.');
      });
    }
    el.style.display = '';
    var info = repoInfo();
    el.querySelector('#vb-pub-repo').textContent =
      info.owner && info.repo ? info.owner + '/' + info.repo + ' · ' + info.branch
                              : 'repository not detected';
    var msg = el.querySelector('#vb-pub-msg');
    msg.textContent = status.text;
    msg.style.color = status.kind === 'error' ? '#ff9b7a'
                    : status.kind === 'ok' ? '#a8d08a'
                    : status.kind === 'warn' ? '#f0c66b' : '#f5ead8';
  }

  document.addEventListener('vb-edit-change', bar);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { guardVisitor(); bar(); });
  } else { guardVisitor(); bar(); }
})();
