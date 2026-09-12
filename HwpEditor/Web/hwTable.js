/* ★ 셀 안의 문단을 <b>보통 줄과 똑같이</b> 만들어 쪽의 줄 목록에 넣는다. 좌표만 본문 기준 절대값으로
     바꿔 담으면 캐럿·선택·hit test·그리기가 표를 따로 알 필요가 없다 — 표 전용 캐럿을 또 만들면
     본문과 표에서 동작이 갈린다.
   ★ 행 높이는 <b>원본 값을 먼저 믿고</b>, 셀 내용이 그보다 커질 때만 늘린다. 처음부터 다시 계산하면
     한글이 잡아 둔 표 모양이 열기만 해도 달라진다.
   ★ 칸의 자리는 <b>칸이 들고 있는 행·열 번호</b>로 잡는다. 목록 차례로 잡으면 위에서 아래로 걸친
     칸(rowSpan)이 있는 행은 칸이 하나 적어서, 그 행부터 x 가 통째로 왼쪽으로 밀린다.
   ★ 쪽 경계에서 나누는 것은 <b>행 경계</b>뿐이다(`placeRange`). 병합 칸이 걸친 자리에서는 못 나누고,
     divide=0 인 표는 통째로 다음 쪽으로 넘긴다 — 판정은 `hwPage.layoutSection` 이 한다. */

