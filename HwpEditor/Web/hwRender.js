/* 쪽 → DOM. 1단계는 보기만 한다(캐럿·선택은 2단계).

   ★ 줄을 절대 좌표로 놓는다. 브라우저의 줄 나눔에 맡기면 우리가 계산한 줄과 화면이 달라져서,
     오라클이 통과해도 화면이 그것과 다른 상태가 될 수 있다. 화면은 우리 계산의 그림이어야 한다.
   ★ 가상 스크롤: 보이는 쪽 ±2 쪽만 내용을 채우고 나머지는 빈 상자로 둔다(G-5). */

var hwRenderer = (function () {
  'use strict';

  var cCanvas = null;
  var cPageEls = [];

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function render() {
    cCanvas = document.getElementById('hwCanvas');
    if (!cCanvas) return;
    cCanvas.innerHTML = '';
    cPageEls = [];

    for (var i = 0; i < hwPages.length; i++) {
      var pg = hwPages[i];
      var box = el('div', 'hw-page');
      box.style.width = hwHu2Px(pg.page.wHu) + 'px';
      box.style.height = hwHu2Px(pg.page.hHu) + 'px';
      box.setAttribute('data-page', String(i));
      cCanvas.appendChild(box);
      cPageEls.push(box);
    }

    fillVisible();
    if (!cCanvas._hwScroll) {
      cCanvas.addEventListener('scroll', fillVisible);
      cCanvas._hwScroll = true;
    }
  }

  function fillVisible() {
    if (!cCanvas) return;
    var top = cCanvas.scrollTop, h = cCanvas.clientHeight;

    for (var i = 0; i < cPageEls.length; i++) {
      var box = cPageEls[i];
      var y0 = box.offsetTop - cCanvas.offsetTop, y1 = y0 + box.offsetHeight;
      var near = y1 > top - h * 2 && y0 < top + h * 3;

      if (near && !box._hwFilled) { fillPage(i); box._hwFilled = true; }
      else if (!near && box._hwFilled) { box.innerHTML = ''; box._hwFilled = false; }
    }
  }

  function fillPage(idx) {
    var pg = hwPages[idx], box = cPageEls[idx];
    var p = pg.page;

    var body = el('div', 'hw-body');
    body.style.left = hwHu2Px(p.mlHu + (p.gutHu || 0)) + 'px';
    body.style.top = hwHu2Px(p.mtHu + (p.mhHu || 0)) + 'px';
    body.style.width = hwHu2Px(p.wHu - p.mlHu - p.mrHu - (p.gutHu || 0)) + 'px';
    body.style.height = hwHu2Px(p.hHu - p.mtHu - p.mbHu - (p.mhHu || 0) - (p.mfHu || 0)) + 'px';
    box.appendChild(body);

    for (var i = 0; i < pg.lines.length; i++) body.appendChild(lineEl(pg.lines[i]));
  }

  function lineEl(item) {
    var para = item.para, ln = item.line;
    var d = el('div', 'hw-line');
    d.style.left = hwHu2Px(item.xHu) + 'px';
    d.style.top = hwHu2Px(item.yHu) + 'px';
    d.style.height = hwHu2Px(ln.hHu) + 'px';
    d.style.width = hwHu2Px(ln.availHu) + 'px';
    d.setAttribute('data-id', para.id);

    var text = hwModel.text(para);
    var cur = null, curCs = -1;

    for (var k = ln.s; k < ln.e; k++) {
      var ch = text.charAt(k);
      if (ch === '\n') continue;

      if (ch === '￼') { d.appendChild(objEl(para, k)); cur = null; curCs = -1; continue; }

      var csId = hwModel.shapeAt(para, k);
      if (csId !== curCs || !cur) {
        cur = el('span', 'hw-run');
        applyCs(cur, hwModel.charShape(csId));
        d.appendChild(cur);
        curCs = csId;
      }
      cur.appendChild(document.createTextNode(ch === '\t' ? ' ' : ch));
    }

    return d;
  }

  function applyCs(span, cs) {
    var face = hwModel.faceName(cs.face);
    span.style.fontFamily = '"' + ((face && face.sub) || 'NanumGothicHW') + '"';
    span.style.fontSize = hwHu2Px(cs.sizeHu) + 'px';
    if (cs.bold) span.style.fontWeight = '700';
    if (cs.italic) span.style.fontStyle = 'italic';
    if (cs.color) span.style.color = cs.color;
    if (cs.underline) span.style.textDecoration = 'underline';
    if (cs.strike) span.style.textDecoration = (cs.underline ? 'underline ' : '') + 'line-through';
    if (cs.ratio && cs.ratio !== 100) {
      span.style.display = 'inline-block';
      span.style.transform = 'scaleX(' + (cs.ratio / 100) + ')';
      span.style.transformOrigin = 'left';
    }
    if (cs.spacing) span.style.letterSpacing = hwHu2Px(cs.sizeHu * cs.spacing / 100) + 'px';
  }

  /* 1단계의 개체는 전부 크기만 잡은 회색 상자다(그림 표시는 3단계). */
  function objEl(para, pos) {
    var o = null;
    for (var i = 0; i < (para.objs || []).length; i++) if (para.objs[i].pos === pos) { o = para.objs[i]; break; }

    var d = el('span', 'hw-obj hw-obj-' + ((o && o.kind) || 'opaque'));
    if (o) {
      d.style.width = hwHu2Px(o.wHu) + 'px';
      d.style.height = hwHu2Px(o.hHu) + 'px';
      d.title = (o.label || o.kind || '') + (o.ctrl ? ' (' + o.ctrl + ')' : '');
      if (o.label) d.setAttribute('data-label', o.label);
    }
    return d;
  }

  return { render: render, refresh: fillVisible };
})();

function hwRender() { return hwRenderer.render(); }
function hwRenderRefresh() { return hwRenderer.refresh(); }
