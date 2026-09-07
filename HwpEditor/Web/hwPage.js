/* 쪽 배치. 문단을 줄로 쪼갠 뒤(hwBreak) 쪽에 쌓는다.

   ★ 결과는 hwPages 에 담긴다:
       [{ secIdx, page(용지·여백), lines:[{ para, line, yHu }] }]
     yHu 는 본문 영역 위쪽에서의 거리다 — lineseg 의 y 와 같은 좌표계라 그대로 대조할 수 있다.

   ★ 다단은 단 하나씩 채워 내려간 뒤 다음 단으로 넘어간다(신문 흐름). */

var hwPages = [];

var hwPage = (function () {
  'use strict';

  function layout() {
    hwPages = [];
    if (!hwDoc) return hwPages;

    for (var si = 0; si < hwDoc.sections.length; si++) {
      layoutSection(hwDoc.sections[si], si);
    }
    return hwPages;
  }

  function layoutSection(sec, si) {
    var page = sec.page;
    var cols = (sec.cols && sec.cols.count > 0) ? sec.cols.count : 1;
    var gap = (sec.cols && sec.cols.gapHu) || 0;

    var textW = page.wHu - page.mlHu - page.mrHu - (page.gutHu || 0);

    /* ★ 본문 높이는 위·아래 여백만 뺀 것이 아니라 머리말·꼬리말 띠까지 뺀 것이다.
       (실측 — basicsReport.hwp 는 h-mt-mb 가 74550 이지만 쪽마다 실제로 채워진 높이는 64727 까지였고,
        h-mt-mb-mh-mf = 66329 이 그 바로 위였다. 이걸 안 빼면 한 쪽에 줄이 더 들어가 쪽이 모자란다.) */
    var textH = page.hHu - page.mtHu - page.mbHu - (page.mhHu || 0) - (page.mfHu || 0);
    var colW = cols > 1 ? (textW - gap * (cols - 1)) / cols : textW;

    var cur = newPage(sec, si);
    var col = 0;
    var y = 0;
    var prevBottomSpace = 0;

    for (var pi = 0; pi < sec.paras.length; pi++) {
      var para = sec.paras[pi];
      var ps = hwModel.paraShape(para.ps);
      var lines = hwBreak.breakPara(para, colW);

      /* ★ 문단에 걸린 강제 나눔. 이걸 안 보면 쪽이 모자라고 그 뒤 y 가 통째로 밀린다. */
      if (para.brk && !(cur.lines.length === 0 && col === 0)) {
        if (para.brk === 'column' && col + 1 < cols) { col++; y = 0; }
        else { cur = newPage(sec, si); col = 0; y = 0; }
      }

      /* 문단 사이 여백은 위·아래를 겹치지 않고 더한다(한글 방식). */
      y += Math.max(0, ps.mtHu || 0) + prevBottomSpace;
      prevBottomSpace = Math.max(0, ps.mbHu || 0);

      var paraTop = y;

      for (var li = 0; li < lines.length; li++) {
        var ln = lines[li];

        if (y + ln.hHu > textH && !(y === 0 && li === 0)) {
          col++;
          if (col >= cols) { cur = newPage(sec, si); col = 0; }
          y = 0;
          paraTop = 0;
        }

        cur.lines.push({
          para: para, line: ln, li: li, yHu: y,
          xHu: col * (colW + gap) + ln.xHu,
          colWHu: colW
        });
        y += ln.hHu;
      }

      /* ★ 문단에 매달린 "자리 차지" 개체는 본문을 아래로 밀어낸다. 이걸 안 하면 표·그림이 큰
         문서에서 쪽이 통째로 모자란다(실측 — basicsReport.hwp 는 6쪽인데 4쪽으로 나왔고,
         모자란 높이가 그 문서의 떠 있는 표 높이 합과 맞았다). */
      var reserve = floatReserve(para);
      if (reserve > 0 && paraTop + reserve > y) {
        y = paraTop + reserve;
        while (y > textH) {
          y -= textH;
          col++;
          if (col >= cols) { cur = newPage(sec, si); col = 0; }
        }
      }
    }
  }

  /* 문단에 매달려 자리를 차지하는 떠 있는 개체가 잡아먹는 세로 높이.
     쪽·용지 기준으로 붙은 개체(relV=page/paper)는 본문 흐름과 무관하므로 세지 않는다. */
  function floatReserve(para) {
    if (!para.objs) return 0;
    var max = 0;
    for (var i = 0; i < para.objs.length; i++) {
      var o = para.objs[i];
      if (o.inline) continue;
      if (o.relV !== 'para') continue;
      if (o.flow === 'behind' || o.flow === 'front') continue;
      var bottom = (o.yOffHu > 0 ? o.yOffHu : 0) + (o.hHu || 0);
      if (bottom > max) max = bottom;
    }
    return max;
  }

  function newPage(sec, si) {
    var p = { secIdx: si, page: sec.page, lines: [] };
    hwPages.push(p);
    return p;
  }

  return { layout: layout };
})();

function hwLayout() { return hwPage.layout(); }
function hwPageCount() { return hwPages.length; }
