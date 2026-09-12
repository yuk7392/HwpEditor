/* ★ 줄을 절대 좌표로 놓는다. 브라우저의 줄 나눔에 맡기면 우리가 계산한 줄과 화면이 달라져서,
     오라클이 통과해도 화면이 그것과 다른 상태가 될 수 있다. 화면은 우리 계산의 그림이어야 한다.
   ★ 가상 스크롤: 보이는 쪽 ±2 쪽만 내용을 채우고 나머지는 빈 상자로 둔다.
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
      box.style.width = hwHu2Px(hwPageW(pg.page)) + 'px';
      box.style.height = hwHu2Px(hwPageH(pg.page)) + 'px';
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
    body.style.width = hwHu2Px(hwPageW(p) - p.mlHu - p.mrHu - (p.gutHu || 0)) + 'px';
    body.style.height = hwHu2Px(hwPageH(p) - p.mtHu - p.mbHu - (p.mhHu || 0) - (p.mfHu || 0)) + 'px';
    box.appendChild(body);

    /* ★ 표 테두리를 <b>줄보다 먼저</b> 깔아 둔다. 뒤에 그리면 칸 배경이 글자를 덮는다. */
    for (var t = 0; t < (pg.tables || []).length; t++) tableEl(body, pg.tables[t]);

    paraBoxes(body, pg);
    paraHeads(body, pg);

    for (var i = 0; i < pg.lines.length; i++) body.appendChild(lineEl(pg.lines[i]));

    if (pg.pnum) body.appendChild(pageNumEl(pg.pnum));
  }

  /* 쪽 번호. 문단이 아니라 컨트롤이 만든 한 자리라 줄 목록에 안 넣는다 — 캐럿이 설 곳이 아니다. */
  function pageNumEl(n) {
    var d = el('div', 'hw-pagenum');
    d.style.left = hwHu2Px(n.xHu) + 'px';
    d.style.top = hwHu2Px(n.yHu) + 'px';
    d.style.width = hwHu2Px(n.widthHu) + 'px';
    d.style.textAlign = n.align;
    d.textContent = n.text;
    return d;
  }

  /* 테두리 한 변 → CSS. 굵기는 mm 문자열이라 HWPUNIT 으로 바꿔 재고, 0px 로 접히면 안 보이므로 1px 을 바닥으로 둔다. */
  var cMmHu = 283.465;

  function borderCss(line) {
    if (!line || !line.type || line.type === 'none') return '0';
    var style = cUlStyle[line.type] || 'solid';
    var w = Math.max(1, Math.round(hwHu2Px(parseFloat(line.w || '0.12') * cMmHu)));
    return w + 'px ' + style + ' ' + (line.color || '#000000');
  }

  function visible(bf) {
    if (!bf) return false;
    if (bf.fill) return true;
    var sides = [bf.l, bf.r, bf.t, bf.b];
    for (var i = 0; i < sides.length; i++) if (sides[i] && sides[i].type && sides[i].type !== 'none') return true;
    return false;
  }

  /* 문단 테두리·음영. ★ <b>한 쪽 안에서 이어진 줄 묶음마다</b> 상자 하나다 — 쪽이 갈리면 조각마다 그린다.
     줄보다 먼저 그려야 음영이 글자를 안 덮는다(표 격자와 같은 이유). */
  function paraBoxes(body, pg) {
    var i = 0;
    while (i < pg.lines.length) {
      var para = pg.lines[i].para;
      var bf = hwModel.borderFill(hwModel.paraShape(para.ps).bf);
      var j = i;
      while (j < pg.lines.length && pg.lines[j].para === para) j++;

      if (visible(bf)) body.appendChild(paraBoxEl(pg.lines, i, j, hwModel.paraShape(para.ps), bf));
      i = j;
    }
  }

  function paraBoxEl(lines, from, to, ps, bf) {
    var x0 = lines[from].xHu, x1 = x0, y0 = lines[from].yHu, y1 = y0;
    for (var k = from; k < to; k++) {
      var it = lines[k];
      if (it.xHu < x0) x0 = it.xHu;
      if (it.xHu + it.line.availHu > x1) x1 = it.xHu + it.line.availHu;
      if (it.yHu < y0) y0 = it.yHu;
      if (it.yHu + it.line.hHu > y1) y1 = it.yHu + it.line.hHu;
    }

    var d = el('div', 'hw-parabox');
    d.style.left = hwHu2Px(x0 - (ps.bsL || 0)) + 'px';
    d.style.top = hwHu2Px(y0 - (ps.bsT || 0)) + 'px';
    d.style.width = hwHu2Px((x1 - x0) + (ps.bsL || 0) + (ps.bsR || 0)) + 'px';
    d.style.height = hwHu2Px((y1 - y0) + (ps.bsT || 0) + (ps.bsB || 0)) + 'px';
    d.style.borderLeft = borderCss(bf.l);
    d.style.borderRight = borderCss(bf.r);
    d.style.borderTop = borderCss(bf.t);
    d.style.borderBottom = borderCss(bf.b);
    if (bf.fill) d.style.background = bf.fill;
    return d;
  }

  /* 문단 머리(글머리표·번호). ★ 첫 줄에만, 줄 <b>왼쪽 바깥</b>에 놓는다 — 폭을 안 먹이는 설계다
     (FEATURE-PLAN E11). 쪽이 갈려 둘째 조각부터 시작하는 줄에는 안 붙는다. */
  function paraHeads(body, pg) {
    for (var i = 0; i < pg.lines.length; i++) {
      var item = pg.lines[i];
      if (item.li !== 0 || item.ghost) continue;

      var text = hwHead.textOf(item.para);
      if (!text) continue;

      var cs = hwModel.charShape(hwModel.shapeAt(item.para, 0));
      var w = 0;
      for (var k = 0; k < text.length; k++) w += hwMeasure.charHu(text.charAt(k), cs);

      var gap = hwHead.gapHu(hwModel.paraShape(item.para.ps), cs);
      var d = el('div', 'hw-head');
      d.style.left = hwHu2Px(item.xHu - w - gap) + 'px';
      d.style.top = hwHu2Px(item.yHu) + 'px';
      d.style.height = hwHu2Px(item.line.hHu) + 'px';
      d.style.lineHeight = hwHu2Px(item.line.hHu) + 'px';
      applyCs(d, cs);
      d.textContent = text;
      body.appendChild(d);
    }
  }

  /* 한 쪽에 놓인 표 조각 하나. 쪽 경계에서 나뉜 표는 쪽마다 조각이 따로 온다(`hwTable.placeRange`). */
  function tableEl(body, entry) {
    var obj = entry.obj, at = entry.frag, grid = entry.frag;
    if (!at || !grid) return;

    var box = el('div', 'hw-table');
    /* ★ 신원을 여기 붙인다 — 회색 자리 상자(stamp 가 일부러 안 붙인다)가 아니라 격자 상자다.
       hwObj 가 <b>테두리 바깥 띠</b>를 눌렀을 때만 이걸 찾아 표를 고른다. 안쪽은 칸 편집이다. */
    var host = hwModel.hostOf(obj);
    if (host) { box.setAttribute('data-tpara', host.id); box.setAttribute('data-tpos', String(obj.pos)); }
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

      /* 칸이 테두리/배경 표를 가리키면 그 값으로 그린다. 안 가리키면 CSS 의 회색 한 줄 그대로다.
         ★ 이웃과 맞닿은 변은 두 번 그려진다 — 1차에서는 그대로 둔다. */
      var bf = hwModel.borderFill(r.cell.bf);
      if (bf) {
        c.style.borderLeft = borderCss(bf.l);
        c.style.borderRight = borderCss(bf.r);
        c.style.borderTop = borderCss(bf.t);
        c.style.borderBottom = borderCss(bf.b);
        c.style.background = bf.fill || 'transparent';
      }
      box.appendChild(c);
    }

    body.appendChild(box);
  }

  /* ★ 정렬 몫(hwBreak.alignLines)은 두 가지로 그린다 — 앞 여백은 줄 상자를 그만큼 오른쪽에 두고,
       늘릴 몫은 그 글자의 자간(개체면 오른쪽 여백, 탭이면 폭)에 더한다. 앞 여백을 빈 span 으로 넣으면
       화면 글자 번호가 하나 밀려 캐럿 대조(hwDomXOfChar)가 통째로 어긋난다. */
  function lineEl(item) {
    var para = item.para, ln = item.line;
    var lead = ln.lead || 0;
    var d = el('div', 'hw-line');
    d.style.left = hwHu2Px(item.xHu + lead) + 'px';
    d.style.top = hwHu2Px(item.yHu) + 'px';
    d.style.height = hwHu2Px(ln.hHu) + 'px';
    d.style.width = hwHu2Px(Math.max(0, ln.availHu - lead)) + 'px';
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
      var ex = hwBreak.extraAt(para, ln, k);

      if (ch === '\n') continue;

      if (ch === '￼') {
        var o = objAt(para, k);
        var box = objEl(para, k);

        if (box) {
          /* ★ 떠 있는 개체는 줄의 폭을 안 먹는다. 줄 안에 흘려 넣으면 그 뒤 글자가
             개체 폭만큼 오른쪽으로 밀려서, 우리가 계산한 캐럿 자리와 화면이 갈라진다
             (실측 — 표지 문단의 그리기 개체 하나가 캐럿을 한 글자 넘게 밀었다).
             ★ 자리는 줄 상자 기준이다 — 정렬로 줄 상자를 민 만큼 되돌려야 개체가 따라 밀리지 않는다. */
          if (o && !o.inline) {
            box.style.position = 'absolute';
            box.style.left = hwHu2Px(sane(o.xOffHu) - lead) + 'px';
            box.style.top = hwHu2Px(sane(o.yOffHu)) + 'px';
          } else if (ex) {
            box.style.marginRight = hwHu2Px(ex) + 'px';
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
        d.appendChild(spacer(cw + ex));
        w += cw;
        continue;
      }

      var csId = hwModel.shapeAt(para, k);
      var cs = hwModel.charShape(csId);

      /* ★ 우리가 재는 폭과 브라우저가 그리는 폭이 다르다 — 한글·전각은 1em, 공백은 0.5em 으로
         재는데 대체 글꼴(나눔)의 실제 폭은 그보다 좁다. 그 차이를 자간으로 메우지 않으면
         줄 뒤로 갈수록 캐럿이 글자 앞에 선다. 차이가 같은 글자끼리 묶어 span 하나로 낸다. */
      /* ★ 장평(ratio)은 <b>두 번 세면 안 된다</b>. 우리 폭(cw)에는 이미 장평이 들어 있는데
         화면은 그것을 scaleX 로 또 늘린다 — 자간을 그대로 주면 늘어난 배만큼 벌어져서
         장평 200% 구간에서 캐럿이 33px 앞에 섰다(실측 sample-5017.hwp). 안쪽에는 <b>늘어나기 전</b>
         값을 주고, 늘어난 결과가 cw 가 되게 한다. */
      var ratio = (cs.ratio && cs.ratio !== 100) ? cs.ratio / 100 : 1;
      var extra = (cw + ex) / ratio - hwMeasure.naturalHu(ch, cs);

      /* ★ 링크를 묶음 키에 넣는다 — 그래야 링크 <b>경계에서 span 이 저절로 끊긴다</b>.
         칠하기는 클래스 하나뿐이다(글자모양은 안 건드린다 — hwLink 머리 주석). */
      var link = hwLink.at(para, k);
      var key = csId + '|' + Math.round(extra * 100) + '|' + (link === null ? '' : 'L' + link);

      if (key !== curKey || !cur) {
        closeRun();
        cur = el('span', 'hw-run');
        applyCs(cur, cs);
        if (link !== null) { cur.className = 'hw-run hw-link'; cur.setAttribute('data-link', link); }
        cur.style.letterSpacing = hwHu2Px(extra) + 'px';
        d.appendChild(cur);
        curKey = key;
        curRatio = ratio;
      }
      cur.appendChild(document.createTextNode(ch));
      curW += cw + ex;
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

  function spacer(wHu) {
    var s = el('span', 'hw-gap');
    s.style.width = hwHu2Px(wHu) + 'px';
    return s;
  }

  /* 밑줄 모양 이름(cBorderMap 의 이름표) → CSS. 우리가 그릴 수 있는 네 가지로 접는다. */
  var cUlStyle = {
    dash: 'dashed', longDash: 'dashed', dashDot: 'dashed', dashDotDot: 'dashed',
    dot: 'dotted', circleDot: 'dotted',
    double: 'double', thinThick: 'double', thickThin: 'double', thinThickThin: 'double',
    wave: 'wavy', doubleWave: 'wavy'
  };

  /* 강조점 hwp EmphasisSort 번호 → CSS text-emphasis. 0 은 없음. */
  var cEmphMark = ['', 'dot', 'circle', 'triangle', 'triangle', 'sesame', 'dot',
                   'dot', 'dot', 'dot', 'dot', 'dot', 'dot'];

  function applyCs(span, cs) {
    var face = hwModel.faceName(cs.face);
    span.style.fontFamily = '"' + ((face && face.sub) || 'NanumGothicHW') + '"';
    span.style.fontSize = hwHu2Px(hwMeasure.drawSizeHu(cs)) + 'px';
    if (cs.bold) span.style.fontWeight = '700';
    if (cs.italic) span.style.fontStyle = 'italic';
    if (cs.color) span.style.color = cs.color;
    if (cs.underline) span.style.textDecoration = 'underline';
    if (cs.strike) span.style.textDecoration = (cs.underline ? 'underline ' : '') + 'line-through';
    if (cs.underline) {
      span.style.textDecorationStyle = cUlStyle[cs.ulShape] || 'solid';
      if (cs.ulColor) span.style.textDecorationColor = cs.ulColor;
    }

    /* 형광펜. ★ null 이 "없음" 이다 — 흰색이 아니다(hwp 는 0xFFFFFFFF, hwpx 는 "none"). */
    if (cs.shade) span.style.backgroundColor = cs.shade;

    /* 첨자는 크기를 hwMeasure.drawSizeHu 가 이미 줄였다. 여기서는 자리만 올리고 내린다. */
    if (cs.sup) span.style.verticalAlign = 'super';
    else if (cs.sub) span.style.verticalAlign = 'sub';

    if (cs.emph && cEmphMark[cs.emph]) {
      span.style.textEmphasis = cEmphMark[cs.emph] + ' ' + (cs.color || '#000000');
      span.style.textEmphasisPosition = 'over';
    }

    if (cs.outline) span.style.webkitTextStroke = '0.4px ' + (cs.color || '#000000');

    /* 그림자·양각·음각은 한 속성(text-shadow)을 나눠 쓴다 — 같이 켜면 뒤엣것이 이긴다. */
    if (cs.emboss) span.style.textShadow = '-1px -1px 0 #ffffff, 1px 1px 0 #808080';
    else if (cs.engrave) span.style.textShadow = '1px 1px 0 #ffffff, -1px -1px 0 #808080';
    else if (cs.shadow) span.style.textShadow = '1px 1px 0 #b2b2b2';
    if (cs.ratio && cs.ratio !== 100) {
      span.style.display = 'inline-block';
      span.style.transform = 'scaleX(' + (cs.ratio / 100) + ')';
      span.style.transformOrigin = 'left';
    }
    /* ★ 자간(cs.spacing)은 여기서 안 준다 — 이미 hwBreak.charWidth 가 폭에 넣었고,
       lineEl 이 그 폭과 실제 글꼴 폭의 차이를 letterSpacing 으로 한 번에 준다. 두 번 주면 겹친다. */
  }

  /* ★ 안 보이는 컨트롤(용지·단 정의)은 <b>아무것도 안 그린다</b> — 자리는 모델에만 있으면 된다.
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
      return stamp(img, para, pos);
    }

    var d = el('span', 'hw-obj hw-obj-' + (o.kind || 'opaque'));
    d.style.width = hwHu2Px(o.wHu) + 'px';
    d.style.height = hwHu2Px(o.hHu) + 'px';
    d.title = (o.label || o.kind || '') + (o.ctrl ? ' (' + o.ctrl + ')' : '');
    if (o.label) d.setAttribute('data-label', o.label);
    return stamp(d, para, pos);
  }

  /* ★ 이게 없으면 눌린 요소에서 모델로 되짚을 길이 없다 —
     hwObj 가 고르기·조절점을 여기에 건다.

     ★ <b>표에는 안 붙인다.</b> 표는 격자(.hw-table)를 따로 그리지만 이 자리에도 회색 상자를 하나
       만든다 — 그 상자는 행 사이 여백처럼 칸 줄이 안 덮는 곳에서 드러난다. 거기에 신원을 붙이면
       그 자리를 누를 때 <b>칸에 캐럿이 안 들어가고</b> 표가 개체로 골라져서, 이어 누른 Delete 가
       표를 통째로 지운다(deleteRange 가 개체 한 자리를 지우는 것이 곧 표를 지우는 것이다). */
  function stamp(el, para, pos) {
    var o = objAt(para, pos);

    /* "글 뒤로" 는 글 층 <b>아래</b>로 내려간다 — 그 자리에서는 그 개체를 마우스로 못 고른다(글이 위에 있다).
       ★ "글 앞으로" 는 층을 <b>안 올린다</b>. 올려 봤더니 그 개체가 본문 클릭을 가로채,
         그 아래 글의 우클릭과 표 칸 블록이 통째로 막혔다(실측 — aligns·matrix·textbox·
         sample-5017-pics·multicolumns-in-common-controls 가 front 개체를 갖는다). 값은 저장·되읽기만 한다. */
    if (o && !o.inline && o.flow === 'behind') el.style.zIndex = '-1';

    if (o && (o.table || o.kind === 'table')) return el;

    el.setAttribute('data-para', para.id);
    el.setAttribute('data-pos', String(pos));
    return el;
  }

  function bodyOf(pageIdx) {
    var box = cPageEls[pageIdx];
    if (!box || !box._hwFilled) return null;
    return box.querySelector('.hw-body');
  }

  function pageElOf(pageIdx) { return cPageEls[pageIdx] || null; }

  function canvas() { return cCanvas; }

  /* PDF 로 뽑기 전에 모든 쪽을 채운다. 끝나면 다시 가상 스크롤로 돌아간다. */
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
    canvas: canvas,
    /* ★ 개체를 끌어 옮길 때도 같은 안전선을 써야 한다. 화면은 접힌 값(0)을 보여 주는데 모델에는
       42억이 그대로 있을 수 있어서, 그 위에 움직인 만큼을 더하면 조금 밀었는데 모델은 여전히
       미친 값이다 — 그걸 저장하면 PDF 가 만 단위 쪽으로 터진다. */
    sane: sane
  };
})();

function hwRender() { return hwRenderer.render(); }
function hwRenderRefresh() { return hwRenderer.refresh(); }

/* ★ 배치를 다시 하고 나서 그린다 — 문단 하나가 길어지면 그 뒤 문단의
   쪽이 통째로 밀리므로, 그 문단만 다시 그리는 것으로는 화면이 맞지 않는다.
   비싼 것은 줄 나눔인데 그건 고친 문단만 다시 한다(hwBreak.linesOf 캐시). */
function hwRelayout() {
  hwLayout();
  hwRender();
}
