/* ★ 모델을 두 벌로 만들지 않는다 — 편집도 이 객체를 고치고, 저장할 때 dirty 문단만 ops 로 뽑는다. */

var hwDoc = null;

var hwModel = (function () {
  'use strict';

  var cById = {};
  var cOrder = {};
  var cDirty = {};

  /* 지운 <b>원본</b> 문단 id. 새로 만들었다가 지운 것은 저장할 때 보낼 것이 없으므로 안 담는다. */
  var cDeleted = [];

  /* 표 구조를 바꾼 요청. 저장할 때 맨 뒤에 붙여 보낸다. */
  var cTableOps = [];

  /* 문서·구역 단위 요청(secFmt 등). ★ 표 구조 요청과 <b>따로</b> 담는다 — 표 요청은 맨 뒤라야
     하는데(칸 객체가 새로 생긴다) 구역 요청은 문단과 무관해서 순서에 매이지 않는다. */
  var cSecOps = [];

  /* 새 문단·새 개체에 붙일 일련번호. id 는 n1, n2 … 이고 C# 이 그 이름 그대로 표에 등록한다. */
  var cSeq = 0;

  /* 아직 <b>문서에 안 들어간</b> 새 문단 id.
     ★ id 앞글자만 보고 "새 문단" 이라 판정하면 안 된다 — 한 번 저장한 뒤에도 id 는 n1 그대로라
       두 번째 저장에서 같은 문단을 또 넣게 된다. */
  var cFresh = {};

  /* 모델이 바뀔 때마다 오르는 번호. 문단 머리 번호(hwHead)처럼 문서 전체를 훑어 만든 것을
     언제 다시 만들지 가리는 데 쓴다 — 문단마다 다시 세면 긴 문서에서 눈에 띄게 느려진다. */
  var cGen = 0;

  function index(doc) {
    cById = {};
    cOrder = {};
    if (!doc) return;

    var at = { n: 0 };
    for (var si = 0; si < doc.sections.length; si++) {
      var paras = doc.sections[si].paras;
      for (var pi = 0; pi < paras.length; pi++) {
        var p = paras[pi];
        p._sec = si;
        p._cell = null;
        cById[p.id] = p;
        cOrder[p.id] = at.n++;
        indexCells(p, si, at);
      }
    }
  }

  /* ★ 순서(cOrder)에도 넣는다. 안 넣으면 셀을 지나는 선택 범위의 앞뒤를 못 가린다.
     ★ <c>_cell</c> 을 달아 둔다 — 넣기·지우기가 구역이 아니라 그 칸의 문단 목록을 봐야 한다. */
  function indexCells(para, si, at) {
    if (!para.objs) return;
    for (var i = 0; i < para.objs.length; i++) {
      var o = para.objs[i];
      /* 머리말·꼬리말 안 문단도 칸과 <b>같은 규칙</b>으로 색인한다 — 안 하면 그 글자를 고쳐도
         저장 요청에 안 실리고(dirty 로 못 잡는다) 찾기·바꾸기도 못 본다. */
      for (var h = 0; o.paras && h < o.paras.length; h++) {
        var b = o.paras[h];
        b._sec = si;
        b._cell = null;
        b._band = o;
        cById[b.id] = b;
        cOrder[b.id] = at.n++;
        indexCells(b, si, at);
      }
      if (!o.table || !o.table.cells) continue;
      for (var c = 0; c < o.table.cells.length; c++) {
        var cell = o.table.cells[c];
        cell._obj = o;                      /* 칸에서 표로 거슬러 올라갈 길 */
        for (var k = 0; k < cell.paras.length; k++) {
          var q = cell.paras[k];
          q._sec = si;
          q._cell = cell;
          cById[q.id] = q;
          cOrder[q.id] = at.n++;
          indexCells(q, si, at);
        }
      }
    }
  }

  function listOf(para) {
    return para._cell ? para._cell.paras : hwDoc.sections[para._sec].paras;
  }

  /* ★ 구역의 paras 만 도는 코드를 쓰면 안 된다. 서식·복사·선택 칠하기·지우기가 전부 그 형태였고,
       그래서 표 칸 안에서는 굵게도 복사도 선택 강조도 <b>아무 일이 안 일어났다</b>.
     ★ 차례는 cOrder 와 같아야 한다 — 여기 순서와 색인 순서가 갈리면 선택 범위의 앞뒤가 뒤집힌다. */
  function allParas() {
    var out = [];
    if (!hwDoc) return out;
    for (var si = 0; si < hwDoc.sections.length; si++) {
      var paras = hwDoc.sections[si].paras;
      for (var pi = 0; pi < paras.length; pi++) withCells(paras[pi], out);
    }
    return out;
  }

  /* ★ 차례는 색인(indexCells)과 <b>글자 그대로 같아야</b> 한다 — 개체마다 띠 → 표 칸 순이다.
     띠를 전부 돌고 나서 표를 도는 식으로 갈리면, 한 문단에 띠와 표가 같이 달렸을 때
     orderOf 와 이 목록의 자리가 어긋나 선택 범위의 앞뒤가 뒤집힌다. */
  function withCells(p, out) {
    out.push(p);
    var objs = p.objs || [];
    for (var i = 0; i < objs.length; i++) {
      var bp = objs[i].paras || [];
      for (var k2 = 0; k2 < bp.length; k2++) withCells(bp[k2], out);

      var t = objs[i].table;
      if (!t || !t.cells) continue;
      for (var c = 0; c < t.cells.length; c++)
        for (var k = 0; k < t.cells[c].paras.length; k++) withCells(t.cells[c].paras[k], out);
    }
  }

  function eachTableOf(p, fn) {
    var objs = p.objs || [];
    for (var i = 0; i < objs.length; i++) if (objs[i].table) fn(objs[i].table, objs[i]);
  }

  /* 개체(표)를 달고 있는 문단. 칸 안에서 표 바깥으로 거슬러 올라갈 때 쓴다. */
  function hostOf(obj) {
    var all = allParas();
    for (var i = 0; i < all.length; i++) if ((all[i].objs || []).indexOf(obj) >= 0) return all[i];
    return null;
  }

  /* 문서 안의 표 개체 전부. 되돌리기가 표 격자를 통째로 담을 때 쓴다. */
  function allTableObjs() {
    var out = [];
    var ps = allParas();
    for (var i = 0; i < ps.length; i++)
      eachTableOf(ps[i], function (t, obj) { out.push(obj); });
    return out;
  }

  function allCells() {
    var out = [];
    var ps = allParas();
    for (var i = 0; i < ps.length; i++)
      eachTableOf(ps[i], function (t) {
        for (var c = 0; c < t.cells.length; c++) out.push(t.cells[c]);
      });
    return out;
  }

  /* 문단의 편집 인덱스 기준 글자열. 개체는 한 자리를 차지하므로 U+FFFC(개체 치환 문자)로 채운다.
     ★ 이 문자열의 길이가 곧 para.len 이어야 한다 — 어긋나면 seg 대조가 통째로 밀린다. */
  function text(para) {
    if (para._text !== undefined) return para._text;

    var parts = [];
    for (var i = 0; i < para.runs.length; i++) parts.push(para.runs[i].text);
    var s = parts.join('');

    if (para.objs && para.objs.length) {
      /* ★ pos 는 <b>개체까지 센 최종 좌표</b>다 — 그래서 <b>앞에서부터</b> 넣어야 한다.
           뒤에서부터 넣으면 앞 개체가 아직 안 들어간 상태의 좌표에 끼워져 개체가 글자 사이사이로
           흩어진다. */
      var objs = para.objs.slice().sort(function (a, b) { return a.pos - b.pos; });
      for (var k = 0; k < objs.length; k++) {
        var at = Math.min(objs[k].pos, s.length);
        s = s.slice(0, at) + '￼' + s.slice(at);
      }
    }
    para._text = s;
    return s;
  }

  function shapeAt(para, pos) {
    var objs = para.objs || [];
    var before = 0;
    for (var i = 0; i < objs.length; i++) if (objs[i].pos < pos) before++;

    var at = 0, target = pos - before;
    for (var r = 0; r < para.runs.length; r++) {
      var run = para.runs[r];
      if (target < at + run.text.length) return run.cs;
      at += run.text.length;
    }
    return para.runs.length ? para.runs[para.runs.length - 1].cs : 0;
  }

  function markDirty(id) {
    cGen++;
    cDirty[id] = true;
    var p = cById[id];
    if (p) { p.seg = null; p._text = undefined; p._lines = null; }
  }

  /* ★ 문단 내용을 <b>항목 배열</b>로 펼쳤다가 되담는다. runs·objs 를 직접 자르면 개체 위치와
       글자모양 경계를 동시에 맞춰야 해서, 어느 한쪽이 어긋난 것을 눈으로는 못 잡는다.
       문단 하나는 길어야 수천 글자라 매번 펼쳐도 값이 싸다. */

  function items(para) {
    var out = [];
    var byPos = {};
    var objs = para.objs || [];
    for (var i = 0; i < objs.length; i++) byPos[objs[i].pos] = objs[i];

    var runIdx = 0, runOff = 0;
    for (var p = 0; p < para.len; p++) {
      if (byPos[p]) { out.push({ obj: byPos[p] }); continue; }

      while (runIdx < para.runs.length && runOff >= para.runs[runIdx].text.length) { runIdx++; runOff = 0; }
      if (runIdx >= para.runs.length) break;

      out.push({ ch: para.runs[runIdx].text.charAt(runOff), cs: para.runs[runIdx].cs });
      runOff++;
    }
    return out;
  }

  function setItems(para, arr) {
    var runs = [], objs = [], cur = null;
    for (var i = 0; i < arr.length; i++) {
      var it = arr[i];
      if (it.obj) { it.obj.pos = i; objs.push(it.obj); cur = null; continue; }
      if (!cur || cur.cs !== it.cs) { cur = { cs: it.cs, text: '' }; runs.push(cur); }
      cur.text += it.ch;
    }
    para.runs = runs;
    para.objs = objs;
    para.len = arr.length;
    markDirty(para.id);
  }

  function insertText(para, pos, str, cs) {
    if (!str) return 0;
    var a = items(para);
    var add = [];
    for (var i = 0; i < str.length; i++) add.push({ ch: str.charAt(i), cs: cs });
    a.splice.apply(a, [Math.max(0, Math.min(pos, a.length)), 0].concat(add));
    setItems(para, a);
    return str.length;
  }

  function insertObj(para, pos, obj) {
    var a = items(para);
    a.splice(Math.max(0, Math.min(pos, a.length)), 0, { obj: obj });
    setItems(para, a);
  }

  /* ★ 화면에 안 보이는 컨트롤(용지·단 정의) — 지우면 저장할 때 그 구역의 용지 정의가 통째로 사라진다.
     ★ 표 — 표는 한 글자 자리를 차지해서, 이걸 안 막으면 표 옆에서 Backspace/Delete 한 번이나 표를
       가로지른 선택 지우기에 칸 내용까지 통째로 날아간다. 한글도 그 자리에서는
       표를 안 지우고 칸으로 들어간다. */
  function keeps(o) { return !!(o && (o.hidden || o.table)); }

  /* 범위를 지운다. 안 지워지는 개체(keeps)는 지운 자리 앞으로 모아 둔다. */
  function deleteRange(para, from, to) {
    if (to <= from) return 0;
    var a = items(para);
    from = Math.max(0, from);
    to = Math.min(a.length, to);

    var cut = a.splice(from, to - from);
    var keep = [];
    for (var i = 0; i < cut.length; i++) if (keeps(cut[i].obj)) keep.push(cut[i]);

    /* 지울 것이 하나도 없었으면(표·컨트롤만 걸렸으면) 문단을 안 건드린다 — 되담으면 dirty 가 되어
       바뀐 것도 없는 문단(표를 단 문단)이 저장 때 통째로 다시 쓰인다. */
    if (keep.length === cut.length) return 0;
    if (keep.length) a.splice.apply(a, [from, 0].concat(keep));

    setItems(para, a);
    return (to - from) - keep.length;
  }

  function splitPara(para, pos) {
    var a = items(para);
    var tail = a.splice(Math.max(0, Math.min(pos, a.length)));
    setItems(para, a);

    var np = { id: 'n' + (++cSeq), ps: para.ps, runs: [], objs: [], len: 0, seg: null,
               _sec: para._sec, _cell: para._cell || null };

    /* ★ 표가 만들 칸에서 나눈 문단도 같은 칸의 것이다. 표시를 안 물려주면 저장 요청에 insertAfter 가
       실리고, 그 기준 문단(_tblNew)이 문서에 없어서 저장이 통째로 예외로 끝난다. */
    if (para._tblNew) { np._tblNew = true; if (para._tblOwner) np._tblOwner = true; }
    else cFresh[np.id] = true;
    setItems(np, tail);
    insertAfter(para, np);
    return np;
  }

  function mergeNext(para) {
    var next = after(para);
    if (!next) return false;

    var a = items(para).concat(items(next));
    setItems(para, a);
    removePara(next);
    return true;
  }

  function insertAfter(para, np) {
    var list = listOf(para);
    var at = list.indexOf(para);
    list.splice(at < 0 ? list.length : at + 1, 0, np);
    np._sec = para._sec;
    np._cell = para._cell || null;
    index(hwDoc);
    markDirty(np.id);
  }

  function removePara(para) {
    var list = listOf(para);
    var at = list.indexOf(para);
    if (at < 0) return;
    list.splice(at, 1);

    if (para.id.charAt(0) !== 'n' && cDeleted.indexOf(para.id) < 0) cDeleted.push(para.id);
    delete cDirty[para.id];
    index(hwDoc);
  }

  function after(para) { return neighbour(para, +1); }
  function before(para) { return neighbour(para, -1); }

  function neighbour(para, step) {
    var si = para._sec;
    var list = listOf(para);
    var at = list.indexOf(para);
    if (at < 0) return null;

    if (at + step >= 0 && at + step < list.length) return list[at + step];

    /* ★ 표 칸의 끝에서는 멈춘다. 칸 밖으로 이어 가면 지우기·합치기가 표 밖 문단을 건드린다. */
    if (para._cell) return null;

    var ns = si + step;
    while (ns >= 0 && ns < hwDoc.sections.length) {
      var other = hwDoc.sections[ns].paras;
      if (other.length) return step > 0 ? other[0] : other[other.length - 1];
      ns += step;
    }
    return null;
  }

  function buildOps() {
    var ops = [];

    /* 지운 문단 먼저 — C# 은 replace → delete → insertAfter 순으로 적용한다. */
    for (var d = 0; d < cDeleted.length; d++) ops.push({ op: 'delete', id: cDeleted[d] });

    cDropped = 0;

    /* ★ 행·열을 넣어 생긴 칸의 글은 먼저 훑는다 — 여기서 단 `_carried` 를 pushOp 가 보고
       "빠진 글자" 로 안 센다. 실어 보내는 것은 맨 뒤다(표 구조 op 뒤여야 한다). */
    var cellOps = [];
    for (var cs0 = 0; cs0 < hwDoc.sections.length; cs0++) cellTextOps(hwDoc.sections[cs0].paras, cellOps);

    for (var si = 0; si < hwDoc.sections.length; si++) {
      var paras = hwDoc.sections[si].paras;
      for (var pi = 0; pi < paras.length; pi++) opsForList(paras, pi, ops);
    }

    /* 새 그림은 실물 경로를 따로 실어 보낸다. */
    for (var si2 = 0; si2 < hwDoc.sections.length; si2++) {
      var list = hwDoc.sections[si2].paras;
      for (var k = 0; k < list.length; k++) imageOps(list[k], ops);
    }

    for (var so = 0; so < cSecOps.length; so++) ops.push(cSecOps[so]);

    /* ★ 표 구조는 맨 뒤다. 표를 다시 세우면 셀 문단 객체가 전부 새것이 되므로,
       그 앞의 셀 문단 요청이 먼저 반영돼야 한다. */
    for (var tt = 0; tt < cTableOps.length; tt++) ops.push(cTableOps[tt]);

    /* ★ 칸 내용은 표 구조 뒤다 — 표를 다시 세우기 전에 부으면 그 칸이 다시 만들어지며 지워진다. */
    for (var co = 0; co < cellOps.length; co++) ops.push(cellOps[co]);
    for (var cl = 0; cl < hwDoc.sections.length; cl++) clearCarried(hwDoc.sections[cl].paras);

    return ops;
  }

  function opsForList(paras, pi, ops) {
    var p = paras[pi];
    pushOp(paras, pi, ops);

    for (var o = 0; o < (p.objs || []).length; o++) {
      var bp = p.objs[o].paras || [];
      for (var h = 0; h < bp.length; h++) opsForList(bp, h, ops);

      var t = p.objs[o].table;
      if (!t) continue;
      for (var c = 0; c < t.cells.length; c++)
        for (var q = 0; q < t.cells[c].paras.length; q++) opsForList(t.cells[c].paras, q, ops);
    }
  }

  /* 표를 고치면서 화면에만 생긴 칸에 친 글자 수. 저장 뒤 다시 읽으면 사라지므로 알려 준다. */
  var cDropped = 0;

  function pushOp(paras, pi, ops) {
    var p = paras[pi];

    /* ★ 행·열을 넣어 <b>화면에만</b> 생긴 칸의 문단은 요청으로 안 보낸다. 문서 쪽 id 표에 없는
       id 라 replace 를 보내면 저장이 통째로 <b>예외로 끝나고</b> 다른 문단의 고침까지 다 날아간다.
       이 칸은 C# 이 표를 다시 세우면서 자기가 만든다. */
    if (p._tblNew) { if (p.len > 0 && !p._tblOwner && !p._carried) cDropped += p.len; return; }

    /* 새 머리말·꼬리말의 안 문단도 같다 — 그 문단은 addHeader 꾸러미가 통째로 들고 간다. */
    if (p._bandNew) return;

    var isNew = !!cFresh[p.id];
    if (!isNew && !cDirty[p.id]) return;

    var op = {
      op: isNew ? 'insertAfter' : 'replace',
      id: p.id,
      ps: p.ps,
      brk: p.brk || null,
      runs: p.runs,
      objs: objRefs(p),
      seg: hwSegOf(p.id)
    };

    /* ★ 스타일은 <b>바꿨을 때만</b> 싣는다 — 늘 실으면 손 안 댄 문단의 스타일까지 화면 값으로 덮인다
       (개체 크기·자리와 같은 규칙). 새 문단은 기준 문단을 복제하므로 그쪽 값이 따라온다. */
    if (p._styleSet) op.sty = p.sty || 0;

    /* ★ 기준 문단은 <b>같은 목록</b>(구역 또는 표 칸) 안에서만 잡는다. 다른 목록의 문단을 기준으로
       주면 새 문단이 엉뚱한 곳에 들어간다. 앞 문단이 없으면 보내지 않는다 — 지금 편집 경로로는
       생기지 않는다(문단 나누기는 늘 기존 문단 뒤에 붙인다). */
    if (isNew) {
      if (pi === 0) { hwSetStatus({ text: '첫 자리에는 아직 문단을 넣을 수 없습니다: ' + p.id }); return; }
      op.ref = paras[pi - 1].id;
    }
    ops.push(op);
  }

  /* addTable 이 들고 갈 칸 목록. 칸 안의 개체는 안 싣는다 — 새 표 칸에 그림을 넣는 길이 아직 없다. */
  /* 행·열을 넣어 화면에만 생긴 칸의 내용을 칸 자리(r·c)로 실어 보낸다. 그 칸의 문단 id 는 문서 쪽
     표에 없어 replace 로 못 가고, C# 이 표를 다시 세운 뒤 자리로 찾아 부어 넣는다.
     ★ 표에 oid 가 있을 때만이다 — 새 표(tmpId)의 칸은 addTable 꾸러미가 통째로 들고 간다. */
  function cellTextOps(paras, ops) {
    for (var i = 0; i < paras.length; i++) {
      var objs = paras[i].objs || [];
      for (var j = 0; j < objs.length; j++) {
        cellTextOps(objs[j].paras || [], ops);

        var t = objs[j].table;
        if (!t) continue;

        var made = [];
        for (var c = 0; c < t.cells.length; c++) {
          var cell = t.cells[c];
          cellTextOps(cell.paras, ops);

          var hit = false;
          for (var q = 0; q < cell.paras.length; q++) {
            var cp = cell.paras[q];
            if (cp._tblNew && !cp._tblOwner && (cp.len > 0 || cell.paras.length > 1)) hit = true;
          }
          if (!hit || !objs[j].oid) continue;

          var list = [];
          for (var w = 0; w < cell.paras.length; w++) {
            list.push({ ps: cell.paras[w].ps, runs: cell.paras[w].runs });
            cell.paras[w]._carried = true;
          }
          made.push({ r: cell.r, c: cell.c, rs: cell.rs, cs: cell.cs, paras: list });
        }
        if (made.length) ops.push({ op: 'cellText', oid: objs[j].oid, cells: made });
      }
    }
  }

  function clearCarried(paras) {
    for (var i = 0; i < paras.length; i++) {
      delete paras[i]._carried;
      var objs = paras[i].objs || [];
      for (var j = 0; j < objs.length; j++) {
        clearCarried(objs[j].paras || []);
        var t = objs[j].table;
        if (!t) continue;
        for (var c = 0; c < t.cells.length; c++) clearCarried(t.cells[c].paras);
      }
    }
  }

  function tableCells(t) {
    var out = [];
    for (var i = 0; i < t.cells.length; i++) {
      var c = t.cells[i], paras = [];
      for (var q = 0; q < c.paras.length; q++) paras.push({ ps: c.paras[q].ps, runs: c.paras[q].runs });
      /* ★ 칸 서식도 같이 싣는다 — 새 표에는 cellFmt 를 보낼 길이 없다(oid 가 아직 없다).
         이 꾸러미에 안 실으면 새 표에 건 테두리·세로 맞춤이 첫 저장에서 통째로 빠진다. */
      out.push({ r: c.r, c: c.c, rs: c.rs, cs: c.cs, wHu: c.wHu, hHu: c.hHu,
                 mlHu: c.mlHu, mrHu: c.mrHu, mtHu: c.mtHu, mbHu: c.mbHu,
                 bf: c.bf || 0, valign: c.valign || 0, head: !!c.head, paras: paras });
    }
    return out;
  }

  function imageOps(p, ops) {
    var objs = p.objs || [];
    for (var j = 0; j < objs.length; j++) {
      /* 표가 만들 칸의 문단은 문서 쪽 id 표에 없다 — 그림도 같이 뺀다(pushOp 와 같은 이유). */
      if (objs[j].tmpId && objs[j].file && !p._tblNew)
        ops.push({
          op: 'addImage', id: p.id, pos: objs[j].pos,
          tmpId: objs[j].tmpId, file: objs[j].file,
          wHu: objs[j].wHu, hHu: objs[j].hHu
        });

      /* 하이퍼링크 시작·끝. ★ 끝은 컨트롤이 없는 표식 하나라 op 도 값이 없다. */
      if (objs[j].tmpId && (objs[j].ctrl === 'fldb' || objs[j].ctrl === 'flde') && !p._tblNew)
        ops.push({
          op: objs[j].ctrl === 'fldb' ? 'addLink' : 'addLinkEnd',
          id: p.id, pos: objs[j].pos, tmpId: objs[j].tmpId, link: objs[j].link || ''
        });

      /* 책갈피 표식. 짝이 없는 하나라 op 도 이름 하나만 들고 간다. */
      if (objs[j].tmpId && objs[j].ctrl === 'bookm' && !p._tblNew)
        ops.push({ op: 'addMark', id: p.id, pos: objs[j].pos, tmpId: objs[j].tmpId, name: objs[j].name || '' });

      /* ★ 새 표는 <b>칸 내용까지</b> 실어 보낸다 — 칸 문단은 문서 쪽 id 표에 없어서 replace 로는 못 간다.
         이것이 "새 표 칸에 친 글자가 저장 때 빠진다"(TODO 2)를 닫는 자리다. */
      if (objs[j].tmpId && objs[j].table && !p._tblNew)
        ops.push({
          op: 'addTable', id: p.id, pos: objs[j].pos, tmpId: objs[j].tmpId,
          rows: objs[j].table.rows, cols: objs[j].table.cols,
          wHu: objs[j].wHu, hHu: objs[j].hHu,
          /* ★ 표 서식도 같이 — 새 표에는 tableFmt 를 보낼 길이 없다(oid 가 아직 없다). */
          bf: objs[j].table.bf || 0,
          divide: objs[j].table.divide || 0,
          repeatHeader: !!objs[j].table.repeatHeader,
          omL: objs[j].omLHu || 0, omR: objs[j].omRHu || 0,
          omT: objs[j].omTHu || 0, omB: objs[j].omBHu || 0,
          cells: tableCells(objs[j].table)
        });

      var t = objs[j].table;
      if (!t) continue;
      for (var c = 0; c < t.cells.length; c++)
        for (var q = 0; q < t.cells[c].paras.length; q++) imageOps(t.cells[c].paras[q], ops);
    }
  }

  /* ★ 예외가 있다: 화면에서 실제로 만진 것만 그 값을 싣는다 — 크기는 `_resized`, 자리는 `_moved`,
       글자처럼 취급은 `_flowed` 다(<b>셋을 따로 본다</b>). 전부 싣지 않는 이유는 두 가지다 —
       손 안 댄 개체까지 화면이 반올림한 값으로 원본을 덮어써서 조금씩 움직이고, 무엇보다 이 목록에는
       <b>안 보이는 컨트롤</b>(용지 정의·단 정의)도 들어 있어서 글자 하나만 쳐도 그것들의 크기가
       통째로 덮인다. */
  function objRefs(para) {
    var out = [];
    var objs = para.objs || [];
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      var r = o.tmpId ? { pos: o.pos, tmpId: o.tmpId } : { pos: o.pos, oid: o.oid };
      /* ★ 크기와 자리를 따로 싣는다. 옮기기만 한 개체에 크기까지 실으면, 리더가 안쪽 자식에서
         읽어 온 값이 바깥 개체에 써질 수 있다. */
      if (o._resized) { r.wHu = o.wHu; r.hHu = o.hHu; }
      if (o._moved) { r.xOffHu = o.xOffHu || 0; r.yOffHu = o.yOffHu || 0; }
      /* ★ 어울림 방식과 글자처럼 취급을 <b>같이 보내지 않는다</b> — 둘이 싸우면 저장은 되고
         여는 쪽에서만 깨진다. 배치를 바꿨으면 그쪽이 이긴다(되쓰기가 flow 를 걸 때 글자처럼 취급을 끈다).
         ★ 글자처럼 취급하던 개체를 "글 뒤로" 로 바꾸면 <b>둘 다</b> 찍히는데, 그때 inline 을 보내면
           되쓰기가 그것을 나중에 덮어 배치가 조용히 안 써진다. */
      if (o._flowSet) r.flow = o.flow;
      else if (o._flowed) r.inline = !!o.inline;
      if (o._zSet) r.z = o.z || 0;
      out.push(r);
    }
    return out;
  }

  function accept(result) {
    cGen++;
    cDirty = {};
    cDeleted = [];
    cFresh = {};
    cTableOps = [];
    cSecOps = [];

    /* ★ 대기 중인 서식도 버린다. 저장하면 모양 번호가 다시 매겨지는데(csMap), 대기 값은
       옛 번호라 그대로 두면 <b>문서에 없는 번호</b>로 글자를 넣게 된다. */
    if (window.hwFormat) hwFormat.clearPending();

    /* ★ 저장하면 되돌리기 이력을 비운다. 저장 지점을 넘어 되돌리면 화면은 옛 모습으로 가는데
       파일에는 저장한 내용이 남아, 그 뒤로 화면과 파일이 갈라진 채 아무 신호도 안 난다
       (되돌린 문단이 dirty 로 안 잡혀 다음 저장에 op 가 하나도 안 실린다). */
    if (window.hwUndo) hwUndo.clear();

    /* 모양 번호가 문서 쪽에서 바뀌었을 수 있다 — 화면 번호를 다시 매긴다. */
    if (result && result.csMap) {
      remapShapes(result.csMap, result.psMap);
      if (window.hwInput) hwInput.remapClip(result.csMap, result.psMap);
    }
    /* 테두리/배경 번호도 문서 쪽에서 바뀔 수 있다 — 문단모양·칸이 가리키는 번호를 다시 매긴다. */
    if (result && result.bfMap) remapBorderFills(result.bfMap);

    if (result && result.charShapes) hwDoc.charShapes = result.charShapes;
    if (result && result.paraShapes) hwDoc.paraShapes = result.paraShapes;
    if (result && result.borderFills) hwDoc.borderFills = result.borderFills;
    if (result && result.numberings) hwDoc.numberings = result.numberings;
    if (result && result.bullets) hwDoc.bullets = result.bullets;
    if (result && result.styles) hwDoc.styles = result.styles;
    if (result && result.bulMap && window.hwFormat) hwFormat.remapHeads(result.bulMap, result.numMap);
    if (result && result.styMap && window.hwFormat) hwFormat.remapStyles(result.styMap);

    var all = allParas();
    for (var i = 0; i < all.length; i++) {
      /* 저장이 끝나면 문서 값이 곧 화면 값이다 — 다음 저장에 또 실어 보낼 이유가 없다. */
      delete all[i]._styleSet;

      var objs = all[i].objs || [];
      for (var j = 0; j < objs.length; j++) {
        delete objs[j]._resized;
        delete objs[j]._moved;
        delete objs[j]._flowed;

        if (!objs[j].tmpId) continue;
        var oid = result && result.newOids ? result.newOids[objs[j].tmpId] : null;
        if (!oid) continue;
        objs[j].oid = oid;
        delete objs[j].tmpId;
        delete objs[j].file;
      }
    }
  }

  /* 문단모양의 bf 는 문서 목록(result.paraShapes)이 그대로 덮으므로 여기서 손대지 않는다 —
     화면에만 있는 번호는 표·칸이 가리키는 것뿐이다. */
  function remapBorderFills(bfMap) {
    var cells = allCells();
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (c.bf && c.bf < bfMap.length) c.bf = bfMap[c.bf];
    }
    var all = allParas();
    for (var p = 0; p < all.length; p++) {
      var objs = all[p].objs || [];
      for (var o = 0; o < objs.length; o++) {
        var t = objs[o].table;
        if (t && t.bf && t.bf < bfMap.length) t.bf = bfMap[t.bf];
      }
    }
  }

  function remapShapes(csMap, psMap) {
    for (var si = 0; si < hwDoc.sections.length; si++) {
      var paras = hwDoc.sections[si].paras;
      for (var pi = 0; pi < paras.length; pi++) remapPara(paras[pi], csMap, psMap);
    }
  }

  function remapPara(p, csMap, psMap) {
    if (psMap && p.ps < psMap.length) p.ps = psMap[p.ps];
    for (var r = 0; r < p.runs.length; r++)
      if (csMap && p.runs[r].cs < csMap.length) p.runs[r].cs = csMap[p.runs[r].cs];

    for (var o = 0; o < (p.objs || []).length; o++) {
      var t = p.objs[o].table;
      if (!t) continue;
      for (var c = 0; c < t.cells.length; c++)
        for (var k = 0; k < t.cells[c].paras.length; k++) remapPara(t.cells[c].paras[k], csMap, psMap);
    }
    p._text = undefined;
    p._lines = null;
  }

  return {
    load: function (doc) {
      hwDoc = doc;
      cDirty = {};
      cDeleted = [];
      cFresh = {};
      cTableOps = [];
      cSecOps = [];
      cSeq = 0;
      cGen++;
      index(doc);
      return doc;
    },
    gen: function () { return cGen; },
    pushTableOp: function (op) { cTableOps.push(op); },
    pushSecOp: function (op) { cSecOps.push(op); },

    /* 이번 저장 전에 넣었다가 도로 뺀 띠의 요청을 걷는다 — 안 걷으면 화면에 없는 띠가 저장본에 생긴다. */
    dropSecOp: function (tmpId) {
      for (var i = cSecOps.length - 1; i >= 0; i--) if (cSecOps[i].tmpId === tmpId) cSecOps.splice(i, 1);
    },
    isFresh: function (id) { return !!cFresh[id]; },
    allParas: allParas,
    allCells: allCells,
    allTableObjs: allTableObjs,
    hostOf: hostOf,
    listOf: listOf,
    droppedChars: function () { return cDropped; },
    byId: function (id) { return cById[id]; },
    orderOf: function (id) { return cOrder[id] === undefined ? -1 : cOrder[id]; },
    text: text,
    shapeAt: shapeAt,
    charShape: function (id) {
      return (hwDoc && hwDoc.charShapes[id]) || hwDoc.charShapes[0];
    },
    paraShape: function (id) {
      return (hwDoc && hwDoc.paraShapes[id]) || hwDoc.paraShapes[0];
    },

    /* 테두리/배경 표. ★ 번호는 1부터고 0 은 "가리키는 것 없음" 이다 — 0 을 목록의 0번으로 읽으면 안 된다. */
    borderFill: function (id) {
      if (!id || !hwDoc || !hwDoc.borderFills) return null;
      return hwDoc.borderFills[id] || null;
    },
    faceName: function (id) {
      return (hwDoc && hwDoc.faceNames[id]) || null;
    },
    isDirty: function (id) { return !!cDirty[id]; },
    dirtyCount: function () { return Object.keys(cDirty).length + cDeleted.length; },

    /* 아직 안 보낸 표 구조 요청 수. 창을 닫을 때 물어야 할지 판정하는 데 쓴다 —
       문단 dirty 만 세면 행을 넣고 그냥 닫아도 아무것도 안 묻는다. */
    tableOpCount: function () { return cTableOps.length + cSecOps.length; },

    /* 실행취소가 되돌려야 하는 것은 문단 내용만이 아니다 — 무엇이 dirty 이고 무엇을 지웠는지도
       같이 돌려놔야 저장 요청이 되살아난 문단을 다시 지우려 들지 않는다. */
    state: function () {
      var d = {};
      for (var k in cDirty) if (cDirty.hasOwnProperty(k)) d[k] = true;
      /* ★ 표 구조 op 도 같이 담는다 — 이것이 없으면 Ctrl+Z 가 화면의 행만 되돌리고
         저장 요청에는 addRow 가 그대로 남아, 저장하면 지운 행이 되살아난다. */
      return { dirty: d, deleted: cDeleted.slice(), tops: cTableOps.slice() };
    },
    restoreState: function (s) {
      if (!s) return;
      cDirty = {};
      for (var k in s.dirty) if (s.dirty.hasOwnProperty(k)) cDirty[k] = true;
      cDeleted = s.deleted.slice();
      if (s.tops) cTableOps = s.tops.slice();
    },
    markDirty: markDirty,
    reindex: function () { index(hwDoc); },

    items: items,
    setItems: setItems,
    insertText: insertText,
    insertObj: insertObj,
    deleteRange: deleteRange,
    keeps: keeps,
    splitPara: splitPara,
    mergeNext: mergeNext,
    removePara: removePara,
    after: after,
    before: before,
    newId: function () { return 'n' + (++cSeq); },
    newTmpId: function () { return 'img' + (++cSeq); },

    buildOps: buildOps,
    accept: accept
  };
})();

