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

    on(['C+z'], function () { if (hwUndo.undo()) status(); });
    on(['CS+z'], function () { if (hwUndo.redo()) status(); });
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
