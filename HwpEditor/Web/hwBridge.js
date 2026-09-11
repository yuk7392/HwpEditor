/* C# ↔ 문서 통로. C# 이 부르는 것은 전부 hw* 전역 함수다.
   ★ 준비 전에 보낸 메시지는 큐에 담았다가 통로가 열리면 순서대로 낸다 —
     문서가 먼저 뜨고 WebView2 가 붙는 순서가 뒤집힐 수 있다. */

var hwBridge = (function () {
  'use strict';

  var cQueue = [];

  function ready() {
    return !!(window.chrome && window.chrome.webview && window.chrome.webview.postMessage);
  }

  function flush() {
    if (!ready()) return;
    while (cQueue.length) {
      window.chrome.webview.postMessage(cQueue.shift());
    }
  }

  return {
    post: function (o) {
      var s = JSON.stringify(o);
      if (ready()) {
        window.chrome.webview.postMessage(s);
      } else {
        cQueue.push(s);
      }
    },
    flush: flush
  };
})();

function hwPost(o) { hwBridge.post(o); }

/* ── C# → 문서 ───────────────────────────────────────────── */

function hwSetStatus(o) {
  var el = document.getElementById('hwStatus');
  if (el) el.textContent = (o && o.text) || '';
}

function hwPong(o) {
  hwSetStatus({ text: 'pong n=' + o.n + ' (' + o.ms + 'ms)' });
}

/* 자체점검(--selftest). 화면을 안 띄우고 문서가 제대로 섰는지 C# 이 확인하는 통로다.
   ★ 사람이 눌러서 확인하지 않는다 — 검증이 사용자 데스크톱의 클릭·포커스를 뺏으면 안 된다. */
function hwSelfTest() {
  var pages = document.querySelectorAll('.hw-page');
  var r = pages.length ? pages[0].getBoundingClientRect() : null;
  var st = document.getElementById('hwStatus');
  hwPost({
    t: 'selftest',
    pages: pages.length,
    w: r ? Math.round(r.width * 100) / 100 : 0,
    h: r ? Math.round(r.height * 100) / 100 : 0,
    bg: r ? getComputedStyle(pages[0]).backgroundColor : '',
    status: st ? st.textContent : ''
  });
}

/* 조작 점검(--ui-test). 눌러 봐야만 나오는 결함(연타·IME·붙여넣기·선택 삭제)을 사람 손 없이 태운다.

   ★ 전역 입력 주입(SendKeys)을 쓰지 않는다 — 그건 그 순간 포커스를 가진 창, 즉 사용자가
     타이핑 중인 창으로 들어간다. 여기서는 문서 안의 수신기에 이벤트를 직접 보낸다.
   ★ 편집 함수를 직접 부르지 않고 <b>이벤트로 넣는다</b> — 키 처리·IME 분기까지 지나야
     실제로 눌렀을 때와 같은 길을 검사한 것이 된다. */
