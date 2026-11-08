/*
 * 장보기 화면 (메모 화면의 "장보기" 탭)
 * ---------------------------------------------------------------
 * - 살 것 넣기 · 이름 고치기 · 지우기(실행 취소 가능)
 * - 체크하면 산 것으로 표시하고, 토스트의 "냉장고에 넣기"로 이름이 채워진 재료 추가 창 열기
 * - 산 것 한 번에 지우기(실행 취소 가능)
 */
(function (Fridge) {
  'use strict';

  var S = Fridge.shopping;
  var ui = Fridge.ui;
  var el = ui.el;
  var TRASH_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var PENCIL_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    panel: $('memoPanel'), tab: $('shopTab'), sub: $('memoSub'), count: $('shopCount'),
    form: $('shopForm'), text: $('shopText'), save: $('shopSave'),
    list: $('shopList'), empty: $('shopEmpty'), clear: $('shopClear')
  };

  var editing = null; // { id, text }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function shortDate(ms) {
    var d = new Date(ms);
    return pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  }

  function iconBtn(cls, action, label, svg) {
    var b = el('button', cls);
    b.type = 'button';
    b.dataset.action = action;
    b.setAttribute('aria-label', label);
    b.innerHTML = svg;
    return b;
  }

  function renderItem(it) {
    var li = el('li', 'shop' + (it.done ? ' done' : ''));
    li.dataset.id = it.id;
    if (editing && editing.id === it.id) {
      var form = el('form', 'shop-edit');
      form.noValidate = true;
      var input = el('input');
      input.type = 'text';
      input.maxLength = S.NAME_MAX;
      input.value = editing.text;
      input.enterKeyHint = 'done';
      input.dataset.input = 'edit';
      input.setAttribute('aria-label', '이름 고치기');
      form.appendChild(input);
      var cancel = el('button', 'btn ghost small', '취소');
      cancel.type = 'button';
      cancel.dataset.action = 'cancel';
      form.appendChild(cancel);
      var ok = el('button', 'btn primary small', '저장');
      ok.type = 'submit';
      form.appendChild(ok);
      li.appendChild(form);
      return li;
    }
    var label = el('label', 'shop-check');
    var cb = el('input');
    cb.type = 'checkbox';
    cb.checked = !!it.done;
    cb.dataset.action = 'toggle';
    label.appendChild(cb);
    var main = el('span', 'shop-main');
    main.appendChild(el('span', 'shop-name', it.name));
    var meta = it.done && it.doneAt
      ? shortDate(it.doneAt) + ' · ' + (it.doneBy || it.by || '') + ' 삼'
      : shortDate(it.createdAt) + ' · ' + (it.by || '');
    main.appendChild(el('span', 'shop-meta', meta));
    label.appendChild(main);
    li.appendChild(label);
    if (!it.done) li.appendChild(iconBtn('memo-icon', 'edit', '“' + it.name + '” 이름 고치기', PENCIL_SVG));
    li.appendChild(iconBtn('memo-icon memo-del', 'delete', '“' + it.name + '” 지우기', TRASH_SVG));
    return li;
  }

  function updateCount() {
    els.count.textContent = S.openCount;
  }

  function render() {
    updateCount();
    if (els.tab.hidden) return;
    if (editing && !S.find(editing.id)) {
      editing = null;
      ui.toast('고치던 항목이 삭제됐어요');
    }
    els.sub.textContent = S.mode === 'family' ? '가족과 함께 보는 장보기 목록'
      : S.mode === 'pending' ? '가족 장보기 목록 불러오는 중…'
      : '이 기기에만 저장돼요';
    var focusEdit = document.activeElement && document.activeElement.dataset &&
      document.activeElement.dataset.input === 'edit' && els.list.contains(document.activeElement);
    var list = S.list;
    els.list.textContent = '';
    var frag = document.createDocumentFragment();
    var doneShown = false;
    list.forEach(function (it) {
      if (it.done && !doneShown) {
        doneShown = true;
        frag.appendChild(el('li', 'shop-divider', '산 것'));
      }
      frag.appendChild(renderItem(it));
    });
    els.list.appendChild(frag);
    els.empty.hidden = list.length > 0;
    var done = list.length - S.openCount;
    els.clear.hidden = !done;
    els.clear.textContent = '산 것 지우기 (' + done + ')';
    if (focusEdit) focusInput();
  }

  function focusInput() {
    var input = els.list.querySelector('[data-input="edit"]');
    if (!input) return;
    input.focus({ preventScroll: true });
    var n = input.value.length;
    try { input.setSelectionRange(n, n); } catch (e) { /* 무시 */ }
  }

  function failed(e) {
    if (e && e.message === 'not-found') ui.toast('이미 삭제된 항목이에요');
    else ui.toast('아직 가족 냉장고에 연결되지 않았어요. 잠시 후 다시 해 주세요');
  }

  /* ---------- 넣기 ---------- */

  var saving = false;
  els.form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (saving) return;
    var text = els.text.value.trim();
    if (!text) { els.text.focus(); return; }
    saving = true;
    els.save.disabled = true;
    S.add(text).then(function () {
      els.text.value = '';
      els.text.focus();
    }, function (err) {
      if (err && err.message === 'duplicate') ui.toast('“' + err.item.name + '”은(는) 이미 목록에 있어요');
      else failed(err);
    }).then(function () {
      saving = false;
      els.save.disabled = false;
    });
  });

  /* ---------- 체크 · 고치기 · 지우기 ---------- */

  function itemOf(node) {
    var li = node.closest('.shop');
    return li ? S.find(li.dataset.id) : null;
  }

  function toggle(it, done) {
    S.setDone(it.id, done).then(function () {
      if (!done) return;
      ui.toast('“' + it.name + '” 샀어요', '냉장고에 넣기', function () {
        ui.openAdd({ name: it.name });
      });
    }, function (e) { failed(e); render(); });
  }

  els.list.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset.action !== 'toggle') return;
    var it = itemOf(t);
    if (it) toggle(it, t.checked);
  });

  els.list.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn || !els.list.contains(btn)) return;
    var it = itemOf(btn);
    if (!it) return;
    switch (btn.dataset.action) {
      case 'edit':
        editing = { id: it.id, text: it.name };
        render();
        focusInput();
        break;
      case 'cancel':
        editing = null;
        render();
        break;
      case 'delete':
        if (editing && editing.id === it.id) editing = null;
        S.remove(it.id).then(function () {
          ui.toast('“' + it.name + '” 지웠어요', '실행 취소', function () { S.restore(it).catch(failed); });
        }, failed);
        break;
    }
  });

  els.list.addEventListener('input', function (e) {
    if (e.target.dataset.input === 'edit' && editing) editing.text = e.target.value;
  });

  els.list.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && e.target.dataset.input === 'edit') {
      e.preventDefault();
      e.stopPropagation();
      editing = null;
      render();
    }
  });

  els.list.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!editing) return;
    var id = editing.id;
    var text = editing.text.trim();
    if (!text) { focusInput(); return; }
    S.rename(id, text).then(function () {
      editing = null;
      render();
    }, failed);
  });

  els.clear.addEventListener('click', function () {
    S.clearDone().then(function (removed) {
      if (!removed.length) return;
      ui.toast('산 것 ' + removed.length + '개 지웠어요', '실행 취소', function () {
        Promise.all(removed.map(function (it) { return S.restore(it); })).catch(failed);
      });
    }, failed);
  });

  // 개수(탭의 숫자)는 항상, 목록은 장보기 탭이 보일 때만 다시 그림
  S.subscribe(render);
  updateCount();

  Fridge.shopUI = { render: render };
})(window.Fridge = window.Fridge || {});
