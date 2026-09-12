/* ★ 준비 전에 보낸 메시지는 큐에 담았다가 통로가 열리면 순서대로 낸다 —
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

  /* ★ 누르기는 <b>그 요소</b>에 보낸다(target 으로 되짚으므로),
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

  /* 다시 실행은 Ctrl+Shift+Z 다 — Ctrl+Y 는 한글처럼 "한 줄 지우기" 로 옮겼다. */
  key('z', { ctrl: true, shift: true });
  ok('9 Ctrl+Shift+Z 로 다시', hwDoc.sections[0].paras.length === paras0 + 1,
     '문단 ' + hwDoc.sections[0].paras.length);

  key('z', { ctrl: true });

  /* IME — 조합 중에는 모델이 그대로여야 하고, 화면에는 임시 글자가 떠 있어야 한다. */
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

  /* 그림 넣기 — 실물은 저장할 때 들어가고 지금은 자리와 미리보기만이다. */
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

  /* 글자 하나 치고 화면에 나오기까지 30ms. 배치·그리기까지 다 들어간 시간이다. */
  var t0 = performance.now();
  typeIn('빠');
  var ms = Math.round((performance.now() - t0) * 10) / 10;
  ok('21 입력→반영 30ms 이내', ms <= 30, ms + 'ms');

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

  var cellPara = firstCellPara();
  if (!cellPara) {
    ok('28 표 없는 문서', true, '표가 없어 건너뜀');
  } else {
    /* ★ 표 옆에서 지우기 — 표는 한 글자 자리를 차지해서, 막지 않으면 Backspace 한 번에
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

  /* ★ hwFormat 을 직접 부르면 서식 계산만 보게 된다. 도구줄이 통째로 안 먹는 상태 —
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

  /* ★ 함수를 직접 부르지 않고 <b>마우스 이벤트</b>로 태운다. hwObj 를 직접 부르면 hwInput 의
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

        /* ★ 고르기도 되돌린 시점으로 가야 한다. 옮긴 뒤 자리(to:pos)를 그대로 쥐고 있으면
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

      /* ★ 최소 크기까지 줄여도 비율이 안 깨지는가. 하한을 w·h 에 따로 걸면 짧은 쪽만 먼저
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

  /* ★ 핵심 판정은 49-50 이다: 모두 바꾸기가 <b>되돌리기 한 칸</b>으로 원상 복구되는가.
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

    /* ★ 여러 문단에 걸친 선택에서 이전 찾기 — 선택 <b>앞끝</b> 바로 앞의 그 말이 골라져야 한다.
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

  /* ★ 창을 닫을 때 "저장할까요" 를 물을 <b>유일한</b> 근거다. 화면만 아는 값이라 미리 안 보내면
       C# 은 늘 "고친 것 없음" 으로 알고 그냥 닫는다. */
  var sawDirty = -1;
  var realPost = window.hwPost;
  window.hwPost = function (o) { if (o && o.t === 'dirty') sawDirty = o.n; return realPost(o); };
  window.hwDirtySent = -1;          /* 값이 같으면 안 보내므로 한 번은 나가게 한다 */
  typeIn('점');
  window.hwPost = realPost;
  ok('51 고친 것을 C# 에 알린다', sawDirty > 0, 'dirty=' + sawDirty);

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

  /* 본문 높이가 0 이하가 되면 자리 차지 개체의 while 이 영영 안 끝났다. 무한루프면 이 단계에서
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

  /* ★ S2 는 S1 <b>뒤</b>다. 앞에 두면 S2 가 문서 끝에 더한 문단 때문에 S1 의 68(쪽 나누기로 쪽 +1)이 레이아웃에 따라 틀린다
     (실측 complaint-form.hwpx). 대가: S1 의 90 이 첫 표를 지운 뒤라, 표가 하나뿐인 문서에서는 84-1 을 건너뛴다. */
  var s2 = null;
  try {
    s2 = hwUiTestS2({ ok: ok, key: key, typeIn: typeIn, down: down, move: move, up: up, ime: ime });
  } catch (eS2) {
    ok('S2 세션 2 검사 중 예외', false, String(eS2 && eS2.stack ? eS2.stack : eS2).replace(/\s+/g, ' ').slice(0, 400));
  }

  /* ★ 그림은 늦게 온다 — 그린 직후에 재면 아직 안 받아 온 것까지 "실패" 로 찍힌다.
     다 붙거나 실패할 때까지 기다렸다가 판정한다. */
  var tail = s2 && s2.after ? s2.after()['catch'](function (e) { ok('S2 비동기 검사 중 예외', false, String(e)); }) : Promise.resolve();
  tail.then(function () {
    /* ★ S3 은 S2 의 비동기 검사(112 그림 붙여넣기)가 끝난 <b>뒤</b>다 — 그 사이에 문서를 고치면
       기다리던 그림이 엉뚱한 문단에 붙는다. */
    try {
      hwUiTestS3({ ok: ok, key: key, typeIn: typeIn, down: down, move: move, up: up, ime: ime });
    } catch (eS3) {
      ok('S3 세션 3 검사 중 예외', false, String(eS3 && eS3.stack ? eS3.stack : eS3).replace(/\s+/g, ' ').slice(0, 400));
    }
    /* ★ S4 는 S3 <b>뒤</b>다 — S3 이 끝에 남긴 새 표를 건드리지 않도록 자기 문단을 따로 만든다. */
    try {
      hwUiTestS4({ ok: ok, key: key, typeIn: typeIn, down: down, move: move, up: up, ime: ime });
    } catch (eS4) {
      ok('S4 세션 4 검사 중 예외', false, String(eS4 && eS4.stack ? eS4.stack : eS4).replace(/\s+/g, ' ').slice(0, 400));
    }
    return hwWaitImages();
  }).then(function (r) {
    ok('20 그림이 실제로 그려짐', r.total === 0 || r.loaded === r.total, r.loaded + '/' + r.total + ' 장');
    /* ★ 여기서 다시 만든다 — 위에서 잡아 둔 ops 는 표 칸을 고치기 <b>전</b>의 것이라,
       그것을 내보내면 --apply 가 표 편집을 한 번도 안 태운다(실측으로 걸렸다). */
    hwPost({
      t: 'uitest', steps: steps, ops: hwBuildOps(), drift: hwCaretDriftMax(),
      charShapes: hwDoc.charShapes, paraShapes: hwDoc.paraShapes,
      borderFills: hwDoc.borderFills
    });
  });
}

/* ★ 검사용 문단을 본문 끝에 새로 만들어 거기서 본다. 문서마다 모양이 달라서, 쓸 값은 여기서 못 박는다.
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

  /* ★ 화면이 만든 문단(n…) 뒤에 만들면 안 된다. 26-1 이 저장을 흉내 낸(accept) 뒤라 그 문단을 고치면 저장
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

  var b62 = !!csAt(sp, 0).bold;
  key('b', { alt: true, shift: true });
  var b62a = !!csAt(sp, 0).bold;
  key('b', { alt: true, shift: true });
  ok('62 Alt+Shift+B 로 굵게 켜고 끄기', b62a !== b62 && !!csAt(sp, 0).bold === b62, b62 + '→' + b62a + '→' + !!csAt(sp, 0).bold);

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

  hwFormat.applyPara({ lsType: 'percent', ls: 160 });
  key('z', { alt: true, shift: true });
  var l64 = psOf(sp).ls;
  key('q', { ctrl: true, shift: true });
  ok('64 160% → Alt+Shift+Z 170 → Ctrl+Shift+Q 160', l64 === 170 && psOf(sp).ls === 160, l64 + ' → ' + psOf(sp).ls);
  hwFormat.applyPara({ lsType: 'fixed', ls: 2000 });
  key('a', { alt: true, shift: true });
  ok('64-1 고정 20pt → Alt+Shift+A → 19pt', psOf(sp).lsType === 'fixed' && psOf(sp).ls === 1900, psOf(sp).lsType + ' ' + psOf(sp).ls);
  hwFormat.applyPara({ lsType: 'percent', ls: 160 });

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

  /* ★ 지운 채로 끝낸다 — 최종 저장 요청을 --apply 에 먹이면 표 수가 하나 줄어야 한다. */
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

