/*
 * Firestore 보안 규칙 테스트 (공격 시나리오 75개)
 * ---------------------------------------------------------------
 * firestore.rules 를 고친 뒤 아래처럼 실행해 모두 통과하는지 확인하세요. (Node.js, Java 필요)
 *
 *   cd tests
 *   npm init -y && npm i firebase@10.12.2 @firebase/rules-unit-testing@3 firebase-tools@13
 *   cd ..
 *   npx --prefix tests firebase emulators:exec --only firestore --project demo-rules "node tests/firestore-rules.test.mjs"
 *
 * (저장소 맨 위의 firebase.json 이 firestore.rules 를 사용합니다)
 */
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, writeBatch } from 'firebase/firestore';
import fs from 'fs';

const env = await initializeTestEnvironment({
  projectId: 'demo-rules',
  firestore: { rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
});
const NOW = Date.now(); // 가입 시각은 실제 시각으로 (오래된 시각이면 '관리자 30일 미접속'으로 판단됨)
const FID = 'FAMILYID000000000001', CODE = 'K7PMQXABCDEF', CODE2 = 'ZZZZYYYYXXXX';
const item = (id, extra = {}) => ({ id, name: '우유', quantity: 1, unit: 'L', location: 'fridge', expiry: '2026-11-10', createdAt: 1, updatedAt: 1, ...extra });
let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); pass++; console.log('  ✔', name); } catch (e) { fail++; console.log('  ✘', name, '-', e.message.split('\n')[0]); } }

const owner = env.authenticatedContext('owner').firestore();
const alice = env.authenticatedContext('alice').firestore();
const mallory = env.authenticatedContext('mallory').firestore();
const anon = env.unauthenticatedContext().firestore();

console.log('[만들기]');
await t('비로그인은 가족 만들기 불가', () => assertFails(setDoc(doc(anon, 'families', FID), { ownerUid: 'x', code: CODE, createdAt: 1 })));
await t('남의 uid로 가족 만들기 불가', () => assertFails(setDoc(doc(owner, 'families', FID), { ownerUid: 'alice', code: CODE, createdAt: 1 })));
await t('잘못된 코드 형식(O,1 포함) 불가', () => assertFails(setDoc(doc(owner, 'families', FID), { ownerUid: 'owner', code: 'OOOO11112222', createdAt: 1 })));
await t('허용되지 않은 칸 추가 불가', () => assertFails(setDoc(doc(owner, 'families', FID), { ownerUid: 'owner', code: CODE, createdAt: 1, hack: true })));
await t('관리자: 가족 만들기 성공', () => assertSucceeds(setDoc(doc(owner, 'families', FID), { ownerUid: 'owner', code: CODE, createdAt: 1 })));
await t('관리자: 멤버 가입 성공', () => assertSucceeds(setDoc(doc(owner, 'families', FID, 'members', 'owner'), { name: '엄마', joinedAt: NOW + 1, code: CODE })));
await t('관리자 아닌 사람은 초대 코드 등록 불가', () => assertFails(setDoc(doc(mallory, 'invites', CODE), { familyId: FID, createdAt: 1 })));
await t('가족 코드와 다른 초대 코드 등록 불가', () => assertFails(setDoc(doc(owner, 'invites', CODE2), { familyId: FID, createdAt: 1 })));
await t('관리자: 초대 코드 등록 성공', () => assertSucceeds(setDoc(doc(owner, 'invites', CODE), { familyId: FID, createdAt: 1 })));
await t('이미 있는 초대 코드 덮어쓰기 불가', () => assertFails(setDoc(doc(mallory, 'invites', CODE), { familyId: 'evil', createdAt: 1 })));

console.log('[엿보기 차단]');
await t('초대 코드 목록 보기 불가', () => assertFails(getDocs(collection(mallory, 'invites'))));
await t('가족 목록 보기 불가', () => assertFails(getDocs(collection(mallory, 'families'))));
await t('비멤버는 가족 정보 읽기 불가', () => assertFails(getDoc(doc(mallory, 'families', FID))));
await t('비멤버는 재료 읽기 불가', () => assertFails(getDocs(collection(mallory, 'families', FID, 'items'))));
await t('비멤버는 재료 쓰기 불가', () => assertFails(setDoc(doc(mallory, 'families', FID, 'items', 'x1'), item('x1'))));
await t('비멤버는 멤버 명단 보기 불가', () => assertFails(getDocs(collection(mallory, 'families', FID, 'members'))));
await t('비로그인은 초대 코드 조회 불가', () => assertFails(getDoc(doc(anon, 'invites', CODE))));
await t('비로그인은 재료 읽기 불가', () => assertFails(getDocs(collection(anon, 'families', FID, 'items'))));