function hwUiTest() {
  var steps = [];
  var ime = document.getElementById('hwIme');

  function ok(name, cond, got) { steps.push({ name: name, ok: !!cond, got: String(got) }); }

  /* ★ code 는 싣지 않는다 — 키 이름을 code 로 먼저 읽는 쪽(hwInput.keyName)이 e.key 로 물러서는
     길까지 같이 지난다. 한글 모드에서 오는 key='Process' 는 opt.code 로 따로 태운다. */
  function key(k, opt) {
    var e = new KeyboardEvent('keydown', {
      key: k, code: (opt && opt.code) || '', bubbles: true, cancelable: true,
      shiftKey: !!(opt && opt.shift), ctrlKey: !!(opt && opt.ctrl), altKey: !!(opt && opt.alt)
    });
    ime.dispatchEvent(e);
    return e;
  }

  function typeIn(t) {
    ime.textContent = t;
    ime.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }

  /* 마우스 — 개체 다루기(8단계) 검사용. ★ 누르기는 <b>그 요소</b>에 보낸다(target 으로 되짚으므로),
     움직임·놓기는 문서에 보낸다(끌기 수신기가 거기 걸려 있다). */
  function down(el, x, y) {
    el.dispatchEvent(new MouseEvent('mousedown',
      { bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x, clientY: y }));
  }
  function move(x, y) {
    document.dispatchEvent(new MouseEvent('mousemove',
      { bubbles: true, cancelable: true, buttons: 1, clientX: x, clientY: y }));
  }
  function up() {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
  }

  /* 그 문단의 그 자리에 개체가 있는가. 되돌리기가 개체를 제자리에 돌려놨는지 볼 때 쓴다. */
  function objAtPos(id, pos) {
    var p = hwModel.byId(id);
    var objs = (p && p.objs) || [];
    for (var i = 0; i < objs.length; i++) if (objs[i].pos === pos) return true;
    return false;
  }

  /* 고른 개체가 그 문단의 objs 에서 몇 번째인가. 되돌린 뒤에는 개체 객체가 새것이라 번호로 찾는다. */
  function objIdx(sel) {
    var objs = hwModel.byId(sel.para.id).objs || [];
    for (var i = 0; i < objs.length; i++) if (objs[i].pos === sel.obj.pos) return i;
    return 0;
  }

  var p0 = hwDoc.sections[0].paras[0];
  var target = hwDoc.sections[0].paras.length > 1 ? hwDoc.sections[0].paras[1] : p0;

  ok('1 처음 캐럿은 첫 문단 머리', hwCaret.at().id === p0.id && hwCaret.at().pos === 0,
     hwCaret.at().id + ':' + hwCaret.at().pos);

  /* ★ 문단 <b>끝</b>에 캐럿을 둔다. 앞쪽에는 화면에 안 보이는 컨트롤(용지·단 정의)이 있을 수 있고,
     그건 지워지지 않게 막아 둔 자리라 글자 수 대조가 그것 때문에 어긋난다. */
  hwCaret.set(target.id, target.len, false);
  ok('2 캐럿 옮기기', hwCaret.at().id === target.id && hwCaret.at().pos === target.len,
     hwCaret.at().id + ':' + hwCaret.at().pos);

  var len0 = target.len;
  typeIn('가나다');
  ok('3 글자 입력', target.len === len0 + 3, 'len ' + len0 + '→' + target.len);

  key('Backspace');
  ok('4 Backspace', target.len === len0 + 2, 'len ' + target.len);

  key('ArrowLeft', { shift: true });
  key('ArrowLeft', { shift: true });
  var sel = hwCaret.selection();
  ok('5 Shift+← 선택', !!sel && sel.toPos - sel.fromPos === 2, sel ? (sel.fromPos + '~' + sel.toPos) : '없음');

  key('Delete');
  ok('6 선택 삭제', target.len === len0, 'len ' + target.len);

  var paras0 = hwDoc.sections[0].paras.length;
  key('Enter');
  ok('7 Enter 로 문단 나눔', hwDoc.sections[0].paras.length === paras0 + 1,
     '문단 ' + paras0 + '→' + hwDoc.sections[0].paras.length);

  key('z', { ctrl: true });
  ok('8 Ctrl+Z 로 문단 되돌림', hwDoc.sections[0].paras.length === paras0,
     '문단 ' + hwDoc.sections[0].paras.length);

  /* 다시 실행은 Ctrl+Shift+Z 다 — Ctrl+Y 는 한글처럼 "한 줄 지우기" 로 옮겼다(FEATURE-PLAN 결정 ①). */
  key('z', { ctrl: true, shift: true });
  ok('9 Ctrl+Shift+Z 로 다시', hwDoc.sections[0].paras.length === paras0 + 1,
     '문단 ' + hwDoc.sections[0].paras.length);

  key('z', { ctrl: true });

  /* IME — 조합 중에는 모델이 그대로여야 하고, 화면에는 임시 글자가 떠 있어야 한다(G-4). */
  var cur = hwModel.byId(hwCaret.at().id);
  var lenIme = cur.len;
  ime.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
  ime.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ㅎ', bubbles: true }));
  ok('10 조합 중 모델 그대로', cur.len === lenIme, 'len ' + cur.len);
  ok('11 조합 중 임시 글자 표시', !!document.querySelector('.hw-composing'),
     document.querySelector('.hw-composing') ? '있음' : '없음');

  var before = cur.len;
  key('ArrowRight');
  ok('12 조합 중 방향키는 무시', cur.len === before && !!document.querySelector('.hw-composing'), 'len ' + cur.len);

  ime.textContent = '한';
  ime.dispatchEvent(new CompositionEvent('compositionend', { data: '한', bubbles: true }));
  ime.dispatchEvent(new InputEvent('input', { bubbles: true }));
  ok('13 조합 끝나면 한 글자 들어감', cur.len === lenIme + 1, 'len ' + lenIme + '→' + cur.len);
  ok('14 조합 끝나면 임시 글자 사라짐', !document.querySelector('.hw-composing'),
     document.querySelector('.hw-composing') ? '남음' : '없음');

  /* 붙여넣기 — 두 줄이면 문단이 하나 늘어야 한다. */
  var pasteOk = false, pasteGot = '이벤트 못 만듦';
  try {
    var dt = new DataTransfer();
    dt.setData('text/plain', '붙여1\n붙여2');
    var pn = hwDoc.sections[0].paras.length;
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    pasteOk = hwDoc.sections[0].paras.length === pn + 1;
    pasteGot = '문단 ' + pn + '→' + hwDoc.sections[0].paras.length;
  } catch (e) { pasteGot = String(e); }
  ok('15 두 줄 붙여넣기', pasteOk, pasteGot);

  /* 그림 넣기(3단계) — 실물은 저장할 때 들어가고 지금은 자리와 미리보기만이다. */
  var cur2 = hwModel.byId(hwCaret.at().id);
  var objs0 = (cur2.objs || []).length;
  hwInsertImage({ file: hwUiTestImage || '', src: hwUiTestSrc || null, wHu: 4800, hHu: 3600 });
  ok('16 그림 자리 생김', (cur2.objs || []).length === objs0 + 1,
     '개체 ' + objs0 + '→' + (cur2.objs || []).length);

  var ops = hwBuildOps();
  var kinds = {};
  for (var i = 0; i < ops.length; i++) kinds[ops[i].op] = (kinds[ops[i].op] || 0) + 1;
  ok('17 저장 요청이 만들어짐', ops.length > 0, JSON.stringify(kinds));

  var withSeg = 0;
  for (var k = 0; k < ops.length; k++) if (ops[k].seg && ops[k].seg.length) withSeg++;
  ok('18 고친 문단마다 줄 정보', withSeg > 0, withSeg + '개 op 에 seg');

  /* 캐럿이 <b>실제로 그려진 글자</b> 자리에 서는지. 우리가 잰 폭과 브라우저가 그린 폭이 다르면
     줄 뒤로 갈수록 캐럿이 글자 앞으로 밀린다 — 눌러 봐야만 나오는 결함이라 여기서 잰다. */
  ok('19 캐럿 x = 그려진 글자 x', true, hwCaretDrift());

  /* 글자 하나 치고 화면에 나오기까지(G-5 지표 30ms). 배치·그리기까지 다 들어간 시간이다. */
  var t0 = performance.now();
  typeIn('빠');
  var ms = Math.round((performance.now() - t0) * 10) / 10;
  ok('21 입력→반영 30ms 이내', ms <= 30, ms + 'ms');

  /* ── 서식(4단계) — 같은 모양을 두 번 만들지 않는지가 핵심이다(G-10) ── */

  var fmtPara = hwModel.byId(hwCaret.at().id);
  hwCaret.set(fmtPara.id, 0, false);
  hwCaret.set(fmtPara.id, fmtPara.len, true);

  var shapes0 = hwDoc.charShapes.length;
  var cs0 = hwModel.shapeAt(fmtPara, 0);

  /* ★ 켜기/끄기가 아니라 <b>값을 못 박아</b> 건다. 고른 글이 이미 굵을 수도 있어서
     Ctrl+B 한 번으로는 결과가 문서마다 달라진다(실측 — 굵은 문단을 골라 놓고 굵기를 껐다). */
  var want0 = !hwDoc.charShapes[cs0].bold;
  hwFormat.applyChar({ bold: want0 });
  var csBold = hwModel.shapeAt(fmtPara, 0);
  ok('22 굵기 바꾸기', csBold !== cs0 && hwDoc.charShapes[csBold].bold === want0,
     'cs ' + cs0 + '→' + csBold + ' bold ' + hwDoc.charShapes[cs0].bold + '→'
     + hwDoc.charShapes[csBold].bold + ' 모양 ' + shapes0 + '→' + hwDoc.charShapes.length);

  var shapes1 = hwDoc.charShapes.length;
  for (var b4 = 0; b4 < 4; b4++) hwFormat.applyChar({ bold: want0 });
  ok('23 같은 서식 4번 더 걸어도 모양이 안 늘어남(G-10)', hwDoc.charShapes.length === shapes1,
     '모양 ' + shapes1 + '→' + hwDoc.charShapes.length);

  hwFormat.applyChar({ bold: !want0 });
  ok('24 되돌리면 원래 모양으로', hwModel.shapeAt(fmtPara, 0) === cs0,
     'cs ' + hwModel.shapeAt(fmtPara, 0) + ' (원래 ' + cs0 + ')');

  key('b', { ctrl: true });
  ok('24-1 Ctrl+B 가 서식까지 닿는다', hwModel.shapeAt(fmtPara, 0) !== cs0,
     'cs ' + hwModel.shapeAt(fmtPara, 0));
  key('b', { ctrl: true });

  var ps0 = fmtPara.ps;
  hwFormat.applyPara({ align: 'center' });
  ok('25 가운데 정렬', hwDoc.paraShapes[fmtPara.ps].align === 'center',
     'ps ' + ps0 + '→' + fmtPara.ps + ' ' + hwDoc.paraShapes[fmtPara.ps].align);

  /* ── 되쓰기에서 실제로 깨졌던 자리들 ── */

  hwCaret.set(fmtPara.id, fmtPara.len, false);
  var lenTab = fmtPara.len;
  key('Tab');
  ok('26 탭 입력', fmtPara.len === lenTab + 1 && hwModel.text(fmtPara).indexOf('\t') >= 0,
     'len ' + lenTab + '→' + fmtPara.len);

  var ops2 = hwBuildOps();
  var ins = 0;
  for (var q = 0; q < ops2.length; q++) if (ops2[q].op === 'insertAfter') ins++;

  hwModel.accept({ ok: true });
  var after = hwBuildOps();
  var stillPara = 0;
  for (var w = 0; w < after.length; w++)
    if (after[w].op === 'insertAfter' || after[w].op === 'replace' || after[w].op === 'delete') stillPara++;

  /* ★ 새 그림은 아직 남아 있는 것이 맞다 — 저장 응답이 oid 를 안 줬으니 문서에 안 들어간 것이다.
     여기서 보는 것은 <b>문단</b> 요청이 저장 뒤에도 또 나가지 않는가다(같은 문단을 두 번 넣던 자리). */
  ok('27 저장한 뒤에는 문단 요청이 안 남는다', stillPara === 0,
     '저장 전 op ' + ops2.length + '개(넣기 ' + ins + ') → 저장 뒤 문단 요청 ' + stillPara + '개');

  /* ── 표(5단계) ── */

  var cellPara = firstCellPara();
  if (!cellPara) {
    ok('28 표 없는 문서', true, '표가 없어 건너뜀');
  } else {
    /* ★ 표 옆에서 지우기(TODO 3절) — 표는 한 글자 자리를 차지해서, 막지 않으면 Backspace 한 번에
       칸 내용까지 통째로 사라진다. 한글처럼 표는 남고 캐럿이 칸으로 들어가야 한다.
       캐럿만 옮기거나 아무것도 안 지우는 동작이라 뒤 단계가 보는 모델은 그대로다. */
    var tob = cellPara._cell._obj, tHost = hwModel.hostOf(tob);
    var tableKept = function () { return !!tHost && (tHost.objs || []).indexOf(tob) >= 0; };
    var inTob = function () { var q = hwCaret.para(); return !!q && !!q._cell && q._cell._obj === tob ? q : null; };

    hwCaret.set(tHost.id, tob.pos + 1, false);
    key('Backspace');
    var qb = inTob();
    ok('28-2 표 뒤 Backspace 는 표를 안 지우고 마지막 칸 끝으로', tableKept() && !!qb && hwCaret.at().pos === qb.len,
       (tableKept() ? '표 남음' : '표가 지워졌다') + ', 캐럿 ' + hwCaret.at().id + ':' + hwCaret.at().pos
         + (qb ? ' (칸 r' + qb._cell.r + ' c' + qb._cell.c + ', 끝 ' + qb.len + ')' : ' (표 밖)'));

    hwCaret.set(tHost.id, tob.pos, false);
    key('Delete');
    var qd = inTob();
    ok('28-3 표 앞 Delete 는 표를 안 지우고 첫 칸 머리로', tableKept() && !!qd && hwCaret.at().pos === 0,
       (tableKept() ? '표 남음' : '표가 지워졌다') + ', 캐럿 ' + hwCaret.at().id + ':' + hwCaret.at().pos
         + (qd ? ' (칸 r' + qd._cell.r + ' c' + qd._cell.c + ')' : ' (표 밖)'));

    var dirty28 = hwModel.dirtyCount();
    hwCaret.set(tHost.id, tob.pos, false);
    hwCaret.set(tHost.id, tob.pos + 1, true);
    key('Delete');
    ok('28-4 표만 걸친 선택을 지워도 표가 남고 문단이 안 더러워진다', tableKept() && hwModel.dirtyCount() === dirty28,
       (tableKept() ? '표 남음' : '표가 지워졌다') + ', 고친 문단 ' + dirty28 + '→' + hwModel.dirtyCount());

    /* 표를 통째로 덮은 선택(앞 문단 끝 ~ 뒤 문단 머리)을 지워도 표와 <b>칸 내용</b>이 그대로여야 한다.
       표만 남기고 칸 문단을 가운데 문단으로 지우면 내용이 날아간 빈 틀이 남는다. 끝나면 되돌려 둔다. */
    var cellText = function () {
      var s = '';
      for (var ci = 0; ci < tob.table.cells.length; ci++)
        for (var cj = 0; cj < tob.table.cells[ci].paras.length; cj++) s += hwModel.text(tob.table.cells[ci].paras[cj]) + '|';
      return s;
    };
    var tPrev = tHost ? hwModel.before(tHost) : null, tNext = tHost ? hwModel.after(tHost) : null;
    if (!tPrev || !tNext || tHost._cell) {
      ok('28-5 표를 덮은 선택을 지워도 표와 칸 내용이 남는다', true, '표 앞뒤 본문 문단이 없다 — 건너뜀');
    } else {
      var ct0 = cellText();
      hwCaret.set(tPrev.id, tPrev.len, false);
      hwCaret.set(tNext.id, 0, true);
      key('Delete');
      var ct1 = cellText();
      ok('28-5 표를 덮은 선택을 지워도 표와 칸 내용이 남는다', tableKept() && ct1 === ct0,
         (tableKept() ? '표 남음' : '표가 지워졌다') + ', 칸 글자 ' + ct0.length + '→' + ct1.length);
      key('z', { ctrl: true });
    }

    hwCaret.set(cellPara.id, cellPara.len, false);
    ok('28 표 칸에 캐럿', hwCaret.at().id === cellPara.id, hwCaret.at().id + ':' + hwCaret.at().pos);

    var lenCell = cellPara.len;
    typeIn('칸글');
    ok('29 표 칸에 입력', cellPara.len === lenCell + 2, 'len ' + lenCell + '→' + cellPara.len);

    var cellOps = hwBuildOps();
    var hit = null;
    for (var v = 0; v < cellOps.length; v++) if (cellOps[v].id === cellPara.id) hit = cellOps[v];
    ok('30 표 칸 요청이 저장에 실린다', !!hit && hit.op === 'replace', hit ? hit.op : '없음');

    /* 캐럿이 표 칸의 줄 위에 실제로 서는지 — 칸 좌표를 본문 기준으로 못 바꾸면 여기서 걸린다. */
    var cc = hwCaret.coord(cellPara.id, cellPara.len);
    ok('31 표 칸 캐럿 좌표', !!cc && cc.xHu > 0, cc ? ('x ' + Math.round(cc.xHu) + ' y ' + Math.round(cc.yHu)) : '없음');

    /* 행·열 넣기·빼기 — 화면 모델이 먼저 바뀌고, 같은 뜻의 요청이 저장에 실려야 한다. */
    var tobj = cellPara._cell._obj;
    var rows0 = tobj.table.rows, cols0 = tobj.table.cols, n0 = tobj.table.cells.length;

    hwCaret.set(cellPara.id, 0, false);
    hwTable.addRow(1);
    ok('32 행 넣기', tobj.table.rows === rows0 + 1 && tobj.table.cells.length > n0,
       '행 ' + rows0 + '→' + tobj.table.rows + ' 칸 ' + n0 + '→' + tobj.table.cells.length);

    var inCell = hwTable.here();
    ok('32-1 행을 넣어도 캐럿이 있던 칸에 남는다', !!inCell,
       inCell ? ('r' + inCell.cell.r + ' c' + inCell.cell.c) : '표 밖으로 나갔다');

    if (inCell) {
      var cols1 = tobj.table.cols;
      hwTable.addCol(1);
      ok('33 열 넣기', tobj.table.cols === cols1 + 1, '열 ' + cols1 + '→' + tobj.table.cols);

      /* ★ 방금 넣은 행(1번)을 지운다 — 글을 친 0번 행을 지우면 그 글이 없어져
         "칸 글자가 저장에 실렸나" 를 더 못 본다. */
      var newRow = null;
      for (var y = 0; y < tobj.table.cells.length; y++) if (tobj.table.cells[y].r === 1) { newRow = tobj.table.cells[y]; break; }
      if (newRow) {
        hwCaret.set(newRow.paras[0].id, 0, false);

        /* ★ 새로 생긴 칸의 문단 id 는 문서 쪽 표에 없다 — 요청에 실려 나가면 저장이 통째로
           예외로 끝나고 다른 문단의 고침까지 다 날아간다. 빠지는 글자 수만 알리고 op 는 안 만든다. */
        typeIn('새칸');
        var leak = null;
        var chk = hwBuildOps();
        for (var w = 0; w < chk.length; w++) if (chk[w].id === newRow.paras[0].id) leak = chk[w];
        ok('33-1 새 칸에 친 글이 저장 요청을 안 깨뜨린다', !leak,
           leak ? ('op ' + leak.op + ' 이 실렸다') : ('안 실림 · ' + hwModel.droppedChars() + '자 빠짐'));
      }

      var rows1 = tobj.table.rows;
      hwTable.delRow();
      ok('34 행 빼기', tobj.table.rows === rows1 - 1, '행 ' + rows1 + '→' + tobj.table.rows);
    } else {
      ok('33 열 넣기', false, '표 밖으로 캐럿이 나갔다');
    }

    var tops = hwBuildOps();
    var nTbl = 0;
    for (var z = 0; z < tops.length; z++) if (/^(addRow|delRow|addCol|delCol)$/.test(tops[z].op)) nTbl++;
    ok('35 표 요청이 저장에 실린다', nTbl === 3, '표 요청 ' + nTbl + '개');
  }

  /* ── 도구줄을 <b>DOM 이벤트로</b> 눌러 본다 ────────────────────────────────
     ★ hwFormat 을 직접 부르면 서식 계산만 보게 된다. 도구줄이 통째로 안 먹는 상태 —
       콤보 위에서 mousedown 기본 동작을 막아 목록이 안 펼쳐지는 것 — 은 그 방식으로는
       영영 안 잡힌다(실제로 사용자 화면에서 처음 발견됐다). */
  var picks = ['hwFont', 'hwSize', 'hwLine', 'hwColor'];
  var blocked = [];
  for (var pk = 0; pk < picks.length; pk++) {
    var pel = document.getElementById(picks[pk]);
    if (!pel) { blocked.push(picks[pk] + '(없음)'); continue; }
    var pev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    pel.dispatchEvent(pev);
    if (pev.defaultPrevented) blocked.push(picks[pk]);
  }
  ok('36 도구줄 콤보·색이 펼쳐진다', blocked.length === 0,
     blocked.length ? ('기본 동작이 막힌 것: ' + blocked.join(', ')) : (picks.length + '개 다 열림'));

  var fsel = document.getElementById('hwFont');
  ok('37 글꼴 목록이 비어 있지 않다', !!fsel && fsel.options.length > 0,
     fsel ? (fsel.options.length + '개') : '콤보가 없다');

  /* 단추는 반대로 초점을 뺏으면 안 된다 — 눌리는 순간 선택이 풀려 무엇에 걸지 모르게 된다. */
  var bbtn = document.querySelector('[data-fmt="bold"]');
  var bev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  if (bbtn) bbtn.dispatchEvent(bev);
  ok('38 서식 단추는 캐럿 초점을 안 뺏는다', !!bbtn && bev.defaultPrevented,
     bbtn ? (bev.defaultPrevented ? '기본 동작을 막는다' : '안 막는다') : '단추가 없다');

  /* ── 개체 다루기(8단계) — 눌러 봐야만 나오는 자리다 ──
     ★ 함수를 직접 부르지 않고 <b>마우스 이벤트</b>로 태운다. hwObj 를 직접 부르면 hwInput 의
       갈래(캐럿보다 먼저 개체를 보는가)를 한 번도 안 지나서, 그림을 눌러도 안 골라지는 상태가
       그대로 통과한다 — T0 이 같은 방식으로 새어 나갔다. */
  /* ★ <b>원본</b> 개체만 고른다. 이 검사 앞에서 accept() 를 부르므로(26-1 자리), 화면이 만든
     새 문단에 붙은 개체를 고치면 그 문단이 다시 dirty 가 되면서 저장 요청에 <b>문서에 없는 id</b> 로
     replace 가 실린다 — 그 ops.json 을 --apply 로 원본에 먹이면 "고칠 문단을 못 찾았다" 로 끝난다. */
  var oel = null;
  var cands = document.querySelectorAll('.hw-obj[data-para]');
  for (var oi = 0; oi < cands.length; oi++) {
    var opara = hwModel.byId(cands[oi].getAttribute('data-para'));
    if (!opara) continue;
    var opos = parseInt(cands[oi].getAttribute('data-pos'), 10);
    for (var oj = 0; oj < (opara.objs || []).length; oj++) {
      var oo = opara.objs[oj];
      if (oo.pos === opos && oo.oid && !oo.tmpId) { oel = cands[oi]; break; }
    }
    if (oel) break;
  }

  /* ★ 그 개체를 화면 안으로 끌어온다. 앞 단계들이 캐럿을 문서 아래로 옮겨 놓아서 첫 문단의
     개체는 뷰포트 위쪽 밖에 있다(실측 top=-443) — 그 자리에서는 elementFromPoint 가 null 이라
     끌기 검사가 "옮겨지지 않았다" 로 잘못 찍힌다. 사람은 보이는 것만 끄니까 제품 문제는 아니다. */
  if (oel) {
    var oPara = oel.getAttribute('data-para'), oPos = oel.getAttribute('data-pos');
    if (oel.scrollIntoView) oel.scrollIntoView({ block: 'center' });
    hwRenderRefresh();
    oel = document.querySelector('.hw-obj[data-para="' + oPara + '"][data-pos="' + oPos + '"]') || oel;
  }

  if (!oel) {
    ok('39 개체 고르기', true, '고를 수 있는 원본 개체가 없다(안 보이는 컨트롤뿐) — 건너뜀');
  } else {
    var orc = oel.getBoundingClientRect();
    down(oel, orc.left + orc.width / 2, orc.top + orc.height / 2);

    var sel39 = hwObj.current();
    /* ★ 조절점 개수로 판정하지 않는다 — 크기를 바꿀 수 있는 것은 그림뿐이고, 도형·수식은
       테두리만 두르고 자리만 옮긴다(hwObj.canResize). 개수로 재면 그 설계가 실패로 찍힌다. */
    ok('39 개체를 누르면 골라진다', !!sel39 && !!document.querySelector('.hw-objsel'),
       sel39 ? (sel39.para.id + ':' + sel39.obj.pos + ' ' + (sel39.obj.kind || '?')
                + ' 조절점 ' + document.querySelectorAll('.hw-handle').length + '개') : '안 골라짐');
    ok('40 개체를 고른 동안 캐럿은 안 그린다', !document.querySelector('.hw-caret'),
       document.querySelector('.hw-caret') ? '캐럿이 남아 있다' : '없음');

    if (sel39 && !sel39.obj.inline) {
      var x0 = sel39.obj.xOffHu || 0;
      move(orc.left + orc.width / 2 + 40, orc.top + orc.height / 2);
      up();
      ok('41 끌어서 옮기기', (sel39.obj.xOffHu || 0) > x0,
         'xOffHu ' + x0 + '→' + (sel39.obj.xOffHu || 0));

      key('z', { ctrl: true });
      ok('42 옮긴 것을 Ctrl+Z 로 되돌림',
         (hwModel.byId(sel39.para.id).objs[objIdx(sel39)].xOffHu || 0) === x0,
         'xOffHu ' + (hwModel.byId(sel39.para.id).objs[objIdx(sel39)].xOffHu || 0));
    } else if (sel39) {
      /* 글자처럼 취급하는 개체는 offset 이 없다 — 놓은 자리의 <b>글자 사이</b>로 옮겨져야 한다.
         여기를 안 태우면 "그림이 안 움직인다" 는 상태가 그대로 통과한다(사용자 보고로 잡힌 자리). */
      var pos0 = sel39.obj.pos;
      var rc2 = oel.getBoundingClientRect();

      /* ★ 줄 <b>맨 앞</b>으로 끈다. 오른쪽으로 조금 끌면 "개체 바로 다음 자리" 가 잡히는데,
         그 자리는 개체를 빼고 나면 원래 자리와 같아서 제자리로 판정된다 — 검사가 아무것도 안 본다. */
      var lineEl = oel.closest ? oel.closest('.hw-line') : null;
      var lrc = lineEl ? lineEl.getBoundingClientRect() : rc2;
      var dropY = rc2.top + rc2.height / 2;

      /* ★ 놓을 자리는 <b>개체 자리와 다른 곳</b>이어야 한다. 개체 바로 앞뒤 자리는 개체를 빼고 나면
         원래 자리와 같아져 제자리가 된다 — 개체가 줄 첫 글자인 문서(noori)에서는 줄 맨 앞이 곧
         그 자리다. 앞이 제자리면 줄 끝을 보고, 그것도 같으면 옮길 자리가 없는 문서다. */
      var stay = function (h) {
        return !h || (h.id === sel39.para.id && (h.pos === pos0 || h.pos === pos0 + 1));
      };

      var dropX = lrc.left + 2;
      var probe = hwCaret.hitTest(dropX, dropY);
      if (stay(probe)) { dropX = lrc.right - 2; probe = hwCaret.hitTest(dropX, dropY); }

      if (stay(probe)) {
        up();   /* 끌기를 끝내 둔다 — 안 끝내면 뒤 단계가 끌리는 중에 돈다 */
        ok('41 끌어서 글자 사이 자리 옮기기', true,
           '그 줄에 개체 말고 옮겨 갈 자리가 없다(놓은 자리 '
             + (probe ? probe.id + ':' + probe.pos : '쪽 밖') + ') — 건너뜀');
        ok('42 옮긴 것을 Ctrl+Z 로 되돌림', true, '건너뜀');
      } else {
        move(dropX, dropY);
        up();

        var now41 = hwObj.current();
        ok('41 끌어서 글자 사이 자리 옮기기', !!now41 && now41.obj.pos !== pos0,
           'pos ' + pos0 + '→' + (now41 ? now41.obj.pos : '개체를 잃었다')
             + ' (놓은 자리 ' + probe.id + ':' + probe.pos + ')');

        key('z', { ctrl: true });
        var now42 = hwObj.current();
        ok('42 옮긴 것을 Ctrl+Z 로 되돌림',
           !!hwModel.byId(sel39.para.id) && objAtPos(sel39.para.id, pos0),
           '원래 자리(' + pos0 + ')에 ' + (objAtPos(sel39.para.id, pos0) ? '있다' : '없다')
             + (now42 ? '' : ', 고르기는 풀렸다'));

        /* ★ 고르기도 되돌린 시점으로 가야 한다(TODO 3절). 옮긴 뒤 자리(to:pos)를 그대로 쥐고 있으면
           되돌린 문단의 그 자리에 있는 <b>다른</b> 개체가 골라지거나 고르기가 소리 없이 풀린다. */
        ok('42-1 되돌리면 개체 고르기도 원래 자리로',
           !!now42 && now42.para.id === sel39.para.id && now42.obj.pos === pos0,
           now42 ? (now42.para.id + ':' + now42.obj.pos + ' (원래 ' + sel39.para.id + ':' + pos0 + ')') : '고르기가 풀렸다');
      }

      /* 되돌린 뒤 다시 골라 둔다 — 43(크기 조절)이 이어서 돈다. */
      hwObj.select(sel39.para.id, pos0);
    } else {
      ok('41 끌어서 옮기기', true, '건너뜀');
      ok('42 옮긴 것을 Ctrl+Z 로 되돌림', true, '건너뜀');
    }

    /* 크기 조절 — 오른쪽 아래 조절점을 잡아 끈다. */
    var cur43 = hwObj.current();
    var hse = document.querySelector('.hw-handle[data-dir="se"]');
    if (cur43 && hse) {
      var w0 = cur43.obj.wHu || 0;
      var hrc = hse.getBoundingClientRect();
      down(hse, hrc.left + 4, hrc.top + 4);
      move(hrc.left + 44, hrc.top + 44);
      up();
      ok('43 모서리로 크기 조절', (cur43.obj.wHu || 0) > w0,
         'wHu ' + w0 + '→' + (cur43.obj.wHu || 0));

      /* ★ 최소 크기까지 줄여도 비율이 안 깨지는가(TODO 3절). 하한을 w·h 에 따로 걸면 짧은 쪽만 먼저
         멈춰 둘 다 최소값이 된다(정사각형). 그래서 정사각형에 가까운 개체로는 못 가린다. */
      var w1 = cur43.obj.wHu || 0, h1 = cur43.obj.hHu || 0;
      var hse1 = document.querySelector('.hw-handle[data-dir="se"]');
      if (hse1 && w1 > 0 && h1 > 0 && Math.abs(w1 / h1 - 1) > 0.05) {
        var r1 = hse1.getBoundingClientRect();
        down(hse1, r1.left + 4, r1.top + 4);
        move(r1.left - 3000, r1.top - 3000);
        up();
        var w2 = cur43.obj.wHu || 0, h2 = cur43.obj.hHu || 0;
        var rdrift = h2 > 0 ? Math.abs((w2 / h2) / (w1 / h1) - 1) : 1;
        ok('43-1 모서리로 최소 크기까지 줄여도 비율 유지', rdrift < 0.02 && Math.min(w2, h2) >= 990,
           w1 + '×' + h1 + ' → ' + w2 + '×' + h2 + ' (비율 오차 ' + (rdrift * 100).toFixed(1) + '%)');
      } else {
        ok('43-1 모서리로 최소 크기까지 줄여도 비율 유지', true,
           w1 + '×' + h1 + ' — 정사각형에 가까워 비율로 못 가린다(건너뜀)');
      }
    } else if (cur43 && cur43.obj.kind !== 'image') {
      ok('43 모서리로 크기 조절', true,
         (cur43.obj.kind || '?') + ' 는 크기를 안 바꾼다 — 바깥 크기만 늘리면 안쪽이 안 따라온다(건너뜀)');
    } else {
      ok('43 모서리로 크기 조절', false, '그림인데 조절점을 못 찾았다');
    }

    /* 재배치를 한 번 더 태워도 조절점이 살아 있어야 한다 — 가상 스크롤이 쪽을 다시 채우면
       개체 요소가 새것이 되므로, 선택을 요소 참조로 들고 있으면 여기서 사라진다. */
    hwRelayout();
    hwCaret.paint();
    ok('44 재배치 뒤에도 고르기가 살아 있다', !!document.querySelector('.hw-objsel'),
       document.querySelector('.hw-objsel')
         ? ('테두리 있음, 조절점 ' + document.querySelectorAll('.hw-handle').length + '개')
         : '테두리가 사라졌다');

    /* ★ 저장 요청을 재기 전에 한 번 더 고쳐 둔다 — 42 의 Ctrl+Z 가 개체 값과 함께
       "고쳤다" 표시(_edited)까지 되돌리기 때문이다. 키로 미는 것도 같은 경로를 지난다. */
    var cur45 = hwObj.current();
    var movable = !!cur45 && (!cur45.obj.inline || cur45.obj.kind === 'image');
    if (movable) key('ArrowRight', { shift: cur45.obj.inline });   /* 글자처럼 취급이면 크기, 아니면 자리 */

    /* ★ <b>고친 개체만</b> 크기를 싣는지 본다. 전부 실으면 안 보이는 컨트롤(용지 정의·단 정의)까지
       매 저장마다 화면 값으로 덮여, 글자 하나만 쳐도 그 구역의 용지 정의가 망가진다. */
    var opsG = hwBuildOps();
    var sent = 0, bare = 0;
    for (var g = 0; g < opsG.length; g++) {
      var gobjs = opsG[g].objs || [];
      for (var gi = 0; gi < gobjs.length; gi++) {
        if (gobjs[gi].wHu === undefined && gobjs[gi].xOffHu === undefined) bare++;
        else sent++;
      }
    }
    ok('45 고친 개체만 크기를 싣는다', movable ? sent >= 1 : true,
       '크기 실림 ' + sent + '개 / 자리만 ' + bare + '개'
       + (movable ? '' : ' (글자처럼 취급하는 그림 아닌 개체 — 고칠 것이 없다)'));

    /* ★ 글자처럼 취급 <-> 어울림. 자유 이동을 켜는 스위치이고, 이 값 하나가 파일에서는
       네 설정을 한 벌로 움직인다. 도구줄 단추를 <b>눌러서</b> 태운다(hwUi 분기까지 지난다). */
    var cur46 = hwObj.current();
    var tbtn = document.querySelector('[data-obj="inline"]');
    if (cur46 && tbtn) {
      var was = !!cur46.obj.inline;
      tbtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      var now46 = hwObj.current();
      var sentFlow = false;
      var opsF = hwBuildOps();
      for (var fi = 0; fi < opsF.length; fi++) {
        var fobjs = opsF[fi].objs || [];
        for (var fj = 0; fj < fobjs.length; fj++) if (fobjs[fj].inline !== undefined) sentFlow = true;
      }

      ok('46-1 글자처럼 취급 토글', !!now46 && !!now46.obj.inline !== was && sentFlow,
         '취급 ' + (was ? '글자처럼' : '어울림') + '→'
           + (now46 ? (now46.obj.inline ? '글자처럼' : '어울림') : '개체를 잃었다')
           + ', 저장 요청에 ' + (sentFlow ? '실림' : '안 실림'));

      /* 원래대로 돌려 둔다 — 뒤 단계와 저장 요청 검사가 원본 상태를 본다. */
      tbtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } else {
      ok('46-1 글자처럼 취급 토글', true, tbtn ? '고른 개체가 없다 — 건너뜀' : '단추가 없다');
    }

    hwObj.clear();
    ok('46 빈 곳을 누르면 고르기가 풀린다', !hwObj.current() && !document.querySelector('.hw-objsel'),
       hwObj.current() ? '아직 골라져 있다' : '풀림');
  }

  /* ── 찾기·바꾸기(8단계) ──
     ★ 핵심 판정은 49-50 이다: 모두 바꾸기가 <b>되돌리기 한 칸</b>으로 원상 복구되는가.
       고칠 문단을 직접 넘기지 않으면 캐럿 둘레만 스냅샷에 들어가 Ctrl+Z 가 반만 되돌리는데,
       되돌아오지 않은 문단은 dirty 로 남아 저장 요청에 실린다 — 화면과 파일이 갈라지고 신호가 없다. */
  var text0 = hwDocText();
  key('f', { ctrl: true });
  ok('47 Ctrl+F 로 찾기 패널이 열린다', hwFind.isOpen(), hwFind.isOpen() ? '열림' : '안 열림');

  /* ★ 원문에서 <b>붙어 있는</b> 두 글자를 고른다. 탭·개체·공백을 지우고 앞 두 글자를 떼면
     원문에서는 떨어져 있는 조합이 나와("첫 페이지" → "첫페") 있지도 않은 말을 찾게 된다. */
  var probe = '';
  var allP = hwModel.allParas();
  for (var fp = 0; fp < allP.length && !probe; fp++) {
    var ft = hwModel.text(allP[fp]);
    for (var fc = 0; fc + 1 < ft.length; fc++) {
      var c1 = ft.charAt(fc), c2 = ft.charAt(fc + 1);
      if ('\t\n￼ '.indexOf(c1) >= 0 || '\t\n￼ '.indexOf(c2) >= 0) continue;
      probe = c1 + c2;
      break;
    }
  }

  if (!probe) {
    ok('48 다음 찾기로 그 말이 골라진다', true, '글자가 없는 문서 — 건너뜀');
    ok('49 모두 바꾸기', true, '건너뜀');
    ok('50 모두 바꾸기를 Ctrl+Z 한 번으로 되돌린다', true, '건너뜀');
  } else {
    document.getElementById('hwFindText').value = probe;
    var found = hwFind.search(+1);
    var fsel = hwCaret.selection();
    ok('48 다음 찾기로 그 말이 골라진다',
       found && !!fsel && (fsel.toPos - fsel.fromPos) === probe.length,
       '"' + probe + '" ' + (fsel ? (fsel.fromId + ' ' + fsel.fromPos + '~' + fsel.toPos) : '못 찾음'));

    /* ★ 여러 문단에 걸친 선택에서 이전 찾기(TODO 3절) — 선택 <b>앞끝</b> 바로 앞의 그 말이 골라져야 한다.
       방금 찾은 자리 끝을 앞끝으로, 다음 문단 끝을 뒤끝(캐럿)으로 둔다. 기대 자리는 방금 찾은 그 자리다. */
    var hitP = fsel ? hwModel.byId(fsel.fromId) : null, hitAt = fsel ? fsel.fromPos : -1;
    var nextP = hitP ? hwModel.after(hitP) : null;
    if (!hitP || !nextP) {
      ok('48-1 여러 문단 선택에서 이전 찾기는 앞끝 앞에서 찾는다', true, '다음 문단이 없다 — 건너뜀');
    } else {
      hwCaret.set(hitP.id, hitAt + probe.length, false);
      hwCaret.set(nextP.id, nextP.len, true);
      hwFind.search(-1);
      var bsel = hwCaret.selection();
      ok('48-1 여러 문단 선택에서 이전 찾기는 앞끝 앞에서 찾는다',
         !!bsel && bsel.fromId === hitP.id && bsel.fromPos === hitAt,
         (bsel ? (bsel.fromId + ' ' + bsel.fromPos) : '못 찾음') + ' (기대 ' + hitP.id + ' ' + hitAt + ')');
    }

    document.getElementById('hwReplText').value = 'ZZ';
    hwFind.replaceAll();
    var text1 = hwDocText();
    ok('49 모두 바꾸기', text1 !== text0 && text1.indexOf('ZZ') >= 0,
       (document.getElementById('hwFindInfo') || {}).textContent || '');

    key('z', { ctrl: true });
    var text2 = hwDocText();
    ok('50 모두 바꾸기를 Ctrl+Z 한 번으로 되돌린다', text2 === text0,
       text2 === text0 ? '전부 원래대로'
         : ('ZZ 가 ' + (text2.split('ZZ').length - 1) + '군데 남았다 (바꾼 뒤 '
            + (text1.split('ZZ').length - 1) + '군데, 글자 수 ' + text0.length + '→' + text2.length + ')'));
  }
  hwFind.close();

  /* ── 고친 것을 C# 에 알리는가(8단계) ──
     ★ 창을 닫을 때 "저장할까요" 를 물을 <b>유일한</b> 근거다. 화면만 아는 값이라 미리 안 보내면
       C# 은 늘 "고친 것 없음" 으로 알고 그냥 닫는다. */
  var sawDirty = -1;
  var realPost = window.hwPost;
  window.hwPost = function (o) { if (o && o.t === 'dirty') sawDirty = o.n; return realPost(o); };
  window.hwDirtySent = -1;          /* 값이 같으면 안 보내므로 한 번은 나가게 한다 */
  typeIn('점');
  window.hwPost = realPost;
  ok('51 고친 것을 C# 에 알린다', sawDirty > 0, 'dirty=' + sawDirty);

  /* ── 최근 문서 목록(8단계) ── */
  var rsel = document.getElementById('hwRecent');
  hwSetRecent([]);
  var emptyOk = !!rsel && rsel.disabled && rsel.options.length === 1;

  hwSetRecent(['C:\\가\\첫째.hwp', 'C:\\나\\둘째.hwpx']);
  ok('52 최근 문서 목록을 그린다',
     emptyOk && !!rsel && !rsel.disabled && rsel.options.length === 3
       && rsel.options[1].value === 'C:\\가\\첫째.hwp' && rsel.options[1].textContent === '첫째.hwp',
     rsel ? (rsel.options.length + '개, 첫 항목 "' + (rsel.options[1] ? rsel.options[1].textContent : '') + '"'
             + (emptyOk ? ', 빈 목록이면 못 누름' : ', 빈 목록인데 눌린다')) : '콤보가 없다');

  /* ★ 콤보 위에서 mousedown 기본 동작을 막으면 목록이 안 펼쳐진다 — 메뉴줄도 도구줄과 같은
     함정을 갖고 있다(T0). 단추는 반대로 막아야 하므로 둘 다 본다. */
  var rev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  if (rsel) rsel.dispatchEvent(rev);
  var mbtn = document.querySelector('.hw-menu-item[data-cmd="open"]');
  var mev = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  if (mbtn) mbtn.dispatchEvent(mev);
  ok('53 최근 목록은 펼쳐지고 메뉴 단추는 초점을 안 뺏는다',
     !!rsel && !rev.defaultPrevented && !!mbtn && mev.defaultPrevented,
     '콤보 ' + (rev.defaultPrevented ? '막힘(문제)' : '열림') + ' / 단추 '
       + (mev.defaultPrevented ? '초점 지킴' : '초점 뺏김(문제)'));

  /* ── 여백 합이 용지 높이 이상인 구역(TODO 3절) ──
     본문 높이가 0 이하가 되면 자리 차지 개체의 while 이 영영 안 끝났다. 무한루프면 이 단계에서
     멈춰 C# 시한 초과로 걸린다. 모델은 잠깐만 바꾸고 반드시 되돌린다. */
  var sec54 = hwDoc.sections[0], pg54 = sec54.page, mt54 = pg54.mtHu, fp54 = sec54.paras[0], objs54 = fp54.objs;
  var n54 = -1;
  try {
    pg54.mtHu = pg54.hHu;
    fp54.objs = (objs54 || []).concat([{ pos: -1, inline: false, relV: 'para', yOffHu: 0, hHu: 30000 }]);
    n54 = hwPage.layout().length;
  } finally {
    pg54.mtHu = mt54;
    fp54.objs = objs54;
    hwRelayout();
  }
  ok('54 여백 합이 용지 높이 이상이어도 배치가 끝난다', n54 > 0, n54 + '쪽 (되돌린 뒤 ' + hwPageCount() + '쪽)');

  /* ★ 예외는 실패 단계로 찍는다 — 여기서 던지면 결과를 못 보내 C# 쪽에는 "시한 초과" 로만 보인다. */
  try {
    hwUiTestS1({ ok: ok, key: key, typeIn: typeIn, down: down, move: move, up: up, ime: ime });
  } catch (eS1) {
    ok('S1 세션 1 검사 중 예외', false, String(eS1 && eS1.stack ? eS1.stack : eS1).replace(/\s+/g, ' ').slice(0, 400));
  }

  /* ★ 그림은 늦게 온다 — 그린 직후에 재면 아직 안 받아 온 것까지 "실패" 로 찍힌다.
     다 붙거나 실패할 때까지 기다렸다가 판정한다. */
  hwWaitImages().then(function (r) {
    ok('20 그림이 실제로 그려짐', r.total === 0 || r.loaded === r.total, r.loaded + '/' + r.total + ' 장');
    /* ★ 여기서 다시 만든다 — 위에서 잡아 둔 ops 는 표 칸을 고치기 <b>전</b>의 것이라,
       그것을 내보내면 --apply 가 표 편집을 한 번도 안 태운다(실측으로 걸렸다). */
    hwPost({
      t: 'uitest', steps: steps, ops: hwBuildOps(), drift: hwCaretDriftMax(),
      charShapes: hwDoc.charShapes, paraShapes: hwDoc.paraShapes
    });
  });
}

