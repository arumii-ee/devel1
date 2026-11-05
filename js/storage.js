/*
 * 저장소 어댑터
 * ---------------------------------------------------------------
 * 앱은 이 인터페이스만 사용합니다:
 *   list() / add(item) / update(id, patch) / remove(id) / replaceAll(items) / subscribe(cb)
 * 모두 Promise를 돌려주므로, 나중에 가족 공유용 백엔드(예: Firebase Firestore)
 * 어댑터를 만들어 Fridge.storage 를 바꿔 끼우면 app.js 는 수정할 필요가 없습니다.
 */
(function (Fridge) {
  'use strict';

  var KEY = 'fridge-app:v1';
  var VERSION = 1;

  function createLocalStorageAdapter() {
    var memory = null; // localStorage 를 쓸 수 없을 때(사생활 보호 모드 등) 대비
    var listeners = [];

    function read() {
      try {
        var raw = window.localStorage.getItem(KEY);
        if (!raw) return [];
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
        var items = read();
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
        return function unsubscribe() {
          listeners = listeners.filter(function (l) { return l !== cb; });
        };
      }
    };
  }

  Fridge.storage = createLocalStorageAdapter();
})(window.Fridge = window.Fridge || {});
