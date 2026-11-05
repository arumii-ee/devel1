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

  function sort(items) {
    return items.slice().sort(function (a, b) {
      var sa = STATUS_ORDER[status(a)];
      var sb = STATUS_ORDER[status(b)];
      if (sa !== sb) return sa - sb;
      if (a.expiry && b.expiry && a.expiry !== b.expiry) return a.expiry < b.expiry ? -1 : 1;
      return a.name.localeCompare(b.name, 'ko');
    });
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

  Fridge.ingredients = {
    LOCATIONS: LOCATIONS,
    create: create,
    status: status,
    daysLeft: daysLeft,
    dday: dday,
    sort: sort,
    addDays: addDays,
    formatQty: formatQty
  };
})(window.Fridge = window.Fridge || {});