console.log('[가입]');
await t('틀린 코드로 가입 불가', () => assertFails(setDoc(doc(mallory, 'families', FID, 'members', 'mallory'), { name: 'x', joinedAt: NOW + 1, code: CODE2 })));
await t('남의 uid로 가입 불가', () => assertFails(setDoc(doc(mallory, 'families', FID, 'members', 'alice'), { name: 'x', joinedAt: NOW + 1, code: CODE })));
await t('이름 11자 이상 불가', () => assertFails(setDoc(doc(alice, 'families', FID, 'members', 'alice'), { name: '가나다라마바사아자차카', joinedAt: NOW + 1, code: CODE })));
await t('올바른 코드로 초대 조회 성공', () => assertSucceeds(getDoc(doc(alice, 'invites', CODE))));
await t('올바른 코드로 가입 성공', () => assertSucceeds(setDoc(doc(alice, 'families', FID, 'members', 'alice'), { name: '아빠', joinedAt: NOW + 2, code: CODE })));
await t('멤버는 재료 쓰기 성공', () => assertSucceeds(setDoc(doc(alice, 'families', FID, 'items', 'a1'), item('a1', { addedBy: '아빠' }))));
await t('멤버는 재료 읽기 성공', () => assertSucceeds(getDocs(collection(alice, 'families', FID, 'items'))));
await t('멤버는 수량 수정 성공', () => assertSucceeds(updateDoc(doc(alice, 'families', FID, 'items', 'a1'), { quantity: 2, updatedAt: 3, updatedBy: '아빠' })));

console.log('[데이터 검사]');
const bad = { '이름 41자': item('b', { name: 'x'.repeat(41) }), '빈 이름': item('b', { name: '' }), '음수 수량': item('b', { quantity: -1 }),
  '수량 문자': item('b', { quantity: '1' }), '너무 큰 수량': item('b', { quantity: 1e9 }), '잘못된 위치': item('b', { location: 'garage' }),
  '잘못된 날짜': item('b', { expiry: '내일' }), '단위 11자': item('b', { unit: 'x'.repeat(11) }), '허용 안 된 칸': item('b', { hack: 'x'.repeat(5000) }),
  '문서 id 불일치': item('other'), '필수 칸 없음': { id: 'b', name: '우유' }, 'addedBy 11자': item('b', { addedBy: 'x'.repeat(11) }) };
for (const [k, v] of Object.entries(bad)) await t(`${k} 거부`, () => assertFails(setDoc(doc(alice, 'families', FID, 'items', 'b'), v)));
await t('수정으로 이상한 칸 추가 거부', () => assertFails(updateDoc(doc(alice, 'families', FID, 'items', 'a1'), { hack: 1 })));

console.log('[관리자 권한]');
await t('멤버는 코드 바꾸기 불가', () => assertFails(updateDoc(doc(alice, 'families', FID), { code: CODE2 })));
await t('멤버는 관리자 가로채기 불가', () => assertFails(updateDoc(doc(alice, 'families', FID), { ownerUid: 'alice' })));
await t('멤버는 다른 멤버 내보내기 불가', () => assertFails(deleteDoc(doc(alice, 'families', FID, 'members', 'owner'))));
await t('멤버는 남의 이름 수정 불가', () => assertFails(updateDoc(doc(alice, 'families', FID, 'members', 'owner'), { name: 'x' })));
await t('멤버는 자기 가입 코드 수정 불가', () => assertFails(updateDoc(doc(alice, 'families', FID, 'members', 'alice'), { code: CODE2 })));
await t('멤버는 초대 코드 삭제 불가', () => assertFails(deleteDoc(doc(alice, 'invites', CODE))));
await t('가족 삭제 불가', () => assertFails(deleteDoc(doc(owner, 'families', FID))));
await t('관리자를 멤버 아닌 사람에게 넘기기 불가', () => assertFails(updateDoc(doc(owner, 'families', FID), { ownerUid: 'mallory' })));
await t('관리자: 코드와 관리자 동시 변경 불가', () => assertFails(updateDoc(doc(owner, 'families', FID), { code: CODE2, ownerUid: 'alice' })));