function hwBuildOps() { return hwModel.buildOps(); }

/* ★ 반드시 @font-face 로드를 기다린 뒤에 배치한다. 폰트가 아직 안 붙은 상태로 재면 브라우저가
     대체 글꼴 폭을 돌려주고, 그 값이 캐시에 굳어 오라클이 통째로 어긋난다. */
function hwLoadDoc(doc) {
  hwModel.load(doc);
  if (window.hwFind) hwFind.clearHits();
  if (window.hwInput) hwInput.dropClip();
  hwSetStatus({ text: '배치 중…' });

  hwMeasure.ready().then(function () {
    var t0 = (window.performance && performance.now) ? performance.now() : 0;
    if (window.hwUi) { hwUi.loadFonts(); hwUi.loadStyles(); hwUi.setTitle(hwDoc && hwDoc.path); }
    hwLayout();
    hwRender();
    if (window.hwCaret) hwCaret.reset();
    if (window.hwUndo) hwUndo.clear();

    /* ★ 개체 고르기도 푼다. 문단 id 는 문서마다 새로 나는 값이 아니라 s0p3 같은 결정적 이름이라,
       그림을 고른 채 다른 문서를 열면 <b>엉뚱한 개체가 골라진 채로 되살아난다</b> — 그러면
       hwCaret.paint 가 캐럿을 안 그려서 새 문서에 캐럿이 아예 안 보이고, 방향키가 그 개체를
       옮겨 아무것도 안 고쳤는데 "저장할까요" 가 뜬다. */
    if (window.hwObj) hwObj.clear();
    var ms = t0 ? Math.round((window.performance ? performance.now() : 0) - t0) : 0;

    hwSetStatus({
      text: (doc.path || '새 문서') + ' — ' + hwPageCount() + '쪽 (' + ms + 'ms)'
    });
    /* 새 문서를 받았으니 고친 것은 0 이다. ★ 지난 문서의 값이 남아 있으면 방금 연 문서를
       그냥 닫을 때도 "저장할까요" 가 뜬다. */
    if (window.hwDirtySent !== undefined) window.hwDirtySent = -1;
    if (window.hwPostDirty) hwPostDirty();

    hwPost({ t: 'docReady', pages: hwPageCount(), ms: ms });
  });
}
