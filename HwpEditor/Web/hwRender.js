/* 쪽 → DOM.

   ★ 줄을 절대 좌표로 놓는다. 브라우저의 줄 나눔에 맡기면 우리가 계산한 줄과 화면이 달라져서,
     오라클이 통과해도 화면이 그것과 다른 상태가 될 수 있다. 화면은 우리 계산의 그림이어야 한다.
   ★ 가상 스크롤: 보이는 쪽 ±2 쪽만 내용을 채우고 나머지는 빈 상자로 둔다(G-5).
   ★ 캐럿·선택은 본문 위에 <b>따로 얹는다</b> — 글자 사이에 끼워 넣으면 그 문단만 줄이 다시
     흐르면서 우리가 계산한 배치와 어긋난다. */

var hwRenderer = (function () {
  'use strict';

  var cCanvas = null;
  var cPageEls = [];

  /* 인쇄할 때는 가상 스크롤을 끈다 — 안 보이는 쪽은 비어 있어서 그대로 PDF 로 나간다. */
  var cFillAll = false;

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
    if (window.hwCaret) hwCaret.paint();
  }

  function fillVisible() {
    if (!cCanvas) return;
    var top = cCanvas.scrollTop, h = cCanvas.clientHeight;

    for (var i = 0; i < cPageEls.length; i++) {
      var box = cPageEls[i];
      var y0 = box.offsetTop - cCanvas.offsetTop, y1 = y0 + box.offsetHeight;
      var near = cFillAll || (y1 > top - h * 2 && y0 < top + h * 3);

      if (near && !box._hwFilled) { fillPage(i); box._hwFilled = true; }
      else if (!near && box._hwFilled) { box.innerHTML = ''; box._hwFilled = false; }
    }
    if (window.hwCaret) hwCaret.paint();
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

    /* ★ 표 테두리를 <b>줄보다 먼저</b> 깔아 둔다. 뒤에 그리면 칸 배경이 글자를 덮는다. */
    for (var t = 0; t < (pg.tables || []).length; t++) tableEl(body, pg.tables[t]);

    for (var i = 0; i < pg.lines.length; i++) body.appendChild(lineEl(pg.lines[i]));
  }

  /* 표 한 개의 테두리·칸. 글자는 이미 보통 줄로 따로 놓이므로 여기서는 칸만 그린다(5단계). */
  function tableEl(body, obj) {
    var at = obj._at, grid = obj._grid;
    if (!at || !grid) return;

    var box = el('div', 'hw-table');
    box.style.left = hwHu2Px(at.xHu) + 'px';
    box.style.top = hwHu2Px(at.yHu) + 'px';
    box.style.width = hwHu2Px(grid.wHu) + 'px';
    box.style.height = hwHu2Px(grid.hHu) + 'px';

    for (var i = 0; i < grid.cells.length; i++) {
      var r = grid.cells[i];
      var c = el('div', 'hw-cell');
      c.style.left = hwHu2Px(r.xHu) + 'px';
      c.style.top = hwHu2Px(r.yHu) + 'px';
      c.style.width = hwHu2Px(r.wHu) + 'px';
      c.style.height = hwHu2Px(r.hHu) + 'px';
      box.appendChild(c);
    }

    body.appendChild(box);
  }

  function lineEl(item) {
    var para = item.para, ln = item.line;
    var d = el('div', 'hw-line');
    d.style.left = hwHu2Px(item.xHu) + 'px';
    d.style.top = hwHu2Px(item.yHu) + 'px';
    d.style.height = hwHu2Px(ln.hHu) + 'px';
    d.style.width = hwHu2Px(ln.availHu) + 'px';
    d.setAttribute('data-id', para.id);
    d.setAttribute('data-li', String(item.li));

    var text = hwModel.text(para);
    var cur = null, curKey = '', curW = 0, curRatio = 1;
    var w = 0;

    /* 장평이 걸린 묶음은 <b>바깥 폭을 손으로 잡아 준다</b>. 안쪽은 scaleX 로 늘어나는데
       그 변형은 배치 폭을 안 바꾸므로, 폭을 안 주면 다음 묶음이 늘어난 만큼 앞으로 당겨진다. */
    function closeRun() {
      if (cur && curRatio !== 1) cur.style.width = hwHu2Px(curW) + 'px';
      cur = null; curKey = ''; curW = 0; curRatio = 1;
    }

    for (var k = ln.s; k < ln.e; k++) {
      var ch = text.charAt(k);
      var cw = hwBreak.charWidth(para, k, w);

      if (ch === '\n') continue;                    /* 폭 0, 그릴 것도 없다 */

      if (ch === '￼') {
        var o = objAt(para, k);
        var box = objEl(para, k);

        if (box) {
          /* ★ 떠 있는 개체는 줄의 폭을 안 먹는다(계획 U-5). 줄 안에 흘려 넣으면 그 뒤 글자가
             개체 폭만큼 오른쪽으로 밀려서, 우리가 계산한 캐럿 자리와 화면이 갈라진다
             (실측 — 표지 문단의 그리기 개체 하나가 캐럿을 한 글자 넘게 밀었다). */
          if (o && !o.inline) {
            box.style.position = 'absolute';
            box.style.left = hwHu2Px(sane(o.xOffHu)) + 'px';
            box.style.top = hwHu2Px(sane(o.yOffHu)) + 'px';
          }
          d.appendChild(box);
        }

        closeRun();
        w += cw;
        continue;
      }

      /* ★ 탭은 <b>다음 탭 자리까지</b>다. 공백 한 칸으로 그리면 그 뒤 글자가 통째로 왼쪽으로
         당겨져서, 우리가 계산한 캐럿 자리와 화면이 한 글자 넘게 어긋난다(실측 340px). */
      if (ch === '\t') {
        closeRun();
        d.appendChild(spacer(cw));
        w += cw;
        continue;
      }

      var csId = hwModel.shapeAt(para, k);
      var cs = hwModel.charShape(csId);

      /* ★ 우리가 재는 폭과 브라우저가 그리는 폭이 다르다 — 한글·전각은 1em, 공백은 0.5em 으로
         재는데(계획 U-7) 대체 글꼴(나눔)의 실제 폭은 그보다 좁다. 그 차이를 자간으로 메우지 않으면
         줄 뒤로 갈수록 캐럿이 글자 앞에 선다. 차이가 같은 글자끼리 묶어 span 하나로 낸다. */
      /* ★ 장평(ratio)은 <b>두 번 세면 안 된다</b>. 우리 폭(cw)에는 이미 장평이 들어 있는데
         화면은 그것을 scaleX 로 또 늘린다 — 자간을 그대로 주면 늘어난 배만큼 벌어져서
         장평 200% 구간에서 캐럿이 33px 앞에 섰다(실측 sample-5017.hwp). 안쪽에는 <b>늘어나기 전</b>
         값을 주고, 늘어난 결과가 cw 가 되게 한다. */
      var ratio = (cs.ratio && cs.ratio !== 100) ? cs.ratio / 100 : 1;
      var extra = cw / ratio - hwMeasure.naturalHu(ch, cs);
      var key = csId + '|' + Math.round(extra * 100);

      if (key !== curKey || !cur) {
        closeRun();
        cur = el('span', 'hw-run');
        applyCs(cur, cs);
        cur.style.letterSpacing = hwHu2Px(extra) + 'px';
        d.appendChild(cur);
        curKey = key;
        curRatio = ratio;
      }
      cur.appendChild(document.createTextNode(ch));
      curW += cw;
      w += cw;
    }

    closeRun();
    return d;
  }

  /* 개체 좌표의 안전선(HWPUNIT). 용지 두 장 밖으로 나가는 값은 문서가 깨진 것으로 보고 0 으로 접는다.
     ★ 브라우저 좌표에는 상한(약 3,300만 px)이 있어서, 터무니없는 값 하나가 인쇄 쪽 수를 만 단위로
       불린다(실측 — 부호를 잘못 읽은 오프셋 하나가 PDF 를 19,926쪽으로 만들었다). */
  var cSaneHu = 200000;

  function sane(v) {
    var n = v || 0;
    return (n > cSaneHu || n < -cSaneHu) ? 0 : n;
  }

  /* 글자가 아닌 자리(탭·안 그리는 개체)를 폭만큼 밀어 준다. */
  function spacer(wHu) {
    var s = el('span', 'hw-gap');
    s.style.width = hwHu2Px(wHu) + 'px';
    return s;
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
    /* ★ 자간(cs.spacing)은 여기서 안 준다 — 이미 hwBreak.charWidth 가 폭에 넣었고,
       lineEl 이 그 폭과 실제 글꼴 폭의 차이를 letterSpacing 으로 한 번에 준다. 두 번 주면 겹친다. */
  }

  /* 개체 하나. 그림은 실제로 그리고(3단계), 나머지는 크기만 잡은 회색 상자다.
     ★ 안 보이는 컨트롤(용지·단 정의)은 <b>아무것도 안 그린다</b> — 자리는 모델에만 있으면 된다.
       상자를 그리면 첫 문단 앞에 정체 모를 회색 조각이 두 개 뜬다. */
  function objAt(para, pos) {
    for (var i = 0; i < (para.objs || []).length; i++) if (para.objs[i].pos === pos) return para.objs[i];
    return null;
  }

  function objEl(para, pos) {
    var o = objAt(para, pos);
    if (!o || o.hidden) return null;

    /* ★ 크기가 0 인 인라인 개체는 아예 안 그린다. 테두리 1px 두 줄이 <b>2px 를 먹어서</b>
       그 뒤 글자가 밀리는데, 우리 배치는 0 으로 세고 있어 딱 그만큼 캐럿이 어긋난다. */
    if (o.inline && (o.wHu || 0) <= 0) return null;

    if (o.kind === 'image' && o.src) {
      var img = document.createElement('img');
      img.className = 'hw-obj hw-obj-img';
      img.src = o.src;
      img.style.width = hwHu2Px(o.wHu) + 'px';
      img.style.height = hwHu2Px(o.hHu) + 'px';
      img.alt = '';
      return img;
    }

    var d = el('span', 'hw-obj hw-obj-' + (o.kind || 'opaque'));
    d.style.width = hwHu2Px(o.wHu) + 'px';
    d.style.height = hwHu2Px(o.hHu) + 'px';
    d.title = (o.label || o.kind || '') + (o.ctrl ? ' (' + o.ctrl + ')' : '');
    if (o.label) d.setAttribute('data-label', o.label);
    return d;
  }

  /* 쪽 번호 → 그 쪽의 본문 영역 DOM. 캐럿·선택을 얹을 자리다. 아직 안 채운 쪽이면 null. */
  function bodyOf(pageIdx) {
    var box = cPageEls[pageIdx];
    if (!box || !box._hwFilled) return null;
    return box.querySelector('.hw-body');
  }

  function pageElOf(pageIdx) { return cPageEls[pageIdx] || null; }

  function canvas() { return cCanvas; }

  /* PDF 로 뽑기 전에 모든 쪽을 채운다(7단계). 끝나면 다시 가상 스크롤로 돌아간다. */
  function fillAll(on) {
    cFillAll = !!on;
    fillVisible();
  }

  return {
    render: render,
    refresh: fillVisible,
    fillAll: fillAll,
    bodyOf: bodyOf,
    pageElOf: pageElOf,
    canvas: canvas
  };
})();

function hwRender() { return hwRenderer.render(); }
function hwRenderRefresh() { return hwRenderer.refresh(); }

/* 편집 뒤 다시 그리기. ★ 배치를 다시 하고 나서 그린다 — 문단 하나가 길어지면 그 뒤 문단의
   쪽이 통째로 밀리므로, 그 문단만 다시 그리는 것으로는 화면이 맞지 않는다.
   비싼 것은 줄 나눔인데 그건 고친 문단만 다시 한다(hwBreak.linesOf 캐시). */
function hwRelayout() {
  hwLayout();
  hwRender();
}
