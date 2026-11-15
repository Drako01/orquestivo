/**
 * Static page script, executed only through the CSP nonce. It never interpolates data: all
 * dynamic values travel in escaped `data-*` attributes and leave through `postMessage`
 * (validated again by `parseWebviewMessage` in the extension host).
 *
 * The host re-sends only the `<main>` markup (`{type:'update'}`); this script keeps the active tab,
 * focused control, scroll position and open <details> across those updates.
 */
export const CLIENT_SCRIPT = `
(function () {
  'use strict';
  var vscode = acquireVsCodeApi();
  var saved = vscode.getState() || {};
  var app = document.getElementById('app');
  var live = document.getElementById('live');
  var tab = typeof saved.tab === 'string' ? saved.tab : 'summary';

  function remember() {
    var active = document.activeElement;
    var open = [];
    document.querySelectorAll('details[id][open]').forEach(function (d) { open.push(d.id); });
    saved = { scrollY: window.scrollY, focus: active && active.id ? active.id : '', tab: tab, open: open };
    vscode.setState(saved);
  }
  function post(message) { remember(); vscode.postMessage(message); }
  function int(value) { return parseInt(value || '', 10); }
  function openLocation(el) { post({ type: 'openLocation', file: int(el.getAttribute('data-file')), line: int(el.getAttribute('data-line')) }); }

  function showTab(name, focus, silent) {
    var tabs = document.querySelectorAll('[role=tab]');
    var found = false;
    tabs.forEach(function (el) { if (el.getAttribute('data-tab') === name) found = true; });
    if (!found) name = 'summary';
    tab = name;
    tabs.forEach(function (el) {
      var on = el.getAttribute('data-tab') === name;
      el.setAttribute('aria-selected', on ? 'true' : 'false');
      el.setAttribute('tabindex', on ? '0' : '-1');
      var panel = document.getElementById(el.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
      if (on && focus) el.focus();
    });
    if (!silent) remember();
  }

  function restore(announce) {
    var snap = saved;
    showTab(tab, false, true);
    (snap.open || []).forEach(function (id) { var d = document.getElementById(id); if (d && d.tagName === 'DETAILS') d.open = true; });
    if (typeof snap.scrollY === 'number') window.scrollTo(0, snap.scrollY);
    if (snap.focus) { var target = document.getElementById(snap.focus); if (target && !target.closest('[hidden]')) target.focus({ preventScroll: true }); }
    if (live && announce) setTimeout(function () { live.textContent = announce; }, 150);
  }

  document.addEventListener('click', function (event) {
    var tabButton = event.target.closest('[role=tab]');
    if (tabButton) { showTab(tabButton.getAttribute('data-tab'), false); return; }
    var node = event.target.closest('.node');
    if (node) { openLocation(node); return; }
    var el = event.target.closest('[data-action]');
    if (!el) return;
    switch (el.getAttribute('data-action')) {
      case 'open': openLocation(el); break;
      case 'command': post({ type: 'command', command: el.getAttribute('data-command') }); break;
      case 'filter': post({ type: 'toggleFilter', dimension: el.getAttribute('data-dimension'), value: el.getAttribute('data-value') }); break;
      case 'clear-filters': post({ type: 'clearFilters' }); break;
      case 'fix': post({ type: 'previewFix', file: int(el.getAttribute('data-file')), index: int(el.getAttribute('data-index')) }); break;
      case 'explain': post({ type: 'explainFinding', file: int(el.getAttribute('data-file')), index: int(el.getAttribute('data-index')) }); break;
    }
  });
  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === 'level') post({ type: 'setLevel', level: event.target.value });
  });
  document.addEventListener('keydown', function (event) {
    var current = event.target.closest && event.target.closest('[role=tab]');
    if (current) {
      var tabs = Array.prototype.slice.call(document.querySelectorAll('[role=tab]'));
      var at = tabs.indexOf(current);
      var next = -1;
      if (event.key === 'ArrowRight') next = (at + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (at - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      if (next >= 0) { event.preventDefault(); showTab(tabs[next].getAttribute('data-tab'), true); }
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var node = event.target.closest && event.target.closest('.node');
    if (!node) return;
    event.preventDefault();
    openLocation(node);
  });
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.type !== 'update' || typeof data.html !== 'string' || !app) return;
    remember();
    app.innerHTML = data.html;
    restore(typeof data.announce === 'string' ? data.announce : '');
  });
  window.addEventListener('scroll', function () { saved.scrollY = window.scrollY; }, { passive: true });

  restore(document.body.getAttribute('data-announce'));
})();
`;