/* ── 세션 1(FEATURE-PLAN 1부·2부·D1) — 키 표·정렬·IME·끌기·한글 단축키·표 지우기 ─────────────
   ★ 번호는 FEATURE-PLAN 항목의 검사 번호 그대로다(55~71, 90).
   ★ 검사용 문단을 본문 끝에 새로 만들어 거기서 본다. 문서마다 모양이 달라서, 쓸 값은 여기서 못 박는다.
   ★ 정렬은 우리 계산식이 아니라 <b>화면에 그려진 글자</b>의 빈 폭으로 판정한다 — 계산식으로 기대값을
     만들면 그 검사는 계산식이 틀려도 통과한다. */
function hwUiTestS1(t) {
  var ok = t.ok, key = t.key, typeIn = t.typeIn, ime = t.ime;

  function st() { var s = document.getElementById('hwStatus'); return s ? s.textContent : ''; }
  function linesOf(p) { return hwLineIndex[p.id] || []; }
  function csAt(p, k) { return hwDoc.charShapes[hwModel.shapeAt(p, k || 0)]; }
  function psOf(p) { return hwDoc.paraShapes[p.ps]; }
  function pick(p, a, b) { hwCaret.set(p.id, a, false); hwCaret.set(p.id, b, true); }
  /* ★ 캐럿만 화면에 넣으면 문단 아랫줄은 캔버스 밖에 남는다 — 그 자리를 누르면 elementFromPoint 가 null 이라
     "누르기 어긋남" 이 거짓으로 찍힌다(실측 noori.hwp: 점 y=922, 캔버스 58~878). 문단 첫 줄을 화면 위쪽으로 올린다. */
  function show() {
    hwCaret.scrollIntoView();
    hwRenderRefresh();
    var ls = hwLineIndex[sp.id] || [], d = ls.length ? lineDom(ls[0]) : null, cv = hwRenderer.canvas();
    if (d && cv) {
      cv.scrollTop += d.el.getBoundingClientRect().top - cv.getBoundingClientRect().top - 20;
      hwRenderRefresh();
    }
  }
  function tableCount() {
    var n = 0, all = hwModel.allParas();
    for (var i = 0; i < all.length; i++) for (var j = 0; j < (all[i].objs || []).length; j++) if (all[i].objs[j].table) n++;
    return n;
  }

  function lineDom(it) {
    var body = hwRenderer.bodyOf(it.pageIdx);
    if (!body) return null;
    var el = body.querySelector('.hw-line[data-id="' + it.para.id + '"][data-li="' + it.li + '"]');
    return el ? { el: el, br: body.getBoundingClientRect() } : null;
  }

  /* 줄 칸 왼쪽 ~ 첫 글자, 보이는 마지막 글자 ~ 줄 칸 오른쪽 사이의 빈 폭(px). */
  function gaps(p, it) {
    var d = lineDom(it);
    if (!d) return null;
    var text = hwModel.text(p), ln = it.line, te = ln.e;
    while (te > ln.s && (text.charAt(te - 1) === '\n' || text.charAt(te - 1) === ' ')) te--;
    if (te <= ln.s) return null;
    var r0 = hwDomRectOfChar(d.el, 0);
    var r1 = hwDomRectOfChar(d.el, hwFlowIndex(p, ln.s, te - 1));
    if (!r0 || !r1) return null;
    var x0 = d.br.left + hwHu2Px(it.xHu), x1 = d.br.left + hwHu2Px(it.xHu + ln.availHu);
    return { left: Math.round((r0.left - x0) * 10) / 10, right: Math.round((x1 - r1.right) * 10) / 10 };
  }
  function g2s(g) { return g ? ('왼 ' + g.left + ' 오 ' + g.right + 'px') : '줄이 안 그려짐'; }

  /* 문단 줄마다 (캐럿 x − 그려진 글자 x) 최대값, 그리고 글자를 눌렀을 때 캐럿이 그 글자에 안 서는 수. */
  function drift(p) {
    var worst = 0, bad = 0, at = '', why = '', ls = linesOf(p);
    var cvr = hwRenderer.canvas().getBoundingClientRect();
    for (var i = 0; i < ls.length; i++) {
      var it = ls[i], ln = it.line, d = lineDom(it);
      if (!d) { bad++; continue; }
      var er = d.el.getBoundingClientRect();
      for (var k = ln.s; k < ln.e; k++) {
        var r = hwDomRectOfChar(d.el, hwFlowIndex(p, ln.s, k));
        var c = hwCaret.coord(p.id, k);
        if (!r || !c) continue;
        var dd = Math.abs(d.br.left + hwHu2Px(c.xHu) - r.left);
        if (dd > worst) { worst = dd; at = ' @줄' + i + ' 글자' + k; }
        var hy = er.top + er.height / 2;
        var h = hwCaret.hitTest(r.left + 1, hy);
        if (!h || h.id !== p.id || h.pos !== k) {
          if (!bad) {
            var efp = document.elementFromPoint(r.left + 1, hy);
            why = ' [첫 어긋남 줄' + i + ' 글자' + k + ' → ' + (h ? h.id + ':' + h.pos : 'null')
                + ' 점 ' + Math.round(r.left + 1) + ',' + Math.round(hy) + ' 캔버스 ' + Math.round(cvr.top) + '~' + Math.round(cvr.bottom)
                + ' 요소 ' + (efp ? (efp.className || efp.tagName) : 'null') + ']';
          }
          bad++;
        }
      }
    }
    return { px: Math.round(worst * 10) / 10, bad: bad,
             s: Math.round(worst * 10) / 10 + 'px' + at + ', 누르기 어긋남 ' + bad + why };
  }

  /* ── 검사용 문단: 본문 끝 쪽 <b>원본</b> 문단 뒤에 새로 만들고, 세 줄이 넘을 때까지 채운다 ──
     ★ 화면이 만든 문단(n…) 뒤에 만들면 안 된다. 26-1 이 저장을 흉내 낸(accept) 뒤라 그 문단을 고치면 저장
       요청에 문서에 없는 id 로 replace 가 실리고, 그 ops.json 을 --apply 로 원본에 먹이면 거기서 멈춘다. */
  var S0 = hwDoc.sections[0].paras, tail = S0[S0.length - 1];
  for (var ti = S0.length - 1; ti >= 0; ti--) if (S0[ti].id.charAt(0) !== 'n') { tail = S0[ti]; break; }
  hwCaret.set(tail.id, tail.len, false);
  key('Enter');
  var sp = hwCaret.para();
  var chunk = '가나다라 마바사아 자차카타 파하 ';
  function fill(n) {
    hwCaret.set(sp.id, sp.len, false);
    for (var g = 0; g < 80 && linesOf(sp).length < n; g++) typeIn(chunk);
  }
  fill(3);
  pick(sp, 0, sp.len);
  hwFormat.applyChar({ sizeHu: 1000, ratio: 100, spacing: 0, bold: false, italic: false, underline: 0, strike: false });
  hwCaret.set(sp.id, 0, false);
  hwFormat.applyPara({ align: 'justify', indentHu: 0, mlHu: 0, mrHu: 0, lsType: 'percent', ls: 160 });
  fill(3);

  /* ── 55 키 표·두 타 조합 ── */
  var text55 = hwDocText();
  pick(sp, 2, 4);
  key('k', { ctrl: true });
  ok('55 Ctrl+K 는 둘째 키를 기다린다', st().indexOf('Ctrl+K') >= 0, st());
  key('Escape');
  var s55 = hwCaret.selection();
  ok('55-1 대기 중 Esc 는 대기만 푼다(글·선택 그대로)',
     hwDocText() === text55 && !!s55 && s55.fromPos === 2 && s55.toPos === 4 && st().indexOf('Ctrl+K') < 0,
     (hwDocText() === text55 ? '글 그대로' : '글이 바뀜') + ', 선택 ' + (s55 ? s55.fromPos + '~' + s55.toPos : '없음'));

  var saw55 = null, real55 = window.hwPost;
  window.hwPost = function (o) { if (o && o.t === 'save') saw55 = o; return real55(o); };
  key('s', { ctrl: true, shift: true });
  window.hwPost = real55;
  ok('55-2 Ctrl+Shift+S 는 다른 이름으로 저장', !!saw55 && saw55.saveAs === true,
     saw55 ? ('saveAs=' + saw55.saveAs) : '저장 요청이 안 나감');

  hwCaret.set(sp.id, 3, false);
  key('Home', { ctrl: true, shift: true });
  var s55b = hwCaret.selection(), first55 = hwModel.allParas()[0];
  ok('55-3 Ctrl+Shift+Home 은 문서 머리까지 고른다',
     !!s55b && s55b.fromId === first55.id && s55b.fromPos === 0 && s55b.toId === sp.id && s55b.toPos === 3,
     s55b ? (s55b.fromId + ':' + s55b.fromPos + ' ~ ' + s55b.toId + ':' + s55b.toPos) : '선택 없음');
  hwCaret.set(sp.id, 0, false);

  /* ── 56 문단 정렬이 화면에 먹는다(A2) ── */
  var worst56 = [], bad56 = 0;
  function alignCase(a) {
    hwCaret.set(sp.id, 0, false);
    hwFormat.applyPara({ align: a });
    show();
    var ls = linesOf(sp);
    return { first: gaps(sp, ls[0]), last: gaps(sp, ls[ls.length - 1]), d: drift(sp) };
  }

  var ac = alignCase('center');
  ok('56 가운데 정렬 — 마지막 줄 왼쪽·오른쪽 빈 폭이 같다',
     !!ac.last && ac.last.left > 5 && Math.abs(ac.last.left - ac.last.right) <= 1.5, g2s(ac.last));
  worst56.push('가운데 ' + ac.d.s); bad56 += ac.d.bad + (ac.d.px > 1.5 ? 1 : 0);

  var ar = alignCase('right');
  ok('56-1 오른쪽 정렬 — 마지막 줄이 오른쪽 끝에 닿는다',
     !!ar.last && ar.last.left > 5 && Math.abs(ar.last.right) <= 1.5, g2s(ar.last));
  worst56.push('오른쪽 ' + ar.d.s); bad56 += ar.d.bad + (ar.d.px > 1.5 ? 1 : 0);

  var aj = alignCase('justify');
  ok('56-2 양쪽 정렬 — 첫 줄은 양 끝에 닿고 마지막 줄은 왼쪽',
     !!aj.first && !!aj.last && Math.abs(aj.first.left) <= 1.5 && Math.abs(aj.first.right) <= 1.5
       && Math.abs(aj.last.left) <= 1.5 && aj.last.right > 5,
     '첫 줄 ' + g2s(aj.first) + ' / 마지막 줄 ' + g2s(aj.last));
  worst56.push('양쪽 ' + aj.d.s); bad56 += aj.d.bad + (aj.d.px > 1.5 ? 1 : 0);

  var ad = alignCase('distribute');
  ok('56-3 배분 정렬 — 마지막 줄까지 양 끝에 닿는다',
     !!ad.last && Math.abs(ad.last.left) <= 1.5 && Math.abs(ad.last.right) <= 1.5, g2s(ad.last));
  worst56.push('배분 ' + ad.d.s); bad56 += ad.d.bad + (ad.d.px > 1.5 ? 1 : 0);

  var al = alignCase('left');
  worst56.push('왼쪽 ' + al.d.s); bad56 += al.d.bad + (al.d.px > 1.5 ? 1 : 0);
  ok('56-4 다섯 정렬 모두 캐럿 x = 그려진 글자 x, 누른 글자에 캐럿이 선다', bad56 === 0, worst56.join(' / '));

  hwFormat.setAlign('distribute');
  hwFormat.setAlign('distribute');
  ok('56-5 배분을 두 번 누르면 양쪽', psOf(sp).align === 'justify', psOf(sp).align);

  /* ── 57 IME 동기 확정(A3) ── */
  hwCaret.set(sp.id, sp.len, false);
  var len57 = sp.len;
  ime.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
  ime.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ㅎ', bubbles: true }));
  ime.textContent = '하';
  ime.dispatchEvent(new CompositionEvent('compositionend', { data: '하', bubbles: true }));
  ok('57 조합 끝에서 바로 확정된다(input·타이머 없이)', sp.len === len57 + 1 && hwModel.text(sp).slice(-1) === '하',
     'len ' + len57 + '→' + sp.len + ' 끝 "' + hwModel.text(sp).slice(-1) + '"');

  var len57b = sp.len;
  ime.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
  ime.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ㅎ', bubbles: true }));
  ime.textContent = '';
  ime.dispatchEvent(new CompositionEvent('compositionend', { data: '', bubbles: true }));
  ok('57-1 취소된 조합(빈 data, 빈 수신기)은 아무것도 안 넣는다',
     sp.len === len57b && !document.querySelector('.hw-composing'), 'len ' + len57b + '→' + sp.len);

  var len57c = sp.len;
  ime.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
  ime.textContent = '한';
  ime.dispatchEvent(new CompositionEvent('compositionend', { data: '한', bubbles: true }));
  ime.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
  ime.textContent = '글';
  ime.dispatchEvent(new CompositionEvent('compositionend', { data: '글', bubbles: true }));
  ime.dispatchEvent(new InputEvent('input', { bubbles: true }));
  ok('57-2 조합 끝 바로 뒤 새 조합 — 순서대로 한 번씩', sp.len === len57c + 2 && hwModel.text(sp).slice(-2) === '한글',
     'len ' + len57c + '→' + sp.len + ' 끝 "' + hwModel.text(sp).slice(-2) + '"');

  /* ── 58 끌어 선택이 본문 밖으로 나가도 이어진다(A4) ── */
  hwCaret.set(sp.id, 0, false);
  show();
  var it58 = linesOf(sp)[0], d58 = it58 ? lineDom(it58) : null;
  if (!d58) {
    ok('58 본문 밖으로 끌어도 선택이 이어진다', false, '검사용 문단 첫 줄이 안 그려짐');
  } else {
    var r58 = hwDomRectOfChar(d58.el, 0), er58 = d58.el.getBoundingClientRect();
    var h58 = hwCaret.hitTest(r58.left + 1, er58.top + er58.height / 2);
    t.down(d58.el, r58.left + 1, er58.top + er58.height / 2);
    var cv58 = hwRenderer.canvas().getBoundingClientRect();
    t.move(r58.left + 20, cv58.bottom + 30);
    var s58 = hwCaret.selection();
    t.up();
    /* ★ 끝 자리를 문서 순서로 기대하지 않는다 — 다단 문서는 앞 문단이 화면상 더 아래에 놓이기도 해서
       (multicolumns-widths.hwp), 아래로 끌면 문서 순서로 <b>앞</b> 자리가 잡히는 게 맞다. 누른 자리가 한쪽
       끝이고 캐럿이 거기서 떠났으면 끌기가 캔버스 밖에서도 이어진 것이다(예전 수신기로는 선택이 아예 없었다). */
    var cur58 = hwCaret.at();
    var anchored58 = !!s58 && !!h58 && ((s58.fromId === h58.id && s58.fromPos === h58.pos)
                                        || (s58.toId === h58.id && s58.toPos === h58.pos));
    ok('58 본문 밖(아래)으로 끌어도 선택이 이어진다',
       anchored58 && (cur58.id !== h58.id || cur58.pos !== h58.pos),
       (s58 ? (s58.fromId + ':' + s58.fromPos + ' ~ ' + s58.toId + ':' + s58.toPos) : '선택 없음')
         + ' (검사 문단 ' + sp.id + ', 누른 점 ' + (h58 ? h58.id + ':' + h58.pos : 'null')
         + ' y ' + Math.round(er58.top) + ')');
    var keep58 = hwCaret.selection();
    t.move(r58.left + 40, cv58.bottom + 60);
    var after58 = hwCaret.selection();
    ok('58-1 놓은 뒤 움직임은 선택을 안 바꾼다',
       !!keep58 && !!after58 && keep58.toId === after58.toId && keep58.toPos === after58.toPos,
       after58 ? (after58.toId + ':' + after58.toPos) : '선택 없음');
  }
  hwCaret.set(sp.id, 0, false);

  /* ── 60 글자 크기 키우기·줄이기(B1) ── */
  pick(sp, 0, sp.len);
  hwFormat.applyChar({ sizeHu: 1000 });
  key(']', { ctrl: true });
  key(']', { ctrl: true });
  var z1 = csAt(sp, 0).sizeHu;
  key('[', { ctrl: true });
  var z2 = csAt(sp, 0).sizeHu;
  key('e', { alt: true, shift: true });
  var z3 = csAt(sp, 0).sizeHu;
  ok('60 Ctrl+] 두 번 10→12pt, Ctrl+[ 11pt, Alt+Shift+E 12pt', z1 === 1200 && z2 === 1100 && z3 === 1200,
     z1 + ' → ' + z2 + ' → ' + z3);

  hwFormat.applyChar({ sizeHu: 7200 });
  key(']', { ctrl: true });
  ok('60-1 72pt 에서 Ctrl+] 는 그대로', csAt(sp, 0).sizeHu === 7200, String(csAt(sp, 0).sizeHu));

  var half = Math.floor(sp.len / 2);
  pick(sp, 0, half); hwFormat.applyChar({ sizeHu: 1000 });
  pick(sp, half, sp.len); hwFormat.applyChar({ sizeHu: 1400 });
  pick(sp, 0, sp.len);
  key(']', { ctrl: true });
  ok('60-2 섞인 크기는 모양마다 한 단계씩(10→11, 14→15)',
     csAt(sp, 0).sizeHu === 1100 && csAt(sp, sp.len - 1).sizeHu === 1500,
     csAt(sp, 0).sizeHu + ' / ' + csAt(sp, sp.len - 1).sizeHu);
  hwFormat.applyChar({ sizeHu: 1000 });

  /* ── 61 장평·자간(B2) ── */
  hwFormat.applyChar({ ratio: 100, spacing: 0 });
  for (var k61 = 0; k61 < 3; k61++) key('k', { alt: true, shift: true });
  ok('61 장평 100 → Alt+Shift+K 세 번 → 103', csAt(sp, 0).ratio === 103, String(csAt(sp, 0).ratio));
  key('w', { alt: true, shift: true });
  key('w', { alt: true, shift: true });
  ok('61-1 자간 0 → Alt+Shift+W 두 번 → 2', csAt(sp, 0).spacing === 2, String(csAt(sp, 0).spacing));
  hwFormat.applyChar({ ratio: 50 });
  key('j', { alt: true, shift: true });
  key('k', { alt: true, shift: true });
  ok('61-2 장평 50% 이하면 늘리기·줄이기 모두 무시', csAt(sp, 0).ratio === 50, String(csAt(sp, 0).ratio));
  hwFormat.applyChar({ ratio: 100, spacing: 0 });

  /* ── 62 굵게 별칭(B3) ── */
  var b62 = !!csAt(sp, 0).bold;
  key('b', { alt: true, shift: true });
  var b62a = !!csAt(sp, 0).bold;
  key('b', { alt: true, shift: true });
  ok('62 Alt+Shift+B 로 굵게 켜고 끄기', b62a !== b62 && !!csAt(sp, 0).bold === b62, b62 + '→' + b62a + '→' + !!csAt(sp, 0).bold);

  /* ── 63 정렬 단축키(B4) ── */
  hwCaret.set(sp.id, 0, false);
  var al63 = [['l', 'left'], ['c', 'center'], ['r', 'right'], ['m', 'justify'], ['t', 'distribute']], got63 = [];
  var ok63 = true;
  for (var i63 = 0; i63 < al63.length; i63++) {
    key(al63[i63][0], { ctrl: true, shift: true });
    got63.push(psOf(sp).align);
    if (psOf(sp).align !== al63[i63][1]) ok63 = false;
  }
  key('c', { ctrl: true, alt: true });
  got63.push('Ctrl+Alt+C:' + psOf(sp).align);
  if (psOf(sp).align !== 'center') ok63 = false;
  ok('63 Ctrl+Shift+L/C/R/M/T · Ctrl+Alt+C 정렬', ok63, got63.join(' '));
  key('t', { ctrl: true, shift: true });
  key('t', { ctrl: true, shift: true });
  ok('63-1 Ctrl+Shift+T 두 번 → 양쪽', psOf(sp).align === 'justify', psOf(sp).align);

  /* ── 64 줄 간격(B5) ── */
  hwFormat.applyPara({ lsType: 'percent', ls: 160 });
  key('z', { alt: true, shift: true });
  var l64 = psOf(sp).ls;
  key('q', { ctrl: true, shift: true });
  ok('64 160% → Alt+Shift+Z 170 → Ctrl+Shift+Q 160', l64 === 170 && psOf(sp).ls === 160, l64 + ' → ' + psOf(sp).ls);
  hwFormat.applyPara({ lsType: 'fixed', ls: 2000 });
  key('a', { alt: true, shift: true });
  ok('64-1 고정 20pt → Alt+Shift+A → 19pt', psOf(sp).lsType === 'fixed' && psOf(sp).ls === 1900, psOf(sp).lsType + ' ' + psOf(sp).ls);
  hwFormat.applyPara({ lsType: 'percent', ls: 160 });

  /* ── 65 첫 줄·여백 1pt(B6) ── */
  hwFormat.applyPara({ indentHu: 0, mlHu: 0, mrHu: 0 });
  key('F5', { ctrl: true }); key('F5', { ctrl: true }); key('F5', { ctrl: true });
  var i65 = psOf(sp).indentHu;
  key('F6', { ctrl: true });
  key('F5', { ctrl: true, alt: true });
  key('F7', { ctrl: true, alt: true });
  ok('65 Ctrl+F5 세 번 +300, Ctrl+F6 −100, Ctrl+Alt+F5·F7 여백 +100',
     i65 === 300 && psOf(sp).indentHu === 200 && psOf(sp).mlHu === 100 && psOf(sp).mrHu === 100,
     '첫 줄 ' + i65 + '→' + psOf(sp).indentHu + ' 왼 ' + psOf(sp).mlHu + ' 오 ' + psOf(sp).mrHu);
  var w65 = linesOf(sp)[0].colWHu;
  hwFormat.applyPara({ indentHu: 0, mlHu: 0, mrHu: Math.round(w65 - 1417 - 50) });
  var mr65 = psOf(sp).mrHu;
  key('F7', { ctrl: true, alt: true });
  ok('65-1 남는 본문 폭이 5mm 밑으로 가면 여백을 더 안 늘린다', psOf(sp).mrHu === mr65,
     '폭 ' + Math.round(w65) + ' 오른쪽 ' + mr65 + '→' + psOf(sp).mrHu);
  hwFormat.applyPara({ indentHu: 0, mlHu: 0, mrHu: 0 });

  /* ── 66 글자색 두 타 조합(B7) ── */
  pick(sp, 0, 3);
  key('m', { ctrl: true });
  key('r');
  ok('66 Ctrl+M, R → 빨강', csAt(sp, 0).color === '#FF0000', csAt(sp, 0).color);
  var text66 = hwDocText();
  key('m', { ctrl: true });
  key('Process', { code: 'KeyB' });
  ime.dispatchEvent(new CompositionEvent('compositionstart', { data: '', bubbles: true }));
  ime.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'ㅠ', bubbles: true }));
  ime.textContent = 'ㅠ';
  ime.dispatchEvent(new CompositionEvent('compositionend', { data: 'ㅠ', bubbles: true }));
  ok('66-1 한글 모드 둘째 키(Process/KeyB) → 파랑, 그 키가 연 조합은 글자로 안 들어간다',
     csAt(sp, 0).color === '#0000FF' && hwDocText() === text66 && ime.textContent === '',
     csAt(sp, 0).color + ', 글 ' + (hwDocText() === text66 ? '그대로' : '바뀜(' + hwDocText().length + '자)'));
  hwFormat.applyChar({ color: '#000000' });

  /* ── 67 한 줄 지우기(B8, 결정 ①) ── */
  fill(3);
  var ls67 = linesOf(sp), t67 = hwModel.text(sp);
  var s67 = ls67[1].line.s, e67 = ls67[1].line.e;
  hwCaret.set(sp.id, s67 + 1, false);
  key('y', { ctrl: true });
  ok('67 둘째 줄에서 Ctrl+Y → 그 줄 글자만 빠진다', hwModel.text(sp) === t67.slice(0, s67) + t67.slice(e67),
     '길이 ' + t67.length + '→' + hwModel.text(sp).length + ' (줄 ' + s67 + '~' + e67 + ')');
  key('z', { ctrl: true });

  var t67b = hwModel.text(sp), e67b = linesOf(sp)[0].line.e;
  hwCaret.set(sp.id, 2, false);
  key('y', { alt: true });
  ok('67-1 Alt+Y 는 캐럿부터 그 줄 끝까지', hwModel.text(sp) === t67b.slice(0, 2) + t67b.slice(e67b),
     '길이 ' + t67b.length + '→' + hwModel.text(sp).length);
  key('z', { ctrl: true });

  hwCaret.set(sp.id, sp.len, false);
  key('Enter'); typeIn('한줄');
  var one67 = hwCaret.para();
  key('Enter'); typeIn('다음');
  var next67 = hwCaret.para(), n67 = hwDoc.sections[0].paras.length;
  hwCaret.set(one67.id, 1, false);
  key('y', { ctrl: true });
  ok('67-2 한 줄짜리 문단은 문단째 없어지고 다음 문단이 올라온다',
     hwDoc.sections[0].paras.length === n67 - 1 && !hwModel.byId(one67.id) && hwCaret.at().id === next67.id,
     '문단 ' + n67 + '→' + hwDoc.sections[0].paras.length + ', 캐럿 ' + hwCaret.at().id);
  key('z', { ctrl: true });
  ok('67-3 Ctrl+Z 로 그 문단이 돌아온다', hwDoc.sections[0].paras.length === n67 && !!hwModel.byId(one67.id)
     && hwModel.text(hwModel.byId(one67.id)) === '한줄', '문단 ' + hwDoc.sections[0].paras.length);

  /* ── 68 쪽 나누기(B9) ── */
  var pg68 = hwPageCount(), n68 = hwDoc.sections[0].paras.length;
  hwCaret.set(sp.id, linesOf(sp)[1].line.s + 1, false);
  key('Enter', { ctrl: true });
  var np68 = hwCaret.para();
  ok('68 Ctrl+Enter — 쪽이 하나 늘고 새 문단에 쪽 나눔', hwPageCount() === pg68 + 1 && np68 !== sp && np68.brk === 'page',
     '쪽 ' + pg68 + '→' + hwPageCount() + ', brk ' + np68.brk);
  var ops68 = hwBuildOps(), sent68 = false;
  for (var o68 = 0; o68 < ops68.length; o68++) if (ops68[o68].id === np68.id && ops68[o68].brk === 'page') sent68 = true;
  key('z', { ctrl: true });
  var undone68 = hwPageCount() === pg68 && hwDoc.sections[0].paras.length === n68;
  key('z', { ctrl: true, shift: true });
  var re68 = hwModel.byId(np68.id);
  ok('68-1 저장 요청에 나눔이 실리고, 되돌리기·다시 하기가 나눔까지 맞춘다',
     sent68 && undone68 && !!re68 && re68.brk === 'page' && hwPageCount() === pg68 + 1,
     '요청 ' + (sent68 ? '실림' : '안 실림') + ', 되돌림 ' + (undone68 ? '맞음' : '틀림')
       + ', 다시 ' + (re68 ? re68.brk : '문단 없음') + ' ' + hwPageCount() + '쪽');
  key('z', { ctrl: true });

  /* 구역 머리(안 보이는 구역·단 정의 앞)에서 Ctrl+Enter — 정의가 새 문단으로 넘어가면 문서가 깨진다. */
  var h68 = hwDoc.sections[0].paras[0], hid68 = function () {
    var n = 0; for (var i = 0; i < (h68.objs || []).length; i++) if (h68.objs[i].hidden) n++; return n;
  };
  var nh68 = hid68(), np68b = hwDoc.sections[0].paras.length, brk68 = h68.brk;
  hwCaret.set(h68.id, 0, false);
  key('Enter', { ctrl: true });
  ok('68-2 구역 머리에서 Ctrl+Enter 는 구역·단 정의를 옮기지 않는다',
     hid68() === nh68 && hwDoc.sections[0].paras[0] === h68,
     '정의 ' + nh68 + '→' + hid68() + ', 문단 ' + np68b + '→' + hwDoc.sections[0].paras.length);
  if (hwDoc.sections[0].paras.length !== np68b || h68.brk !== brk68) key('z', { ctrl: true });

  /* ── 69 다시 찾기·찾아가기(B10) ── */
  document.getElementById('hwFindText').value = '가나';
  if (hwFind.isOpen()) hwFind.close();
  hwCaret.set(sp.id, 0, false);
  key('q', { ctrl: true }); key('l');
  var f69 = hwCaret.selection();
  key('q', { ctrl: true }); key('l');
  var f69b = hwCaret.selection();
  var txt69 = f69 ? hwModel.text(hwModel.byId(f69.fromId)).slice(f69.fromPos, f69.toPos) : '';
  ok('69 찾기 창이 닫혀도 Ctrl+Q, L 로 다음 "가나"', txt69 === '가나' && !!f69b
       && (f69b.fromId !== f69.fromId || f69b.fromPos !== f69.fromPos) && !hwFind.isOpen(),
     f69 ? ('"' + txt69 + '" ' + f69.fromId + ':' + f69.fromPos + ' → ' + (f69b ? f69b.fromId + ':' + f69b.fromPos : '없음')) : '못 찾음');

  var want69 = hwPageCount() >= 2 ? 2 : 1;
  key('g', { alt: true });
  var gin = document.getElementById('hwGotoPage');
  var open69 = hwFind.isGotoOpen();
  if (gin) {
    gin.value = String(want69);
    gin.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }
  var c69 = hwCaret.coord(hwCaret.at().id, hwCaret.at().pos);
  ok('69-1 Alt+G 찾아가기 — 쪽 번호로 간다', open69 && !hwFind.isGotoOpen() && !!c69 && c69.pageIdx === want69 - 1,
     (open69 ? '창 열림' : '창 안 열림') + ', 캐럿 ' + (c69 ? (c69.pageIdx + 1) + '쪽' : '없음') + ' (기대 ' + want69 + ')');

  /* ── 70 Alt+방향키 화면 밀기(B11) ── */
  var cv70 = hwRenderer.canvas();
  cv70.scrollTop = 0;
  var at70 = hwCaret.at();
  var e70 = key('ArrowDown', { alt: true });
  var top70 = cv70.scrollTop;
  var e70b = key('ArrowLeft', { alt: true });
  ok('70 Alt+↓ 는 화면만 민다(캐럿 그대로), Alt+← 는 뒤로 가기로 안 샌다',
     top70 > 0 && hwCaret.at().id === at70.id && hwCaret.at().pos === at70.pos && e70.defaultPrevented && e70b.defaultPrevented,
     'scrollTop 0→' + top70 + ', 캐럿 ' + (hwCaret.at().pos === at70.pos ? '그대로' : '움직임')
       + ', 기본 동작 막음 ' + e70.defaultPrevented + '/' + e70b.defaultPrevented);

  /* ── 71 칸 옮기기 Tab(B12) ── */
  var cp71 = firstCellPara();
  if (!cp71) {
    ok('71 칸 안 Tab 은 다음 칸으로', true, '표 없는 문서 — 건너뜀');
  } else {
    var cells71 = cp71._cell._obj.table.cells.slice().sort(function (a, b) { return a.r - b.r || a.c - b.c; });
    hwCaret.set(cells71[0].paras[0].id, 0, false);
    var len71 = cells71[0].paras[0].len;
    key('Tab');
    var q71 = hwCaret.para();
    var tabOk = cells71.length < 2 || (!!q71 && q71._cell === cells71[1]);
    key('Tab', { shift: true });
    var back71 = hwCaret.para();
    ok('71 칸 안 Tab 은 다음 칸, Shift+Tab 은 앞 칸(탭 글자 안 들어감)',
       tabOk && back71 === cells71[0].paras[0] && cells71[0].paras[0].len === len71,
       '칸 ' + cells71.length + '개, Tab → ' + (q71 && q71._cell ? 'r' + q71._cell.r + ' c' + q71._cell.c : '표 밖')
         + ', Shift+Tab → ' + (back71 && back71._cell ? 'r' + back71._cell.r + ' c' + back71._cell.c : '표 밖'));
  }

  /* ── 90 표 지우기(D1) — 도구줄 단추를 눌러서 ──
     ★ 지운 채로 끝낸다 — 최종 저장 요청을 --apply 에 먹이면 표 수가 하나 줄어야 한다. */
  var cp90 = firstCellPara();
  if (!cp90) {
    ok('90 표 지우기', true, '표 없는 문서 — 건너뜀');
  } else {
    var tob90 = cp90._cell._obj, tbl90 = tob90.table, host90 = hwModel.hostOf(tob90);
    var hostText90 = hwModel.text(host90).replace(/￼/g, ''), n90 = tableCount();
    var cellText90 = function () {
      var s = '';
      for (var ci = 0; ci < tbl90.cells.length; ci++)
        for (var cj = 0; cj < tbl90.cells[ci].paras.length; cj++) s += hwModel.text(tbl90.cells[ci].paras[cj]) + '|';
      return s;
    };
    var ct90 = cellText90();
    var has90 = function () { for (var i = 0; i < (host90.objs || []).length; i++) if (host90.objs[i].table === tbl90) return true; return false; };

    hwCaret.set(cp90.id, 0, false);
    var btn90 = document.querySelector('[data-tbl="delTable"]');
    if (btn90) btn90.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    ok('90 표 지우기 단추 — 표만 빠지고 둘레 글은 그대로, 캐럿은 표 자리',
       tableCount() === n90 - 1 && !has90() && hwModel.text(host90).replace(/￼/g, '') === hostText90 && hwCaret.at().id === host90.id,
       '표 ' + n90 + '→' + tableCount() + ', 캐럿 ' + hwCaret.at().id + (btn90 ? '' : ' (단추 없음)'));

    key('z', { ctrl: true });
    ok('90-1 Ctrl+Z 로 표와 칸 글이 돌아온다', tableCount() === n90 && has90() && cellText90() === ct90,
       '표 ' + tableCount() + ', 칸 글 ' + (cellText90() === ct90 ? '같음' : '다름'));

    key('z', { ctrl: true, shift: true });
    var ops90 = hwBuildOps(), rep90 = null;
    for (var o90 = 0; o90 < ops90.length; o90++) if (ops90[o90].id === host90.id) rep90 = ops90[o90];
    var left90 = false;
    for (var r90 = 0; rep90 && r90 < rep90.objs.length; r90++) if (rep90.objs[r90].oid === tob90.oid) left90 = true;
    ok('90-2 다시 지우면 부모 문단 요청에서 표가 빠진다', tableCount() === n90 - 1 && !!rep90 && !left90,
       rep90 ? (rep90.op + ' objs ' + rep90.objs.length + '개, 표 ' + (left90 ? '남음' : '빠짐')) : '부모 문단 요청 없음');
  }
}

