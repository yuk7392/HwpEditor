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
  var cDir, cWidth, cWord, cPunct, cSpace;
  var cGoto, cGotoPage, cGotoInfo, cGotoMark;

  /* 모두 강조한 자리 [{id, s, e}]. 창을 닫아도·캐럿을 옮겨도 남고 본문을 고치면 지운다(hwInput.edit·hwUndo). */
  var cHits = [];

  function el(id) { return document.getElementById(id); }

  function init() {
    cPanel = el('hwFind');
    if (!cPanel) return;

    cText = el('hwFindText');
    cRepl = el('hwReplText');
    cReplRow = el('hwReplRow');
    cCase = el('hwFindCase');
    cInfo = el('hwFindInfo');
    cDir = el('hwFindDir');
    cWidth = el('hwFindWidth');
    cWord = el('hwFindWord');
    cPunct = el('hwFindPunct');
    cSpace = el('hwFindSpace');

    cPanel.addEventListener('click', onClick);
    cPanel.addEventListener('keydown', onKey);

    cGoto = el('hwGoto');
    cGotoPage = el('hwGotoPage');
    cGotoInfo = el('hwGotoInfo');
    cGotoMark = el('hwGotoMark');
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
      case 'mark': markAll(); break;
      case 'unmark': clearHits(); info(''); break;
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

  function on(box) { return !!(box && box.checked); }

  /* 비교용 문자열과 <b>원문 위치 대응표</b>. 공백·문장 부호를 빼면 길이가 달라지므로, 접은 문자열의 k 번째가
     원문 몇 번째인지(map[k])를 들고 다닌다 — 일치 구간은 늘 원문 좌표로 돌려준다.
     ★ 대소문자·전각을 접을 때는 <b>한 글자를 한 글자로</b>만 바꾼다. toLowerCase 가 두 글자로 늘리는 글자(U+0130 İ)를
       접으면 대응표가 어긋나 엉뚱한 구간이 지워진다. 그런 글자는 접지 않는다.
     ★ 개체 자리(U+FFFC)는 문장 부호도 공백도 아니라 빠지지 않는다 — 일치 구간이 개체를 가로지를 수 없다. */
  var cPunctRe = /[\p{P}]/u, cSpaceRe = /\s/, cWordRe = /[\p{L}\p{N}_]/u;

  function norm(s) {
    var t = '', map = [];
    var keepCase = on(cCase), keepWidth = on(cWidth), noPunct = on(cPunct), noSpace = on(cSpace);
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (noSpace && cSpaceRe.test(c)) continue;
      if (noPunct && cPunctRe.test(c)) continue;
      if (!keepWidth) {
        var u = c.charCodeAt(0);
        if (u >= 0xFF01 && u <= 0xFF5E) c = String.fromCharCode(u - 0xFEE0);
        else if (u === 0x3000) c = ' ';
      }
      if (!keepCase) { var l = c.toLowerCase(); if (l.length === 1) c = l; }
      t += c;
      map.push(i);
    }
    return { t: t, map: map };
  }

  function isWordAt(s, i) { return i >= 0 && i < s.length && cWordRe.test(s.charAt(i)); }

  /* 문단 하나에서 찾는다. dir>0 이면 원문 start 이후에 시작하는 첫 일치, dir<0 이면 start 이전에 끝나는 마지막 일치.
     start 가 null 이면 문단 전체. 돌려주는 값은 원문 좌표 {s, e}. */
  function findIn(p, q, dir, start) {
    var raw = hwModel.text(p), n = norm(raw), t = n.t, map = n.map, L = q.length;
    var word = on(cWord);

    function range(k) { return { s: map[k], e: map[k + L - 1] + 1 }; }
    function okWord(r) { return !word || (!isWordAt(raw, r.s - 1) && !isWordAt(raw, r.e)); }

    if (dir > 0) {
      var k0 = 0;
      if (start !== null) while (k0 < map.length && map[k0] < start) k0++;
      for (var k = t.indexOf(q, k0); k >= 0; k = t.indexOf(q, k + 1)) {
        var r = range(k);
        if (okWord(r)) return r;
      }
      return null;
    }

    /* ★ 뒤로 찾을 때 자를 자리가 음수면 그 문단은 통째로 건너뛴다. lastIndexOf 는 음수 fromIndex 를 0 으로 보고
       <b>0번 자리 일치를 그대로 돌려주므로</b>, 문단 머리에서 찾은 뒤 다시 ◀ 를 누르면 같은 자리를 영영 다시 고른다. */
    var cnt = map.length;
    if (start !== null) { cnt = 0; while (cnt < map.length && map[cnt] < start) cnt++; }
    for (var b = cnt - L; b >= 0; b--) {
      b = t.lastIndexOf(q, b);
      if (b < 0) break;
      var rb = range(b);
      if (okWord(rb)) return rb;
    }
    return null;
  }

  /* 문단 하나의 모든 일치(원문 좌표, 앞에서부터). */
  function allIn(p, q) {
    var out = [], from = 0, r;
    while ((r = findIn(p, q, +1, from)) !== null) { out.push(r); from = r.e; }
    return out;
  }

  /* ▶·Enter 는 찾을 방향(아래쪽·문서 전체는 앞으로, 위쪽은 뒤로), ◀ 는 그 반대다. 한 바퀴 도는 것은 "문서 전체" 뿐. */
  function search(dir) {
    var q = norm(needle()).t;
    if (!q) { info('찾을 말을 넣으세요'); return false; }
    if (!hwDoc) return false;

    var mode = cDir ? cDir.value : 'all';
    if (mode === 'up') dir = -dir;
    var wrap = mode === 'all';

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

    for (var n = 0; n <= all.length; n++) {
      var k = idx + (dir > 0 ? n : -n);
      if (!wrap && (k < 0 || k >= all.length)) break;
      k = ((k % all.length) + all.length) % all.length;

      var p = all[k];
      var hit = findIn(p, q, dir, n === 0 ? base.pos : null);
      if (hit) {
        hwCaret.set(p.id, hit.s, false);
        hwCaret.set(p.id, hit.e, true);
        hwCaret.scrollIntoView();
        info('');
        return true;
      }
    }

    info(wrap ? '찾는 말이 없습니다' : (dir > 0 ? '문서 끝까지 찾았습니다' : '문서 처음까지 찾았습니다'));
    return false;
  }

  function markAll() {
    var q = norm(needle()).t;
    if (!q) { info('찾을 말을 넣으세요'); return 0; }
    if (!hwDoc) return 0;

    cHits = [];
    var all = hwModel.allParas();
    for (var i = 0; i < all.length; i++) {
      var rs = allIn(all[i], q);
      for (var j = 0; j < rs.length; j++) cHits.push({ id: all[i].id, s: rs[j].s, e: rs[j].e });
    }
    paintHits();
    info(cHits.length ? cHits.length + '개 항목이 강조 표시되었습니다.' : '찾는 말이 없습니다');
    return cHits.length;
  }

  function clearHits() {
    cHits = [];
    var olds = document.querySelectorAll('.hw-hit');
    for (var i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i]);
  }

  /* hwCaret.paint 가 부른다 — 가상 스크롤이 쪽을 다시 채울 때마다 지나는 자리라 따로 걸면 스크롤 뒤에 강조가 사라진다.
     ★ 강조가 없을 때는 곧바로 빠진다 — 이 함수는 캐럿을 옮길 때마다 불리므로 빈 DOM 질의도 얹으면 안 된다. */
  var cPainted = 0;

  function paintHits() {
    if (!cHits.length && !cPainted) return;
    cPainted = cHits.length;
    var olds = document.querySelectorAll('.hw-hit');
    for (var i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i]);
    for (var h = 0; h < cHits.length; h++) {
      var p = hwModel.byId(cHits[h].id);
      if (p) hwCaret.paintRange(p, cHits[h].s, cHits[h].e, 'hw-hit');
    }
  }

  function resetOptions() {
    if (cDir) cDir.value = 'all';
    var boxes = [cCase, cWidth, cWord, cPunct, cSpace];
    for (var i = 0; i < boxes.length; i++) if (boxes[i]) boxes[i].checked = false;
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
    fillMarks();
    if (cGotoInfo) cGotoInfo.textContent = '/ ' + hwPageCount() + '쪽';
    cGotoPage.focus();
    cGotoPage.select();
  }

  function closeGoto() {
    if (!cGoto) return;
    cGoto.hidden = true;
    hwInput.focus();
  }

  /* 책갈피 목록. ★ 이름 없는 책갈피도 있다(hwp 는 이름을 컨트롤 데이터에 두고, 못 읽으면 빈 값이다). */
  function fillMarks() {
    if (!cGotoMark) return;
    var marks = window.hwLink ? hwLink.marks() : [];
    cGotoMark.innerHTML = '';
    var none = document.createElement('option');
    none.value = '';
    none.textContent = marks.length ? '(고르지 않음)' : '(없음)';
    cGotoMark.appendChild(none);

    for (var i = 0; i < marks.length; i++) {
      var op = document.createElement('option');
      op.value = String(i);
      op.textContent = marks[i].name || ('책갈피 ' + (i + 1));
      cGotoMark.appendChild(op);
    }
    cGotoMark.disabled = !marks.length;
  }

  /* 책갈피를 골랐으면 그쪽이 먼저다 — 쪽 번호는 늘 값이 들어 있어서 판정이 안 된다. */
  function goFromInput() {
    if (cGotoMark && cGotoMark.value !== '') {
      var marks = window.hwLink ? hwLink.marks() : [];
      var m = marks[parseInt(cGotoMark.value, 10)];
      if (m) {
        if (window.hwObj) hwObj.clear();
        hwCaret.set(m.id, m.pos, false);
        hwCaret.scrollIntoView();
        closeGoto();
        return;
      }
    }
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
    if (norm(cur).t !== norm(q).t) { search(+1); return; }

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
    var q = norm(needle()).t;
    if (!q) { info('찾을 말을 넣으세요'); return; }

    var to = cRepl ? (cRepl.value || '') : '';
    var all = hwModel.allParas();

    /* ★ 바꾸기 전에 대상을 <b>전부</b> 찾아 둔다. 그래야 그 문단들을 되돌리기 스냅샷에 같이 담을 수
       있다 — hwInput 이 기본으로 쓰는 affected() 는 캐럿 선택에서 목록을 내므로, 그것만 믿으면
       캐럿 밖 문단의 고침이 스냅샷에 안 들어가 Ctrl+Z 가 <b>반만</b> 되돌린다. 되돌아오지 않은
       문단은 dirty 로 남아 저장 요청에 실린다 — 화면과 파일이 갈라지는데 아무 신호가 없다. */
    var jobs = [], ids = [], total = 0;
    for (var i = 0; i < all.length; i++) {
      var hits = allIn(all[i], q);
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
          var cs = hwModel.shapeAt(p, hits[h].s);
          hwModel.deleteRange(p, hits[h].s, hits[h].e);
          if (to) hwModel.insertText(p, hits[h].s, to, cs);
        }
      }

      /* ★ 바꾼 자리로 캐럿을 접는다. 안 접으면 <b>찾기 때 잡아 둔 선택 범위</b>가 숫자 그대로
         남는데 그 문단의 글자는 방금 바뀌었다 — 그 뒤 아무 글자나 치면 사용자가 고른 적 없는
         구간이 지워진다.
         ★ 기준은 그 문단의 <b>맨 앞 일치</b>다. 뒤에서 앞으로 바꿨으므로 hits[0] 앞은 아직
         한 글자도 안 바뀌어 그 자리가 그대로다 — 뒤쪽 일치를 기준으로 잡으면 앞에서 늘거나 준
         길이만큼(일치 수 × 길이차) 어긋난 자리에 캐럿이 선다. */
      var last = jobs[jobs.length - 1];
      hwCaret.set(last.p.id, last.hits[0].s + to.length, false);
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
    fillMarks: fillMarks,
    markCount: function () { return cGotoMark ? cGotoMark.options.length - 1 : 0; },
    isOpen: isOpen,
    isGotoOpen: function () { return !!cGoto && !cGoto.hidden; },
    markAll: markAll,
    clearHits: clearHits,
    paintHits: paintHits,
    hitCount: function () { return cHits.length; },
    resetOptions: resetOptions
  };
})();
