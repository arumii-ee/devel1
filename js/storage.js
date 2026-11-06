/*
 * 저장소
 * ---------------------------------------------------------------
 * 앱은 Fridge.storage 하나만 사용합니다:
 *   list() / add(item) / update(id, patch, opts) / remove(id) / replaceAll(items) / subscribe(cb)
 *   update 의 opts.readd : 같은 재료를 다시 등록해 합친 것 → 가족 공유 중엔 등록한 사람(addedBy)을 지금 사람으로
 * 실제 저장 위치(어댑터)는 바꿔 끼울 수 있습니다.
 *   - local  : 이 기기 브라우저(localStorage)
 *   - family : 가족 공유(Firebase Firestore, js/family.js 에서 연결)
 */
(function (Fridge) {
  'use strict';

  var KEY = 'fridge-app:v1';
  var VERSION = 1;

  /* ---------- 이 기기에만 저장 ---------- */
  function createLocalAdapter() {
    var memory = null; // localStorage 를 쓸 수 없을 때(사생활 보호 모드 등) 대비
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
      notify(items);
    }

    function notify(items) {
      listeners.forEach(function (cb) { cb(items.slice()); });
    }

    // 다른 탭에서 바뀐 내용도 반영
    window.addEventListener('storage', function (e) {
      if (e.key === KEY) notify(read());
    });

    return {
      name: 'local',
      list: function () { return Promise.resolve(read()); },
      add: function (item) {
        var items = read().filter(function (it) { return it.id !== item.id; });
        items.push(item);
        write(items);
        return Promise.resolve(item);
      },
      update: function (id, patch) {
        var items = read();
        var found = null;
        items = items.map(function (it) {
          if (it.id !== id) return it;
          found = Object.assign({}, it, patch, { updatedAt: Date.now() });
          return found;
        });
        write(items);
        return Promise.resolve(found);
      },
      remove: function (id) {
        write(read().filter(function (it) { return it.id !== id; }));
        return Promise.resolve();
      },
      replaceAll: function (items) {
        write(items);
        return Promise.resolve();
      },
      subscribe: function (cb) {
        listeners.push(cb);
        return function () {
          listeners = listeners.filter(function (l) { return l !== cb; });
        };
      }
    };
  }

  /* ---------- 연결 중(아직 데이터 없음) ---------- */
  function createPendingAdapter() {
    function fail() { return Promise.reject(new Error('not-connected')); }
    return {
      name: 'pending',
      list: function () { return Promise.resolve([]); },
      add: fail, update: fail, remove: fail, replaceAll: fail,
      subscribe: function () { return function () {}; }
    };
  }

  /* ---------- 바꿔 끼울 수 있는 저장소 ---------- */
  var local = createLocalAdapter();
  var current = local;
  var unsubscribe = current.subscribe(emit);
  var listeners = [];
  var statusListeners = [];
  var status = 'local'; // local | connecting | online | offline | error

  function emit(items) {
    listeners.forEach(function (cb) { cb(items); });
  }

  function setStatus(s, detail) {
    status = s;
    statusListeners.forEach(function (cb) { cb(s, detail); });
  }

  Fridge.storage = {
    local: local,
    pending: createPendingAdapter,
    get mode() { return current.name; },
    get adapter() { return current; },
    get status() { return status; },

    use: function (adapter) {
      if (unsubscribe) unsubscribe();
      current = adapter;
      unsubscribe = adapter.subscribe(emit);
      if (adapter.name === 'local') setStatus('local');
      return adapter.list().then(function (items) { if (current === adapter) emit(items); });
    },

    list: function () { return current.list(); },
    add: function (item) { return current.add(item); },
    update: function (id, patch, opts) { return current.update(id, patch, opts); },
    remove: function (id) { return current.remove(id); },
    replaceAll: function (items) { return current.replaceAll(items); },

    subscribe: function (cb) {
      listeners.push(cb);
      return function () { listeners = listeners.filter(function (l) { return l !== cb; }); };
    },
    onStatus: function (cb) {
      statusListeners.push(cb);
      return function () { statusListeners = statusListeners.filter(function (l) { return l !== cb; }); };
    },
    setStatus: setStatus
  };
})(window.Fridge = window.Fridge || {});