/* 고친 것이 몇 개인지 C# 에 밀어 준다(8단계).

   ★ C# 이 물어볼 방법이 없다 — 스크립트 실행은 비동기인데 창을 닫는 순간에는 기다릴 수가 없다.
     그래서 바뀔 때마다 미리 보낸다.
   ★ 표 구조 요청도 같이 센다. 문단 dirty 만 보면 <b>행을 넣고 그냥 닫아도</b> 아무것도 안 묻는다 —
     표 편집은 hwInput.status() 를 안 지나가므로 알림을 그 한 곳에만 걸면 통째로 샌다. */
var hwDirtySent = -1;

function hwPostDirty() {
  if (!window.hwModel || !hwDoc) return;
  var n = hwModel.dirtyCount() + hwModel.tableOpCount();
  if (n === hwDirtySent) return;
  hwDirtySent = n;
  hwPost({ t: 'dirty', n: n });
}

/* C# 이 최근 연 문서 목록을 밀어 준다(8단계). 메뉴는 문서 안에 있으므로 목록도 여기서 그린다. */
function hwSetRecent(list) {
  var sel = document.getElementById('hwRecent');
  if (!sel) return;

  sel.innerHTML = '';
  var head = document.createElement('option');
  head.value = '';
  head.textContent = (list && list.length) ? '최근 문서' : '최근 문서 없음';
  sel.appendChild(head);

  for (var i = 0; i < (list || []).length; i++) {
    var o = document.createElement('option');
    o.value = list[i];
    o.textContent = list[i].replace(/^.*[\\/]/, '');   /* 파일 이름만 */
    o.title = list[i];
    sel.appendChild(o);
  }
  sel.selectedIndex = 0;
  sel.disabled = !(list && list.length);
}

