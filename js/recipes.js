/*
 * 추천 레시피
 * ---------------------------------------------------------------
 * recommend(items) → Promise<[{ recipe, have, missing, extra, urgent }]>
 *   have    : 가진 필수 재료  [{ name, item }]
 *   missing : 없는 필수 재료  ['설탕', ...]
 *   extra   : 가진 선택 재료  [{ name, item }]
 *   urgent  : 유통기한 지남/임박/7일 이내 재료를 몇 개 쓰는지
 * 정렬: 부족한 재료 적은 순 → 급한 재료 많이 쓰는 순 → 가진 재료 많은 순
 * 나중에 외부 레시피 API나 AI 추천으로 바꾸려면 이 함수만 교체하면 됩니다.
 */
(function (Fridge) {
  'use strict';

  var data = Fridge.RECIPE_DATA;
  var I = Fridge.ingredients;
  var MAX_MISSING = 2; // 필수 재료가 이만큼까지 부족해도 "조금만 더" 로 보여줌
  var URGENT = { expired: true, urgent: true, soon: true };

  function normalize(s) {
    return String(s || '').replace(/\s+/g, '').toLowerCase();
  }

  function rule(name) {
    return data.KEYWORDS[name] || { kw: [name] };
  }

  // 냉장고 재료 이름(itemName)이 레시피 재료(name)에 해당하는지
  function matches(itemName, name) {
    var n = normalize(itemName);
    var r = rule(name);
    if (r.not && r.not.some(function (w) { return n.indexOf(w) !== -1; })) return false;
    return r.kw.some(function (w) {
      w = normalize(w);
      return w.length === 1 && !r.partial ? n === w : n.indexOf(w) !== -1;
    });
  }

  // 해당하는 재료 중 가장 급한 것(유통기한이 가장 가까운 것)을 고름
  function findItem(items, name) {
    var best = null, bestDays = Infinity;
    items.forEach(function (it) {
      if (!matches(it.name, name)) return;
      var d = I.daysLeft(it.expiry);
      var key = d === null ? 99999 : d;
      if (!best || key < bestDays) { best = it; bestDays = key; }
    });
    return best;
  }

  function evaluate(recipe, items) {
    var have = [], missing = [], extra = [];
    recipe.need.forEach(function (name) {
      var it = findItem(items, name);
      if (it) have.push({ name: name, item: it });
      else missing.push(name);
    });
    recipe.optional.forEach(function (name) {
      var it = findItem(items, name);
      if (it) extra.push({ name: name, item: it });
    });
    var used = {};
    var urgent = 0;
    have.concat(extra).forEach(function (h) {
      if (!used[h.item.id] && URGENT[I.status(h.item)]) urgent++;
      used[h.item.id] = true;
    });
    return { recipe: recipe, have: have, missing: missing, extra: extra, urgent: urgent };
  }

  function recommend(items) {
    var stock = (items || []).filter(function (it) { return it.quantity > 0; });
    var results = data.RECIPES
      .map(function (r) { return evaluate(r, stock); })
      .filter(function (x) {
        return x.have.length > 0 && x.missing.length <= MAX_MISSING;
      })
      .sort(function (a, b) {
        return (a.missing.length - b.missing.length) ||
          (b.urgent - a.urgent) ||
          ((b.have.length + b.extra.length) - (a.have.length + a.extra.length)) ||
          a.recipe.title.localeCompare(b.recipe.title, 'ko');
      });
    return Promise.resolve(results);
  }

  Fridge.recipes = {
    recommend: recommend,
    matches: matches
  };
})(window.Fridge = window.Fridge || {});
