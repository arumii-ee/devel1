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
 *  families/{familyId}/members/{uid}   { name, joinedAt, code, lastSeen }
 *  families/{familyId}/items/{itemId}  재료
 *  families/{familyId}/memos/{memoId}  메모 { id, text, createdAt, by, updatedAt?, editedBy?, comments? }
 *                                      comments: { [댓글 id]: { id, text, createdAt, by, updatedAt?, editedBy? } }
 *  families/{familyId}/shopping/{id}   장보기 { id, name, done, createdAt, by, doneAt?, doneBy? }
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
  var DAY = 86400000;
  var INACTIVE_DAYS = 30;   // 관리자가 이만큼 안 들어오면 다른 멤버가 관리자를 넘겨받음 (firestore.rules 와 같은 값)
  var SEEN_INTERVAL = DAY / 2; // 마지막 접속 시각은 12시간에 한 번만 기록

  var store = Fridge.storage;
  var memos = Fridge.memos;
  var shopping = Fridge.shopping;
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

  // Firestore 배치는 한 번에 500개까지라 200개씩 나눠서 차례로 보냄
  // ops: [function (batch) { batch.set(...) }, ...]
  var CHUNK = 200;
  function commitInChunks(ops, timeout) {
    var p = Promise.resolve();
    for (var i = 0; i < ops.length; i += CHUNK) {
      (function (chunk) {
        p = p.then(function () {
          var batch = fb.db.batch();
          chunk.forEach(function (op) { op(batch); });
          return timeout === false ? batch.commit() : withTimeout(batch.commit());
        });
      })(ops.slice(i, i + CHUNK));
    }
    return p;
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
        else if (e && e.code === 'not-found') return; // 그사이 다른 가족이 재료를 지움 (연결 문제 아님)
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
      update: function (id, patch, opts) {
        var data = clean(Object.assign({}, patch, { updatedAt: Date.now() }));
        if (name) data.updatedBy = name;
        // 같은 재료를 다시 등록해 합쳤으면 등록한 사람도 최근에 넣은 사람으로
        if (name && opts && opts.readd) data.addedBy = name;
        return fireAndForget(col.doc(id).update(data));
      },
      remove: function (id) {
        return fireAndForget(col.doc(id).delete());
      },
      replaceAll: function (items) {
        return col.get().then(function (snap) {
          var ops = [];
          snap.docs.forEach(function (d) { ops.push(function (b) { b.delete(d.ref); }); });
          items.forEach(function (it) { ops.push(function (b) { b.set(col.doc(it.id), clean(it)); }); });
          return fireAndForget(commitInChunks(ops, false));
        });
      },
      // 이름만 바뀌었을 때 다시 연결하지 않고 이후 기록(addedBy/updatedBy)에 쓸 이름만 교체
      setName: function (n) { name = n; },
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

  /* ---------- 메모 어댑터 (memos.js 와 같은 모양) ---------- */

  function createMemoAdapter(fid, name, onDenied) {
    var col = familyRef(fid).collection('memos');

    function report(p) {
      p.catch(function (e) {
        if (e && e.code === 'permission-denied') onDenied(e);
        else if (e && e.code === 'not-found') return; // 그사이 다른 가족이 메모를 지움
        else store.setStatus('error', e);
      });
      return Promise.resolve();
    }

    function cleanComment(c) {
      var out = {
        id: String(c.id), text: String(c.text).slice(0, memos.COMMENT_MAX),
        createdAt: c.createdAt, by: cleanName(c.by) || name
      };
      if (typeof c.updatedAt === 'number') out.updatedAt = c.updatedAt;
      if (c.editedBy) out.editedBy = cleanName(c.editedBy);
      return out;
    }

    return {
      name: 'family',
      author: function () { return name; },
      setName: function (n) { name = n; },
      list: function () {
        return col.get().then(function (snap) { return snap.docs.map(function (d) { return d.data(); }); });
      },
      add: function (memo) {
        var data = {
          id: memo.id, text: String(memo.text).slice(0, memos.TEXT_MAX),
          createdAt: memo.createdAt, by: cleanName(memo.by) || name
        };
        if (typeof memo.updatedAt === 'number') data.updatedAt = memo.updatedAt;
        if (memo.editedBy) data.editedBy = cleanName(memo.editedBy);
        if (memo.comments) {
          data.comments = {};
          Object.keys(memo.comments).forEach(function (k) {
            var c = memo.comments[k];
            if (c && c.id === k && c.text) data.comments[k] = cleanComment(c);
          });
        }
        return report(col.doc(memo.id).set(data));
      },
      edit: function (id, fields) {
        return report(col.doc(id).update({
          text: String(fields.text).slice(0, memos.TEXT_MAX),
          updatedAt: fields.updatedAt,
          editedBy: cleanName(fields.editedBy) || name
        }));
      },
      remove: function (id) {
        return report(col.doc(id).delete());
      },
      // 댓글은 메모 문서 안의 comments 칸에 하나씩 넣고 빼므로, 여러 명이 동시에 달아도 서로 덮어쓰지 않음
      // lastCommentId: 이번에 바꾼 댓글 id (보안 규칙이 그 댓글 하나만 검사)
      setComment: function (memoId, comment) {
        var c = cleanComment(comment);
        return report(col.doc(memoId).update(
          new window.firebase.firestore.FieldPath('comments', c.id), c,
          'lastCommentId', c.id
        ));
      },
      removeComment: function (memoId, commentId) {
        return report(col.doc(memoId).update(
          new window.firebase.firestore.FieldPath('comments', String(commentId)),
          window.firebase.firestore.FieldValue.delete(),
          'lastCommentId', String(commentId)
        ));
      },
      subscribe: function (cb) {
        return col.onSnapshot(function (snap) {
          cb(snap.docs.map(function (d) { return d.data(); }));
        }, function (e) {
          if (e && e.code === 'permission-denied') onDenied(e);
        });
      }
    };
  }

  /* ---------- 장보기 어댑터 (shopping.js 와 같은 모양) ---------- */

  function createShoppingAdapter(fid, name, onDenied) {
    var col = familyRef(fid).collection('shopping');

    function report(p) {
      p.catch(function (e) {
        if (e && e.code === 'permission-denied') onDenied(e);
        else if (e && e.code === 'not-found') return; // 그사이 다른 가족이 지움
        else store.setStatus('error', e);
      });
      return Promise.resolve();
    }

    function clean(it) {
      var out = {
        id: String(it.id), name: String(it.name).slice(0, shopping.NAME_MAX),
        done: !!it.done, createdAt: it.createdAt, by: cleanName(it.by) || name
      };
      if (typeof it.doneAt === 'number') out.doneAt = it.doneAt;
      if (it.doneBy) out.doneBy = cleanName(it.doneBy);
      return out;
    }

    return {
      name: 'family',
      author: function () { return name; },
      setName: function (n) { name = n; },
      list: function () {
        return col.get().then(function (snap) { return snap.docs.map(function (d) { return d.data(); }); });
      },
      add: function (it) { return report(col.doc(String(it.id)).set(clean(it))); },
      update: function (id, fields) {
        var data = {};
        if ('name' in fields) data.name = String(fields.name).slice(0, shopping.NAME_MAX);
        if ('done' in fields) data.done = !!fields.done;
        if (typeof fields.doneAt === 'number') data.doneAt = fields.doneAt;
        if (fields.doneBy) data.doneBy = cleanName(fields.doneBy);
        return report(col.doc(id).update(data));
      },
      remove: function (id) { return report(col.doc(id).delete()); },
      subscribe: function (cb) {
        return col.onSnapshot(function (snap) {
          cb(snap.docs.map(function (d) { return d.data(); }));
        }, function (e) {
          if (e && e.code === 'permission-denied') onDenied(e);
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

  // 멤버 명단에서 빠짐(내보내짐) → 혼자 쓰기로 전환
  function removed() {
    detach();
    info = null;
    save(null);
    store.use(store.local);
    memos.use(memos.local);
    shopping.use(shopping.local);
    emitChange();
    Fridge.family.onRemoved && Fridge.family.onRemoved();
  }

  // 권한이 없다고 나오면: 내보내졌는지 확인
  function handleDenied(fid, e) {
    if (!conn || conn.familyId !== fid || conn.checking || conn.leaving) return;
    conn.checking = true;
    familyRef(fid).collection('members').doc(fb.uid).get({ source: 'server' }).then(function (doc) {
      if (!conn || conn.familyId !== fid) return;
      conn.checking = false;
      if (doc.exists) { store.setStatus('error', e); return; }
      removed();
    }, function () {
      if (conn) conn.checking = false;
      store.setStatus('error', e);
    });
  }

  function connect(fid, name) {
    detach();
    store.setStatus('connecting');
    store.use(store.pending());
    memos.use(memos.pending());
    shopping.use(shopping.pending());
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
        claimIfOwnerGone(c);
      }, function (e) { if (e.code === 'permission-denied') denied(e); }));

      // 내 멤버 문서: 관리자가 내보내도 이미 열린 실시간 연결은 권한 오류 없이 계속될 수 있어서
      // 내 문서가 서버에서 지워졌는지 직접 지켜봄
      c.unsubs.push(familyRef(fid).collection('members').doc(fb.uid).onSnapshot(function (doc) {
        if (conn !== c || c.leaving || c.checking) return;
        if (!doc.exists && !doc.metadata.fromCache) removed();
      }, function (e) { if (e.code === 'permission-denied') denied(e); }));

      // 멤버 명단
      c.unsubs.push(familyRef(fid).collection('members').onSnapshot(function (snap) {
        if (conn !== c) return;
        state.members = snap.docs.map(function (d) {
          var v = d.data();
          return { uid: d.id, name: v.name || '', joinedAt: v.joinedAt || 0, lastSeen: v.lastSeen || v.joinedAt || 0 };
        }).sort(function (a, b) { return a.joinedAt - b.joinedAt; });
        if (!snap.metadata.fromCache) c.membersLoaded = true;
        emitChange();
        claimIfOwnerGone(c);
      }, function (e) { if (e.code === 'permission-denied') denied(e); }));

      touchSeen(fid);

      c.adapter = createFamilyAdapter(fid, name, denied);
      c.memoAdapter = createMemoAdapter(fid, name, denied);
      c.shopAdapter = createShoppingAdapter(fid, name, denied);
      memos.use(c.memoAdapter);
      shopping.use(c.shopAdapter);
      return store.use(c.adapter);
    }).catch(function (e) {
      store.setStatus('error', e);
      throw e;
    });
  }

  // 마지막 접속 시각 기록 (관리자가 오래 안 들어왔는지 다른 가족이 알 수 있게)
  function touchSeen(fid) {
    if (!info || info.familyId !== fid) return;
    var now = Date.now();
    if (info.seenAt && now - info.seenAt < SEEN_INTERVAL) return;
    familyRef(fid).collection('members').doc(fb.uid).update({ lastSeen: now }).then(function () {
      if (info && info.familyId === fid) { info.seenAt = now; save(info); }
    }, function () { /* 다음 실행 때 다시 */ });
  }

  function isInactive(m) {
    return !m || Date.now() - (m.lastSeen || 0) > INACTIVE_DAYS * DAY;
  }

  // 관리자가 명단에 없거나 30일 넘게 안 들어왔으면(휴대폰 분실·앱 데이터 삭제 등) 내가 관리자를 넘겨받음
  // 서버 규칙도 같은 조건을 검사하므로, 동시에 여러 명이 시도해도 한 명만 남음
  function claimIfOwnerGone(c) {
    if (conn !== c || c.leaving || c.claiming || !c.membersLoaded || !state.ownerUid) return;
    if (state.ownerUid === fb.uid) return;
    var me = null, owner = null;
    state.members.forEach(function (m) {
      if (m.uid === fb.uid) me = m;
      if (m.uid === state.ownerUid) owner = m;
    });
    if (!me || !isInactive(owner)) return;
    c.claiming = true;
    withTimeout(familyRef(c.familyId).update({ ownerUid: fb.uid })).then(function () {
      if (conn === c && Fridge.family.onBecameOwner) Fridge.family.onBecameOwner();
    }, function () { /* 다른 멤버가 먼저 넘겨받았거나 오프라인 */ }).then(function () {
      c.claiming = false;
    });
  }

  function uploadItems(fid, items, name) {
    if (!items.length) return Promise.resolve();
    var col = familyRef(fid).collection('items');
    var I = Fridge.ingredients;
    return commitInChunks(items.map(function (it) {
      var data = {
        id: it.id, name: String(it.name).slice(0, 40), quantity: I.clampQty(it.quantity), unit: String(it.unit || '').slice(0, 10),
        location: it.location, expiry: it.expiry || null, createdAt: it.createdAt, updatedAt: it.updatedAt
      };
      if (name) data.addedBy = name;
      return function (b) { b.set(col.doc(it.id), data); };
    }));
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
      // 합치지 않은 이 기기 재료는 나중에 그만둘 때 지우지 않고 남겨 둠
      info = { familyId: fid, name: name };
      if (!mergeLocal) info.keepLocal = true;
      save(info);
      return connect(fid, name);
    });
  }

  // 가족 코드를 바꾼 뒤: 새 초대 코드 등록 + 옛 초대 코드 삭제
  // (초대 코드 등록 규칙이 "가족의 지금 코드와 같은지"를 보므로 가족 코드를 바꾼 다음에 해야 함)
  function registerInvite(fid, code, oldCode) {
    return withTimeout(inviteRef(code).set({ familyId: fid, createdAt: Date.now() })).then(function () {
      return oldCode ? withTimeout(inviteRef(oldCode).delete()).catch(function () {}) : null;
    }).then(function () { return code; });
  }

  // 관리자: 코드 바꾸기 (옛 코드로는 더 이상 가입 불가, 이미 멤버인 기기는 그대로)
  function rotateCode() {
    if (!conn || !isOwner()) return Promise.reject(err('not-owner'));
    var fid = conn.familyId;
    var oldCode = state.code;
    var code = newCode();
    return withTimeout(familyRef(fid).update({ code: code })).then(function () {
      return registerInvite(fid, code, oldCode);
    });
  }

  // 관리자: 멤버 내보내기 + 코드 자동 변경
  // 코드 변경과 내보내기를 한 번에(batch) 처리: 코드를 먼저 바꾸면 내보낼 사람이 아직 멤버인 동안
  // 실시간 연결로 새 코드를 받아 볼 수 있고, 나중에 바꾸면 그 사이 옛 코드로 다시 들어올 수 있음
  function kick(uid) {
    if (!conn || !isOwner()) return Promise.reject(err('not-owner'));
    if (uid === fb.uid) return Promise.reject(err('self'));
    var fid = conn.familyId;
    var oldCode = state.code;
    var code = newCode();
    var batch = fb.db.batch();
    batch.update(familyRef(fid), { code: code });
    batch.delete(familyRef(fid).collection('members').doc(uid));
    return withTimeout(batch.commit()).then(function () {
      return registerInvite(fid, code, oldCode);
    });
  }

  // 나가기: 관리자면 다른 멤버에게 넘기고, 마지막 멤버면 가족 데이터를 지움.
  // 보던 목록은 이 기기에 복사해 둠.
  // 화면에 보이는 멤버 명단은 아직 안 왔을 수 있으므로, 판단은 항상 서버에서 새로 받은 값으로 함
  function leave() {
    if (!conn || !fb) {
      detach(); info = null; save(null);
      memos.use(memos.local);
      shopping.use(shopping.local);
      return store.use(store.local).then(emitChange);
    }
    var c = conn;
    var fid = c.familyId;
    var fam = familyRef(fid);
    var col = fam.collection('items');
    var me = fam.collection('members').doc(fb.uid);
    var items = [];
    var keepLocal = !!(info && info.keepLocal);

    return withTimeout(Promise.all([
      fam.collection('members').get({ source: 'server' }),
      fam.get({ source: 'server' }),
      col.get({ source: 'server' }),
      fam.collection('memos').get({ source: 'server' }),
      fam.collection('shopping').get({ source: 'server' })
    ])).then(function (r) {
      var others = r[0].docs
        .filter(function (d) { return d.id !== fb.uid; })
        .map(function (d) { return { uid: d.id, joinedAt: d.data().joinedAt || 0 }; })
        .sort(function (a, b) { return a.joinedAt - b.joinedAt; });
      var famData = r[1].exists ? r[1].data() : {};
      var owner = famData.ownerUid === fb.uid;
      items = r[2].docs.map(function (d) { return d.data(); });

      // 이제부터 생기는 권한 오류는 내가 나가서 생기는 것이므로 무시
      c.leaving = true;
      if (owner && others.length) {
        return withTimeout(fam.update({ ownerUid: others[0].uid }));
      }
      if (!others.length) {
        // 정말 마지막 멤버일 때만: 재료 · 메모 · 장보기 · 초대 코드 삭제
        // 가족 문서는 규칙상 지울 수 없으므로, 초대 코드 없는 새 코드로 바꿔 아무도 다시 들어올 수 없게 함
        // 관리자가 아니면(관리자가 먼저 사라짐) 먼저 관리자를 넘겨받아야 초대 코드를 지우고 코드를 바꿀 수 있음
        var claim = owner || !r[1].exists ? Promise.resolve() : withTimeout(fam.update({ ownerUid: fb.uid }));
        return claim.then(function () {
          var ops = r[2].docs.concat(r[3].docs, r[4].docs).map(function (d) { return function (b) { b.delete(d.ref); }; });
          if (famData.code) ops.push(function (b) { b.delete(inviteRef(famData.code)); });
          if (r[1].exists) ops.push(function (b) { b.update(fam, { code: newCode() }); });
          return commitInChunks(ops);
        });
      }
    }).then(function () {
      c.unsubs.forEach(function (u) { try { u(); } catch (e) { /* 무시 */ } });
      c.unsubs = [];
      return withTimeout(me.delete());
    }).then(function () {
      detach();
      info = null;
      save(null);
      return store.local.list();
    }).then(function (localItems) {
      var copy = items.map(function (it) {
        var x = Object.assign({}, it);
        delete x.addedBy;
        delete x.updatedBy;
        return x;
      });
      if (keepLocal) {
        // 참여할 때 합치지 않았던 이 기기 재료는 그대로 두고, 가족 목록을 더함(같은 id면 가족 쪽)
        var ids = {};
        copy.forEach(function (it) { ids[it.id] = true; });
        copy = localItems.filter(function (it) { return !ids[it.id]; }).concat(copy);
      }
      return store.local.replaceAll(copy);
    }).then(function () {
      memos.use(memos.local);
      shopping.use(shopping.local);
      return store.use(store.local);
    }).then(emitChange, function (e) {
      if (conn === c) {
        c.leaving = false;
        // 실시간 연결을 이미 끊은 뒤 실패했다면 다시 연결
        if (!c.unsubs.length) connect(fid, c.name).catch(function () {});
      }
      throw e;
    });
  }

  function setName(rawName) {
    var name = cleanName(rawName);
    if (!info || !conn || !fb) return Promise.resolve();
    info.name = name;
    save(info);
    conn.name = name;
    if (conn.adapter && conn.adapter.setName) conn.adapter.setName(name);
    if (conn.memoAdapter) conn.memoAdapter.setName(name);
    if (conn.shopAdapter) conn.shopAdapter.setName(name);
    return withTimeout(familyRef(conn.familyId).collection('members').doc(fb.uid).update({ name: name }));
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
    INACTIVE_DAYS: INACTIVE_DAYS,
    isInactive: isInactive,
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
    onBecameOwner: null,
    // 앱 시작 시 저장된 가족이 있으면 자동 연결
    start: function () {
      if (info && Fridge.family.configured && !Fridge.family.fileMode) {
        connect(info.familyId, info.name).catch(function () {});
      }
    }
  };
})(window.Fridge = window.Fridge || {});
