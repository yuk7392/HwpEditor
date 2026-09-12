/* ★ 결과는 hwPages 에 담긴다:
       [{ secIdx, page(용지·여백), lines:[{ para, line, yHu }] }]
     yHu 는 본문 영역 위쪽에서의 거리다 — lineseg 의 y 와 같은 좌표계라 그대로 대조할 수 있다.

   ★ 다단은 단 하나씩 채워 내려간 뒤 다음 단으로 넘어간다(신문 흐름). */

var hwPages = [];

/* ★ 가로 방향은 <b>용지 크기를 맞바꾸지 않는다</b> — 파일은 w·h 를 그대로 두고 플래그만 세우고,
   맞바꾸는 것은 배치하는 쪽이다(실측 pagedefs.hwp: 가로 구역도 w=59528 h=84188 인데 lineseg 폭이
   84188−8504−8504=67180 이다). 쪽 크기를 읽는 자리는 전부 이 둘을 지나야 한다. */
function hwPageW(page) { return page.landscape ? page.hHu : page.wHu; }
function hwPageH(page) { return page.landscape ? page.wHu : page.hHu; }

var hwPage = (function () {
  'use strict';

  function layout() {
    hwPages = [];
    if (!hwDoc) return hwPages;

    for (var si = 0; si < hwDoc.sections.length; si++) {
      var from = hwPages.length;
      layoutSection(hwDoc.sections[si], si);
      /* ★ 띠는 본문 배치가 <b>끝난 뒤</b>에 놓는다 — 그 구역이 몇 쪽인지 알아야 쪽마다 그릴 수 있다. */
      placeBands(hwDoc.sections[si], from);
    }
    return hwPages;
  }

  function layoutSection(sec, si) {
    var page = sec.page;
    var cols = (sec.cols && sec.cols.count > 0) ? sec.cols.count : 1;
    var gap = (sec.cols && sec.cols.gapHu) || 0;

    var textW = hwPageW(page) - page.mlHu - page.mrHu - (page.gutHu || 0);

    /* ★ 본문 높이는 위·아래 여백만 뺀 것이 아니라 머리말·꼬리말 띠까지 뺀 것이다.
       (실측 — basicsReport.hwp 는 h-mt-mb 가 74550 이지만 쪽마다 실제로 채워진 높이는 64727 까지였고,
        h-mt-mb-mh-mf = 66329 이 그 바로 위였다. 이걸 안 빼면 한 쪽에 줄이 더 들어가 쪽이 모자란다.) */
    var textH = hwPageH(page) - page.mtHu - page.mbHu - (page.mhHu || 0) - (page.mfHu || 0);

    /* ★ 여백·머리말·꼬리말 합이 용지 높이 이상인 문서(손상됐거나 극단적인 설정)에서는 본문 높이가
       0 이하가 되고, 아래 자리 차지 개체의 while 이 영영 안 끝나 탭이 멈춘다. 용지의 1/10 을 하한으로
       둔다 — 1 같은 작은 값이면 멈추지는 않아도 개체 하나에 쪽이 수만 장 생긴다. */
    var minH = Math.max(1000, hwPageH(page) > 0 ? hwPageH(page) / 10 : 0);
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

      /* ★ 개체가 쪽 <b>아래로 통째로 밀려나</b> 한 점도 안 보이게 될 때만 다음 쪽으로 넘긴다.
         .hw-page 가 넘치는 것을 자르므로, 그대로 두면 그 개체는 화면·PDF 양쪽에서 사라진다.
         ★ "쪽에 다 안 들어가면 넘긴다" 로 넓게 잡으면 안 된다 — 한글은 걸친 채로 두고,
           그렇게 잡으면 오라클 y오차가 오히려 는다(실측 basicsReport.hwp 50552 → 60827).
         ★ 줄을 놓기 <b>전</b>에 정한다. 놓고 나서 넘기면 그 문단의 글만 앞 쪽에 남는다. */
      var top0 = floatTop(para);
      if (top0 >= 0 && paraTop + top0 >= textH) {
        col++;
        if (col >= cols) { cur = newPage(sec, si); col = 0; }
        y = 0;
        paraTop = 0;
      }

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
        /* 바깥 여백은 자리를 먹는다 — 빼면 그 아래 문단이 통째로 올라온다(실측: borderfill.hwp 는
           표 3846 + 위아래 283 = 4412 가 다음 문단의 lineseg y 와 정확히 같다). */
        var ty = paraTop + (to.yOffHu || 0) + (to.omTHu || 0);

        /* 쪽 경계에서 0=나누지 않음 1=셀 단위로 나눔 2=나눔. 1·2 는 <b>줄 경계</b>로 같게 다룬다 —
           2 의 "칸 안 글까지 쪼갬" 은 한 칸 문단이 두 쪽에 걸려 칸 기준 lineseg 가 깨진다. */
        var split = (to.table.divide || 0) !== 0;
        var headN = hwTable.headRows(to.table);
        var r0 = 0, first = true, rep, headH, end, used;
        /* 방금 쪽·단을 넘겨 <b>빈 자리</b>에 서 있는가. ★ ty 로 판정하면 안 된다 — 자리 기준 오프셋
           (yOffHu)이 있는 표는 넘긴 쪽에서도 ty 가 0 이 아니라, 넘기고 또 넘기며 안 끝난다(실측: 탭이 멈춘다). */
        var fresh = (y === 0 && paraTop === 0);

        while (r0 < grid.rows) {
          /* ★ 제목 줄을 다시 놓을지는 <b>한 값</b>으로 정해 재는 쪽과 놓는 쪽이 같이 쓴다. 따로 판정하면
             억지로 놓은 첫 조각이 제목 줄 안에서 끝났을 때 둘이 갈려 그만큼 빈 자리가 생긴다. */
          rep = (!first && headN > 0 && r0 >= headN) ? headN : 0;
          headH = rep > 0 ? grid.rowY[rep] : 0;
          var avail = textH - ty - headH;
          end = split ? hwTable.breakRow(grid, to.table, avail, r0)
                      : (grid.hHu <= avail ? grid.rows : r0);

          if (end <= r0) {
            /* 남은 자리에 한 줄도 못 놓는다. 빈 쪽인데도 그렇다면(줄 하나가 쪽보다 크다) 넘겨도
               그대로라 한 조각은 억지로 놓는다 — 안 그러면 이 while 이 안 끝난다. */
            if (fresh) {
              end = split ? hwTable.nextBreak(grid, to.table, r0) : grid.rows;
            } else {
              col++;
              if (col >= cols) { cur = newPage(sec, si); col = 0; }
              y = 0; paraTop = 0; fresh = true;
              tx = col * (colW + gap) + (to.inline ? 0 : (to.xOffHu || 0));
              ty = first ? (to.yOffHu || 0) : 0;
              continue;
            }
          }

          hwTable.placeRange(to, tx, ty, cur.lines, hwPages.length - 1, cur, r0, end, rep);

          used = ty + headH + (grid.rowY[end] - grid.rowY[r0]) + (to.omBHu || 0);
          if (used > y) y = used;
          r0 = end;
          first = false;

          /* 남았으면 <b>무조건</b> 다음 쪽·단이다. 여기서 안 넘기면 다음 조각이 방금 놓은 조각 위에 겹친다. */
          if (r0 < grid.rows) {
            col++;
            if (col >= cols) { cur = newPage(sec, si); col = 0; }
            y = 0; paraTop = 0; ty = 0; fresh = true;
            tx = col * (colW + gap) + (to.inline ? 0 : (to.xOffHu || 0));
          }
        }
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

  /* 자리를 차지하는 개체들의 <b>가장 위</b> 가장자리(문단 머리 기준). 없으면 -1.
     이 값이 본문 높이를 넘으면 그 개체는 한 점도 안 그려진다. */
  function floatTop(para) {
    if (!para.objs) return -1;
    var best = -1;
    for (var i = 0; i < para.objs.length; i++) {
      var o = para.objs[i];
      if (o.table || o.inline) continue;
      if (o.relV !== 'para') continue;
      if (o.flow === 'behind' || o.flow === 'front') continue;
      var top = (o.yOffHu > 0 ? o.yOffHu : 0) + (o.omTHu || 0);
      if (best < 0 || top < best) best = top;
    }
    return best;
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
      var bottom = (o.yOffHu > 0 ? o.yOffHu : 0) + (o.omTHu || 0) + (o.hHu || 0) + (o.omBHu || 0);
      if (bottom > max) max = bottom;
    }
    return max;
  }

  /* 머리말·꼬리말·쪽 번호. 셋 다 본문 흐름에 안 먹는 hidden 컨트롤이라 여기서만 자리를 갖는다.
     ★ 좌표는 <b>본문 상자 기준</b>이다 — 머리말 띠는 y 가 음수, 꼬리말 띠는 textH 보다 크다.
       그래야 캐럿·hitTest·그리기가 본문 줄과 같은 길을 지난다(.hw-body 는 넘치는 자식을 안 자른다). */
  function placeBands(sec, from) {
    var bands = [];
    for (var pi = 0; pi < sec.paras.length; pi++) {
      var objs = sec.paras[pi].objs || [];
      for (var oi = 0; oi < objs.length; oi++) {
        var c = objs[oi].ctrl;
        if (c === 'head' || c === 'foot' || c === 'pgnp') bands.push(objs[oi]);
      }
    }
    if (!bands.length) return;

    var page = sec.page;
    var textW = hwPageW(page) - page.mlHu - page.mrHu - (page.gutHu || 0);
    var textH = hwPageH(page) - page.mtHu - page.mbHu - (page.mhHu || 0) - (page.mfHu || 0);

    /* 같은 문단을 쪽마다 다시 놓는다 — 색인에는 <b>처음 놓은 쪽</b>만 넣는다(제목 줄 반복과 같은 규칙). */
    var indexed = {};

    /* from 부터 끝까지가 이 구역의 쪽이다 — layoutSection 바로 뒤에 부르므로 뒤 구역은 아직 없다. */
    for (var pg = from; pg < hwPages.length; pg++) {
      var no = pg + 1;
      var head = pick(bands, 'head', no), foot = pick(bands, 'foot', no), num = pick(bands, 'pgnp', no);

      if (head) bandLines(head, hwPages[pg], 0, -(page.mhHu || 0), textW, indexed);
      if (foot) bandLines(foot, hwPages[pg], 0, textH, textW, indexed);
      if (num && num.numPos) hwPages[pg].pnum = pageNumOf(num, no, textW, textH, page);
    }
  }

  /* 이 쪽에 걸리는 띠 하나. 같은 종류가 여럿이면 <b>맞는 것 중 마지막</b>이다(한글이 뒤에 온 것을 쓴다). */
  function pick(bands, kind, pageNo) {
    var got = null;
    for (var i = 0; i < bands.length; i++) {
      var b = bands[i];
      if (b.ctrl !== kind) continue;
      if (b.apply === 'odd' && pageNo % 2 === 0) continue;
      if (b.apply === 'even' && pageNo % 2 === 1) continue;
      got = b;
    }
    return got;
  }

  function bandLines(band, page, x0, y0, widthHu, indexed) {
    var y = y0;
    for (var p = 0; p < (band.paras || []).length; p++) {
      var para = band.paras[p];
      var lines = hwBreak.linesOf(para, widthHu);
      var ghost = !!indexed[para.id];
      for (var k = 0; k < lines.length; k++) {
        page.lines.push({
          para: para, line: lines[k], li: k,
          yHu: y, xHu: x0 + lines[k].xHu, colWHu: widthHu,
          /* 칸과 같은 규칙 — 파일에 적는 줄 정보는 띠 기준이다. */
          baseXHu: x0, baseYHu: y0, ghost: ghost
        });
        y += lines[k].hHu;
      }
      indexed[para.id] = true;
    }
  }

  /* 쪽 번호 한 자리. 위치 11가지(덤프 5-11) — 안쪽·바깥쪽은 홀수 쪽을 오른쪽으로 푼다. */
  function pageNumOf(num, no, textW, textH, page) {
    var pos = num.numPos || 0;
    var odd = no % 2 === 1;
    var top = pos === 1 || pos === 2 || pos === 3 || pos === 7 || pos === 9;
    var align = 'center';
    if (pos === 1 || pos === 4) align = 'left';
    else if (pos === 3 || pos === 6) align = 'right';
    else if (pos === 7 || pos === 8) align = odd ? 'right' : 'left';
    else if (pos === 9 || pos === 10) align = odd ? 'left' : 'right';

    var body = (num.numBefore || '') + numText(no, num.numShape || 0) + (num.numAfter || '');
    return {
      text: body.replace(/\u0000/g, ''),
      xHu: 0, widthHu: textW, align: align,
      yHu: top ? -(page.mhHu || 0) : textH
    };
  }

  var cRoman = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
                [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

  function roman(n) {
    var out = '';
    for (var i = 0; i < cRoman.length && n > 0; i++)
      while (n >= cRoman[i][0]) { out += cRoman[i][1]; n -= cRoman[i][0]; }
    return out;
  }

  /* 번호 모양(hwp NumberShape). 표에 없는 모양은 숫자로 떨어뜨린다 — 안 그리는 것보다 낫다. */
  function numText(n, shape) {
    switch (shape) {
      case 2: return roman(n);
      case 3: return roman(n).toLowerCase();
      case 4: return String.fromCharCode(64 + ((n - 1) % 26) + 1);
      case 5: return String.fromCharCode(96 + ((n - 1) % 26) + 1);
      case 8: return '가나다라마바사아자차카타파하'.charAt((n - 1) % 14);
      default: return String(n);
    }
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
        lines[i].pageIdx = pg;
        /* ★ 쪽마다 다시 놓은 제목 줄(ghost)은 색인에 안 넣는다 — 한 문단에 두 자리를 주면
           캐럿이 튀고 저장본의 lineseg 가 그 문단에 줄을 두 배로 적는다. */
        if (lines[i].ghost) continue;
        var id = lines[i].para.id;
        if (!hwLineIndex[id]) hwLineIndex[id] = [];
        hwLineIndex[id].push(lines[i]);
      }
    }
  }

  /* 구역 쪽 설정을 바꾼다. over 의 키 이름은 <c>secFmt</c> op 와 같다 — 화면 모델과 요청이 한 벌이어야
     저장 뒤 다시 읽은 문서가 지금 화면과 같다. 문단이 안 바뀌므로 dirty 문단은 안 건드린다. */
  function setSection(si, over) {
    if (!hwDoc || !hwDoc.sections[si] || !over) return false;

    var sec = hwDoc.sections[si], pg = sec.page;
    var map = { pw: 'wHu', ph: 'hHu', ml: 'mlHu', mr: 'mrHu', mt: 'mtHu',
                mb: 'mbHu', mh: 'mhHu', mf: 'mfHu', gut: 'gutHu' };
    var op = { op: 'secFmt', sec: si }, any = false, k;

    for (k in map) if (map.hasOwnProperty(k) && over[k] !== undefined) {
      pg[map[k]] = over[k]; op[k] = over[k]; any = true;
    }
    if (over.landscape !== undefined) { pg.landscape = !!over.landscape; op.landscape = pg.landscape; any = true; }
    if (over.colCount !== undefined) {
      sec.cols.count = Math.max(1, Math.floor(over.colCount) || 1);
      op.colCount = sec.cols.count; any = true;
    }
    if (over.colGap !== undefined) { sec.cols.gapHu = over.colGap; op.colGap = over.colGap; any = true; }
    if (!any) return false;

    hwModel.pushSecOp(op);
    hwRelayout();
    if (window.hwPostDirty) hwPostDirty();
    hwCaret.paint();
    return true;
  }

  /* 구조를 잡는 숨은 컨트롤(구역·단 정의 등)이 든 문단인가. 머리말·꼬리말·쪽 번호는 안 센다 —
     그것들은 순서에 매이지 않아서, 안 빼면 머리말을 넣은 뒤 꼬리말이 다른 문단으로 밀려난다. */
  function hasHidden(para) {
    var objs = para.objs || [];
    for (var i = 0; i < objs.length; i++) {
      var c = objs[i].ctrl;
      if (objs[i].hidden && c !== 'head' && c !== 'foot' && c !== 'pgnp') return true;
    }
    return false;
  }

  /* 이 구역의 머리말·꼬리말·쪽 번호 컨트롤. 없으면 null. */
  function bandOf(si, kind) {
    var sec = hwDoc && hwDoc.sections[si];
    for (var pi = 0; sec && pi < sec.paras.length; pi++) {
      var objs = sec.paras[pi].objs || [];
      for (var oi = 0; oi < objs.length; oi++) if (objs[oi].ctrl === kind) return objs[oi];
    }
    return null;
  }

  /* 머리말·꼬리말을 새로 만든다. ★ 안 문단을 C# 이 만들므로 저장 뒤 문서를 <b>다시 읽는다</b>
     (SaveResult.reload) — 화면이 들고 있는 그 문단 id 는 문서에 없는 가짜다. */
  function addBand(si, kind, apply, text) {
    var sec = hwDoc && hwDoc.sections[si];
    if (!sec || !sec.paras.length) return false;

    /* ★ 구역 첫 문단에는 <b>용지·단 정의</b>(secd·cold)가 앞자리에 들어 있다. 그 앞에 머리말을 끼우면
       저장본이 "머리말 → secd → cold" 순서가 되는데, 우리 리더는 순서를 안 보니 왕복은 통과하고
       한글에서만 깨진다. 한글 자신도 머리말을 <b>그 다음 문단</b>에 둔다(실측 headerfooter.hwp 는
       s0p1#0, basicsReport.hwp 도 같다) — 숨은 컨트롤이 없는 첫 문단을 고른다. */
    /* ★ 화면이 만든 문단(n…)은 고르지 않는다 — 그 문단은 아직 문서에 없어서, 거기에 붙이면
       저장 요청에 <b>문서에 없는 id 의 고침</b>이 실려 저장이 통째로 예외로 끝난다(실측). */
    var host = sec.paras[0];
    for (var hi = 0; hi < sec.paras.length; hi++) {
      var cand = sec.paras[hi];
      if (!hasHidden(cand) && cand.id.charAt(0) !== 'n') { host = cand; break; }
    }

    var page = sec.page;
    var wide = hwPageW(page) - page.mlHu - page.mrHu - (page.gutHu || 0);
    var tall = (kind === 'foot' ? page.mfHu : page.mhHu) || 0;
    var cs = hwModel.shapeAt(host, 0);

    var obj = {
      tmpId: 'b' + hwModel.newId(), kind: 'ctrl', ctrl: kind, hidden: true, inline: true, pos: 0,
      label: kind === 'foot' ? '꼬리말' : '머리말', apply: apply || 'both',
      wHu: wide, hHu: tall,
      paras: [{ id: hwModel.newId(), ps: host.ps, runs: text ? [{ cs: cs, text: text }] : [],
                objs: [], len: text ? text.length : 0, seg: null, _bandNew: true }]
    };

    hwInput.run(function () {
      var arr = hwModel.items(host);
      /* 그래도 숨은 컨트롤이 앞에 있으면(구역이 그 문단 하나뿐) 그 뒤에 끼운다. */
      var at = 0;
      while (at < arr.length && arr[at].obj && arr[at].obj.hidden) at++;
      arr.splice(at, 0, { obj: obj });
      hwModel.setItems(host, arr);
      hwModel.pushSecOp({
        op: 'addHeader', tmpId: obj.tmpId, kind: kind, apply: obj.apply,
        ps: host.ps, runs: obj.paras[0].runs, wHu: wide, hHu: tall
      });
      hwModel.reindex();
      return [host.id];
    }, null, [host.id]);

    hwRelayout();
    if (window.hwPostDirty) hwPostDirty();
    hwSetStatus({ text: (kind === 'foot' ? '꼬리말' : '머리말') + '을 넣었습니다 — 저장하면 문서에 반영됩니다' });
    return true;
  }

  /* 머리말·꼬리말·쪽 번호를 없앤다.
     ★ C# 쪽에 지우는 op 가 <b>따로 없다</b> — 되쓰기(Rewrite)가 문단의 글자와 컨트롤을 통째로 비우고
       요청에 실린 objs 만 다시 단다. 그러니 화면에서 빼고 그 문단을 dirty 로 만들면 그것으로 끝난다.
     ★ 이번 저장 전에 넣은 띠(oid 가 없고 tmpId 만 있는 것)는 그 addHeader 요청도 같이 걷어야 한다 —
       안 걷으면 화면에는 없는 띠가 저장본에 생긴다. */
  function delBand(si, kind) {
    var sec = hwDoc && hwDoc.sections[si];
    if (!sec) return false;

    for (var pi = 0; pi < sec.paras.length; pi++) {
      var host = sec.paras[pi], objs = host.objs || [];
      for (var oi = 0; oi < objs.length; oi++) {
        if (objs[oi].ctrl !== kind) continue;

        var gone = objs[oi];
        hwInput.run(function () {
          var arr = hwModel.items(host);
          for (var k = 0; k < arr.length; k++)
            if (arr[k].obj === gone) { arr.splice(k, 1); break; }
          hwModel.setItems(host, arr);
          if (gone.tmpId) hwModel.dropSecOp(gone.tmpId);
          hwModel.reindex();
          return [host.id];
        }, null, [host.id]);

        hwRelayout();
        if (window.hwPostDirty) hwPostDirty();
        hwSetStatus({ text: (kind === 'foot' ? '꼬리말' : kind === 'head' ? '머리말' : '쪽 번호')
                          + '을 지웠습니다 — 저장하면 문서에 반영됩니다' });
        return true;
      }
    }
    hwSetStatus({ text: '이 구역에는 지울 것이 없습니다' });
    return false;
  }

  /* 쪽 번호 컨트롤을 새로 만든다. 자리는 머리말과 같은 규칙(숨은 컨트롤이 없는 첫 문단)이다 —
     거기서 갈리면 왕복은 통과하고 한글에서만 깨진다(addBand 의 주석과 같은 근거). */
  function addPageNum(si, over) {
    var sec = hwDoc && hwDoc.sections[si];
    if (!sec || !sec.paras.length) return false;

    var host = sec.paras[0];
    for (var hi = 0; hi < sec.paras.length; hi++) {
      var cand = sec.paras[hi];
      if (!hasHidden(cand) && cand.id.charAt(0) !== 'n') { host = cand; break; }
    }

    var pos = over && over.numPos !== undefined ? over.numPos : 5;
    var shape = over && over.numShape !== undefined ? over.numShape : 0;
    var dash = !!(over && over.numDash);

    var obj = {
      tmpId: 'n' + hwModel.newId(), kind: 'ctrl', ctrl: 'pgnp', hidden: true, inline: true, pos: 0,
      label: '쪽 번호', wHu: 0, hHu: 0,
      numPos: pos, numShape: shape, numBefore: dash ? '-' : '', numAfter: dash ? '-' : ''
    };

    hwInput.run(function () {
      var arr = hwModel.items(host);
      var at = 0;
      while (at < arr.length && arr[at].obj && arr[at].obj.hidden) at++;
      arr.splice(at, 0, { obj: obj });
      hwModel.setItems(host, arr);
      hwModel.pushSecOp({ op: 'addPageNum', tmpId: obj.tmpId,
                          numPos: pos, numShape: shape, numDash: dash });
      hwModel.reindex();
      return [host.id];
    }, null, [host.id]);

    hwRelayout();
    if (window.hwPostDirty) hwPostDirty();
    hwSetStatus({ text: '쪽 번호를 넣었습니다 — 저장하면 문서에 반영됩니다' });
    return true;
  }

  /* 쪽 번호 위치·모양. 컨트롤이 없으면 새로 만든다. */
  function setPageNum(si, over) {
    var num = bandOf(si, 'pgnp');
    if (!num) return addPageNum(si, over);

    var op = { op: 'pageNum', oid: num.oid };
    if (over.numPos !== undefined) { num.numPos = over.numPos; op.numPos = over.numPos; }
    if (over.numShape !== undefined) { num.numShape = over.numShape; op.numShape = over.numShape; }
    if (over.numDash !== undefined) {
      num.numBefore = over.numDash ? '-' : '';
      num.numAfter = over.numDash ? '-' : '';
      op.numDash = !!over.numDash;
    }
    hwModel.pushSecOp(op);
    hwRelayout();
    if (window.hwPostDirty) hwPostDirty();
    return true;
  }

  /* 캐럿이 선 구역. 못 찾으면 0 이다. */
  function caretSection() {
    var at = window.hwCaret ? hwCaret.at() : null;
    var host = at ? hwModel.hostOf(hwModel.byId(at.id)) || hwModel.byId(at.id) : null;
    for (var si = 0; host && si < hwDoc.sections.length; si++) {
      var ps = hwDoc.sections[si].paras;
      for (var i = 0; i < ps.length; i++) if (ps[i] === host) return si;
    }
    return 0;
  }

  return { layout: layout, buildIndex: buildIndex, setSection: setSection, caretSection: caretSection,
           bandOf: bandOf, addBand: addBand, delBand: delBand,
           addPageNum: addPageNum, setPageNum: setPageNum };
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
