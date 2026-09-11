/* ★ 결과는 hwPages 에 담긴다:
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

    /* ★ 여백·머리말·꼬리말 합이 용지 높이 이상인 문서(손상됐거나 극단적인 설정)에서는 본문 높이가
       0 이하가 되고, 아래 자리 차지 개체의 while 이 영영 안 끝나 탭이 멈춘다. 용지의 1/10 을 하한으로
       둔다 — 1 같은 작은 값이면 멈추지는 않아도 개체 하나에 쪽이 수만 장 생긴다. */
    var minH = Math.max(1000, page.hHu > 0 ? page.hHu / 10 : 0);
    if (!(textH >= minH)) textH = minH;

    var colW = cols > 1 ? (textW - gap * (cols - 1)) / cols : textW;

    var cur = newPage(sec, si);
    var col = 0;
    var y = 0;
    var prevBottomSpace = 0;

    for (var pi = 0; pi < sec.paras.length; pi++) {
      var para = sec.paras[pi];
      var ps = hwModel.paraShape(para.ps);
      var lines = hwBreak.linesOf(para, colW);

      /* ★ 문단에 걸린 강제 나눔. 이걸 안 보면 쪽이 모자라고 그 뒤 y 가 통째로 밀린다. */
      if (para.brk && !(cur.lines.length === 0 && col === 0)) {
        if ((para.brk === 'column' || para.brk === 'multicolumn') && col + 1 < cols) { col++; y = 0; }
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

      /* ★ 표는 칸까지 배치한다. 표 안 문단의 줄도 <b>본문 기준 절대 좌표</b>로 같은
         줄 목록에 들어간다 — 그래야 캐럿·선택·hit test 가 표를 따로 알 필요가 없다. */
      var tbl = tableObjs(para);
      for (var ti = 0; ti < tbl.length; ti++) {
        var to = tbl[ti];
        var grid = hwTable.measure(to);
        var tx = col * (colW + gap) + (to.inline ? 0 : (to.xOffHu || 0));
        var ty = paraTop + (to.yOffHu || 0);

        /* 남은 자리에 안 들어가면 통째로 다음 쪽으로 넘긴다. */
        if (ty + grid.hHu > textH && !(paraTop === 0 && y === 0)) {
          col++;
          if (col >= cols) { cur = newPage(sec, si); col = 0; }
          y = 0; paraTop = 0;
          tx = col * (colW + gap) + (to.inline ? 0 : (to.xOffHu || 0));
          ty = to.yOffHu || 0;
        }

        hwTable.place(to, tx, ty, cur.lines, hwPages.length - 1, cur);
        if (ty + grid.hHu > y) y = ty + grid.hHu;
      }

      /* ★ 문단에 매달린 "자리 차지" 개체는 본문을 아래로 밀어낸다. 이걸 안 하면 표·그림이 큰
         문서에서 쪽이 통째로 모자란다(실측 — basicsReport.hwp 는 6쪽인데 4쪽으로 나왔고,
         모자란 높이가 그 문서의 떠 있는 표 높이 합과 맞았다). */
      var reserve = floatReserve(para);
      if (reserve > 0 && paraTop + reserve > y) {
        y = paraTop + reserve;
        while (y > textH && textH > 0) {
          y -= textH;
          col++;
          if (col >= cols) { cur = newPage(sec, si); col = 0; }
        }
      }
    }
  }

  /* 문단에 매달려 자리를 차지하는 떠 있는 개체가 잡아먹는 세로 높이.
     쪽·용지 기준으로 붙은 개체(relV=page/paper)는 본문 흐름과 무관하므로 세지 않는다. */
  function tableObjs(para) {
    var out = [];
    for (var i = 0; i < (para.objs || []).length; i++)
      if (para.objs[i].table) out.push(para.objs[i]);
    return out;
  }

  function floatReserve(para) {
    if (!para.objs) return 0;
    var max = 0;
    for (var i = 0; i < para.objs.length; i++) {
      var o = para.objs[i];
      /* 표는 위에서 이미 자리를 잡았다 — 여기서 또 세면 그만큼 빈 자리가 두 번 생긴다. */
      if (o.table) continue;
      if (o.inline) continue;
      if (o.relV !== 'para') continue;
      if (o.flow === 'behind' || o.flow === 'front') continue;
      var bottom = (o.yOffHu > 0 ? o.yOffHu : 0) + (o.hHu || 0);
      if (bottom > max) max = bottom;
    }
    return max;
  }

  function newPage(sec, si) {
    var p = { secIdx: si, page: sec.page, lines: [], tables: [] };
    hwPages.push(p);
    return p;
  }

  /* 문단 id → 그 문단이 차지한 줄들. 캐럿이 좌표를 찾을 때 쓴다.
     ★ 배치가 끝난 뒤에 한 번만 만든다 — 캐럿을 옮길 때마다 전 쪽을 훑으면 긴 문서에서 눌린다. */
  function buildIndex() {
    hwLineIndex = {};
    for (var pg = 0; pg < hwPages.length; pg++) {
      var lines = hwPages[pg].lines;
      for (var i = 0; i < lines.length; i++) {
        var id = lines[i].para.id;
        if (!hwLineIndex[id]) hwLineIndex[id] = [];
        lines[i].pageIdx = pg;
        hwLineIndex[id].push(lines[i]);
      }
    }
  }

  return { layout: layout, buildIndex: buildIndex };
})();

var hwLineIndex = {};

function hwLayout() {
  var r = hwPage.layout();
  hwPage.buildIndex();
  return r;
}

function hwPageCount() { return hwPages.length; }

/* ★ 이걸 안 보내면 저장본의 줄 정보가 비어 외부 변환기가 줄 0 으로 읽는다.
   h 는 <b>다음 줄까지의 거리</b>, th 는 글자 높이다. C# 이 둘의 차를 줄 사이 여분으로 쓴다. */
function hwSegOf(paraId) {
  var lines = hwLineIndex[paraId];
  if (!lines || !lines.length) return null;

  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var it = lines[i], ln = it.line;
    out.push({
      s: ln.s,
      /* ★ 표 칸 안의 문단은 <b>칸 기준</b> 좌표로 적는다(실측 — table.hwp 의 칸 첫 줄이 전부 y=0,
         x=0 이고 w 는 칸 폭에서 여백을 뺀 값이다). 본문 절대 좌표를 그대로 적으면 저장본을 여는
         쪽이 칸 안의 글을 쪽 아래쪽으로 밀어 그린다. 본문 문단은 base 가 0 이라 그대로다. */
      y: Math.round(it.yHu - (it.baseYHu || 0)),
      h: Math.round(ln.hHu),
      th: Math.round(ln.thHu),
      b: Math.round(ln.baseHu),
      x: Math.round(it.xHu - (it.baseXHu || 0)),
      w: Math.round(ln.availHu)
    });
  }
  return out;
}
