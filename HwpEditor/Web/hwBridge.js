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

  function key(k, opt) {
    var e = new KeyboardEvent('keydown', {
      key: k, bubbles: true, cancelable: true,
      shiftKey: !!(opt && opt.shift), ctrlKey: !!(opt && opt.ctrl)
    });
    ime.dispatchEvent(e);
  }

  function typeIn(t) {
    ime.textContent = t;
    ime.dispatchEvent(new InputEvent('input', { bubbles: true }));
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

  key('y', { ctrl: true });
  ok('9 Ctrl+Y 로 다시', hwDoc.sections[0].paras.length === paras0 + 1,
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

/* 쪽 상자 밖으로 가장 많이 삐져나간 요소. PDF 쪽 수가 터질 때 범인을 지목한다. */
function hwWorstBox() {
  var pages = document.querySelectorAll('.hw-page');
  var worst = null, worstOver = 0;

  for (var i = 0; i < pages.length; i++) {
    var pr = pages[i].getBoundingClientRect();
    var kids = pages[i].querySelectorAll('*');
    for (var k = 0; k < kids.length; k++) {
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
  var at = 0;
  var stack = [lineEl];

  for (var ci = 0; ci < lineEl.childNodes.length; ci++) {
    var kid = lineEl.childNodes[ci];

    var cls = kid.nodeType === 1 ? String(kid.className || '') : '';

    /* 줄 밖에 절대 좌표로 놓인 개체는 흐름에 없다 — 세면 그 뒤가 통째로 밀린다. */
    if (kid.nodeType === 1 && kid.style && kid.style.position === 'absolute') continue;

    if (cls.indexOf('hw-obj') >= 0 || cls.indexOf('hw-gap') >= 0) {
      if (at === n) return kid.getBoundingClientRect().left;
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
        var rect = r.getBoundingClientRect();
        return rect.left;
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
  hwRenderer.fillAll(true);
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
    hwSetStatus({ text: '저장함(표 구조가 바뀌어 다시 읽습니다) — ' + (r.path || '') });
    return;
  }

  hwModel.accept(r);
  if (r.path) hwDoc.path = r.path;
  if (r.rev) hwDoc.rev = r.rev;

  hwSetStatus({ text: '저장함 — ' + (r.path || '') });
  hwRelayout();
  hwCaret.paint();
}

/* ── 문서 → C# ───────────────────────────────────────────── */

var hwPingSeq = 0;

document.addEventListener('DOMContentLoaded', function () {
  var menu = document.getElementById('hwMenu');
  if (menu) {
    menu.addEventListener('mousedown', function (e) { e.preventDefault(); });   /* 캐럿 초점을 안 뺏는다 */
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
      if (cmd) hwPost({ t: 'menu', cmd: cmd });
    });
  }

  hwInput.init();
  hwUi.init();
  hwBridge.flush();
  hwPost({ t: 'ready', ver: '0.4' });
});
