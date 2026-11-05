/*
 * 가족 공유용 Firebase 설정
 * ---------------------------------------------------------------
 * README.md 의 "가족 공유 설정" 순서대로 Firebase 프로젝트를 만든 뒤,
 * Firebase 콘솔에서 복사한 firebaseConfig 값을 아래 null 대신 붙여 넣으세요.
 *
 * 예)
 * var FIREBASE_CONFIG = {
 *   apiKey: "AIza....",
 *   authDomain: "my-fridge.firebaseapp.com",
 *   projectId: "my-fridge",
 *   storageBucket: "my-fridge.appspot.com",
 *   messagingSenderId: "1234567890",
 *   appId: "1:1234567890:web:abcdef"
 * };
 */
var FIREBASE_CONFIG = null;

window.Fridge = window.Fridge || {};
window.Fridge.FIREBASE_CONFIG = window.Fridge.FIREBASE_CONFIG || FIREBASE_CONFIG;
