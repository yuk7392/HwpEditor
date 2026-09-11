/* ★ 패널은 도구줄 안에 두지 않는다. 도구줄은 mousedown 기본 동작을 막아 캐럿 초점을 지키는데
     (hwUi.onMouseDown), 찾기 칸은 반대로 <b>초점을 가져가야</b> 글자를 받는다.
   ★ 그래도 친 글자가 문서로 새지 않는다 — 본문 키 처리는 #hwIme 에 걸려 있어서(hwInput.init),
     초점이 찾기 칸에 있는 동안에는 아예 안 불린다. 구조가 이미 보장하는 성질이다.
   ★ 순회는 hwModel.allParas() 다 — 표 칸 안까지 저장 차례대로 담긴다. 개체 자리는 U+FFFC 라
     찾는 말과 절대 안 맞는다. 그래서 일치 구간이 개체를 가로지를 수 없고, 안 보이는 컨트롤
     (용지 정의·단 정의)이 바꾸기에 훼손될 일도 없다. */

var hwFind = (function () {
  'use strict';

  var cPanel, cText, cRepl, cReplRow, cCase, cInfo;
  var cGoto, cGotoPage, cGotoInfo;

  function el(id) { return document.getElementById(id); }

  function init() {
    cPanel = el('hwFind');
    if (!cPanel) return;

    cText = el('hwFindText');
    cRepl = el('hwReplText');
    cReplRow = el('hwReplRow');
    cCase = el('hwFindCase');
    cInfo = el('hwFindInfo');

    cPanel.addEventListener('click', onClick);
    cPanel.addEventListener('keydown', onKey);

    cGoto = el('hwGoto');
    cGotoPage = el('hwGotoPage');
    cGotoInfo = el('hwGotoInfo');
    if (cGoto) {
      cGoto.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('button') : null;
        if (!btn) return;
        if (btn.getAttribute('data-goto') === 'go') goFromInput();
        else closeGoto();
      });
      cGoto.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { e.preventDefault(); closeGoto(); }
        else if (e.key === 'Enter') { e.preventDefault(); goFromInput(); }
      });
    }
  }

  function open(withReplace) {
    if (!cPanel) return;
    if (cGoto) cGoto.hidden = true;     /* 같은 자리에 뜨는 창이라 하나만 연다 */
    cPanel.hidden = false;
    if (cReplRow) cReplRow.hidden = !withReplace;

    /* 고른 글이 있으면 그것을 찾을 말로 넣어 준다 — 한글도 그렇게 한다. */
    var sel = hwCaret.selection();
    if (sel && sel.fromId === sel.toId) {
      var p = hwModel.byId(sel.fromId);
      var s = p ? hwModel.text(p).slice(sel.fromPos, sel.toPos) : '';
      if (s && s.indexOf('￼') < 0 && s.indexOf('\n') < 0) cText.value = s;
    }

    cText.focus();
    cText.select();
    info('');
  }

  function close() {
    if (!cPanel) return;
    cPanel.hidden = true;
    hwInput.focus();
  }

  function info(t) { if (cInfo) cInfo.textContent = t || ''; }

  function onClick(e) {
    var btn = e.target.closest ? e.target.closest('button') : null;
    if (!btn) return;

    switch (btn.getAttribute('data-find')) {
      case 'next': search(+1); break;
      case 'prev': search(-1); break;
      case 'one': replaceOne(); break;
      case 'all': replaceAll(); break;
      case 'close': close(); break;
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.target === cRepl) replaceOne();
      else search(e.shiftKey ? -1 : +1);
    }
  }

  function needle() { return cText ? (cText.value || '') : ''; }

  /* ★ 대소문자를 무시할 때도 <b>길이를 지킨다</b>. 접은 문자열에서 찾은 자리를 원본 문자열에
     그대로 쓰기 때문이다 — toLowerCase 가 한 글자를 두 글자로 바꾸는 글자(U+0130 İ)가 앞에 있으면
     그 뒤 일치 위치가 통째로 밀려 엉뚱한 구간이 지워진다. 길이가 변하는 글자는 접지 않는다. */
  function fold(s) {
    if (cCase && cCase.checked) return s;

    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i), l = c.toLowerCase();
      out += (l.length === 1) ? l : c;
    }
    return out;
  }

  function search(dir) {
    var q = fold(needle());
    if (!q) { info('찾을 말을 넣으세요'); return false; }
    if (!hwDoc) return false;

    /* 개체를 고른 채로 찾으면 캐럿이 안 그려진다 — 먼저 푼다. */
    if (window.hwObj) hwObj.clear();

    var all = hwModel.allParas();
    if (!all.length) return false;

    /* ★ 시작 자리는 문단과 오프셋을 <b>같은 끝</b>에서 잡는다 — 선택이 있으면 앞으로 찾을 때는 선택의
       뒤끝, 뒤로 찾을 때는 앞끝이다. 캐럿 문단(움직인 끝)에 선택 앞끝 오프셋을 붙이면, 여러 문단에 걸친
       선택에서 뒷문단의 엉뚱한 자리부터 거꾸로 찾는다. */
    var sel = hwCaret.selection(), at = hwCaret.at();
    var base = !sel ? { id: at.id, pos: at.pos }
             : dir > 0 ? { id: sel.toId, pos: sel.toPos } : { id: sel.fromId, pos: sel.fromPos };

    var idx = 0;
    for (var i = 0; i < all.length; i++) if (all[i].id === base.id) { idx = i; break; }
    var start = base.pos;

    /* 한 바퀴 돈다. n === 0 인 문단만 캐럿 자리부터, 나머지는 처음(또는 끝)부터 본다. */
    for (var n = 0; n <= all.length; n++) {
      var k = dir > 0
        ? (idx + n) % all.length
        : ((idx - n) % all.length + all.length) % all.length;

      var p = all[k];
      var t = fold(hwModel.text(p));
      var hit;

      if (dir > 0) {
        hit = t.indexOf(q, n === 0 ? start : 0);
      } else {
        /* ★ 뒤로 찾을 때 자를 자리가 음수면 그 문단은 통째로 건너뛴다. lastIndexOf 는 음수
           fromIndex 를 0 으로 보고 <b>0번 자리 일치를 그대로 돌려주므로</b>, 문단 머리에서 찾은
           뒤 다시 ◀ 를 누르면 같은 자리를 영영 다시 고른다. */
        var from = (n === 0 ? start : t.length) - q.length;
        hit = from < 0 ? -1 : t.lastIndexOf(q, from);
      }

      if (hit >= 0) {
        hwCaret.set(p.id, hit, false);
        hwCaret.set(p.id, hit + q.length, true);
        hwCaret.scrollIntoView();
        info('');
        return true;
      }
    }

    info('찾는 말이 없습니다');
    return false;
  }

  /* 다시 찾기(Ctrl+Q→L) — 마지막 찾을 말로 다음을 찾는다. 찾기 창이 닫혀 있어도 된다(찾을 말 칸은 닫혀도
     값을 들고 있다). 찾을 말이 없으면 찾기 창을 연다. */
  function repeat() {
    if (!needle()) { open(false); return false; }
    var found = search(+1);
    if (!found && !isOpen()) hwSetStatus({ text: '"' + needle() + '" 을(를) 찾지 못했습니다' });
    return found;
  }

  function isOpen() { return !!cPanel && !cPanel.hidden; }

  function openGoto() {
    if (!cGoto || !hwDoc) return;
    if (cPanel) cPanel.hidden = true;
    cGoto.hidden = false;
    var c = hwCaret.coord(hwCaret.at().id, hwCaret.at().pos);
    cGotoPage.max = String(hwPageCount());
    cGotoPage.value = String(c ? c.pageIdx + 1 : 1);
    if (cGotoInfo) cGotoInfo.textContent = '/ ' + hwPageCount() + '쪽';
    cGotoPage.focus();
    cGotoPage.select();
  }

  function closeGoto() {
    if (!cGoto) return;
    cGoto.hidden = true;
    hwInput.focus();
  }

  function goFromInput() {
    if (gotoPage(parseInt(cGotoPage.value, 10))) closeGoto();
  }

  /* n 쪽(1부터)의 첫 줄 머리로 캐럿을 옮긴다. 없는 쪽이면 false. */
  function gotoPage(n) {
    if (!hwDoc || !(n >= 1 && n <= hwPageCount())) {
      if (cGotoInfo) cGotoInfo.textContent = '1~' + hwPageCount() + '쪽 사이로 넣으세요';
      return false;
    }
    var lines = hwPages[n - 1].lines;
    if (!lines.length) return false;
    if (window.hwObj) hwObj.clear();
    hwCaret.set(lines[0].para.id, lines[0].line.s, false);
    hwCaret.scrollIntoView();
    return true;
  }

  /* 지금 고른 것이 찾는 말이면 바꾸고, 아니면 먼저 찾는다(한글과 같은 차례다). */
  function replaceOne() {
    var q = needle();
    if (!q) { info('찾을 말을 넣으세요'); return; }

    var sel = hwCaret.selection();
    if (!sel || sel.fromId !== sel.toId) { search(+1); return; }

    var p = hwModel.byId(sel.fromId);
    if (!p) { search(+1); return; }

    var cur = hwModel.text(p).slice(sel.fromPos, sel.toPos);
    if (fold(cur) !== fold(q)) { search(+1); return; }

    var to = cRepl ? (cRepl.value || '') : '';
    var from = sel.fromPos, end = sel.toPos;

    hwInput.run(function () {
      /* 글자모양은 지운 자리 첫 글자의 것을 이어 쓴다 — 붙여넣기가 이미 그 규칙이다. */
      var cs = hwModel.shapeAt(p, from);
      hwModel.deleteRange(p, from, end);
      if (to) hwModel.insertText(p, from, to, cs);
      hwCaret.set(p.id, from + to.length, false);
      return null;
    }, null);

    search(+1);
  }

  function replaceAll() {
    var q = fold(needle());
    if (!q) { info('찾을 말을 넣으세요'); return; }

    var to = cRepl ? (cRepl.value || '') : '';
    var all = hwModel.allParas();

    /* ★ 바꾸기 전에 대상을 <b>전부</b> 찾아 둔다. 그래야 그 문단들을 되돌리기 스냅샷에 같이 담을 수
       있다 — hwInput 이 기본으로 쓰는 affected() 는 캐럿 선택에서 목록을 내므로, 그것만 믿으면
       캐럿 밖 문단의 고침이 스냅샷에 안 들어가 Ctrl+Z 가 <b>반만</b> 되돌린다. 되돌아오지 않은
       문단은 dirty 로 남아 저장 요청에 실린다 — 화면과 파일이 갈라지는데 아무 신호가 없다. */
    var jobs = [], ids = [], total = 0;
    for (var i = 0; i < all.length; i++) {
      var t = fold(hwModel.text(all[i]));
      var hits = [], k = t.indexOf(q);
      while (k >= 0) { hits.push(k); k = t.indexOf(q, k + q.length); }
      if (!hits.length) continue;
      jobs.push({ p: all[i], hits: hits });
      ids.push(all[i].id);
      total += hits.length;
    }

    if (!total) { info('찾는 말이 없습니다'); return; }

    hwInput.run(function () {
      for (var j = 0; j < jobs.length; j++) {
        var p = jobs[j].p, hits = jobs[j].hits;
        /* ★ 뒤에서 앞으로 고친다. 앞에서부터 하면 길이가 달라진 만큼 뒤 자리가 밀린다. */
        for (var h = hits.length - 1; h >= 0; h--) {
          var cs = hwModel.shapeAt(p, hits[h]);
          hwModel.deleteRange(p, hits[h], hits[h] + q.length);
          if (to) hwModel.insertText(p, hits[h], to, cs);
        }
      }

      /* ★ 바꾼 자리로 캐럿을 접는다. 안 접으면 <b>찾기 때 잡아 둔 선택 범위</b>가 숫자 그대로
         남는데 그 문단의 글자는 방금 바뀌었다 — 그 뒤 아무 글자나 치면 사용자가 고른 적 없는
         구간이 지워진다.
         ★ 기준은 그 문단의 <b>맨 앞 일치</b>다. 뒤에서 앞으로 바꿨으므로 hits[0] 앞은 아직
         한 글자도 안 바뀌어 그 자리가 그대로다 — 뒤쪽 일치를 기준으로 잡으면 앞에서 늘거나 준
         길이만큼(일치 수 × 길이차) 어긋난 자리에 캐럿이 선다. */
      var last = jobs[jobs.length - 1];
      hwCaret.set(last.p.id, last.hits[0] + to.length, false);
      return null;
    }, null, ids);

    info(total + '군데를 바꿨습니다');
  }

  return {
    init: init,
    open: open,
    close: close,
    search: search,
    replaceOne: replaceOne,
    replaceAll: replaceAll,
    repeat: repeat,
    openGoto: openGoto,
    closeGoto: closeGoto,
    gotoPage: gotoPage,
    isOpen: isOpen,
    isGotoOpen: function () { return !!cGoto && !cGoto.hidden; }
  };
})();