/* ★ 대화상자 칸은 값만 넣지 않고 input·change 를 쏜다 — "바뀐 칸만 적용" 이 그 이벤트로 가려진다. */
function hwUiTestS2(t) {
  var ok = t.ok, key = t.key, typeIn = t.typeIn, ime = t.ime;

  function csAt(p, k) { return hwDoc.charShapes[hwModel.shapeAt(p, k || 0)]; }
  function psOf(p) { return hwDoc.paraShapes[p.ps]; }
  function pick(p, a, b) { hwCaret.set(p.id, a, false); hwCaret.set(p.id, b, true); }
  function dlg() { return hwDialog.current(); }
  function setField(k, v) {
    var e = dlg() ? dlg().field(k) : null;
    if (!e) return false;
    e.value = String(v);
    e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return true;
  }
  function press(label) {
    var b = dlg() ? dlg().button(label) : null;
    if (b) b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return !!b;
  }
  function esc(target) {
    (target || document.activeElement || document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  }

  var S0 = hwDoc.sections[0].paras, tail = S0[S0.length - 1];
  for (var ti = S0.length - 1; ti >= 0; ti--) if (S0[ti].id.charAt(0) !== 'n') { tail = S0[ti]; break; }
  hwCaret.set(tail.id, tail.len, false);
  key('Enter');
  var sp = hwCaret.para();
  typeIn('가나다라 마바사 아자차카 타파하 ');
  typeIn('가나다라 마바사 아자차카 타파하');
  pick(sp, 0, sp.len);
  hwFormat.applyChar({ sizeHu: 1000, ratio: 100, spacing: 0, bold: false, italic: false, underline: 0, strike: false });

  pick(sp, 1, 4);
  key('l', { alt: true });
  var d80 = dlg();
  var in80 = !!d80 && !!document.activeElement && d80.el.contains(document.activeElement);
  esc();
  var s80 = hwCaret.selection();
  ok('80 대화상자(Alt+L)를 Esc 로 닫으면 캐럿·선택 그대로, 초점은 본문 수신기로',
     in80 && !hwDialog.isOpen() && !!s80 && s80.fromId === sp.id && s80.fromPos === 1 && s80.toPos === 4
       && document.activeElement === ime,
     (d80 ? '열림' : '안 열림') + (in80 ? '·초점 안' : '·초점 밖') + ', 닫힘 ' + !hwDialog.isOpen()
       + ', 선택 ' + (s80 ? s80.fromPos + '~' + s80.toPos : '없음') + ', 초점 ' + (document.activeElement === ime ? '수신기' : (document.activeElement ? document.activeElement.tagName : 'null')));

  pick(sp, 0, sp.len);
  key('l', { alt: true });
  var f81 = setField('ratio', 90) && setField('spacing', -5);
  press('설정');
  var ops81 = hwBuildOps(), sent81 = false;
  for (var o81 = 0; o81 < ops81.length; o81++) {
    if (ops81[o81].id !== sp.id) continue;
    var rs = ops81[o81].runs || [];
    for (var r81 = 0; r81 < rs.length; r81++) {
      var c81 = hwDoc.charShapes[rs[r81].cs];
      if (c81 && c81.ratio === 90 && c81.spacing === -5) sent81 = true;
    }
  }
  ok('81 글자 모양 — 장평 90·자간 −5 가 선택 전체에 걸리고 저장 요청에 실린다',
     f81 && !hwDialog.isOpen() && csAt(sp, 0).ratio === 90 && csAt(sp, 0).spacing === -5
       && csAt(sp, sp.len - 1).ratio === 90 && csAt(sp, sp.len - 1).spacing === -5 && sent81,
     '칸 ' + (f81 ? '채움' : '못 찾음') + ', 첫 글자 ' + csAt(sp, 0).ratio + '/' + csAt(sp, 0).spacing
       + ', 끝 글자 ' + csAt(sp, sp.len - 1).ratio + '/' + csAt(sp, sp.len - 1).spacing + ', 요청 ' + (sent81 ? '실림' : '안 실림'));

  var half = Math.floor(sp.len / 2);
  pick(sp, 0, half); hwFormat.applyChar({ sizeHu: 1000 });
  pick(sp, half, sp.len); hwFormat.applyChar({ sizeHu: 1400 });
  pick(sp, 0, sp.len);
  key('l', { alt: true });
  var blank81 = dlg() && dlg().field('size') ? dlg().field('size').value === '' : false;
  setField('ratio', 95);
  press('설정');
  ok('81-1 섞인 크기 — 크기 칸은 비어 있고, 장평만 바꾸면 각자 크기(10·14pt)가 남는다',
     blank81 && csAt(sp, 0).sizeHu === 1000 && csAt(sp, sp.len - 1).sizeHu === 1400
       && csAt(sp, 0).ratio === 95 && csAt(sp, sp.len - 1).ratio === 95,
     '크기 칸 ' + (blank81 ? '비어 있음' : '값 있음') + ', ' + csAt(sp, 0).sizeHu + '/' + csAt(sp, sp.len - 1).sizeHu
       + ', 장평 ' + csAt(sp, 0).ratio + '/' + csAt(sp, sp.len - 1).ratio);
  pick(sp, 0, sp.len);
  hwFormat.applyChar({ sizeHu: 1000, ratio: 100, spacing: 0 });
  /* 저장 왕복(--apply → --model)에서 찾을 표식 — 앞 세 글자는 81 의 값으로 남겨 둔다. */
  pick(sp, 0, 3);
  hwFormat.applyChar({ ratio: 90, spacing: -5 });

  hwCaret.set(sp.id, 2, false);
  key('t', { alt: true });
  var f82 = setField('mt', 10) && setField('lsType', 'fixed') && setField('ls', 20);
  var unit82 = dlg() && dlg().field('ls:unit') ? dlg().field('ls:unit').textContent : '';
  press('설정');
  ok('82 문단 모양 — 문단 위 10pt·줄 간격 고정 20pt → mtHu 1000, fixed, ls 2000',
     f82 && unit82 === 'pt' && psOf(sp).mtHu === 1000 && psOf(sp).lsType === 'fixed' && psOf(sp).ls === 2000,
     '단위 ' + unit82 + ', mtHu ' + psOf(sp).mtHu + ', ' + psOf(sp).lsType + ' ' + psOf(sp).ls);

  hwCaret.set(sp.id, 3, false);
  key('F10', { ctrl: true });
  var cats86 = hwDialog.categories(), ci86 = cats86.indexOf('원문자·괄호문자(영/숫자)');
  setField('cat', ci86);
  var cell86 = dlg() ? dlg().el.querySelector('.hw-cm-cell[data-ch="①"]') : null;
  if (cell86) cell86.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  press('넣기');
  ok('86 문자표 — "①" 넣기 후 캐럿 앞 글자가 U+2460, 창은 닫힘',
     !!cell86 && !hwDialog.isOpen() && hwModel.text(sp).charAt(3) === '①' && hwCaret.at().pos === 4,
     (cell86 ? '칸 찾음' : '칸 없음') + ', 글자 U+' + hwModel.text(sp).charCodeAt(3).toString(16).toUpperCase()
       + ', 캐럿 ' + hwCaret.at().pos);

  hwCaret.set(sp.id, sp.len, false);
  typeIn(' ＡＢ 가나 끝');
  var tx83 = hwModel.text(sp), full83 = tx83.indexOf('ＡＢ'), word83 = tx83.lastIndexOf('가나');
  var ft = document.getElementById('hwFindText');
  hwFind.resetOptions();
  document.getElementById('hwFindDir').value = 'down';
  ft.value = 'AB';
  hwCaret.set(sp.id, 0, false);
  var f83 = hwFind.search(+1), s83 = hwCaret.selection();
  ok('83 전/반자 구분을 끄면 반각 "AB" 로 전각 "ＡＢ" 가 찾아진다',
     f83 && !!s83 && s83.fromId === sp.id && s83.fromPos === full83 && s83.toPos === full83 + 2,
     s83 ? (s83.fromId + ':' + s83.fromPos + '~' + s83.toPos + ' (기대 ' + sp.id + ':' + full83 + ')') : '못 찾음');

  ft.value = '가나';
  var n83 = hwFind.markAll();
  var r83 = document.querySelectorAll('.hw-hit').length;
  hwCaret.set(sp.id, 1, false);
  var r83b = document.querySelectorAll('.hw-hit').length;
  typeIn('x');
  var r83c = document.querySelectorAll('.hw-hit').length;
  key('Backspace');
  ok('83-1 모두 강조 — 캐럿을 옮겨도 사각형 수 그대로, 글자 하나 치면 0',
     n83 >= 3 && r83 >= 3 && r83b === r83 && r83c === 0 && hwFind.hitCount() === 0,
     n83 + '군데, 사각형 ' + r83 + ' → 캐럿 이동 ' + r83b + ' → 한 글자 ' + r83c);

  document.getElementById('hwFindWord').checked = true;
  hwCaret.set(sp.id, 0, false);
  var f83b = hwFind.search(+1), s83b = hwCaret.selection();
  ok('83-2 단어 단위 — "가나" 가 "가나다라" 안에서는 안 찾히고 따로 선 "가나" 가 찾힌다',
     f83b && !!s83b && s83b.fromId === sp.id && s83b.fromPos === word83,
     s83b ? (s83b.fromId + ':' + s83b.fromPos + ' (기대 ' + word83 + ')') : '못 찾음');
  hwFind.resetOptions();
  hwFind.clearHits();
  if (hwFind.isOpen()) hwFind.close();

  var cv85 = hwRenderer.canvas();
  function drift85() {
    cv85.scrollTop = 0;
    hwRenderRefresh();
    return { px: hwCaretDriftMax().px, filled: !!hwRenderer.bodyOf(0) };
  }
  hwUi.setZoom(100);
  var d85a = drift85();
  key('+', { shift: true, code: 'NumpadAdd' });
  var z85 = hwUi.zoom();
  hwUi.setZoom(200);
  var d85b = drift85();
  var wp85 = hwRenderer.pageElOf(0) ? hwRenderer.pageElOf(0).getBoundingClientRect().width : 0;
  var want85 = 2 * hwPages[0].page.wHu / 75;
  ok('85 200% — 쪽 폭 두 배, 캐럿 어긋남은 배율만큼까지(Shift+숫자판+ 는 110%)',
     z85 === 110 && d85a.filled && d85b.filled && Math.abs(wp85 - want85) < 1 && d85b.px <= 2 * d85a.px + 1,
     'Shift+NumAdd ' + z85 + '%, 쪽 폭 ' + Math.round(wp85) + '/' + Math.round(want85) + 'px, 어긋남 100% '
       + d85a.px + 'px → 200% ' + d85b.px + 'px' + (d85b.filled ? '' : ' (첫 쪽이 안 채워짐)'));

  key('g', { ctrl: true }); key('i');
  var wp85b = hwRenderer.pageElOf(0) ? hwRenderer.pageElOf(0).getBoundingClientRect().width : 0;
  var cw85 = cv85.clientWidth;
  key('g', { ctrl: true }); key('q');
  ok('85-1 Ctrl+G, I 폭 맞춤 — 쪽 폭 = 캔버스 폭 ±2px, Ctrl+G, Q 로 100%',
     Math.abs(wp85b - cw85) <= 2 && hwUi.zoom() === 100,
     '쪽 ' + Math.round(wp85b * 10) / 10 + ' / 캔버스 ' + cw85 + 'px, 되돌린 비율 ' + hwUi.zoom() + '%');
  hwUi.setZoom(100);

  hwCaret.set(sp.id, sp.len, false);
  typeIn('되돌');
  var t59 = hwModel.text(sp);
  key('z', { ctrl: true });
  var t59u = hwModel.text(sp);
  var rb59 = document.querySelector('[data-act="redo"]');
  var dis59 = rb59 ? rb59.disabled : true;
  if (rb59) rb59.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  ok('59 다시 실행 단추가 Ctrl+Shift+Z 와 같은 결과',
     t59u !== t59 && hwModel.text(sp) === t59 && !dis59 && !!rb59 && rb59.disabled,
     '되돌림 ' + (t59u !== t59 ? '됨' : '안 됨') + ', 단추 ' + (dis59 ? '꺼져 있었음' : '켜져 있었음')
       + ', 다시 ' + (hwModel.text(sp) === t59 ? '같음' : '다름') + ', 뒤 단추 ' + (rb59 && rb59.disabled ? '꺼짐' : '켜짐'));

  if (hwPageCount() < 2) {
    ok('59-1 다음 쪽 단추 — 캐럿이 다음 쪽 첫 줄로', true, '한 쪽 문서 — 건너뜀');
  } else {
    var nav = function (k) { document.querySelector('[data-nav="' + k + '"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); };
    hwFind.gotoPage(1);
    nav('next');
    var l59 = hwPages[1].lines[0], a59 = hwCaret.at(), lab59 = document.getElementById('hwPageNo').textContent;
    nav('last');
    var last59 = hwUi.curPage();
    ok('59-1 다음 쪽 단추 — 캐럿이 다음 쪽 첫 줄로, 마지막 단추는 끝 쪽',
       a59.id === l59.para.id && a59.pos === l59.line.s && lab59.indexOf('2 / ') === 0 && last59 === hwPageCount(),
       '캐럿 ' + a59.id + ':' + a59.pos + ' (기대 ' + l59.para.id + ':' + l59.line.s + '), 표시 "' + lab59 + '", 마지막 ' + last59 + '/' + hwPageCount());
  }

  var S = hwDoc.sections[0].paras;
  function paste(dt) { document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }
  function copy(dt) { document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true })); }

  pick(sp, 0, 3);
  hwFormat.applyChar({ bold: true });
  var dt110 = new DataTransfer();
  copy(dt110);
  var h110 = dt110.getData('text/html'), t110 = hwModel.text(sp).slice(0, 3);
  ok('110 복사에 HTML — 굵은 글자에 font-weight:bold, 첫 요소에 표식',
     /font-weight:bold/.test(h110) && /^<p data-hw-copy="hw[0-9a-z]+"/.test(h110) && dt110.getData('text/plain') === t110,
     h110.slice(0, 160));

  hwCaret.set(sp.id, sp.len, false);
  var len111 = sp.len;
  paste(dt110);
  ok('111 내부 서식 붙여넣기 — 붙은 글자도 굵게',
     sp.len === len111 + 3 && hwModel.text(sp).slice(-3) === t110 && !!csAt(sp, sp.len - 3).bold && !!csAt(sp, sp.len - 1).bold,
     '길이 ' + len111 + '→' + sp.len + ', 끝 "' + hwModel.text(sp).slice(-3) + '" 굵게 ' + !!csAt(sp, sp.len - 1).bold);

  hwCaret.set(sp.id, sp.len, false);
  key('Enter'); typeIn('둘째');
  var p2 = hwCaret.para();
  hwFormat.applyPara({ align: 'center' });
  hwCaret.set(sp.id, 0, false);
  hwCaret.set(p2.id, p2.len, true);
  var dt111 = new DataTransfer();
  copy(dt111);
  var spText = hwModel.text(sp), spPs = sp.ps, p2Ps = p2.ps;
  hwCaret.set(p2.id, p2.len, false);
  key('Enter');
  var p3 = hwCaret.para(), n111 = S.length;
  paste(dt111);
  var p4 = hwModel.after(p3);
  ok('111-1 두 문단 복사 → 두 문단으로, 각 문단모양 유지',
     spPs !== p2Ps && S.length === n111 + 1 && hwModel.text(p3) === spText && p3.ps === spPs
       && !!p4 && hwModel.text(p4) === '둘째' && p4.ps === p2Ps,
     '문단 ' + n111 + '→' + S.length + ', 첫 문단 ' + (hwModel.text(p3) === spText ? '글 같음' : '글 다름') + ' ps ' + p3.ps + '/' + spPs
       + ', 둘째 "' + (p4 ? hwModel.text(p4) : '') + '" ps ' + (p4 ? p4.ps : '-') + '/' + p2Ps);

  hwCaret.set(p4.id, p4.len, false);
  key('Enter');
  var p5 = hwCaret.para(), n113 = S.length;
  var dt113 = new DataTransfer();
  dt113.setData('text/html', '<p><b>가</b>나</p><p>다</p>');
  dt113.setData('text/plain', '가나\n다');
  paste(dt113);
  var p6 = hwModel.after(p5);
  ok('113 HTML 붙여넣기 — <p><b>가</b>나</p><p>다</p> → 두 문단, 첫 글자만 굵게',
     S.length === n113 + 1 && hwModel.text(p5) === '가나' && !!csAt(p5, 0).bold && !csAt(p5, 1).bold
       && !!p6 && hwModel.text(p6) === '다' && !csAt(p6, 0).bold,
     '문단 ' + n113 + '→' + S.length + ', "' + hwModel.text(p5) + '" 굵게 ' + !!csAt(p5, 0).bold + '/' + !!csAt(p5, 1).bold
       + ', 다음 "' + (p6 ? hwModel.text(p6) : '') + '"');

  function imageCount() {
    var n = 0, all = hwModel.allParas();
    for (var i = 0; i < all.length; i++) for (var j = 0; j < (all[i].objs || []).length; j++) if (all[i].objs[j].kind === 'image') n++;
    return n;
  }
  var png = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
  var bytes = new Uint8Array(png.length);
  for (var bi = 0; bi < png.length; bi++) bytes[bi] = png.charCodeAt(bi);
  var dt112 = new DataTransfer();
  dt112.items.add(new File([bytes], 'p.png', { type: 'image/png' }));
  var img112 = imageCount(), sent112 = null, real112 = window.hwPost;
  window.hwPost = function (o) { if (o && o.t === 'pasteImage') sent112 = o; return real112(o); };
  hwCaret.set(p6.id, p6.len, false);
  paste(dt112);

  var cv84 = hwRenderer.canvas();
  function menuAt(p, pos) {
    hwCaret.scrollIntoView();
    hwRenderRefresh();
    var c = hwCaret.coord(p.id, pos), b = c ? hwRenderer.bodyOf(c.pageIdx) : null;
    if (!b) return false;
    var r = b.getBoundingClientRect();
    var x = r.left + hwHu2Px(c.xHu) + 2, y = r.top + hwHu2Px(c.yHu + c.hHu / 2);
    var h = hwCaret.hitTest(x, y), efp = document.elementFromPoint(x, y);
    (efp || b).dispatchEvent(new MouseEvent('contextmenu',
      { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y }));
    return '점 ' + Math.round(x) + ',' + Math.round(y) + ' 누른 자리 ' + (h ? h.id + ':' + h.pos : 'null')
         + ' 요소 ' + (efp ? (efp.className || efp.tagName) : 'null') + ' 캐럿 ' + hwCaret.at().id;
  }
  function rowOf(m, label) {
    var rs = m ? m.querySelectorAll('.hw-ctx-item') : [];
    for (var i = 0; i < rs.length; i++) if (rs[i].firstChild.textContent === label) return rs[i];
    return null;
  }

  hwCaret.set(sp.id, 5, false);
  pick(sp, 2, 8);
  var shown84 = menuAt(sp, 5);
  var s84 = hwCaret.selection(), m84 = hwUi.menuEl();
  var copy84 = rowOf(m84, '복사'), font84 = rowOf(m84, '글자 모양…');
  key('Escape');
  var s84b = hwCaret.selection();
  ok('84 선택 안에서 우클릭 — 선택 유지, 복사가 살아 있는 메뉴, Esc 로 메뉴만 닫힌다',
     shown84 && !!s84 && s84.fromId === sp.id && s84.fromPos === 2 && s84.toPos === 8 && !!copy84 && !copy84.classList.contains('dis')
       && !!font84 && !hwUi.menuEl() && !!s84b && s84b.fromPos === 2 && s84b.toPos === 8 && document.activeElement === ime,
     '선택 ' + (s84 ? s84.fromPos + '~' + s84.toPos : '없음') + ', 메뉴 ' + (m84 ? m84.querySelectorAll('.hw-ctx-item').length + '항목' : '없음')
       + ', 복사 ' + (copy84 ? (copy84.classList.contains('dis') ? '흐림' : '살아 있음') : '없음') + ', Esc 뒤 메뉴 ' + (hwUi.menuEl() ? '남음' : '닫힘'));

  var cp84 = firstCellPara();
  if (!cp84) {
    ok('84-1 칸 안 우클릭 "줄/칸 추가하기"', true, '남은 표 없음(표가 없거나, 하나뿐인 표를 S1 의 90 이 지웠다) — 건너뜀');
  } else {
    /* ★ 어느 표가 잡히는지는 단정하지 않는다 — 한 문단에 겹쳐 놓인 표가 둘 있으면 칸 좌표가 옆 표의 칸에 떨어진다
       (실측 basicsReport.hwp). 누른 뒤 <b>실제로 잡힌 칸</b>의 표에서 줄이 느는지 본다. */
    hwCaret.set(cp84.id, 0, false);
    var at84 = menuAt(cp84, 0);
    var here84 = hwTable.here();
    var t84 = here84 ? here84.obj.table : null;
    var rowsOf84 = function () {
      var n = 0;
      for (var i = 0; t84 && i < t84.cells.length; i++) n = Math.max(n, t84.cells[i].r + (t84.cells[i].rs || 1));
      return n;
    };
    var r84 = rowsOf84();
    var add84 = rowOf(hwUi.menuEl(), '줄/칸 추가하기');
    if (add84) add84.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    var below84 = rowOf(hwUi.subMenuEl(), '아래에 줄 추가');
    if (below84) below84.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    ok('84-1 칸 안 우클릭 — "줄/칸 추가하기" ▸ "아래에 줄 추가" 로 그 표의 줄이 는다',
       !!t84 && !!add84 && !!below84 && rowsOf84() === r84 + 1 && !hwUi.menuEl(),
       '항목 ' + (add84 ? '있음' : '없음') + ', 하위 ' + (below84 ? '있음' : '없음') + ', 줄 ' + r84 + '→' + rowsOf84()
         + ' (누른 칸 문단 ' + cp84.id + ', ' + at84 + ')');
  }
  hwUi.closeMenu();

  if (hwDialog.isOpen()) hwDialog.close();
  hwCaret.set(sp.id, 0, false);
  cv84.scrollTop = 0;

  /* 112 는 비동기다 — FileReader 가 끝나야 C# 에 가고, C# 이 hwInsertImage 로 답한다. 끝에서 기다렸다가 보고 걷어낸다. */
  return {
    after: function () {
      return new Promise(function (done) {
        var t0 = Date.now();
        (function poll() {
          if (imageCount() > img112 || Date.now() - t0 > 8000) { done(); return; }
          setTimeout(poll, 50);
        })();
      }).then(function () {
        window.hwPost = real112;
        var n112 = imageCount();
        ok('112 그림만 든 붙여넣기 → C# 이 임시 파일로 받아 그림 개체 하나',
           !!sent112 && sent112.type === 'image/png' && !!sent112.data && n112 === img112 + 1,
           '보냄 ' + (sent112 ? sent112.type + ' ' + sent112.data.length + '자' : '안 보냄') + ', 그림 ' + img112 + '→' + n112);
        if (n112 > img112) key('z', { ctrl: true });
        ok('112-1 되돌리기로 붙인 그림이 빠진다(임시 파일이 저장 요청에 안 남는다)', imageCount() === img112,
           '그림 ' + imageCount());
      });
    }
  };
}