/* 문서 전체 글자(표 칸까지). 되돌리기가 <b>전부</b> 되돌렸는지 보는 데 쓴다. */
function hwDocText() {
  var ps = hwModel.allParas(), out = [];
  for (var i = 0; i < ps.length; i++) out.push(hwModel.text(ps[i]));
  return out.join('');
}

/* 쪽 상자 밖으로 가장 많이 삐져나간 요소. PDF 쪽 수가 터질 때 범인을 지목한다. */
function hwWorstBox() {
  var pages = document.querySelectorAll('.hw-page');
  var worst = null, worstOver = 0;

  for (var i = 0; i < pages.length; i++) {
    var pr = pages[i].getBoundingClientRect();
    var kids = pages[i].querySelectorAll('*');
    for (var k = 0; k < kids.length; k++) {
      /* ★ 개체 조절점은 개체 모서리에 <b>걸쳐</b> 놓이므로 쪽 가장자리 개체에서는 반쯤 밖으로 나간다.
         인쇄에는 안 나가는 것(@media print 에서 숨긴다)이라 여기서 세면 없는 범인을 지목한다. */
      var kc = String(kids[k].className || '');
      if (kc.indexOf('hw-handle') >= 0 || kc.indexOf('hw-objsel') >= 0) continue;

      var r = kids[k].getBoundingClientRect();
      var over = Math.max(r.bottom - pr.bottom, r.right - pr.right, pr.top - r.top, pr.left - r.left);
      if (over > worstOver) {
        worstOver = over;
        worst = (kids[k].className || kids[k].tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)
              + ' @' + Math.round(r.left - pr.left) + ',' + Math.round(r.top - pr.top);
      }
    }
  }
  return worstOver > 1 ? (Math.round(worstOver) + 'px 넘침: ' + worst) : '없음';
}

