/*
 * 메모 화면
 */
(function (Fridge) {
  'use strict';

  var M = Fridge.memos;
  var ui = Fridge.ui;
  var el = ui.el;
  var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  var TRASH_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    btn: $('memoBtn'), panel: $('memoPanel'), back: $('memoBack'), sub: $('memoSub'),
    form: $('memoForm'), text: $('memoText'), count: $('memoCount'), save: $('memoSave'),
    list: $('memoList'), empty: $('memoEmpty')
  };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // 2026.11.06 (목) 14:20
  function formatTime(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) +
      ' (' + DAYS[d.getDay()] + ') ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function renderMemo(m) {
    var li = el('li', 'memo');
    li.dataset.id = m.id;
    var body = el('div', 'memo-main');
    body.appendChild(el('p', 'memo-text', m.text));
    var meta = el('div', 'memo-meta');
    var time = el('time', null, formatTime(m.createdAt));
    time.dateTime = new Date(m.createdAt).toISOString();
    meta.appendChild(time);
    meta.appendChild(el('span', 'memo-by', m.by || ''));
    body.appendChild(meta);
    li.appendChild(body);
    var del = el('button', 'memo-del');
    del.type = 'button';
    del.dataset.action = 'delete';
    del.setAttribute('aria-label', '메모 삭제');
    del.innerHTML = TRASH_SVG;
    li.appendChild(del);
    return li;
  }

  function render() {
    var list = M.list;
    els.sub.textContent = M.mode === 'family' ? '가족과 함께 보는 메모'
      : M.mode === 'pending' ? '가족 메모 불러오는 중…'
      : '이 기기에만 저장돼요';
    els.list.textContent = '';
    var frag = document.createDocumentFragment();
    list.forEach(function (m) { frag.appendChild(renderMemo(m)); });
    els.list.appendChild(frag);
    els.empty.hidden = list.length > 0;
  }

  function updateCount() {
    els.count.textContent = els.text.value.length + ' / ' + M.TEXT_MAX;
  }

  function saveFailed() {
    ui.toast('아직 가족 냉장고에 연결되지 않았어요. 잠시 후 다시 해 주세요');
  }

  /* ---------- 열기 / 닫기 ---------- */

  function open() {
    render();
    els.panel.hidden = false;
    els.panel.scrollTop = 0;
    requestAnimationFrame(function () { els.panel.classList.add('show'); });
    document.body.classList.add('no-scroll');
    ui.openOverlay('memos', hide);
  }

  function hide() {
    els.panel.classList.remove('show');
    document.body.classList.remove('no-scroll');
    if (document.activeElement) document.activeElement.blur();
    setTimeout(function () {
      if (!els.panel.classList.contains('show')) els.panel.hidden = true;
    }, 220);
  }

  /* ---------- 동작 ---------- */

  var saving = false;
  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (saving) return;
    var text = els.text.value.trim();
    if (!text) { els.text.focus(); return; }
    saving = true;
    els.save.disabled = true;
    M.add(text).then(function () {
      els.text.value = '';
      updateCount();
      ui.toast('메모를 남겼어요');
    }, saveFailed).then(function () {
      saving = false;
      els.save.disabled = false;
    });
  });

  // 키보드 Ctrl/⌘ + Enter 로 바로 남기기
  els.text.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      els.form.requestSubmit ? els.form.requestSubmit() : els.save.click();
    }
  });
  els.text.addEventListener('input', updateCount);

  els.list.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action="delete"]');
    if (!btn) return;
    var id = btn.closest('.memo').dataset.id;
    var memo = null;
    M.list.forEach(function (m) { if (m.id === id) memo = m; });
    if (!memo) return;
    M.remove(id).then(function () {
      ui.toast('메모를 삭제했어요', '실행 취소', function () { M.restore(memo).catch(saveFailed); });
    }, saveFailed);
  });

  els.btn.addEventListener('click', open);
  els.back.addEventListener('click', function () { ui.closeOverlay('memos'); });

  M.subscribe(function () { if (!els.panel.hidden) render(); });
  updateCount();
})(window.Fridge = window.Fridge || {});
