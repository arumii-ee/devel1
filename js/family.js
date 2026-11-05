/*
 * 가족 공유 (Firebase Firestore)
 * ---------------------------------------------------------------
 * 가족 코드(예: K7PM-3QXA)가 같은 기기끼리 같은 냉장고 목록을 실시간으로 봅니다.
 * 데이터 위치: families/{코드}/items/{재료 id}
 * 코드를 아는 사람만 접근할 수 있으므로 코드는 가족끼리만 공유하세요.
 */
(function (Fridge) {
  'use strict';

  var SDK_VERSION = '10.12.2';
  var SDK_BASE = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/';
  var SAVE_KEY = 'fridge-app:family';
  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 헷갈리는 0 O 1 I L 제외

  var store = Fridge.storage;
  var db = null;
  var sdkPromise = null;

  /* ---------- 저장된 가족 정보 ---------- */

  function loadSaved() {
    try { return JSON.parse(window.localStorage.getItem(SAVE_KEY)) || null; } catch (e) { return null; }
  }
  function save(info) {
    try {
      if (info) window.localStorage.setItem(SAVE_KEY, JSON.stringify(info));
      else window.localStorage.removeItem(SAVE_KEY);
    } catch (e) { /* 무시 */ }
  }

  var info = loadSaved(); // { code, name }

  /* ---------- 가족 코드 ---------- */

  function newCode() {
    var out = '';
    var rnd = new Uint32Array(8);
    window.crypto.getRandomValues(rnd);
    for (var i = 0; i < 8; i++) out += CODE_CHARS[rnd[i] % CODE_CHARS.length];
    return out;
  }

  // 입력값 → 'K7PM3QXA' (대문자, 기호·공백 제거)
  function normalizeCode(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  // 'K7PM3QXA' → 'K7PM-3QXA'
  function formatCode(code) {
    return code ? code.slice(0, 4) + '-' + code.slice(4) : '';
  }

  /* ---------- Firebase 불러오기 ---------- */

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('sdk-load')); };
      document.head.appendChild(s);
    });
  }

  function ensureDb() {
    if (db) return Promise.resolve(db);
    if (!sdkPromise) {
      sdkPromise = (window.firebase ? Promise.resolve() :
        loadScript(SDK_BASE + 'firebase-app-compat.js').then(function () {
          return loadScript(SDK_BASE + 'firebase-firestore-compat.js');
        }))
        .then(function () {
          var cfg = Fridge.FIREBASE_CONFIG;
          var app = window.firebase.apps.length ? window.firebase.app() : window.firebase.initializeApp(cfg);
          var fs = app.firestore();
          if (cfg.emulator) fs.useEmulator(cfg.emulator.host, cfg.emulator.port); // 개발용 테스트 서버
          // 인터넷이 끊겨도 마지막 데이터로 보이고, 다시 연결되면 자동 동기화
          return fs.enablePersistence({ synchronizeTabs: true })
            .catch(function () { /* 지원 안 되면 온라인 전용으로 */ })
            .then(function () { db = fs; return db; });
        })
        .catch(function (e) { sdkPromise = null; throw e; });
    }
    return sdkPromise;
  }

  /* ---------- Firestore 어댑터 ---------- */

  function createFamilyAdapter(code, name) {
    var family = db.collection('families').doc(code);
    var col = family.collection('items');

    function toItems(snap) {
      return snap.docs.map(function (d) { return d.data(); });
    }

    // 쓰기는 서버 응답을 기다리지 않음 (오프라인에서도 바로 화면 반영, 연결되면 자동 전송)
    function fireAndForget(p) {
      p.catch(function (e) { store.setStatus('error', e); });
      return Promise.resolve();
    }

    function clean(obj) {
      var o = {};
      Object.keys(obj).forEach(function (k) { if (obj[k] !== undefined) o[k] = obj[k]; });
      return o;
    }

    return {
      name: 'family',
      code: code,
      list: function () {
        return col.get().then(toItems);
      },
      add: function (item) {
        var data = clean(Object.assign({}, item));
        if (!data.addedBy && name) data.addedBy = name;
        return fireAndForget(col.doc(item.id).set(data)).then(function () { return data; });
      },
      update: function (id, patch) {
        var data = clean(Object.assign({}, patch, { updatedAt: Date.now() }));
        if (name) data.updatedBy = name;
        return fireAndForget(col.doc(id).update(data));
      },
      remove: function (id) {
        return fireAndForget(col.doc(id).delete());
      },
      replaceAll: function (items) {
        return col.get().then(function (snap) {
          var batch = db.batch();
          snap.docs.forEach(function (d) { batch.delete(d.ref); });
          items.forEach(function (it) { batch.set(col.doc(it.id), clean(it)); });
          return fireAndForget(batch.commit());
        });
      },
      subscribe: function (cb) {
        return col.onSnapshot({ includeMetadataChanges: true }, function (snap) {
          cb(toItems(snap));
          store.setStatus(snap.metadata.fromCache ? 'offline' : 'online');
        }, function (err) {
          store.setStatus('error', err);
        });
      }
    };
  }

  /* ---------- 연결 / 만들기 / 참여 / 나가기 ---------- */

  function connect(code, name) {
    store.setStatus('connecting');
    store.use(store.pending());
    return ensureDb().then(function () {
      return store.use(createFamilyAdapter(code, name));
    }).catch(function (e) {
      store.setStatus('error', e);
      throw e;
    });
  }

  // 새 가족 냉장고: 코드를 만들고 이 기기의 재료를 함께 올림
  function create(name) {
    var code = newCode();
    var localItems;
    return store.local.list().then(function (items) {
      localItems = items;
      return ensureDb();
    }).then(function () {
      return db.collection('families').doc(code).set({ createdAt: Date.now(), createdBy: name || '' });
    }).then(function () {
      var col = db.collection('families').doc(code).collection('items');
      var batch = db.batch();
      localItems.forEach(function (it) {
        batch.set(col.doc(it.id), Object.assign({ addedBy: name || '' }, it));
      });
      return batch.commit();
    }).then(function () {
      info = { code: code, name: name || '' };
      save(info);
      return connect(code, info.name);
    }).then(function () { return code; });
  }

  // 가족 코드로 참여. mergeLocal 이면 이 기기의 재료도 가족 냉장고에 더함
  function join(rawCode, name, mergeLocal) {
    var code = normalizeCode(rawCode);
    if (code.length !== 8) return Promise.reject(new Error('bad-code'));
    return ensureDb().then(function () {
      return db.collection('families').doc(code).get();
    }).then(function (doc) {
      if (!doc.exists) throw new Error('not-found');
      if (!mergeLocal) return null;
      return store.local.list().then(function (items) {
        if (!items.length) return null;
        var col = db.collection('families').doc(code).collection('items');
        var batch = db.batch();
        items.forEach(function (it) { batch.set(col.doc(it.id), Object.assign({ addedBy: name || '' }, it)); });
        return batch.commit();
      });
    }).then(function () {
      info = { code: code, name: name || '' };
      save(info);
      return connect(code, info.name);
    });
  }

  // 공유 그만하기: 지금 보던 가족 재료를 이 기기에 복사해 두고 혼자 쓰기로 돌아감
  function leave() {
    var p = store.mode === 'family' ? store.list().catch(function () { return null; }) : Promise.resolve(null);
    return p.then(function (items) {
      info = null;
      save(null);
      var chain = items ? store.local.replaceAll(items) : Promise.resolve();
      return chain.then(function () { return store.use(store.local); });
    });
  }

  function setName(name) {
    if (!info) return Promise.resolve();
    info.name = name || '';
    save(info);
    return connect(info.code, info.name);
  }

  function retry() {
    return info ? connect(info.code, info.name) : Promise.resolve();
  }

  Fridge.family = {
    get configured() { return !!(Fridge.FIREBASE_CONFIG && Fridge.FIREBASE_CONFIG.projectId); },
    get info() { return info; },
    formatCode: formatCode,
    normalizeCode: normalizeCode,
    create: create,
    join: join,
    leave: leave,
    setName: setName,
    retry: retry,
    // 앱 시작 시 저장된 가족이 있으면 자동 연결
    start: function () {
      if (info && Fridge.family.configured) connect(info.code, info.name).catch(function () {});
    }
  };
})(window.Fridge = window.Fridge || {});
