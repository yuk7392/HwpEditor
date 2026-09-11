/* ★ 브라우저 선택을 쓰지 않는다(본문은 user-select:none). 우리 줄 나눔과 브라우저의 줄 나눔이
     다르면 캐럿이 글자 사이가 아니라 엉뚱한 데 서기 때문이다. 좌표는 전부 우리 배치(hwPages)에서 낸다.
   ★ 글자 폭은 hwBreak.charWidth 하나만 쓴다 — 줄을 나눌 때와 캐럿을 놓을 때 다른 자를 쓰면
     줄 끝에서만 한 글자씩 어긋난다. */

var hwCaret = (function () {
  'use strict';

  var cId = null, cPos = 0;
  var cAnchorId = null, cAnchorPos = 0;

  /* 위·아래로 움직일 때 유지할 가로 위치(HWPUNIT). 짧은 줄을 지나도 원래 칸으로 돌아온다. */
  var cPrefX = -1;

  var cEl = null;

  function first() {
    for (var si = 0; si < hwDoc.sections.length; si++)
      if (hwDoc.sections[si].paras.length) return hwDoc.sections[si].paras[0];
    return null;
  }

  function reset() {
    var p = first();
    cId = p ? p.id : null;
    cPos = 0;
    cAnchorId = cId;
    cAnchorPos = 0;
    cPrefX = -1;
    paint();
  }

  function at() { return { id: cId, pos: cPos }; }

  function para() { return cId ? hwModel.byId(cId) : null; }

  function set(id, pos, extend) {
    var p = hwModel.byId(id);
    if (!p) return;
    /* 캐럿이 움직이면 대기 중인 서식은 버린다 — 다른 자리에 걸리면 뜻이 없다. */
    if (window.hwFormat && (id !== cId || pos !== cPos)) hwFormat.clearPending();
    cId = id;
    cPos = Math.max(0, Math.min(pos, p.len));
    if (!extend) { cAnchorId = cId; cAnchorPos = cPos; }
    cPrefX = -1;
    paint();
  }

  function selection() {
    if (cId === null || cAnchorId === null) return null;
    if (cId === cAnchorId && cPos === cAnchorPos) return null;

    var a = { id: cAnchorId, pos: cAnchorPos }, b = { id: cId, pos: cPos };
    var oa = hwModel.orderOf(a.id), ob = hwModel.orderOf(b.id);
    if (oa > ob || (oa === ob && a.pos > b.pos)) { var t = a; a = b; b = t; }
    return { fromId: a.id, fromPos: a.pos, toId: b.id, toPos: b.pos };
  }

  function clearSelection() { cAnchorId = cId; cAnchorPos = cPos; }

  /* 문단 안의 위치가 놓인 줄. 줄 경계에서는 <b>다음 줄의 머리</b>를 고른다(한글과 같다). */
  function lineOf(id, pos) {
    var lines = hwLineIndex[id];
    if (!lines || !lines.length) return null;

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].line;
      if (pos < ln.e || i === lines.length - 1) return lines[i];
    }
    return lines[lines.length - 1];
  }

  /* 줄 안에서 위치까지의 가로 거리(HWPUNIT). 정렬 몫(앞 여백·늘린 폭)까지 들어간다.
     ★ 탭 폭은 <b>정렬 몫을 뺀</b> 누적 폭으로 잰다 — 줄 나눔(hwBreak)이 그 값으로 탭 자리를 정했다. */
  function offsetIn(item, pos) {
    var p = item.para, ln = item.line;
    var w = 0, x = ln.lead || 0;
    for (var k = ln.s; k < pos && k < ln.e; k++) {
      var cw = hwBreak.charWidth(p, k, w);
      w += cw;
      x += cw + hwBreak.extraAt(p, ln, k);
    }
    return x;
  }

  function coord(id, pos) {
    var item = lineOf(id, pos);
    if (!item) return null;

    return {
      item: item,
      pageIdx: item.pageIdx,
      xHu: item.xHu + offsetIn(item, pos),
      yHu: item.yHu + Math.max(0, item.line.hHu - item.line.thHu),
      hHu: item.line.thHu
    };
  }

  function paint() {
    if (window.hwUi) hwUi.refresh();
    if (cEl && cEl.parentNode) cEl.parentNode.removeChild(cEl);
    paintSelection();

    /* ★ 개체 테두리·조절점도 여기서 같이 다시 그린다 — 가상 스크롤이 쪽을 다시 채울 때마다
       부르는 자리가 여기라(hwRender.fillVisible), 따로 걸면 스크롤 뒤에 조절점만 사라진다.
       개체를 고른 동안에는 캐럿을 안 그린다 — 깜빡이는 막대와 테두리가 같이 보이면 무엇이
       골라졌는지 알 수 없다. 캐럿 <b>자리</b>는 그대로 두므로 되돌리기·지우기는 그 문단을 잡는다. */
    var objSel = window.hwObj ? hwObj.current() : null;
    if (window.hwObj) hwObj.paint();
    if (objSel) return;

    if (cId === null) return;

    var c = coord(cId, cPos);
    if (!c) return;

    var body = hwRenderer.bodyOf(c.pageIdx);
    if (!body) return;

    if (!cEl) { cEl = document.createElement('div'); cEl.className = 'hw-caret'; }
    cEl.style.left = hwHu2Px(c.xHu) + 'px';
    cEl.style.top = hwHu2Px(c.yHu) + 'px';
    cEl.style.height = hwHu2Px(c.hHu) + 'px';
    body.appendChild(cEl);
  }

  function paintSelection() {
    var olds = document.querySelectorAll('.hw-sel');
    for (var i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i]);

    var sel = selection();
    if (!sel) return;

    var from = hwModel.orderOf(sel.fromId), to = hwModel.orderOf(sel.toId);

    var all = hwModel.allParas();
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      var ord = hwModel.orderOf(p.id);
      if (ord < from || ord > to) continue;

      var a = ord === from ? sel.fromPos : 0;
      var b = ord === to ? sel.toPos : p.len;
      paintParaSelection(p, a, b);
    }
  }

  function paintParaSelection(p, from, to) {
    var lines = hwLineIndex[p.id];
    if (!lines) return;

    for (var i = 0; i < lines.length; i++) {
      var it = lines[i], ln = it.line;
      var a = Math.max(from, ln.s), b = Math.min(to, i === lines.length - 1 ? p.len : ln.e);
      if (b <= a) continue;

      var body = hwRenderer.bodyOf(it.pageIdx);
      if (!body) continue;

      var x0 = offsetIn(it, a), x1 = offsetIn(it, b);
      if (x1 <= x0) x1 = x0 + 200;   /* 빈 줄도 눈에 보이게 얇게 칠한다 */

      var d = document.createElement('div');
      d.className = 'hw-sel';
      d.style.left = hwHu2Px(it.xHu + x0) + 'px';
      d.style.top = hwHu2Px(it.yHu + Math.max(0, ln.hHu - ln.thHu)) + 'px';
      d.style.width = hwHu2Px(x1 - x0) + 'px';
      d.style.height = hwHu2Px(ln.thHu) + 'px';
      body.appendChild(d);
    }
  }

  function hitTest(clientX, clientY) {
    var el = document.elementFromPoint(clientX, clientY);
    var pageEl = el && el.closest ? el.closest('.hw-page') : null;
    if (!pageEl) return null;

    var idx = parseInt(pageEl.getAttribute('data-page'), 10);
    var body = pageEl.querySelector('.hw-body');
    if (!body || isNaN(idx) || !hwPages[idx]) return null;

    var r = body.getBoundingClientRect();
    var xHu = hwPx2Hu(clientX - r.left);
    var yHu = hwPx2Hu(clientY - r.top);

    var lines = hwPages[idx].lines;
    if (!lines.length) return null;

    /* 세로로 가장 가까운 줄 → 그중 가로로 가장 가까운 줄. 줄 밖을 눌러도 캐럿이 선다. */
    var best = null, bestD = Infinity;
    for (var i = 0; i < lines.length; i++) {
      var it = lines[i], ln = it.line;
      var dy = yHu < it.yHu ? it.yHu - yHu : (yHu > it.yHu + ln.hHu ? yHu - (it.yHu + ln.hHu) : 0);
      var dx = xHu < it.xHu ? it.xHu - xHu : (xHu > it.xHu + ln.availHu ? xHu - (it.xHu + ln.availHu) : 0);
      var d = dy * 1000 + dx;
      if (d < bestD) { bestD = d; best = it; }
    }
    if (!best) return null;

    return { id: best.para.id, pos: posInLine(best, xHu - best.xHu) };
  }

  /* 줄 안에서 x 에 가장 가까운 글자 경계. 글자의 절반을 넘기면 그 다음 자리다. */
  function posInLine(item, dx) {
    var p = item.para, ln = item.line;
    var w = 0, x = ln.lead || 0;
    for (var k = ln.s; k < ln.e; k++) {
      var cw = hwBreak.charWidth(p, k, w);
      var adv = cw + hwBreak.extraAt(p, ln, k);
      if (dx < x + adv / 2) return k;
      w += cw;
      x += adv;
    }
    /* 마지막 줄이 아니면 줄바꿈 자리에 캐럿을 두지 않는다 — 다음 줄 머리와 겹친다. */
    var last = hwLineIndex[p.id];
    var isLast = last && last[last.length - 1] === item;
    return isLast ? p.len : ln.e;
  }

  function moveH(delta, extend) {
    var p = para();
    if (!p) return;

    var pos = cPos + delta;
    if (pos < 0) {
      var prev = hwModel.before(p);
      if (!prev) { pos = 0; }
      else { cId = prev.id; pos = prev.len; }
    } else if (pos > p.len) {
      var next = hwModel.after(p);
      if (!next) { pos = p.len; }
      else { cId = next.id; pos = 0; }
    }

    cPos = pos;
    if (!extend) clearSelection();
    cPrefX = -1;
    paint();
    scrollIntoView();
  }

  function moveV(delta, extend) {
    var c = coord(cId, cPos);
    if (!c) return;
    if (cPrefX < 0) cPrefX = c.xHu;

    var flat = flatLines();
    var at = flat.indexOf(c.item);
    var to = at + delta;
    if (at < 0 || to < 0 || to >= flat.length) return;

    var item = flat[to];
    cId = item.para.id;
    cPos = posInLine(item, cPrefX - item.xHu);
    if (!extend) clearSelection();

    var keep = cPrefX;
    paint();
    cPrefX = keep;
    scrollIntoView();
  }

  /* 쪽을 이어 붙인 줄 목록. 위·아래 이동은 문단이 아니라 줄을 따라간다. */
  function flatLines() {
    var out = [];
    for (var pg = 0; pg < hwPages.length; pg++)
      for (var i = 0; i < hwPages[pg].lines.length; i++) out.push(hwPages[pg].lines[i]);
    return out;
  }

  function home(extend) {
    var c = coord(cId, cPos);
    if (!c) return;
    cPos = c.item.line.s;
    if (!extend) clearSelection();
    cPrefX = -1;
    paint();
  }

  function end(extend) {
    var c = coord(cId, cPos);
    if (!c) return;
    var p = para();
    var lines = hwLineIndex[cId];
    var isLast = lines && lines[lines.length - 1] === c.item;
    cPos = isLast ? p.len : c.item.line.e;
    if (!extend) clearSelection();
    cPrefX = -1;
    paint();
  }

  function page(delta, extend) {
    var canvas = hwRenderer.canvas();
    if (!canvas) return;
    var rows = Math.max(1, Math.round(canvas.clientHeight / 24));
    moveV(delta * rows, extend);
  }

  function selectAll() {
    var f = first();
    if (!f) return;
    /* ★ 마지막 문단은 표 칸 안일 수 있다 — 문서 순서(cOrder)의 끝을 그대로 쓴다. */
    var all = hwModel.allParas();
    var lastP = all.length ? all[all.length - 1] : null;
    if (!lastP) return;
    cAnchorId = f.id; cAnchorPos = 0;
    cId = lastP.id; cPos = lastP.len;
    paint();
  }

  function scrollIntoView() {
    var c = coord(cId, cPos);
    if (!c) return;
    var canvas = hwRenderer.canvas();
    var pageEl = hwRenderer.pageElOf(c.pageIdx);
    if (!canvas || !pageEl) return;

    var body = hwRenderer.bodyOf(c.pageIdx);
    var top = pageEl.offsetTop - canvas.offsetTop + (body ? body.offsetTop : 0) + hwHu2Px(c.yHu);
    var h = hwHu2Px(c.hHu);

    if (top < canvas.scrollTop) canvas.scrollTop = Math.max(0, top - 40);
    else if (top + h > canvas.scrollTop + canvas.clientHeight)
      canvas.scrollTop = top + h - canvas.clientHeight + 40;
  }

  return {
    reset: reset,
    at: at,
    para: para,
    set: set,
    selection: selection,
    clearSelection: clearSelection,
    coord: coord,
    paint: paint,
    hitTest: hitTest,
    moveH: moveH,
    moveV: moveV,
    home: home,
    end: end,
    page: page,
    selectAll: selectAll,
    scrollIntoView: scrollIntoView
  };
})();

function hwCaretTo(id, pos, extend) { hwCaret.set(id, pos, extend); }
function hwHitTest(x, y) { return hwCaret.hitTest(x, y); }