console.log('[내보내기 · 코드 바꾸기]');
// mallory가 옛 코드를 알고 가입한 상황
await t('(준비) mallory 가입', () => assertSucceeds(setDoc(doc(mallory, 'families', FID, 'members', 'mallory'), { name: '?', joinedAt: NOW + 3, code: CODE })));
await t('관리자: mallory 내보내기 성공', () => assertSucceeds(deleteDoc(doc(owner, 'families', FID, 'members', 'mallory'))));
await t('관리자: 코드 바꾸기 성공', () => assertSucceeds(updateDoc(doc(owner, 'families', FID), { code: CODE2 })));
await t('관리자: 새 초대 코드 등록 성공', () => assertSucceeds(setDoc(doc(owner, 'invites', CODE2), { familyId: FID, createdAt: 2 })));
await t('관리자: 옛 초대 코드 삭제 성공', () => assertSucceeds(deleteDoc(doc(owner, 'invites', CODE))));
await t('내보내진 사람 재료 읽기 불가', () => assertFails(getDocs(collection(mallory, 'families', FID, 'items'))));
await t('내보내진 사람 재료 쓰기 불가', () => assertFails(setDoc(doc(mallory, 'families', FID, 'items', 'm1'), item('m1'))));
await t('내보내진 사람 옛 코드로 재가입 불가', () => assertFails(setDoc(doc(mallory, 'families', FID, 'members', 'mallory'), { name: '?', joinedAt: NOW + 4, code: CODE })));
await t('옛 코드 초대 조회 결과 없음', async () => { const d = await getDoc(doc(mallory, 'invites', CODE)); if (d.exists()) throw new Error('exists'); });
await t('내보내진 사람이 자기 멤버 문서 확인 가능(나가짐 감지)', () => assertSucceeds(getDoc(doc(mallory, 'families', FID, 'members', 'mallory'))));
await t('기존 멤버(alice)는 계속 접근 가능', () => assertSucceeds(getDocs(collection(alice, 'families', FID, 'items'))));

console.log('[관리자 넘기기 · 탈퇴]');
await t('관리자: 멤버에게 관리자 넘기기 성공', () => assertSucceeds(updateDoc(doc(owner, 'families', FID), { ownerUid: 'alice' })));
await t('이전 관리자는 코드 바꾸기 불가', () => assertFails(updateDoc(doc(owner, 'families', FID), { code: CODE })));
await t('본인 탈퇴 성공', () => assertSucceeds(deleteDoc(doc(owner, 'families', FID, 'members', 'owner'))));
await t('탈퇴한 사람 재료 읽기 불가', () => assertFails(getDocs(collection(owner, 'families', FID, 'items'))));

console.log('[마지막 접속 · 관리자 넘겨받기]');
// 지금 관리자는 alice. bob이 현재 코드(CODE2)로 가입
const bob = env.authenticatedContext('bob').firestore();
const OLD = Date.now() - 31 * 86400000;
await t('(준비) bob 가입', () => assertSucceeds(setDoc(doc(bob, 'families', FID, 'members', 'bob'), { name: '민지', joinedAt: Date.now(), code: CODE2 })));
await t('본인 마지막 접속 시각 기록 성공', () => assertSucceeds(updateDoc(doc(alice, 'families', FID, 'members', 'alice'), { lastSeen: Date.now() })));
await t('마지막 접속 시각 문자 거부', () => assertFails(updateDoc(doc(bob, 'families', FID, 'members', 'bob'), { lastSeen: 'now' })));
await t('마지막 접속 시각 먼 미래 거부', () => assertFails(updateDoc(doc(bob, 'families', FID, 'members', 'bob'), { lastSeen: Date.now() + 86400000 })));
await t('남의 마지막 접속 시각 수정 불가', () => assertFails(updateDoc(doc(bob, 'families', FID, 'members', 'alice'), { lastSeen: OLD })));
await t('관리자가 최근에 접속했으면 넘겨받기 불가', () => assertFails(updateDoc(doc(bob, 'families', FID), { ownerUid: 'bob' })));
await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'families', FID, 'members', 'alice'), { lastSeen: OLD }));
await t('비멤버는 오래된 관리자 넘겨받기 불가', () => assertFails(updateDoc(doc(mallory, 'families', FID), { ownerUid: 'mallory' })));
await t('넘겨받을 때 남을 관리자로 지정 불가', () => assertFails(updateDoc(doc(bob, 'families', FID), { ownerUid: 'owner' })));
await t('넘겨받으면서 코드까지 바꾸기 불가', () => assertFails(updateDoc(doc(bob, 'families', FID), { ownerUid: 'bob', code: CODE })));
await t('관리자가 30일 넘게 안 들어오면 넘겨받기 성공', () => assertSucceeds(updateDoc(doc(bob, 'families', FID), { ownerUid: 'bob' })));
await t('새 관리자: 안 쓰는 기기 내보내기 성공', () => assertSucceeds(deleteDoc(doc(bob, 'families', FID, 'members', 'alice'))));
await t('명단에 없는 관리자도 넘겨받기 가능', async () => {
  await env.withSecurityRulesDisabled(c => updateDoc(doc(c.firestore(), 'families', FID), { ownerUid: 'ghost' }));
  await assertSucceeds(updateDoc(doc(bob, 'families', FID), { ownerUid: 'bob' }));
});

console.log(`\n결과: 통과 ${pass} / 실패 ${fail}`);
await env.cleanup();
process.exit(fail ? 1 : 0);
