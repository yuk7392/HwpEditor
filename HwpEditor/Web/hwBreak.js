/* ★ 문단 정렬은 줄 나눔이 끝난 뒤 줄마다 "앞 여백(lead)·늘릴 몫(gap)" 으로 단다(alignLines).
     정렬은 줄을 다시 나누지 않는다 — 나눌 자리는 왼쪽 정렬과 똑같다.
   ★ 아직 안 넣은 것: 문단별 탭 정의(tabdef), 하이픈 자동 넣기.
     탭은 기본 간격으로 근사한다 — 이것이 tabdef.hwp 의 일치율에 영향을 준다. */

var hwBreak = (function () {
  'use strict';

  /* 기본 탭 간격(HWPUNIT). 한글 기본값은 문단모양의 tabdef 를 따르지만 여기서는 근사한다. */
  var cTabHu = 4000;

  var cNoLineStart = '.,)]}?!:;’”）］｝」』】〕%…';
  var cNoLineEnd = '([{‘“（［｛「『【〔¥￦';

  function isLatin(ch) {
    var c = ch.charCodeAt(0);
    return (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)
        || c === 0x27 || c === 0x2d;
  }

  function isSpace(ch) { return ch === ' ' || ch === ' '; }

  /* 줄 나눌 자리를 금칙에 맞게 물린다. at 은 "다음 줄의 첫 글자" 인덱스다. */
  function applyForbidden(text, at, min) {
    var guard = 0;
    while (at > min && guard++ < 8) {
      var prev = text.charAt(at - 1);
      var cur = at < text.length ? text.charAt(at) : '';
      if (cur && cNoLineStart.indexOf(cur) >= 0) { at--; continue; }
      if (prev && cNoLineEnd.indexOf(prev) >= 0) { at--; continue; }
      break;
    }
    return at;
  }

  /* 라틴 낱말 단위로 물린다 — at 이 낱말 한가운데면 낱말 시작으로 당긴다. */
  function applyWordBreak(text, at, min) {
    if (at <= min || at >= text.length) return at;
    if (!isLatin(text.charAt(at)) || !isLatin(text.charAt(at - 1))) return at;
    var i = at;
    while (i > min && isLatin(text.charAt(i - 1))) i--;
    return i > min ? i : at;
  }

  /* 한글을 어절 단위로 자를 때: 공백 뒤로 당긴다. */
  function applyWordBreakHangul(text, at, min) {
    var i = at;
    while (i > min && !isSpace(text.charAt(i - 1))) i--;
    return i > min ? i : at;
  }

  /*
    한 문단을 줄로 쪼갠다.
      para      : 문단 모델
      widthHu   : 본문 단 폭
    반환: [{ s, e, wHu, hHu, baseHu, xHu, availHu }]
      s,e     : 편집 인덱스(끝 제외)
      xHu     : 단 왼쪽에서 이 줄이 시작하는 위치(들여쓰기·여백 포함)
      availHu : 이 줄이 쓸 수 있는 폭
  */
  function breakPara(para, widthHu) {
    var ps = hwModel.paraShape(para.ps);
    var text = hwModel.text(para);
    var lines = [];

    var left = ps.mlHu || 0, right = ps.mrHu || 0;
    var indent = ps.indentHu || 0;

    var i = 0, first = true;
    var n = text.length;

    /* 빈 문단도 줄 하나를 차지한다 — 안 그러면 문단 수만큼 줄이 모자란다. */
    if (n === 0) {
      lines.push(makeLine(para, 0, 0, left + Math.max(0, indent),
                          widthHu - left - right - Math.max(0, indent), 0));
      alignLines(para, lines);
      return lines;
    }

    while (i < n) {
      var xHu = left + (first ? Math.max(0, indent) : Math.max(0, -indent));
      var avail = widthHu - xHu - right;
      if (avail <= 0) avail = widthHu;

      var end = fitOne(para, text, i, avail);
      if (end <= i) end = i + 1;                 /* 한 글자도 못 넣으면 강제로 한 글자 */

      lines.push(makeLine(para, i, end, xHu, avail, 0));
      i = end;
      first = false;
    }

    alignLines(para, lines);
    return lines;
  }

  /* 줄마다 셋을 단다:
       lead    : 줄 앞에 비울 폭(가운데·오른쪽)
       gap     : 늘릴 자리 하나에 더할 폭(양쪽·배분)
       gapMode : 'space' 면 공백에만, 'char' 면 글자 사이마다. gapFrom·gapTo 가 늘릴 구간이다.
     ★ 그리기(hwRender.lineEl)·캐럿(hwCaret.offsetIn·posInLine)이 <b>같은 값</b>을 쓴다 — 셋이 각자 재면
       정렬된 줄에서만 캐럿이 글자 사이가 아니라 엉뚱한 자리에 선다.
     ★ 폭은 뒤 공백·강제 줄바꿈을 뺀 "보이는 폭" 이다. 뒤 공백까지 세면 가운데 줄이 공백 폭 절반만큼 쏠린다.
     ★ 양쪽 정렬은 문단 마지막 줄과 강제 줄바꿈으로 끝난 줄을 늘리지 않는다. 배분은 마지막 줄까지 늘린다.
       공백이 없는 줄(한글만 붙어 있는 줄)은 양쪽 정렬도 글자 사이에 나눈다. */
  function alignLines(para, lines) {
    var ps = hwModel.paraShape(para.ps);
    var a = ps.align || 'justify';
    var text = hwModel.text(para);

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      ln.lead = 0; ln.gap = 0; ln.gapMode = null; ln.gapFrom = ln.s; ln.gapTo = ln.s;
      if (a === 'left') continue;

      /* 보이는 끝 — 뒤 공백·줄바꿈을 뺀다. 첫 글자 — 앞 공백은 늘릴 자리로 안 센다. */
      var te = ln.e;
      while (te > ln.s && (text.charAt(te - 1) === '\n' || isSpace(text.charAt(te - 1)))) te--;
      var tf = ln.s;
      while (tf < te && isSpace(text.charAt(tf))) tf++;

      var used = 0, spaces = 0, chars = 0, lastChar = -1;
      for (var k = ln.s; k < te; k++) {
        used += charWidth(para, k, used);
        if (k > tf && isSpace(text.charAt(k))) spaces++;
        if (stretchable(para, text, k)) { chars++; lastChar = k; }
      }

      var room = ln.availHu - used;
      if (room <= 0) continue;

      if (a === 'center') { ln.lead = room / 2; continue; }
      if (a === 'right') { ln.lead = room; continue; }

      var isLast = i === lines.length - 1;
      var hard = ln.e > ln.s && text.charAt(ln.e - 1) === '\n';
      if (a === 'justify' && (isLast || hard)) continue;

      if (a === 'justify' && spaces > 0) {
        ln.gapMode = 'space'; ln.gap = room / spaces; ln.gapFrom = tf; ln.gapTo = te;
      } else if (chars > 1) {
        ln.gapMode = 'char'; ln.gap = room / (chars - 1); ln.gapFrom = ln.s; ln.gapTo = lastChar;
      }
    }
  }

  /* 글자 사이를 벌릴 수 있는 자리인가 — 폭이 없는 것(떠 있는 개체·안 보이는 컨트롤·줄바꿈)은 뺀다. */
  function stretchable(para, text, k) {
    var ch = text.charAt(k);
    if (ch === '' || ch === '\n') return false;
    return ch !== '￼' || objWidth(para, k) > 0;
  }

  /* 줄 안 k 번째 글자 <b>뒤에</b> 더 붙는 폭(정렬 몫). 그리기·캐럿이 글자 폭에 이것을 더한다. */
  function extraAt(para, ln, k) {
    if (!ln.gap || k < ln.gapFrom || k >= ln.gapTo) return 0;
    var text = hwModel.text(para);
    if (ln.gapMode === 'space') return (k > ln.gapFrom && isSpace(text.charAt(k))) ? ln.gap : 0;
    return stretchable(para, text, k) ? ln.gap : 0;
  }

  /* i 에서 시작해 avail 폭에 들어가는 마지막 위치(끝 제외)를 찾는다. */
  function fitOne(para, text, i, avail) {
    var ps = hwModel.paraShape(para.ps);
    var w = 0;
    var j = i;

    while (j < text.length) {
      var ch = text.charAt(j);

      if (ch === '\n') return j + 1;             /* 문단 안 줄바꿈은 그 자리에서 끊는다 */

      var cw = charWidth(para, j, w);

      if (w + cw > avail && j > i) break;
      w += cw;
      j++;
    }

    if (j >= text.length) return text.length;

    var at = j;
    if (isLatin(text.charAt(at)) && ps.latinBreak === 'word') at = applyWordBreak(text, at, i);
    else if (ps.hangulByWord) at = applyWordBreakHangul(text, at, i);
    at = applyForbidden(text, at, i + 1);
    return at;
  }

  /* 글자 하나가 줄에서 먹는 폭. 탭은 지금까지의 폭에 따라 달라지므로 그 값을 같이 받는다.
     ★ 줄 나눔·줄 폭·캐럿 좌표가 <b>전부 이 함수 하나</b>를 쓴다 — 셋이 각자 재면 캐럿이
       글자 사이가 아니라 엉뚱한 자리에 선다. */
  function charWidth(para, k, wSoFar) {
    var text = hwModel.text(para);
    var ch = text.charAt(k);
    if (ch === '' || ch === '\n') return 0;
    if (ch === '\t') return (Math.floor(wSoFar / cTabHu) + 1) * cTabHu - wSoFar;
    if (ch === '￼') return objWidth(para, k);
    return hwMeasure.charHu(ch, hwModel.charShape(hwModel.shapeAt(para, k)));
  }

  function objAt(para, pos) {
    if (!para.objs) return null;
    for (var k = 0; k < para.objs.length; k++) if (para.objs[k].pos === pos) return para.objs[k];
    return null;
  }

  /* ★ 떠 있는 개체(글자처럼 취급이 아닌 것)는 줄의 폭을 안 먹는다. 인라인인 것만 자리를 차지한다. */
  function objWidth(para, pos) {
    var o = objAt(para, pos);
    return (o && o.inline) ? (o.wHu || 0) : 0;
  }

  function objHeight(para, pos) {
    var o = objAt(para, pos);
    return (o && o.inline) ? (o.hHu || 0) : 0;
  }

  /* 줄 하나의 높이·기준선. 줄간격 방식(lsType)에 따라 갈린다. */
  function makeLine(para, s, e, xHu, availHu, unusedW) {
    var ps = hwModel.paraShape(para.ps);
    var maxSize = 0, wHu = 0;
    var text = hwModel.text(para);

    for (var k = s; k < e; k++) {
      var ch = text.charAt(k);
      if (ch === '\n') continue;
      var cs = hwModel.charShape(hwModel.shapeAt(para, k));
      if (cs.sizeHu > maxSize) maxSize = cs.sizeHu;
      if (ch === '￼') {
        var oh = objHeight(para, k);
        if (oh > maxSize) maxSize = oh;
      }
      wHu += charWidth(para, k, wHu);
    }

    if (maxSize === 0) {
      var csEmpty = hwModel.charShape(hwModel.shapeAt(para, s));
      maxSize = csEmpty.sizeHu;
    }

    var hHu;
    if (ps.lsType === 'fixed') hHu = ps.ls;
    else if (ps.lsType === 'atLeast') hHu = Math.max(maxSize, ps.ls);
    else if (ps.lsType === 'margin') hHu = maxSize + ps.ls;
    else hHu = maxSize * (ps.ls || 100) / 100;

    return {
      s: s, e: e, wHu: wHu, hHu: hHu, thHu: maxSize,
      baseHu: maxSize * 0.85, xHu: xHu, availHu: availHu
    };
  }

  /* 같은 폭으로 다시 물으면 지난번 결과를 그대로 준다.
     ★ 글자 하나를 칠 때마다 문서 전체를 다시 쪼개면 3,000문단 문서에서 입력이 눈에 띄게 늦는다.
       고친 문단은 hwModel.markDirty 가 이 표를 지우므로 그 문단만 다시 쪼개진다. */
  function linesOf(para, widthHu) {
    if (para._lines && para._linesW === widthHu) return para._lines;
    para._lines = breakPara(para, widthHu);
    para._linesW = widthHu;
    return para._lines;
  }

  return {
    breakPara: breakPara,
    linesOf: linesOf,
    charWidth: charWidth,
    extraAt: extraAt,
    tabHu: function (v) { if (v !== undefined) cTabHu = v; return cTabHu; }
  };
})();

function hwBreakPara(para, widthHu) { return hwBreak.breakPara(para, widthHu); }