/* 문서에서 처음 만나는 표 칸 문단. 표가 없으면 null. */
function firstCellPara() {
  for (var si = 0; si < hwDoc.sections.length; si++) {
    var paras = hwDoc.sections[si].paras;
    for (var pi = 0; pi < paras.length; pi++) {
      var objs = paras[pi].objs || [];
      for (var o = 0; o < objs.length; o++) {
        var t = objs[o].table;
        if (!t) continue;
        for (var c = 0; c < t.cells.length; c++)
          if (t.cells[c].paras.length) return t.cells[c].paras[0];
      }
    }
  }
  return null;
}

/* 화면에 놓인 그림이 다 받아졌는지. 한 장도 없으면 total 0 이다. */
function hwWaitImages() {
  var imgs = document.querySelectorAll('img.hw-obj-img');
  var jobs = [];

  for (var i = 0; i < imgs.length; i++) {
    (function (im) {
      if (im.complete) { jobs.push(Promise.resolve()); return; }
      jobs.push(new Promise(function (done) {
        im.addEventListener('load', done);
        im.addEventListener('error', done);
        setTimeout(done, 3000);
      }));
    })(imgs[i]);
  }

  return Promise.all(jobs).then(function () {
    var loaded = 0;
    for (var k = 0; k < imgs.length; k++) if (imgs[k].naturalWidth > 0) loaded++;
    return { total: imgs.length, loaded: loaded };
  });
}

