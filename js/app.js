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
    sortBy: 'expiry',
    sortDir: 'asc',
    recipeCat: 'all',
    editingId: null
  };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    list: $('list'), empty: $('empty'), emptyText: $('emptyText'),
    banner: $('alertBanner'), search: $('search'),
    sortBy: $('sortBy'), sortDir: $('sortDir'),
    addBtn: $('addBtn'), sheet: $('sheet'), backdrop: $('backdrop'),
    form: $('form'), title: $('sheetTitle'), name: $('fName'), nameError: $('nameError'),
    qty: $('fQty'), unit: $('fUnit'), expiry: $('fExpiry'),
    deleteBtn: $('deleteBtn'), cancelBtn: $('cancelBtn'), saveBtn: $('saveBtn'),
    recipeBtn: $('recipeBtn'), recipePanel: $('recipePanel'), recipeBack: $('recipeBack'),
    recipeBody: $('recipeBody'), recipeSub: $('recipeSub'), recipeTabs: $('recipeTabs'),
    toast: $('toast'), toastText: $('toastText'), toastAction: $('toastAction'), toastAction2: $('toastAction2'),
    cleanupBtn: $('cleanupBtn')
  };

  /* ---------- 렌더링 ---------- */

  function visibleItems() {
    var q = state.query.trim();
    return I.sort(state.items, state.sortBy, state.sortDir).filter(function (it) {
      if (state.filter !== 'all' && it.location !== state.filter) return false;
      if (q && !I.matchesQuery(it.name, q)) return false;
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
    // 줄(row) = 뒤에 깔린 휴지통 + 위에 놓인 카드. 카드를 밀면 휴지통이 드러남
    var row = el('li', 'row');
    row.dataset.id = it.id;
    var bg = el('div', 'swipe-bg');
    ['left', 'right'].forEach(function (side) {
      var t = el('button', 'trash trash-' + side);
      t.type = 'button';
      t.dataset.action = 'delete';
      t.tabIndex = -1;
      t.setAttribute('aria-label', it.name + ' 삭제');
      t.innerHTML = TRASH_SVG + '<span>삭제</span>';
      bg.appendChild(t);
    });
    row.appendChild(bg);

    var li = el('div', 'card status-' + st + (it.quantity <= 0 ? ' is-out' : ''));

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
    if (store.mode === 'family' && it.addedBy) meta.appendChild(el('span', 'by', it.addedBy));
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
    // 수량을 누르면 숫자 키패드로 바로 입력
    var val = el('label', 'qval');
    var input = el('input', 'qinput');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = '0';
    input.max = String(I.MAX_QTY);
    input.step = 'any';
    input.setAttribute('enterkeyhint', 'done');
    input.value = I.formatQty(it.quantity);
    input.setAttribute('aria-label', it.name + ' 수량');
    val.appendChild(input);
    if (it.unit) val.appendChild(el('span', 'qunit', it.unit));
    qty.appendChild(minus);
    qty.appendChild(val);
    qty.appendChild(plus);
    li.appendChild(qty);
    row.appendChild(li);
    return row;
  }

  var TRASH_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // 목록의 수량 칸을 입력 중이면 다시 그리지 않고 입력이 끝난 뒤 그림
  var renderPending = false;
  function isEditingQty() {
    var a = document.activeElement;
    return !!(a && a.classList && a.classList.contains('qinput'));
  }

  function render() {
    if (isEditingQty()) { renderPending = true; return; }
    renderPending = false;
    var items = visibleItems();
    openRow = null;
    els.list.textContent = '';
    var frag = document.createDocumentFragment();
    items.forEach(function (it) { frag.appendChild(renderItem(it)); });
    els.list.appendChild(frag);

    // 다 떨어진 재료 정리 버튼 (지금 보이는 목록 기준)
    var out = items.filter(function (it) { return it.quantity <= 0; }).length;
    els.cleanupBtn.hidden = !out;
    if (out) els.cleanupBtn.textContent = '🧹 다 떨어진 재료 ' + out + '개 정리';

    // 개수
    var counts = { all: state.items.length, fridge: 0, freezer: 0, pantry: 0 };
    var expired = 0, urgent = 0, soon = 0;
    state.items.forEach(function (it) {
      counts[it.location] = (counts[it.location] || 0) + 1;
      if (it.quantity <= 0) return; // 다 떨어진 재료는 유통기한 경고에서 제외
      var s = I.status(it);
      if (s === 'expired') expired++;
      else if (s === 'urgent') urgent++;
      else if (s === 'soon') soon++;
    });
    document.querySelectorAll('[data-count]').forEach(function (b) {
      b.textContent = counts[b.dataset.count] || 0;
    });

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
      els.emptyText.innerHTML = store.mode === 'pending'
        ? '가족 냉장고 불러오는 중…'
        : state.items.length
        ? '조건에 맞는 재료가 없어요.'
        : '아직 등록된 재료가 없어요.<br>아래 <b>+</b> 버튼으로 추가해 보세요.';
    }
  }

  /* ---------- 바텀시트 ---------- */

  /*
   * 겹쳐 뜨는 화면(입력 시트, 레시피 화면) 관리.
   * 열 때 방문 기록을 하나 추가해서, 안드로이드 뒤로가기를 누르면
   * 앱이 꺼지지 않고 맨 위 화면만 닫히게 합니다.
   */
  var overlays = [];

  function isOverlayOpen(name) {
    return overlays.some(function (o) { return o.name === name; });
  }

  function openOverlay(name, hide) {
    if (isOverlayOpen(name)) return;
    var pushed = false;
    try { history.pushState({ overlay: name }, ''); pushed = true; } catch (e) { /* 무시 */ }
    overlays.push({ name: name, hide: hide, pushed: pushed });
  }

  // 버튼으로 닫을 때: 추가했던 기록을 되돌리면 popstate 에서 닫힘
  function closeOverlay(name) {
    var top = overlays[overlays.length - 1];
    if (!top || top.name !== name) return;
    if (top.pushed) {
      history.back();
    } else {
      overlays.pop();
      top.hide();
    }
  }

  // 겹친 화면이 모두 닫혔을 때만 뒤 화면 스크롤 잠금 해제 (hide 는 overlays 에서 빠진 뒤 불림)
  function unlockScroll() {
    if (!overlays.length) document.body.classList.remove('no-scroll');
  }

  window.addEventListener('popstate', function () {
    var top = overlays.pop();
    if (top) top.hide();
  });


  var submitting = false;

  // item: 고칠 재료 (없으면 새로 추가), prefill: 새로 추가할 때 미리 채울 값 { name } (장보기에서 넣을 때)
  function openSheet(item, prefill) {
    state.editingId = item ? item.id : null;
    setSubmitting(false);
    els.title.textContent = item ? '재료 수정' : '재료 추가';
    els.deleteBtn.hidden = !item;
    els.nameError.hidden = true;
    els.name.value = item ? item.name : (prefill && prefill.name ? String(prefill.name).slice(0, 40) : '');
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
    if (!item && !(prefill && prefill.name)) setTimeout(function () { els.name.focus(); }, 250);

    openOverlay('sheet', hideSheet);
  }

  function hideSheet() {
    els.backdrop.classList.remove('show');
    els.sheet.classList.remove('show');
    unlockScroll();
    if (document.activeElement) document.activeElement.blur();
    setTimeout(function () {
      if (!els.sheet.classList.contains('show')) {
        els.sheet.hidden = true;
        els.backdrop.hidden = true;
      }
    }, 220);
    state.editingId = null;
    setSubmitting(false);
  }

  // 저장 버튼 연타로 같은 재료가 두 번 들어가지 않게
  function setSubmitting(on) {
    submitting = on;
    els.saveBtn.disabled = on;
  }

  function closeSheet() { closeOverlay('sheet'); }

  /* ---------- 추천 레시피 화면 ---------- */

  function openRecipes() {
    renderRecipes();
    els.recipePanel.hidden = false;
    els.recipePanel.scrollTop = 0;
    requestAnimationFrame(function () { els.recipePanel.classList.add('show'); });
    document.body.classList.add('no-scroll');
    openOverlay('recipes', hideRecipes);
  }

  function hideRecipes() {
    els.recipePanel.classList.remove('show');
    unlockScroll();
    setTimeout(function () {
      if (!els.recipePanel.classList.contains('show')) els.recipePanel.hidden = true;
    }, 220);
  }

  function chip(text, cls) {
    return el('span', 'rchip' + (cls ? ' ' + cls : ''), text);
  }

  function renderRecipeCard(r) {
    var card = el('details', 'recipe');
    var sum = el('summary');
    var head = el('div', 'recipe-head');
    head.appendChild(el('span', 'recipe-title', r.recipe.title));
    head.appendChild(el('span', 'recipe-time', r.recipe.time));
    sum.appendChild(head);
    if (r.urgent) sum.appendChild(el('div', 'recipe-urgent', '유통기한 급한 재료 ' + r.urgent + '개 사용'));

    var chips = el('div', 'recipe-chips');
    r.have.concat(r.extra).forEach(function (h) {
      var st = I.status(h.item);
      chips.appendChild(chip(h.item.name, 'have st-' + st));
    });
    r.missing.forEach(function (name) { chips.appendChild(chip(name + ' 없음', 'missing')); });
    sum.appendChild(chips);
    card.appendChild(sum);

    var body = el('div', 'recipe-body');
    var opt = r.recipe.optional.filter(function (n) {
      return !r.extra.some(function (x) { return x.name === n; });
    });
    if (opt.length) body.appendChild(el('p', 'recipe-note', '있으면 좋아요: ' + opt.join(', ')));
    if (r.recipe.sauce.length) body.appendChild(el('p', 'recipe-note', '기본 양념: ' + r.recipe.sauce.join(', ')));
    var ol = el('ol', 'recipe-steps');
    r.recipe.steps.forEach(function (st) { ol.appendChild(el('li', null, st)); });
    body.appendChild(ol);
    card.appendChild(body);
    return card;
  }

  /* 종류 탭 (선택은 이 기기에만 기억) */
  var RECIPE_CAT_KEY = 'fridge-app:recipeCat';
  var CATS = Fridge.RECIPE_DATA.CATEGORIES;

  function loadRecipeCat() {
    try {
      var c = window.localStorage.getItem(RECIPE_CAT_KEY);
      if (CATS.some(function (x) { return x.id === c; })) state.recipeCat = c;
    } catch (e) { /* 기본값(전체) */ }
  }

  function saveRecipeCat() {
    try { window.localStorage.setItem(RECIPE_CAT_KEY, state.recipeCat); } catch (e) { /* 이번 화면에서만 적용 */ }
  }

  function renderRecipeTabs(list) {
    var count = { all: list.length };
    list.forEach(function (r) { count[r.recipe.cat] = (count[r.recipe.cat] || 0) + 1; });
    // 지금 재료로 나오는 레시피가 없는 종류는 숨기고, 고른 종류가 비면 전체로
    if (!count[state.recipeCat]) state.recipeCat = 'all';
    var nav = els.recipeTabs;
    nav.textContent = '';
    nav.hidden = !list.length;
    CATS.forEach(function (c) {
      if (!count[c.id]) return;
      var on = c.id === state.recipeCat;
      var b = el('button', 'rtab' + (on ? ' is-active' : ''), c.label + ' ');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      b.dataset.cat = c.id;
      b.appendChild(el('b', null, String(count[c.id])));
      nav.appendChild(b);
    });
    var active = nav.querySelector('.is-active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderRecipes() {
    var stock = state.items.filter(function (it) { return it.quantity > 0; });
    Fridge.recipes.recommend(state.items).then(function (all) {
      var body = els.recipeBody;
      body.textContent = '';
      els.recipeSub.textContent = '가진 재료 ' + stock.length + '개 · 유통기한 급한 재료 먼저';
      renderRecipeTabs(all);
      if (!all.length) {
        var empty = el('div', 'empty');
        empty.appendChild(el('div', 'empty-icon', '🍳'));
        empty.appendChild(el('p', null, stock.length
          ? '지금 재료로 맞는 레시피를 찾지 못했어요. 재료를 더 등록해 보세요.'
          : '재료를 등록하면 만들 수 있는 요리를 추천해 드려요.'));
        body.appendChild(empty);
        return;
      }
      var list = state.recipeCat === 'all' ? all : all.filter(function (r) { return r.recipe.cat === state.recipeCat; });
      var groups = [
        { title: '바로 만들 수 있어요', items: list.filter(function (r) { return !r.missing.length; }) },
        { title: '재료 1~2가지만 더 있으면', items: list.filter(function (r) { return r.missing.length; }) }
      ];
      groups.forEach(function (g) {
        if (!g.items.length) return;
        var h = el('h3', 'recipe-group', g.title + ' ');
        h.appendChild(el('b', null, String(g.items.length)));
        body.appendChild(h);
        g.items.forEach(function (r) { body.appendChild(renderRecipeCard(r)); });
      });
    });
  }

  els.recipeTabs.addEventListener('click', function (e) {
    var b = e.target.closest('.rtab');
    if (!b || b.dataset.cat === state.recipeCat) return;
    state.recipeCat = b.dataset.cat;
    saveRecipeCat();
    renderRecipes();
    els.recipePanel.scrollTop = 0;
  });

  loadRecipeCat();


  /* ---------- 토스트 ---------- */

  // toast(글) · toast(글, 버튼 이름, 누르면 할 일) · toast(글, [{ label, onClick }, …최대 2개])
  var toastTimer = null;
  function toast(msg, actionLabel, onAction) {
    var actions = Array.isArray(actionLabel) ? actionLabel
      : onAction ? [{ label: actionLabel, onClick: onAction }] : [];
    els.toastText.textContent = msg;
    [els.toastAction, els.toastAction2].forEach(function (b, i) {
      var a = actions[i];
      b.hidden = !a;
      b.textContent = a ? a.label : '';
      b.onclick = a ? function () { hideToast(); a.onClick(); } : null;
    });
    els.toast.hidden = false;
    requestAnimationFrame(function () { els.toast.classList.add('show'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actions.length ? 5000 : 2200);
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
      quantity: isFinite(q) && q >= 0 ? I.clampQty(q) : 1,
      unit: els.unit.value.trim(),
      location: els.form.querySelector('input[name="location"]:checked').value,
      expiry: els.expiry.value || null
    };
  }

  function onSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    var f = readForm();
    if (!f.name) {
      els.nameError.hidden = false;
      els.name.focus();
      return;
    }
    var editing = !!state.editingId;
    // 수정하는 동안 다른 기기(가족)에서 지워졌으면 새로 추가할지 물어봄
    if (editing && !findItem(state.editingId)) {
      if (!window.confirm('“' + f.name + '”은(는) 다른 곳에서 삭제된 재료예요.\n새로 추가할까요?')) {
        closeSheet();
        return;
      }
      state.editingId = null;
      editing = false;
    }
    var p, msg;
    // 같은 이름·위치·단위의 재료가 있으면 합칠지 물어봄 (수정할 때는 고치는 재료 자신은 빼고 찾음)
    var editId = state.editingId;
    var others = editing ? state.items.filter(function (it) { return it.id !== editId; }) : state.items;
    var same = I.findSame(others, f);
    if (same && window.confirm('이미 있는 “' + same.name + '” ' + I.formatQty(same.quantity) + (same.unit || '') +
        '에 수량을 더할까요?\n[취소]를 누르면 따로 ' + (editing ? '둬요.' : '추가해요.'))) {
      var m = I.mergedFields(same, f);
      p = store.update(same.id, m, { readd: true });
      // 수정하던 재료는 합쳐졌으므로 지움
      if (editing) p = p.then(function () { return store.remove(editId); });
      msg = '“' + same.name + '”에 합쳤어요 · ' + I.formatQty(m.quantity) + (same.unit || '');
    } else if (editing) {
      p = store.update(state.editingId, f);
      msg = '수정했어요';
    } else {
      p = store.add(I.create(f));
      msg = '“' + f.name + '” 추가했어요';
    }
    setSubmitting(true);
    p.then(function () {
      closeSheet();
      toast(msg);
    }, function () {
      setSubmitting(false);
      saveFailed();
    });
  }

  // 가족 냉장고에 연결되기 전 등 저장할 수 없을 때
  function saveFailed() {
    toast('아직 가족 냉장고에 연결되지 않았어요. 잠시 후 다시 해 주세요');
  }

  function removeItem(id) {
    var item = findItem(id);
    if (!item) return;
    store.remove(id).then(function () {
      toast('“' + item.name + '” 삭제했어요', '실행 취소', function () { store.add(item).catch(saveFailed); });
    }, saveFailed);
  }

  function changeQty(id, delta) {
    var item = findItem(id);
    if (item) setQty(id, item.quantity + delta);
  }

  function setQty(id, value) {
    var item = findItem(id);
    if (!item) return;
    var next = I.clampQty(value);
    if (next === item.quantity) return;
    store.update(id, { quantity: next }).catch(function () { saveFailed(); render(); });
    if (next === 0) {
      toast('“' + item.name + '” 다 떨어졌어요', [
        { label: '장보기 추가', onClick: function () { addToShopping(item.name); } },
        { label: '삭제', onClick: function () { removeItem(id); } }
      ]);
    }
  }

  function addToShopping(name) {
    Fridge.shopping.add(name).then(function () {
      toast('“' + name + '” 장보기에 넣었어요');
    }, function (e) {
      if (e && e.message === 'duplicate') toast('“' + name + '”은(는) 이미 장보기에 있어요');
      else saveFailed();
    });
  }

  // 다 떨어진 재료 한 번에 지우기 (지금 보이는 목록 기준, 실행 취소 가능)
  function cleanupOut() {
    var out = visibleItems().filter(function (it) { return it.quantity <= 0; });
    if (!out.length) return;
    if (!window.confirm('다 떨어진 재료 ' + out.length + '개를 지울까요?\n' +
        out.slice(0, 5).map(function (it) { return '· ' + it.name; }).join('\n') + (out.length > 5 ? '\n…' : ''))) return;
    Promise.all(out.map(function (it) { return store.remove(it.id); })).then(function () {
      toast(out.length + '개 정리했어요', '실행 취소', function () {
        Promise.all(out.map(function (it) { return store.add(it); })).catch(saveFailed);
      });
    }, saveFailed);
  }

  /* ---------- 이벤트 연결 ---------- */

  els.addBtn.addEventListener('click', function () { openSheet(null); });
  els.cleanupBtn.addEventListener('click', cleanupOut);
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
      els.qty.value = I.formatQty(I.clampQty(v + Number(step.dataset.step)));
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
    var id = btn.closest('.row').dataset.id;
    var action = btn.dataset.action;
    if (action === 'delete') removeItem(id);
    else if (action === 'edit') openSheet(findItem(id));
    else if (action === 'inc') changeQty(id, 1);
    else if (action === 'dec') changeQty(id, -1);
  });

  // 수량 칸: 누르면 전체 선택 → 새 숫자 입력 → 완료(Enter) 또는 다른 곳 누르면 저장
  els.list.addEventListener('focusin', function (e) {
    if (e.target.classList.contains('qinput')) e.target.select();
  });
  els.list.addEventListener('keydown', function (e) {
    if (e.target.classList.contains('qinput') && e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    }
  });
  els.list.addEventListener('focusout', function (e) {
    var input = e.target;
    if (!input.classList.contains('qinput')) return;
    var id = input.closest('.row').dataset.id;
    var item = findItem(id);
    var v = parseFloat(input.value);
    // focusout 이 끝난 뒤(포커스가 빠진 상태에서) 저장·다시 그리기
    setTimeout(function () {
      if (item && isFinite(v) && v >= 0) setQty(id, v);
      // 잘못된 값이거나 상한을 넘어 고쳐졌으면 화면을 다시 그려 실제 값으로 보여줌
      if (renderPending || !item || !(isFinite(v) && v >= 0) || I.clampQty(v) !== v) render();
    }, 0);
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

  /* ---------- 정렬 (이 기기에만 기억) ---------- */

  var SORT_KEY = 'fridge-app:sort';

  function loadSort() {
    try {
      var s = JSON.parse(window.localStorage.getItem(SORT_KEY) || 'null');
      if (s && I.SORT_BY.indexOf(s.by) !== -1) state.sortBy = s.by;
      if (s && (s.dir === 'asc' || s.dir === 'desc')) state.sortDir = s.dir;
    } catch (e) { /* 기본값 사용 */ }
  }

  function saveSort() {
    try {
      window.localStorage.setItem(SORT_KEY, JSON.stringify({ by: state.sortBy, dir: state.sortDir }));
    } catch (e) { /* 저장 못 해도 이번 화면에서는 적용 */ }
  }

  function showSort() {
    els.sortBy.value = state.sortBy;
    var desc = state.sortDir === 'desc';
    els.sortDir.textContent = desc ? '↓' : '↑';
    var label = (desc ? '내림차순' : '오름차순') + ' (누르면 ' + (desc ? '오름차순' : '내림차순') + ')';
    els.sortDir.setAttribute('aria-label', label);
    els.sortDir.title = label;
  }

  els.sortBy.addEventListener('change', function () {
    state.sortBy = I.SORT_BY.indexOf(els.sortBy.value) !== -1 ? els.sortBy.value : 'expiry';
    saveSort();
    showSort();
    render();
  });

  els.sortDir.addEventListener('click', function () {
    state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
    saveSort();
    showSort();
    render();
  });

  loadSort();
  showSort();

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
    if (e.key === 'Escape' && overlays.length) closeOverlay(overlays[overlays.length - 1].name);
  });

  els.recipeBtn.addEventListener('click', openRecipes);
  els.recipeBack.addEventListener('click', function () { closeOverlay('recipes'); });

  /* ---------- 밀어서 삭제 ---------- */
  // 카드를 왼쪽이나 오른쪽으로 밀면 휴지통이 나오고, 누르면 삭제(실행 취소 가능)

  var OPEN = 84;          // 열렸을 때 밀린 거리(px)
  var openRow = null;     // 지금 열려 있는 줄
  var swipe = null;       // 밀고 있는 중의 정보
  var suppressClick = false;

  function setOffset(row, x, animate) {
    var card = row.querySelector('.card');
    card.style.transition = animate ? '' : 'none';
    card.style.transform = x ? 'translateX(' + x + 'px)' : '';
    row.dataset.offset = x;
    row.classList.toggle('open-left', x > 0);
    row.classList.toggle('open-right', x < 0);
  }

  function closeOpenRow() {
    if (openRow) setOffset(openRow, 0, true);
    openRow = null;
  }

  els.list.addEventListener('pointerdown', function (e) {
    suppressClick = false;
    if (e.button > 0) return;
    var card = e.target.closest('.card');
    if (!card) return;
    var row = card.closest('.row');
    if (openRow && openRow !== row) closeOpenRow();
    swipe = {
      row: row, card: card, id: e.pointerId,
      x: e.clientX, y: e.clientY,
      base: Number(row.dataset.offset) || 0,
      horizontal: false
    };
  });

  els.list.addEventListener('pointermove', function (e) {
    if (!swipe || e.pointerId !== swipe.id) return;
    var dx = e.clientX - swipe.x;
    var dy = e.clientY - swipe.y;
    if (!swipe.horizontal) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        swipe.horizontal = true;
        try { swipe.card.setPointerCapture(e.pointerId); } catch (err) { /* 무시 */ }
        if (isEditingQty()) document.activeElement.blur();
      } else if (Math.abs(dy) > 10) {
        swipe = null; // 세로 스크롤
        return;
      } else {
        return;
      }
    }
    var x = Math.max(-OPEN * 1.4, Math.min(OPEN * 1.4, swipe.base + dx));
    setOffset(swipe.row, x, false);
  });

  function endSwipe(e) {
    if (!swipe || e.pointerId !== swipe.id) return;
    if (swipe.horizontal) {
      var x = Number(swipe.row.dataset.offset) || 0;
      var target = Math.abs(x) > OPEN / 2 ? (x > 0 ? OPEN : -OPEN) : 0;
      setOffset(swipe.row, target, true);
      openRow = target ? swipe.row : null;
      suppressClick = true; // 민 뒤에 따라오는 클릭(수정 창 열림) 막기
    }
    swipe = null;
  }
  els.list.addEventListener('pointerup', endSwipe);
  els.list.addEventListener('pointercancel', endSwipe);

  // 클릭 가로채기: 밀고 난 직후 클릭 무시, 열린 카드를 누르면 닫기만
  els.list.addEventListener('click', function (e) {
    if (suppressClick) {
      suppressClick = false;
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (openRow && openRow.contains(e.target) && e.target.closest('.card')) {
      closeOpenRow();
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  // 다른 곳을 누르면 열린 줄 닫기
  document.addEventListener('pointerdown', function (e) {
    if (openRow && !openRow.contains(e.target)) closeOpenRow();
  });

  // 날짜가 바뀌면(자정이 지나면) D-day 다시 계산
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) render();
  });

  /* ---------- 다른 화면(가족 공유)에서 쓰는 도구 ---------- */

  Fridge.ui = {
    el: el,
    toast: toast,
    render: render,
    openOverlay: openOverlay,
    closeOverlay: closeOverlay,
    unlockScroll: unlockScroll,
    openAdd: function (prefill) { openSheet(null, prefill); },
    get items() { return state.items; },
    openRecipes: openRecipes
  };

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
