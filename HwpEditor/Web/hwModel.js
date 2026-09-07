/* 문서 모델. C# 이 보낸 JSON 을 그대로 들고 있으면서, 화면이 자주 묻는 것만 색인해 둔다.
   ★ 모델을 두 벌로 만들지 않는다 — 편집도 이 객체를 고치고, 저장할 때 dirty 문단만 ops 로 뽑는다
     (계획 6절). */

var hwDoc = null;

var hwModel = (function () {
  'use strict';

  /* 문단 id → 문단. 삽입·삭제로 인덱스가 밀려도 안 깨지도록 id 로 잡는다(계획 B-1). */
  var cById = {};

  /* 문단 id → 문서 전체에서 몇 번째인가. 선택 범위의 앞뒤를 가릴 때 쓴다. */
  var cOrder = {};

  /* 편집이 일어난 문단 id 집합. 여기 든 문단은 seg(오라클)를 더 이상 믿지 않는다(계획 B-5). */
  var cDirty = {};

  /* 지운 <b>원본</b> 문단 id. 새로 만들었다가 지운 것은 저장할 때 보낼 것이 없으므로 안 담는다. */
  var cDeleted = [];

  /* 표 구조를 바꾼 요청(행·열 넣기·빼기). 저장할 때 맨 뒤에 붙여 보낸다(5단계). */
  var cTableOps = [];

  /* 새 문단·새 개체에 붙일 일련번호. id 는 n1, n2 … 이고 C# 이 그 이름 그대로 표에 등록한다. */
  var cSeq = 0;

  /* 아직 <b>문서에 안 들어간</b> 새 문단 id.
     ★ id 앞글자만 보고 "새 문단" 이라 판정하면 안 된다 — 한 번 저장한 뒤에도 id 는 n1 그대로라
       두 번째 저장에서 같은 문단을 또 넣게 된다(저장할 때마다 문단이 하나씩 늘어난다). */
  var cFresh = {};

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

  /* 표 안의 문단도 같은 색인에 넣는다 — id 규칙이 이미 유일하다.
     ★ 순서(cOrder)에도 넣는다(5단계). 안 넣으면 셀을 지나는 선택 범위의 앞뒤를 못 가린다.
     ★ <c>_cell</c> 을 달아 둔다 — 넣기·지우기가 구역이 아니라 그 칸의 문단 목록을 봐야 한다. */
  function indexCells(para, si, at) {
    if (!para.objs) return;
    for (var i = 0; i < para.objs.length; i++) {
      var o = para.objs[i];
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

  /* 이 문단이 든 목록. 본문이면 구역의 문단들, 표 셀 안이면 그 칸의 문단들이다. */
  function listOf(para) {
    return para._cell ? para._cell.paras : hwDoc.sections[para._sec].paras;
  }

  /* 문서 순서로 늘어놓은 <b>모든</b> 문단 — 표 칸 안의 것까지.
     ★ 구역의 paras 만 도는 코드를 쓰면 안 된다. 서식·복사·선택 칠하기·지우기가 전부 그 형태였고,
       그래서 표 칸 안에서는 굵게도 복사도 선택 강조도 <b>아무 일이 안 일어났다</b>(예외도 안 났다).
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

  function withCells(p, out) {
    out.push(p);
    eachTableOf(p, function (t) {
      for (var c = 0; c < t.cells.length; c++)
        for (var k = 0; k < t.cells[c].paras.length; k++) withCells(t.cells[c].paras[k], out);
    });
  }

  /* 문단이 달고 있는 표들. 표를 찾는 자리가 여럿이라 한 군데로 모은다. */
  function eachTableOf(p, fn) {
    var objs = p.objs || [];
    for (var i = 0; i < objs.length; i++) if (objs[i].table) fn(objs[i].table, objs[i]);
  }

  /* 문서 안의 모든 표 칸. 되돌리기가 칸의 문단 목록을 통째로 담을 때 쓴다. */
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
      /* 개체는 pos(편집 인덱스)에 끼워 넣는다.
         ★ pos 는 <b>개체까지 센 최종 좌표</b>다 — 그래서 <b>앞에서부터</b> 넣어야 한다.
           뒤에서부터 넣으면 앞 개체가 아직 안 들어간 상태의 좌표에 끼워져 개체가 글자 사이사이로
           흩어진다(실측 — 개체 두 개로 시작하는 문단이 "￼리￼포트" 가 됐고, 캐럿이 글자 앞에 섰다). */
      var objs = para.objs.slice().sort(function (a, b) { return a.pos - b.pos; });
      for (var k = 0; k < objs.length; k++) {
        var at = Math.min(objs[k].pos, s.length);
        s = s.slice(0, at) + '￼' + s.slice(at);
      }
    }
    para._text = s;
    return s;
  }

  /* 편집 인덱스 위치의 글자모양 id. run 경계를 훑어 찾는다. */
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
    cDirty[id] = true;
    var p = cById[id];
    if (p) { p.seg = null; p._text = undefined; p._lines = null; }
  }

  /* ── 편집 원시 연산 ───────────────────────────────────────
     ★ 문단 내용을 <b>항목 배열</b>로 펼쳤다가 되담는다. runs·objs 를 직접 자르면 개체 위치와
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

  /* 범위를 지운다. ★ 화면에 안 보이는 컨트롤(용지·단 정의)은 <b>안 지운다</b> —
     지우면 저장할 때 그 구역의 용지 정의가 통째로 사라진다. 지운 자리 앞으로 모아 둔다. */
  function deleteRange(para, from, to) {
    if (to <= from) return 0;
    var a = items(para);
    from = Math.max(0, from);
    to = Math.min(a.length, to);

    var cut = a.splice(from, to - from);
    var keep = [];
    for (var i = 0; i < cut.length; i++) if (cut[i].obj && cut[i].obj.hidden) keep.push(cut[i]);
    if (keep.length) a.splice.apply(a, [from, 0].concat(keep));

    setItems(para, a);
    return (to - from) - keep.length;
  }

  /* pos 에서 문단을 자르고 <b>뒤쪽을 담은 새 문단</b>을 만들어 바로 뒤에 넣는다. */
  function splitPara(para, pos) {
    var a = items(para);
    var tail = a.splice(Math.max(0, Math.min(pos, a.length)));
    setItems(para, a);

    var np = { id: 'n' + (++cSeq), ps: para.ps, runs: [], objs: [], len: 0, seg: null,
               _sec: para._sec, _cell: para._cell || null };

    /* ★ 표가 만들 칸에서 나눈 문단도 같은 칸의 것이다. 표시를 안 물려주면 저장 요청에 insertAfter 가
       실리고, 그 기준 문단(_tblNew)이 문서에 없어서 저장이 통째로 예외로 끝난다. */
    if (para._tblNew) np._tblNew = true;
    else cFresh[np.id] = true;
    setItems(np, tail);
    insertAfter(para, np);
    return np;
  }

  /* 다음 문단을 이 문단 끝에 붙이고 지운다. 붙일 것이 없으면 false. */
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

  /* 문서 순서로 앞·뒤 문단. 구역 경계를 넘어 이어진다. */
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

  /* ── 저장 요청 만들기(계획 6절) ─────────────────────────── */

  function buildOps() {
    var ops = [];

    /* 지운 문단 먼저 — C# 은 replace → delete → insertAfter 순으로 적용한다. */
    for (var d = 0; d < cDeleted.length; d++) ops.push({ op: 'delete', id: cDeleted[d] });

    cDropped = 0;
    for (var si = 0; si < hwDoc.sections.length; si++) {
      var paras = hwDoc.sections[si].paras;
      for (var pi = 0; pi < paras.length; pi++) opsForList(paras, pi, ops);
    }

    /* 새 그림은 실물 경로를 따로 실어 보낸다. */
    for (var si2 = 0; si2 < hwDoc.sections.length; si2++) {
      var list = hwDoc.sections[si2].paras;
      for (var k = 0; k < list.length; k++) imageOps(list[k], ops);
    }

    /* ★ 표 구조는 맨 뒤다. 표를 다시 세우면 셀 문단 객체가 전부 새것이 되므로,
       그 앞의 셀 문단 요청이 먼저 반영돼야 한다. */
    for (var tt = 0; tt < cTableOps.length; tt++) ops.push(cTableOps[tt]);

    return ops;
  }

  /* 한 문단(과 그 안 표의 셀 문단들)에 대한 요청. */
  function opsForList(paras, pi, ops) {
    var p = paras[pi];
    pushOp(paras, pi, ops);

    for (var o = 0; o < (p.objs || []).length; o++) {
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
    if (p._tblNew) { if (p.len > 0) cDropped += p.len; return; }

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

    /* ★ 기준 문단은 <b>같은 목록</b>(구역 또는 표 칸) 안에서만 잡는다. 다른 목록의 문단을 기준으로
       주면 새 문단이 엉뚱한 곳에 들어간다. 앞 문단이 없으면 보내지 않는다 — 지금 편집 경로로는
       생기지 않는다(문단 나누기는 늘 기존 문단 뒤에 붙인다). */
    if (isNew) {
      if (pi === 0) { hwSetStatus({ text: '첫 자리에는 아직 문단을 넣을 수 없습니다: ' + p.id }); return; }
      op.ref = paras[pi - 1].id;
    }
    ops.push(op);
  }

  /* 새 그림은 실물 경로를 따로 실어 보낸다. 표 안에 넣은 그림도 같이 훑는다. */
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

      var t = objs[j].table;
      if (!t) continue;
      for (var c = 0; c < t.cells.length; c++)
        for (var q = 0; q < t.cells[c].paras.length; q++) imageOps(t.cells[c].paras[q], ops);
    }
  }

  /* 개체는 자리와 정체만 보낸다 — 원본은 C# 이 들고 있다(계획 6절). */
  function objRefs(para) {
    var out = [];
    var objs = para.objs || [];
    for (var i = 0; i < objs.length; i++) {
      if (objs[i].tmpId) out.push({ pos: objs[i].pos, tmpId: objs[i].tmpId });
      else out.push({ pos: objs[i].pos, oid: objs[i].oid });
    }
    return out;
  }

  /* 저장이 끝나면 dirty 를 비운다. 새 문단·새 그림은 이제 원본이 되었으므로 표시를 지운다. */
  function accept(result) {
    cDirty = {};
    cDeleted = [];
    cFresh = {};
    cTableOps = [];

    /* ★ 대기 중인 서식도 버린다. 저장하면 모양 번호가 다시 매겨지는데(csMap), 대기 값은
       옛 번호라 그대로 두면 <b>문서에 없는 번호</b>로 글자를 넣게 된다. */
    if (window.hwFormat) hwFormat.clearPending();

    /* ★ 저장하면 되돌리기 이력을 비운다. 저장 지점을 넘어 되돌리면 화면은 옛 모습으로 가는데
       파일에는 저장한 내용이 남아, 그 뒤로 화면과 파일이 갈라진 채 아무 신호도 안 난다
       (되돌린 문단이 dirty 로 안 잡혀 다음 저장에 op 가 하나도 안 실린다). */
    if (window.hwUndo) hwUndo.clear();

    /* 모양 번호가 문서 쪽에서 바뀌었을 수 있다(같은 모양 재사용, G-10) — 화면 번호를 다시 매긴다. */
    if (result && result.csMap) remapShapes(result.csMap, result.psMap);
    if (result && result.charShapes) hwDoc.charShapes = result.charShapes;
    if (result && result.paraShapes) hwDoc.paraShapes = result.paraShapes;

    var all = allParas();
    for (var i = 0; i < all.length; i++) {
      var objs = all[i].objs || [];
      for (var j = 0; j < objs.length; j++) {
        if (!objs[j].tmpId) continue;
        var oid = result && result.newOids ? result.newOids[objs[j].tmpId] : null;
        if (!oid) continue;
        objs[j].oid = oid;
        delete objs[j].tmpId;
        delete objs[j].file;
      }
    }
  }

  /* 저장 뒤 문서가 준 번호로 갈아 끼운다. 안 하면 같은 서식을 다시 적용할 때마다 모양이 하나씩 는다. */
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
      cSeq = 0;
      index(doc);
      return doc;
    },
    pushTableOp: function (op) { cTableOps.push(op); },
    tableOpCount: function () { return cTableOps.length; },
    isFresh: function (id) { return !!cFresh[id]; },
    allParas: allParas,
    allCells: allCells,
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
    faceName: function (id) {
      return (hwDoc && hwDoc.faceNames[id]) || null;
    },
    isDirty: function (id) { return !!cDirty[id]; },
    dirtyCount: function () { return Object.keys(cDirty).length + cDeleted.length; },

    /* 실행취소가 되돌려야 하는 것은 문단 내용만이 아니다 — 무엇이 dirty 이고 무엇을 지웠는지도
       같이 돌려놔야 저장 요청이 되살아난 문단을 다시 지우려 들지 않는다. */
    state: function () {
      var d = {};
      for (var k in cDirty) if (cDirty.hasOwnProperty(k)) d[k] = true;
      return { dirty: d, deleted: cDeleted.slice() };
    },
    restoreState: function (s) {
      if (!s) return;
      cDirty = {};
      for (var k in s.dirty) if (s.dirty.hasOwnProperty(k)) cDirty[k] = true;
      cDeleted = s.deleted.slice();
    },
    markDirty: markDirty,
    reindex: function () { index(hwDoc); },

    items: items,
    setItems: setItems,
    insertText: insertText,
    insertObj: insertObj,
    deleteRange: deleteRange,
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

/* C# 이 부르는 진입점.
   ★ 반드시 @font-face 로드를 기다린 뒤에 배치한다. 폰트가 아직 안 붙은 상태로 재면 브라우저가
     대체 글꼴 폭을 돌려주고, 그 값이 캐시에 굳어 오라클이 통째로 어긋난다. */
function hwLoadDoc(doc) {
  hwModel.load(doc);
  hwSetStatus({ text: '배치 중…' });

  hwMeasure.ready().then(function () {
    var t0 = (window.performance && performance.now) ? performance.now() : 0;
    if (window.hwUi) hwUi.loadFonts();
    hwLayout();
    hwRender();
    if (window.hwCaret) hwCaret.reset();
    if (window.hwUndo) hwUndo.clear();
    var ms = t0 ? Math.round((window.performance ? performance.now() : 0) - t0) : 0;

    hwSetStatus({
      text: (doc.path || '새 문서') + ' — ' + hwPageCount() + '쪽 (' + ms + 'ms)'
    });
    hwPost({ t: 'docReady', pages: hwPageCount(), ms: ms });
  });
}
