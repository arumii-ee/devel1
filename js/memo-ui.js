/*
 * 메모 화면
 * ---------------------------------------------------------------
 * - 메모 남기기 · 고치기 · 지우기(실행 취소 가능)
 * - 메모마다 댓글 달기 · 고치기 · 지우기(실행 취소 가능)
 * 가족이 메모를 바꿔서 화면을 다시 그려도, 쓰던 글과 커서 위치는 그대로 둡니다.
 */
(function (Fridge) {
  'use strict';

  var M = Fridge.memos;
  var ui = Fridge.ui;
  var el = ui.el;
  var DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  var TRASH_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var PENCIL_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    btn: $('memoBtn'), panel: $('memoPanel'), back: $('memoBack'), sub: $('memoSub'),
    form: $('memoForm'), text: $('memoText'), count: $('memoCount'), save: $('memoSave'),
    list: $('memoList'), empty: $('memoEmpty')
  };

  /* ---------- 화면 상태 ---------- */
  // 고치는 중: null | { memoId, commentId(댓글일 때) , text(쓰는 중인 글) }
  var editing = null;
  var replyOpen = {};    // 댓글 입력칸이 열린 메모 id
  var replyDrafts = {};  // 메모 id → 쓰다 만 댓글

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // 2026.11.06 (목) 14:20
  function formatTime(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) +
      ' (' + DAYS[d.getDay()] + ') ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // 댓글용 짧은 시각: 올해면 11.06 14:20, 아니면 2025.11.06 14:20
  function formatShort(ms) {
    var d = new Date(ms);
    var md = pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    return d.getFullYear() === new Date().getFullYear() ? md : d.getFullYear() + '.' + md;
  }

  function timeEl(ms, fmt) {
    var t = el('time', null, fmt(ms));
    t.dateTime = new Date(ms).toISOString();
    return t;
  }

  function editedEl(item) {
    if (!item.updatedAt) return null;
    var s = el('span', 'memo-edited', '수정됨' + (item.editedBy && item.editedBy !== item.by ? ' · ' + item.editedBy : ''));
    s.title = formatTime(item.updatedAt) + ' 수정';
    return s;
  }

  function iconBtn(cls, action, label, svg) {
    var b = el('button', cls);
    b.type = 'button';
    b.dataset.action = action;
    b.setAttribute('aria-label', label);
    b.innerHTML = svg;
    return b;
  }

  function textBtn(cls, action, text, type) {
    var b = el('button', cls, text);
    b.type = type || 'button';
    if (action) b.dataset.action = action;
    return b;
  }

  function isEditing(memoId, commentId) {
    return !!editing && editing.memoId === memoId && (editing.commentId || null) === (commentId || null);
  }

  // 고치기 칸 (메모 · 댓글 같이 씀)
  function editForm(max, label) {
    var form = el('form', 'memo-edit');
    form.noValidate = true;
    form.dataset.form = 'edit';
    var ta = el('textarea');
    ta.maxLength = max;
    ta.rows = editing.commentId ? 2 : 3;
    ta.value = editing.text;
    ta.dataset.focusKey = 'edit';
    ta.dataset.input = 'edit';
    ta.setAttribute('aria-label', label);
    form.appendChild(ta);
    var row = el('div', 'memo-edit-row');
    row.appendChild(el('small', 'memo-count', editing.text.length + ' / ' + max));
    var btns = el('div', 'memo-edit-btns');
    btns.appendChild(textBtn('btn ghost small', 'cancel-edit', '취소'));
    btns.appendChild(textBtn('btn primary small', null, '저장', 'submit'));
    row.appendChild(btns);
    form.appendChild(row);
    return form;
  }

  function renderComment(m, c) {
    var li = el('li', 'comment');
    li.dataset.cid = c.id;
    if (isEditing(m.id, c.id)) {
      li.classList.add('editing');
      li.appendChild(editForm(M.COMMENT_MAX, '댓글 고치기'));
      return li;
    }
    var main = el('div', 'comment-main');
    var p = el('p', 'comment-text');
    p.appendChild(el('b', 'comment-by', c.by || ''));
    p.appendChild(document.createTextNode(' ' + c.text));
    main.appendChild(p);
    var meta = el('div', 'memo-meta');
    meta.appendChild(timeEl(c.createdAt, formatShort));
    var ed = editedEl(c);
    if (ed) meta.appendChild(ed);
    main.appendChild(meta);
    li.appendChild(main);
    var tools = el('div', 'comment-tools');
    tools.appendChild(textBtn('link-btn', 'edit-comment', '수정'));
    tools.appendChild(textBtn('link-btn danger', 'delete-comment', '삭제'));
    li.appendChild(tools);
    return li;
  }

  function renderMemo(m) {
    var li = el('li', 'memo');
    li.dataset.id = m.id;

    var head = el('div', 'memo-head');
    var body = el('div', 'memo-main');
    if (isEditing(m.id, null)) {
      li.classList.add('editing');
      body.appendChild(editForm(M.TEXT_MAX, '메모 고치기'));
    } else {
      body.appendChild(el('p', 'memo-text', m.text));
    }
    var meta = el('div', 'memo-meta');
    meta.appendChild(timeEl(m.createdAt, formatTime));
    meta.appendChild(el('span', 'memo-by', m.by || ''));
    var ed = editedEl(m);
    if (ed) meta.appendChild(ed);
    body.appendChild(meta);
    head.appendChild(body);
    if (!isEditing(m.id, null)) {
      var tools = el('div', 'memo-tools');
      tools.appendChild(iconBtn('memo-icon', 'edit', '메모 수정', PENCIL_SVG));
      tools.appendChild(iconBtn('memo-icon memo-del', 'delete', '메모 삭제', TRASH_SVG));
      head.appendChild(tools);
    }
    li.appendChild(head);

    // 댓글
    var comments = M.commentsOf(m);
    var foot = el('div', 'memo-foot');
    if (comments.length) {
      var ul = el('ul', 'comments');
      ul.setAttribute('aria-label', '댓글 ' + comments.length + '개');
      comments.forEach(function (c) { ul.appendChild(renderComment(m, c)); });
      foot.appendChild(ul);
    }
    if (replyOpen[m.id]) {
      var form = el('form', 'comment-form');
      form.noValidate = true;
      form.dataset.form = 'reply';
      var input = el('input');
      input.type = 'text';
      input.maxLength = M.COMMENT_MAX;
      input.placeholder = '댓글 달기';
      input.value = replyDrafts[m.id] || '';
      input.enterKeyHint = 'send';
      input.dataset.focusKey = 'reply:' + m.id;
      input.dataset.input = 'reply';
      input.setAttribute('aria-label', '댓글 내용');
      form.appendChild(input);
      form.appendChild(textBtn('btn primary small', null, '등록', 'submit'));
      foot.appendChild(form);
    } else {
      foot.appendChild(textBtn('link-btn comment-open', 'reply',
        comments.length ? '💬 댓글 ' + comments.length + ' · 달기' : '💬 댓글 달기'));
    }
    li.appendChild(foot);
    return li;
  }

  // 다시 그리기 전에 커서가 있던 칸을 기억했다가 되돌림
  function rememberFocus() {
    var a = document.activeElement;
    if (!a || !els.list.contains(a) || !a.dataset.focusKey) return null;
    return { key: a.dataset.focusKey, start: a.selectionStart, end: a.selectionEnd };
  }

  function restoreFocus(f) {
    if (!f) return;
    var node = els.list.querySelector('[data-focus-key="' + f.key + '"]');
    if (!node) return;
    node.focus({ preventScroll: true });
    try { node.setSelectionRange(f.start, f.end); } catch (e) { /* 무시 */ }
  }

  function focusKey(key, toEnd) {
    var node = els.list.querySelector('[data-focus-key="' + key + '"]');
    if (!node) return;
    node.focus();
    if (toEnd) { var n = node.value.length; try { node.setSelectionRange(n, n); } catch (e) { /* 무시 */ } }
  }

  function render() {
    var list = M.list;
    // 고치던 메모 · 댓글이 다른 가족에 의해 지워졌으면 고치기 끝내기
    if (editing) {
      var m = M.find(editing.memoId);
      if (!m || (editing.commentId && !(m.comments && m.comments[editing.commentId]))) {
        editing = null;
        ui.toast('고치던 ' + (m ? '댓글' : '메모') + '가 삭제됐어요');
      }
    }
    els.sub.textContent = M.mode === 'family' ? '가족과 함께 보는 메모'
      : M.mode === 'pending' ? '가족 메모 불러오는 중…'
      : '이 기기에만 저장돼요';
    var f = rememberFocus();
    els.list.textContent = '';
    var frag = document.createDocumentFragment();
    list.forEach(function (memo) { frag.appendChild(renderMemo(memo)); });
    els.list.appendChild(frag);
    els.empty.hidden = list.length > 0;
    restoreFocus(f);
  }

  function updateCount() {
    els.count.textContent = els.text.value.length + ' / ' + M.TEXT_MAX;
  }

  function saveFailed(e) {
    if (e && e.message === 'too-many') ui.toast('메모 하나에 댓글은 ' + M.COMMENTS_MAX + '개까지 달 수 있어요');
    else if (e && e.message === 'not-found') ui.toast('이미 삭제된 메모예요');
    else ui.toast('아직 가족 냉장고에 연결되지 않았어요. 잠시 후 다시 해 주세요');
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
    editing = null;
    replyOpen = {};
    setTimeout(function () {
      if (!els.panel.classList.contains('show')) els.panel.hidden = true;
    }, 220);
  }

  /* ---------- 새 메모 ---------- */

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

  // Ctrl/⌘ + Enter 로 바로 저장 (새 메모 · 고치기 칸)
  function submitOnCtrlEnter(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.form) {
      e.preventDefault();
      var form = e.target.form;
      if (form.requestSubmit) form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  }
  els.text.addEventListener('keydown', submitOnCtrlEnter);
  els.text.addEventListener('input', updateCount);

  /* ---------- 고치기 · 댓글 ---------- */

  function memoOf(node) {
    var li = node.closest('.memo');
    return li ? M.find(li.dataset.id) : null;
  }

  function startEdit(memo, comment) {
    editing = { memoId: memo.id, commentId: comment ? comment.id : null, text: (comment || memo).text };
    render();
    focusKey('edit', true);
  }

  function cancelEdit() {
    editing = null;
    render();
  }

  function deleteMemo(memo) {
    if (editing && editing.memoId === memo.id) editing = null;
    delete replyOpen[memo.id];
    M.remove(memo.id).then(function () {
      ui.toast('메모를 삭제했어요', '실행 취소', function () { M.restore(memo).catch(saveFailed); });
    }, saveFailed);
  }

  function deleteComment(memo, comment) {
    M.removeComment(memo.id, comment.id).then(function () {
      ui.toast('댓글을 삭제했어요', '실행 취소', function () { M.restoreComment(memo.id, comment).catch(saveFailed); });
    }, saveFailed);
  }

  els.list.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn || !els.list.contains(btn)) return;
    var memo = memoOf(btn);
    if (!memo) return;
    var cli = btn.closest('.comment');
    var comment = cli && memo.comments ? memo.comments[cli.dataset.cid] : null;

    switch (btn.dataset.action) {
      case 'delete': deleteMemo(memo); break;
      case 'edit': startEdit(memo, null); break;
      case 'edit-comment': if (comment) startEdit(memo, comment); break;
      case 'delete-comment': if (comment) deleteComment(memo, comment); break;
      case 'cancel-edit': cancelEdit(); break;
      case 'reply':
        replyOpen[memo.id] = true;
        render();
        focusKey('reply:' + memo.id);
        break;
    }
  });

  els.list.addEventListener('input', function (e) {
    var t = e.target;
    if (t.dataset.input === 'edit' && editing) {
      editing.text = t.value;
      var count = t.form && t.form.querySelector('.memo-count');
      if (count) count.textContent = t.value.length + ' / ' + t.maxLength;
    } else if (t.dataset.input === 'reply') {
      var memo = memoOf(t);
      if (memo) replyDrafts[memo.id] = t.value;
    }
  });

  els.list.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && e.target.dataset.input === 'edit') {
      e.preventDefault();
      e.stopPropagation();
      cancelEdit();
      return;
    }
    if (e.target.dataset.input === 'edit') submitOnCtrlEnter(e);
  });

  var busy = false;
  els.list.addEventListener('submit', function (e) {
    e.preventDefault();
    if (busy) return;
    var form = e.target;
    var memo = memoOf(form);
    if (!memo) return;
    var field = form.querySelector('textarea, input');
    var text = field.value.trim();
    if (!text) { field.focus(); return; }

    var job, done;
    if (form.dataset.form === 'edit' && editing) {
      var cid = editing.commentId;
      job = cid ? M.editComment(memo.id, cid, text) : M.edit(memo.id, text);
      done = function () {
        editing = null;
        render();
        ui.toast(cid ? '댓글을 고쳤어요' : '메모를 고쳤어요');
      };
    } else if (form.dataset.form === 'reply') {
      job = M.addComment(memo.id, text);
      done = function () {
        delete replyDrafts[memo.id];
        render();
        focusKey('reply:' + memo.id);
      };
    } else {
      return;
    }
    busy = true;
    job.then(done, saveFailed).then(function () { busy = false; });
  });

  // 댓글 입력칸이 비어 있는 채로 밖을 누르면 닫기
  els.list.addEventListener('focusout', function (e) {
    var t = e.target;
    if (t.dataset.input !== 'reply' || t.value.trim()) return;
    var memo = memoOf(t);
    setTimeout(function () {
      var a = document.activeElement;
      if (!memo || (a && t.form && t.form.contains(a))) return;
      if (!els.list.contains(t)) return; // 이미 다시 그려짐
      delete replyOpen[memo.id];
      delete replyDrafts[memo.id];
      render();
    }, 150);
  });

  els.btn.addEventListener('click', open);
  els.back.addEventListener('click', function () { ui.closeOverlay('memos'); });

  M.subscribe(function () { if (!els.panel.hidden) render(); });
  updateCount();
})(window.Fridge = window.Fridge || {});