/* 문단마다 줄 안 여러 자리에서 (우리 캐럿 x) - (그 글자의 실제 DOM x) 를 재서 가장 큰 값을 준다.
   단위는 화면 픽셀이다. 0 이어야 정상이고, 글자 폭만큼(12pt 면 16px) 나오면 한 글자가 밀린 것이다. */
function hwCaretDriftMax() {
  var worst = 0, worstAt = '';

  for (var pg = 0; pg < hwPages.length && pg < 3; pg++) {
    var lines = hwPages[pg].lines;
    for (var i = 0; i < lines.length; i++) {
      var it = lines[i], ln = it.line;
      var body = hwRenderer.bodyOf(it.pageIdx);
      if (!body) continue;

      var el = body.querySelector('.hw-line[data-id="' + it.para.id + '"][data-li="' + it.li + '"]');
      if (!el) continue;

      var br = body.getBoundingClientRect();
      var text = hwModel.text(it.para);

      for (var k = ln.s + 1; k < ln.e; k++) {
        /* 모델 인덱스와 DOM 조각 번호는 다르다 — 문단 안 줄바꿈과 안 그리는 컨트롤은
           자리는 차지해도 화면에는 아무것도 안 남긴다. */
        var domX = hwDomXOfChar(el, hwFlowIndex(it.para, ln.s, k));
        if (domX === null) continue;

        var c = hwCaret.coord(it.para.id, k);
        if (!c) continue;

        var d = Math.abs((br.left + hwHu2Px(c.xHu)) - domX);
        if (d > worst) {
          worst = d;
          var cs = hwModel.charShape(hwModel.shapeAt(it.para, k));
          worstAt = it.para.id + ' 줄' + it.li + ' 글자' + k
                  + ' "' + text.charAt(k) + '" cs=' + hwModel.shapeAt(it.para, k)
                  + ' size=' + cs.sizeHu + ' ratio=' + cs.ratio + ' sp=' + cs.spacing
                  + ' 우리=' + Math.round(hwHu2Px(c.xHu)) + 'px 화면=' + Math.round(domX - br.left) + 'px'
                  + ' 폭(우리/글꼴)=' + Math.round(hwBreak.charWidth(it.para, k, 0))
                  + '/' + Math.round(hwMeasure.naturalHu(text.charAt(k), cs));
        }
      }
    }
  }
  return { px: Math.round(worst * 10) / 10, at: worstAt, probe: hwDriftProbe() };
}