var hwTable = (function () {
  'use strict';

  /* 셀 안쪽 기본 여백(HWPUNIT). 파일에 값이 없을 때만 쓴다. */
  var cCellPad = 141;

  function rowsOf(t) {
    var n = 0;
    for (var i = 0; i < t.cells.length; i++) { var c = t.cells[i]; if (c.r + c.rs > n) n = c.r + c.rs; }
    return n;
  }

  function colsOf(t) {
    var n = 0;
    for (var i = 0; i < t.cells.length; i++) { var c = t.cells[i]; if (c.c + c.cs > n) n = c.c + c.cs; }
    return n;
  }

  function spread(arr, at, span, want) {
    var have = 0, n = 0;
    for (var k = at; k < at + span && k < arr.length; k++) { have += arr[k]; n++; }
    if (n === 0 || want <= have) return;
    var add = (want - have) / n;
    for (var j = at; j < at + span && j < arr.length; j++) arr[j] += add;
  }

  function prefix(arr) {
    var out = new Array(arr.length + 1);
    out[0] = 0;
    for (var i = 0; i < arr.length; i++) out[i + 1] = out[i] + arr[i];
    return out;
  }

  /* 결과는 obj._grid 에 담아 두고 그리기가 다시 쓴다. */
  function measure(obj) {
    var t = obj.table;
    if (!t || !t.cells.length) return { wHu: obj.wHu || 0, hHu: obj.hHu || 0, cells: [] };

    var rows = rowsOf(t), cols = colsOf(t);
    var i, c;

    var colW = [];
    for (i = 0; i < cols; i++) colW.push(0);
    for (i = 0; i < t.cells.length; i++) {
      c = t.cells[i];
      if (c.cs === 1 && (c.wHu || 0) > colW[c.c]) colW[c.c] = c.wHu || 0;
    }
    for (i = 0; i < t.cells.length; i++) {
      c = t.cells[i];
      if (c.cs !== 1) spread(colW, c.c, c.cs, c.wHu || 0);
    }
    for (i = 0; i < cols; i++) if (colW[i] <= 0) colW[i] = 1000;
    var colX = prefix(colW);

    var rowH = [];
    for (i = 0; i < rows; i++) rowH.push(0);
    for (i = 0; i < t.cells.length; i++) {
      c = t.cells[i];
      if (c.rs === 1 && (c.hHu || 0) > rowH[c.r]) rowH[c.r] = c.hHu || 0;
    }
    for (i = 0; i < t.cells.length; i++) {
      c = t.cells[i];
      if (c.rs !== 1) spread(rowH, c.r, c.rs, c.hHu || 0);
    }

    /* 내용이 그보다 크면 그 행을 늘린다 — 글을 넣어 넘칠 때 표가 안 커지면 글이 칸 밖으로 나간다.
       ★ 폭은 <b>격자에서 나온 폭</b>으로 잰다. 칸이 들고 있는 wHu 로 재면 배치(place)가 쓰는 폭과
         달라져, 여기서 두 줄인 문단이 화면에서는 한 줄이 된다. */
    for (i = 0; i < t.cells.length; i++) {
      c = t.cells[i];
      var wide = colX[Math.min(cols, c.c + c.cs)] - colX[c.c];
      var need = contentHeight(c, textWidth(c, wide)) + pad(c, 'mt') + pad(c, 'mb');
      if (c.rs === 1) { if (need > rowH[c.r]) rowH[c.r] = need; }
      else spread(rowH, c.r, c.rs, need);
    }
    var rowY = prefix(rowH);

    var rects = [];
    for (i = 0; i < t.cells.length; i++) {
      c = t.cells[i];
      var x0 = colX[c.c] || 0;
      var x1 = colX[Math.min(cols, c.c + c.cs)] || x0;
      rects.push({
        cell: c,
        xHu: x0,
        yHu: rowY[c.r] || 0,
        wHu: Math.max(0, x1 - x0),
        hHu: Math.max(0, (rowY[Math.min(rows, c.r + c.rs)] || 0) - (rowY[c.r] || 0))
      });
    }

    var grid = {
      wHu: colX[cols] || obj.wHu || 0, hHu: rowY[rows] || obj.hHu || 0, cells: rects,
      /* 쪽 넘김이 줄 경계를 찾을 때 쓴다 — rowY 는 누적이라 rowY[r1]-rowY[r0] 이 그 구간 높이다. */
      rows: rows, cols: cols, rowY: rowY
    };
    obj._grid = grid;
    return grid;
  }

  function pad(cell, key) {
    var v = cell[key + 'Hu'];
    return v === undefined || v === null ? cCellPad : v;
  }

  /* 칸 안에서 글이 흐를 폭. 격자 폭을 받아 여백만 뺀다 — 재는 쪽과 놓는 쪽이 같은 값을 쓴다. */
  function textWidth(cell, wideHu) {
    var w = wideHu === undefined ? (cell.wHu || 0) : wideHu;
    return Math.max(200, w - pad(cell, 'ml') - pad(cell, 'mr'));
  }

  function contentHeight(cell, widthHu) {
    var h = 0;
    for (var i = 0; i < cell.paras.length; i++) {
      var lines = hwBreak.linesOf(cell.paras[i], widthHu);
      for (var k = 0; k < lines.length; k++) h += lines[k].hHu;
    }
    return h;
  }

  /* 쪽을 넘길 때 맨 위에 다시 놓을 제목 줄 수. ★ <b>맨 위부터 이어진</b> 줄만 센다 —
     가운데 줄이 제목 칸이어도 그것만 떼어 올릴 수는 없다.
     표본 전부가 repeatHeader=true 인데 제목 칸은 하나도 없다(실측) — 그래서 head 칸을 근거로 센다. */
  function headRows(t) {
    if (!t || !t.repeatHeader || !t.cells.length) return 0;
    var rows = rowsOf(t), n = 0;
    for (var r = 0; r < rows; r++) {
      var any = false, all = true;
      for (var i = 0; i < t.cells.length; i++) {
        var c = t.cells[i];
        if (c.r !== r) continue;
        any = true;
        if (!c.head) { all = false; break; }
      }
      if (!any || !all) break;
      n++;
    }
    return n;
  }

  /* r 자리에서 가로로 자를 수 있는가 — 병합 칸이 걸쳐 있으면 못 자른다. */
  function canBreak(t, r) {
    if (r <= 0) return false;
    for (var i = 0; i < t.cells.length; i++) {
      var c = t.cells[i];
      if (c.r < r && c.r + c.rs > r) return false;
    }
    return true;
  }

  /* [r0, ?) 가 availHu 에 들어가는 <b>가장 큰</b> 자를 자리. 한 줄도 안 들어가면 r0 을 돌려준다. */
  function breakRow(grid, t, availHu, r0) {
    for (var r = grid.rows; r > r0; r--) {
      if (r !== grid.rows && !canBreak(t, r)) continue;
      if (grid.rowY[r] - grid.rowY[r0] <= availHu) return r;
    }
    return r0;
  }

  /* r0 다음에 올 수 있는 <b>가장 작은</b> 자를 자리. 빈 쪽에도 안 들어가는 큰 줄에서 쓴다. */
  function nextBreak(grid, t, r0) {
    for (var r = r0 + 1; r < grid.rows; r++) if (canBreak(t, r)) return r;
    return grid.rows;
  }

  function place(obj, originX, originY, out, pageIdx, page) {
    return placeRange(obj, originX, originY, out, pageIdx, page, 0, -1, 0);
  }

  /* [r0, r1) 줄만 놓는다. headN > 0 이면 그 앞에 0~headN 줄(제목 줄)을 <b>다시</b> 놓는다.
     ★ 다시 놓은 줄은 ghost 로 들어간다 — 색인·hitTest 가 한 문단에 두 자리를 주면 캐럿이 튄다. */
  function placeRange(obj, originX, originY, out, pageIdx, page, r0, r1, headN) {
    var grid = measure(obj);
    if (r1 < 0) r1 = grid.rows;
    /* 이 조각이 제목 줄을 <b>이미 담고 있으면</b> 다시 놓지 않는다. r0 == headN 은 제목 줄이 전부
       앞 조각에 있다는 뜻이라 다시 놓아야 한다 — 여기를 <= 로 두면 그때 반복이 조용히 꺼진다. */
    if (headN > 0 && r0 < headN) headN = 0;

    var headH = headN > 0 ? grid.rowY[headN] : 0;
    var shift = headH - grid.rowY[r0];

    var frag = {
      xHu: originX, yHu: originY, wHu: grid.wHu,
      hHu: headH + (grid.rowY[r1] - grid.rowY[r0]), cells: []
    };
    if (page) { if (!page.tables) page.tables = []; page.tables.push({ obj: obj, frag: frag }); }

    for (var i = 0; i < grid.cells.length; i++) {
      var rect = grid.cells[i];
      var cell = rect.cell;
      var dy, ghost;
      if (headN > 0 && cell.r < headN) { dy = 0; ghost = true; }
      else if (cell.r >= r0 && cell.r < r1) { dy = shift; ghost = false; }
      else continue;

      frag.cells.push({ cell: cell, xHu: rect.xHu, yHu: rect.yHu + dy, wHu: rect.wHu, hHu: rect.hHu });

      var w = textWidth(cell, rect.wHu);
      var y0 = originY + rect.yHu + dy + pad(cell, 'mt');
      var x0 = originX + rect.xHu + pad(cell, 'ml');

      /* 세로 맞춤 1=가운데 2=아래. ★ 남는 높이는 <b>격자가 정한 칸 높이</b>에서 재야 한다 —
         칸이 들고 있는 hHu 로 재면 내용이 늘린 행에서 글이 칸 밖으로 나간다. */
      if (cell.valign) {
        var room = rect.hHu - pad(cell, 'mt') - pad(cell, 'mb')
                 - contentHeight(cell, textWidth(cell, rect.wHu));
        if (room > 0) y0 += cell.valign === 1 ? room / 2 : room;
      }

      var y = y0;

      for (var p = 0; p < cell.paras.length; p++) {
        var para = cell.paras[p];
        var lines = hwBreak.linesOf(para, w);
        for (var k = 0; k < lines.length; k++) {
          out.push({
            para: para, line: lines[k], li: k,
            yHu: y, xHu: x0 + lines[k].xHu, colWHu: w,
            /* ★ 파일에 적는 줄 정보는 <b>칸 기준</b>이다(실측 — table.hwp 의 칸 첫 줄이 전부 y=0).
               그리기·캐럿은 절대 좌표를 쓰므로, 뺄 기준점을 같이 들고 다닌다. */
            baseXHu: x0, baseYHu: y0,
            pageIdx: pageIdx, ghost: ghost
          });
          y += lines[k].hHu;
        }
      }
    }

    /* 셀 블록 칠하기가 이걸 본다 — 쪽이 갈린 표는 <b>첫 조각</b>이 기준이다. */
    if (r0 === 0) obj._at = { xHu: originX, yHu: originY, pageIdx: pageIdx };
    return grid;
  }

  /* ★ 화면 모델을 먼저 고치고 같은 뜻의 요청을 저장 때 같이 보낸다. 저장이 끝나면 C# 이 표를
       다시 세우므로 문단 객체가 전부 새것이 되고, 그때 문서를 다시 읽어 id 를 맞춘다.
     ★ 여기 계산은 C# 의 <c>cTableWriter.EditGrid</c> 와 <b>같은 규칙</b>이어야 한다. 갈리면 저장 전
       화면과 저장 뒤 다시 읽은 문서가 다르게 보이고, 그 차이는 되읽기 전까지 아무 신호가 없다. */

  function here() {
    var p = hwCaret.para();
    if (!p || !p._cell) return null;
    return { cell: p._cell, obj: p._cell._obj };
  }

  /* 표의 첫 칸 첫 문단(last 면 마지막 칸 끝 문단). 표 옆에서 지우기를 누르면 캐럿이 여기로 들어간다.
     ★ cells 배열 순서로 고르지 않는다 — 행·열을 넣으면 새 칸이 뒤에 붙어 배열 끝이 마지막 칸이 아니다.
       병합 칸은 덮는 끝 번호로 본다(오른쪽 아래를 덮은 칸이 마지막 칸이다). */
  function edgePara(obj, last) {
    var t = obj && obj.table, best = null;
    if (!t || !t.cells) return null;
    for (var i = 0; i < t.cells.length; i++) {
      var c = t.cells[i];
      if (!c.paras || !c.paras.length) continue;
      if (!best) { best = c; continue; }
      var r = last ? c.r + (c.rs || 1) : c.r, br = last ? best.r + (best.rs || 1) : best.r;
      var k = last ? c.c + (c.cs || 1) : c.c, bk = last ? best.c + (best.cs || 1) : best.c;
      if (last ? (r > br || (r === br && k > bk)) : (r < br || (r === br && k < bk))) best = c;
    }
    return best ? best.paras[last ? best.paras.length - 1 : 0] : null;
  }

  /* 칸 옮기기(Tab·Shift+Tab). 행 우선 차례로 다음·앞 칸의 첫 문단 머리로 간다. 끝 칸이면 그대로 둔다.
     ★ cells 배열 차례를 믿지 않는다 — 행·열을 넣으면 새 칸이 뒤에 붙는다(edgePara 와 같은 이유). */
  function nextCell(dir) {
    var at = here();
    if (!at) return false;
    var cells = at.obj.table.cells.slice().sort(function (a, b) { return a.r - b.r || a.c - b.c; });
    var i = cells.indexOf(at.cell) + dir;

    /* ★ 마지막 칸에서 Tab 은 줄을 하나 더한다(한글 관례). finish 가 캐럿을 있던 칸에 도로 두므로
       줄을 넣은 <b>뒤에</b> 새 줄 첫 칸으로 옮긴다. */
    if (dir > 0 && i >= cells.length) {
      var obj = at.obj;
      addRow(1, 1);
      var t = obj.table, nr = rowsOf(t) - 1, first = null;
      for (var k = 0; k < t.cells.length; k++) {
        var cc = t.cells[k];
        if (cc.r === nr && (!first || cc.c < first.c)) first = cc;
      }
      if (first && first.paras.length) { hwCaret.set(first.paras[0].id, 0, false); hwCaret.scrollIntoView(); }
      return true;
    }

    if (i < 0 || i >= cells.length || !cells[i].paras.length) return true;
    hwCaret.set(cells[i].paras[0].id, 0, false);
    hwCaret.scrollIntoView();
    return true;
  }

  /* 표 지우기. 캐럿이 든 표를 통째로 뺀다 — 둘레 문단은 남고, 캐럿은 표가 있던 자리로 간다.
     ★ 글자 지우기로는 표가 안 지워진다(hwModel.keeps). 이 명령만 그 막음을 우회한다.
     ★ 저장은 부모 문단 되쓰기로 끝난다 — 되쓰기가 문단의 컨트롤을 비우고 objs 에 있는 것만 다시 넣는다
       (cHwpWriter.Rewrite·cHwpxWriter.Rewrite). 그 표에 쌓인 행·열 요청은 떨어져 나간 표를 고칠 뿐이다.
     ★ 되돌리기 한 칸이다. 스냅샷이 부모 문단의 objs 를 얕게 담으므로 표 객체가 칸·글자째 돌아온다. */
  function removeTable(which) {
    var obj = which, at;
    if (!obj) { at = here(); if (!at) return false; obj = at.obj; }
    var host = hwModel.hostOf(obj);
    if (!host) { hwSetStatus({ text: '이 표를 단 문단을 못 찾아 지우지 않았습니다' }); return false; }
    cBlock = null;

    hwInput.run(function () {
      var a = hwModel.items(host), pos = -1;
      for (var i = 0; i < a.length; i++) if (a[i].obj === obj) { pos = i; a.splice(i, 1); break; }
      if (pos < 0) return null;
      hwModel.setItems(host, a);
      hwModel.reindex();                 /* 지운 표의 칸 문단이 색인에 남으면 캐럿·찾기가 그리로 간다 */
      hwCaret.set(host.id, pos, false);
      return null;
    }, null, [host.id]);
    return true;
  }

  function keepId(at) {
    return at.cell.paras.length ? at.cell.paras[0].id : null;
  }

  /* 그 문단이 놓인 쪽의 본문 폭. 새 표는 이 폭을 열 수로 나눠 쓴다. */
  function bodyWidth(host) {
    var lines = hwLineIndex[host.id];
    var pg = lines && lines.length ? hwPages[lines[0].pageIdx] : (hwPages.length ? hwPages[0] : null);
    if (!pg || !pg.page) return 42520;
    var p = pg.page;
    return Math.max(2000, hwPageW(p) - p.mlHu - p.mrHu - (p.gutHu || 0));
  }

  /* 표 넣기. 캐럿 문단 <b>다음</b>에 새 문단을 만들고 거기에 표 하나를 단다.
     ★ 새 그림(addImage)과 같은 tmpId 방식이다 — 문단은 insertAfter 로, 표 실물은 addTable op 로 간다.
       저장이 끝나면 C# 이 표를 세우면서 칸 문단을 새로 만들므로 문서를 다시 읽는다(SaveResult.Reload).
     ★ 칸 문단에 <c>_tblOwner</c> 를 단다 — <c>_tblNew</c> 라 저장 요청에는 안 실리지만, 그 내용은
       addTable op 가 통째로 들고 가므로 "빠진 글자"로 세면 안 된다(hwModel.pushOp). */
  function insertTable(nRows, nCols) {
    if (!hwDoc) return false;
    if (here()) { hwSetStatus({ text: '표 안에 다시 표를 넣는 것은 아직 안 됩니다' }); return false; }

    nRows = Math.max(1, Math.min(100, Math.floor(nRows) || 1));
    nCols = Math.max(1, Math.min(100, Math.floor(nCols) || 1));

    var at = hwCaret.at();
    var host = at ? hwModel.byId(at.id) : null;
    if (!host) return false;

    var wide = bodyWidth(host);
    var colW = Math.floor(wide / nCols);
    var rowH = 1000 + cCellPad * 2;                  /* 글자 한 줄 + 위아래 여백 */
    var cells = [], r, c;

    for (r = 0; r < nRows; r++)
      for (c = 0; c < nCols; c++)
        cells.push({
          r: r, c: c, rs: 1, cs: 1,
          wHu: c === nCols - 1 ? wide - colW * (nCols - 1) : colW, hHu: rowH,
          mlHu: cCellPad, mrHu: cCellPad, mtHu: cCellPad, mbHu: cCellPad,
          paras: [{ id: hwModel.newId(), ps: host.ps, runs: [], objs: [], len: 0, seg: null,
                    _tblNew: true, _tblOwner: true }]
        });

    var obj = {
      tmpId: 't' + hwModel.newId(), kind: 'table', label: '표', inline: true, pos: 0,
      wHu: wide, hHu: rowH * nRows,
      table: { rows: nRows, cols: nCols, cells: cells }
    };

    hwInput.run(function () {
      var np = hwModel.splitPara(host, host.len);
      hwModel.setItems(np, [{ obj: obj }]);
      hwModel.reindex();
      return [np.id];
    }, null, [host.id]);

    hwCaret.set(cells[0].paras[0].id, 0, false);
    hwCaret.scrollIntoView();
    hwCaret.paint();
    hwSetStatus({ text: nRows + '줄 ' + nCols + '칸 표를 넣었습니다 — 저장하면 문서에 반영됩니다' });
    return true;
  }

  /* ─ 셀 블록 ─
     ★ 사각형은 <b>붙박이 모서리(r0,c0)와 움직이는 모서리(r1,c1)</b>로 들고, 쓸 때마다 min/max 로 편다.
       칠할 때마다 정렬해 담으면 방향키로 되짚어 올 때 붙박이 모서리가 같이 끌려온다.
     ★ 쓰기 직전에 <c>normalize</c> 로 <b>걸친 병합 칸을 통째로 품을 때까지</b> 넓힌다 — 반만 잡으면
       병합·너비 맞추기가 격자를 깨뜨린다. */
  var cBlock = null;                 /* { obj, r0, c0, r1, c1, mode } · mode 1 칸 하나 · 2 넓히기 · 3 표 전체 */

  function normalize(t, b) {
    for (var loop = 0; loop < 64; loop++) {
      var grew = false;
      for (var i = 0; i < t.cells.length; i++) {
        var c = t.cells[i];
        if (c.r + c.rs <= b.r0 || c.r > b.r1 || c.c + c.cs <= b.c0 || c.c > b.c1) continue;
        if (c.r < b.r0) { b.r0 = c.r; grew = true; }
        if (c.r + c.rs - 1 > b.r1) { b.r1 = c.r + c.rs - 1; grew = true; }
        if (c.c < b.c0) { b.c0 = c.c; grew = true; }
        if (c.c + c.cs - 1 > b.c1) { b.c1 = c.c + c.cs - 1; grew = true; }
      }
      if (!grew) break;
    }
    return b;
  }

  function rectOf(b) {
    return normalize(b.obj.table, {
      r0: Math.min(b.r0, b.r1), r1: Math.max(b.r0, b.r1),
      c0: Math.min(b.c0, b.c1), c1: Math.max(b.c0, b.c1)
    });
  }

  function inRect(c, b) { return c.r >= b.r0 && c.r <= b.r1 && c.c >= b.c0 && c.c <= b.c1; }

  function blockCells() {
    if (!cBlock) return null;
    var t = cBlock.obj.table, b = rectOf(cBlock), out = [];
    for (var i = 0; i < t.cells.length; i++) if (inRect(t.cells[i], b)) out.push(t.cells[i]);
    out.sort(function (x, y) { return x.r - y.r || x.c - y.c; });
    return { obj: cBlock.obj, rect: b, cells: out };
  }

  function blockOff() { cBlock = null; }

  function clearBlock() {
    if (!cBlock) return false;
    cBlock = null;
    hwCaret.paint();
    return true;
  }

  /* F5 순환: 칸 하나 → 넓히기 → 표 전체 → 표 개체 고르기. */
  function cycleBlock() {
    if (!cBlock) {
      var at = here();
      if (!at) return false;
      cBlock = { obj: at.obj, r0: at.cell.r, c0: at.cell.c,
                 r1: at.cell.r + at.cell.rs - 1, c1: at.cell.c + at.cell.cs - 1, mode: 1 };
    } else if (cBlock.mode === 1) {
      cBlock.mode = 2;
      hwSetStatus({ text: '셀 블록 — 방향키로 넓히고 M 병합 · S 나누기 · W/H 크기 맞추기 · Delete 내용 지우기 (Esc 해제)' });
    } else if (cBlock.mode === 2) {
      var t = cBlock.obj.table;
      cBlock.r0 = 0; cBlock.c0 = 0; cBlock.r1 = rowsOf(t) - 1; cBlock.c1 = colsOf(t) - 1;
      cBlock.mode = 3;
    } else {
      var obj = cBlock.obj;
      cBlock = null;
      if (window.hwObj && hwObj.selectTable) return hwObj.selectTable(obj);
      hwCaret.paint();
      return true;
    }
    hwCaret.clearSelection();
    hwCaret.paint();
    return true;
  }

  function extendBlock(dr, dc) {
    var t = cBlock.obj.table;
    cBlock.r1 = Math.max(0, Math.min(rowsOf(t) - 1, cBlock.r1 + dr));
    cBlock.c1 = Math.max(0, Math.min(colsOf(t) - 1, cBlock.c1 + dc));
    hwCaret.paint();
  }

  /* 끌기로 만드는 블록. 시작 칸을 붙박이로 잡고 지나는 칸으로 움직이는 모서리를 옮긴다. */
  function dragBlock(fromCell, toCell) {
    if (!fromCell || !toCell || fromCell._obj !== toCell._obj) return false;
    if (fromCell === toCell && !cBlock) return false;
    cBlock = { obj: fromCell._obj, r0: fromCell.r, c0: fromCell.c, r1: toCell.r, c1: toCell.c, mode: 2 };
    hwCaret.clearSelection();
    hwCaret.paint();
    return true;
  }

  /* 우클릭 "선택 ▸". 블록이 있으면 그것을, 없으면 캐럿이 든 칸을 기준으로 넓힌다. */
  function selectRange(kind) {
    var at = here(), obj = cBlock ? cBlock.obj : (at ? at.obj : null);
    if (!obj) return false;

    var t = obj.table, r0, c0, r1, c1;
    if (cBlock) { var b = rectOf(cBlock); r0 = b.r0; c0 = b.c0; r1 = b.r1; c1 = b.c1; }
    else { r0 = at.cell.r; c0 = at.cell.c; r1 = r0 + at.cell.rs - 1; c1 = c0 + at.cell.cs - 1; }

    if (kind === 'col') { r0 = 0; r1 = rowsOf(t) - 1; }
    else if (kind === 'row') { c0 = 0; c1 = colsOf(t) - 1; }
    else if (kind === 'table') { r0 = 0; c0 = 0; r1 = rowsOf(t) - 1; c1 = colsOf(t) - 1; }

    cBlock = { obj: obj, r0: r0, c0: c0, r1: r1, c1: c1, mode: kind === 'cell' ? 1 : 2 };
    hwCaret.clearSelection();
    hwCaret.paint();
    return true;
  }

  function paintBlock() {
    var olds = document.querySelectorAll('.hw-cellblk');
    for (var i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i]);
    if (!cBlock) return;

    var obj = cBlock.obj, at = obj._at;
    if (!at) return;
    var body = hwRenderer.bodyOf(at.pageIdx);
    if (!body) return;

    var grid = obj._grid || measure(obj), b = rectOf(cBlock);
    for (var k = 0; k < grid.cells.length; k++) {
      var rc = grid.cells[k];
      if (!inRect(rc.cell, b)) continue;
      var d = document.createElement('div');
      d.className = 'hw-cellblk';
      d.style.left = hwHu2Px(at.xHu + rc.xHu) + 'px';
      d.style.top = hwHu2Px(at.yHu + rc.yHu) + 'px';
      d.style.width = hwHu2Px(rc.wHu) + 'px';
      d.style.height = hwHu2Px(rc.hHu) + 'px';
      body.appendChild(d);
    }
  }

  /* ★ 표 구조는 안 건드리고 문단 글자만 비운다 — 되돌리기·dirty·저장 요청이 보통 지우기와 똑같이
       흘러가서 이력을 끊지 않는다(hwTable.finish 와 다른 점이다). */
  function clearBlockCells() {
    var b = blockCells();
    if (!b || !b.cells.length) return false;

    var ids = [], i, q;
    for (i = 0; i < b.cells.length; i++)
      for (q = 0; q < b.cells[i].paras.length; q++) ids.push(b.cells[i].paras[q].id);
    if (!ids.length) return false;

    hwInput.run(function () {
      for (var i = 0; i < b.cells.length; i++)
        for (var q = 0; q < b.cells[i].paras.length; q++) {
          var p = b.cells[i].paras[q];
          hwModel.deleteRange(p, 0, p.len);
        }
      return null;
    }, null, ids);
    return true;
  }

  /* ★ hwObj.onKey 와 같은 자리에서 <b>캐럿보다 먼저</b> 불린다. 블록이 안 받는 키는 블록을 풀고
       false 를 돌려준다 — 글자를 치면 블록이 남은 채로 편집이 들어가지 않는다. */
  function onKey(e, name) {
    if (!cBlock) return false;
    var k = name || e.key;

    if (k === 'Escape') { clearBlock(); return true; }
    if (k === 'Delete' || k === 'Backspace') { clearBlockCells(); return true; }
    if (k === 'F5') return false;                       /* 순환은 키 표가 받는다 */

    if (cBlock.mode >= 2) {
      if (k === 'ArrowUp') { extendBlock(-1, 0); return true; }
      if (k === 'ArrowDown') { extendBlock(+1, 0); return true; }
      if (k === 'ArrowLeft') { extendBlock(0, -1); return true; }
      if (k === 'ArrowRight') { extendBlock(0, +1); return true; }
    }

    if (k.length === 1) {
      var low = k.toLowerCase();
      if (low === 'm') { mergeBlock(); return true; }
      if (low === 's') { hwDialog.tableSplit(); return true; }
      if (low === 'w') { sameSize(true); return true; }
      if (low === 'h') { sameSize(false); return true; }
      if (low === 'b' || low === 'l') { hwDialog.cellBorder(); return true; }
      if (low === 'p') { hwDialog.tableProps(); return true; }
    }

    cBlock = null;
    return false;
  }

  function rowSize(t, r) {
    var best = 0, span = 0;
    for (var i = 0; i < t.cells.length; i++) {
      var c = t.cells[i];
      if (c.r === r && c.rs === 1) { if ((c.hHu || 0) > best) best = c.hHu || 0; }
      else if (c.r <= r && c.r + c.rs > r && span === 0) span = Math.floor((c.hHu || 0) / Math.max(1, c.rs));
    }
    return best > 0 ? best : (span > 0 ? span : 1000);
  }

  function colSize(t, cc) {
    var best = 0, span = 0;
    for (var i = 0; i < t.cells.length; i++) {
      var c = t.cells[i];
      if (c.c === cc && c.cs === 1) { if ((c.wHu || 0) > best) best = c.wHu || 0; }
      else if (c.c <= cc && c.c + c.cs > cc && span === 0) span = Math.floor((c.wHu || 0) / Math.max(1, c.cs));
    }
    return best > 0 ? best : (span > 0 ? span : 1000);
  }

  /* 같은 크기의 빈 칸. 글만 비우고 테두리·여백은 본떠 온다.
     ★ 새 문단에 <c>_tblNew</c> 를 단다 — 이 문단은 저장 요청에 실으면 안 된다. 문서 쪽 id 표에 없어서
       replace 를 보내면 저장이 통째로 예외로 끝난다(hwModel.pushOp 가 여기를 보고 뺀다). */
  function emptyLike(src, r, c, rs, cs, wHu, hHu) {
    var seed = src.paras.length ? src.paras[0] : null;
    var np = { id: hwModel.newId(), ps: seed ? seed.ps : 0,
               runs: [], objs: [], len: 0, seg: null, _tblNew: true };
    /* ★ 새 표의 칸이면 그 표시도 물려준다 — 그 칸 내용은 addTable 꾸러미가 들고 가므로
       "저장 때 빠진 글자" 로 세면 안 된다(hwModel.pushOp). */
    if (seed && seed._tblOwner) np._tblOwner = true;
    return {
      r: r, c: c, rs: rs, cs: cs,
      wHu: wHu, hHu: hHu,
      mlHu: src.mlHu, mrHu: src.mrHu, mtHu: src.mtHu, mbHu: src.mbHu,
      paras: [np]
    };
  }

  /* 씨앗 하나에서 <b>아직 안 덮인 구간마다</b> 빈 칸을 뜬다(C# cTableWriter.Runs 와 같은 규칙).
     ★ 씨앗의 첫 번호 하나로 판정하면 안 된다 — 씨앗이 두 칸에 걸쳐 있는데 그중 하나만 덮여 있으면
       통째로 건너뛰어 빈 자리가 생기거나 통째로 복제해 겹침이 생긴다. */
  function runs(seed, covered, at, isRow, newSize) {
    var out = [];
    var start = isRow ? seed.c : seed.r;
    var span = isRow ? seed.cs : seed.rs;
    var whole = (isRow ? seed.wHu : seed.hHu) || 0;

    var k = start, end = start + span;
    while (k < end) {
      while (k < end && covered[k]) k++;
      var run = k;
      while (k < end && !covered[k]) k++;
      if (k <= run) continue;

      var part = Math.floor(whole * (k - run) / Math.max(1, span));
      out.push(isRow ? emptyLike(seed, at, run, 1, k - run, part, newSize)
                     : emptyLike(seed, run, at, k - run, 1, newSize, part));
    }
    return out;
  }

  /* 칸이 하나도 <b>시작하지 않는</b> 행·열을 접는다.
     ★ 그런 행은 저장하면 hwp 는 칸 0개짜리 행, hwpx 는 빈 hp:tr 이 되어 여는 쪽이 표를 못 읽는다.
       "모든 자리가 한 번씩 덮였나" 검사로는 안 잡힌다 — 위에서 내려온 칸이 이미 덮고 있다. */
  function compact(t) {
    var r, c, i;
    for (r = rowsOf(t) - 1; r >= 0; r--) {
      if (starts(t, r, true)) continue;
      var rh = rowSize(t, r);
      for (i = 0; i < t.cells.length; i++) {
        var a = t.cells[i];
        if (a.r < r && a.r + a.rs > r) { a.rs--; a.hHu = (a.hHu || 0) - rh; }
        else if (a.r > r) a.r--;
      }
    }
    for (c = colsOf(t) - 1; c >= 0; c--) {
      if (starts(t, c, false)) continue;
      var cw = colSize(t, c);
      for (i = 0; i < t.cells.length; i++) {
        var b = t.cells[i];
        if (b.c < c && b.c + b.cs > c) { b.cs--; b.wHu = (b.wHu || 0) - cw; }
        else if (b.c > c) b.c--;
      }
    }
  }

  function starts(t, at, isRow) {
    for (var i = 0; i < t.cells.length; i++) if ((isRow ? t.cells[i].r : t.cells[i].c) === at) return true;
    return false;
  }

  /* 행·열 하나하나의 크기. ★ 나눌 때 <b>내림</b>이다 — C# 의 <c>Extent</c> 가 정수 나눗셈이라
       실수로 두면 표 폭이 저장 전후로 1 HWPUNIT 씩 갈린다(measure 쪽 spread 는 배치용이라 그대로 둔다). */
  function sizes(t, isRow) {
    var n = isRow ? rowsOf(t) : colsOf(t);
    var size = [], i, k;
    for (i = 0; i < n; i++) size.push(0);

    for (i = 0; i < t.cells.length; i++) {
      var a = t.cells[i];
      var at = isRow ? a.r : a.c, span = isRow ? a.rs : a.cs, want = (isRow ? a.hHu : a.wHu) || 0;
      if (span === 1 && want > size[at]) size[at] = want;
    }
    for (i = 0; i < t.cells.length; i++) {
      var b = t.cells[i];
      var bt = isRow ? b.r : b.c, bs = isRow ? b.rs : b.cs, bw = (isRow ? b.hHu : b.wHu) || 0;
      if (bs === 1) continue;

      var have = 0;
      for (k = bt; k < bt + bs && k < n; k++) have += size[k];
      if (bw <= have) continue;
      var add = Math.floor((bw - have) / bs);
      for (k = bt; k < bt + bs && k < n; k++) size[k] += add;
    }
    return size;
  }

  /* 표 바깥 크기를 격자에서 다시 낸다 — C# 의 Resize 와 같은 규칙이라야 저장 전후가 안 갈린다. */
  function extent(t, isRow) {
    var size = sizes(t, isRow), all = 0;
    for (var i = 0; i < size.length; i++) all += size[i];
    return all;
  }

  /* 칸이 하나도 시작하지 않는 행·열을 <b>번호만</b> 접는다.
     ★ <c>compact</c> 와 달리 크기를 안 뺀다. 나누기가 곱해 만든 유령 열은 <b>폭이 이미 이웃 안에</b>
       들어 있어서, compact 처럼 빼면 옆 칸이 홀쭉해진다(300/700 열을 나누면 700 이 350 이 된다). */
  function tighten(t) {
    var r, c, i;
    for (r = rowsOf(t) - 1; r >= 0; r--) {
      if (starts(t, r, true)) continue;
      for (i = 0; i < t.cells.length; i++) {
        var a = t.cells[i];
        if (a.r < r && a.r + a.rs > r) a.rs--;
        else if (a.r > r) a.r--;
      }
    }
    for (c = colsOf(t) - 1; c >= 0; c--) {
      if (starts(t, c, false)) continue;
      for (i = 0; i < t.cells.length; i++) {
        var b = t.cells[i];
        if (b.c < c && b.c + b.cs > c) b.cs--;
        else if (b.c > c) b.c--;
      }
    }
  }

  /* ★ 아직 문서에 없는 표(새로 넣은 표)의 구조 요청은 안 싣는다 — 그 표는 <c>addTable</c> 이 <b>이미
       고쳐진 격자</b>를 통째로 들고 가므로, 같은 고침을 또 보내면 C# 이 짝 없는 oid 로 버릴 뿐이다. */
  /* 구조를 바꾸기 <b>전</b> 상태를 되돌리기에 담는다. 표 격자·칸 문단 목록·표 구조 op 까지
     한 벌이라, 이것과 finish 의 commit 이 짝이 맞아야 Ctrl+Z 가 화면과 저장 요청을 같이 되돌린다. */
  function beginStruct() {
    if (!window.hwUndo) return;
    var a = hwCaret.at();
    hwUndo.begin(a && a.id ? [a.id] : []);
  }

  function pushOp(obj, op) {
    if (!obj.oid) return;
    op.oid = obj.oid;
    hwModel.pushTableOp(op);
  }

  /* 개수는 <b>한 단계 op 를 n 번</b> 쌓아서 낸다. C# 쪽 계약("op 하나 = 한 단계")을 안 늘리는 편이,
     n 개를 한 번에 넣는 알고리즘을 양쪽에 또 한 벌 두는 것보다 어긋날 자리가 적다. */
  function times(n) {
    n = Math.floor(n);
    return n > 0 ? Math.min(n, 100) : 1;
  }

  function addRowOnce(at, dir) {
    var t = at.obj.table;
    var rows = rowsOf(t);
    var from = Math.max(0, Math.min(at.cell.r, rows - 1));
    var pos = Math.max(0, Math.min(dir > 0 ? at.cell.r + at.cell.rs : at.cell.r, rows));
    var size = rowSize(t, from);
    var i, c, k;

    /* 새 행 자리를 이미 가로지르는 칸이 덮는 열에는 칸을 새로 만들지 않는다. */
    var covered = {};
    for (i = 0; i < t.cells.length; i++) {
      c = t.cells[i];
      if (c.r < pos && c.r + c.rs > pos) for (k = 0; k < c.cs; k++) covered[c.c + k] = true;
    }

    /* ★ 본뜰 칸은 번호를 밀기 <b>전에</b> 잡는다. 밀고 나서 잡으면 방금 민 칸을 본뜨게 된다. */
    var made = [];
    for (i = 0; i < t.cells.length; i++) {
      c = t.cells[i];
      if (c.r > from || c.r + c.rs <= from) continue;
      made = made.concat(runs(c, covered, pos, true, size));
    }

    for (i = 0; i < t.cells.length; i++) {
      c = t.cells[i];
      if (c.r < pos && c.r + c.rs > pos) { c.rs++; c.hHu = (c.hHu || 0) + size; }
      else if (c.r >= pos) c.r++;
    }

    t.cells = t.cells.concat(made);
    resize(at.obj);
    pushOp(at.obj, { op: 'addRow', pos: pos, from: from });
  }

  /* ★ 매 걸음 <c>here()</c> 를 다시 읽는다 — 캐럿이 든 칸의 번호가 앞 걸음에서 밀렸으므로, 그 값이
       곧 다음 걸음의 pos·from 이다. 처음 값을 붙들고 있으면 위쪽 추가가 같은 자리에 겹쳐 들어간다. */
  function addRow(dir, n) {
    var at = here();
    if (!at) return;
    var obj = at.obj, keep = keepId(at);
    beginStruct();

    for (var s = 0; s < times(n); s++) {
      at = here();
      if (!at) break;
      addRowOnce(at, dir);
    }
    finish(obj, keep);
  }

  function delRowOnce(t, obj, pos) {
    if (rowsOf(t) <= 1 || pos < 0 || pos >= rowsOf(t)) return false;
    var size = rowSize(t, pos);
    var keep = [];

    for (var i = 0; i < t.cells.length; i++) {
      var c = t.cells[i];
      if (c.r === pos) {
        if (c.rs <= 1) continue;                              /* 통째로 빠진다 */
        c.rs--; c.hHu = (c.hHu || 0) - size;                  /* 시작 행만 줄면 r 이 곧 다음 행이다 */
      } else if (c.r < pos && c.r + c.rs > pos) { c.rs--; c.hHu = (c.hHu || 0) - size; }
      else if (c.r > pos) c.r--;
      keep.push(c);
    }

    t.cells = keep;
    pushOp(obj, { op: 'delRow', pos: pos });
    return true;
  }

  /* ★ 지우기는 <c>here()</c> 를 다시 읽지 않는다 — 캐럿이 든 칸이 방금 사라졌을 수 있고, 색인은
       finish 까지 안 고쳐지므로 그때 here() 가 이미 없는 칸을 돌려준다. 같은 번호를 다시 지우면
       아래 행이 올라와 있어 그것이 곧 다음 행이다. */
  function delRow(n) {
    var at = here();
    if (!at) return;
    var t = at.obj.table, obj = at.obj, pos = at.cell.r, did = false;

    beginStruct();
    for (var s = 0; s < times(n); s++) {
      if (!delRowOnce(t, obj, pos)) break;
      resize(obj);
      did = true;
    }
    if (did) finish(obj, null);
  }

  function addColOnce(at, dir) {
    var t = at.obj.table;
    var cols = colsOf(t);
    var from = Math.max(0, Math.min(at.cell.c, cols - 1));
    var pos = Math.max(0, Math.min(dir > 0 ? at.cell.c + at.cell.cs : at.cell.c, cols));
    var size = colSize(t, from);
    var i, c, k;

    var covered = {};
    for (i = 0; i < t.cells.length; i++) {
      c = t.cells[i];
      if (c.c < pos && c.c + c.cs > pos) for (k = 0; k < c.rs; k++) covered[c.r + k] = true;
    }

    var made = [];
    for (i = 0; i < t.cells.length; i++) {
      c = t.cells[i];
      if (c.c > from || c.c + c.cs <= from) continue;
      made = made.concat(runs(c, covered, pos, false, size));
    }

    for (i = 0; i < t.cells.length; i++) {
      c = t.cells[i];
      if (c.c < pos && c.c + c.cs > pos) { c.cs++; c.wHu = (c.wHu || 0) + size; }
      else if (c.c >= pos) c.c++;
    }

    t.cells = t.cells.concat(made);
    resize(at.obj);
    pushOp(at.obj, { op: 'addCol', pos: pos, from: from });
  }

  function addCol(dir, n) {
    var at = here();
    if (!at) return;
    var obj = at.obj, keep = keepId(at);
    beginStruct();

    for (var s = 0; s < times(n); s++) {
      at = here();
      if (!at) break;
      addColOnce(at, dir);
    }
    finish(obj, keep);
  }

  function delColOnce(t, obj, pos) {
    if (colsOf(t) <= 1 || pos < 0 || pos >= colsOf(t)) return false;
    var size = colSize(t, pos);
    var keep = [];

    for (var i = 0; i < t.cells.length; i++) {
      var c = t.cells[i];
      if (c.c === pos) {
        if (c.cs <= 1) continue;
        c.cs--; c.wHu = (c.wHu || 0) - size;
      } else if (c.c < pos && c.c + c.cs > pos) { c.cs--; c.wHu = (c.wHu || 0) - size; }
      else if (c.c > pos) c.c--;
      keep.push(c);
    }

    t.cells = keep;
    pushOp(obj, { op: 'delCol', pos: pos });
    return true;
  }

  function delCol(n) {
    var at = here();
    if (!at) return;
    var t = at.obj.table, obj = at.obj, pos = at.cell.c, did = false;

    beginStruct();
    for (var s = 0; s < times(n); s++) {
      if (!delColOnce(t, obj, pos)) break;
      resize(obj);
      did = true;
    }
    if (did) finish(obj, null);
  }

  /* 블록을 한 칸으로 합친다. 남는 칸은 왼쪽 위 칸이고 나머지 칸의 문단을 <b>순서대로 이어 붙인다</b>.
     ★ 크기는 사각형 위·왼쪽 줄의 칸 크기를 더해서 낸다 — sizes() 로 재면 그 열에 단칸이 하나도
       없을 때 어림값이 들어와 표 폭이 달라진다. */
  function mergeBlock() {
    var b = blockCells();
    if (!b) return false;
    if (b.cells.length < 2) { hwSetStatus({ text: '두 칸 이상 고른 뒤 합칠 수 있습니다' }); return false; }

    beginStruct();
    var t = b.obj.table, rect = b.rect, i, keeper = null, w = 0, h = 0;
    for (i = 0; i < b.cells.length; i++) {
      var c = b.cells[i];
      if (c.r === rect.r0 && c.c === rect.c0) keeper = c;
      if (c.r === rect.r0) w += c.wHu || 0;
      if (c.c === rect.c0) h += c.hHu || 0;
    }
    if (!keeper) return false;

    for (i = 0; i < b.cells.length; i++) {
      if (b.cells[i] === keeper) continue;
      for (var q = 0; q < b.cells[i].paras.length; q++) keeper.paras.push(b.cells[i].paras[q]);
    }

    var keep = [];
    for (i = 0; i < t.cells.length; i++)
      if (t.cells[i] === keeper || !inRect(t.cells[i], rect)) keep.push(t.cells[i]);
    t.cells = keep;

    keeper.rs = rect.r1 - rect.r0 + 1;
    keeper.cs = rect.c1 - rect.c0 + 1;
    keeper.wHu = w;
    keeper.hHu = h;
    tighten(t);
    resize(b.obj);

    pushOp(b.obj, { op: 'mergeCells', r0: rect.r0, c0: rect.c0, r1: rect.r1, c1: rect.c1 });
    cBlock = null;
    finish(b.obj, keeper.paras.length ? keeper.paras[0].id : null);
    return true;
  }

  /* 칸 하나를 rows×cols 로 나눈다.
     ★ 칸의 span 이 나누는 수로 안 떨어지면 <b>격자 전체를 그 수만큼 곱한 뒤</b> 나누고, 아무 칸도
       시작하지 않게 된 유령 행·열을 tighten 으로 접는다. 이 길만이 옆 줄의 칸 경계를 안 건드린다. */
  function splitCell(nRows, nCols) {
    var b = blockCells(), at = here(), obj, cell;
    if (b) {
      if (b.cells.length !== 1) { hwSetStatus({ text: '칸 하나만 고른 뒤 나눌 수 있습니다' }); return false; }
      obj = b.obj; cell = b.cells[0];
    } else if (at) { obj = at.obj; cell = at.cell; }
    else return false;

    nRows = Math.max(1, Math.min(64, Math.floor(nRows) || 1));
    nCols = Math.max(1, Math.min(64, Math.floor(nCols) || 1));
    if (nRows === 1 && nCols === 1) return false;

    beginStruct();
    var t = obj.table, i, origR = cell.r, origC = cell.c;

    if (nCols > 1 && cell.cs % nCols !== 0)
      for (i = 0; i < t.cells.length; i++) { t.cells[i].c *= nCols; t.cells[i].cs *= nCols; }
    if (nRows > 1 && cell.rs % nRows !== 0)
      for (i = 0; i < t.cells.length; i++) { t.cells[i].r *= nRows; t.cells[i].rs *= nRows; }

    var r0 = cell.r, c0 = cell.c, pr = cell.rs / nRows, pc = cell.cs / nCols;
    var w0 = cell.wHu || 0, h0 = cell.hHu || 0;
    var ew = Math.floor(w0 / nCols), eh = Math.floor(h0 / nRows);

    var keep = [];
    for (i = 0; i < t.cells.length; i++) if (t.cells[i] !== cell) keep.push(t.cells[i]);

    var made = [];
    for (var a = 0; a < nRows; a++)
      for (var k = 0; k < nCols; k++) {
        var ww = k === nCols - 1 ? w0 - ew * (nCols - 1) : ew;
        var hh = a === nRows - 1 ? h0 - eh * (nRows - 1) : eh;
        var nc = (a === 0 && k === 0) ? cell : emptyLike(cell, 0, 0, 1, 1, 0, 0);
        nc.r = r0 + a * pr; nc.c = c0 + k * pc; nc.rs = pr; nc.cs = pc;
        nc.wHu = ww; nc.hHu = hh;
        made.push(nc);
      }

    t.cells = keep.concat(made);
    tighten(t);
    resize(obj);

    pushOp(obj, { op: 'splitCell', r0: origR, c0: origC, rows: nRows, cols: nCols });
    cBlock = null;
    finish(obj, cell.paras.length ? cell.paras[0].id : null);
    return true;
  }

  /* 블록이 덮는 열(행)의 폭(높이)을 고르게 나눈다. 바깥 크기는 그대로다 — 합을 다시 나누기만 한다. */
  function applySame(t, isWidth, a0, a1) {
    var size = sizes(t, !isWidth), i, k;
    var n = a1 - a0 + 1, total = 0;
    for (i = a0; i <= a1 && i < size.length; i++) total += size[i];
    var each = Math.floor(total / n);
    for (i = a0; i <= a1 && i < size.length; i++) size[i] = i === a1 ? total - each * (n - 1) : each;

    for (i = 0; i < t.cells.length; i++) {
      var c = t.cells[i];
      var at = isWidth ? c.c : c.r, span = isWidth ? c.cs : c.rs, sum = 0;
      for (k = at; k < at + span && k < size.length; k++) sum += size[k];
      if (isWidth) c.wHu = sum; else c.hHu = sum;
    }
  }

  function sameSize(isWidth) {
    var b = blockCells();
    if (!b) { hwSetStatus({ text: 'F5 로 칸을 고른 뒤 크기를 맞출 수 있습니다' }); return false; }

    var a0 = isWidth ? b.rect.c0 : b.rect.r0, a1 = isWidth ? b.rect.c1 : b.rect.r1;
    if (a1 <= a0) { hwSetStatus({ text: (isWidth ? '두 칸' : '두 줄') + ' 이상을 고르세요' }); return false; }

    beginStruct();
    applySame(b.obj.table, isWidth, a0, a1);
    resize(b.obj);
    pushOp(b.obj, isWidth ? { op: 'sameWidth', c0: a0, c1: a1 } : { op: 'sameHeight', r0: a0, r1: a1 });

    var keepBlock = { obj: b.obj, r0: b.rect.r0, c0: b.rect.c0, r1: b.rect.r1, c1: b.rect.c1, mode: 2 };
    finish(b.obj, null);
    cBlock = keepBlock;
    hwCaret.paint();
    return true;
  }

  /* 칸 서식. 지금 블록(없으면 캐럿이 든 칸 하나)에 걸고 <c>cellFmt</c> 를 쌓는다.
     ★ 구조를 안 바꾸니 <c>finish</c> 를 안 부른다 — 되돌리기 이력을 끊을 이유가 없고,
       문단 id 도 그대로라 저장 뒤 재적재도 필요 없다. */
  function setCellFmt(over) {
    var b = blockCells();
    if (!b) {
      var at = here();
      if (!at) { hwSetStatus({ text: '표 칸 안에서 쓰세요' }); return false; }
      b = { obj: at.obj, rect: { r0: at.cell.r, c0: at.cell.c, r1: at.cell.r, c1: at.cell.c }, cells: [at.cell] };
    }

    for (var i = 0; i < b.cells.length; i++) {
      var c = b.cells[i];
      if (over.bf !== undefined) c.bf = over.bf;
      if (over.valign !== undefined) c.valign = over.valign;
      if (over.head !== undefined) c.head = over.head;
      if (over.cmL !== undefined) { c.mlHu = over.cmL; c.mrHu = over.cmR; c.mtHu = over.cmT; c.mbHu = over.cmB; }
    }

    var op = { op: 'cellFmt', r0: b.rect.r0, c0: b.rect.c0, r1: b.rect.r1, c1: b.rect.c1 };
    for (var k in over) if (over.hasOwnProperty(k)) op[k] = over[k];
    pushOp(b.obj, op);

    b.obj._grid = null;
    hwRelayout();
    if (window.hwPostDirty) hwPostDirty();
    hwCaret.paint();
    return true;
  }

  /* 표 서식(표 속성). 캐럿이 든 표 또는 고른 표 개체에 건다. */
  function setTableFmt(over) {
    var b = blockCells(), obj = b ? b.obj : null;
    if (!obj) { var at = here(); obj = at ? at.obj : null; }
    if (!obj) { hwSetStatus({ text: '표 칸 안에서 쓰세요' }); return false; }

    var t = obj.table;
    if (over.bf !== undefined) t.bf = over.bf;
    if (over.divide !== undefined) t.divide = over.divide;
    if (over.repeatHeader !== undefined) t.repeatHeader = over.repeatHeader;
    if (over.omL !== undefined) { obj.omLHu = over.omL; obj.omRHu = over.omR; obj.omTHu = over.omT; obj.omBHu = over.omB; }

    var op = { op: 'tableFmt' };
    for (var k in over) if (over.hasOwnProperty(k)) op[k] = over[k];
    pushOp(obj, op);

    obj._grid = null;
    hwRelayout();
    if (window.hwPostDirty) hwPostDirty();
    hwCaret.paint();
    return true;
  }

  /* 고친 표를 화면에 반영하고 요청을 쌓는다.
     ★ 캐럿은 <b>있던 칸에 그대로</b> 둔다. 표를 고칠 때마다 첫 칸으로 튀면, 이어서 누르는
       "행 빼기" 가 방금 넣은 행이 아니라 엉뚱한 행을 지운다. 그 칸이 사라졌을 때만 첫 칸으로 간다. */
  function resize(obj) {
    var t = obj.table;
    compact(t);
    t.rows = rowsOf(t);
    t.cols = colsOf(t);
    obj.wHu = extent(t, false);
    obj.hHu = extent(t, true);
  }

  function finish(obj, pKeep) {
    obj.table.cells.sort(function (a, b) { return a.r - b.r || a.c - b.c; });
    obj._grid = null;
    cBlock = null;                     /* 칸 자체가 바뀌었다 — 옛 사각형은 다른 칸을 가리킨다 */

    hwModel.reindex();
    hwRelayout();

    var to = pKeep && hwModel.byId(pKeep) ? pKeep : null;
    if (!to && obj.table.cells.length) to = obj.table.cells[0].paras[0].id;
    if (to) hwCaret.set(to, 0, false);

    /* ★ 이력을 끊지 않는다 — hwUndo 스냅샷이 표 격자(칸 목록·번호·크기)와 표 구조 op 까지
       담으므로 구조 편집도 Ctrl+Z 한 번으로 화면과 저장 요청이 같이 되돌아간다(hwUndo.tableSnap). */
    if (window.hwUndo) hwUndo.commit([]);

    /* ★ 표 편집은 hwInput.status() 를 안 지난다 — 알림을 거기에만 걸면 행을 넣고 그냥 닫아도
       "저장할까요" 가 안 뜬다. */
    if (window.hwPostDirty) hwPostDirty();

    hwCaret.paint();
    hwSetStatus({ text: '표를 고쳤습니다(Ctrl+Z 로 되돌릴 수 있습니다) — 저장하면 문서에 반영됩니다' });
  }

  return {
    measure: measure, place: place, placeRange: placeRange, textWidth: textWidth, pad: pad,
    headRows: headRows, breakRow: breakRow, nextBreak: nextBreak,
    here: here, edgePara: edgePara, addRow: addRow, delRow: delRow, addCol: addCol, delCol: delCol,
    nextCell: nextCell, removeTable: removeTable, insertTable: insertTable,
    rowsOf: function (t) { return rowsOf(t); }, colsOf: function (t) { return colsOf(t); },
    block: function () { return cBlock; }, blockCells: blockCells, blockOff: blockOff,
    clearBlock: clearBlock, cycleBlock: cycleBlock, dragBlock: dragBlock, paintBlock: paintBlock,
    selectRange: selectRange, onKey: onKey,
    mergeBlock: mergeBlock, splitCell: splitCell, sameSize: sameSize,
    setCellFmt: setCellFmt, setTableFmt: setTableFmt
  };
})();
