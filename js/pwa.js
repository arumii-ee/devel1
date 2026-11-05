/*
 * 설치형 앱(PWA)
 * - 서비스 워커 등록 → 인터넷 없이도 실행
 * - "앱으로 설치하기" 안내 띠
 * - 홈 화면 아이콘 길게 누르기 바로가기(재료 추가 / 추천 레시피)
 */
(function (Fridge) {
  'use strict';

  var ui = Fridge.ui;
  var HIDE_KEY = 'fridge-app:install-dismissed';
  var bar = document.getElementById('installBar');
  var installBtn = document.getElementById('installBtn');
  var closeBtn = document.getElementById('installClose');
  var deferred = null;

  function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
  }

  function dismissed() {
    try { return window.localStorage.getItem(HIDE_KEY) === '1'; } catch (e) { return false; }
  }

  /* ---------- 서비스 워커 (http/https 에서만, 더블클릭 실행 file:// 은 제외) ---------- */
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (e) {
        console.warn('[앱 설치] 서비스 워커 등록 실패', e);
      });
    });
  }

  /* ---------- 설치 안내 띠 ---------- */
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); // 브라우저 기본 안내 대신 우리 띠로
    deferred = e;
    if (!isStandalone() && !dismissed()) bar.hidden = false;
  });

  installBtn.addEventListener('click', function () {
    if (!deferred) return;
    bar.hidden = true;
    deferred.prompt();
    deferred.userChoice.then(function (choice) {
      if (choice && choice.outcome === 'accepted') ui.toast('앱을 설치했어요. 홈 화면에서 열어 보세요');
      deferred = null;
    });
  });

  closeBtn.addEventListener('click', function () {
    bar.hidden = true;
    try { window.localStorage.setItem(HIDE_KEY, '1'); } catch (e) { /* 무시 */ }
  });

  window.addEventListener('appinstalled', function () {
    bar.hidden = true;
    deferred = null;
  });

  /* ---------- 바로가기 ---------- */
  var params = new URLSearchParams(location.search);
  if (params.has('add') || params.has('recipes')) {
    // 주소에서 ?add=1 을 지워 새로고침해도 다시 열리지 않게
    try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* 무시 */ }
    setTimeout(function () {
      if (params.has('add')) ui.openAdd();
      else ui.openRecipes();
    }, 0);
  }
})(window.Fridge = window.Fridge || {});
