/**
 * JavaScript do relatório: filtros, busca, lightbox e expansão na impressão.
 * Vanilla, sem dependências; fica inline no HTML. Não pode conter a sequência "</script".
 */
export const CLIENT_JS = `
(function () {
  var cases = [].slice.call(document.querySelectorAll('.case'));
  var attentionSet = { 'fail': 1, 'needs-review': 1, 'blocked': 1 };
  var hasAttention = cases.some(function (c) { return attentionSet[c.getAttribute('data-status')]; });
  var attn = document.getElementById('attention');
  var q = document.getElementById('q');
  var empty = document.getElementById('empty');
  var buttons = [].slice.call(document.querySelectorAll('[data-filter]'));
  var state = { status: 'all', q: '', attention: hasAttention };
  var printing = false;

  function apply() {
    var shown = 0;
    cases.forEach(function (c) {
      var st = c.getAttribute('data-status');
      var ok = printing || ((!state.attention || attentionSet[st]) &&
        (state.status === 'all' || st === state.status) &&
        (!state.q || (c.getAttribute('data-search') || '').indexOf(state.q) >= 0));
      c.classList.toggle('hidden', !ok);
      if (ok) shown++;
    });
    if (empty) empty.classList.toggle('hidden', shown > 0 || cases.length === 0);
    if (attn) attn.checked = state.attention;
    buttons.forEach(function (b) {
      var on = b.getAttribute('data-filter') === state.status && !(state.status === 'all' && state.attention);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      state.status = b.getAttribute('data-filter');
      state.attention = false;
      apply();
    });
  });
  if (attn) attn.addEventListener('change', function () {
    state.attention = attn.checked;
    if (attn.checked) state.status = 'all';
    apply();
  });
  if (q) q.addEventListener('input', function () {
    state.q = q.value.trim().toLowerCase();
    apply();
  });

  // Lightbox
  var lb = document.getElementById('lightbox');
  var lbImg = document.getElementById('lb-img');
  var lbClose = document.getElementById('lb-close');
  var trigger = null;
  function openLb(btn) {
    var im = btn.querySelector('img');
    if (!im || !lb) return;
    trigger = btn;
    lbImg.src = im.src;
    lbImg.alt = im.alt;
    lb.setAttribute('data-open', 'true');
    lbClose.focus();
  }
  function closeLb() {
    if (!lb || lb.getAttribute('data-open') !== 'true') return;
    lb.setAttribute('data-open', 'false');
    lbImg.removeAttribute('src');
    if (trigger) trigger.focus();
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    var btn = t && t.closest ? t.closest('.shot') : null;
    if (btn) { openLb(btn); return; }
    if (t === lb || t === lbClose) closeLb();
  });
  document.addEventListener('keydown', function (e) {
    if (!lb || lb.getAttribute('data-open') !== 'true') return;
    if (e.key === 'Escape') { e.preventDefault(); closeLb(); }
    if (e.key === 'Tab') { e.preventDefault(); lbClose.focus(); }
  });

  // Impressão: expande tudo e ignora filtros; restaura depois.
  var wasOpen = [];
  function enterPrint() {
    if (printing) return;
    printing = true;
    wasOpen = cases.map(function (c) { return c.open; });
    cases.forEach(function (c) { c.open = true; });
    apply();
  }
  function leavePrint() {
    if (!printing) return;
    printing = false;
    cases.forEach(function (c, i) { c.open = wasOpen[i]; });
    apply();
  }
  window.addEventListener('beforeprint', enterPrint);
  window.addEventListener('afterprint', leavePrint);
  if (window.matchMedia) {
    var mq = window.matchMedia('print');
    var onChange = function (e) { if (e.matches) enterPrint(); else leavePrint(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }

  apply();
})();
`;
