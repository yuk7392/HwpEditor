/* 글자·문단 서식(4단계).

   ★ 서식은 글자마다 붙는 것이 아니라 <b>모양 번호</b>로 붙는다. 그래서 굵게 한 번에
     "그 속성만 다른 모양"을 찾거나 만들어 글자들이 그것을 가리키게 한다.
   ★ <b>같은 모양을 두 번 만들지 않는다</b>(G-10). 굵게를 열 번 눌렀다 저장할 때마다 모양이
     열 개씩 늘면 그 문서는 열 때마다 무거워진다. 그래서 세 단계로 찾는다:
       ① 뿌리(갈라져 나온 원본)와 같아지면 뿌리로 되돌린다 — 굵게 껐다 켰다가 제자리로 온다.
       ② 같은 뿌리에서 갈라진 것 중 속성이 같은 것이 있으면 그것을 쓴다.
       ③ 없을 때만 새로 만든다.
   ★ <b>원본 모양은 절대 다시 쓰지 않는다</b>(뿌리로 돌아가는 ①만 예외). 우리가 모델에 안 담은
     성질(그림자·외곽선·밑줄색)이 우연히 같아 보이는 원본으로 글을 옮기면, 안 건드린 성질이 바뀐다. */

var hwFormat = (function () {
  'use strict';

  /* 선택 없이 서식만 누른 경우 — 다음에 칠 글자에 걸 서식. 캐럿이 움직이면 버린다.
     ★ 모양 <b>번호</b>가 아니라 "어느 모양에서 무엇을 바꿀 것인가" 로 들고 있는다. 번호로 들고 있으면
       Ctrl+B 를 눌러 놓고 글자를 안 치고 캐럿만 옮겨도 목록에 쓰지 않는 모양이 하나 남고,
       그것이 저장할 때 문서에 등록된다(G-10 이 막으려던 바로 그 증식이다). */
  var cPending = null;      /* { base: 글자모양번호, over: {바꿀 속성} } */
  var cPendingAt = null;

  var cCharKeys = ['face', 'sizeHu', 'bold', 'italic', 'underline', 'strike', 'color', 'ratio', 'spacing'];
  var cParaKeys = ['align', 'indentHu', 'mlHu', 'mrHu', 'mtHu', 'mbHu', 'lsType', 'ls', 'latinBreak', 'hangulByWord'];

  function pick(src, keys) {
    var out = {};
    for (var i = 0; i < keys.length; i++) out[keys[i]] = src[keys[i]];
    return out;
  }

  function same(a, b, keys) {
    for (var i = 0; i < keys.length; i++) if (a[keys[i]] !== b[keys[i]]) return false;
    return true;
  }

  function merged(src, over, keys) {
    var out = pick(src, keys);
    for (var k in over) if (over.hasOwnProperty(k)) out[k] = over[k];
    return out;
  }

  function rootOf(list, id) {
    var s = list[id];
    if (!s) return 0;
    return (s.base === undefined || s.base === null || s.base < 0) ? id : s.base;
  }

  /* 모양 목록에서 원하는 속성의 번호를 찾거나 만든다. */
  function shapeFor(list, id, over, keys) {
    var cur = list[id] || list[0];
    var root = rootOf(list, id);
    var want = merged(cur, over, keys);

    if (same(want, pick(list[root], keys), keys)) return root;

    for (var i = 0; i < list.length; i++)
      if (list[i].base === root && same(want, pick(list[i], keys), keys)) return i;

    var made = { id: list.length, base: root };
    for (var k = 0; k < keys.length; k++) made[keys[k]] = want[keys[k]];
    list.push(made);
    return made.id;
  }

  /* ── 글자 서식 ─────────────────────────────────────────── */

  /* 선택 범위의 문단과 그 안의 [from, to) 를 훑는다. 선택이 없으면 캐럿 문단만 빈 범위로 준다. */
  function eachRange(fn) {
    var sel = hwCaret.selection();
    if (!sel) {
      var p = hwCaret.para();
      if (p) fn(p, hwCaret.at().pos, hwCaret.at().pos);
      return;
    }

    var from = hwModel.orderOf(sel.fromId), to = hwModel.orderOf(sel.toId);
    var all = hwModel.allParas();
    for (var i = 0; i < all.length; i++) {
      var q = all[i];
      var ord = hwModel.orderOf(q.id);
      if (ord < from || ord > to) continue;
      fn(q, ord === from ? sel.fromPos : 0, ord === to ? sel.toPos : q.len);
    }
  }

  function applyChar(over) {
    if (!hwDoc) return;

    if (!hwCaret.selection()) {
      /* 선택이 없으면 지금 칠 글자에만 건다 — 문단 전체를 바꾸는 것이 아니다. */
      var p = hwCaret.para();
      if (!p) return;
      var at = hwCaret.at();
      /* ★ 대기 서식은 <b>그 자리의 것</b>일 때만 이어 쓴다. 자리를 안 보면 다른 문단에서 눌러 둔
         서식이 여기까지 따라온다. */
      var on = pending(p, at.pos);
      var base0 = on ? cPending.base : hwModel.shapeAt(p, at.pos > 0 ? at.pos - 1 : 0);
      var over0 = {};
      if (on) for (var pk in cPending.over) if (cPending.over.hasOwnProperty(pk)) over0[pk] = cPending.over[pk];
      for (var ok in over) if (over.hasOwnProperty(ok)) over0[ok] = over[ok];
      cPending = { base: base0, over: over0 };
      cPendingAt = at.id + ':' + at.pos;
      hwUi.refresh();
      return;
    }

    hwInput.run(function () {
      eachRange(function (p, from, to) {
        if (to <= from) return;
        var a = hwModel.items(p);
        for (var k = from; k < to && k < a.length; k++)
          if (a[k].ch !== undefined) a[k].cs = shapeFor(hwDoc.charShapes, a[k].cs, over, cCharKeys);
        hwModel.setItems(p, a);
      });
      return null;
    });
  }

  /* "지금 값에서 한 단계" 인 글자 서식(크기·장평·자간). fn(모양) 이 바꿀 속성을 주거나 null(그대로).
     ★ 모양마다 따로 간다 — 선택 안에 10pt·14pt 가 섞여 있으면 각자 11pt·15pt 가 된다(한글). 선택 전체에
       값 하나를 걸면 섞인 크기가 한 값으로 뭉개진다.
     ★ 선택이 없으면 캐럿 자리 모양에서 한 단계를 대기 서식으로 건다(applyChar 와 같은 길). */
  function mapChar(fn) {
    if (!hwDoc) return;

    if (!hwCaret.selection()) {
      var cur = currentShape(hwCaret.para(), hwCaret.at().pos);
      var over0 = cur ? fn(cur) : null;
      if (over0) applyChar(over0);
      return;
    }

    hwInput.run(function () {
      var memo = {};
      eachRange(function (p, from, to) {
        if (to <= from) return;
        var a = hwModel.items(p), changed = false;
        for (var k = from; k < to && k < a.length; k++) {
          if (a[k].ch === undefined) continue;
          var id = a[k].cs;
          if (!memo.hasOwnProperty(id)) {
            var over = fn(hwDoc.charShapes[id] || hwDoc.charShapes[0]);
            memo[id] = over ? shapeFor(hwDoc.charShapes, id, over, cCharKeys) : id;
          }
          if (memo[id] !== id) { a[k].cs = memo[id]; changed = true; }
        }
        if (changed) hwModel.setItems(p, a);
      });
      return null;
    });
  }

  /* 크기 목록(pt). 키우기·줄이기는 이 목록의 다음·앞 값으로 간다 — 목록 밖 값(9.5pt)에서도 가장 가까운 다음 값. */
  var cSizeSteps = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 32, 48, 72];

  function stepSize(dir) {
    mapChar(function (cs) {
      var pt = (cs.sizeHu || 1000) / 100, to = null;
      for (var i = 0; i < cSizeSteps.length; i++) {
        if (dir > 0 && cSizeSteps[i] > pt) { to = cSizeSteps[i]; break; }
        if (dir < 0 && cSizeSteps[i] < pt) to = cSizeSteps[i];
      }
      return to === null ? null : { sizeHu: to * 100 };
    });
  }

  /* 장평 ±1%(50~200). ★ 지금 장평이 50% 이하면 늘리기·줄이기 모두 안 한다. */
  function stepRatio(dir) {
    mapChar(function (cs) {
      var r = cs.ratio || 100;
      if (r <= 50) return null;
      var to = Math.max(50, Math.min(200, r + dir));
      return to === r ? null : { ratio: to };
    });
  }

  /* 자간 ±1%(−50~50). */
  function stepSpacing(dir) {
    mapChar(function (cs) {
      var s = cs.spacing || 0;
      var to = Math.max(-50, Math.min(50, s + dir));
      return to === s ? null : { spacing: to };
    });
  }

  /* 켜기/끄기 — 범위가 <b>전부</b> 켜져 있으면 끄고, 하나라도 꺼져 있으면 켠다(한글과 같다). */
  function toggleChar(key) {
    var allOn = true, any = false;

    eachRange(function (p, from, to) {
      for (var k = from; k < to; k++) {
        var cs = hwDoc.charShapes[hwModel.shapeAt(p, k)];
        if (!cs) continue;
        any = true;
        var on = key === 'underline' ? (cs.underline || 0) !== 0 : !!cs[key];
        if (!on) allOn = false;
      }
    });

    if (!any) {
      /* 선택이 없다 — 캐럿 자리의 현재 서식을 뒤집는다. */
      var cur = currentShape(hwCaret.para(), hwCaret.at().pos);
      allOn = cur ? (key === 'underline' ? (cur.underline || 0) !== 0 : !!cur[key]) : false;
    }

    var over = {};
    over[key] = key === 'underline' ? (allOn ? 0 : 1) : !allOn;
    applyChar(over);
  }

  /* 캐럿 자리에 걸린 글자모양의 <b>속성</b>. 대기 중인 서식은 아직 목록에 없으므로 그때만 임시로 만든다. */
  function currentShape(para, pos) {
    if (!para) return null;
    var at = hwDoc.charShapes[hwModel.shapeAt(para, pos > 0 ? pos - 1 : 0)] || hwDoc.charShapes[0];
    if (!pending(para, pos)) return at;

    var src = hwDoc.charShapes[cPending.base] || at;
    return merged(src, cPending.over, cCharKeys);
  }

  function pending(para, pos) {
    return cPending !== null && para && cPendingAt === para.id + ':' + pos;
  }

  /* 방금 쓴 글자모양이 대기 서식이었나. 친 뒤에 그 서식을 이어 가려고 기억해 둔다. */
  var cUsedPending = -1;

  /* 입력이 쓸 글자모양. 대기 중인 서식을 여기서 꺼내 쓴다. */
  function shapeForTyping(para, pos) {
    if (pending(para, pos)) {
      /* 여기서 처음으로 <b>진짜</b> 모양을 만든다 — 글자가 실제로 그것을 가리키게 되는 순간이다. */
      cUsedPending = shapeFor(hwDoc.charShapes, cPending.base, cPending.over, cCharKeys);
      return cUsedPending;
    }
    cUsedPending = -1;
    clearPending();
    return hwModel.shapeAt(para, pos > 0 ? pos - 1 : 0);
  }

  /* 친 자리 뒤로 대기 서식을 옮긴다 — 한 번 치고 나서도 계속 그 서식으로 이어지게.
     ★ 캐럿을 옮기면 hwCaret 이 대기 서식을 버리므로, 옮긴 <b>뒤에</b> 다시 걸어야 한다. */
  function advancePending(para, pos) {
    if (cUsedPending < 0) return;
    cPending = { base: cUsedPending, over: {} };
    cPendingAt = para.id + ':' + pos;
    cUsedPending = -1;
  }

  function clearPending() {
    cPending = null;
    cPendingAt = null;
  }

  /* ── 문단 서식 ─────────────────────────────────────────── */

  function applyPara(over) {
    if (!hwDoc) return;

    hwInput.run(function () {
      eachRange(function (p) {
        p.ps = shapeFor(hwDoc.paraShapes, p.ps, over, cParaKeys);
        hwModel.markDirty(p.id);
      });
      return null;
    });
  }

  /* 정렬. ★ 배분을 이미 배분인 문단에 또 누르면 양쪽으로 돌아간다(한글) — 단추·단축키가 같은 길을 탄다. */
  function setAlign(a) {
    var p = hwCaret.para();
    if (!p) return;
    if (a === 'distribute' && hwModel.paraShape(p.ps).align === 'distribute') a = 'justify';
    applyPara({ align: a });
  }

  /* 들여쓰기 한 칸(HWPUNIT). 10pt 글자 하나 폭이다. */
  var cIndentStep = 1000;

  function indent(dir) {
    var p = hwCaret.para();
    if (!p) return;
    var ps = hwModel.paraShape(p.ps);
    applyPara({ mlHu: Math.max(0, (ps.mlHu || 0) + dir * cIndentStep) });
  }

  /* "지금 값에서 한 단계" 인 문단 서식. 선택 안 문단마다 제 값에서 간다. fn(모양, 문단) → 바꿀 속성 또는 null. */
  function mapPara(fn) {
    if (!hwDoc) return;
    hwInput.run(function () {
      eachRange(function (p) {
        var over = fn(hwModel.paraShape(p.ps), p);
        if (!over) return;
        p.ps = shapeFor(hwDoc.paraShapes, p.ps, over, cParaKeys);
        hwModel.markDirty(p.id);
      });
      return null;
    });
  }

  /* 1pt(HWPUNIT). 여백·첫 줄·고정 줄 간격이 이 단위로 움직인다. */
  var cPt = 100;
  /* 여백 합 상한(580.3pt)과 여백을 늘린 뒤에도 남겨야 할 본문 폭(5mm). */
  var cMaxMargins = 58030, cMinBody = 1417;

  /* 문단이 흐르는 폭 — 본문이면 단 폭, 칸이면 칸 안 폭. 배치가 줄마다 적어 둔 값을 쓴다. */
  function flowWidth(p) {
    var ls = window.hwLineIndex ? hwLineIndex[p.id] : null;
    if (ls && ls.length && ls[0].colWHu) return ls[0].colWHu;
    var pg = hwDoc.sections[p._sec || 0].page;
    return pg.wHu - pg.mlHu - pg.mrHu - (pg.gutHu || 0);
  }

  /* 줄 간격 넓게·좁게. 비율이면 ±10%(50~500), 고정·최소·여백이면 ±1pt. 방식(lsType)은 안 바꾼다. */
  function stepLineSpace(dir) {
    mapPara(function (ps) {
      var v = ps.ls || 0, to;
      if (!ps.lsType || ps.lsType === 'percent') to = Math.max(50, Math.min(500, (v || 100) + dir * 10));
      else to = Math.max(0, v + dir * cPt);
      return to === v ? null : { ls: to };
    });
  }

  /* 첫 줄 들여쓰기(+)·내어쓰기(−) 1pt 씩. ★ 첫 줄(내어쓰기면 둘째 줄부터)이 차지할 폭이 남아야 한다 —
     왼쪽 여백 + |첫 줄 값| 이 (흐름 폭 − 오른쪽 여백 − 5mm) 를 넘으면 더 안 간다. */
  function stepIndent(dir) {
    mapPara(function (ps, p) {
      var v = ps.indentHu || 0, to = v + dir * cPt;
      var grows = Math.abs(to) > Math.abs(v);
      if (grows && (ps.mlHu || 0) + Math.abs(to) > flowWidth(p) - (ps.mrHu || 0) - cMinBody) return null;
      return { indentHu: to };
    });
  }

  /* 왼쪽(mlHu)·오른쪽(mrHu) 여백 1pt 씩. ★ 늘릴 때는 두 여백 합 ≤ 580.3pt, 남는 본문 폭 ≥ 5mm 일 때만. */
  function stepMargin(key, dir) {
    mapPara(function (ps, p) {
      var v = ps[key] || 0, to = Math.max(0, v + dir * cPt);
      if (to === v) return null;
      if (to > v) {
        var sum = (ps.mlHu || 0) + (ps.mrHu || 0) + (to - v);
        if (sum > cMaxMargins || flowWidth(p) - sum < cMinBody) return null;
      }
      var over = {};
      over[key] = to;
      return over;
    });
  }

  /* ── 화면이 보여 줄 현재 상태 ───────────────────────────── */

  function state() {
    var p = hwCaret.para();
    if (!p) return null;

    var cs = currentShape(p, hwCaret.at().pos) || hwDoc.charShapes[0];
    var ps = hwModel.paraShape(p.ps);
    return { cs: cs, ps: ps };
  }

  return {
    applyChar: applyChar,
    toggleChar: toggleChar,
    applyPara: applyPara,
    setAlign: setAlign,
    indent: indent,
    stepSize: stepSize,
    stepRatio: stepRatio,
    stepSpacing: stepSpacing,
    stepLineSpace: stepLineSpace,
    stepIndent: stepIndent,
    stepMargin: stepMargin,
    shapeForTyping: shapeForTyping,
    advancePending: advancePending,
    clearPending: clearPending,
    state: state
  };
})();
