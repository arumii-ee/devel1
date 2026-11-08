/*
 * 장보기 목록
 * ---------------------------------------------------------------
 * 항목 1개: { id, name, done, createdAt, by, doneAt?, doneBy? }
 * 저장 위치(어댑터)는 메모처럼 바꿔 끼웁니다.
 *   - local  : 이 기기 브라우저(localStorage), 남긴 사람은 '나'
 *   - family : 가족 공유(Firestore families/{fid}/shopping, js/family.js 에서 연결)
 * 어댑터 모양: list() / add(item) / update(id, fields) / remove(id) / subscribe(cb) / author()
 */
(function (Fridge) {
  'use strict';

  var KEY = 'fridge-app:shopping:v1';
  var VERSION = 1;
  var NAME_MAX = 40;
  var LOCAL_NAME = '나';

  /* ---------- 이 기기에만 저장 ---------- */
  function createLocalAdapter() {
    var memory = null;
    var listeners = [];

    function read() {
      try {
        var raw = window.localStorage.getItem(KEY);
        if (!raw) return memory ? memory.slice() : [];
        var data = JSON.parse(raw);
        return Array.isArray(data.items) ? data.items : [];
      } catch (e) {
        return memory ? memory.slice() : [];
      }
    }

    function write(items) {
      memory = items.slice();
      try {
        window.localStorage.setItem(KEY, JSON.stringify({ version: VERSION, items: items }));
      } catch (e) { /* 메모리에만 유지 */ }
      listeners.forEach(function (cb) { cb(items.slice()); });
    }

    window.addEventListener('storage', function (e) {
      if (e.key === KEY) {
        var items = read();
        listeners.forEach(function (cb) { cb(items.slice()); });
      }
    });

    return {
      name: 'local',
      author: function () { return LOCAL_NAME; },
      list: function () { return Promise.resolve(read()); },
      add: function (it) {
        var items = read().filter(function (x) { return x.id !== it.id; });
        items.push(it);
        write(items);
        return Promise.resolve(it);
      },
      update: function (id, fields) {
        var found = false;
        var items = read().map(function (x) {
          if (x.id !== id) return x;
          found = true;
          return Object.assign({}, x, fields);
        });
        if (found) write(items);
        return found ? Promise.resolve() : Promise.reject(new Error('not-found'));
      },
      remove: function (id) {
        write(read().filter(function (x) { return x.id !== id; }));
        return Promise.resolve();
      },
      subscribe: function (cb) {
        listeners.push(cb);
        return function () { listeners = listeners.filter(function (l) { return l !== cb; }); };
      }
    };
  }

  /* ---------- 연결 중(아직 데이터 없음) ---------- */
  function createPendingAdapter() {
    function fail() { return Promise.reject(new Error('not-connected')); }
    return {
      name: 'pending',
      author: function () { return ''; },
      list: function () { return Promise.resolve([]); },
      add: fail, update: fail, remove: fail,
      subscribe: function () { return function () {}; }
    };
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function norm(s) {
    return String(s || '').replace(/\s+/g, '').toLowerCase();
  }

  function cleanName(s) {
    return String(s || '').trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
  }

  // 안 산 것(최근에 넣은 것이 위) → 산 것(최근에 산 것이 위)
  function sorted(items) {
    return items.slice().sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      if (a.done) return (b.doneAt || 0) - (a.doneAt || 0);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  /* ---------- 바꿔 끼울 수 있는 저장소 ---------- */
  var local = createLocalAdapter();
  var current = local;
  var unsubscribe = current.subscribe(emit);
  var last = [];
  var listeners = [];

  function emit(items) {
    last = sorted(items.filter(function (x) { return x && x.id && x.name; }));
    listeners.forEach(function (cb) { cb(last); });
  }

  function find(id) {
    for (var i = 0; i < last.length; i++) if (last[i].id === id) return last[i];
    return null;
  }

  // 아직 안 산 같은 이름(공백·대소문자 무시)
  function findOpen(name) {
    var key = norm(name);
    for (var i = 0; i < last.length; i++) if (!last[i].done && norm(last[i].name) === key) return last[i];
    return null;
  }

  function author() { return current.author() || LOCAL_NAME; }

  Fridge.shopping = {
    NAME_MAX: NAME_MAX,
    local: local,
    pending: createPendingAdapter,
    find: find,
    findOpen: findOpen,
    get mode() { return current.name; },
    get list() { return last; },
    get openCount() { return last.filter(function (x) { return !x.done; }).length; },

    use: function (adapter) {
      if (current === adapter) return Promise.resolve();
      if (unsubscribe) unsubscribe();
      current = adapter;
      unsubscribe = adapter.subscribe(emit);
      return adapter.list().then(function (items) { if (current === adapter) emit(items); });
    },

    // 넣기 → 넣은 항목. 아직 안 산 같은 이름이 있으면 'duplicate' 오류(그 항목은 e.item)
    add: function (name) {
      name = cleanName(name);
      if (!name) return Promise.reject(new Error('empty'));
      var same = findOpen(name);
      if (same) { var e = new Error('duplicate'); e.item = same; return Promise.reject(e); }
      var it = { id: newId(), name: name, done: false, createdAt: Date.now(), by: author() };
      return current.add(it).then(function () { return it; });
    },
    // 산 것 ↔ 안 산 것
    setDone: function (id, done) {
      var it = find(id);
      if (!it) return Promise.reject(new Error('not-found'));
      var fields = { done: !!done };
      if (done) { fields.doneAt = Date.now(); fields.doneBy = author(); }
      return current.update(id, fields);
    },
    rename: function (id, name) {
      name = cleanName(name);
      if (!name) return Promise.reject(new Error('empty'));
      var it = find(id);
      if (!it) return Promise.reject(new Error('not-found'));
      if (it.name === name) return Promise.resolve();
      return current.update(id, { name: name });
    },
    remove: function (id) { return current.remove(id); },
    // 지운 항목 되돌리기 · 백업 가져오기 (같은 id·시각·남긴 사람으로)
    restore: function (it) { return current.add(it); },
    // 산 것 모두 지우기 → 지운 항목들(실행 취소용)
    clearDone: function () {
      var done = last.filter(function (x) { return x.done; });
      return Promise.all(done.map(function (x) { return current.remove(x.id); })).then(function () { return done; });
    },

    subscribe: function (cb) {
      listeners.push(cb);
      return function () { listeners = listeners.filter(function (l) { return l !== cb; }); };
    }
  };

  local.list().then(function (items) { if (current === local) emit(items); });
})(window.Fridge = window.Fridge || {});
