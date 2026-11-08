/*
 * 데이터 백업 (내보내기 / 가져오기)
 * ---------------------------------------------------------------
 * 파일 모양: { app: 'fridge', version: 1, exportedAt, items: [...], memos: [...], shopping: [...] }
 * - 내보내기: 지금 보고 있는 목록(이 기기 또는 가족 냉장고)을 JSON 파일로 저장
 * - 가져오기: 지금 목록에 "더하기"만 함 (같은 id 는 건너뜀, 지우거나 덮어쓰지 않음)
 *   서버 규칙(firestore.rules)과 같은 기준으로 검사해서, 맞지 않는 항목은 건너뜀
 */
(function (Fridge) {
  'use strict';

  var APP = 'fridge';
  var VERSION = 1;
  var I = Fridge.ingredients;
  var M = Fridge.memos;
  var S = Fridge.shopping;
  var store = Fridge.storage;
  var LOCATIONS = ['fridge', 'freezer', 'pantry'];
  var ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  var DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

  function str(v, max) {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  }
  // 시각: 숫자가 아니거나 미래면 지금 시각으로
  function time(v) {
    var now = Date.now();
    return typeof v === 'number' && isFinite(v) && v > 0 && v <= now ? v : now;
  }
  function optName(v) {
    var n = str(v, 10);
    return n || undefined;
  }
  function validId(v) { return typeof v === 'string' && ID_RE.test(v); }

  function cleanItem(x) {
    if (!x || !validId(x.id)) return null;
    var name = str(x.name, 40);
    if (!name) return null;
    var created = time(x.createdAt);
    return {
      id: x.id, name: name, quantity: I.clampQty(x.quantity), unit: str(x.unit, 10),
      location: LOCATIONS.indexOf(x.location) !== -1 ? x.location : 'fridge',
      expiry: typeof x.expiry === 'string' && DATE_RE.test(x.expiry) ? x.expiry : null,
      createdAt: created, updatedAt: Math.max(created, time(x.updatedAt))
    };
  }

  function cleanNote(x, max) {
    if (!x || !validId(x.id)) return null;
    var text = str(x.text, max);
    if (!text) return null;
    var out = { id: x.id, text: text, createdAt: time(x.createdAt), by: str(x.by, 10) || '나' };
    if (typeof x.updatedAt === 'number') out.updatedAt = time(x.updatedAt);
    var ed = optName(x.editedBy);
    if (ed) out.editedBy = ed;
    return out;
  }

  function cleanMemo(x) {
    var m = cleanNote(x, M.TEXT_MAX);
    if (!m) return null;
    if (x.comments && typeof x.comments === 'object') {
      var comments = {}, n = 0;
      Object.keys(x.comments).forEach(function (k) {
        if (n >= M.COMMENTS_MAX) return;
        var c = cleanNote(x.comments[k], M.COMMENT_MAX);
        if (c && c.id === k) { comments[k] = c; n++; }
      });
      if (n) m.comments = comments;
    }
    return m;
  }

  function cleanShop(x) {
    if (!x || !validId(x.id)) return null;
    var name = str(x.name, S.NAME_MAX);
    if (!name) return null;
    var out = { id: x.id, name: name, done: x.done === true, createdAt: time(x.createdAt), by: str(x.by, 10) || '나' };
    if (out.done && typeof x.doneAt === 'number') out.doneAt = time(x.doneAt);
    var db = optName(x.doneBy);
    if (out.done && db) out.doneBy = db;
    return out;
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- 내보내기 ---------- */

  function snapshot() {
    return {
      app: APP, version: VERSION, exportedAt: new Date().toISOString(),
      items: (Fridge.ui.items || []).map(function (it) {
        var x = Object.assign({}, it);
        delete x.addedBy;
        delete x.updatedBy;
        return x;
      }),
      memos: M.list,
      shopping: S.list
    };
  }

  function download() {
    var data = snapshot();
    var d = new Date();
    var name = 'fridge-backup-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    return { items: data.items.length, memos: data.memos.length, shopping: data.shopping.length };
  }

  /* ---------- 가져오기 ---------- */

  // 파일 내용(글) → { items, memos, shopping, skipped } (잘못된 파일이면 오류 'bad-file')
  function parse(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('bad-file'); }
    if (!data || data.app !== APP || typeof data.version !== 'number' || data.version > VERSION) throw new Error('bad-file');
    var skipped = 0;
    function each(list, fn) {
      if (!Array.isArray(list)) return [];
      var seen = {};
      return list.map(fn).filter(function (x) {
        if (!x || seen[x.id]) { skipped++; return false; }
        seen[x.id] = true;
        return true;
      });
    }
    var out = {
      items: each(data.items, cleanItem),
      memos: each(data.memos, cleanMemo),
      shopping: each(data.shopping, cleanShop)
    };
    out.skipped = skipped;
    return out;
  }

  // 지금 목록에 없는 것만 → { items, memos, shopping, existing }
  function newOnly(parsed) {
    function ids(list) { var o = {}; list.forEach(function (x) { o[x.id] = true; }); return o; }
    var have = { items: ids(Fridge.ui.items || []), memos: ids(M.list), shopping: ids(S.list) };
    var existing = 0;
    var out = {};
    ['items', 'memos', 'shopping'].forEach(function (k) {
      out[k] = parsed[k].filter(function (x) {
        if (have[k][x.id]) { existing++; return false; }
        return true;
      });
    });
    out.existing = existing;
    return out;
  }

  function apply(adds) {
    return Promise.all([].concat(
      adds.items.map(function (x) { return store.add(x); }),
      adds.memos.map(function (x) { return M.restore(x); }),
      adds.shopping.map(function (x) { return S.restore(x); })
    ));
  }

  function readFile(file) {
    if (file.text) return file.text();
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('bad-file')); };
      r.readAsText(file);
    });
  }

  /* ---------- 가족 공유 화면 맨 아래 "데이터 백업" 칸 ---------- */

  function renderSection(body) {
    var ui = Fridge.ui;
    var el = ui.el;
    var box = el('div', 'backup');
    box.appendChild(el('h3', 'fam-title', '데이터 백업'));
    box.appendChild(el('p', 'fam-text',
      (store.mode === 'family' ? '가족 냉장고' : '이 기기') +
      '의 재료 · 메모 · 장보기 목록을 파일로 저장하거나, 저장한 파일에서 다시 불러와요. ' +
      '불러오기는 지금 목록에 없는 것만 더해요 (지우거나 덮어쓰지 않음).'));

    var file = el('input', 'backup-file');
    file.type = 'file';
    file.accept = '.json,application/json';
    file.setAttribute('aria-hidden', 'true');
    file.tabIndex = -1;

    var row = el('div', 'btn-row');
    var exp = el('button', 'btn ghost', '파일로 저장');
    exp.type = 'button';
    exp.addEventListener('click', function () {
      var n = download();
      ui.toast('재료 ' + n.items + ' · 메모 ' + n.memos + ' · 장보기 ' + n.shopping + '개를 저장했어요');
    });
    var imp = el('button', 'btn ghost', '파일 불러오기');
    imp.type = 'button';
    imp.disabled = store.mode === 'pending';
    imp.addEventListener('click', function () {
      if (store.mode === 'pending') { ui.toast('가족 냉장고에 연결된 뒤 불러와 주세요'); return; }
      file.value = '';
      file.click();
    });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      if (f.size > 5 * 1024 * 1024) { ui.toast('파일이 너무 커요 (5MB까지)'); return; }
      readFile(f).then(parse).then(function (parsed) {
        var adds = newOnly(parsed);
        var total = adds.items.length + adds.memos.length + adds.shopping.length;
        if (!total) {
          ui.toast('새로 더할 것이 없어요' + (adds.existing ? ' (이미 있는 것 ' + adds.existing + '개)' : ''));
          return;
        }
        var msg = '불러온 파일에서 더할까요?\n' +
          '· 재료 ' + adds.items.length + '개\n· 메모 ' + adds.memos.length + '개\n· 장보기 ' + adds.shopping.length + '개' +
          (adds.existing ? '\n(이미 있는 ' + adds.existing + '개는 건너뜀)' : '') +
          (parsed.skipped ? '\n(형식이 맞지 않는 ' + parsed.skipped + '개는 건너뜀)' : '') +
          (store.mode === 'family' ? '\n\n가족 모두의 목록에 더해져요.' : '');
        if (!window.confirm(msg)) return;
        return apply(adds).then(function () {
          ui.toast(total + '개를 불러왔어요');
        });
      }).catch(function (e) {
        if (e && e.message === 'bad-file') ui.toast('냉장고 백업 파일이 아니에요');
        else ui.toast('불러오지 못했어요. 잠시 후 다시 해 주세요');
      });
    });
    row.appendChild(exp);
    row.appendChild(imp);
    box.appendChild(row);
    box.appendChild(file);
    body.appendChild(box);
  }

  Fridge.backup = {
    snapshot: snapshot,
    parse: parse,
    newOnly: newOnly,
    apply: apply,
    download: download,
    renderSection: renderSection
  };
})(window.Fridge = window.Fridge || {});
