/* ★ 본문은 contenteditable 이 아니다. 화면 밖에 숨긴 contenteditable div 하나가 IME 수신기이고,
     본문은 우리가 계산한 배치를 그린 그림이다. 본문을 편집 가능하게 두면 브라우저가
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
  var cDragCell = null;     /* 끌기를 시작한 표 칸. 다른 칸으로 넘어가면 칸 블록이 된다. */

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
      canvas.addEventListener('dblclick', onDoubleClick);
      canvas.addEventListener('contextmenu', onContextMenu);
    }
    /* ★ 끌기는 개체든 글자 선택이든 <b>문서</b>에서 받는다. 캔버스에만 걸면 끌다가 도구줄·상태줄 위로
       나갔을 때 움직임도 놓는 것도 안 오고, 개체는 마지막 자리에 붙은 채, 선택은 거기서 멈춘다. */
    document.addEventListener('mousemove', function (e) {
      if (window.hwObj && hwObj.dragging()) { hwObj.onMove(e); return; }
      onMouseMove(e);
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

  /* ★ 되돌리기 기록 → 고치기 → 다시 배치 → 캐럿 을 <b>한 묶음</b>으로 돈다.
       중간에 배치를 빼먹으면 캐럿이 옛 좌표를 보고 엉뚱한 자리에 선다. */
  function edit(fn, coalesceKey, pIds) {
    if (!hwDoc) return;
    if (window.hwFind) hwFind.clearHits();

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

  /* 이웃까지 담는다 — 나누기·합치기가 이웃을 고친다. */
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
      /* ★ 선택이 통째로 덮은 표의 칸 문단은 건너뛴다. 표는 안 지워지고 남는데(hwModel.keeps) 그 칸만
         비우면 내용이 날아간 빈 틀이 남는다. 선택 끝이 그 표 안에 걸쳐 있을 때만 칸을 고친다. */
      if (mp._cell && !inTableOf(fromP, mp) && !inTableOf(toP, mp)) continue;
      if (hasKept(mp) || hwModel.listOf(mp).length <= 1) hwModel.deleteRange(mp, 0, mp.len);
      else hwModel.removePara(mp);
    }

    /* 가운데가 통째로 없어졌을 때만 앞뒤를 잇는다. 비워 둔 문단이 남았으면 그것이 경계다. */
    if (hwModel.after(fromP) === toP && toP._sec === fromP._sec) hwModel.mergeNext(fromP);

    hwCaret.set(fromP.id, sel.fromPos + keptHead, false);
    return true;
  }

  /* p 가 cellPara 와 같은 표 안(그 표의 칸, 또는 그 안에 든 표의 칸)에 있는가. */
  function inTableOf(p, cellPara) {
    var tbl = cellPara._cell._obj;
    for (var q = p; q && q._cell; ) {
      if (q._cell._obj === tbl) return true;
      q = hwModel.hostOf(q._cell._obj);
    }
    return false;
  }

  /* 글자 지우기로는 안 지워지는 개체(용지·단 정의, 표)를 달고 있는가. */
  function hasKept(para) {
    for (var i = 0; i < (para.objs || []).length; i++) if (hwModel.keeps(para.objs[i])) return true;
    return false;
  }

  /* 캐럿 바로 앞(dir<0)·뒤(dir>0) 자리의 표. 선택이 있으면 null — 그때는 선택 지우기가 먼저다. */
  function tableBeside(dir) {
    if (hwCaret.selection()) return null;
    var p = hwCaret.para();
    if (!p) return null;
    var at = hwCaret.at().pos + (dir < 0 ? -1 : 0);
    for (var i = 0; i < (p.objs || []).length; i++)
      if (p.objs[i].pos === at && p.objs[i].table) return p.objs[i];
    return null;
  }

  /* ★ 표 옆에서 지우기를 누르면 표를 지우지 않고 칸으로 들어간다(한글과 같다) — Backspace 는
       마지막 칸 끝, Delete 는 첫 칸 머리. 캐럿만 옮기므로 edit() 를 안 탄다(되돌리기 칸이 안 생긴다). */
  function enterTable(o, last) {
    var q = hwTable.edgePara(o, last);
    if (!q) return false;
    hwCaret.set(q.id, last ? q.len : 0, false);
    hwCaret.scrollIntoView();
    return true;
  }

  function backspace() {
    var tb = tableBeside(-1);
    if (tb && enterTable(tb, true)) return;

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
    var tb = tableBeside(+1);
    if (tb && enterTable(tb, false)) return;

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

  /* 한 줄 지우기(Ctrl+Y·Ctrl+T)와 줄 끝까지 지우기(Alt+Y). 줄은 <b>화면 줄</b>이다 — 캐럿이 선 줄을 배치에서 찾는다.
     ★ 한 줄짜리 문단을 지우면 문단째 없어지고 다음 문단이 올라온다(한글). 여러 줄 문단의 줄은 글자만 지운다 —
       마지막 줄에서 문단 나눔까지 지우면 다음 문단 글이 윗줄 끝에 붙어 버린다.
     ★ 표·안 보이는 컨트롤은 지우지 않는다(deleteRange 가 keeps 로 지킨다). 그런 것이 남은 문단은 없애지 않고
       다음 문단을 끌어 붙이되 모양은 <b>다음 문단 것</b>을 쓴다 — 지운 줄의 모양이 남으면 올라온 글이 모양을 잃는다. */
  function deleteLine(toEndOnly) {
    var p = hwCaret.para();
    var at = hwCaret.at();
    var c = p ? hwCaret.coord(at.id, at.pos) : null;
    if (!c) return;

    var lines = hwLineIndex[p.id] || [];
    var single = lines.length <= 1;
    var s = c.item.line.s, e = lines[lines.length - 1] === c.item ? p.len : c.item.line.e;

    edit(function () {
      hwCaret.clearSelection();

      if (toEndOnly) {
        /* 강제 줄바꿈은 남긴다 — 지우면 다음 줄이 이 줄에 붙는다. */
        var end = (e > at.pos && hwModel.text(p).charAt(e - 1) === '\n') ? e - 1 : e;
        hwModel.deleteRange(p, at.pos, end);
        hwCaret.set(p.id, at.pos, false);
        return null;
      }

      var kept = (e - s) - hwModel.deleteRange(p, s, e);
      var next = single ? hwModel.after(p) : null;
      if (next && next._sec !== p._sec) next = null;

      if (next && kept === 0 && p.len === 0 && hwModel.listOf(p).length > 1) {
        hwModel.removePara(p);
        hwCaret.set(next.id, 0, false);
      } else if (next && p.len === kept) {
        p.ps = next.ps;
        hwModel.mergeNext(p);
        hwCaret.set(p.id, kept, false);
      } else {
        hwCaret.set(p.id, Math.min(s + kept, p.len), false);
      }
      return null;
    });
  }

  /* 쪽 나누기(Ctrl+Enter·Ctrl+J). 캐럿 자리에서 문단을 나누고 <b>새 문단</b>에 쪽 나눔을 건다.
     ★ 문단 머리에서 누르면 나누지 않고 그 문단에 건다 — 빈 문단이 하나 더 생기면 안 된다.
     ★ 표 칸 안에서는 안 한다. 칸 배치는 나눔을 안 보고, 되쓰기는 칸 문단에 나눔 표시를 그대로 적는다. */
  function pageBreak() {
    var p = hwCaret.para();
    if (!p) return;
    if (p._cell) { hwSetStatus({ text: '표 안에서는 쪽을 나눌 수 없습니다' }); return; }

    edit(function () {
      dropSelection();
      var q = hwCaret.para(), pos = hwCaret.at().pos;
      if (!q) return null;

      /* ★ 안 보이는 컨트롤(구역·단 정의) 앞에서 나누면 그것이 새 문단으로 넘어가 구역 머리 문단이 정의를
         잃는다 — 그 뒤로 물린다. 그 자리가 곧 "문단 머리" 다. */
      var lead = hwModel.items(q);
      while (pos < lead.length && lead[pos].obj && lead[pos].obj.hidden) pos++;
      var head = true;
      for (var h = 0; h < pos; h++) if (!(lead[h].obj && lead[h].obj.hidden)) { head = false; break; }

      if (head && q.brk) return null;           /* 이미 나눔이 걸린 문단 머리 — 할 것이 없다 */
      if (head) {
        q.brk = 'page';
        hwModel.markDirty(q.id);
        return null;
      }
      var np = hwModel.splitPara(q, pos);
      np.brk = 'page';
      hwCaret.set(np.id, 0, false);
      return [np.id];
    });
  }

  /* Alt+방향키 — 캐럿은 두고 한 화면의 80% 만큼 민다. */
  function scrollView(dx, dy) {
    var canvas = hwRenderer.canvas();
    if (!canvas) return;
    if (dy) canvas.scrollTop += dy * Math.round(canvas.clientHeight * 0.8);
    if (dx) canvas.scrollLeft += dx * Math.round(canvas.clientWidth * 0.8);
    hwRenderRefresh();
  }

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

  /* ★ 단축키는 <b>표 한 장</b>이다: "C·A·S 머리 + 키 이름" → 동작. 한글 손버릇 키는 같은 동작에 여러
       이름이 붙는다(Ctrl+B · Alt+Shift+B). 방향키처럼 Shift 를 인자로 받는 이동 키는 아래 switch 에 둔다.
     ★ 동작이 <c>false</c> 를 돌려주면 "여기서는 안 한다" 는 뜻이다 — 칸 밖의 Tab 처럼 아래로 흘려보낸다.
     ★ Ctrl+C·X·V 는 표에 <b>안 넣는다</b>. 기본 동작을 막으면 copy·cut·paste 이벤트가 안 온다. */

  var cKeys = null;

  var cChords = null;
  var cChord = null;

  /* ★ 한글 모드에서 둘째 키를 누르면 keydown 을 막아도 IME 가 그 키로 조합을 시작한다('ㄱ').
     그 조합 하나는 글자로 넣지 않고 버린다 — 안 버리면 Ctrl+M, R 뒤에 'ㄱ' 이 문서에 들어간다. */
  var cSwallow = false, cSwallowing = false;

  function keys() {
    if (cKeys) return cKeys;
    cKeys = {};
    function on(names, fn) { for (var i = 0; i < names.length; i++) cKeys[names[i]] = fn; }
    function fmt(name) { return function () { hwFormat.toggleChar(name); }; }
    function align(a) { return function () { hwFormat.setAlign(a); }; }
    function scroll(dx, dy) { return function () { scrollView(dx, dy); }; }

    on(['C+z'], undo);
    on(['CS+z'], redo);
    on(['C+a'], function () { hwCaret.selectAll(); });
    on(['C+s'], function () { hwSave(false); });
    on(['CS+s'], function () { hwSave(true); });
    on(['C+Home'], function () { toDocEdge(-1, false); });
    on(['CS+Home'], function () { toDocEdge(-1, true); });
    on(['C+End'], function () { toDocEdge(+1, false); });
    on(['CS+End'], function () { toDocEdge(+1, true); });
    on(['C+y', 'C+t'], function () { deleteLine(false); });
    on(['A+y'], function () { deleteLine(true); });
    on(['C+Enter', 'C+j'], function () { pageBreak(); });
    on(['C+f', '+F2'], function () { if (window.hwFind) hwFind.open(false); });
    on(['C+h', 'C+F2'], function () { if (window.hwFind) hwFind.open(true); });
    on(['A+g'], function () { if (window.hwFind) hwFind.openGoto(); });
    on(['C+k'], function () { startChord('C+k', 'Ctrl+K'); });
    on(['C+q'], function () { startChord('C+q', 'Ctrl+Q'); });
    on(['C+m'], function () { startChord('C+m', 'Ctrl+M'); });
    on(['A+l'], function () { hwDialog.charShape(); });
    on(['A+t'], function () { hwDialog.paraShape(); });
    on(['C+F10'], function () { hwDialog.charMap(); });
    /* ★ WebView2 의 F7 은 캐럿 브라우징 물음이다 — keys() 가 기본 동작을 막아야 그 창이 안 뜬다. */
    on(['+F7'], function () { hwDialog.pageSetup(); });
    on(['C+g'], function () { startChord('C+g', 'Ctrl+G'); });
    on(['C+n'], function () { startChord('C+n', 'Ctrl+N'); });
    on(['S+NumAdd'], function () { hwUi.stepZoom(+1); });
    on(['S+NumSub'], function () { hwUi.stepZoom(-1); });

    /* 글자 모양 */
    on(['C+b', 'AS+b'], fmt('bold'));
    on(['C+i', 'AS+i'], fmt('italic'));
    on(['C+u', 'AS+u'], fmt('underline'));
    on(['C+]', 'AS+e'], function () { hwFormat.stepSize(+1); });
    on(['C+[', 'AS+r'], function () { hwFormat.stepSize(-1); });
    on(['AS+k'], function () { hwFormat.stepRatio(+1); });
    on(['AS+j'], function () { hwFormat.stepRatio(-1); });
    on(['AS+w'], function () { hwFormat.stepSpacing(+1); });
    on(['AS+n'], function () { hwFormat.stepSpacing(-1); });
    on(['AS+s', 'CS+='], function () { hwFormat.toggleScript('sub'); });
    on(['AS+o'], function () { hwFormat.toggleScript('sup'); });
    on(['CA+a'], function () { hwFormat.toggleScript('swap'); });
    on(['CS+l', 'CA+l'], align('left'));
    on(['CS+c', 'CA+c'], align('center'));
    on(['CS+r', 'CA+r'], align('right'));
    on(['CS+m', 'CA+m'], align('justify'));
    on(['CS+t', 'CA+t'], align('distribute'));
    on(['AS+z', 'CS+u'], function () { hwFormat.stepLineSpace(+1); });
    on(['AS+a', 'CS+q'], function () { hwFormat.stepLineSpace(-1); });
    on(['C+F5', 'CS+i'], function () { hwFormat.stepIndent(+1); });
    on(['C+F6', 'CS+o'], function () { hwFormat.stepIndent(-1); });
    on(['C+F7'], function () { hwFormat.indent(+1); });
    on(['C+F8'], function () { hwFormat.indent(-1); });
    on(['CA+F5'], function () { hwFormat.stepMargin('mlHu', +1); });
    on(['CA+F6'], function () { hwFormat.stepMargin('mlHu', -1); });
    on(['CA+F7'], function () { hwFormat.stepMargin('mrHu', +1); });
    on(['CA+F8'], function () { hwFormat.stepMargin('mrHu', -1); });

    /* ★ Alt+← 는 WebView2 의 "뒤로 가기" 다 — 표에 있어야 막힌다. */
    on(['A+ArrowUp'], scroll(0, -1));
    on(['A+ArrowDown'], scroll(0, +1));
    on(['A+ArrowLeft'], scroll(-1, 0));
    on(['A+ArrowRight'], scroll(+1, 0));

    on(['+Tab'], function () { return hwTable.here() ? hwTable.nextCell(+1) || true : false; });
    on(['S+Tab'], function () { return hwTable.here() ? hwTable.nextCell(-1) || true : false; });
    on(['A+Insert'], function () { hwDialog.tableLines(false); });
    on(['A+Delete'], function () { hwDialog.tableLines(true); });

    /* ★ 맨 F5 를 여기서 잡아야 한다 — 안 잡으면 WebView2 가 새로고침해서 고친 문서가 통째로 날아간다. */
    on(['+F5'], function () { return hwTable.cycleBlock() || true; });

    cChords = {
      'C+k': {},
      'C+q': {
        l: function () { if (window.hwFind) hwFind.repeat(); },
        f: function () { if (window.hwFind) hwFind.open(false); },
        a: function () { if (window.hwFind) hwFind.open(true); }
      },
      'C+m': {
        k: color('#000000'), r: color('#FF0000'), b: color('#0000FF'), d: color('#800080'),
        g: color('#008000'), y: color('#FFFF00'), c: color('#00FFFF'), h: color('#FFFFFF')
      },
      'C+g': {
        p: function () { hwUi.fitZoom('page'); },
        q: function () { hwUi.setZoom(100); },
        i: function () { hwUi.fitZoom('width'); }
      },
      'C+n': {
        t: function () { hwDialog.tableInsert(); }
      }
    };
    function color(v) { return function () { hwFormat.applyChar({ color: v }); }; }
    return cKeys;
  }

  /* ★ <b>code 를 먼저</b> 본다 — 한글 모드에서 글자 키의 key 는 'Process' 이고, Shift 를 누르면
     ']' 가 '}' 로 온다. code 가 없으면(합성 이벤트) key 로 물러선다. */
  function keyName(e) {
    var c = e.code || '', m;
    if ((m = /^Key([A-Z])$/.exec(c))) return m[1].toLowerCase();
    if ((m = /^Digit([0-9])$/.exec(c))) return m[1];
    if (c === 'BracketLeft') return '[';
    if (c === 'BracketRight') return ']';
    /* Shift 를 같이 누르면 key 가 '+' 로 바뀐다 — code 로 잡아야 Ctrl+Shift+= 가 한 이름으로 온다. */
    if (c === 'Equal') return '=';
    /* 숫자판 +/− 는 본 자판 +/− 와 key 가 같다 — 확대/축소는 숫자판에만 건다. */
    if (c === 'NumpadAdd') return 'NumAdd';
    if (c === 'NumpadSubtract') return 'NumSub';
    var k = e.key || '';
    return k.length === 1 ? k.toLowerCase() : k;
  }

  function comboOf(e) {
    return ((e.ctrlKey || e.metaKey) ? 'C' : '') + (e.altKey ? 'A' : '') + (e.shiftKey ? 'S' : '') + '+' + keyName(e);
  }

  function isModifier(k) { return k === 'Control' || k === 'Shift' || k === 'Alt' || k === 'Meta'; }

  function startChord(name, label) {
    cChord = name;
    hwSetStatus({ text: label + ' — 다음 키를 누르세요 (Esc 취소)' });
  }

  /* 대기를 푼다. 상태줄도 원래대로 — 대기 문구가 남아 있으면 아직 기다리는 줄 안다. */
  function clearChord() {
    if (!cChord) return;
    cChord = null;
    if (hwDoc) status();
  }

  function onKeyDown(e) {
    if (!hwDoc) return;
    if (e.isComposing || cComposing) return;   /* 조합 중에는 IME 가 키를 가져간다 */
    if (isModifier(e.key)) return;             /* Ctrl 을 떼었다 누르는 것만으로 대기가 풀리면 안 된다 */
    if (window.hwUi && hwUi.menuKey(e)) { e.preventDefault(); return; }

    keys();
    cSwallow = false;

    /* ★ 대기 중인 두 타 조합이 <b>무엇보다 먼저</b>다 — Esc 도 여기서 끝나야 선택까지 그대로 남는다. */
    if (cChord) {
      e.preventDefault();
      var fn2 = cChords[cChord][keyName(e)];
      clearChord();
      if (e.key === 'Process' || e.keyCode === 229) cSwallow = true;
      if (fn2 && e.key !== 'Escape') fn2();
      return;
    }

    var ctrl = e.ctrlKey || e.metaKey;

    /* ★ 개체를 골랐으면 방향키·Delete·Esc 가 <b>개체</b>의 것이다. 캐럿보다 먼저 보되 Ctrl 조합은
       넘긴다 — Ctrl+S·Ctrl+Z 는 개체를 고른 채로도 그대로 들어야 한다. */
    if (!ctrl && window.hwObj && hwObj.onKey(e)) { e.preventDefault(); return; }

    /* 셀 블록도 같은 자리에서 캐럿보다 먼저 받는다. 블록이 안 받는 키는 블록을 풀고 흘려보낸다.
       ★ 키 이름을 <c>keyName</c> 으로 넘긴다 — 한글 모드에서는 e.key 가 'Process' 라 M·S·W·H 가
         글자로 새고, 그 자리에 'ㅡ' 가 들어간다(A1 이 키 표에서 이미 겪은 함정).
       ★ Alt 조합은 넘긴다 — Alt+Delete(줄/칸 지우기)가 블록의 Delete 에 먹히면 안 된다. */
    if (!ctrl && !e.altKey && window.hwTable && hwTable.onKey(e, keyName(e))) {
      e.preventDefault();
      if (e.key === 'Process' || e.keyCode === 229) cSwallow = true;
      return;
    }

    var fn = cKeys[comboOf(e)];
    if (fn) {
      e.preventDefault();
      if (fn() !== false) return;
    }

    var shift = e.shiftKey;
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

  /* ★ 도구줄 단추 상태는 여기서 다시 칠한다 — 되돌리기는 이력 자리를 옮기기 <b>전에</b> 다시 그려서, 그 안에서 칠한 상태가 한 칸 늦다. */
  function undo() { if (hwUndo.undo()) { status(); hwUi.refresh(); } }
  function redo() { if (hwUndo.redo()) { status(); hwUi.refresh(); } }

  function toDocEdge(dir, extend) {
    var all = hwModel.allParas();
    if (!all.length) return;
    var last = all[all.length - 1];
    var target = dir < 0 ? { p: all[0], pos: 0 } : { p: last, pos: last.len };
    if (target) { hwCaret.set(target.p.id, target.pos, extend); hwCaret.scrollIntoView(); }
  }

  function onCompStart() {
    cComposing = true;

    /* 두 타 조합의 둘째 키가 연 조합이다 — 글자로 안 넣고 끊는다. ★ 그냥 두면 IME 는 'ㄱ' 을 조합 중으로
       들고 있어서, 이어 친 'ㅏ' 가 '가' 가 되고 그 글자까지 통째로 버려진다. 초점을 한 번 뺐다 돌려
       조합을 끝낸다(끝나는 compositionend 는 아래에서 버린다). */
    if (cSwallow) {
      cSwallow = false;
      cSwallowing = true;
      setTimeout(function () {
        if (!cSwallowing || !cIme) return;
        cIme.blur();
        focus();
        /* 초점을 옮겨도 compositionend 가 안 오면 여기서 푼다 — 안 풀면 다음 조합까지 통째로 버린다. */
        if (cSwallowing) { cSwallowing = false; cComposing = false; cIme.textContent = ''; hideComposing(); }
      }, 0);
    }
  }

  function onCompUpdate(e) {
    if (cSwallowing) return;
    showComposing(e.data || '');
  }

  /* ★ 조합은 compositionend 에서 <b>그 자리에서</b> 확정한다. 0ms 타이머로 미루면 한글 IME 가 곧바로 여는
     다음 조합과 겹쳐, 수신기에 든 두 조합이 한 번에 읽히거나 순서가 뒤집힌다(TODO 3 낮음).
     ★ data 가 비면 수신기 글을 읽는다 — IME 가 조합을 <b>취소</b>한 경우(Esc) 둘 다 비어 있어 아무것도 안
       들어간다. 마지막 조합 중 글자로 채우면 사용자가 지운 글자를 되살린다. */
  function onCompEnd(e) {
    cComposing = false;
    if (cSwallowing) {
      cSwallowing = false;
      if (cIme) cIme.textContent = '';
      hideComposing();
      return;
    }
    if (!cIme) return;
    var t = (e && e.data) || cIme.textContent || '';
    cIme.textContent = '';
    hideComposing();
    if (t) typeText(t);
  }

  /* 조합이 끝난 뒤 input 이 또 오는 브라우저가 있다 — 확정하면서 수신기를 비워 두었으므로 commit 은
     빈 값을 읽고 아무것도 안 한다. */
  function onInput(e) {
    if (cSwallowing) return;
    if ((e && e.isComposing) || cComposing) { showComposing(cIme.textContent || ''); return; }
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

  function onMouseDown(e) {
    clearChord();
    if (!hwDoc || e.button !== 0) return;

    /* ★ 개체를 <b>캐럿보다 먼저</b> 본다. 여기서 안 보면 그림을 눌러도 캐럿이 그 글자 자리로 갈 뿐
       개체는 영영 골라지지 않는다. */
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
    var hp = hwModel.byId(hit.id);
    cDragCell = hp ? hp._cell || null : null;
    cDragging = true;
    syncIme();
  }

  /* 글자 선택 끌기. ★ 본문 밖으로 나가도 이어 간다 — 좌표를 캔버스 안쪽으로 잘라서 가장자리 줄을 잡는다.
     위·아래로 나가면 그만큼 화면을 밀어 준다.
     ★ 자른 좌표가 쪽 사이 여백에 떨어지면 hitTest 가 null 이다 — 그때는 마지막 자리를 그대로 둔다. */
  function onMouseMove(e) {
    if (window.hwObj && hwObj.dragging()) return;
    if (!cDragging) return;

    var canvas = hwRenderer.canvas();
    if (!canvas) return;
    var r = canvas.getBoundingClientRect();
    var x = Math.max(r.left + 1, Math.min(e.clientX, r.left + canvas.clientWidth - 2));
    var y = Math.max(r.top + 1, Math.min(e.clientY, r.top + canvas.clientHeight - 2));

    var over = e.clientY < r.top ? e.clientY - r.top : (e.clientY > r.top + canvas.clientHeight
             ? e.clientY - (r.top + canvas.clientHeight) : 0);
    if (over) {
      canvas.scrollTop += Math.max(-60, Math.min(60, over));
      /* 밀고 나서 새로 드러난 쪽은 아직 비어 있다 — 채운 뒤에 줄을 찾는다. */
      hwRenderRefresh();
    }

    var hit = dragHit(x, y);
    if (!hit) return;

    /* ★ 칸에서 다른 칸으로 끌면 글자 선택이 아니라 <b>칸 블록</b>이다 — 칸 경계를 넘는 글자 선택은
       한글에도 없고, 그 범위를 지우면 격자가 깨진다. */
    var to = hwModel.byId(hit.id);
    if (cDragCell && to && to._cell && to._cell !== cDragCell && to._cell._obj === cDragCell._obj) {
      hwTable.dragBlock(cDragCell, to._cell);
      return;
    }
    hwCaret.set(hit.id, hit.pos, true);
  }

  /* 끄는 좌표의 문서 자리. ★ 쪽 사이 여백·마지막 쪽 아래에 떨어지면 hitTest 가 null 이다 — 그때는 세로로
     가장 가까운 쪽 안으로 한 번 더 잘라 본다. 안 그러면 문서 끝 너머로 끌 때 선택이 끝 줄까지 안 간다. */
  function dragHit(x, y) {
    var hit = hwCaret.hitTest(x, y);
    if (hit) return hit;

    var best = null, bestD = Infinity;
    for (var i = 0; i < hwPages.length; i++) {
      var el = hwRenderer.pageElOf(i);
      if (!el) continue;
      var r = el.getBoundingClientRect();
      var d = y < r.top ? r.top - y : (y > r.bottom ? y - r.bottom : 0);
      if (d < bestD) { bestD = d; best = r; }
    }
    if (!best) return null;
    return hwCaret.hitTest(Math.max(best.left + 1, Math.min(x, best.right - 2)),
                           Math.max(best.top + 1, Math.min(y, best.bottom - 2)));
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

  /* 복사해 둔 내부 서식 { mark, paras:[{ps, runs:[{cs, text}]}] }. 붙여넣기 HTML 의 표식이 같으면 이것으로 붙인다 —
     다른 창·다른 문서에서 온 것은 표식이 달라 HTML 변환이나 평문으로 떨어진다.
     ★ 모양 번호는 이 문서의 것이다. 저장으로 번호가 다시 매겨지면 remapClip 이 맞추고, 다른 문서를 열면 버린다. */
  var cClip = null;

  /* 선택 범위를 문단별 runs 로. 개체(U+FFFC)는 뺀다 — 개체는 아직 클립보드로 못 옮긴다. */
  function selectedParas() {
    var sel = hwCaret.selection();
    if (!sel) return [];

    var from = hwModel.orderOf(sel.fromId), to = hwModel.orderOf(sel.toId);
    var out = [], all = hwModel.allParas();
    for (var i = 0; i < all.length; i++) {
      var ord = hwModel.orderOf(all[i].id);
      if (ord < from || ord > to) continue;
      var a = hwModel.items(all[i]);
      var s = ord === from ? sel.fromPos : 0, e = ord === to ? sel.toPos : a.length;
      var runs = [], cur = null;
      for (var k = s; k < e && k < a.length; k++) {
        if (a[k].ch === undefined) continue;
        if (!cur || cur.cs !== a[k].cs) { cur = { cs: a[k].cs, text: '' }; runs.push(cur); }
        cur.text += a[k].ch;
      }
      out.push({ ps: all[i].ps, runs: runs });
    }
    return out;
  }

  function plainOf(paras) {
    var out = [];
    for (var i = 0; i < paras.length; i++) {
      var t = '';
      for (var r = 0; r < paras[i].runs.length; r++) t += paras[i].runs[r].text;
      out.push(t);
    }
    return out.join('\r\n');
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function runCss(cs) {
    var face = hwModel.faceName(cs.face), st = [];
    if (face && face.name) st.push("font-family:'" + face.name.replace(/['"]/g, '') + "'");
    st.push('font-size:' + (cs.sizeHu / 100) + 'pt');
    if (cs.bold) st.push('font-weight:bold');
    if (cs.italic) st.push('font-style:italic');
    var deco = [];
    if (cs.underline) deco.push('underline');
    if (cs.strike) deco.push('line-through');
    if (deco.length) st.push('text-decoration:' + deco.join(' '));
    if (cs.color) st.push('color:' + cs.color);
    return st.join(';');
  }

  /* 첫 요소에 표식을 단다(덤프 7). 공백·탭이 접히지 않게 pre-wrap 으로 싣는다. */
  function htmlOf(paras, mark) {
    var h = '';
    for (var i = 0; i < paras.length; i++) {
      var body = '';
      for (var r = 0; r < paras[i].runs.length; r++) {
        var run = paras[i].runs[r];
        body += '<span style="' + runCss(hwModel.charShape(run.cs)) + '">' + escHtml(run.text).replace(/\n/g, '<br>') + '</span>';
      }
      h += '<p' + (i === 0 ? ' data-hw-copy="' + mark + '"' : '') + ' style="margin:0;white-space:pre-wrap">' + (body || '<br>') + '</p>';
    }
    return h;
  }

  function putClip(dt) {
    var paras = selectedParas();
    var text = plainOf(paras);
    if (!text) return false;
    var mark = 'hw' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    cClip = { mark: mark, paras: paras };
    dt.setData('text/plain', text);
    dt.setData('text/html', htmlOf(paras, mark));
    return true;
  }

  function onCopy(e) {
    if (e.clipboardData && putClip(e.clipboardData)) e.preventDefault();
  }

  function onCut(e) {
    if (!e.clipboardData || !putClip(e.clipboardData)) return;
    e.preventDefault();
    edit(function () { dropSelection(); return null; });
  }

  function onPaste(e) {
    if (!hwDoc) return;
    var dt = e.clipboardData;
    e.preventDefault();
    if (!dt) return;
    var file = null;
    for (var i = 0; i < (dt.files ? dt.files.length : 0); i++) if (/^image\//.test(dt.files[i].type)) { file = dt.files[i]; break; }
    pasteData({ text: dt.getData('text/plain'), html: dt.getData('text/html'), file: file });
  }

  /* 붙여넣기 판정(덤프 7): ① 내 표식 → 내부 서식 ② 그림 파일만 있고 평문이 없음 → 그림 ③ HTML 태그 → 변환 ④ 평문.
     붙여넣기 이벤트와 C# 브릿지(우클릭 붙여넣기, hwPasteData)가 같이 탄다. */
  function pasteData(d) {
    if (!hwDoc || !d) return;
    var m = /data-hw-copy="([^"]+)"/.exec(d.html || '');
    if (m && cClip && m[1] === cClip.mark) { pasteParas(cClip.paras); return; }
    if (d.file && !d.text) { pasteImage(d.file); return; }
    if (d.html && /<[a-z][^>]*>/i.test(d.html)) {
      var ps = htmlToParas(d.html);
      if (ps.length) { pasteParas(ps); return; }
    }
    if (d.text) pasteParas(plainParas(d.text));
  }

  /* 줄바꿈이 든 글은 문단을 나눠 넣는다 — 한 문단에 몰아넣으면 원본과 다른 모양이 된다. */
  function plainParas(t) {
    var lines = t.replace(/￼/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n'), out = [];
    for (var i = 0; i < lines.length; i++) out.push({ ps: null, runs: [{ cs: null, text: lines[i] }] });
    return out;
  }

  /* 문단 목록을 캐럿 자리에 넣는다. cs·ps 가 null 이면 캐럿 자리의 것을 쓴다.
     ★ 첫 문단의 모양은 캐럿이 문단 머리에 있을 때만 옮긴다 — 문단 중간에 붙이면 그 문단은 원래 모양 그대로다. */
  function pasteParas(list) {
    edit(function () {
      dropSelection();
      var p = hwCaret.para();
      if (!p) return null;

      var made = [];
      var pos = hwCaret.at().pos;
      var base = hwModel.shapeAt(p, pos > 0 ? pos - 1 : 0);
      var head = true, lead = hwModel.items(p);
      for (var h = 0; h < pos && h < lead.length; h++) if (!(lead[h].obj && lead[h].obj.hidden)) { head = false; break; }

      for (var i = 0; i < list.length; i++) {
        if (i > 0) {
          var np = hwModel.splitPara(p, pos);
          made.push(np.id);
          p = np;
          pos = 0;
        }
        if (list[i].ps !== null && list[i].ps !== undefined && (i > 0 || head) && p.ps !== list[i].ps) {
          p.ps = list[i].ps;
          hwModel.markDirty(p.id);
        }
        for (var r = 0; r < list[i].runs.length; r++) {
          var run = list[i].runs[r];
          pos += hwModel.insertText(p, pos, run.text, run.cs === null ? base : run.cs);
        }
      }
      hwCaret.set(p.id, pos, false);
      return made;
    });
  }

  /* ② 그림. 파일을 C# 에 넘기면 임시 파일로 받아 그림 넣기 응답(hwInsertImage)을 그대로 돌려준다. */
  function pasteImage(file) {
    var rd = new FileReader();
    rd.onload = function () {
      var s = String(rd.result || ''), at = s.indexOf(',');
      if (at < 0) return;
      hwPost({ t: 'pasteImage', name: file.name || 'image.png', type: file.type || 'image/png', data: s.slice(at + 1) });
    };
    rd.onerror = function () { hwSetStatus({ text: '붙여 넣을 그림을 읽지 못했습니다' }); };
    rd.readAsDataURL(file);
  }

  /* ③ 다른 프로그램의 HTML → 문단·굵게·기울임·밑줄·취소선·색·크기만(F4). 표는 줄마다 문단, 칸은 탭으로 — 1차는 평문처럼.
     그림은 버린다(Office 가 조건부 주석 안에 넣는 VML 그림은 DOMParser 가 주석으로 읽어 저절로 빠진다).
     ★ 스타일이 안 걸린 글은 굵게·기울임·밑줄·취소선을 <b>끈다</b> — HTML 에서는 그것이 기본값이다. 크기·색은 캐럿 자리 것을 잇는다. */
  var cBlockRe = /^(P|DIV|H[1-6]|LI|UL|OL|DL|DT|DD|TR|TABLE|TBODY|THEAD|TFOOT|BLOCKQUOTE|PRE|SECTION|ARTICLE|HEADER|FOOTER|ADDRESS|CAPTION|FIGURE)$/;
  var cSkipRe = /^(SCRIPT|STYLE|HEAD|TITLE|META|LINK|IMG|SVG|OBJECT|IFRAME|NOSCRIPT|TEMPLATE)$/;

  function htmlToParas(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var p = hwCaret.para();
    var at = hwCaret.at().pos;
    var base = p ? hwModel.shapeAt(p, at > 0 ? at - 1 : 0) : 0;
    var out = [], cur = null, memo = {};

    function para() { cur = { ps: null, runs: [] }; out.push(cur); }
    function shapeOf(st) {
      var key = JSON.stringify(st);
      if (!memo.hasOwnProperty(key)) memo[key] = hwFormat.charShapeWith(base, st);
      return memo[key];
    }
    function add(text, st) {
      if (!text) return;
      if (!cur) para();
      var cs = shapeOf(st), last = cur.runs[cur.runs.length - 1];
      if (last && last.cs === cs) last.text += text;
      else cur.runs.push({ cs: cs, text: text });
    }
    function walk(node, st, pre) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) {
          var t = c.nodeValue.replace(/ /g, ' ').replace(/￼/g, '');
          if (!pre) {
            t = t.replace(/[\r\n\t ]+/g, ' ');
            if (!cur || !cur.runs.length) t = t.replace(/^ +/, '');
          }
          add(t, st);
          continue;
        }
        if (c.nodeType !== 1) continue;
        var tag = c.tagName.toUpperCase();
        if (cSkipRe.test(tag) || tag.indexOf(':') >= 0) continue;
        if (tag === 'BR') { if (!cur) para(); cur = null; continue; }
        if ((tag === 'TD' || tag === 'TH') && c.previousElementSibling) add('\t', st);
        var block = cBlockRe.test(tag);
        if (block) cur = null;
        walk(c, styleOf(c, st), pre || tag === 'PRE');
        if (block) cur = null;
      }
    }

    walk(doc.body, { bold: false, italic: false, underline: 0, strike: false }, false);
    for (var i = 0; i < out.length; i++) {
      var rs = out[i].runs;
      if (rs.length) rs[rs.length - 1].text = rs[rs.length - 1].text.replace(/ +$/, '');
    }
    return out;
  }

  function styleOf(el, st) {
    var o = {};
    for (var k in st) if (st.hasOwnProperty(k)) o[k] = st[k];
    var tag = el.tagName.toUpperCase();
    if (tag === 'B' || tag === 'STRONG' || /^H[1-6]$/.test(tag) || tag === 'TH') o.bold = true;
    if (tag === 'I' || tag === 'EM' || tag === 'CITE') o.italic = true;
    if (tag === 'U' || tag === 'INS') o.underline = 1;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') o.strike = true;
    if (tag === 'FONT') {
      var fc = hexOf(el.getAttribute('color'));
      if (fc) o.color = fc;
      var fs = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24, 7: 36 }[parseInt(el.getAttribute('size'), 10)];
      if (fs) o.sizeHu = fs * 100;
    }

    var s = el.style;
    if (!s) return o;
    var w = s.fontWeight;
    if (w) o.bold = w === 'bold' || w === 'bolder' || parseInt(w, 10) >= 600;
    if (s.fontStyle) o.italic = s.fontStyle === 'italic' || s.fontStyle === 'oblique';
    var deco = s.textDecorationLine || s.textDecoration || '';
    if (deco) {
      o.underline = deco.indexOf('underline') >= 0 ? 1 : 0;
      o.strike = deco.indexOf('line-through') >= 0;
    }
    var col = hexOf(s.color);
    if (col) o.color = col;
    var m = /^([\d.]+)(pt|px)$/.exec(s.fontSize || '');
    if (m) {
      var pt = parseFloat(m[1]) * (m[2] === 'px' ? 0.75 : 1);
      if (pt > 0) o.sizeHu = Math.round(Math.max(1, Math.min(4096, pt)) * 100);
    }
    return o;
  }

  function hexOf(c) {
    if (!c) return null;
    var m = /^#([0-9a-f]{6})$/i.exec(c);
    if (m) return '#' + m[1].toUpperCase();
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
    if (m) return ('#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(c);
    if (!m || (m[4] !== undefined && parseFloat(m[4]) === 0)) return null;
    var hex = '#';
    for (var i = 1; i <= 3; i++) hex += ('0' + Math.min(255, parseInt(m[i], 10)).toString(16)).slice(-2);
    return hex.toUpperCase();
  }

  /* 우클릭 메뉴의 클립보드 항목. ★ 잘라내기·복사는 execCommand 로 위의 copy·cut 수신기를 태운다 — 사용자 누르기(제스처) 안에서만
     된다. 안 되면(false) 클립보드 API 로 한 번 더 싣는다. 붙여넣기는 스크립트가 클립보드를 못 읽으므로 C# 에 묻는다(hwPasteData). */
  function clip(kind) {
    if (!hwDoc) return;
    if (kind === 'paste') { hwPost({ t: 'paste' }); return; }
    if (kind === 'delete') { edit(function () { dropSelection(); return null; }); return; }

    focus();
    var done = false;
    try { done = document.execCommand(kind); } catch (e) { done = false; }
    if (done) return;

    var dt = new DataTransfer();
    if (!putClip(dt)) return;
    if (!navigator.clipboard || !window.ClipboardItem) {
      hwSetStatus({ text: '클립보드에 쓸 수 없습니다 — Ctrl+C·Ctrl+X 를 쓰세요' });
      return;
    }
    /* ★ 오려 두기는 클립보드에 <b>실린 뒤에</b> 지운다 — 먼저 지우면 쓰기가 실패했을 때 고른 글이 어디에도 없이 사라진다. */
    navigator.clipboard.write([new ClipboardItem({
      'text/plain': new Blob([dt.getData('text/plain')], { type: 'text/plain' }),
      'text/html': new Blob([dt.getData('text/html')], { type: 'text/html' })
    })]).then(function () {
      if (kind === 'cut') edit(function () { dropSelection(); return null; });
    })['catch'](function () {
      hwSetStatus({ text: '클립보드에 쓰지 못했습니다 — Ctrl+C·Ctrl+X 를 쓰세요' });
    });
  }

  function remapClip(csMap, psMap) {
    if (!cClip) return;
    for (var i = 0; i < cClip.paras.length; i++) {
      var q = cClip.paras[i];
      if (psMap && q.ps < psMap.length) q.ps = psMap[q.ps];
      for (var r = 0; r < q.runs.length; r++) if (csMap && q.runs[r].cs < csMap.length) q.runs[r].cs = csMap[q.runs[r].cs];
    }
  }

  function inSelection(h) {
    var sel = hwCaret.selection();
    if (!sel) return false;
    var o = hwModel.orderOf(h.id), a = hwModel.orderOf(sel.fromId), b = hwModel.orderOf(sel.toId);
    if (o < a || o > b) return false;
    if (o === a && h.pos < sel.fromPos) return false;
    if (o === b && h.pos > sel.toPos) return false;
    return true;
  }

  /* ★ 셀 블록 안의 칸을 누른 우클릭도 캐럿을 안 옮긴다 — 옮기면 hwCaret.set 이 블록을 풀어, 메뉴의
     "셀 합치기"·"너비를 같게" 가 <b>늘 흐리게</b> 뜬다. 글자 선택 안에서 우클릭할 때와 같은 규칙이다. */
  function inBlock(h) {
    var b = window.hwTable ? hwTable.blockCells() : null;
    if (!b) return false;
    var p = hwModel.byId(h.id);
    if (!p || !p._cell) return false;
    for (var i = 0; i < b.cells.length; i++) if (b.cells[i] === p._cell) return true;
    return false;
  }

  /* 우클릭(덤프 7): 선택 안이나 개체 위면 캐럿을 안 옮기고, 아니면 옮긴 뒤 띄운다.
     ★ 오른쪽 단추 mousedown 은 onMouseDown 이 안 막아 초점이 수신기에서 빠진다 — 여기서 되돌려야 메뉴를 닫은 뒤 키가 산다. */
  function onContextMenu(e) {
    e.preventDefault();
    if (!hwDoc) return;
    clearChord();

    var od = e.target.closest ? e.target.closest('.hw-obj[data-para]') : null;
    var kind;
    if (od && window.hwObj) {
      hwObj.select(od.getAttribute('data-para'), parseInt(od.getAttribute('data-pos'), 10));
      kind = 'obj';
    } else {
      if (window.hwObj) hwObj.clear();
      var hit = hwCaret.hitTest(e.clientX, e.clientY);
      if (hit && !inSelection(hit) && !inBlock(hit)) hwCaret.set(hit.id, hit.pos, false);
      kind = hwTable.here() ? 'cell' : 'body';
    }
    focus();
    syncIme();
    hwUi.showMenu(hwUi.contextItems(kind), e.clientX, e.clientY);
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
    undo: undo,
    redo: redo,
    clip: clip,
    pasteData: pasteData,
    remapClip: remapClip,
    dropClip: function () { cClip = null; },
    status: status,
    isComposing: function () { return cComposing; }
  };
})();

/* C# 이 파일 대화상자로 고른 그림을 넘겨준다. */
function hwInsertImage(info) { hwInput.insertImage(info); }

/* 우클릭 붙여넣기 — C# 이 클립보드를 읽어 돌려준다({text, html}). */
function hwPasteData(d) { hwInput.pasteData(d); }
