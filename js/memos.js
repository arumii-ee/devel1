/*
 * 메모
 * ---------------------------------------------------------------
 * 메모 1개: { id, text, createdAt, by, updatedAt?, editedBy?, comments? }
 *   comments: { [댓글 id]: { id, text, createdAt, by, updatedAt?, editedBy? } }
 * 저장 위치(어댑터)는 재료처럼 바꿔 끼웁니다.
 *   - local  : 이 기기 브라우저(localStorage), 작성자는 '나'
 *   - family : 가족 공유(Firestore families/{fid}/memos, js/family.js 에서 연결)
 * 어댑터 모양: list() / add(memo) / edit(id, fields) / remove(id)
 *            / setComment(memoId, comment) / removeComment(memoId, commentId) / subscribe(cb)
 */
(function (Fridge) {
  'use strict';

  var KEY = 'fridge-app:memos:v1';
  var VERSION = 1;
  var TEXT_MAX = 200;
  var COMMENT_MAX = 200;   // 댓글 글자 수
  var COMMENTS_MAX = 100;  // 메모 1개에 달 수 있는 댓글 수
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

    // 메모 1개 고치기 (지워진 메모면 아무것도 안 함)
    function change(id, fn) {
      var memos = read();
      var found = false;
      memos = memos.map(function (m) {
        if (m.id !== id) return m;
        found = true;
        var copy = Object.assign({}, m);
        fn(copy);
        return copy;
      });
      if (found) write(memos);
      return found ? Promise.resolve() : Promise.reject(new Error('not-found'));
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
      edit: function (id, fields) {
        return change(id, function (m) {
          Object.keys(fields).forEach(function (k) { m[k] = fields[k]; });
        });
      },
      remove: function (id) {
        write(read().filter(function (m) { return m.id !== id; }));
        return Promise.resolve();
      },
      setComment: function (memoId, comment) {
        return change(memoId, function (m) {
          m.comments = Object.assign({}, m.comments);
          m.comments[comment.id] = comment;
        });
      },
      removeComment: function (memoId, commentId) {
        return change(memoId, function (m) {
          if (!m.comments) return;
          m.comments = Object.assign({}, m.comments);
          delete m.comments[commentId];
        });
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
      add: fail, edit: fail, remove: fail, setComment: fail, removeComment: fail,
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

  function find(id) {
    for (var i = 0; i < last.length; i++) if (last[i].id === id) return last[i];
    return null;
  }

  function cleanText(text, max) {
    return String(text || '').trim().slice(0, max);
  }

  // 댓글을 오래된 것부터 배열로
  function commentsOf(memo) {
    var map = (memo && memo.comments) || {};
    return Object.keys(map).map(function (k) { return map[k]; })
      .filter(function (c) { return c && c.id && c.text; })
      .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
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
    COMMENT_MAX: COMMENT_MAX,
    COMMENTS_MAX: COMMENTS_MAX,
    commentsOf: commentsOf,
    find: find,
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
      text = cleanText(text, TEXT_MAX);
      if (!text) return Promise.reject(new Error('empty'));
      var memo = { id: newId(), text: text, createdAt: Date.now(), by: current.author() || LOCAL_NAME };
      return current.add(memo).then(function () { return memo; });
    },
    // 지운 메모 되돌리기 (같은 id·시각·작성자로)
    restore: function (memo) { return current.add(memo); },
    remove: function (id) { return current.remove(id); },

    // 메모 글 고치기 (남긴 시각·남긴 사람은 그대로, 고친 시각·고친 사람 기록)
    edit: function (id, text) {
      text = cleanText(text, TEXT_MAX);
      if (!text) return Promise.reject(new Error('empty'));
      var memo = find(id);
      if (!memo) return Promise.reject(new Error('not-found'));
      if (memo.text === text) return Promise.resolve(memo);
      return current.edit(id, { text: text, updatedAt: Date.now(), editedBy: current.author() || LOCAL_NAME });
    },

    // 댓글 달기 → 저장된 댓글을 돌려줌
    addComment: function (memoId, text) {
      text = cleanText(text, COMMENT_MAX);
      if (!text) return Promise.reject(new Error('empty'));
      var memo = find(memoId);
      if (!memo) return Promise.reject(new Error('not-found'));
      if (commentsOf(memo).length >= COMMENTS_MAX) return Promise.reject(new Error('too-many'));
      var comment = { id: newId(), text: text, createdAt: Date.now(), by: current.author() || LOCAL_NAME };
      return current.setComment(memoId, comment).then(function () { return comment; });
    },
    // 댓글 고치기 (남긴 사람·시각은 그대로, 고친 시각·고친 사람 기록)
    editComment: function (memoId, commentId, text) {
      text = cleanText(text, COMMENT_MAX);
      if (!text) return Promise.reject(new Error('empty'));
      var memo = find(memoId);
      var old = memo && memo.comments && memo.comments[commentId];
      if (!old) return Promise.reject(new Error('not-found'));
      if (old.text === text) return Promise.resolve(old);
      var comment = Object.assign({}, old, { text: text, updatedAt: Date.now(), editedBy: current.author() || LOCAL_NAME });
      return current.setComment(memoId, comment).then(function () { return comment; });
    },
    removeComment: function (memoId, commentId) { return current.removeComment(memoId, commentId); },
    // 지운 댓글 되돌리기
    restoreComment: function (memoId, comment) {
      if (!find(memoId)) return Promise.reject(new Error('not-found'));
      return current.setComment(memoId, comment);
    },

    subscribe: function (cb) {
      listeners.push(cb);
      return function () { listeners = listeners.filter(function (l) { return l !== cb; }); };
    }
  };

  local.list().then(function (memos) { if (current === local) emit(memos); });
})(window.Fridge = window.Fridge || {});
