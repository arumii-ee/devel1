/*
 * 추천 레시피 (향후 기능 자리)
 * ---------------------------------------------------------------
 * recommend(ingredients) 는 재료 배열을 받아 추천 레시피 배열을 돌려줄 예정입니다.
 *   [{ title, uses: ['계란', '우유'], missing: ['설탕'], urgentUsed: 1 }]
 * 계획: 내장 레시피 목록과 재료 이름을 매칭하고, 유통기한 임박 재료를
 *       많이 쓰는 레시피를 먼저 보여줍니다. 이후 외부 레시피 API / AI 연동 가능.
 */
(function (Fridge) {
  'use strict';

  Fridge.recipes = {
    recommend: function (/* ingredients */) {
      return Promise.resolve([]);
    }
  };
})(window.Fridge = window.Fridge || {});
