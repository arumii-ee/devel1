/*
 * 가족 공유 화면
 */
(function (Fridge) {
  'use strict';

  var F = Fridge.family;
  var store = Fridge.storage;
  var ui = Fridge.ui;
  var el = ui.el;
  var NAME_KEY = 'fridge-app:my-name';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    btn: $('familyBtn'), dot: $('syncDot'), line: $('syncLine'),
    panel: $('familyPanel'), back: $('familyBack'), body: $('familyBody')
  };

  var STATUS_TEXT = {
    connecting: '연결 중…',
    online: '실시간 동기화 중',
    offline: '오프라인 · 인터넷이 연결되면 자동으로 맞춰져요',
    error: '연결 실패'
  };

  function myName() {
    if (F.info && F.info.name) return F.info.name;
    try { return window.localStorage.getItem(NAME_KEY) || ''; } catch (e) { return ''; }
  }
  function rememberName(n) {
    try { window.localStorage.setItem(NAME_KEY, n); } catch (e) { /* 무시 */ }
  }

  function errorText(e) {
    var code = (e && (e.code || e.message)) || '';
    if (code === 'sdk-load') return '가족 공유 프로그램을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.';
    if (code === 'file-mode') return '가족 공유는 앱 주소(https://…github.io)에서 열어야 쓸 수 있어요.';
    if (code === 'not-found') return '그 코드의 가족 냉장고가 없어요. 코드가 바뀌었을 수 있으니 다시 받아 주세요.';
    if (code === 'bad-code') return '가족 코드는 12자리예요. (예: K7PM-3QXA-B2CD)';
    if (code === 'permission-denied') return '권한이 없어요. 코드가 바뀌었거나 Firebase 보안 규칙 설정을 확인해 주세요.';
    if (code === 'unavailable') return '서버에 연결할 수 없어요. 인터넷 연결을 확인해 주세요.';
    if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation' || code === 'auth/configuration-not-found') return 'Firebase에서 Authentication → 익명 로그인을 켜 주세요. (README 참고)';
    if (code === 'auth/unauthorized-domain') return 'Firebase 승인된 도메인에 앱 주소를 추가해 주세요. (README 참고)';
    if (code === 'auth/network-request-failed') return '인터넷 연결을 확인해 주세요.';
    return '연결에 실패했어요. ' + code;
  }

  /* ---------- 상단 표시 ---------- */

  function renderStatus() {
    var s = store.status;
    var shared = !!F.info;
    els.dot.className = 'sync-dot' + (shared ? ' is-' + s : '');
    els.dot.hidden = !shared;
    els.line.hidden = !shared;
    if (shared) {
      els.line.className = 'sync-line is-' + s;
      els.line.textContent = '가족 냉장고 · ' + (STATUS_TEXT[s] || '');
    }
    // 입력 중이면 다시 그리지 않음(입력 내용이 사라지지 않게)
    var a = document.activeElement;
    var typing = a && a.tagName === 'INPUT' && els.panel.contains(a);
    if (!els.panel.hidden && !typing) renderPanel();
  }

  /* ---------- 복사 / 보내기 ---------- */

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* 무시 */ }
    document.body.removeChild(ta);
    return ok ? Promise.resolve() : Promise.reject(new Error('copy'));
  }

  function shareCode() {
    var code = F.formatCode(F.state.code);
    var text = '냉장고 가족 코드: ' + code + '\n앱을 열고 [가족 공유 → 가족 코드로 참여]에 입력하세요.';
    if (/^https?:/.test(location.href)) text += '\n' + location.href.split('#')[0];
    if (navigator.share) {
      navigator.share({ title: '냉장고', text: text }).catch(function () { /* 취소 */ });
    } else {
      copyText(text).then(function () { ui.toast('초대 문구를 복사했어요. 메신저에 붙여 넣으세요'); },
        function () { ui.toast('복사하지 못했어요. 코드를 직접 알려 주세요'); });
    }
  }

  /* ---------- 패널 ---------- */

  function button(text, cls, onClick) {
    var b = el('button', 'btn ' + cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function busy(btn, promise, label) {
    var old = btn.textContent;
    btn.disabled = true;
    btn.textContent = label || '잠시만요…';
    return promise.then(function (v) {
      btn.disabled = false; btn.textContent = old; return v;
    }, function (e) {
      btn.disabled = false; btn.textContent = old; throw e;
    });
  }

  function nameField() {
    var wrap = el('label', 'field');
    wrap.appendChild(el('span', null, '내 이름'));
    var input = el('input');
    input.type = 'text';
    input.id = 'famName';
    input.maxLength = F.NAME_MAX;
    input.placeholder = '예: 엄마, 아빠, 민지';
    input.value = myName();
    input.autocomplete = 'off';
    wrap.appendChild(input);
    wrap.appendChild(el('small', 'hint', '누가 재료를 넣었는지 가족에게 보여줘요.'));
    return { wrap: wrap, input: input };
  }

  function renderSetupGuide(body) {
    body.appendChild(el('h3', 'fam-title', '처음 한 번 설정이 필요해요'));
    body.appendChild(el('p', 'fam-text',
      '가족 공유는 구글의 무료 온라인 저장소(Firebase)를 사용해요. ' +
      '앱을 관리하는 사람이 처음 한 번만 설정하면, 다른 가족은 코드만 입력하면 돼요.'));
    var ol = el('ol', 'fam-steps');
    [
      'Firebase 콘솔(console.firebase.google.com)에서 프로젝트 만들기',
      'Authentication에서 익명 로그인 켜고, 승인된 도메인에 앱 주소 추가',
      'Firestore 데이터베이스 만들고 firestore.rules 보안 규칙 붙여 넣기',
      '웹 앱을 추가하고 나오는 설정값을 js/firebase-config.js 에 붙여 넣기',
      'GitHub에 올리면 모든 가족 휴대폰에 적용'
    ].forEach(function (t) { ol.appendChild(el('li', null, t)); });
    body.appendChild(ol);
    body.appendChild(el('p', 'fam-note', '자세한 방법은 README.md의 "가족 공유 설정"을 봐 주세요.'));
  }

  function renderJoinForm(body) {
    body.appendChild(el('p', 'fam-text', '같은 가족 코드를 입력한 휴대폰끼리 냉장고 목록이 실시간으로 함께 바뀌어요.'));
    var name = nameField();
    body.appendChild(name.wrap);

    var getName = function () {
      var n = name.input.value.trim();
      rememberName(n);
      return n;
    };

    // 새로 만들기
    var c1 = el('section', 'fam-card');
    c1.appendChild(el('h3', 'fam-title', '새 가족 냉장고 만들기'));
    var localCount = el('p', 'fam-text', '');
    store.local.list().then(function (items) {
      localCount.textContent = items.length
        ? '가족 코드가 만들어지고, 이 기기에 있는 재료 ' + items.length + '개가 함께 올라가요.'
        : '가족 코드가 만들어져요. 가족에게 코드를 알려 주세요.';
    });
    c1.appendChild(localCount);
    var createBtn = button('만들기', 'primary block', function () {
      busy(createBtn, F.create(getName()), '만드는 중…').then(function (code) {
        ui.toast('가족 냉장고를 만들었어요 · ' + F.formatCode(code));
        renderPanel();
      }, function (e) { ui.toast(errorText(e)); });
    });
    c1.appendChild(createBtn);
    body.appendChild(c1);

    // 코드로 참여
    var c2 = el('section', 'fam-card');
    c2.appendChild(el('h3', 'fam-title', '가족 코드로 참여'));
    var codeInput = el('input', 'code-input');
    codeInput.type = 'text';
    codeInput.id = 'famCode';
    codeInput.placeholder = '예: K7PM-3QXA-B2CD';
    codeInput.maxLength = 14;
    codeInput.autocomplete = 'off';
    codeInput.setAttribute('autocapitalize', 'characters');
    codeInput.setAttribute('aria-label', '가족 코드');
    codeInput.addEventListener('input', function () {
      codeInput.value = F.formatCode(F.normalizeCode(codeInput.value).slice(0, F.CODE_LENGTH));
    });
    c2.appendChild(codeInput);
    var joinBtn = button('참여하기', 'primary block', function () {
      var code = codeInput.value;
      if (F.normalizeCode(code).length !== F.CODE_LENGTH) { ui.toast(errorText({ message: 'bad-code' })); codeInput.focus(); return; }
      store.local.list().then(function (items) {
        var merge = items.length > 0 &&
          window.confirm('이 기기에 있던 재료 ' + items.length + '개도 가족 냉장고에 합칠까요?\n[취소]를 누르면 가족 냉장고 목록만 보여요.');
        return busy(joinBtn, F.join(code, getName(), merge), '참여하는 중…');
      }).then(function () {
        ui.toast('가족 냉장고에 참여했어요');
        renderPanel();
      }, function (e) { ui.toast(errorText(e)); });
    });
    c2.appendChild(joinBtn);
    body.appendChild(c2);
  }

  function renderJoined(body) {
    var s = store.status;
    var st = el('div', 'fam-status is-' + s);
    st.appendChild(el('span', 'sync-dot is-' + s));
    st.appendChild(el('span', null, STATUS_TEXT[s] || ''));
    if (s === 'error') {
      var r = el('button', 'link', '다시 시도');
      r.type = 'button';
      r.addEventListener('click', function () { F.retry().catch(function (e) { ui.toast(errorText(e)); }); });
      st.appendChild(r);
    }
    body.appendChild(st);

    var code = F.state.code;
    var c = el('section', 'fam-card center');
    c.appendChild(el('p', 'fam-label', '우리 가족 코드'));
    c.appendChild(el('p', 'fam-code', code ? F.formatCode(code) : '불러오는 중…'));
    var row = el('div', 'btn-row');
    var copyBtn = button('코드 복사', 'ghost', function () {
      copyText(F.formatCode(F.state.code)).then(function () { ui.toast('코드를 복사했어요'); },
        function () { ui.toast('복사하지 못했어요'); });
    });
    var inviteBtn = button('초대하기', 'primary', shareCode);
    copyBtn.disabled = inviteBtn.disabled = !code;
    row.appendChild(copyBtn);
    row.appendChild(inviteBtn);
    c.appendChild(row);
    c.appendChild(el('p', 'fam-note', '코드는 새 가족이 참여할 때만 필요해요. 가족끼리만 나눠 주세요.'));
    if (F.isOwner) {
      var rot = button('코드 바꾸기', 'ghost block', function () {
        if (!window.confirm('가족 코드를 새로 바꿀까요?\n이미 참여한 가족은 그대로이고, 옛 코드로는 더 이상 참여할 수 없어요.')) return;
        busy(rot, F.rotateCode(), '바꾸는 중…').then(function () { ui.toast('가족 코드를 바꿨어요'); },
          function (e) { ui.toast(errorText(e)); });
      });
      rot.classList.add('mt');
      c.appendChild(rot);
    }
    body.appendChild(c);

    // 멤버 명단
    var mc = el('section', 'fam-card');
    var mh = el('h3', 'fam-title', '가족 멤버 ');
    mh.appendChild(el('b', 'muted', String(F.state.members.length)));
    mc.appendChild(mh);
    var ul = el('ul', 'members');
    F.state.members.forEach(function (m) {
      var li = el('li', 'member');
      var nm = el('span', 'member-name', m.name || '이름 없음');
      li.appendChild(nm);
      if (m.uid === F.state.ownerUid) li.appendChild(el('span', 'tag', '관리자'));
      if (m.uid === F.state.uid) li.appendChild(el('span', 'tag me', '나'));
      else if (F.isInactive(m)) li.appendChild(el('span', 'tag idle', F.INACTIVE_DAYS + '일 넘게 안 씀'));
      if (F.isOwner && m.uid !== F.state.uid) {
        var kb = button('내보내기', 'small danger', function () {
          if (!window.confirm('“' + (m.name || '이름 없음') + '”을(를) 가족 냉장고에서 내보낼까요?\n내보내면 다시 들어오지 못하도록 가족 코드도 바뀌어요.')) return;
          busy(kb, F.kick(m.uid), '…').then(function () { ui.toast('내보내고 코드를 바꿨어요'); },
            function (e) { ui.toast(errorText(e)); });
        });
        li.appendChild(kb);
      }
      ul.appendChild(li);
    });
    mc.appendChild(ul);
    mc.appendChild(el('p', 'fam-note', F.isOwner
      ? '관리자는 멤버를 내보내고 코드를 바꿀 수 있어요. 휴대폰을 잃어버렸다면 그 기기를 내보내세요.'
      : '멤버 관리는 관리자만 할 수 있어요. 관리자가 ' + F.INACTIVE_DAYS + '일 넘게 안 쓰면 다른 가족에게 자동으로 넘어가요.'));
    body.appendChild(mc);

    var name = nameField();
    name.input.addEventListener('change', function () {
      var n = name.input.value.trim();
      rememberName(n);
      F.setName(n).then(function () { ui.toast('이름을 바꿨어요'); }, function (e) { ui.toast(errorText(e)); });
    });
    body.appendChild(name.wrap);

    var leaveBtn = button('가족 공유 그만하기', 'danger block', function () {
      if (!F.state.members.length || store.status === 'connecting') {
        ui.toast('가족 정보를 불러오는 중이에요. 잠시 후 다시 해 주세요');
        return;
      }
      var msg = '이 기기에서 가족 공유를 끌까요?\n지금 보이는 재료는 이 기기에 복사해 둘게요.';
      if (F.isOwner && F.state.members.length > 1) msg += '\n관리자는 다른 가족에게 넘어가요.';
      if (F.state.members.length <= 1) msg += '\n마지막 멤버라서 가족 냉장고의 온라인 데이터는 삭제돼요.';
      if (!window.confirm(msg)) return;
      busy(leaveBtn, F.leave(), '나가는 중…').then(function () {
        ui.toast('가족 공유를 껐어요');
        renderPanel();
        renderStatus();
      }, function (e) { ui.toast(errorText(e)); });
    });
    body.appendChild(leaveBtn);
  }

  function renderFileMode(body) {
    body.appendChild(el('h3', 'fam-title', '앱 주소에서 열어 주세요'));
    body.appendChild(el('p', 'fam-text',
      '지금은 PC에서 파일(index.html)을 직접 연 상태예요. 가족 공유는 보안 로그인이 필요해서 ' +
      '앱 주소(https://…github.io)로 열거나 설치한 앱에서만 쓸 수 있어요. 혼자 쓰기 기능은 그대로 쓸 수 있어요.'));
  }

  function renderPanel() {
    var body = els.body;
    body.textContent = '';
    if (!F.configured) renderSetupGuide(body);
    else if (F.fileMode) renderFileMode(body);
    else if (!F.info) renderJoinForm(body);
    else renderJoined(body);
    if (Fridge.backup) Fridge.backup.renderSection(body);
  }

  /* ---------- 열기 / 닫기 ---------- */

  function open() {
    renderPanel();
    els.panel.hidden = false;
    els.panel.scrollTop = 0;
    requestAnimationFrame(function () { els.panel.classList.add('show'); });
    document.body.classList.add('no-scroll');
    ui.openOverlay('family', hide);
  }

  function hide() {
    els.panel.classList.remove('show');
    ui.unlockScroll();
    setTimeout(function () {
      if (!els.panel.classList.contains('show')) els.panel.hidden = true;
    }, 220);
  }

  els.btn.addEventListener('click', open);
  els.back.addEventListener('click', function () { ui.closeOverlay('family'); });
  els.line.addEventListener('click', open);

  store.onStatus(function (s, detail) {
    if (s === 'error' && detail) console.warn('[가족 공유]', detail);
    renderStatus();
    ui.render();
  });

  F.onChange(renderStatus);
  F.onBecameOwner = function () {
    ui.toast('관리자가 오래 접속하지 않아 내가 관리자가 됐어요');
  };
  F.onRemoved = function () {
    ui.toast('가족 냉장고에서 나가졌어요. 이제 이 기기에만 저장돼요');
    renderStatus();
  };

  renderStatus();
  F.start();
})(window.Fridge = window.Fridge || {});
