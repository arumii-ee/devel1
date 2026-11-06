/*
 * 재료 데이터 모델 · 유통기한 계산 · 정렬 (화면과 무관한 순수 로직)
 */
(function (Fridge) {
  'use strict';

  var LOCATIONS = {
    fridge: { label: '냉장', icon: '❄️' },
    freezer: { label: '냉동', icon: '🧊' },
    pantry: { label: '실온', icon: '🏠' }
  };

  // 유통기한 상태 기준(일)
  var URGENT_DAYS = 2; // 0~2일 남음
  var SOON_DAYS = 7;   // 3~7일 남음

  var STATUS_ORDER = { expired: 0, urgent: 1, soon: 2, ok: 3, none: 4 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function toDateString(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function todayString() { return toDateString(new Date()); }

  function addDays(days) {
    var d = new Date();
    d.setDate(d.getDate() + days);
    return toDateString(d);
  }

  // 'YYYY-MM-DD' 를 현지 자정 기준 날짜로 해석
  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  // 오늘부터 유통기한까지 남은 일수 (음수면 지남). 기한이 없으면 null
  function daysLeft(expiry) {
    var e = parseDate(expiry);
    if (!e) return null;
    var t = parseDate(todayString());
    return Math.round((e - t) / 86400000);
  }

  function status(item) {
    var d = daysLeft(item.expiry);
    if (d === null) return 'none';
    if (d < 0) return 'expired';
    if (d <= URGENT_DAYS) return 'urgent';
    if (d <= SOON_DAYS) return 'soon';
    return 'ok';
  }

  function dday(item) {
    var d = daysLeft(item.expiry);
    if (d === null) return '';
    if (d === 0) return '오늘까지';
    if (d < 0) return 'D+' + (-d);
    return 'D-' + d;
  }

  // 유통기한순: 지남 → 임박 → 곧 → 여유 → 기한 없음 (sign = -1 이면 반대로)
  // 같은 상태 안에서 다 떨어진(수량 0) 재료는 정렬 방향과 상관없이 아래로
  function byExpiry(a, b, sign) {
    sign = sign || 1;
    var sa = STATUS_ORDER[status(a)];
    var sb = STATUS_ORDER[status(b)];
    if (sa !== sb) return sign * (sa - sb);
    var oa = a.quantity <= 0 ? 1 : 0, ob = b.quantity <= 0 ? 1 : 0;
    if (oa !== ob) return oa - ob;
    if (a.expiry && b.expiry && a.expiry !== b.expiry) return sign * (a.expiry < b.expiry ? -1 : 1);
    return sign * byName(a, b);
  }

  function byName(a, b) {
    return String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  }

  // 이름순: 가나다, 이름이 같으면 유통기한 빠른 순
  function byNameThenExpiry(a, b) {
    var c = byName(a, b);
    if (c) return c;
    if (a.expiry === b.expiry) return 0;
    if (!a.expiry) return 1;
    if (!b.expiry) return -1;
    return a.expiry < b.expiry ? -1 : 1;
  }

  // 등록순: 먼저 등록한 재료부터
  function byCreated(a, b) {
    var d = (a.createdAt || 0) - (b.createdAt || 0);
    return d || byName(a, b);
  }

  var COMPARATORS = { expiry: byExpiry, name: byNameThenExpiry, created: byCreated };
  var SORT_BY = ['expiry', 'name', 'created'];

  // by: 'expiry'(기본) | 'name' | 'created', dir: 'asc'(기본) | 'desc'
  function sort(items, by, dir) {
    var cmp = COMPARATORS[by] || byExpiry;
    var sign = dir === 'desc' ? -1 : 1;
    if (cmp === byExpiry) return items.slice().sort(function (a, b) { return byExpiry(a, b, sign); });
    return items.slice().sort(function (a, b) { return sign * cmp(a, b); });
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function create(fields) {
    var now = Date.now();
    return {
      id: newId(),
      name: fields.name,
      quantity: fields.quantity,
      unit: fields.unit || '',
      location: LOCATIONS[fields.location] ? fields.location : 'fridge',
      expiry: fields.expiry || null,
      createdAt: now,
      updatedAt: now
    };
  }

  function formatQty(n) {
    return String(Math.round(n * 100) / 100);
  }

  // 수량은 0 ~ MAX_QTY (서버 규칙과 같은 상한), 소수 둘째 자리까지
  var MAX_QTY = 100000;
  function clampQty(n) {
    n = Number(n);
    if (!isFinite(n) || n < 0) n = 0;
    return Math.min(MAX_QTY, Math.round(n * 100) / 100);
  }

  /* ---------- 초성 검색 ---------- */

  var CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

  function chosungOf(ch) {
    var c = ch.charCodeAt(0) - 0xAC00;
    return c >= 0 && c <= 11171 ? CHOSEONG[Math.floor(c / 588)] : null;
  }

  function normText(s) {
    return String(s || '').replace(/\s+/g, '').toLowerCase();
  }

  // 검색어의 각 글자: 초성(ㄱ~ㅎ)이면 이름 글자의 초성과, 아니면 글자 그대로 비교
  // 예) 'ㅇㅇ' → 우유, 'ㄷ부' → 두부, '대ㅍ' → 대파
  function matchesQuery(name, query) {
    var n = normText(name);
    var q = normText(query);
    if (!q) return true;
    if (n.indexOf(q) !== -1) return true;
    for (var start = 0; start + q.length <= n.length; start++) {
      var ok = true;
      for (var i = 0; i < q.length && ok; i++) {
        var qc = q[i], nc = n[start + i];
        ok = CHOSEONG.indexOf(qc) !== -1 ? (nc === qc || chosungOf(nc) === qc) : nc === qc;
      }
      if (ok) return true;
    }
    return false;
  }

  /* ---------- 같은 재료 찾기 · 합치기 ---------- */

  // 이름(공백·대소문자 무시) + 보관 위치 + 단위가 같으면 같은 재료
  function findSame(items, fields) {
    var key = normText(fields.name);
    var unit = normText(fields.unit);
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (normText(it.name) === key && it.location === fields.location && normText(it.unit) === unit) return it;
    }
    return null;
  }

  // 합친 결과: 수량은 더하고, 유통기한은 더 빠른 날짜(없으면 있는 쪽)
  function mergedFields(existing, fields) {
    var a = existing.expiry, b = fields.expiry;
    return {
      quantity: clampQty((existing.quantity || 0) + (fields.quantity || 0)),
      expiry: a && b ? (a < b ? a : b) : (a || b || null)
    };
  }

  Fridge.ingredients = {
    LOCATIONS: LOCATIONS,
    create: create,
    status: status,
    daysLeft: daysLeft,
    dday: dday,
    sort: sort,
    SORT_BY: SORT_BY,
    addDays: addDays,
    formatQty: formatQty,
    MAX_QTY: MAX_QTY,
    clampQty: clampQty,
    matchesQuery: matchesQuery,
    findSame: findSame,
    mergedFields: mergedFields
  };
})(window.Fridge = window.Fridge || {});
