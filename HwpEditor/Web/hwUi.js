/* 서식 도구줄(4단계). 메뉴와 마찬가지로 전부 문서 안에 있다 — WinForms 쪽은 파일 대화상자만 연다.

   ★ 도구줄에 마우스를 눌러도 <b>캐럿 초점을 뺏지 않는다</b>. 초점이 넘어가면 선택이 사라져서,
     굵게를 누르는 순간 무엇에 걸어야 할지 모르게 된다(mousedown 에서 기본 동작을 막는다).
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
       화살표만 남아서, 고장 난 것처럼 보인다(실측 화면). 문서를 열면 loadFonts 가 갈아 끼운다. */
    fill(el('hwFont'), ['-'], function () { return '(문서 없음)'; });

    bar.addEventListener('mousedown', onMouseDown);
    bar.addEventListener('click', onClick);

    bind(el('hwFont'), function (v) { hwFormat.applyChar({ face: parseInt(v, 10) }); });
    bind(el('hwSize'), function (v) { hwFormat.applyChar({ sizeHu: parseInt(v, 10) * 100 }); });
    bind(el('hwColor'), function (v) { hwFormat.applyChar({ color: v }); });
    bind(el('hwLine'), function (v) { hwFormat.applyPara({ lsType: 'percent', ls: parseInt(v, 10) }); });

    cReady = true;
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
     동작으로 목록을 펼치는데, 그것을 막으면 눌러도 <b>아무 일이 안 일어난다</b>(실측 — 글꼴·크기·
     줄간격·글자색 넷 다 안 열렸다). 초점을 지켜야 하는 것은 단추뿐이고, 콤보는 고른 뒤에
     <c>bind</c> 가 초점을 본문으로 되돌린다. */
  function onMouseDown(e) {
    var tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : '';
    if (tag === 'SELECT' || tag === 'OPTION' || tag === 'INPUT') return;
    e.preventDefault();
  }

  function onClick(e) {
    var btn = e.target.closest ? e.target.closest('button') : null;
    if (!btn) return;

    var fmt = btn.getAttribute('data-fmt');
    if (fmt) { hwFormat.toggleChar(fmt); hwInput.focus(); return; }

    var align = btn.getAttribute('data-align');
    if (align) { hwFormat.applyPara({ align: align }); hwInput.focus(); return; }

    var ind = btn.getAttribute('data-indent');
    if (ind) { hwFormat.indent(parseInt(ind, 10)); hwInput.focus(); return; }

    var obj = btn.getAttribute('data-obj');
    if (obj === 'inline') {
      if (!hwObj.current()) { hwSetStatus({ text: '그림을 먼저 고르세요' }); hwInput.focus(); return; }
      hwObj.toggleInline();
      hwInput.focus();
      return;
    }

    var tbl = btn.getAttribute('data-tbl');
    if (tbl) {
      if (!hwTable.here()) { hwSetStatus({ text: '표 안에 커서를 두세요' }); hwInput.focus(); return; }
      if (tbl === 'addRow') hwTable.addRow(1);
      else if (tbl === 'delRow') hwTable.delRow();
      else if (tbl === 'addCol') hwTable.addCol(1);
      else if (tbl === 'delCol') hwTable.delCol();
      hwInput.focus();
      return;
    }
  }

  /* 문서를 열 때 글꼴 목록을 채운다 — 문서마다 쓰는 글꼴이 다르다. */
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

  /* 캐럿 자리의 서식을 도구줄에 비춘다. */
  function refresh() {
    if (!cReady || !hwDoc) return;

    var st = hwFormat.state();
    if (!st) return;

    mark('bold', !!st.cs.bold);
    mark('italic', !!st.cs.italic);
    mark('underline', (st.cs.underline || 0) !== 0);
    mark('strike', !!st.cs.strike);

    var bar = el('hwTools');
    var aligns = bar.querySelectorAll('[data-align]');
    for (var i = 0; i < aligns.length; i++)
      aligns[i].classList.toggle('on', aligns[i].getAttribute('data-align') === st.ps.align);

    /* 표 단추는 표 안에 있을 때만 살린다 — 밖에서 누르면 아무 일도 안 일어나는 단추가 된다. */
    var inTable = !!hwTable.here();
    var tbls = bar.querySelectorAll('[data-tbl]');
    for (var t = 0; t < tbls.length; t++) tbls[t].disabled = !inTable;

    /* 개체 단추도 같다 — 고른 그림이 있을 때만. 눌린 상태는 지금 취급을 비춘다. */
    var objSel = window.hwObj ? hwObj.current() : null;
    var objBtn = bar.querySelector('[data-obj="inline"]');
    if (objBtn) {
      objBtn.disabled = !objSel;
      objBtn.classList.toggle('on', !!objSel && !!objSel.obj.inline);
    }

    set(el('hwFont'), String(st.cs.face));
    set(el('hwSize'), String(Math.round(st.cs.sizeHu / 100)));
    set(el('hwColor'), st.cs.color || '#000000');
    if (st.ps.lsType === 'percent') set(el('hwLine'), String(st.ps.ls));
  }

  function mark(name, on) {
    var b = document.querySelector('[data-fmt="' + name + '"]');
    if (b) b.classList.toggle('on', on);
  }

  function set(sel, v) {
    if (!sel) return;
    if (sel.tagName === 'SELECT') {
      /* 목록에 없는 값(문서가 쓰는 크기)이면 하나 끼워 넣는다 — 안 그러면 엉뚱한 값이 보인다. */
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

  return { init: init, refresh: refresh, loadFonts: loadFonts };
})();
