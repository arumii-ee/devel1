/*
 * 화면 렌더링 · 이벤트 처리
 */
(function (Fridge) {
  'use strict';

  var store = Fridge.storage;
  var I = Fridge.ingredients;

  var state = {
    items: [],
    filter: 'all',
    query: '',
    editingId: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    list: $('list'), empty: $('empty'), emptyText: $('emptyText'),
    total: $('totalCount'), banner: $('alertBanner'), search: $('search'),
    addBtn: $('addBtn'), sheet: $('sheet'), backdrop: $('backdrop'),
    form: $('form'), title: $('sheetTitle'), name: $('fName'), nameError: $('nameError'),
    qty: $('fQty'), unit: $('fUnit'), expiry: $('fExpiry'),
    deleteBtn: $('deleteBtn'), cancelBtn: $('cancelBtn'),
    toast: $('toast'), toastText: $('toastText'), toastAction: $('toastAction')
  };

  /* ---------- 렌더링 ---------- */

  function visibleItems() {
    var q = state.query.trim().toLowerCase();
    return I.sort(state.items).filter(function (it) {
      if (state.filter !== 'all' && it.location !== state.filter) return false;
      if (q && it.name.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderItem(it) {
    var st = I.status(it);
    var loc = I.LOCATIONS[it.location];
    var li = el('li', 'card status-' + st + (it.quantity <= 0 ? ' is-out' : ''));
    li.dataset.id = it.id;

    var main = el('button', 'card-main');
    main.type = 'button';
    main.dataset.action = 'edit';
    main.setAttribute('aria-label', it.name + ' 수정');

    var top = el('div', 'card-top');
    top.appendChild(el('span', 'card-name', it.name));
    if (st !== 'none') top.appendChild(el('span', 'badge badge-' + st, I.dday(it)));
    main.appendChild(top);

    var meta = el('div', 'card-meta');
    meta.appendChild(el('span', 'loc', loc.icon + ' ' + loc.label));
    if (it.expiry) meta.appendChild(el('span', null, '~ ' + it.expiry.slice(5).replace('-', '/')));
    if (it.quantity <= 0) meta.appendChild(el('span', 'out', '다 떨어짐'));
    main.appendChild(meta);
    li.appendChild(main);

    var qty = el('div', 'card-qty');
    var minus = el('button', 'qbtn', '−');
    minus.type = 'button';
    minus.dataset.action = 'dec';
    minus.setAttribute('aria-label', it.name + ' 수량 줄이기');
    var plus = el('button', 'qbtn', '+');
    plus.type = 'button';
    plus.dataset.action = 'inc';
    plus.setAttribute('aria-label', it.name + ' 수량 늘리기');
    var val = el('span', 'qval', I.formatQty(it.quantity) + (it.unit ? it.unit : ''));
    qty.appendChild(minus);
    qty.appendChild(val);
    qty.appendChild(plus);
    li.appendChild(qty);
    return li;
  }

  function render() {
    var items = visibleItems();
    els.list.textContent = '';
    var frag = document.createDocumentFragment();
    items.forEach(function (it) { frag.appendChild(renderItem(it)); });
    els.list.appendChild(frag);

    // 개수
    var counts = { all: state.items.length, fridge: 0, freezer: 0, pantry: 0 };
    var expired = 0, urgent = 0, soon = 0;
    state.items.forEach(function (it) {
      counts[it.location] = (counts[it.location] || 0) + 1;
      var s = I.status(it);
      if (s === 'expired') expired++;
      else if (s === 'urgent') urgent++;
      else if (s === 'soon') soon++;
    });
    document.querySelectorAll('[data-count]').forEach(function (b) {
      b.textContent = counts[b.dataset.count] || 0;
    });
    els.total.textContent = state.items.length + '개';

    // 임박 알림 배너
    var parts = [];
    if (expired) parts.push('지남 ' + expired);
    if (urgent) parts.push('임박 ' + urgent);
    if (soon) parts.push('7일 내 ' + soon);
    if (parts.length) {
      els.banner.hidden = false;
      els.banner.className = 'alert-banner level-' + (expired ? 'expired' : urgent ? 'urgent' : 'soon');
      els.banner.textContent = '⚠️ ' + parts.join(' · ');
    } else {
      els.banner.hidden = true;
    }

    // 빈 화면
    els.empty.hidden = items.length > 0;
    if (!items.length) {
      els.emptyText.innerHTML = state.items.length
        ? '조건에 맞는 재료가 없어요.'
        : '아직 등록된 재료가 없어요.<br>아래 <b>+</b> 버튼으로 추가해 보세요.';
    }
  }

  /* ---------- 바텀시트 ---------- */

  var sheetInHistory = false;

  function openSheet(item) {
    state.editingId = item ? item.id : null;
    els.title.textContent = item ? '재료 수정' : '재료 추가';
    els.deleteBtn.hidden = !item;
    els.nameError.hidden = true;
    els.name.value = item ? item.name : '';
    els.qty.value = item ? I.formatQty(item.quantity) : '1';
    els.unit.value = item ? item.unit : '';
    els.expiry.value = item && item.expiry ? item.expiry : '';
    var loc = item ? item.location : (state.filter !== 'all' ? state.filter : 'fridge');
    els.form.querySelector('input[name="location"][value="' + loc + '"]').checked = true;

    els.backdrop.hidden = false;
    els.sheet.hidden = false;
    requestAnimationFrame(function () {
      els.backdrop.classList.add('show');
      els.sheet.classList.add('show');
    });
    document.body.classList.add('no-scroll');
    if (!item) setTimeout(function () { els.name.focus(); }, 250);

    // 안드로이드 뒤로가기 버튼으로 시트만 닫히도록 기록 추가
    if (!sheetInHistory) {
      try { history.pushState({ sheet: true }, ''); sheetInHistory = true; } catch (e) { /* 무시 */ }
    }
  }

  function hideSheet() {
    els.backdrop.classList.remove('show');
    els.sheet.classList.remove('show');
    document.body.classList.remove('no-scroll');
    if (document.activeElement) document.activeElement.blur();
    setTimeout(function () {
      if (!els.sheet.classList.contains('show')) {
        els.sheet.hidden = true;
        els.backdrop.hidden = true;
      }
    }, 220);
    state.editingId = null;
  }

  // 버튼으로 닫을 때: 추가했던 기록을 되돌리면 popstate 에서 닫힘
  function closeSheet() {
    if (sheetInHistory) {
      history.back();
    } else {
      hideSheet();
    }
  }

  window.addEventListener('popstate', function () {
    if (sheetInHistory) {
      sheetInHistory = false;
      hideSheet();
    }
  });

  function isSheetOpen() { return !els.sheet.hidden && els.sheet.classList.contains('show'); }

  /* ---------- 토스트 ---------- */

  var toastTimer = null;
  function toast(msg, actionLabel, onAction) {
    els.toastText.textContent = msg;
    els.toastAction.hidden = !onAction;
    if (onAction) els.toastAction.textContent = actionLabel;
    els.toastAction.onclick = onAction ? function () { hideToast(); onAction(); } : null;
    els.toast.hidden = false;
    requestAnimationFrame(function () { els.toast.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, onAction ? 5000 : 2200);
  }
  function hideToast() {
    els.toast.classList.remove('show');
    setTimeout(function () { if (!els.toast.classList.contains('show')) els.toast.hidden = true; }, 200);
  }

  /* ---------- 동작 ---------- */

  function findItem(id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  }

  function readForm() {
    var q = parseFloat(els.qty.value);
    return {
      name: els.name.value.trim(),
      quantity: isFinite(q) && q >= 0 ? q : 1,
      unit: els.unit.value.trim(),
      location: els.form.querySelector('input[name="location"]:checked').value,
      expiry: els.expiry.value || null
    };
  }

  function onSubmit(e) {
    e.preventDefault();
    var f = readForm();
    if (!f.name) {
      els.nameError.hidden = false;
      els.name.focus();
      return;
    }
    var p = state.editingId
      ? store.update(state.editingId, f)
      : store.add(I.create(f));
    var editing = !!state.editingId;
    p.then(function () {
      closeSheet();
      toast(editing ? '수정했어요' : '“' + f.name + '” 추가했어요');
    });
  }

  function removeItem(id) {
    var item = findItem(id);
    if (!item) return;
    store.remove(id).then(function () {
      toast('“' + item.name + '” 삭제했어요', '실행 취소', function () { store.add(item); });
    });
  }

  function changeQty(id, delta) {
    var item = findItem(id);
    if (!item) return;
    var next = Math.max(0, Math.round((item.quantity + delta) * 100) / 100);
    if (next === item.quantity) return;
    store.update(id, { quantity: next });
    if (next === 0) toast('“' + item.name + '” 다 떨어졌어요', '삭제', function () { removeItem(id); });
  }

  /* ---------- 이벤트 연결 ---------- */

  els.addBtn.addEventListener('click', function () { openSheet(null); });
  els.cancelBtn.addEventListener('click', closeSheet);
  els.backdrop.addEventListener('click', closeSheet);
  els.form.addEventListener('submit', onSubmit);
  els.name.addEventListener('input', function () { els.nameError.hidden = true; });

  els.deleteBtn.addEventListener('click', function () {
    var id = state.editingId;
    var item = findItem(id);
    if (!item) return;
    if (!window.confirm('“' + item.name + '”을(를) 삭제할까요?')) return;
    closeSheet();
    removeItem(id);
  });

  els.form.addEventListener('click', function (e) {
    var step = e.target.closest('[data-step]');
    if (step) {
      var v = parseFloat(els.qty.value) || 0;
      els.qty.value = I.formatQty(Math.max(0, v + Number(step.dataset.step)));
      return;
    }
    var chip = e.target.closest('[data-days]');
    if (chip) {
      els.expiry.value = chip.dataset.days === '' ? '' : I.addDays(Number(chip.dataset.days));
    }
  });

  els.list.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var id = btn.closest('.card').dataset.id;
    var action = btn.dataset.action;
    if (action === 'edit') openSheet(findItem(id));
    else if (action === 'inc') changeQty(id, 1);
    else if (action === 'dec') changeQty(id, -1);
  });

  document.querySelector('.tabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.tab');
    if (!tab) return;
    state.filter = tab.dataset.filter;
    document.querySelectorAll('.tab').forEach(function (t) {
      var on = t === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    render();
  });

  els.search.addEventListener('input', function () {
    state.query = els.search.value;
    render();
  });

  // 배너를 누르면 '전체'로 돌아가 맨 위로
  els.banner.addEventListener('click', function () {
    document.querySelector('.tab[data-filter="all"]').click();
    els.search.value = '';
    state.query = '';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isSheetOpen()) closeSheet();
  });

  // 날짜가 바뀌면(자정이 지나면) D-day 다시 계산
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) render();
  });

  /* ---------- 시작 ---------- */

  store.subscribe(function (items) {
    state.items = items;
    render();
  });
  store.list().then(function (items) {
    state.items = items;
    render();
  });
})(window.Fridge = window.Fridge || {});
