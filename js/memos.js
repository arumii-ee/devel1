/*
 * 메모
 * ---------------------------------------------------------------
 * 메모 1개: { id, text, createdAt, by }
 * 저장 위치(어댑터)는 재료처럼 바꿔 끼웁니다.
 *   - local  : 이 기기 브라우저(localStorage), 작성자는 '나'
 *   - family : 가족 공유(Firestore families/{fid}/memos, js/family.js 에서 연결)
 * 어댑터 모양: list() / add(memo) / remove(id) / subscribe(cb)
 */
(function (Fridge) {
  'use strict';

  var KEY = 'fridge-app:memos:v1';
  var VERSION = 1;
  var TEXT_MAX = 200;
  var LOCAL_NAME = '나';

  /* ---------- 이 기기에만 저장 ---------- */
  function createLocalAdapter() {
    var memory = null; // localStorage 를 쓸 수 없을 때 대비
    var listeners = [];

    function read() {
      try {
        var raw = window.localStorage.getItem(KEY);
        if (!raw) return memory ? memory.slice() : [];
        var data = JSON.parse(raw);
        return Array.isArray(data.memos) ? data.memos : [];
      } catch (e) {
        return memory ? memory.slice() : [];
      }
    }

    function write(memos) {
      memory = memos.slice();
      try {
        window.localStorage.setItem(KEY, JSON.stringify({ version: VERSION, memos: memos }));
      } catch (e) { /* 메모리에만 유지 */ }
      notify(memos);
    }

    function notify(memos) {
      listeners.forEach(function (cb) { cb(memos.slice()); });
    }

    window.addEventListener('storage', function (e) {
      if (e.key === KEY) notify(read());
    });

    return {
      name: 'local',
      author: function () { return LOCAL_NAME; },
      list: function () { return Promise.resolve(read()); },
      add: function (memo) {
        var memos = read().filter(function (m) { return m.id !== memo.id; });
        memos.push(memo);
        write(memos);
        return Promise.resolve(memo);
      },
      remove: function (id) {
        write(read().filter(function (m) { return m.id !== id; }));
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
      add: fail, remove: fail,
      subscribe: function () { return function () {}; }
    };
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // 최신 메모가 위로
  function sorted(memos) {
    return memos.slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  }

  /* ---------- 바꿔 끼울 수 있는 저장소 ---------- */
  var local = createLocalAdapter();
  var current = local;
  var unsubscribe = current.subscribe(emit);
  var last = [];
  var listeners = [];

  function emit(memos) {
    last = sorted(memos);
    listeners.forEach(function (cb) { cb(last); });
  }

  Fridge.memos = {
    TEXT_MAX: TEXT_MAX,
    local: local,
    pending: createPendingAdapter,
    get mode() { return current.name; },
    get list() { return last; },

    use: function (adapter) {
      if (current === adapter) return Promise.resolve();
      if (unsubscribe) unsubscribe();
      current = adapter;
      unsubscribe = adapter.subscribe(emit);
      return adapter.list().then(function (memos) { if (current === adapter) emit(memos); });
    },

    // 새 메모 만들기 → 저장된 메모를 돌려줌
    add: function (text) {
      text = String(text || '').trim().slice(0, TEXT_MAX);
      if (!text) return Promise.reject(new Error('empty'));
      var memo = { id: newId(), text: text, createdAt: Date.now(), by: current.author() || LOCAL_NAME };
      return current.add(memo).then(function () { return memo; });
    },
    // 지운 메모 되돌리기 (같은 id·시각·작성자로)
    restore: function (memo) { return current.add(memo); },
    remove: function (id) { return current.remove(id); },

    subscribe: function (cb) {
      listeners.push(cb);
      return function () { listeners = listeners.filter(function (l) { return l !== cb; }); };
    }
  };

  local.list().then(function (memos) { if (current === local) emit(memos); });
})(window.Fridge = window.Fridge || {});
