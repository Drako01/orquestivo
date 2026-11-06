/**
 * Static page script, executed only through the CSP nonce. It never interpolates data: all
 * dynamic values travel in escaped `data-*` attributes and leave through `postMessage`
 * (validated again by `parseWebviewMessage` in the extension host).
 */
export const CLIENT_SCRIPT = `
(function () {
  'use strict';
  var vscode = acquireVsCodeApi();
  var saved = vscode.getState() || {};
  function remember() {
    var active = document.activeElement;
    vscode.setState({ scrollY: window.scrollY, focus: active && active.id ? active.id : '' });
  }
  function post(message) { remember(); vscode.postMessage(message); }
  function int(value) { return parseInt(value || '', 10); }
  function openLocation(el) { post({ type: 'openLocation', file: int(el.getAttribute('data-file')), line: int(el.getAttribute('data-line')) }); }

  document.addEventListener('click', function (event) {
    var node = event.target.closest('.node');
    if (node) { openLocation(node); return; }
    var el = event.target.closest('[data-action]');
    if (!el) return;
    switch (el.getAttribute('data-action')) {
      case 'open': openLocation(el); break;
      case 'command': post({ type: 'command', command: el.getAttribute('data-command') }); break;
      case 'filter': post({ type: 'toggleFilter', dimension: el.getAttribute('data-dimension'), value: el.getAttribute('data-value') }); break;
      case 'clear-filters': post({ type: 'clearFilters' }); break;
      case 'explain': post({ type: 'explainFinding', file: int(el.getAttribute('data-file')), index: int(el.getAttribute('data-index')) }); break;
    }
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var node = event.target.closest && event.target.closest('.node');
    if (!node) return;
    event.preventDefault();
    openLocation(node);
  });
  var level = document.getElementById('level');
  if (level) level.addEventListener('change', function () { post({ type: 'setLevel', level: level.value }); });

  if (typeof saved.scrollY === 'number') window.scrollTo(0, saved.scrollY);
  if (saved.focus) { var target = document.getElementById(saved.focus); if (target) target.focus({ preventScroll: true }); }
  var live = document.getElementById('live');
  var text = document.body.getAttribute('data-announce');
  if (live && text) setTimeout(function () { live.textContent = text; }, 150);
})();
`;