/* 첫 문단 첫 줄을 글자마다 대조해 어디서부터 갈리는지 본다. */
function hwDriftProbe() {
  var out = [];
  var p = hwDoc.sections[0].paras[0];
  var lines = hwLineIndex[p.id];
  if (!lines || !lines.length) return out;

  var it = lines[0], ln = it.line;
  var body = hwRenderer.bodyOf(it.pageIdx);
  if (!body) return out;

  var el = body.querySelector('.hw-line[data-id="' + p.id + '"][data-li="' + it.li + '"]');
  if (!el) return out;

  var br = body.getBoundingClientRect();
  var text = hwModel.text(p);
  var nth = 0;

  for (var k = ln.s; k < ln.e && out.length < 10; k++) {
    var ch = text.charAt(k);
    var cs = hwModel.charShape(hwModel.shapeAt(p, k));
    var cw = hwBreak.charWidth(p, k, 0);
    var dom = hwDomXOfChar(el, nth);
    var c = hwCaret.coord(p.id, k);

    out.push({
      k: k, ch: ch, nth: nth,
      our: c ? Math.round(hwHu2Px(c.xHu) * 10) / 10 : -1,
      dom: dom === null ? -1 : Math.round((dom - br.left) * 10) / 10,
      cw: Math.round(cw), nat: Math.round(hwMeasure.naturalHu(ch, cs)), size: cs.sizeHu
    });

    nth = hwFlowIndex(p, ln.s, k + 1);
  }
  return out;
}

/* 줄 안에서 k 번째 글자가 <b>화면 DOM 으로는</b> 몇 번째 조각인가.
   ★ 자리는 차지해도 화면에 안 남는 것이 있다 — 문단 안 줄바꿈, 안 그리는 컨트롤,
     그리고 떠 있는 개체(줄 밖에 절대 좌표로 놓인다). 이걸 안 빼면 대조가 통째로 밀린다. */
function hwFlowIndex(para, from, k) {
  var text = hwModel.text(para);
  var n = 0;
  for (var j = from; j < k; j++) {
    var ch = text.charAt(j);
    if (ch === '\n') continue;
    if (ch === '￼') {
      var o = null;
      for (var i = 0; i < (para.objs || []).length; i++) if (para.objs[i].pos === j) { o = para.objs[i]; break; }
      if (!o || o.hidden || !o.inline || (o.wHu || 0) <= 0) continue;
    }
    n++;
  }
  return n;
}

function hwCaretDrift() {
  var r = hwCaretDriftMax();
  return r.px + 'px @ ' + (r.at || '-');
}

/* 줄 DOM 안에서 n 번째 글자의 왼쪽 화면 좌표. 개체는 한 글자로 센다. */
function hwDomXOfChar(lineEl, n) {
  var r = hwDomRectOfChar(lineEl, n);
  return r ? r.left : null;
}

/* 줄 DOM 안에서 n 번째 글자의 화면 사각형. 정렬 검사가 줄 끝 글자의 오른쪽 끝을 볼 때 쓴다. */
function hwDomRectOfChar(lineEl, n) {
  var at = 0;

  for (var ci = 0; ci < lineEl.childNodes.length; ci++) {
    var kid = lineEl.childNodes[ci];

    var cls = kid.nodeType === 1 ? String(kid.className || '') : '';

    /* 줄 밖에 절대 좌표로 놓인 개체는 흐름에 없다 — 세면 그 뒤가 통째로 밀린다. */
    if (kid.nodeType === 1 && kid.style && kid.style.position === 'absolute') continue;

    if (cls.indexOf('hw-obj') >= 0 || cls.indexOf('hw-gap') >= 0) {
      if (at === n) return kid.getBoundingClientRect();
      at++;
      continue;
    }

    var texts = kid.nodeType === 3 ? [kid] : textNodesIn(kid);
    for (var t = 0; t < texts.length; t++) {
      var node = texts[t];
      if (at + node.length > n) {
        var r = document.createRange();
        r.setStart(node, n - at);
        r.setEnd(node, n - at + 1);
        return r.getBoundingClientRect();
      }
      at += node.length;
    }
  }
  return null;

  function textNodesIn(el) {
    var out = [];
    for (var i = 0; i < el.childNodes.length; i++) {
      var c = el.childNodes[i];
      if (c.nodeType === 3) out.push(c);
      else if (c.nodeType === 1) out = out.concat(textNodesIn(c));
    }
    return out;
  }
}

/* --ui-test 가 넣을 그림 경로와 미리보기 주소를 C# 이 미리 꽂아 둔다. */
var hwUiTestImage = '';
var hwUiTestSrc = '';

/* C# 이 눌러 주는 "테스트" 버튼. 사람 손 없이 ping 왕복을 태운다. */
function hwFirePing() {
  hwPingSeq += 1;
  hwPost({ t: 'ping', n: hwPingSeq });
}

/* ── PDF 내보내기(7단계) ─────────────────────────────────────
   C# 이 인쇄 직전에 부른다. 가상 스크롤을 끄고 모든 쪽을 채운 뒤 준비됐다고 알린다 —
   ★ 이걸 안 하면 화면 밖 쪽이 빈 채로 PDF 에 나간다(보이는 ±2쪽만 내용이 있다). */
function hwPrintPrepare() {
  /* ★ 여기서 바로 던져도 printReady 는 보낸다(아래 catch 와 같은 이유) — C# 은 그걸 받아야
     "PDF 를 만드는 중" 을 푼다. 안 보내면 그 창에서는 다시 PDF 를 못 뽑는다. */
  try { hwRenderer.fillAll(true); }
  catch (e0) { hwPost({ t: 'printReady', pages: hwPageCount(), err: String(e0 && e0.message ? e0.message : e0) }); return; }
  /* 그림·글꼴이 다 붙은 다음에 찍어야 한다. */
  hwWaitImages().then(function () {
    return (document.fonts && document.fonts.ready) ? document.fonts.ready : null;
  }).then(function () {
    /* ★ 인쇄 직전의 실제 문서 크기를 같이 보낸다. 쪽 수가 터질 때 원인이 "우리 쪽 상자" 인지
       "그 밖으로 삐져나간 것" 인지는 이 숫자로만 갈린다. */
    var body = document.body, canvas = document.getElementById('hwCanvas');
    hwPost({
      t: 'printReady', pages: hwPageCount(),
      bodyH: Math.round(body.scrollHeight), bodyW: Math.round(body.scrollWidth),
      canvasH: canvas ? Math.round(canvas.scrollHeight) : 0,
      canvasW: canvas ? Math.round(canvas.scrollWidth) : 0,
      pageH: Math.round(document.querySelector('.hw-page') ? document.querySelector('.hw-page').offsetHeight : 0),
      worst: hwWorstBox()
    });
  })['catch'](function (e) {
    /* ★ 무슨 일이 나도 printReady 는 <b>보낸다</b>. 안 보내면 C# 이 인쇄를 시작 못 하고
       시한이 다 찰 때까지 서 있는데, 화면에는 아무 표시도 안 뜬다. */
    hwPost({ t: 'printReady', pages: hwPageCount(), err: String(e && e.message ? e.message : e) });
  });
}

function hwPrintDone() {
  hwRenderer.fillAll(false);
}

/* ── 저장(계획 6절) ─────────────────────────────────────────
   편집마다 보내지 않는다. 저장할 때 <b>고친 문단과 구조 변경만</b> 모아 한 번에 올린다. */

function hwSave(saveAs) {
  if (!hwDoc) { hwSetStatus({ text: '문서를 먼저 여세요' }); return; }

  var ops = hwBuildOps();
  hwPost({
    t: 'save', rev: hwDoc.rev || 1, saveAs: !!saveAs,
    /* ★ 모양 목록을 통째로 같이 보낸다. 화면이 새로 만든 모양이 뒤에 붙어 있고,
       문서 쪽은 그중 이미 있는 것은 다시 쓰고 없는 것만 등록한다(G-10). */
    charShapes: hwDoc.charShapes, paraShapes: hwDoc.paraShapes,
    ops: ops
  });
  /* ★ 표에 넣은 새 칸에 친 글자는 이번 저장에 안 실린다 — 문서 쪽이 그 칸을 새로 만들기 때문이다.
     조용히 사라지면 안 되므로 몇 자가 빠지는지 알린다. */
  var lost = hwModel.droppedChars();
  hwSetStatus({
    text: (saveAs ? '다른 이름으로 저장 중… ' : '저장 중… ') + 'op ' + ops.length + '개'
        + (lost ? ' · 새 표 칸에 친 ' + lost + '자는 다시 읽으면 사라집니다' : '')
  });
}

/* C# 의 응답. ok 여야 dirty 를 비운다 — 실패했는데 비우면 고친 것이 조용히 사라진다. */
function hwSaved(r) {
  if (!r || !r.ok) {
    hwSetStatus({ text: '저장 실패' + (r && r.msg ? ': ' + r.msg : '') });
    return;
  }

  /* ★ 표 구조를 바꿨으면 C# 이 문서를 다시 읽어 보낸다 — 여기서는 아무것도 안 만진다.
     표를 다시 세우면 셀 문단이 전부 새 객체라, 우리가 들고 있는 id 로는 다음 편집을 못 되쓴다. */
  if (r.reload) {
    /* ★ 다시 읽기 전에 <b>먼저</b> 비운다. 요청은 이미 파일에 반영됐는데, 되읽기가 실패하면
       (mdiHwpEditor 가 예외를 잡고 알림만 띄운다) 화면에는 그 요청이 그대로 남아 다음 Ctrl+S 가
       같은 행을 <b>한 번 더</b> 넣는다 — 실패 하나가 문서를 더 망가뜨리는 쪽으로 번진다. */
    hwModel.accept(r);
    hwPostDirty();
    hwSetStatus({ text: '저장함(표 구조가 바뀌어 다시 읽습니다) — ' + (r.path || '') });
    return;
  }

  hwModel.accept(r);
  if (r.path) hwDoc.path = r.path;
  if (r.rev) hwDoc.rev = r.rev;

  hwSetStatus({ text: '저장함 — ' + (r.path || '') });
  hwPostDirty();
  hwRelayout();
  hwCaret.paint();
}

/* ── 문서 → C# ───────────────────────────────────────────── */

var hwPingSeq = 0;

document.addEventListener('DOMContentLoaded', function () {
  var menu = document.getElementById('hwMenu');
  if (menu) {
    /* 캐럿 초점을 안 뺏는다. ★ 단 콤보 위에서는 막으면 안 된다 — Chromium 은 mousedown 의
       기본 동작으로 목록을 펼치므로, 막으면 눌러도 아무 일이 안 일어난다(T0 과 같은 자리다). */
    menu.addEventListener('mousedown', function (e) {
      var tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
      if (tag === 'SELECT' || tag === 'OPTION') return;
      e.preventDefault();
    });

    var rec = document.getElementById('hwRecent');
    if (rec) rec.addEventListener('change', function () {
      var path = rec.value;
      rec.selectedIndex = 0;              /* 다음에도 고를 수 있게 머리로 되돌린다 */
      hwInput.focus();
      if (path) hwPost({ t: 'menu', cmd: 'openRecent', path: path });
    });
    menu.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.hw-menu-item') : null;
      if (!btn) return;
      if (btn.id === 'hwBtnPing') {
        hwPingSeq += 1;
        hwPost({ t: 'ping', n: hwPingSeq });
        return;
      }
      if (btn.id === 'hwBtnOracle') {
        if (!hwDoc) { hwSetStatus({ text: '문서를 먼저 여세요' }); return; }
        var r = hwOracleCheck();
        hwSetStatus({ text: '오라클 ' + r.match + '/' + r.total + ' (' + r.rate + '%) · '
                          + r.pages + '쪽 ' + r.lines + '줄 · y오차 평균 ' + r.dyAvg + ' 최대 ' + r.dyMax });
        hwPost({ t: 'oracle', r: r });
        return;
      }

      var cmd = btn.getAttribute('data-cmd');
      if (cmd === 'save') { hwSave(false); return; }
      if (cmd === 'pdf') {
        if (!hwDoc) { hwSetStatus({ text: '문서를 먼저 여세요' }); return; }
        var pg = hwDoc.sections.length ? hwDoc.sections[0].page : null;
        hwPost({ t: 'menu', cmd: 'pdf', wHu: pg ? pg.wHu : 59528, hHu: pg ? pg.hHu : 84188 });
        return;
      }
      if (cmd === 'saveAs') { hwSave(true); return; }
      if (cmd === 'find') { hwFind.open(true); return; }
      if (cmd) hwPost({ t: 'menu', cmd: cmd });
    });
  }

  hwInput.init();
  hwUi.init();
  hwFind.init();
  hwBridge.flush();
  hwPost({ t: 'ready', ver: '0.4' });
});
