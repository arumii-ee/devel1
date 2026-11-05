/*
 * 서비스 워커: 앱 파일을 휴대폰에 저장해 두고 인터넷 없이도 실행되게 합니다.
 * 인터넷이 되면 항상 최신 파일을 받으므로, 앱을 고쳐 GitHub에 올리면 다음 실행부터 바로 반영됩니다.
 */
var CACHE_VERSION = 'fridge-v1';
var SDK_CACHE = 'fridge-firebase-sdk';

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
  './js/firebase-config.js',
  './js/family.js',
  './js/recipe-data.js',
  './js/recipes.js',
  './js/app.js',
  './js/family-ui.js',
  './js/pwa.js'
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
        if (k !== CACHE_VERSION && k !== SDK_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Firebase SDK 파일: 한 번 받으면 저장해서 사용 (버전이 주소에 들어 있어 바뀌지 않음)
  if (url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0) {
    event.respondWith(
      caches.open(SDK_CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
          return hit || fetch(req).then(function (res) {
            if (res.ok) cache.put(req, res.clone());
            return res;
          });
        });
      })
    );
    return;
  }

  // 그 밖의 외부 주소(Firestore 통신 등)는 건드리지 않음
  if (url.origin !== self.location.origin) return;

  // 앱 화면 열기: ?add=1 같은 주소도 저장된 index.html 로
  var key = req.mode === 'navigate' ? './index.html' : req;

  // 인터넷이 되면 항상 최신 파일(받은 파일은 저장), 안 되면 저장해 둔 파일로 실행
  event.respondWith(
    fetch(req).then(function (res) {
      if (res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function (cache) { cache.put(key, copy); });
      }
      return res;
    }).catch(function () {
      return caches.open(CACHE_VERSION).then(function (cache) {
        return cache.match(key, { ignoreSearch: true });
      }).then(function (hit) {
        return hit || Response.error();
      });
    })
  );
});
