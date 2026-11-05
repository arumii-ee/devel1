/*
 * 가족 공유 (Firebase 익명 로그인 + Firestore)
 * ---------------------------------------------------------------
 * 보안 구조 (자세한 규칙은 firestore.rules)
 *  - 각 기기는 익명 로그인으로 고유 번호(uid)를 받습니다.
 *  - 가족 냉장고는 추측할 수 없는 ID(20자)로 저장되고, 멤버 명단에 있는 기기만 읽고 쓸 수 있습니다.
 *  - 가족 코드(12자리)는 "멤버로 가입"할 때만 쓰입니다. 관리자가 코드를 바꾸면 옛 코드로는 가입할 수 없습니다.
 *  - 관리자는 멤버를 내보낼 수 있고, 내보내면 코드도 자동으로 바뀝니다.
 *
 * 데이터 위치
 *  families/{familyId}                 { ownerUid, code, createdAt }
 *  families/{familyId}/members/{uid}   { name, joinedAt, code }
 *  families/{familyId}/items/{itemId}  재료
 *  invites/{code}                      { familyId, createdAt }
 */
(function (Fridge) {
  'use strict';

  var VENDOR = 'vendor/firebase/';
  var SAVE_KEY = 'fridge-app:family';
  var CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 헷갈리는 0 O 1 I L 제외
  var CODE_LENGTH = 12;
  var NAME_MAX = 10;
  var WRITE_TIMEOUT = 15000;

  var store = Fridge.storage;
  var fb = null;          // { db, auth, uid }
  var fbPromise = null;
  var conn = null;        // 현재 연결 { familyId, name, unsubs[], adapter }
  var listeners = [];

  // 화면에 보여줄 현재 상태
  var state = { code: '', ownerUid: '', members: [], uid: '' };

  /* ---------- 저장된 가족 정보 ---------- */

  function loadSaved() {
    try {
      var v = JSON.parse(window.localStorage.getItem(SAVE_KEY));
      return v && v.familyId ? v : null; // 예전 형식({code})은 버림
    } catch (e) { return null; }
  }
  function save(v) {
    try {
      if (v) window.localStorage.setItem(SAVE_KEY, JSON.stringify(v));
      else window.localStorage.removeItem(SAVE_KEY);
    } catch (e) { /* 무시 */ }
  }

  var info = loadSaved(); // { familyId, name }

  function emitChange() {
    listeners.forEach(function (cb) { cb(); });
  }

  /* ---------- 가족 코드 ---------- */

  function newCode() {
    var out = '';
    var rnd = new Uint32Array(CODE_LENGTH);
    window.crypto.getRandomValues(rnd);
    for (var i = 0; i < CODE_LENGTH; i++) out += CODE_CHARS[rnd[i] % CODE_CHARS.length];
    return out;
  }

  // 입력값 → 'K7PM3QXAB2CD' (대문자, 기호·공백 제거)
  function normalizeCode(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  // 'K7PM3QXAB2CD' → 'K7PM-3QXA-B2CD'
  function formatCode(code) {
    return (code || '').replace(/(.{4})(?=.)/g, '$1-');
  }

  function cleanName(n) {
    return String(n || '').trim().slice(0, NAME_MAX);
  }

  function err(code) {
    var e = new Error(code);
    e.code = code;
    return e;
  }

  // 서버 응답이 오래 없으면(오프라인 등) 실패로 처리
  function withTimeout(p) {
    return Promise.race([p, new Promise(function (_, reject) {
      setTimeout(function () { reject(err('unavailable')); }, WRITE_TIMEOUT);
    })]);
  }

  /* ---------- Firebase 불러오기 + 익명 로그인 ---------- */

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(err('sdk-load')); };
      document.head.appendChild(s);
    });
  }

  function ensureFirebase() {
    if (fb) return Promise.resolve(fb);
    if (location.protocol === 'file:') return Promise.reject(err('file-mode'));
    if (!fbPromise) {
      fbPromise = (window.firebase && window.firebase.firestore ? Promise.resolve() :
        loadScript(VENDOR + 'firebase-app-compat.js').then(function () {
          return Promise.all([
            loadScript(VENDOR + 'firebase-auth-compat.js'),
            loadScript(VENDOR + 'firebase-firestore-compat.js')
          ]);
        }))
        .then(function () {
          var cfg = Fridge.FIREBASE_CONFIG;
          var firebase = window.firebase;
          var app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
          var auth = app.auth();
          var db = app.firestore();
          if (cfg.emulator) { // 개발용 테스트 서버
            auth.useEmulator('http://' + cfg.emulator.host + ':' + cfg.emulator.authPort, { disableWarnings: true });
            db.useEmulator(cfg.emulator.host, cfg.emulator.port);
          }
          // 인터넷이 끊겨도 마지막 데이터로 보이고, 다시 연결되면 자동 동기화
          var persist = db.enablePersistence({ synchronizeTabs: true }).catch(function () {});
          // 이미 로그인한 기기면 그대로, 처음이면 익명 로그인
          var user = new Promise(function (resolve) {
            var off = auth.onAuthStateChanged(function (u) { off(); resolve(u); });
          }).then(function (u) {
            return u || auth.signInAnonymously().then(function (cred) { return cred.user; });
          });
          return Promise.all([persist, user]).then(function (r) {
            fb = { db: db, auth: auth, uid: r[1].uid };
            state.uid = fb.uid;
            return fb;
          });
        })
        .catch(function (e) { fbPromise = null; throw e; });
    }
    return fbPromise;
  }

  function familyRef(fid) { return fb.db.collection('families').doc(fid); }
  function inviteRef(code) { return fb.db.collection('invites').doc(code); }

  /* ---------- 재료 어댑터 (storage.js 와 같은 모양) ---------- */

  function createFamilyAdapter(fid, name, onDenied) {
    var col = familyRef(fid).collection('items');
    var last = [];

    function toItems(snap) {
      return snap.docs.map(function (d) { return d.data(); });
    }

    // 쓰기는 서버 응답을 기다리지 않음 (오프라인에서도 바로 화면 반영, 연결되면 자동 전송)
    function fireAndForget(p) {
      p.catch(function (e) {
        if (e && e.code === 'permission-denied') onDenied(e);
        else store.setStatus('error', e);
      });
      return Promise.resolve();
    }

    function clean(obj) {
      var o = {};
      Object.keys(obj).forEach(function (k) { if (obj[k] !== undefined) o[k] = obj[k]; });
      return o;
    }

    return {
      name: 'family',
      get last() { return last; },
      list: function () {
        return col.get().then(toItems);
      },
      add: function (item) {
        var data = clean(Object.assign({}, item));
        if (name) data.addedBy = data.addedBy || name;
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
          var batch = fb.db.batch();
          snap.docs.forEach(function (d) { batch.delete(d.ref); });
          items.forEach(function (it) { batch.set(col.doc(it.id), clean(it)); });
          return fireAndForget(batch.commit());
        });
      },
      subscribe: function (cb) {
        return col.onSnapshot({ includeMetadataChanges: true }, function (snap) {
          last = toItems(snap);
          cb(last);
          store.setStatus(snap.metadata.fromCache ? 'offline' : 'online');
        }, function (e) {
          if (e && e.code === 'permission-denied') onDenied(e);
          else store.setStatus('error', e);
        });
      }
    };
  }

  /* ---------- 연결 / 끊기 ---------- */

  function detach() {
    if (conn) conn.unsubs.forEach(function (u) { try { u(); } catch (e) { /* 무시 */ } });
    conn = null;
    state.code = '';
    state.ownerUid = '';
    state.members = [];
  }

  // 권한이 없다고 나오면: 내보내졌는지 확인
  function handleDenied(fid, e) {
    if (!conn || conn.familyId !== fid || conn.checking) return;
    conn.checking = true;
    familyRef(fid).collection('members').doc(fb.uid).get({ source: 'server' }).then(function (doc) {
      if (!conn || conn.familyId !== fid) return;
      conn.checking = false;
      if (doc.exists) { store.setStatus('error', e); return; }
      // 멤버 명단에 없음 → 혼자 쓰기로 전환
      detach();
      info = null;
      save(null);
      store.use(store.local);
      emitChange();
      Fridge.family.onRemoved && Fridge.family.onRemoved();
    }, function () {
      if (conn) conn.checking = false;
      store.setStatus('error', e);
    });
  }

  function connect(fid, name) {
    detach();
    store.setStatus('connecting');
    store.use(store.pending());
    return ensureFirebase().then(function () {
      var c = { familyId: fid, name: name, unsubs: [] };
      conn = c;
      var denied = function (e) { handleDenied(fid, e); };

      // 가족 정보(현재 코드, 관리자)
      c.unsubs.push(familyRef(fid).onSnapshot(function (doc) {
        if (conn !== c || !doc.exists) return;
        var d = doc.data();
        state.code = d.code;
        state.ownerUid = d.ownerUid;
        emitChange();
      }, function (e) { if (e.code === 'permission-denied') denied(e); }));

      // 멤버 명단
      c.unsubs.push(familyRef(fid).collection('members').onSnapshot(function (snap) {
        if (conn !== c) return;
        state.members = snap.docs.map(function (d) {
          return { uid: d.id, name: d.data().name || '', joinedAt: d.data().joinedAt || 0 };
        }).sort(function (a, b) { return a.joinedAt - b.joinedAt; });
        emitChange();
      }, function (e) { if (e.code === 'permission-denied') denied(e); }));

      c.adapter = createFamilyAdapter(fid, name, denied);
      return store.use(c.adapter);
    }).catch(function (e) {
      store.setStatus('error', e);
      throw e;
    });
  }

  function uploadItems(fid, items, name) {
    if (!items.length) return Promise.resolve();
    var col = familyRef(fid).collection('items');
    var chunks = [];
    for (var i = 0; i < items.length; i += 200) chunks.push(items.slice(i, i + 200));
    return chunks.reduce(function (p, chunk) {
      return p.then(function () {
        var batch = fb.db.batch();
        chunk.forEach(function (it) {
          var data = {
            id: it.id, name: String(it.name).slice(0, 40), quantity: it.quantity, unit: String(it.unit || '').slice(0, 10),
            location: it.location, expiry: it.expiry || null, createdAt: it.createdAt, updatedAt: it.updatedAt
          };
          if (name) data.addedBy = name;
          batch.set(col.doc(it.id), data);
        });
        return withTimeout(batch.commit());
      });
    }, Promise.resolve());
  }

  /* ---------- 만들기 / 참여 / 코드 바꾸기 / 내보내기 / 나가기 ---------- */

  // 새 가족 냉장고: 내가 관리자. 이 기기의 재료를 함께 올림
  function create(rawName) {
    var name = cleanName(rawName);
    var code = newCode();
    var fid;
    var localItems;
    return store.local.list().then(function (items) {
      localItems = items;
      return ensureFirebase();
    }).then(function () {
      fid = fb.db.collection('families').doc().id;
      return withTimeout(familyRef(fid).set({ ownerUid: fb.uid, code: code, createdAt: Date.now() }));
    }).then(function () {
      return withTimeout(familyRef(fid).collection('members').doc(fb.uid)
        .set({ name: name, joinedAt: Date.now(), code: code }));
    }).then(function () {
      return withTimeout(inviteRef(code).set({ familyId: fid, createdAt: Date.now() }));
    }).then(function () {
      return uploadItems(fid, localItems, name);
    }).then(function () {
      info = { familyId: fid, name: name };
      save(info);
      return connect(fid, name);
    }).then(function () { return code; });
  }

  // 가족 코드로 참여. mergeLocal 이면 이 기기의 재료도 가족 냉장고에 더함
  function join(rawCode, rawName, mergeLocal) {
    var code = normalizeCode(rawCode);
    var name = cleanName(rawName);
    var fid;
    if (code.length !== CODE_LENGTH) return Promise.reject(err('bad-code'));
    return ensureFirebase().then(function () {
      return withTimeout(inviteRef(code).get({ source: 'server' }));
    }).then(function (doc) {
      if (!doc.exists) throw err('not-found');
      fid = doc.data().familyId;
      var me = familyRef(fid).collection('members').doc(fb.uid);
      return withTimeout(me.get({ source: 'server' })).then(function (m) {
        if (m.exists) return withTimeout(me.update({ name: name })); // 이미 멤버
        return withTimeout(me.set({ name: name, joinedAt: Date.now(), code: code }));
      });
    }).then(function () {
      if (!mergeLocal) return null;
      return store.local.list().then(function (items) { return uploadItems(fid, items, name); });
    }).then(function () {
      info = { familyId: fid, name: name };
      save(info);
      return connect(fid, name);
    });
  }

  // 관리자: 코드 바꾸기 (옛 코드로는 더 이상 가입 불가, 이미 멤버인 기기는 그대로)
  function rotateCode() {
    if (!conn || !isOwner()) return Promise.reject(err('not-owner'));
    var fid = conn.familyId;
    var oldCode = state.code;
    var code = newCode();
    return withTimeout(familyRef(fid).update({ code: code })).then(function () {
      return withTimeout(inviteRef(code).set({ familyId: fid, createdAt: Date.now() }));
    }).then(function () {
      return oldCode ? withTimeout(inviteRef(oldCode).delete()).catch(function () {}) : null;
    }).then(function () { return code; });
  }

  // 관리자: 멤버 내보내기 + 코드 자동 변경
  function kick(uid) {
    if (!conn || !isOwner()) return Promise.reject(err('not-owner'));
    if (uid === fb.uid) return Promise.reject(err('self'));
    return withTimeout(familyRef(conn.familyId).collection('members').doc(uid).delete())
      .then(rotateCode);
  }

  // 나가기: 관리자면 다른 멤버에게 넘기고, 마지막 멤버면 가족 데이터를 지움.
  // 보던 목록은 이 기기에 복사해 둠
  function leave() {
    if (!conn || !fb) {
      detach(); info = null; save(null);
      return store.use(store.local).then(emitChange);
    }
    var fid = conn.familyId;
    var items = conn.adapter ? conn.adapter.last.slice() : [];
    var others = state.members.filter(function (m) { return m.uid !== fb.uid; });
    var steps = Promise.resolve();

    if (isOwner() && others.length) {
      steps = steps.then(function () { return withTimeout(familyRef(fid).update({ ownerUid: others[0].uid })); });
    } else if (!others.length) {
      // 마지막 멤버: 재료와 초대 코드 삭제
      steps = steps.then(function () {
        return familyRef(fid).collection('items').get().then(function (snap) {
          var batch = fb.db.batch();
          snap.docs.forEach(function (d) { batch.delete(d.ref); });
          if (state.code && isOwner()) batch.delete(inviteRef(state.code));
          return withTimeout(batch.commit());
        });
      });
    }
    return steps.then(function () {
      return withTimeout(familyRef(fid).collection('members').doc(fb.uid).delete());
    }).then(function () {
      detach();
      info = null;
      save(null);
      return store.local.replaceAll(items.map(function (it) {
        var c = Object.assign({}, it);
        delete c.addedBy;
        delete c.updatedBy;
        return c;
      }));
    }).then(function () {
      return store.use(store.local);
    }).then(emitChange);
  }

  function setName(rawName) {
    var name = cleanName(rawName);
    if (!info || !conn || !fb) return Promise.resolve();
    info.name = name;
    save(info);
    conn.name = name;
    return withTimeout(familyRef(conn.familyId).collection('members').doc(fb.uid).update({ name: name }))
      .then(function () { return connect(info.familyId, name); });
  }

  function retry() {
    return info ? connect(info.familyId, info.name) : Promise.resolve();
  }

  function isOwner() {
    return !!(fb && state.ownerUid && state.ownerUid === fb.uid);
  }

  Fridge.family = {
    CODE_LENGTH: CODE_LENGTH,
    NAME_MAX: NAME_MAX,
    get configured() { return !!(Fridge.FIREBASE_CONFIG && Fridge.FIREBASE_CONFIG.projectId); },
    get fileMode() { return location.protocol === 'file:'; },
    get info() { return info; },
    get state() { return state; },
    get isOwner() { return isOwner(); },
    formatCode: formatCode,
    normalizeCode: normalizeCode,
    create: create,
    join: join,
    rotateCode: rotateCode,
    kick: kick,
    leave: leave,
    setName: setName,
    retry: retry,
    onChange: function (cb) { listeners.push(cb); },
    onRemoved: null,
    // 앱 시작 시 저장된 가족이 있으면 자동 연결
    start: function () {
      if (info && Fridge.family.configured && !Fridge.family.fileMode) {
        connect(info.familyId, info.name).catch(function () {});
      }
    }
  };
})(window.Fridge = window.Fridge || {});