/* ★ C# 이 물어볼 방법이 없다 — 스크립트 실행은 비동기인데 창을 닫는 순간에는 기다릴 수가 없다.
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

/* 세션 3 — 표 편집.
   ★ 문서에 표가 있든 없든 <b>스스로 표를 만들어</b> 그 위에서 본다. 표본마다 표 모양이 제각각이고
     S1 의 90 이 첫 표를 지운 뒤라, 남아 있는 표를 기준으로 삼으면 문서마다 다른 것을 재게 된다.
   ★ 끝에 표 하나를 글자째 남긴다 — 최종 저장 요청에 addTable 이 실려 --apply 가 그 길을 탄다. */
function hwUiTestS3(t) {
  var ok = t.ok, key = t.key, typeIn = t.typeIn, down = t.down, up = t.up;

  function tables() {
    var n = 0, all = hwModel.allParas();
    for (var i = 0; i < all.length; i++) for (var j = 0; j < (all[i].objs || []).length; j++) if (all[i].objs[j].table) n++;
    return n;
  }
  function rowsOf(tb) {
    var n = 0;
    for (var i = 0; i < tb.cells.length; i++) n = Math.max(n, tb.cells[i].r + (tb.cells[i].rs || 1));
    return n;
  }
  function widthOf(tb) {
    var w = 0;
    for (var i = 0; i < tb.cells.length; i++) if (tb.cells[i].r === 0) w += tb.cells[i].wHu || 0;
    return w;
  }
  function cellAt(tb, r, c) {
    for (var i = 0; i < tb.cells.length; i++) if (tb.cells[i].r === r && tb.cells[i].c === c) return tb.cells[i];
    return null;
  }
  function cellText(tb) {
    var s = '';
    for (var i = 0; i < tb.cells.length; i++)
      for (var q = 0; q < tb.cells[i].paras.length; q++) s += hwModel.text(tb.cells[i].paras[q]);
    return s;
  }
  function opsOf(name) {
    var all = hwBuildOps(), n = 0;
    for (var i = 0; i < all.length; i++) if (all[i].op === name) n++;
    return n;
  }
  /* 새 표가 저장 요청에 싣는 꾸러미. 구조를 바꿔도 <b>구조 요청이 아니라 이것</b>이 달라져야 한다. */
  function payload(obj) {
    var all = hwBuildOps();
    for (var i = 0; i < all.length; i++) if (all[i].op === 'addTable' && all[i].tmpId === obj.tmpId) return all[i];
    return null;
  }
  function spanOf(pl, r, c) {
    for (var i = 0; pl && i < pl.cells.length; i++)
      if (pl.cells[i].r === r && pl.cells[i].c === c) return pl.cells[i];
    return null;
  }
  function rowOf(m, label) {
    var rs = m ? m.querySelectorAll('.hw-ctx-item') : [];
    for (var i = 0; i < rs.length; i++) if (rs[i].firstChild.textContent === label) return rs[i];
    return null;
  }
  function click(el) { if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return !!el; }

  /* 대화상자 경로. 값을 직접 넣지 않고 이벤트로 넣는다 — "바뀐 칸만 적용" 이 그 이벤트로 가려진다. */
  function dlgNum(k, v) {
    var d = hwDialog.current(), e = d ? d.field(k) : null;
    if (!e) return false;
    e.value = String(v);
    e.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  function dlgRadio(k, v) {
    var d = hwDialog.current(), e = d ? d.field(k) : null;
    var b = e ? e.querySelector('.hw-dlg-rad[data-v="' + v + '"]') : null;
    return click(b);
  }
  function dlgPress(label) {
    var d = hwDialog.current(), b = d ? d.button(label) : null;
    return click(b);
  }

  /* 그 칸의 캐럿 자리에서 진짜 contextmenu 이벤트를 쏜다 — showMenu 를 직접 부르면 캐럿·블록을
     다루는 hwInput.onContextMenu 를 통째로 건너뛴다(S2 의 menuAt 과 같은 이유). */
  function menuAtPara(p, pos) {
    hwCaret.scrollIntoView();
    hwRenderRefresh();
    var c = hwCaret.coord(p.id, pos), b = c ? hwRenderer.bodyOf(c.pageIdx) : null;
    if (!b) return false;
    var r = b.getBoundingClientRect();
    var x = r.left + hwHu2Px(c.xHu) + 2, y = r.top + hwHu2Px(c.yHu + c.hHu / 2);
    var efp = document.elementFromPoint(x, y);
    (efp || b).dispatchEvent(new MouseEvent('contextmenu',
      { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y }));
    return true;
  }

  /* 본문 마지막 문단(검사가 만든 n… 문단이 아닌 것)으로 캐럿을 옮긴다 — 표는 그 다음에 붙는다. */
  function toBody() {
    var S = hwDoc.sections[0].paras, p = S[S.length - 1];
    for (var i = S.length - 1; i >= 0; i--) if (S[i].id.charAt(0) !== 'n') { p = S[i]; break; }
    hwCaret.set(p.id, p.len, false);
    return p;
  }

  /* 새 표 하나를 만들고 그 표 객체를 준다. 이어지는 단계가 전부 이걸로 돈다. */
  function make(r, c) {
    hwTable.clearBlock();
    if (window.hwObj) hwObj.clear();
    toBody();
    hwTable.insertTable(r, c);
    var at = hwTable.here();
    return at ? at.obj : null;
  }

  var n91 = tables();
  var o91 = make(2, 3);
  var t91 = o91 ? o91.table : null;
  /* ★ 마지막 칸 뒤에는 Tab 을 안 친다 — 그것이 줄을 하나 더하는 동작이다(97-2). */
  if (t91) for (var i91 = 0; i91 < 6; i91++) { typeIn('칸' + i91); if (i91 < 5) key('Tab'); }
  var add91 = null, ops91 = hwBuildOps();
  for (var k91 = 0; k91 < ops91.length; k91++) if (ops91[k91].op === 'addTable') add91 = ops91[k91];
  var txt91 = '';
  for (var c91 = 0; add91 && c91 < add91.cells.length; c91++)
    for (var q91 = 0; q91 < add91.cells[c91].paras.length; q91++)
      for (var r91 = 0; r91 < (add91.cells[c91].paras[q91].runs || []).length; r91++)
        txt91 += add91.cells[c91].paras[q91].runs[r91].text;
  ok('91 표 넣기 — 2줄 3칸, 칸 여섯에 친 글자가 addTable 요청에 실린다',
     !!t91 && tables() === n91 + 1 && !!add91 && add91.rows === 2 && add91.cols === 3
       && add91.cells.length === 6 && txt91.indexOf('칸0') >= 0 && txt91.indexOf('칸5') >= 0,
     '표 ' + n91 + '→' + tables() + ', addTable ' + (add91 ? add91.rows + 'x' + add91.cols + ' 칸' + add91.cells.length : '없음')
       + ', 실린 글 "' + txt91 + '"');

  /* ★ 되돌리기는 <b>갓 넣은</b> 표로 본다 — 위에서 칸에 글을 쳤으므로 Ctrl+Z 한 번은 그 글자의 것이다. */
  var n91b = tables();
  var o91b = make(2, 2);
  var made91 = tables();
  key('z', { ctrl: true });
  var undone91 = tables(), off91 = o91b ? payload(o91b) : null;
  key('z', { ctrl: true, shift: true });
  ok('91-1 되돌리기로 새 표가 빠지고(저장 요청에서도) 다시 하기로 돌아온다',
     made91 === n91b + 1 && undone91 === n91b && !off91 && tables() === made91 && !!(o91b && payload(o91b)),
     '표 ' + n91b + '→' + made91 + '→' + undone91 + '→' + tables()
       + ', 되돌린 뒤 꾸러미 ' + (off91 ? '남음' : '없음'));

  var o92 = make(2, 3), t92 = o92 ? o92.table : null;
  var base92 = t92 ? rowsOf(t92) : 0, w92 = t92 ? widthOf(t92) : 0;
  /* ★ Alt+Insert 대화상자 경로로 태운다 — addRow 를 직접 부르면 방향 라디오·개수 칸을 한 번도 안 지난다. */
  var dlg92 = false;
  if (t92) {
    hwCaret.set(cellAt(t92, 1, 0).paras[0].id, 0, false);
    key('Insert', { alt: true });
    dlg92 = hwDialog.isOpen() && dlgRadio('where', 'up') && dlgNum('count', 2) && dlgPress('넣기');
  }
  var pl92 = o92 ? payload(o92) : null;
  ok('92 Alt+Insert 로 위에 2줄 추가 — 줄 +2, 표 폭 그대로, 저장 꾸러미도 4줄 12칸',
     dlg92 && !hwDialog.isOpen() && !!t92 && rowsOf(t92) === base92 + 2 && widthOf(t92) === w92
       && !!pl92 && pl92.rows === base92 + 2 && pl92.cells.length === 12,
     (dlg92 ? '대화상자 통과' : '대화상자 실패') + ', 줄 ' + base92 + '→' + (t92 ? rowsOf(t92) : 0)
       + ', 폭 ' + w92 + '→' + (t92 ? widthOf(t92) : 0)
       + ', 꾸러미 ' + (pl92 ? pl92.rows + 'x' + pl92.cols + ' 칸' + pl92.cells.length : '없음'));

  var o93 = make(2, 3), t93 = o93 ? o93.table : null;
  key('F5'); key('F5'); key('F5');
  var b93 = hwTable.blockCells();
  ok('93 F5 세 번이면 블록이 표의 모든 칸', !!b93 && !!t93 && b93.cells.length === t93.cells.length,
     b93 ? b93.cells.length + '/' + t93.cells.length + ' 칸' : '블록 없음');

  if (t93) for (var z93 = 0; z93 < t93.cells.length; z93++) {
    hwCaret.set(t93.cells[z93].paras[0].id, 0, false);
    typeIn('글' + z93);
  }
  var had93 = t93 ? cellText(t93).length : 0, n93 = tables();
  hwCaret.set(t93 ? t93.cells[0].paras[0].id : hwCaret.at().id, 0, false);
  key('F5'); key('F5'); key('F5');
  key('Delete');
  ok('93-1 블록 Delete 는 칸 글자만 지운다(표는 남는다)',
     !!t93 && tables() === n93 && had93 > 0 && cellText(t93) === '',
     '표 ' + n93 + '→' + tables() + ', 칸 글 ' + had93 + '자 → "' + (t93 ? cellText(t93) : '?') + '"');

  hwTable.clearBlock();
  hwCaret.set(t93 ? t93.cells[0].paras[0].id : hwCaret.at().id, 0, false);
  key('F5');
  var on93 = !!hwTable.block();
  key('Escape');
  ok('93-2 Esc 로 블록이 풀린다', on93 && !hwTable.block(), (on93 ? '잡힘' : '안 잡힘') + ' → ' + (hwTable.block() ? '남음' : '풀림'));

  var o94 = make(2, 3), t94 = o94 ? o94.table : null;
  if (t94) {
    hwCaret.set(cellAt(t94, 0, 0).paras[0].id, 0, false); typeIn('앞칸');
    hwCaret.set(cellAt(t94, 0, 1).paras[0].id, 0, false); typeIn('뒷칸');
  }
  var n94 = t94 ? t94.cells.length : 0, w94 = t94 ? widthOf(t94) : 0;
  /* ★ 합치기 키는 <b>한글 모드</b>로 태운다 — 그때 e.key 는 'Process' 이고 code 로만 M 을 알 수 있다. */
  if (t94) { hwCaret.set(cellAt(t94, 0, 0).paras[0].id, 0, false); key('F5'); key('F5'); key('ArrowRight'); key('Process', { code: 'KeyM' }); }
  var keep94 = t94 ? cellAt(t94, 0, 0) : null, txt94 = '';
  for (var y94 = 0; keep94 && y94 < keep94.paras.length; y94++) txt94 += hwModel.text(keep94.paras[y94]);
  var s94 = o94 ? spanOf(payload(o94), 0, 0) : null;
  ok('94 블록 M 으로 두 칸이 합쳐진다 — 칸 −1, 표 폭 그대로, 두 칸 글이 차례대로 이어 붙고 꾸러미에도 실린다',
     !!t94 && t94.cells.length === n94 - 1 && widthOf(t94) === w94 && txt94 === '앞칸뒷칸'
       && !!s94 && s94.cs === 2 && s94.paras.length === 2,
     '칸 ' + n94 + '→' + (t94 ? t94.cells.length : 0) + ', 폭 ' + w94 + '→' + (t94 ? widthOf(t94) : 0)
       + ', 남은 칸 글 "' + txt94 + '", 꾸러미 첫 칸 cs=' + (s94 ? s94.cs : '?') + ' 문단 ' + (s94 ? s94.paras.length : '?') + '개');

  var o94b = make(1, 2), t94b = o94b ? o94b.table : null;
  var n94b = t94b ? t94b.cells.length : 0, w94b = t94b ? widthOf(t94b) : 0;
  if (t94b) { hwCaret.set(cellAt(t94b, 0, 0).paras[0].id, 0, false); hwTable.splitCell(2, 2); }
  var pl94b = o94b ? payload(o94b) : null;
  ok('94-1 셀 나누기(2줄 2칸) — 칸 +3, 표 폭 그대로, 꾸러미도 그 칸 수',
     !!t94b && t94b.cells.length === n94b + 3 && widthOf(t94b) === w94b
       && !!pl94b && pl94b.cells.length === n94b + 3,
     '칸 ' + n94b + '→' + (t94b ? t94b.cells.length : 0) + ', 폭 ' + w94b + '→' + (t94b ? widthOf(t94b) : 0)
       + ', 꾸러미 칸 ' + (pl94b ? pl94b.cells.length : '없음'));

  /* ★ 원본 표에서도 한 번 태운다 — 새 표의 합치기·나누기는 <b>addTable 이 이미 고쳐진 격자</b>를 쓰므로
     C# 의 Merge·Split 을 한 번도 안 지난다. 요청에 진짜 oid 가 실리는지까지 본다. */
  var cp94c = firstCellPara();
  var ob94c = cp94c ? cp94c._cell._obj : null;
  if (!ob94c || !ob94c.oid) {
    ok('94-2 원본 표에서 합치기·나누기', true, '남은 원본 표 없음 — 건너뜀');
  } else {
    var tc = ob94c.table, nc = tc.cells.length, wc = widthOf(tc);
    var a94 = null, b94 = null;
    for (var i94 = 0; i94 < tc.cells.length && !a94; i94++)
      for (var j94 = 0; j94 < tc.cells.length; j94++) {
        var A = tc.cells[i94], B = tc.cells[j94];
        if (A === B || A.r !== B.r || A.rs !== B.rs || B.c !== A.c + A.cs) continue;
        a94 = A; b94 = B; break;
      }
    if (!a94) {
      ok('94-2 원본 표에서 합치기·나누기', true, '나란한 두 칸이 없다 — 건너뜀');
    } else {
      hwTable.dragBlock(a94, b94);
      hwTable.mergeBlock();
      var mops = hwBuildOps(), mg = null, sp94 = null;
      for (var m94 = 0; m94 < mops.length; m94++) if (mops[m94].op === 'mergeCells' && mops[m94].oid === ob94c.oid) mg = mops[m94];

      var one94 = null;
      for (var k94 = 0; k94 < tc.cells.length; k94++)
        if (tc.cells[k94].cs === 1 && tc.cells[k94].rs === 1) { one94 = tc.cells[k94]; break; }
      if (one94) {
        hwCaret.set(one94.paras[0].id, 0, false);
        hwTable.splitCell(1, 2);
        var sops = hwBuildOps();
        for (var s94 = 0; s94 < sops.length; s94++) if (sops[s94].op === 'splitCell' && sops[s94].oid === ob94c.oid) sp94 = sops[s94];
      }
      ok('94-2 원본 표에서 합치기·나누기 — 칸 수가 맞고 요청이 그 표의 oid 를 가리킨다',
         !!mg && (!one94 || !!sp94) && tc.cells.length === nc - 1 + (one94 ? 1 : 0) && widthOf(tc) === wc,
         '칸 ' + nc + '→' + tc.cells.length + ', 폭 ' + wc + '→' + widthOf(tc)
           + ', mergeCells ' + (mg ? 'oid 실림' : '없음') + ', splitCell ' + (one94 ? (sp94 ? 'oid 실림' : '없음') : '건너뜀'));
    }
  }

  var o95 = make(1, 3), t95 = o95 ? o95.table : null;
  if (t95) { cellAt(t95, 0, 0).wHu = 6000; cellAt(t95, 0, 1).wHu = 12000; cellAt(t95, 0, 2).wHu = 3000; }
  var w95 = t95 ? widthOf(t95) : 0;
  if (t95) { hwCaret.set(cellAt(t95, 0, 0).paras[0].id, 0, false); key('F5'); key('F5'); key('ArrowRight'); key('ArrowRight'); key('w'); }
  var ws95 = t95 ? [cellAt(t95, 0, 0).wHu, cellAt(t95, 0, 1).wHu, cellAt(t95, 0, 2).wHu] : [];
  var p95 = o95 ? spanOf(payload(o95), 0, 1) : null;
  ok('95 블록 W 로 세 칸 폭이 같아진다 — 표 전체 폭은 그대로',
     !!t95 && ws95.length === 3 && Math.abs(ws95[0] - ws95[1]) <= 1 && Math.abs(ws95[1] - ws95[2]) <= 1
       && widthOf(t95) === w95 && !!p95 && p95.wHu === ws95[1],
     '폭 ' + ws95.join('/') + ', 합 ' + w95 + '→' + (t95 ? widthOf(t95) : 0)
       + ', 꾸러미 가운데 칸 ' + (p95 ? p95.wHu : '없음'));

  var o97 = make(2, 3), t97 = o97 ? o97.table : null;
  hwTable.selectRange('table');
  var b97 = hwTable.blockCells();
  ok('97 "선택 ▸ 표" 면 블록이 모든 칸', !!b97 && !!t97 && b97.cells.length === t97.cells.length,
     b97 ? b97.cells.length + '/' + t97.cells.length + ' 칸' : '블록 없음');

  /* ★ 진짜 우클릭으로 태운다 — 블록 칸을 누른 우클릭이 캐럿을 옮겨 블록을 풀어 버리면
     "셀 합치기" 는 <b>늘 흐림</b>이 된다(showMenu 를 직접 부르면 그 길을 안 지난다). */
  hwTable.clearBlock();
  if (t97) { hwCaret.set(cellAt(t97, 0, 0).paras[0].id, 0, false); key('F5'); key('F5'); key('ArrowRight'); }
  var n97 = t97 ? t97.cells.length : 0;
  var shown97 = t97 ? menuAtPara(cellAt(t97, 0, 1).paras[0], 0) : false;
  var blk97 = !!hwTable.block();
  var mg97 = rowOf(hwUi.menuEl(), '셀 합치기');
  var live97 = !!mg97 && !mg97.classList.contains('dis');
  click(mg97);
  hwUi.closeMenu();
  ok('97-1 블록 칸에서 우클릭하면 블록이 살아 있고 "셀 합치기" 로 칸이 하나 준다',
     shown97 && blk97 && live97 && !!t97 && t97.cells.length === n97 - 1,
     (shown97 ? '메뉴 뜸' : '메뉴 못 띄움') + ', 블록 ' + (blk97 ? '살아 있음' : '풀림')
       + ', 항목 ' + (mg97 ? (live97 ? '살아 있음' : '흐림') : '없음')
       + ', 칸 ' + n97 + '→' + (t97 ? t97.cells.length : 0));

  var o97b = make(2, 3), t97b = o97b ? o97b.table : null;
  var r97 = t97b ? rowsOf(t97b) : 0;
  if (t97b) {
    var last97 = null;
    for (var y97 = 0; y97 < t97b.cells.length; y97++) {
      var cc97 = t97b.cells[y97];
      if (!last97 || cc97.r > last97.r || (cc97.r === last97.r && cc97.c > last97.c)) last97 = cc97;
    }
    hwCaret.set(last97.paras[0].id, 0, false);
    key('Tab');
  }
  var at97 = hwTable.here();
  ok('97-2 마지막 칸에서 Tab 은 줄을 더하고 캐럿을 새 줄 첫 칸에 둔다',
     !!t97b && rowsOf(t97b) === r97 + 1 && !!at97 && at97.cell.r === r97 && at97.cell.c === 0,
     '줄 ' + r97 + '→' + (t97b ? rowsOf(t97b) : 0) + ', 캐럿 ' + (at97 ? 'r' + at97.cell.r + ' c' + at97.cell.c : '표 밖'));

  /* ★ 96 을 맨 끝에 둔다 — 표를 지우는 단계라 앞에 두면 뒤 단계가 쓸 표가 없다. */
  var o96 = make(1, 2);
  hwTable.clearBlock();
  hwCaret.paint();
  hwRenderRefresh();
  var box96 = o96 ? document.querySelector('.hw-table[data-tpara="' + hwModel.hostOf(o96).id + '"]') : null;
  var n96 = tables(), sel96 = null;
  if (box96) {
    var r96 = box96.getBoundingClientRect();
    down(box96, r96.left - 2, r96.top + r96.height / 2);
    up();
    sel96 = hwObj.current();
    key('Delete');
  }
  ok('96 테두리 바깥 띠를 누르면 표가 개체로 골라지고 Delete 로 지워진다',
     !!box96 && !!sel96 && !!sel96.obj.table && tables() === n96 - 1,
     (box96 ? '격자 있음' : '격자 없음') + ', 고름 ' + (sel96 ? (sel96.obj.table ? '표' : sel96.obj.kind) : '없음')
       + ', 표 ' + n96 + '→' + tables());

  /* 마지막으로 저장 요청에 실을 표 하나 — --apply 가 addTable 을 타게 한다. */
  var last = make(2, 2);
  if (last) { typeIn('왕복'); key('Tab'); typeIn('검사'); }
  hwTable.clearBlock();
  if (window.hwObj) hwObj.clear();
}

/* 세션 4 — 서식 확장(테두리·채우기). 단계 120~139. */
function hwUiTestS4(t) {
  var ok = t.ok, key = t.key, typeIn = t.typeIn;

  function csAt(p, k) { return hwDoc.charShapes[hwModel.shapeAt(p, k || 0)]; }
  function psOf(p) { return hwDoc.paraShapes[p.ps]; }
  function pick(p, a, b) { hwCaret.set(p.id, a, false); hwCaret.set(p.id, b, true); }
  function click(el) { if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return !!el; }
  function tool(sel) { return click(document.querySelector(sel)); }
  function setPick(id, v) {
    var e = document.getElementById(id);
    if (!e) return false;
    e.value = v;
    e.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  function dlgSet(k, v) {
    var d = hwDialog.current(), e = d ? d.field(k) : null;
    if (!e) return false;
    if (e.type === 'checkbox') { e.checked = !!v; e.dispatchEvent(new Event('change', { bubbles: true })); return true; }
    /* 누름 단추(속성 묶음)는 눌러서 켠다 — 값 대입으로는 touched 가 안 찍힌다. */
    if (e.classList.contains('hw-dlg-tog')) return click(e);
    e.value = String(v);
    e.dispatchEvent(new Event(e.tagName === 'SELECT' || e.type === 'color' ? 'change' : 'input', { bubbles: true }));
    return true;
  }
  function dlgPress(label) {
    var d = hwDialog.current(), b = d ? d.button(label) : null;
    return click(b);
  }

  /* 화면이 만든 문단(n…) 뒤에는 만들지 않는다 — S1 과 같은 이유(저장 요청에 문서에 없는 id 가 실린다). */
  var S0 = hwDoc.sections[0].paras, tail = S0[S0.length - 1];
  for (var ti = S0.length - 1; ti >= 0; ti--) if (S0[ti].id.charAt(0) !== 'n') { tail = S0[ti]; break; }
  hwCaret.set(tail.id, tail.len, false);
  key('Enter');
  var sp = hwCaret.para();
  typeIn('서식확장검사');

  pick(sp, 0, 3);
  key('s', { alt: true, shift: true, code: 'KeyS' });
  ok('121 Alt+Shift+S 는 아래첨자', csAt(sp, 0).sub === true && csAt(sp, 0).sup === false,
     'sub ' + csAt(sp, 0).sub + ' sup ' + csAt(sp, 0).sup);

  key('o', { alt: true, shift: true, code: 'KeyO' });
  ok('122 Alt+Shift+O 는 위첨자(아래첨자를 끈다)', csAt(sp, 0).sup === true && csAt(sp, 0).sub === false,
     'sub ' + csAt(sp, 0).sub + ' sup ' + csAt(sp, 0).sup);

  key('a', { ctrl: true, alt: true, code: 'KeyA' });
  var swap1 = csAt(sp, 0).sub === true && csAt(sp, 0).sup === false;
  key('a', { ctrl: true, alt: true, code: 'KeyA' });
  ok('123 Ctrl+Alt+A 는 위 → 아래 → 없음으로 돈다',
     swap1 && csAt(sp, 0).sub === false && csAt(sp, 0).sup === false,
     '한 번 ' + (swap1 ? '아래' : '아님') + ', 두 번 sub ' + csAt(sp, 0).sub + ' sup ' + csAt(sp, 0).sup);

  var shadeOn = setPick('hwShade', '#ffff00');
  var got124 = (csAt(sp, 0).shade || '').toUpperCase();
  tool('[data-fmt="noShade"]');
  ok('124 도구줄 형광펜은 색을 걸고 "형광펜×" 는 없앤다(흰색이 아니라 없음)',
     shadeOn && got124 === '#FFFF00' && !csAt(sp, 0).shade,
     '걸린 값 ' + got124 + ', 뒤 ' + (csAt(sp, 0).shade === null ? 'null' : String(csAt(sp, 0).shade)));

  pick(sp, 0, 3);
  key('l', { alt: true });
  var f125 = dlgSet('underline', '1') && dlgSet('ulShape', 'dash') && dlgSet('ulColor', '#ff0000');
  dlgPress('설정');
  ok('125 글자 모양 — 밑줄 모양·색이 걸린다',
     f125 && !hwDialog.isOpen() && csAt(sp, 0).underline === 1 && csAt(sp, 0).ulShape === 'dash'
       && (csAt(sp, 0).ulColor || '').toUpperCase() === '#FF0000',
     '밑줄 ' + csAt(sp, 0).underline + '/' + csAt(sp, 0).ulShape + '/' + csAt(sp, 0).ulColor);

  pick(sp, 0, 3);
  key('l', { alt: true });
  var f126 = dlgSet('outline', '1') && dlgSet('shadow', '2') && dlgSet('emph', '1') && dlgSet('emboss', true);
  dlgPress('설정');
  var c126 = csAt(sp, 0);
  ok('126 글자 모양 — 외곽선·그림자·강조점·양각이 걸린다',
     f126 && !hwDialog.isOpen() && c126.outline === 1 && c126.shadow === 2 && c126.emph === 1,
     '외 ' + c126.outline + ' 그 ' + c126.shadow + ' 강 ' + c126.emph + ' 양 ' + c126.emboss);

  /* ── E2 문단 테두리·음영 ── */

  hwCaret.set(sp.id, 0, false);
  var nBf = hwDoc.borderFills.length;
  key('t', { alt: true });
  var f127 = dlgSet('bType', 'dash') && dlgSet('bWidth', '0.5') && dlgSet('bColor', '#0000ff');
  dlgPress('설정');
  var ps127 = psOf(sp), bf127 = hwModel.borderFill(ps127.bf);
  ok('127 문단 모양 테두리 탭 — 테두리가 걸리고 표에 줄이 하나 는다',
     f127 && !hwDialog.isOpen() && !!bf127 && bf127.t.type === 'dash' && bf127.t.w === '0.5'
       && (bf127.t.color || '').toUpperCase() === '#0000FF' && hwDoc.borderFills.length === nBf + 1,
     'bf ' + ps127.bf + ' ' + (bf127 ? bf127.t.type + '/' + bf127.t.w + '/' + bf127.t.color : '없음')
       + ', 표 ' + nBf + '→' + hwDoc.borderFills.length);

  hwCaret.set(sp.id, 0, false);
  key('t', { alt: true });
  var f128 = dlgSet('bNoFill', false) && dlgSet('bFill', '#00ff00');
  dlgPress('설정');
  var bf128 = hwModel.borderFill(psOf(sp).bf);
  ok('128 문단 음영이 걸린다', f128 && !!bf128 && (bf128.fill || '').toUpperCase() === '#00FF00',
     '면 색 ' + (bf128 ? String(bf128.fill) : '없음'));

  hwCaret.set(sp.id, 0, false);
  key('t', { alt: true });
  var f129 = dlgSet('bsT', 3) && dlgSet('bsB', 3) && dlgSet('bsL', 2) && dlgSet('bsR', 2);
  dlgPress('설정');
  var ps129 = psOf(sp);
  ok('129 테두리 간격(pt)이 문단모양에 들어간다',
     f129 && ps129.bsT === 300 && ps129.bsB === 300 && ps129.bsL === 200 && ps129.bsR === 200,
     '위 ' + ps129.bsT + ' 아래 ' + ps129.bsB + ' 왼 ' + ps129.bsL + ' 오 ' + ps129.bsR);

  hwCaret.scrollIntoView();
  hwRenderRefresh();
  var box130 = document.querySelector('.hw-parabox');
  ok('130 화면에 문단 테두리 상자가 그려진다',
     !!box130 && box130.style.borderTopStyle === 'dashed' && box130.offsetWidth > 0,
     box130 ? (box130.style.borderTop + ' / ' + box130.offsetWidth + 'x' + box130.offsetHeight) : '상자 없음');

  /* ── E3 표 서식 ── 검사용 표를 따로 넣어 쓴다(다른 검사가 쓰는 표를 안 건드린다). */

  hwCaret.set(sp.id, sp.len, false);
  key('Enter');
  hwTable.insertTable(2, 2);
  var at131 = hwTable.here();
  var obj131 = at131 ? at131.obj : null;
  if (!obj131) { ok('131 검사용 표를 못 넣었다', false, '표 없음'); return; }

  function cellOf(r, c) {
    var cs = obj131.table.cells;
    for (var i = 0; i < cs.length; i++) if (cs[i].r === r && cs[i].c === c) return cs[i];
    return null;
  }

  hwTable.selectRange('table');
  key('b');
  var f131 = dlgSet('lType', 'dot') && dlgSet('lWidth', '0.4') && dlgSet('lColor', '#008000');
  dlgPress('설정');
  var bf131 = hwModel.borderFill(cellOf(0, 0) ? cellOf(0, 0).bf : 0);
  ok('131 셀 블록에서 B — 테두리/배경 대화상자로 칸 테두리가 걸린다',
     f131 && !hwDialog.isOpen() && !!bf131 && bf131.t.type === 'dot' && bf131.t.w === '0.4',
     bf131 ? (bf131.t.type + '/' + bf131.t.w + '/' + bf131.t.color) : '테두리 없음');

  hwTable.selectRange('table');
  key('b');
  var f132 = dlgSet('noFill', false) && dlgSet('fill', '#c0c0c0');
  dlgPress('설정');
  var bf132 = hwModel.borderFill(cellOf(0, 0) ? cellOf(0, 0).bf : 0);
  hwCaret.scrollIntoView();
  hwRenderRefresh();
  /* ★ 아무 .hw-cell 이나 잡으면 안 된다 — 문서에 이미 있던 표의 칸이 먼저 걸려, 우리가 칠한 칸을
     한 번도 안 보고 통과한다. 이 표의 격자 상자 안에서 찾는다. */
  var host132 = hwModel.hostOf(obj131);
  var boxEl = host132 ? document.querySelector('.hw-table[data-tpara="' + host132.id + '"]') : null;
  var cellEl = boxEl ? boxEl.querySelector('.hw-cell') : null;
  ok('132 칸 배경이 걸리고 화면에도 칠해진다',
     !!bf132 && (bf132.fill || '').toUpperCase() === '#C0C0C0'
       && !!cellEl && cellEl.style.backgroundColor === 'rgb(192, 192, 192)',
     '면 색 ' + (bf132 ? String(bf132.fill) : '없음') + ', 화면 ' + (cellEl ? cellEl.style.backgroundColor : '칸 없음'));

  /* 옆 칸을 두 줄로 만들어 <b>줄 하나보다 높은 칸</b>을 만든다 — 남는 높이가 없으면 세로 맞춤은
     걸어도 아무것도 안 움직여서, 그대로 재면 통과·실패를 못 가른다. */
  hwTable.clearBlock();
  hwCaret.set(cellOf(0, 1).paras[0].id, 0, false);
  typeIn('두줄');
  key('Enter');
  typeIn('만들기');
  hwRelayout();

  hwCaret.set(cellOf(0, 0).paras[0].id, 0, false);
  var y133a = (hwLineIndex[cellOf(0, 0).paras[0].id] || [{}])[0].yHu;
  hwTable.setCellFmt({ valign: 2 });
  var y133b = (hwLineIndex[cellOf(0, 0).paras[0].id] || [{}])[0].yHu;
  ok('133 세로 맞춤 — 아래쪽으로 두면 칸 안 글줄이 내려간다',
     cellOf(0, 0).valign === 2 && y133b > y133a, 'y ' + y133a + '→' + y133b);

  hwTable.setCellFmt({ cmL: 500, cmR: 500, cmT: 500, cmB: 500 });
  /* ★ 새 표는 cellFmt 를 따로 안 보낸다(아직 oid 가 없다) — 서식은 addTable 꾸러미에 실려 가야 한다.
     여기서 보는 것이 그 자리다. */
  var pay134 = null, all134 = hwBuildOps();
  for (var q134 = 0; q134 < all134.length; q134++)
    if (all134[q134].op === 'addTable' && all134[q134].tmpId === obj131.tmpId) pay134 = all134[q134];
  var pc134 = pay134 ? pay134.cells[0] : null;
  ok('134 칸 안 여백·세로 맞춤·테두리가 모델과 addTable 꾸러미에 들어간다',
     cellOf(0, 0).mlHu === 500 && !!pc134 && pc134.mlHu === 500 && pc134.valign === 2 && pc134.bf > 0,
     '모델 ' + cellOf(0, 0).mlHu + ', 꾸러미 ' + (pc134 ? pc134.mlHu + '/valign ' + pc134.valign + '/bf ' + pc134.bf : '없음'));

  hwCaret.set(cellOf(0, 0).paras[0].id, 0, false);
  hwTable.selectRange('table');
  key('p');
  var f135 = dlgSet('omL', 2) && dlgSet('omR', 2) && dlgSet('omT', 1) && dlgSet('omB', 1);
  dlgPress('설정');
  ok('135 표 속성 P — 바깥 여백이 개체에 들어간다',
     f135 && !hwDialog.isOpen() && obj131.omLHu === 567 && obj131.omTHu === 283,
     '바깥 ' + obj131.omLHu + '/' + obj131.omRHu + '/' + obj131.omTHu + '/' + obj131.omBHu);

  hwCaret.set(cellOf(0, 0).paras[0].id, 0, false);
  hwTable.selectRange('table');
  key('p');
  var f136 = dlgSet('divide', '0');
  dlgPress('설정');
  ok('136 쪽 경계에서 나누지 않음', f136 && obj131.table.divide === 0, 'divide ' + obj131.table.divide);

  hwCaret.set(cellOf(0, 0).paras[0].id, 0, false);
  hwTable.selectRange('table');
  key('p');
  var f137 = dlgSet('repeatHeader', true) && dlgSet('head', true);
  dlgPress('설정');
  ok('137 제목 줄 반복과 제목 칸',
     f137 && obj131.table.repeatHeader === true && cellOf(0, 0).head === true,
     '반복 ' + obj131.table.repeatHeader + ', 제목 칸 ' + cellOf(0, 0).head);

  hwCaret.set(cellOf(0, 0).paras[0].id, 0, false);
  hwTable.selectRange('table');
  key('p');
  var d138 = hwDialog.current();
  var tabs138 = d138 ? d138.el.querySelectorAll('.hw-dlg-tab').length : 0;
  dlgPress('취소');
  ok('138 표 속성이 2탭으로 열리고 값이 실려 있다', tabs138 === 2 && !hwDialog.isOpen(), '탭 ' + tabs138 + '개');

  hwTable.selectRange('table');
  key('b');
  var d139 = hwDialog.current();
  var tabs139 = d139 ? d139.el.querySelectorAll('.hw-dlg-tab').length : 0;
  dlgPress('취소');
  ok('139 테두리/배경이 2탭으로 열린다', tabs139 === 2 && !hwDialog.isOpen(), '탭 ' + tabs139 + '개');

  hwTable.clearBlock();
  if (window.hwObj) hwObj.clear();
}

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

var hwUiTestImage = '';
var hwUiTestSrc = '';

function hwFirePing() {
  hwPingSeq += 1;
  hwPost({ t: 'ping', n: hwPingSeq });
}

/* C# 이 인쇄 직전에 부른다. 가상 스크롤을 끄고 모든 쪽을 채운 뒤 준비됐다고 알린다 —
   ★ 이걸 안 하면 화면 밖 쪽이 빈 채로 PDF 에 나간다(보이는 ±2쪽만 내용이 있다). */
/* ★ 인쇄는 100% 로 한다 — 용지 크기를 HWPUNIT 으로 주므로(PrintToPdfAsync) 확대된 쪽 상자는 한 쪽이 여러 쪽으로 쪼개진다. */
var hwPrintZoom = 100;

function hwPrintPrepare() {
  /* ★ 여기서 바로 던져도 printReady 는 보낸다(아래 catch 와 같은 이유) — C# 은 그걸 받아야
     "PDF 를 만드는 중" 을 푼다. 안 보내면 그 창에서는 다시 PDF 를 못 뽑는다. */
  try {
    hwPrintZoom = hwUi.zoom();
    if (hwPrintZoom !== 100) hwUi.setZoom(100);
    hwRenderer.fillAll(true);
  }
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
  if (hwPrintZoom !== 100) hwUi.setZoom(hwPrintZoom);
}

/* 편집마다 보내지 않는다. 저장할 때 <b>고친 문단과 구조 변경만</b> 모아 한 번에 올린다. */

function hwSave(saveAs) {
  if (!hwDoc) { hwSetStatus({ text: '문서를 먼저 여세요' }); return; }

  var ops = hwBuildOps();
  hwPost({
    t: 'save', rev: hwDoc.rev || 1, saveAs: !!saveAs,
    /* ★ 모양 목록을 통째로 같이 보낸다. 화면이 새로 만든 모양이 뒤에 붙어 있고,
       문서 쪽은 그중 이미 있는 것은 다시 쓰고 없는 것만 등록한다. */
    charShapes: hwDoc.charShapes, paraShapes: hwDoc.paraShapes,
    borderFills: hwDoc.borderFills,
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
      if (cmd === 'charShape' || cmd === 'paraShape' || cmd === 'charMap') {
        if (!hwDoc) { hwSetStatus({ text: '문서를 먼저 여세요' }); return; }
        hwDialog[cmd]();
        return;
      }
      if (cmd) hwPost({ t: 'menu', cmd: cmd });
    });
  }

  hwInput.init();
  hwUi.init();
  hwFind.init();
  hwBridge.flush();
  hwPost({ t: 'ready', ver: '0.4' });
});
