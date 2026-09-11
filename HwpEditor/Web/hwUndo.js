/* 실행취소·다시실행. 문단 스냅샷 단위다(계획 7절).

   ★ 되돌릴 것은 글자만이 아니다 — 문단 차례(구역의 paras 배열), dirty 집합, 지운 문단 목록,
     캐럿 자리까지 한 벌이어야 한다. 글자만 되돌리면 취소한 문단이 저장 요청에는 그대로 남는다.
   ★ 연속으로 친 글자는 한 덩어리로 묶는다 — 안 묶으면 한 글자씩 되돌아가서 쓸모가 없다. */

var hwUndo = (function () {
  'use strict';

  var cStack = [];
  var cAt = 0;            /* 다음에 쌓일 자리. cAt 앞은 되돌릴 수 있고 뒤는 다시 할 수 있다. */
  var cPending = null;    /* begin 이 잡아 둔 '고치기 전' 상태 */
  var cMax = 200;

  function clonePara(p) {
    var runs = [], objs = [];
    for (var i = 0; i < p.runs.length; i++) runs.push({ cs: p.runs[i].cs, text: p.runs[i].text });
    for (var k = 0; k < (p.objs || []).length; k++) objs.push(copy(p.objs[k]));
    /* ★ 쪽 나눔(brk)도 담는다. 빠지면 Ctrl+Enter 를 되돌려도 나눔이 남고, 다시 하기로 새 문단을 살리면
       나눔 없이 돌아온다 — 저장 요청에도 그 상태가 그대로 실린다. */
    return { ref: p, ps: p.ps, brk: p.brk, len: p.len, seg: p.seg, runs: runs, objs: objs };
  }

  function copy(o) {
    var out = {};
    for (var k in o) if (o.hasOwnProperty(k)) out[k] = o[k];
    return out;
  }

  function restorePara(c) {
    var p = c.ref;
    p.ps = c.ps;
    if (c.brk) p.brk = c.brk; else delete p.brk;
    p.len = c.len;
    p.seg = c.seg;
    p.runs = [];
    p.objs = [];
    for (var i = 0; i < c.runs.length; i++) p.runs.push({ cs: c.runs[i].cs, text: c.runs[i].text });
    for (var k = 0; k < c.objs.length; k++) p.objs.push(copy(c.objs[k]));
    p._text = undefined;
    p._lines = null;
  }

  /* ★ 문단 차례는 <b>늘</b> 담는다. "이번 편집은 구조를 안 건드린다" 는 판단이 틀리기 쉽다 —
     글자 하나를 쳐도 그 앞에 여러 문단에 걸친 선택을 지우는 일이 먼저 일어나면 차례가 바뀌고,
     그때 차례를 안 담아 두면 되돌려도 지워진 문단이 안 돌아온다(실측으로 잡힌 자리다).
     구역별 배열을 얕게 복사하는 값이라 3,000문단 문서에서도 눈에 안 띈다.
     ★ <b>표 칸의 문단 목록도 같이 담는다</b>. 구역 것만 담으면 칸 안에서 누른 Enter 가 안 되돌려진다 —
       글자는 돌아오는데 나뉜 문단이 그대로 남아, 되돌린 뒤에도 칸이 두 줄이다. */
  function snapshot(ids) {
    var s = { paras: [], lists: [], state: hwModel.state(), caret: caretState(),
              obj: window.hwObj ? hwObj.state() : null };

    for (var i = 0; i < ids.length; i++) {
      var p = hwModel.byId(ids[i]);
      if (p) s.paras.push(clonePara(p));
    }

    for (var si = 0; si < hwDoc.sections.length; si++)
      s.lists.push({ on: hwDoc.sections[si], v: hwDoc.sections[si].paras.slice() });

    var cells = hwModel.allCells();
    for (var c = 0; c < cells.length; c++) s.lists.push({ on: cells[c], v: cells[c].paras.slice() });
    return s;
  }

  function caretState() {
    var a = hwCaret.at(), sel = hwCaret.selection();
    return {
      id: a.id, pos: a.pos,
      anchorId: sel ? sel.fromId : a.id,
      anchorPos: sel ? sel.fromPos : a.pos
    };
  }

  function apply(s) {
    if (s.lists) for (var i = 0; i < s.lists.length; i++) s.lists[i].on.paras = s.lists[i].v.slice();
    for (var j = 0; j < s.paras.length; j++) restorePara(s.paras[j]);

    /* ★ 색인은 문단을 되돌린 <b>뒤에</b> 한다. restorePara 가 objs 를 새 객체로 담으므로, 먼저 색인하면 칸의
       _cell._obj 가 옛 표 객체를 가리킨 채 남아 hostOf 가 부모를 못 찾는다 — 되돌리기를 한 번 거친 표에서
       "표 지우기" 가 조용히 아무 일도 안 했다(실측 blank.hwpx). */
    hwModel.reindex();
    hwModel.restoreState(s.state);

    /* ★ 개체 고르기도 그 시점으로 — 캐럿처럼 되돌린 상태의 한 부분이다(hwObj.state 참고).
       캐럿을 놓기 전에 둔다: hwCaret.set 의 paint 가 고른 개체 테두리를 같이 그린다. */
    if (window.hwObj) hwObj.restore(s.obj);

    hwRelayout();
    if (s.caret && hwModel.byId(s.caret.id)) {
      hwCaret.set(s.caret.anchorId, s.caret.anchorPos, false);
      hwCaret.set(s.caret.id, s.caret.pos, true);
    }
  }

  /* 고치기 직전에 부른다. ids 는 <b>고치기 전에 이미 있던</b> 문단들이다. */
  function begin(ids) {
    cPending = { before: snapshot(ids), ids: ids.slice() };
  }

  /* 고친 직후에 부른다. ids2 에는 새로 생긴 문단 id 까지 넣는다.
     coalesceKey 가 직전 항목과 같으면 그 항목에 이어 붙인다(연속 입력). */
  function commit(ids2, coalesceKey) {
    if (!cPending) return;

    var ids = cPending.ids.slice();
    for (var i = 0; i < (ids2 || []).length; i++) if (ids.indexOf(ids2[i]) < 0) ids.push(ids2[i]);

    var after = snapshot(ids);

    var last = cAt > 0 ? cStack[cAt - 1] : null;
    if (coalesceKey && last && last.key === coalesceKey && cAt === cStack.length) {
      last.after = after;
      cPending = null;
      return;
    }

    cStack.length = cAt;
    cStack.push({ before: cPending.before, after: after, key: coalesceKey || null });
    if (cStack.length > cMax) cStack.shift();
    cAt = cStack.length;
    cPending = null;
  }

  function undo() {
    if (cAt <= 0) return false;
    cAt--;
    apply(cStack[cAt].before);
    return true;
  }

  function redo() {
    if (cAt >= cStack.length) return false;
    apply(cStack[cAt].after);
    cAt++;
    return true;
  }

  return {
    clear: function () { cStack = []; cAt = 0; cPending = null; },
    begin: begin,
    commit: commit,
    undo: undo,
    redo: redo,
    canUndo: function () { return cAt > 0; },
    canRedo: function () { return cAt < cStack.length; }
  };
})();
