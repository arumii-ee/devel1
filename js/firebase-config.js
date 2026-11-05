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
 *
 * 이 값들은 비밀번호가 아니라 "어느 Firebase 프로젝트인지" 알려주는 값이라 공개되어도 됩니다.
 * 데이터 보호는 익명 로그인 + firestore.rules(멤버만 접근)가 담당합니다.
 */
var FIREBASE_CONFIG = null;

window.Fridge = window.Fridge || {};
window.Fridge.FIREBASE_CONFIG = window.Fridge.FIREBASE_CONFIG || FIREBASE_CONFIG;
