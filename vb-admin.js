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
    onChange: function (fn) { notify = fn; },
    init: function (fn) {
      notify = fn || null;
      return loadRemote().then(function () {
        apply();
        [60, 250, 800].forEach(function (ms) { setTimeout(apply, ms); });
      });
    }
  };
})();
