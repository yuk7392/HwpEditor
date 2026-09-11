/* 표 배치(5단계).

   ★ 셀 안의 문단을 <b>보통 줄과 똑같이</b> 만들어 쪽의 줄 목록에 넣는다. 좌표만 본문 기준 절대값으로
     바꿔 담으면 캐럿·선택·hit test·그리기가 표를 따로 알 필요가 없다 — 표 전용 캐럿을 또 만들면
     본문과 표에서 동작이 갈린다.
   ★ 행 높이는 <b>원본 값을 먼저 믿고</b>, 셀 내용이 그보다 커질 때만 늘린다. 처음부터 다시 계산하면
     한글이 잡아 둔 표 모양이 열기만 해도 달라진다(계획 2절 "원본 유지 + 변경분만").
   ★ 칸의 자리는 <b>칸이 들고 있는 행·열 번호</b>로 잡는다. 목록 차례로 잡으면 위에서 아래로 걸친
     칸(rowSpan)이 있는 행은 칸이 하나 적어서, 그 행부터 x 가 통째로 왼쪽으로 밀린다.
   ★ 표가 남은 자리에 안 들어가면 <b>통째로</b> 다음 쪽으로 넘긴다. 행 단위로 쪼개 넘기는 것은
     아직 안 한다(잔여). */

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

  /* 걸친 칸이 요구하는 크기를 그 칸이 덮는 칸들에 나눠 얹는다. 이미 충분하면 아무것도 안 한다. */
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

  /* 표 한 개의 칸 배치를 잰다. 결과는 obj._grid 에 담아 두고 그리기가 다시 쓴다. */
  function measure(obj) {
    var t = obj.table;
    if (!t || !t.cells.length) return { wHu: obj.wHu || 0, hHu: obj.hHu || 0, cells: [] };

    var rows = rowsOf(t), cols = colsOf(t);
    var i, c;

    /* ① 열 폭 — 병합 안 된 칸에서 재고, 걸친 칸이 더 넓으면 모자란 만큼 나눠 얹는다. */
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

    /* ② 행 높이 — 파일이 들고 있던 값이 먼저다. */
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

    /* ③ 내용이 그보다 크면 그 행을 늘린다 — 글을 넣어 넘칠 때 표가 안 커지면 글이 칸 밖으로 나간다.
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

    var grid = { wHu: colX[cols] || obj.wHu || 0, hHu: rowY[rows] || obj.hHu || 0, cells: rects };
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

  /* 셀 안 문단들을 줄로 쪼갰을 때의 높이 합. */
  function contentHeight(cell, widthHu) {
    var h = 0;
    for (var i = 0; i < cell.paras.length; i++) {
      var lines = hwBreak.linesOf(cell.paras[i], widthHu);
      for (var k = 0; k < lines.length; k++) h += lines[k].hHu;
    }
    return h;
  }

  /*
    표 하나를 쪽에 놓는다.
      obj        : 표 개체
      originX/Y  : 본문 기준 표 왼쪽 위(HWPUNIT)
      out        : 줄을 담을 배열(쪽의 lines)
    반환: 표 전체 크기
  */
  function place(obj, originX, originY, out, pageIdx, page) {
    var grid = measure(obj);
    if (page) { if (!page.tables) page.tables = []; page.tables.push(obj); }

    for (var i = 0; i < grid.cells.length; i++) {
      var rect = grid.cells[i];
      var cell = rect.cell;
      var w = textWidth(cell, rect.wHu);

      var y0 = originY + rect.yHu + pad(cell, 'mt');
      var x0 = originX + rect.xHu + pad(cell, 'ml');
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
            pageIdx: pageIdx
          });
          y += lines[k].hHu;
        }
      }
    }

    obj._at = { xHu: originX, yHu: originY, pageIdx: pageIdx };
    return grid;
  }

  /* ── 행·열 넣기·빼기(5단계) ─────────────────────────────
     ★ 화면 모델을 먼저 고치고 같은 뜻의 요청을 저장 때 같이 보낸다. 저장이 끝나면 C# 이 표를
       다시 세우므로 문단 객체가 전부 새것이 되고, 그때 문서를 다시 읽어 id 를 맞춘다.
     ★ 여기 계산은 C# 의 <c>cTableWriter.EditGrid</c> 와 <b>같은 규칙</b>이어야 한다. 갈리면 저장 전
       화면과 저장 뒤 다시 읽은 문서가 다르게 보이고, 그 차이는 되읽기 전까지 아무 신호가 없다. */

  /* 캐럿이 든 표 칸. 표 밖이면 null. */
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
    if (i < 0 || i >= cells.length || !cells[i].paras.length) return true;
    hwCaret.set(cells[i].paras[0].id, 0, false);
    hwCaret.scrollIntoView();
    return true;
  }

  /* 표 지우기(D1). 캐럿이 든 표를 통째로 뺀다 — 둘레 문단은 남고, 캐럿은 표가 있던 자리로 간다.
     ★ 글자 지우기로는 표가 안 지워진다(hwModel.keeps). 이 명령만 그 막음을 우회한다.
     ★ 저장은 부모 문단 되쓰기로 끝난다 — 되쓰기가 문단의 컨트롤을 비우고 objs 에 있는 것만 다시 넣는다
       (cHwpWriter.Rewrite·cHwpxWriter.Rewrite). 그 표에 쌓인 행·열 요청은 떨어져 나간 표를 고칠 뿐이다.
     ★ 되돌리기 한 칸이다. 스냅샷이 부모 문단의 objs 를 얕게 담으므로 표 객체가 칸·글자째 돌아온다. */
  function removeTable() {
    var at = here();
    if (!at) return false;
    var obj = at.obj, host = hwModel.hostOf(obj);
    if (!host) { hwSetStatus({ text: '이 표를 단 문단을 못 찾아 지우지 않았습니다' }); return false; }

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

  /* 고친 뒤에도 캐럿을 둘 문단 id — 지금 있던 칸의 첫 문단. */
  function keepId(at) {
    return at.cell.paras.length ? at.cell.paras[0].id : null;
  }

  /* 행·열 하나의 크기. 병합 안 된 칸에서 재고, 없으면 걸친 칸을 나눈다. */
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
    return {
      r: r, c: c, rs: rs, cs: cs,
      wHu: wHu, hHu: hHu,
      mlHu: src.mlHu, mrHu: src.mrHu, mtHu: src.mtHu, mbHu: src.mbHu,
      paras: [{ id: hwModel.newId(), ps: src.paras.length ? src.paras[0].ps : 0,
                runs: [], objs: [], len: 0, seg: null, _tblNew: true }]
    };
  }

  /* 씨앗 하나에서 <b>아직 안 덮인 구간마다</b> 빈 칸을 뜬다(C# cTableWriter.Runs 와 같은 규칙).
     ★ 씨앗의 첫 번호 하나로 판정하면 안 된다 — 씨앗이 두 칸에 걸쳐 있는데 그중 하나만 덮여 있으면
       통째로 건너뛰어 빈 자리가 생기거나 통째로 복제해 겹침이 생긴다. */
  function runs(seed, covered, at, isRow, newSize) {
    var out = [];
    var start = isRow ? seed.c : seed.r;         /* 씨앗이 걸쳐 있는 구간 */
    var span = isRow ? seed.cs : seed.rs;
    var whole = (isRow ? seed.wHu : seed.hHu) || 0;

    var k = start, end = start + span;
    while (k < end) {
      while (k < end && covered[k]) k++;
      var run = k;
      while (k < end && !covered[k]) k++;
      if (k <= run) continue;

      var part = Math.floor(whole * (k - run) / Math.max(1, span));   /* 걸친 만큼 크기도 나눈다 */
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

  /* 표 바깥 크기를 격자에서 다시 낸다 — C# 의 Resize 와 같은 규칙이라야 저장 전후가 안 갈린다. */
  function extent(t, isRow) {
    var n = isRow ? rowsOf(t) : colsOf(t);
    var size = [], i;
    for (i = 0; i < n; i++) size.push(0);

    for (i = 0; i < t.cells.length; i++) {
      var a = t.cells[i];
      var at = isRow ? a.r : a.c, span = isRow ? a.rs : a.cs, want = (isRow ? a.hHu : a.wHu) || 0;
      if (span === 1 && want > size[at]) size[at] = want;
    }
    for (i = 0; i < t.cells.length; i++) {
      var b = t.cells[i];
      var bt = isRow ? b.r : b.c, bs = isRow ? b.rs : b.cs, bw = (isRow ? b.hHu : b.wHu) || 0;
      if (bs !== 1) spread(size, bt, bs, bw);
    }

    var all = 0;
    for (i = 0; i < n; i++) all += size[i];
    return all;
  }

  function addRow(dir) {
    var at = here();
    if (!at) return;

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

    finish(at.obj, { op: 'addRow', oid: at.obj.oid, pos: pos, from: from }, keepId(at));
  }

  function delRow() {
    var at = here();
    if (!at) return;

    var t = at.obj.table;
    if (rowsOf(t) <= 1) return;

    var pos = at.cell.r;
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
    resize(at.obj);

    finish(at.obj, { op: 'delRow', oid: at.obj.oid, pos: pos }, null);
  }

  function addCol(dir) {
    var at = here();
    if (!at) return;

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

    finish(at.obj, { op: 'addCol', oid: at.obj.oid, pos: pos, from: from }, keepId(at));
  }

  function delCol() {
    var at = here();
    if (!at) return;

    var t = at.obj.table;
    if (colsOf(t) <= 1) return;

    var pos = at.cell.c;
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
    resize(at.obj);

    finish(at.obj, { op: 'delCol', oid: at.obj.oid, pos: pos }, null);
  }

  /* 고친 표를 화면에 반영하고 요청을 쌓는다.
     ★ 캐럿은 <b>있던 칸에 그대로</b> 둔다. 표를 고칠 때마다 첫 칸으로 튀면, 이어서 누르는
       "행 빼기" 가 방금 넣은 행이 아니라 엉뚱한 행을 지운다. 그 칸이 사라졌을 때만 첫 칸으로 간다. */
  /* 격자를 정리하고 표 크기를 다시 낸다 — 네 갈래가 똑같이 해야 해서 한 자리에 모은다. */
  function resize(obj) {
    var t = obj.table;
    compact(t);
    t.rows = rowsOf(t);
    t.cols = colsOf(t);
    obj.wHu = extent(t, false);
    obj.hHu = extent(t, true);
  }

  function finish(obj, op, pKeep) {
    obj.table.cells.sort(function (a, b) { return a.r - b.r || a.c - b.c; });
    obj._grid = null;

    hwModel.pushTableOp(op);
    hwModel.reindex();
    hwRelayout();

    var to = pKeep && hwModel.byId(pKeep) ? pKeep : null;
    if (!to && obj.table.cells.length) to = obj.table.cells[0].paras[0].id;
    if (to) hwCaret.set(to, 0, false);

    /* ★ 되돌리기 이력을 비운다. 표 구조는 되돌릴 수 있는 것이 아닌데(칸 자체가 바뀐다) 이력을 두면
       Ctrl+Z 가 <b>글자만</b> 되돌려, 화면에는 넣은 행이 그대로 있는데 저장 요청은 그 전 상태가 된다. */
    if (window.hwUndo) hwUndo.clear();

    /* ★ 표 편집은 hwInput.status() 를 안 지난다 — 알림을 거기에만 걸면 행을 넣고 그냥 닫아도
       "저장할까요" 가 안 뜬다. */
    if (window.hwPostDirty) hwPostDirty();

    hwCaret.paint();
    hwSetStatus({ text: '표를 고쳤습니다(되돌리기는 여기서 끊깁니다) — 저장하면 문서에 반영됩니다' });
  }

  return {
    measure: measure, place: place, textWidth: textWidth, pad: pad,
    here: here, edgePara: edgePara, addRow: addRow, delRow: delRow, addCol: addCol, delCol: delCol,
    nextCell: nextCell, removeTable: removeTable
  };
})();
