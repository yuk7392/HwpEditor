/* 키보드·마우스·IME.

   ★ 본문은 contenteditable 이 아니다. 화면 밖에 숨긴 contenteditable div 하나가 IME 수신기이고,
     본문은 우리가 계산한 배치를 그린 그림이다(계획 G-4). 본문을 편집 가능하게 두면 브라우저가
     제 나름대로 줄을 다시 흐르게 만들어서 우리 배치와 화면이 갈라진다.
   ★ 조합 중에는 <b>모델을 건드리지 않는다</b>. 임시 span 하나만 캐럿 자리에 띄우고,
     compositionend 에서 한 번에 모델에 넣는다. 조합 중에 모델을 고치면 그 문단이 다시 배치되면서
     조합이 끊긴다.
   ★ 숨긴 수신기는 캐럿 옆에 둔다 — 화면 구석에 두면 한글 후보 창이 문서 밖에 뜬다. */

var hwInput = (function () {
  'use strict';

  var cIme = null;
  var cComposing = false;
  var cCompEl = null;
  var cDragging = false;

  function init() {
    cIme = document.getElementById('hwIme');
    if (!cIme) return;

    cIme.addEventListener('keydown', onKeyDown);
    cIme.addEventListener('input', onInput);
    cIme.addEventListener('compositionstart', onCompStart);
    cIme.addEventListener('compositionupdate', onCompUpdate);
    cIme.addEventListener('compositionend', onCompEnd);

    document.addEventListener('paste', onPaste);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);

    var canvas = document.getElementById('hwCanvas');
    if (canvas) {
      canvas.addEventListener('mousedown', onMouseDown);
      canvas.addEventListener('mousemove', onMouseMove);
      canvas.addEventListener('dblclick', onDoubleClick);
    }
    /* ★ 개체 끌기는 <b>문서</b>에서 받는다. 캔버스에만 걸면 끌다가 도구줄·상태줄 위로 나갔을 때
       움직임도 놓는 것도 안 오고, 개체가 마지막 자리에 붙은 채 끌기 상태로 남는다. */
    document.addEventListener('mousemove', function (e) {
      if (window.hwObj && hwObj.dragging()) hwObj.onMove(e);
    });
    document.addEventListener('mouseup', function () {
      cDragging = false;
      if (window.hwObj) hwObj.endDrag();
    });

    focus();
  }

  function focus() {
    if (cIme) cIme.focus({ preventScroll: true });
  }

  /* ── 편집 한 동작 ─────────────────────────────────────
     ★ 되돌리기 기록 → 고치기 → 다시 배치 → 캐럿 을 <b>한 묶음</b>으로 돈다.
       중간에 배치를 빼먹으면 캐럿이 옛 좌표를 보고 엉뚱한 자리에 선다. */
  function edit(fn, coalesceKey, pIds) {
    if (!hwDoc) return;

    /* ★ 여러 문단을 한꺼번에 고치는 동작(모두 바꾸기)은 <b>고칠 문단을 직접</b> 준다.
       affected() 는 캐럿 선택에서 목록을 내므로, 그것만 믿으면 캐럿 밖 문단의 고침이
       되돌리기 스냅샷에 안 들어가 Ctrl+Z 가 반만 되돌린다. */
    var ids = (pIds && pIds.length) ? pIds : affected();
    hwUndo.begin(ids);
    var made = fn() || [];
    hwUndo.commit(made, coalesceKey);

    hwRelayout();
    hwCaret.scrollIntoView();
    hwCaret.paint();
    status();
  }

  /* 이번 편집이 건드릴 수 있는 문단들. 이웃까지 담는다 — 나누기·합치기가 이웃을 고친다. */
  function affected() {
    var ids = [];
    var sel = hwCaret.selection();

    if (sel) {
      var from = hwModel.orderOf(sel.fromId), to = hwModel.orderOf(sel.toId);
      var all = hwModel.allParas();
      for (var i = 0; i < all.length; i++) {
        var ord = hwModel.orderOf(all[i].id);
        if (ord >= from && ord <= to) ids.push(all[i].id);
      }
    } else {
      ids.push(hwCaret.at().id);
    }
    if (!ids.length) return ids;

    var head = hwModel.byId(ids[0]);
    var prev = head ? hwModel.before(head) : null;
    if (prev) ids.unshift(prev.id);

    var tail = hwModel.byId(ids[ids.length - 1]);
    var next = tail ? hwModel.after(tail) : null;
    if (next) ids.push(next.id);

    return ids;
  }

  function status() {
    var n = hwModel.dirtyCount();
    /* ★ 고친 개수를 C# 에도 밀어 준다 — 창을 닫을 때 물어보려면 미리 와 있어야 한다. */
    if (window.hwPostDirty) hwPostDirty();
    hwSetStatus({
      text: (hwDoc.path || '새 문서') + ' — ' + hwPageCount() + '쪽'
          + (n ? ' · 고친 문단 ' + n + '개(저장 안 됨)' : '')
    });
  }

  /* ── 글자 넣기·지우기 ─────────────────────────────────── */

  function typeText(str) {
    if (!str) return;
    /* 글자를 치면 개체 고르기는 푼다 — 개체를 고른 채로 글자가 들어가면 그 자리에 캐럿이 없어
       무엇을 고쳤는지 화면에 안 보인다. */
    if (window.hwObj) hwObj.clear();
    edit(function () {
      dropSelection();
      var p = hwCaret.para();
      if (!p) return null;

      var pos = hwCaret.at().pos;
      var cs = hwFormat.shapeForTyping(p, pos);
      hwModel.insertText(p, pos, str, cs);
      hwCaret.set(p.id, pos + str.length, false);
      hwFormat.advancePending(p, pos + str.length);
      return null;
    }, 'type:' + hwCaret.at().id);
  }

  /* 선택이 있으면 지운다. ★ edit() 안에서만 부른다 — 되돌리기 한 칸에 같이 들어가야 한다. */
  function dropSelection() {
    var sel = hwCaret.selection();
    if (!sel) return false;

    var fromP = hwModel.byId(sel.fromId), toP = hwModel.byId(sel.toId);
    if (!fromP || !toP) return false;

    if (fromP === toP) {
      var gone = hwModel.deleteRange(fromP, sel.fromPos, sel.toPos);
      /* 안 지워지고 남은 컨트롤이 있으면 캐럿을 그 뒤로 보낸다 — 앞에 두면 이어 친 글자가
         구역 정의 앞으로 들어간다. */
      var kept = (sel.toPos - sel.fromPos) - gone;
      hwCaret.set(fromP.id, sel.fromPos + kept, false);
      return true;
    }

    var from = hwModel.orderOf(sel.fromId), to = hwModel.orderOf(sel.toId);
    var mid = [];
    var all = hwModel.allParas();
    for (var i = 0; i < all.length; i++) {
      var ord = hwModel.orderOf(all[i].id);
      if (ord > from && ord < to) mid.push(all[i]);
    }

    hwModel.deleteRange(fromP, sel.fromPos, fromP.len);

    /* ★ 지금 재야 한다. 아래에서 뒤 문단을 이어 붙이면 len 이 늘어나 이 값을 못 낸다.
       지워지지 않고 남은 컨트롤 수만큼 캐럿을 뒤로 보내야 이어 친 글자가 그 앞에 안 들어간다. */
    var keptHead = Math.max(0, fromP.len - sel.fromPos);

    hwModel.deleteRange(toP, 0, sel.toPos);

    /* ★ 가운데 문단이라고 무조건 없애면 안 된다. 구역·단 정의를 달고 있는 문단(구역의 첫 문단)을
       없애면 그 구역의 용지 정의가 파일에서 사라지고, 구역에 문단이 하나뿐이면 문서가 깨진다.
       그런 문단은 <b>내용만 비운다</b> — 지워지지 않는 컨트롤은 deleteRange 가 지켜 준다. */
    for (var m = 0; m < mid.length; m++) {
      var mp = mid[m];
      if (hasHidden(mp) || hwModel.listOf(mp).length <= 1) hwModel.deleteRange(mp, 0, mp.len);
      else hwModel.removePara(mp);
    }

    /* 가운데가 통째로 없어졌을 때만 앞뒤를 잇는다. 비워 둔 문단이 남았으면 그것이 경계다. */
    if (hwModel.after(fromP) === toP && toP._sec === fromP._sec) hwModel.mergeNext(fromP);

    hwCaret.set(fromP.id, sel.fromPos + keptHead, false);
    return true;
  }

  /* 화면에 안 보이지만 지우면 안 되는 컨트롤을 달고 있는가. */
  function hasHidden(para) {
    for (var i = 0; i < (para.objs || []).length; i++) if (para.objs[i].hidden) return true;
    return false;
  }

  function backspace() {
    edit(function () {
      if (dropSelection()) return null;

      var p = hwCaret.para();
      var pos = hwCaret.at().pos;
      if (!p) return null;

      if (pos > 0) {
        /* 안 지워지는 자리가 있다 — 화면에 없는 컨트롤(용지·단 정의)은 지우지 말고 지나만 간다.
           지웠든 지나갔든 캐럿은 한 칸 왼쪽이다. */
        hwModel.deleteRange(p, pos - 1, pos);
        hwCaret.set(p.id, pos - 1, false);
        return null;
      }

      var prev = hwModel.before(p);
      if (!prev || prev._sec !== p._sec) return null;

      var at = prev.len;
      hwModel.mergeNext(prev);
      hwCaret.set(prev.id, at, false);
      return null;
    });
  }

  function del() {
    edit(function () {
      if (dropSelection()) return null;

      var p = hwCaret.para();
      var pos = hwCaret.at().pos;
      if (!p) return null;

      if (pos < p.len) {
        var gone = hwModel.deleteRange(p, pos, pos + 1);
        if (gone === 0) hwCaret.set(p.id, pos + 1, false);
        return null;
      }

      var next = hwModel.after(p);
      if (!next || next._sec !== p._sec) return null;
      hwModel.mergeNext(p);
      return null;
    });
  }

  function enter() {
    edit(function () {
      dropSelection();
      var p = hwCaret.para();
      if (!p) return null;

      var np = hwModel.splitPara(p, hwCaret.at().pos);
      hwCaret.set(np.id, 0, false);
      return [np.id];
    });
  }

  /* ── 그림 넣기(3단계) ─────────────────────────────────── */

  function insertImage(info) {
    if (!hwDoc || !info || !info.file) return;

    edit(function () {
      dropSelection();
      var p = hwCaret.para();
      if (!p) return null;

      var pos = hwCaret.at().pos;
      var o = {
        pos: pos,
        tmpId: hwModel.newTmpId(),
        file: info.file,
        kind: 'image',
        src: info.src || null,
        wHu: info.wHu || 20000,
        hHu: info.hHu || 15000,
        inline: true
      };
      hwModel.insertObj(p, pos, o);
      hwCaret.set(p.id, pos + 1, false);
      return null;
    });
  }

  /* ── 키 ──────────────────────────────────────────────── */

  function onKeyDown(e) {
    if (!hwDoc) return;
    if (e.isComposing || cComposing) return;   /* 조합 중에는 IME 가 키를 가져간다 */

    var ctrl = e.ctrlKey || e.metaKey;
    var shift = e.shiftKey;

    /* ★ 개체를 골랐으면 방향키·Delete·Esc 가 <b>개체</b>의 것이다. 캐럿보다 먼저 보되 Ctrl 조합은
       넘긴다 — Ctrl+S·Ctrl+Z 는 개체를 고른 채로도 그대로 들어야 한다. */
    if (!ctrl && window.hwObj && hwObj.onKey(e)) { e.preventDefault(); return; }

    if (ctrl && !e.altKey) {
      switch (e.key.toLowerCase()) {
        case 'z': e.preventDefault(); if (hwUndo.undo()) status(); return;
        case 'y': e.preventDefault(); if (hwUndo.redo()) status(); return;
        case 'a': e.preventDefault(); hwCaret.selectAll(); return;
        case 'b': e.preventDefault(); hwFormat.toggleChar('bold'); return;
        case 'i': e.preventDefault(); hwFormat.toggleChar('italic'); return;
        case 'u': e.preventDefault(); hwFormat.toggleChar('underline'); return;
        case 's': e.preventDefault(); hwSave(shift); return;
        case 'f': e.preventDefault(); if (window.hwFind) hwFind.open(false); return;
        case 'h': e.preventDefault(); if (window.hwFind) hwFind.open(true); return;
        case 'c': case 'x': case 'v': return;   /* copy/cut/paste 이벤트에서 처리한다 */
        case 'home': e.preventDefault(); toDocEdge(-1, shift); return;
        case 'end': e.preventDefault(); toDocEdge(+1, shift); return;
      }
    }

    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); hwCaret.moveH(-1, shift); return;
      case 'ArrowRight': e.preventDefault(); hwCaret.moveH(+1, shift); return;
      case 'ArrowUp': e.preventDefault(); hwCaret.moveV(-1, shift); return;
      case 'ArrowDown': e.preventDefault(); hwCaret.moveV(+1, shift); return;
      case 'Home': e.preventDefault(); hwCaret.home(shift); return;
      case 'End': e.preventDefault(); hwCaret.end(shift); return;
      case 'PageUp': e.preventDefault(); hwCaret.page(-1, shift); return;
      case 'PageDown': e.preventDefault(); hwCaret.page(+1, shift); return;
      case 'Backspace': e.preventDefault(); backspace(); return;
      case 'Delete': e.preventDefault(); del(); return;
      case 'Enter': e.preventDefault(); enter(); return;
      case 'Tab': e.preventDefault(); typeText('\t'); return;
      case 'Escape': e.preventDefault(); hwCaret.clearSelection(); hwCaret.paint(); return;
    }
  }

  function toDocEdge(dir, extend) {
    var all = hwModel.allParas();
    if (!all.length) return;
    var last = all[all.length - 1];
    var target = dir < 0 ? { p: all[0], pos: 0 } : { p: last, pos: last.len };
    if (target) { hwCaret.set(target.p.id, target.pos, extend); hwCaret.scrollIntoView(); }
  }

  /* ── IME ─────────────────────────────────────────────── */

  function onCompStart() {
    cComposing = true;
  }

  function onCompUpdate(e) {
    showComposing(e.data || '');
  }

  function onCompEnd() {
    cComposing = false;
    /* 브라우저에 따라 compositionend 뒤 input 이 안 올 수 있다 — 그때를 대비한 뒷문이다.
       input 이 먼저 오면 수신기가 이미 비어 있어 여기서는 아무 일도 안 한다. */
    setTimeout(commit, 0);
  }

  function onInput() {
    if (cComposing) { showComposing(cIme.textContent || ''); return; }
    commit();
  }

  function commit() {
    if (!cIme) return;
    var t = cIme.textContent || '';
    cIme.textContent = '';
    hideComposing();
    if (t) typeText(t);
  }

  /* 조합 중인 글자는 모델이 아니라 캐럿 옆의 임시 span 에 그린다. */
  function showComposing(text) {
    if (!text) { hideComposing(); return; }

    var c = hwCaret.coord(hwCaret.at().id, hwCaret.at().pos);
    if (!c) return;
    var body = hwRenderer.bodyOf(c.pageIdx);
    if (!body) return;

    if (!cCompEl) {
      cCompEl = document.createElement('span');
      cCompEl.className = 'hw-composing';
    }
    var p = hwCaret.para();
    var cs = hwModel.charShape(hwModel.shapeAt(p, Math.max(0, hwCaret.at().pos - 1)));
    var face = hwModel.faceName(cs.face);

    cCompEl.style.fontFamily = '"' + ((face && face.sub) || 'NanumGothicHW') + '"';
    cCompEl.style.fontSize = hwHu2Px(cs.sizeHu) + 'px';
    cCompEl.style.left = hwHu2Px(c.xHu) + 'px';
    cCompEl.style.top = hwHu2Px(c.yHu) + 'px';
    cCompEl.style.height = hwHu2Px(c.hHu) + 'px';
    cCompEl.textContent = text;
    body.appendChild(cCompEl);

    placeIme(c, body);
  }

  function hideComposing() {
    if (cCompEl && cCompEl.parentNode) cCompEl.parentNode.removeChild(cCompEl);
  }

  /* 후보 창이 캐럿 옆에 뜨도록 수신기를 캐럿 자리로 옮긴다. */
  function placeIme(c, body) {
    if (!cIme || !c) return;
    var r = body.getBoundingClientRect();
    cIme.style.left = (r.left + hwHu2Px(c.xHu)) + 'px';
    cIme.style.top = (r.top + hwHu2Px(c.yHu)) + 'px';
    cIme.style.height = hwHu2Px(c.hHu) + 'px';
  }

  /* ── 마우스 ──────────────────────────────────────────── */

  function onMouseDown(e) {
    if (!hwDoc || e.button !== 0) return;

    /* ★ 개체를 <b>캐럿보다 먼저</b> 본다. 여기서 안 보면 그림을 눌러도 캐럿이 그 글자 자리로 갈 뿐
       개체는 영영 골라지지 않는다(8단계 전까지 그랬다). */
    if (window.hwObj && hwObj.onDown(e)) {
      e.preventDefault();
      focus();
      syncIme();
      return;
    }

    var hit = hwCaret.hitTest(e.clientX, e.clientY);
    if (!hit) return;

    e.preventDefault();
    focus();
    hwCaret.set(hit.id, hit.pos, e.shiftKey);
    cDragging = true;
    syncIme();
  }

  function onMouseMove(e) {
    /* 개체를 끄는 중이면 글자 선택으로 넘어가지 않는다(움직임 자체는 문서 쪽 수신기가 처리한다). */
    if (window.hwObj && hwObj.dragging()) return;
    if (!cDragging) return;
    var hit = hwCaret.hitTest(e.clientX, e.clientY);
    if (!hit) return;
    hwCaret.set(hit.id, hit.pos, true);
  }

  function onDoubleClick(e) {
    var hit = hwCaret.hitTest(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();

    var p = hwModel.byId(hit.id);
    var t = hwModel.text(p);
    var a = hit.pos, b = hit.pos;
    while (a > 0 && isWord(t.charAt(a - 1))) a--;
    while (b < t.length && isWord(t.charAt(b))) b++;
    if (a === b) return;

    hwCaret.set(p.id, a, false);
    hwCaret.set(p.id, b, true);
  }

  function isWord(ch) {
    return ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '￼' && ch !== '';
  }

  function syncIme() {
    var a = hwCaret.at();
    var c = hwCaret.coord(a.id, a.pos);
    if (!c) return;
    var body = hwRenderer.bodyOf(c.pageIdx);
    if (body) placeIme(c, body);
  }

  /* ── 클립보드 ────────────────────────────────────────── */

  function selectedText() {
    var sel = hwCaret.selection();
    if (!sel) return '';

    var from = hwModel.orderOf(sel.fromId), to = hwModel.orderOf(sel.toId);
    var out = [];
    var all = hwModel.allParas();
    for (var i = 0; i < all.length; i++) {
      var ord = hwModel.orderOf(all[i].id);
      if (ord < from || ord > to) continue;
      var t = hwModel.text(all[i]);
      out.push(t.slice(ord === from ? sel.fromPos : 0, ord === to ? sel.toPos : t.length));
    }
    return out.join('\r\n').replace(/￼/g, '');
  }

  function onCopy(e) {
    var t = selectedText();
    if (!t) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', t);
  }

  function onCut(e) {
    var t = selectedText();
    if (!t) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', t);
    edit(function () { dropSelection(); return null; });
  }

  function onPaste(e) {
    if (!hwDoc) return;
    var t = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    e.preventDefault();
    if (!t) return;

    /* 줄바꿈이 든 글은 문단을 나눠 넣는다 — 한 문단에 몰아넣으면 원본과 다른 모양이 된다. */
    var lines = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

    edit(function () {
      dropSelection();
      var p = hwCaret.para();
      if (!p) return null;

      var made = [];
      var pos = hwCaret.at().pos;
      var cs = hwModel.shapeAt(p, pos > 0 ? pos - 1 : 0);

      for (var i = 0; i < lines.length; i++) {
        if (i > 0) {
          var np = hwModel.splitPara(p, pos);
          made.push(np.id);
          p = np;
          pos = 0;
        }
        hwModel.insertText(p, pos, lines[i], cs);
        pos += lines[i].length;
      }
      hwCaret.set(p.id, pos, false);
      return made;
    });
  }

  return {
    init: init,
    focus: focus,
    /* 서식 도구줄이 <b>같은 편집 한 동작</b>을 타게 한다 — 따로 고치면 되돌리기·재배치가 빠진다.
       ★ ids 는 캐럿 밖 문단까지 고치는 동작(모두 바꾸기)이 <b>고칠 문단을 직접</b> 주는 자리다.
         이 인자를 안 넘기면 되돌리기가 캐럿 둘레만 복원한다(실측 — facename.hwp 에서 12군데를
         바꾸고 Ctrl+Z 했더니 2군데만 돌아왔다). */
    run: function (fn, coalesceKey, ids) { edit(fn, coalesceKey, ids); },
    typeText: typeText,
    insertImage: insertImage,
    status: status,
    isComposing: function () { return cComposing; }
  };
})();

/* C# 이 파일 대화상자로 고른 그림을 넘겨준다. */
function hwInsertImage(info) { hwInput.insertImage(info); }
