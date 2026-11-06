/*
 * 서비스 워커: 앱 파일을 휴대폰에 저장해 두고 인터넷 없이도 실행되게 합니다.
 * 인터넷이 되면 항상 최신 파일을 받으므로, 앱을 고쳐 GitHub에 올리면 다음 실행부터 바로 반영됩니다.
 */
var CACHE_VERSION = 'fridge-v12';
var NETWORK_TIMEOUT = 3000; // 이 시간 안에 응답이 없으면 저장해 둔 파일로 먼저 실행

var APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './css/style.css',
  './js/storage.js',
  './js/ingredients.js',
  './js/memos.js',
  './js/firebase-config.js',
  './js/family.js',
  './js/recipe-data.js',
  './js/recipes.js',
  './js/app.js',
  './js/family-ui.js',
  './js/memo-ui.js',
  './js/pwa.js',
  // 가족 공유용 Firebase (업데이트 뒤 오프라인에서도 가족 냉장고가 열리도록 미리 저장)
  './vendor/firebase/firebase-app-compat.js',
  './vendor/firebase/firebase-auth-compat.js',
  './vendor/firebase/firebase-firestore-compat.js'
];

self.addEventListener('install', function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(APP_FILES.map(function (u) { return new Request(u, { cache: 'reload' }); }));
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_VERSION) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // 그 밖의 외부 주소(Firestore 통신 등)는 건드리지 않음
  if (url.origin !== self.location.origin) return;

  // 앱 화면 열기: ?add=1 같은 주소도 저장된 index.html 로
  var key = req.mode === 'navigate' ? './index.html' : req;

  // 인터넷이 되면 최신 파일(받은 파일은 저장), 안 되거나 너무 느리면 저장해 둔 파일로 실행
  function fromCache() {
    return caches.open(CACHE_VERSION).then(function (cache) {
      return cache.match(key, { ignoreSearch: true });
    });
  }

  var network = fetch(req).then(function (res) {
    if (res.ok && res.type === 'basic') {
      var copy = res.clone();
      caches.open(CACHE_VERSION).then(function (cache) { cache.put(key, copy); });
    }
    return res;
  });
  // 캐시로 먼저 응답해도, 늦게 온 최신 파일을 끝까지 받아 저장
  event.waitUntil(network.catch(function () {}));

  event.respondWith(new Promise(function (resolve) {
    var done = false;
    function finish(res) { if (!done && res) { done = true; resolve(res); } }
    // 신호가 약해 응답이 늦으면 저장해 둔 파일로 먼저 보여줌 (받은 최신 파일은 다음 실행에 반영)
    var timer = setTimeout(function () { fromCache().then(finish); }, NETWORK_TIMEOUT);
    network.then(function (res) {
      clearTimeout(timer);
      finish(res);
    }, function () {
      clearTimeout(timer);
      fromCache().then(function (hit) { finish(hit || Response.error()); });
    });
  }));
});
