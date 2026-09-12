/* ★ 도구줄에 마우스를 눌러도 <b>캐럿 초점을 뺏지 않는다</b>. 초점이 넘어가면 선택이 사라져서,
     굵게를 누르는 순간 무엇에 걸어야 할지 모르게 된다.
   ★ 누른 뒤에는 초점을 본문 수신기로 되돌린다 — 안 그러면 이어서 친 글자가 어디로도 안 간다. */

var hwUi = (function () {
  'use strict';

  var cSizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
  var cLines = [100, 130, 160, 180, 200, 250, 300];
  var cReady = false;

  function el(id) { return document.getElementById(id); }

  function init() {
    var bar = el('hwTools');
    if (!bar) return;

    fill(el('hwSize'), cSizes, function (v) { return v + 'pt'; });
    fill(el('hwLine'), cLines, function (v) { return v + '%'; });

    /* 문서를 열기 전에도 칸이 비어 보이지 않게 한 줄 넣어 둔다 — 빈 콤보는 폭이 거의 0 이라
       화살표만 남아서, 고장 난 것처럼 보인다. 문서를 열면 loadFonts 가 갈아 끼운다. */
    fill(el('hwFont'), ['-'], function () { return '(문서 없음)'; });
    fill(el('hwStyle'), ['-'], function () { return '(문서 없음)'; });

    bar.addEventListener('mousedown', onMouseDown);
    bar.addEventListener('click', onClick);
    initTabs();

    bind(el('hwStyle'), function (v) { hwFormat.applyStyle(parseInt(v, 10)); });
    bind(el('hwFont'), function (v) { hwFormat.applyChar({ face: parseInt(v, 10) }); });
    bind(el('hwSize'), function (v) { hwFormat.applyChar({ sizeHu: parseInt(v, 10) * 100 }); });
    bind(el('hwColor'), function (v) { hwFormat.applyChar({ color: v }); });
    bind(el('hwShade'), function (v) { hwFormat.setShade(v); });
    bind(el('hwLine'), function (v) { hwFormat.applyPara({ lsType: 'percent', ls: parseInt(v, 10) }); });

    var sb = el('hwStatusBar');
    if (sb) {
      sb.addEventListener('mousedown', onMouseDown);
      sb.addEventListener('click', onNavClick);
    }
    bind(el('hwZoomPick'), function (v) {
      if (v === 'width' || v === 'page') fitZoom(v);
      else if (v !== 'cur') setZoom(parseFloat(v));
    });
    var sl = el('hwZoomSlider');
    if (sl) {
      sl.addEventListener('input', function () { setZoom(parseFloat(sl.value)); });
      sl.addEventListener('change', function () { hwInput.focus(); });
    }
    /* ★ passive 를 꺼야 막을 수 있다 — 안 막으면 Ctrl+휠이 확대와 함께 화면도 굴린다. */
    var cv = el('hwCanvas');
    if (cv) cv.addEventListener('wheel', function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      stepZoom(e.deltaY < 0 ? +1 : -1);
    }, { passive: false });

    cReady = true;
    refreshZoom();
  }

  /* 확대 비율(%). 배치는 HWPUNIT 이라 그대로고 그리기만 다시 한다 — 캐럿·선택·조절점·IME 자리는 모두 hwHu2Px 를 지나므로 따라온다.
     ★ 맞춤 비율은 반올림하지 않는다 — 정수 %로 자르면 쪽 폭이 캔버스와 몇 px 어긋난다. */
  var cZoomMin = 25, cZoomMax = 400;

  function zoomPct() { return Math.round(hwUnit.zoom() * 1e8) / 1e6; }

  function setZoom(pct) {
    if (isNaN(pct)) return;
    var z = Math.max(cZoomMin, Math.min(cZoomMax, pct)) / 100;
    if (Math.abs(z - hwUnit.zoom()) > 1e-9) {
      var cv = hwRenderer.canvas() || el('hwCanvas');
      var at = cv && cv.scrollHeight > 0 ? cv.scrollTop / cv.scrollHeight : 0;
      hwUnit.zoom(z);
      if (hwDoc && window.hwPages) {
        hwRender();
        if (cv) { cv.scrollTop = at * cv.scrollHeight; hwRenderRefresh(); }
        hwCaret.scrollIntoView();
        hwRenderRefresh();
      }
    }
    refreshZoom();
  }

  function stepZoom(dir) { setZoom(Math.round(zoomPct() / 10) * 10 + dir * 10); }

  /* 폭 맞춤 = 캔버스 폭 / 쪽 폭, 쪽 맞춤 = min(폭 비, 높이 비). 캐럿이 있는 쪽을 잰다.
     ★ 폭 맞춤은 한 번 더 잰다 — 확대로 세로 스크롤바가 생기거나 없어지면 캔버스 폭이 그만큼 바뀐다. */
  function fitZoom(kind) {
    if (!hwDoc || !hwPages.length) return;
    var cv = hwRenderer.canvas();
    if (!cv) return;
    var pg = hwPages[Math.min(curPage() - 1, hwPages.length - 1)].page;
    var w1 = pg.wHu / 75, h1 = pg.hHu / 75;
    var z = cv.clientWidth / w1;
    if (kind === 'page') z = Math.min(z, (cv.clientHeight - 32) / h1);
    setZoom(z * 100);
    if (kind === 'width' && Math.abs(cv.clientWidth / w1 - hwUnit.zoom()) > 1e-6) setZoom(cv.clientWidth / w1 * 100);
  }

  function refreshZoom() {
    var pct = Math.round(zoomPct()), sel = el('hwZoomPick'), sl = el('hwZoomSlider');
    if (sl) sl.value = String(pct);
    if (!sel) return;
    var cur = sel.querySelector('option[data-cur]');
    var preset = sel.querySelector('option[value="' + pct + '"]:not([data-cur])');
    if (preset && Math.abs(zoomPct() - pct) < 1e-6) {
      if (cur) cur.parentNode.removeChild(cur);
      sel.value = String(pct);
      return;
    }
    if (!cur) {
      cur = document.createElement('option');
      cur.setAttribute('data-cur', '1');
      cur.value = 'cur';
      sel.insertBefore(cur, sel.firstChild);
    }
    cur.textContent = pct + '%';
    sel.value = 'cur';
  }

  function curPage() {
    var a = hwCaret.at();
    var c = a.id ? hwCaret.coord(a.id, a.pos) : null;
    return c ? c.pageIdx + 1 : 1;
  }

  function onNavClick(e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    var nav = b.getAttribute('data-nav');
    if (nav) {
      if (hwDoc) {
        var n = hwPageCount(), cur = curPage();
        var to = nav === 'first' ? 1 : nav === 'prev' ? cur - 1 : nav === 'next' ? cur + 1 : n;
        if (to >= 1 && to <= n) hwFind.gotoPage(to);
      }
      hwInput.focus();
      return;
    }
    var z = b.getAttribute('data-zoom');
    if (z) { stepZoom(parseInt(z, 10)); hwInput.focus(); }
  }

  function fill(sel, values, label) {
    if (!sel) return;
    sel.innerHTML = '';
    for (var i = 0; i < values.length; i++) {
      var o = document.createElement('option');
      o.value = String(values[i]);
      o.textContent = label(values[i]);
      sel.appendChild(o);
    }
  }

  function bind(sel, fn) {
    if (!sel) return;
    sel.addEventListener('change', function () {
      fn(sel.value);
      hwInput.focus();
    });
  }

  /* ★ 콤보·색 고르기 위에서는 기본 동작을 <b>막으면 안 된다</b>. Chromium 은 mousedown 의 기본
     동작으로 목록을 펼치는데, 그것을 막으면 눌러도 <b>아무 일이 안 일어난다</b>. 초점을 지켜야 하는 것은 단추뿐이고, 콤보는 고른 뒤에
     <c>bind</c> 가 초점을 본문으로 되돌린다. */
  function onMouseDown(e) {
    var tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
    if (tag === 'SELECT' || tag === 'OPTION' || tag === 'INPUT') return;
    e.preventDefault();
  }

  function onClick(e) {
    var btn = e.target.closest ? e.target.closest('button') : null;
    if (!btn) return;

    var act = btn.getAttribute('data-act');
    if (act) { if (act === 'undo') hwInput.undo(); else hwInput.redo(); hwInput.focus(); return; }

    var fmt = btn.getAttribute('data-fmt');
    if (fmt === 'sup' || fmt === 'sub') { hwFormat.toggleScript(fmt); hwInput.focus(); return; }
    if (fmt === 'noShade') { hwFormat.setShade(null); hwInput.focus(); return; }
    if (fmt) { hwFormat.toggleChar(fmt); hwInput.focus(); return; }

    var align = btn.getAttribute('data-align');
    if (align) { hwFormat.setAlign(align); hwInput.focus(); return; }

    var ind = btn.getAttribute('data-indent');
    if (ind) { hwFormat.indent(parseInt(ind, 10)); hwInput.focus(); return; }

    var zoom = btn.getAttribute('data-zoom');
    if (zoom) {
      if (zoom === 'width' || zoom === 'page') fitZoom(zoom);
      else if (zoom === '1' || zoom === '-1') stepZoom(parseInt(zoom, 10));
      else setZoom(parseInt(zoom, 10));
      hwInput.focus();
      return;
    }

    var head = btn.getAttribute('data-head');
    if (head) { hwFormat.toggleHead(head); hwInput.focus(); return; }

    var lvl = btn.getAttribute('data-lvl');
    if (lvl) { hwFormat.stepLevel(parseInt(lvl, 10)); hwInput.focus(); return; }

    var obj = btn.getAttribute('data-obj');
    if (obj === 'inline') {
      if (!hwObj.current()) { hwSetStatus({ text: '그림을 먼저 고르세요' }); hwInput.focus(); return; }
      hwObj.toggleInline();
      hwInput.focus();
      return;
    }

    var tbl = btn.getAttribute('data-tbl');
    if (tbl) {
      /* 표 만들기만 표 밖에서 누르는 단추다 — 나머지는 칸에 커서가 있어야 뜻이 있다. */
      if (tbl === 'newTable') { hwDialog.tableInsert(); return; }
      if (!hwTable.here()) { hwSetStatus({ text: '표 안에 커서를 두세요' }); hwInput.focus(); return; }
      if (tbl === 'addRow') hwTable.addRow(1);
      else if (tbl === 'delRow') hwTable.delRow();
      else if (tbl === 'addCol') hwTable.addCol(1);
      else if (tbl === 'delCol') hwTable.delCol();
      else if (tbl === 'delTable') hwTable.removeTable();
      hwInput.focus();
      return;
    }
  }

  /* 우클릭 메뉴. 항목 { label, key, fn, disabled, checked, sub:[…] } 또는 '-'(구분선). 하위 메뉴는 한 단계.
     ★ 메뉴 위 mousedown 을 막는다 — 초점이 수신기에 남아 있어야 execCommand('copy') 가 우리 copy 수신기를 태우고,
       닫은 뒤에 친 키가 문서로 간다. 키(↑↓→←·Enter·Esc)는 수신기 keydown 이 먼저 여기로 넘긴다(hwInput.onKeyDown). */
  var cMenu = null;

  function showMenu(items, x, y) {
    closeMenu();
    var m = buildMenu(items);
    document.body.appendChild(m);
    placeMenu(m, x, y);
    cMenu = { root: m, sub: null };
    document.addEventListener('mousedown', onDocDown, true);
    window.addEventListener('blur', closeMenu);
    var cv = el('hwCanvas');
    if (cv) cv.addEventListener('scroll', closeMenu);
  }

  function closeMenu() {
    if (!cMenu) return;
    var m = cMenu;
    cMenu = null;
    if (m.sub && m.sub.parentNode) m.sub.parentNode.removeChild(m.sub);
    if (m.root.parentNode) m.root.parentNode.removeChild(m.root);
    document.removeEventListener('mousedown', onDocDown, true);
    window.removeEventListener('blur', closeMenu);
    var cv = el('hwCanvas');
    if (cv) cv.removeEventListener('scroll', closeMenu);
  }

  function onDocDown(e) {
    if (!cMenu) return;
    if (cMenu.root.contains(e.target) || (cMenu.sub && cMenu.sub.contains(e.target))) return;
    closeMenu();
  }

  function buildMenu(items) {
    var m = document.createElement('div');
    m.className = 'hw-ctx';
    m._items = items;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it === '-') { m.appendChild(div('hw-ctx-sep')); continue; }
      var row = div('hw-ctx-item' + (it.disabled ? ' dis' : '') + (it.checked ? ' chk' : ''));
      row.setAttribute('data-idx', String(i));
      var lab = document.createElement('span');
      lab.textContent = it.label;
      var tail = document.createElement('span');
      tail.className = 'hw-ctx-key';
      tail.textContent = it.sub ? '▸' : (it.key || '');
      row.appendChild(lab);
      row.appendChild(tail);
      m.appendChild(row);
    }
    m.addEventListener('mousedown', function (e) { e.preventDefault(); });
    m.addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('.hw-ctx-item') : null;
      if (row) activate(m, row);
    });
    m.addEventListener('mouseover', function (e) {
      var row = e.target.closest ? e.target.closest('.hw-ctx-item') : null;
      if (!row) return;
      highlight(m, row);
      var it = m._items[parseInt(row.getAttribute('data-idx'), 10)];
      if (m === (cMenu && cMenu.root)) { if (it.sub && !it.disabled) openSub(row, it.sub); else closeSub(); }
    });
    return m;
  }

  function div(cls) { var d = document.createElement('div'); d.className = cls; return d; }

  function placeMenu(m, x, y) {
    var w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(0, Math.min(x, window.innerWidth - w - 2)) + 'px';
    m.style.top = Math.max(0, Math.min(y, window.innerHeight - h - 2)) + 'px';
  }

  function openSub(row, items) {
    if (cMenu.sub && cMenu.sub._from === row) return;
    closeSub();
    var s = buildMenu(items);
    s._from = row;
    document.body.appendChild(s);
    var r = row.getBoundingClientRect();
    placeMenu(s, r.right - 2, r.top - 3);
    if (parseFloat(s.style.left) < r.right - 2) s.style.left = Math.max(0, r.left - s.offsetWidth + 2) + 'px';
    cMenu.sub = s;
  }

  function closeSub() {
    if (cMenu && cMenu.sub) {
      if (cMenu.sub.parentNode) cMenu.sub.parentNode.removeChild(cMenu.sub);
      cMenu.sub = null;
    }
  }

  function highlight(m, row) {
    var olds = m.querySelectorAll('.hw-ctx-item.hi');
    for (var i = 0; i < olds.length; i++) olds[i].classList.remove('hi');
    if (row) row.classList.add('hi');
  }

  function activate(m, row) {
    var it = m._items[parseInt(row.getAttribute('data-idx'), 10)];
    if (!it || it.disabled) return;
    if (it.sub) { openSub(row, it.sub); return; }
    closeMenu();
    hwInput.focus();          /* fn 보다 먼저 — 대화상자를 여는 항목은 fn 이 초점을 대화상자로 옮긴다 */
    if (it.fn) it.fn();
  }

  function menuKey(e) {
    if (!cMenu) return false;
    var m = cMenu.sub || cMenu.root;
    var rows = [], all = m.querySelectorAll('.hw-ctx-item');
    for (var i = 0; i < all.length; i++) if (!all[i].classList.contains('dis')) rows.push(all[i]);
    var hi = m.querySelector('.hw-ctx-item.hi'), at = rows.indexOf(hi);

    switch (e.key) {
      case 'Escape':
        if (cMenu.sub) closeSub(); else closeMenu();
        return true;
      case 'ArrowDown': highlight(m, rows[(at + 1) % rows.length] || null); return true;
      case 'ArrowUp': highlight(m, rows[at <= 0 ? rows.length - 1 : at - 1] || null); return true;
      case 'ArrowRight':
        if (hi && !cMenu.sub) {
          var it = m._items[parseInt(hi.getAttribute('data-idx'), 10)];
          if (it.sub) { openSub(hi, it.sub); highlight(cMenu.sub, cMenu.sub.querySelector('.hw-ctx-item:not(.dis)')); }
        }
        return true;
      case 'ArrowLeft': if (cMenu.sub) closeSub(); return true;
      case 'Enter': if (hi) activate(m, hi); return true;
    }
    closeMenu();
    return false;
  }

  /* 덤프 2 — 이번 세션은 본문·표 칸·그림 세 맥락, 그리고 이미 있는 함수만 잇는다(선택 ▸·셀 합치기·나누기는 세션 3). */
  function contextItems(kind) {
    var sel = !!hwCaret.selection();
    function clipTo(k) { return function () { hwInput.clip(k); }; }

    if (kind === 'obj') {
      var cur = hwObj.current();
      return [
        { label: '잘라내기', key: 'Ctrl+X', disabled: true },
        { label: '복사', key: 'Ctrl+C', disabled: true },
        { label: '붙여넣기', key: 'Ctrl+V', fn: clipTo('paste') },
        { label: '지우기', key: 'Delete', fn: function () { hwObj.remove(); } },
        '-',
        { label: '글자처럼 취급', checked: !!(cur && cur.obj.inline), fn: function () { hwObj.toggleInline(); } },
        { label: '배치', sub: [
          { label: '어울림', checked: !!(cur && !cur.obj.inline && cur.obj.flow === 'fit'),
            fn: function () { hwObj.setFlow('fit'); } },
          { label: '자리 차지', checked: !!(cur && !cur.obj.inline && cur.obj.flow === 'takePlace'),
            fn: function () { hwObj.setFlow('takePlace'); } },
          { label: '글 뒤로', checked: !!(cur && cur.obj.flow === 'behind'),
            fn: function () { hwObj.setFlow('behind'); } },
          { label: '글 앞으로', checked: !!(cur && cur.obj.flow === 'front'),
            fn: function () { hwObj.setFlow('front'); } }
        ] },
        '-',
        { label: '앞으로 가져오기', fn: function () { hwObj.setZ(+1); } },
        { label: '뒤로 보내기', fn: function () { hwObj.setZ(-1); } },
        { label: '맨 앞으로', fn: function () { hwObj.setZ(+2); } },
        { label: '맨 뒤로', fn: function () { hwObj.setZ(-2); } }
      ];
    }

    var items = [
      { label: '잘라내기', key: 'Ctrl+X', disabled: !sel, fn: clipTo('cut') },
      { label: '복사', key: 'Ctrl+C', disabled: !sel, fn: clipTo('copy') },
      { label: '붙여넣기', key: 'Ctrl+V', fn: clipTo('paste') },
      { label: '지우기', key: 'Delete', disabled: !sel, fn: clipTo('delete') },
      '-'
    ];
    if (kind === 'cell') {
      /* 마지막 줄·칸은 지울 수 없다(hwTable 이 되돌려 보낸다) — 누르면 아무 일도 안 나는 항목이 되지 않게 흐리게 둔다. */
      var blk = hwTable.blockCells();
      var t = hwTable.here().obj.table, rows = 0, cols = 0;
      for (var i = 0; i < t.cells.length; i++) {
        rows = Math.max(rows, t.cells[i].r + (t.cells[i].rs || 1));
        cols = Math.max(cols, t.cells[i].c + (t.cells[i].cs || 1));
      }
      items.push(
        { label: '줄/칸 추가하기', sub: [
          { label: '위에 줄 추가', fn: function () { hwTable.addRow(-1); } },
          { label: '아래에 줄 추가', fn: function () { hwTable.addRow(1); } },
          { label: '왼쪽에 칸 추가', fn: function () { hwTable.addCol(-1); } },
          { label: '오른쪽에 칸 추가', fn: function () { hwTable.addCol(1); } },
          '-',
          { label: '개수 지정…', key: 'Alt+Insert', fn: function () { hwDialog.tableLines(false); } }
        ] },
        { label: '줄 지우기', disabled: rows <= 1, fn: function () { hwTable.delRow(); } },
        { label: '칸 지우기', disabled: cols <= 1, fn: function () { hwTable.delCol(); } },
        { label: '줄/칸 지우기…', key: 'Alt+Delete', disabled: rows <= 1 && cols <= 1,
          fn: function () { hwDialog.tableLines(true); } },
        { label: '표 지우기', fn: function () { hwTable.removeTable(); } },
        '-',
        { label: '선택', key: 'F5', sub: [
          { label: '셀', fn: function () { hwTable.selectRange('cell'); } },
          { label: '칸', fn: function () { hwTable.selectRange('col'); } },
          { label: '줄', fn: function () { hwTable.selectRange('row'); } },
          { label: '표', fn: function () { hwTable.selectRange('table'); } }
        ] },
        { label: '셀 합치기', key: 'M', disabled: !blk || blk.cells.length < 2,
          fn: function () { hwTable.mergeBlock(); } },
        { label: '셀 나누기…', key: 'S', fn: function () { hwDialog.tableSplit(); } },
        { label: '셀 너비를 같게', key: 'W', disabled: !blk || blk.rect.c1 <= blk.rect.c0,
          fn: function () { hwTable.sameSize(true); } },
        { label: '셀 높이를 같게', key: 'H', disabled: !blk || blk.rect.r1 <= blk.rect.r0,
          fn: function () { hwTable.sameSize(false); } },
        '-',
        { label: '테두리/배경…', key: 'B', fn: function () { hwDialog.cellBorder(); } },
        { label: '셀 맞춤', sub: [
          { label: '위쪽', fn: function () { hwTable.setCellFmt({ valign: 0 }); } },
          { label: '가운데', fn: function () { hwTable.setCellFmt({ valign: 1 }); } },
          { label: '아래쪽', fn: function () { hwTable.setCellFmt({ valign: 2 }); } }
        ] },
        { label: '표 속성…', key: 'P', fn: function () { hwDialog.tableProps(); } },
        '-');
    }
    if (kind !== 'cell')
      items.push({ label: '표 만들기…', key: 'Ctrl+N,T', fn: function () { hwDialog.tableInsert(); } }, '-');
    items.push(
      { label: '글자 모양…', key: 'Alt+L', fn: function () { hwDialog.charShape(); } },
      { label: '문단 모양…', key: 'Alt+T', fn: function () { hwDialog.paraShape(); } },
      '-',
      { label: '문자표…', key: 'Ctrl+F10', fn: function () { hwDialog.charMap(); } },
      { label: '하이퍼링크…', key: 'Ctrl+K,H', fn: function () { hwDialog.hyperlink(); } },
      '-',
      { label: '페이지 설정…', key: 'F7', fn: function () { hwDialog.pageSetup(); } },
      { label: '쪽 번호 매기기…', fn: function () { hwDialog.pageNumber(); } },
      { label: '머리말', sub: [
        { label: '머리말 넣기…', fn: function () { hwDialog.bandInsert('head'); } },
        { label: '꼬리말 넣기…', fn: function () { hwDialog.bandInsert('foot'); } }
      ] },
      { label: '단', sub: [
        { label: '하나', fn: setCols(1) },
        { label: '둘', fn: setCols(2) },
        { label: '셋', fn: setCols(3) }
      ] });
    return items;
  }

  /* 쪽 ▸ 단 ▸ 하나·둘·셋(덤프 1). 단 사이는 한글 기본값 8mm 다 — 값이 이미 있으면 그대로 둔다. */
  function setCols(n) {
    return function () {
      var si = hwPage.caretSection();
      var gap = hwDoc.sections[si].cols.gapHu || 0;
      hwPage.setSection(si, { colCount: n, colGap: n > 1 && gap <= 0 ? 2268 : gap });
    };
  }

  /* 스타일 콤보. ★ 글자 스타일은 안 올린다 — 문단에 걸 수 없다. */
  /* 리본 탭. ★ 안 고른 판도 <b>DOM 에 그대로</b> 둔다(CSS 로만 감춘다) — hwUi.refresh 와 --ui-test 가
     안 보이는 탭의 단추도 속성으로 찾아 쓴다. */
  function initTabs() {
    var tabs = el('hwRibbonTabs');
    if (!tabs) return;

    tabs.addEventListener('mousedown', function (e) { e.preventDefault(); });
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.hw-rb-tab') : null;
      if (b) { showTab(b.getAttribute('data-rb')); hwInput.focus(); }
    });
  }

  function showTab(name) {
    var tabs = el('hwRibbonTabs'), panes = el('hwTools');
    if (!tabs || !panes) return;

    var t = tabs.querySelectorAll('.hw-rb-tab');
    for (var i = 0; i < t.length; i++) t[i].classList.toggle('on', t[i].getAttribute('data-rb') === name);

    var q = panes.querySelectorAll('.hw-rb-pane');
    for (var k = 0; k < q.length; k++) q[k].classList.toggle('on', q[k].getAttribute('data-rb') === name);
  }

  function loadStyles() {
    var sel = el('hwStyle');
    if (!sel || !hwDoc) return;

    var list = hwFormat.styles();
    sel.innerHTML = '';
    for (var i = 0; i < list.length; i++) {
      var o = document.createElement('option');
      o.value = String(list[i].id);
      o.textContent = list[i].name || ('스타일 ' + list[i].id);
      sel.appendChild(o);
    }
    sel.disabled = !list.length;
  }

  function loadFonts() {
    var sel = el('hwFont');
    if (!sel || !hwDoc) return;

    sel.innerHTML = '';
    for (var i = 0; i < hwDoc.faceNames.length; i++) {
      var f = hwDoc.faceNames[i];
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = f.name || ('글꼴 ' + i);
      sel.appendChild(o);
    }
  }

  function refresh() {
    if (!cReady || !hwDoc) return;

    var st = hwFormat.state();
    if (!st) return;

    mark('bold', !!st.cs.bold);
    mark('italic', !!st.cs.italic);
    mark('underline', (st.cs.underline || 0) !== 0);
    mark('strike', !!st.cs.strike);
    mark('sup', !!st.cs.sup);
    mark('sub', !!st.cs.sub);

    var bar = el('hwTools');
    var aligns = bar.querySelectorAll('[data-align]');
    for (var i = 0; i < aligns.length; i++)
      aligns[i].classList.toggle('on', aligns[i].getAttribute('data-align') === st.ps.align);

    var heads = bar.querySelectorAll('[data-head]');
    for (var h = 0; h < heads.length; h++)
      heads[h].classList.toggle('on', heads[h].getAttribute('data-head') === st.ps.head);

    /* 표 단추는 표 안에 있을 때만 살린다 — 밖에서 누르면 아무 일도 안 일어나는 단추가 된다. */
    var inTable = !!hwTable.here();
    var tbls = bar.querySelectorAll('[data-tbl]');
    for (var t = 0; t < tbls.length; t++)
      tbls[t].disabled = tbls[t].getAttribute('data-tbl') === 'newTable' ? inTable : !inTable;

    /* 개체 단추도 같다 — 고른 그림이 있을 때만. 눌린 상태는 지금 취급을 비춘다. */
    var objSel = window.hwObj ? hwObj.current() : null;
    var objBtn = bar.querySelector('[data-obj="inline"]');
    if (objBtn) {
      objBtn.disabled = !objSel;
      objBtn.classList.toggle('on', !!objSel && !!objSel.obj.inline);
    }

    var pr = hwCaret.para();
    if (pr) set(el('hwStyle'), String(pr.sty || 0));
    set(el('hwFont'), String(st.cs.face));
    set(el('hwSize'), String(Math.round(st.cs.sizeHu / 100)));
    set(el('hwColor'), st.cs.color || '#000000');
    if (st.cs.shade) set(el('hwShade'), st.cs.shade);
    if (st.ps.lsType === 'percent') set(el('hwLine'), String(st.ps.ls));

    var ub = bar.querySelector('[data-act="undo"]'), rb = bar.querySelector('[data-act="redo"]');
    if (ub) ub.disabled = !hwUndo.canUndo();
    if (rb) rb.disabled = !hwUndo.canRedo();

    var pn = el('hwPageNo');
    if (pn) pn.textContent = curPage() + ' / ' + hwPageCount() + '쪽';
  }

  function mark(name, on) {
    var b = document.querySelector('[data-fmt="' + name + '"]');
    if (b) b.classList.toggle('on', on);
  }

  function set(sel, v) {
    if (!sel) return;
    if (sel.tagName === 'SELECT') {
      /* 목록에 없는 값이면 하나 끼워 넣는다 — 안 그러면 엉뚱한 값이 보인다. */
      var has = false;
      for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === v) { has = true; break; }
      if (!has) {
        var o = document.createElement('option');
        o.value = v;
        o.textContent = sel.id === 'hwSize' ? v + 'pt' : v;
        sel.appendChild(o);
      }
    }
    sel.value = v;
  }

  return {
    init: init, refresh: refresh, loadFonts: loadFonts, loadStyles: loadStyles, showTab: showTab,
    setZoom: setZoom, stepZoom: stepZoom, fitZoom: fitZoom, zoom: zoomPct, curPage: curPage,
    showMenu: showMenu, closeMenu: closeMenu, menuKey: menuKey, contextItems: contextItems,
    menuEl: function () { return cMenu ? cMenu.root : null; },
    subMenuEl: function () { return cMenu ? cMenu.sub : null; }
  };
})();
