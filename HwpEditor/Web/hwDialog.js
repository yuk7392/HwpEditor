/* ★ 대화상자는 찾기 창과 같은 층(흐름 밖)에 띄운다 — 도구줄처럼 세로로 쌓으면 캔버스 높이가 바뀌어 가상 스크롤이 흔들린다.
   ★ 배경막이 누르기를 다 받는다. 본문을 누를 수 있으면 캐럿이 옮겨 가 초점이 수신기로 넘어가고, 대화상자는 뜬 채
     키가 문서로 들어간다.
   ★ "바뀐 칸" 은 값 비교가 아니라 input·change 이벤트로 가린다 — 섞인 칸(빈 칸)에 원래와 같은 값을 넣은 것도
     바꾼 것이다. */

var hwDialog = (function () {
  'use strict';

  var cOpen = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function fmt(v, dec) {
    if (v === null || v === undefined || isNaN(v)) return '';
    var m = Math.pow(10, dec || 0);
    return String(Math.round(v * m) / m);
  }

  function open(spec) {
    close();

    var back = el('div', 'hw-dlg-back');
    var box = el('div', 'hw-dlg');
    if (spec.width) box.style.width = spec.width + 'px';
    box.appendChild(el('div', 'hw-dlg-title', spec.title || ''));

    var st = {
      el: box, back: back, spec: spec, fields: {}, rows: {}, touched: {},
      get: function (k) { return getValue(st, k); },
      set: function (k, v) { setValue(st, k, v); },
      field: function (k) { return st.fields[k] || null; },
      button: function (label) {
        var bs = box.querySelectorAll('.hw-dlg-btns button');
        for (var i = 0; i < bs.length; i++) if (bs[i].textContent === label) return bs[i];
        return null;
      },
      close: function () { close(); }
    };

    var tabs = spec.tabs || [{ rows: spec.rows || [] }];
    var strip = tabs.length > 1 ? el('div', 'hw-dlg-tabs') : null;
    if (strip) box.appendChild(strip);
    var pages = [];
    for (var t = 0; t < tabs.length; t++) {
      var page = el('div', 'hw-dlg-page');
      page.hidden = t > 0;
      for (var r = 0; r < (tabs[t].rows || []).length; r++) buildRow(st, page, tabs[t].rows[r]);
      box.appendChild(page);
      pages.push(page);
      if (strip) {
        var tb = el('button', 'hw-dlg-tab' + (t === 0 ? ' on' : ''), tabs[t].label || '');
        tb.type = 'button';
        tb.setAttribute('data-tab', String(t));
        strip.appendChild(tb);
      }
    }
    st.pages = pages;

    var btns = el('div', 'hw-dlg-btns');
    var bl = spec.buttons || [{ label: '설정', ok: true }, { label: '취소', cancel: true }];
    for (var b = 0; b < bl.length; b++) {
      var be = el('button', bl[b].ok ? 'hw-dlg-ok' : '', bl[b].label);
      be.type = 'button';
      be.setAttribute('data-btn', String(b));
      btns.appendChild(be);
    }
    box.appendChild(btns);

    back.appendChild(box);
    back.addEventListener('mousedown', function (e) { if (e.target === back) e.preventDefault(); });
    box.addEventListener('click', function (e) { onClick(st, e); });
    box.addEventListener('input', function (e) { onEdit(st, e); });
    box.addEventListener('change', function (e) { onEdit(st, e); });
    box.addEventListener('keydown', function (e) { onKey(st, e); });
    document.body.appendChild(back);
    cOpen = st;

    var f = focusables(box);
    if (f.length) f[0].focus();
    return st;
  }

  function close() {
    if (!cOpen) return;
    var st = cOpen;
    cOpen = null;
    if (st.back.parentNode) st.back.parentNode.removeChild(st.back);
    hwInput.focus();
  }

  function ok(st) {
    if (st.spec.onOk && st.spec.onOk(st) === false) return;
    if (cOpen === st) close();
  }

  function focusables(box) {
    var all = box.querySelectorAll('input, select, button, [tabindex]');
    var out = [];
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (e.disabled || e.tabIndex < 0) continue;
      if (e.closest('.hw-dlg-page') && e.closest('.hw-dlg-page').hidden) continue;
      out.push(e);
    }
    return out;
  }

  /* 행 종류: number(단위·위아래·min/max) · select · toggles(누름 단추 묶음) · radio · color · group(한 줄에 여럿) ·
     note · custom(build 로 직접 채움). 값을 안 주면(null) 빈 칸으로 — 섞인 값이다. */
  function buildRow(st, parent, row) {
    var line = el('div', 'hw-dlg-row');
    if (row.label !== undefined) line.appendChild(el('label', 'hw-dlg-label', row.label));
    var body = el('div', 'hw-dlg-cell');
    line.appendChild(body);
    parent.appendChild(line);

    if (row.type === 'group') {
      for (var i = 0; i < row.items.length; i++) buildField(st, body, row.items[i]);
    } else if (row.type === 'note') {
      body.appendChild(el('span', 'hw-dlg-note', row.text || ''));
    } else {
      buildField(st, body, row);
    }
    if (row.disabled) line.classList.add('off');
  }

  function buildField(st, parent, row) {
    var e;
    switch (row.type) {
      case 'number':
        e = el('input', 'hw-dlg-num');
        e.type = 'number';
        if (row.min !== undefined) e.min = String(row.min);
        if (row.max !== undefined) e.max = String(row.max);
        e.step = String(row.step || 1);
        e.value = fmt(row.value, row.dec);
        break;
      case 'select':
        e = el('select', 'hw-dlg-sel');
        if (row.value === null || row.value === undefined) e.appendChild(option('', ''));
        for (var i = 0; i < (row.options || []).length; i++) e.appendChild(option(row.options[i].v, row.options[i].t));
        e.value = row.value === null || row.value === undefined ? '' : String(row.value);
        break;
      case 'color':
        e = el('input', 'hw-dlg-color');
        e.type = 'color';
        e.value = row.value || '#000000';
        break;
      case 'text':
        e = el('input', 'hw-dlg-text');
        e.type = 'text';
        e.value = row.value || '';
        break;
      case 'check':
        e = el('input', 'hw-dlg-check');
        e.type = 'checkbox';
        e.checked = !!row.value;
        break;
      case 'toggles':
        e = el('span', 'hw-dlg-toggles');
        for (var t = 0; t < row.items.length; t++) {
          var it = row.items[t];
          var tb = el('button', 'hw-dlg-tog', it.label);
          tb.type = 'button';
          if (it.title) tb.title = it.title;
          tb.setAttribute('data-key', it.key);
          tb.disabled = !!it.disabled;
          st.fields[it.key] = tb;
          st.rows[it.key] = it;
          paintToggle(tb, it.on === undefined ? null : it.on);
          e.appendChild(tb);
        }
        parent.appendChild(e);
        return;
      case 'radio':
        e = el('span', 'hw-dlg-radio');
        e.setAttribute('data-value', row.value === null || row.value === undefined ? '' : String(row.value));
        for (var r = 0; r < row.options.length; r++) {
          var rb = el('button', 'hw-dlg-rad', row.options[r].t);
          rb.type = 'button';
          rb.setAttribute('data-v', String(row.options[r].v));
          e.appendChild(rb);
        }
        paintRadio(e);
        break;
      case 'custom':
        e = el('div', 'hw-dlg-custom');
        break;
      default:
        return;
    }
    if (row.width) e.style.width = row.width + 'px';
    if (row.key) { e.setAttribute('data-key', row.key); st.fields[row.key] = e; st.rows[row.key] = row; }
    if (row.disabled) e.disabled = true;
    parent.appendChild(e);
    if (row.unit !== undefined) {
      var u = el('span', 'hw-dlg-unit', row.unit);
      parent.appendChild(u);
      if (row.key) st.fields[row.key + ':unit'] = u;
    }
    if (row.type === 'custom' && row.build) row.build(e, st);
  }

  function option(v, t) {
    var o = document.createElement('option');
    o.value = String(v);
    o.textContent = t;
    return o;
  }

  function paintToggle(b, on) {
    b.setAttribute('data-on', on === null ? 'mixed' : on ? '1' : '0');
    b.classList.toggle('on', on === true);
    b.classList.toggle('mixed', on === null);
  }

  function paintRadio(box) {
    var v = box.getAttribute('data-value');
    var bs = box.querySelectorAll('.hw-dlg-rad');
    for (var i = 0; i < bs.length; i++) bs[i].classList.toggle('on', bs[i].getAttribute('data-v') === v);
  }

  function getValue(st, k) {
    var e = st.fields[k];
    if (!e) return null;
    if (e.classList.contains('hw-dlg-tog')) {
      var on = e.getAttribute('data-on');
      return on === 'mixed' ? null : on === '1';
    }
    if (e.classList.contains('hw-dlg-radio')) return e.getAttribute('data-value') || null;
    if (e.type === 'checkbox') return e.checked;
    if (e.type === 'number') {
      var n = parseFloat(e.value);
      return isNaN(n) ? null : n;
    }
    return e.value === '' ? null : e.value;
  }

  function setValue(st, k, v) {
    var e = st.fields[k];
    if (!e) return;
    if (e.classList.contains('hw-dlg-tog')) { paintToggle(e, v); return; }
    if (e.classList.contains('hw-dlg-radio')) { e.setAttribute('data-value', v === null ? '' : String(v)); paintRadio(e); return; }
    if (e.type === 'checkbox') { e.checked = !!v; return; }
    if (e.type === 'number') { e.value = fmt(v, (st.rows[k] || {}).dec); return; }
    e.value = v === null || v === undefined ? '' : String(v);
  }

  function touch(st, k) {
    st.touched[k] = true;
    var row = st.rows[k];
    if (row && row.onChange) row.onChange(getValue(st, k), st);
  }

  function onEdit(st, e) {
    var f = e.target.closest ? e.target.closest('[data-key]') : null;
    if (f && !f.classList.contains('hw-dlg-tog') && !f.classList.contains('hw-dlg-radio')) touch(st, f.getAttribute('data-key'));
  }

  function onClick(st, e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b || b.disabled) return;

    if (b.hasAttribute('data-tab')) {
      var n = parseInt(b.getAttribute('data-tab'), 10);
      for (var i = 0; i < st.pages.length; i++) st.pages[i].hidden = i !== n;
      var tabs = st.el.querySelectorAll('.hw-dlg-tab');
      for (var t = 0; t < tabs.length; t++) tabs[t].classList.toggle('on', t === n);
      return;
    }
    if (b.classList.contains('hw-dlg-tog')) {
      paintToggle(b, b.getAttribute('data-on') !== '1');
      touch(st, b.getAttribute('data-key'));
      return;
    }
    if (b.classList.contains('hw-dlg-rad')) {
      var box = b.parentNode;
      box.setAttribute('data-value', b.getAttribute('data-v'));
      paintRadio(box);
      touch(st, box.getAttribute('data-key'));
      return;
    }
    if (b.hasAttribute('data-btn')) {
      var spec = st.spec.buttons ? st.spec.buttons[parseInt(b.getAttribute('data-btn'), 10)] : null;
      var isOk = spec ? !!spec.ok : b.classList.contains('hw-dlg-ok');
      if (spec && spec.fn) { spec.fn(st); return; }
      if (isOk) ok(st); else close();
    }
  }

  function onKey(st, e) {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Enter') {
      var tag = e.target.tagName;
      if (tag === 'BUTTON') return;
      e.preventDefault();
      /* 숫자 칸은 Enter 로 확정할 때 change 가 안 올 수 있다 — 적어 둔 값을 바뀐 것으로 친다. */
      if (e.target.getAttribute && e.target.getAttribute('data-key') && tag === 'INPUT') touch(st, e.target.getAttribute('data-key'));
      ok(st);
      return;
    }
    if (e.key === 'Tab') {
      var f = focusables(st.el);
      if (!f.length) return;
      var i = f.indexOf(document.activeElement);
      var to = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i < 0 || i >= f.length - 1 ? 0 : i + 1);
      e.preventDefault();
      f[to].focus();
    }
  }

  var cMm = 283.465;

  /* 선 모양·굵기·강조점·외곽선·그림자 목록. ★ 값은 C# cBorderMap 의 이름·번호와 <b>같아야</b> 한다 —
     여기서 지어낸 이름은 저장할 때 "없음" 으로 떨어진다. 굵기는 덤프 5-4 의 16단. */
  var cLineTypes = [
    { v: 'none', t: '없음' }, { v: 'solid', t: '실선' }, { v: 'dash', t: '파선' }, { v: 'dot', t: '점선' },
    { v: 'dashDot', t: '일점쇄선' }, { v: 'dashDotDot', t: '이점쇄선' }, { v: 'longDash', t: '긴 파선' },
    { v: 'circleDot', t: '원점선' }, { v: 'double', t: '이중선' }, { v: 'thinThick', t: '얇고 굵은' },
    { v: 'thickThin', t: '굵고 얇은' }, { v: 'thinThickThin', t: '얇고 굵고 얇은' },
    { v: 'wave', t: '물결' }, { v: 'doubleWave', t: '이중 물결' }
  ];

  var cLineWidths = ['0.1', '0.12', '0.15', '0.2', '0.25', '0.3', '0.4', '0.5',
                     '0.6', '0.7', '1.0', '1.5', '2.0', '3.0', '4.0', '5.0'];

  var cOutlines = [{ v: '0', t: '없음' }, { v: '1', t: '실선' }, { v: '2', t: '점선' }, { v: '3', t: '굵은 실선' },
                   { v: '4', t: '파선' }, { v: '5', t: '일점쇄선' }, { v: '6', t: '이점쇄선' }];

  var cShadows = [{ v: '0', t: '없음' }, { v: '1', t: '비연속' }, { v: '2', t: '연속' }];

  var cEmphs = [{ v: '0', t: '없음' }, { v: '1', t: '위 점' }, { v: '2', t: '위 원' }, { v: '3', t: '틸데' },
                { v: '4', t: '캐론' }, { v: '5', t: '옆 점' }, { v: '6', t: '콜론' }, { v: '7', t: '그레이브' },
                { v: '8', t: '아큐트' }, { v: '9', t: '서컴플렉스' }, { v: '10', t: '마크론' },
                { v: '11', t: '후크' }, { v: '12', t: '아래 점' }];

  function widthOptions() {
    var out = [];
    for (var i = 0; i < cLineWidths.length; i++) out.push({ v: cLineWidths[i], t: cLineWidths[i] + ' mm' });
    return out;
  }

  function any(o) { for (var k in o) if (o.hasOwnProperty(k)) return true; return false; }

  function charShape() {
    if (!hwDoc) return null;
    var v = hwFormat.selectedChar();
    var faces = [];
    for (var i = 0; i < hwDoc.faceNames.length; i++)
      faces.push({ v: String(i), t: hwDoc.faceNames[i].name || ('글꼴 ' + i) });
    var sp = v.spacing;

    return open({
      title: '글자 모양', width: 440,
      rows: [
        { type: 'number', key: 'size', label: '크기', unit: 'pt', value: v.sizeHu === null ? null : v.sizeHu / 100,
          min: 1, max: 4096, step: 1, dec: 1, width: 80 },
        { type: 'select', key: 'face', label: '글꼴', options: faces, value: v.face === null ? null : String(v.face), width: 220 },
        { type: 'number', key: 'ratio', label: '장평', unit: '%', value: v.ratio, min: 50, max: 200, dec: 0, width: 80 },
        { type: 'group', label: '자간', items: [
          { type: 'select', key: 'spKind', width: 80, value: sp === null ? null : String(sp > 0 ? 1 : sp < 0 ? -1 : 0),
            options: [{ v: '0', t: '표준' }, { v: '1', t: '넓게' }, { v: '-1', t: '좁게' }],
            onChange: function (k, s) {
              var cur = Math.abs(s.get('spacing') || 0) || 5;
              s.set('spacing', k === '0' ? 0 : k === '1' ? cur : -cur);
              s.touched.spacing = true;
            } },
          { type: 'number', key: 'spacing', unit: '%', value: sp, min: -50, max: 50, dec: 0, width: 70,
            onChange: function (n, s) { if (n !== null) s.set('spKind', String(n > 0 ? 1 : n < 0 ? -1 : 0)); } }
        ] },
        { type: 'toggles', label: '속성', items: [
          { key: 'bold', label: '가', title: '굵게', on: v.bold },
          { key: 'italic', label: '가', title: '기울임', on: v.italic },
          { key: 'strike', label: '가', title: '취소선', on: v.strike },
          { key: 'sup', label: 'x²', title: '위 첨자', on: v.sup },
          { key: 'sub', label: 'x₂', title: '아래 첨자', on: v.sub },
          { key: 'emboss', label: '양', title: '양각', on: v.emboss },
          { key: 'engrave', label: '음', title: '음각', on: v.engrave }
        ] },
        { type: 'select', key: 'underline', label: '밑줄', width: 100,
          value: v.underline === null ? null : String(v.underline || 0),
          options: [{ v: '0', t: '없음' }, { v: '1', t: '아래' }, { v: '2', t: '가운데' }, { v: '3', t: '위' }] },
        { type: 'group', label: '밑줄 모양', items: [
          { type: 'select', key: 'ulShape', width: 110, value: v.ulShape, options: cLineTypes },
          { type: 'color', key: 'ulColor', value: v.ulColor || '#000000' }
        ] },
        { type: 'group', label: '외곽선·그림자', items: [
          { type: 'select', key: 'outline', width: 110, value: v.outline === null ? null : String(v.outline || 0),
            options: cOutlines },
          { type: 'select', key: 'shadow', width: 110, value: v.shadow === null ? null : String(v.shadow || 0),
            options: cShadows }
        ] },
        { type: 'select', key: 'emph', label: '강조점', width: 130,
          value: v.emph === null ? null : String(v.emph || 0), options: cEmphs },
        { type: 'group', label: '형광펜', items: [
          { type: 'color', key: 'shade', value: v.shade || '#FFFF00' },
          { type: 'check', key: 'noShade', label: '없음', value: !v.shade }
        ] },
        { type: 'color', key: 'color', label: '글자 색', value: v.color || '#000000' }
      ],
      onOk: function (s) {
        var over = {}, t = s.touched, n;
        if (t.size && (n = s.get('size')) !== null) over.sizeHu = Math.round(Math.max(1, Math.min(4096, n)) * 100);
        if (t.face && s.get('face') !== null) over.face = parseInt(s.get('face'), 10);
        if (t.ratio && (n = s.get('ratio')) !== null) over.ratio = Math.round(Math.max(50, Math.min(200, n)));
        if (t.spacing && (n = s.get('spacing')) !== null) over.spacing = Math.round(Math.max(-50, Math.min(50, n)));
        if (t.bold && s.get('bold') !== null) over.bold = s.get('bold');
        if (t.italic && s.get('italic') !== null) over.italic = s.get('italic');
        if (t.strike && s.get('strike') !== null) over.strike = s.get('strike');
        if (t.underline && s.get('underline') !== null) over.underline = parseInt(s.get('underline'), 10);
        if (t.sup || t.sub) {
          /* 위·아래 첨자는 같이 켜지지 않는다 — 방금 누른 쪽이 이긴다. */
          var wantSup = !!s.get('sup'), wantSub = !!s.get('sub');
          if (wantSup && wantSub) { if (t.sup) wantSub = false; else wantSup = false; }
          over.sup = wantSup; over.sub = wantSub;
        }
        if (t.emboss && s.get('emboss') !== null) over.emboss = s.get('emboss');
        if (t.engrave && s.get('engrave') !== null) over.engrave = s.get('engrave');
        if (t.ulShape && s.get('ulShape')) over.ulShape = s.get('ulShape');
        if (t.ulColor && s.get('ulColor')) over.ulColor = s.get('ulColor').toUpperCase();
        if (t.outline && s.get('outline') !== null) over.outline = parseInt(s.get('outline'), 10);
        if (t.shadow && s.get('shadow') !== null) over.shadow = parseInt(s.get('shadow'), 10);
        if (t.emph && s.get('emph') !== null) over.emph = parseInt(s.get('emph'), 10);
        if (t.shade || t.noShade) over.shade = s.get('noShade') ? null : (s.get('shade') || '#FFFF00').toUpperCase();
        if (t.color && s.get('color')) over.color = s.get('color').toUpperCase();
        if (any(over)) hwFormat.applyChar(over);
      }
    });
  }

  /* mm↔HWPUNIT 283.465, pt↔HWPUNIT 100. 첫 줄 들여쓰기 x → indentHu +x, 내어쓰기 → −x. */

  var cLsTypes = [{ v: 'percent', t: '글자에 따라' }, { v: 'fixed', t: '고정 값' }, { v: 'atLeast', t: '최소' }, { v: 'margin', t: '여백만 지정' }];

  function paraShape() {
    if (!hwDoc) return null;
    var v = hwFormat.selectedPara();
    if (!v) return null;
    var ind = v.indentHu;
    var bf = hwModel.borderFill(v.bf);
    var lsUnit = v.lsType === 'percent' ? '%' : 'pt';
    var lsVal = v.ls === null || v.lsType === null ? null : (v.lsType === 'percent' ? v.ls : v.ls / 100);

    return open({
      title: '문단 모양', width: 460,
      tabs: [
        { label: '단락', rows: [
          { type: 'radio', key: 'align', label: '맞춤', value: v.align,
            options: [{ v: 'left', t: '왼쪽' }, { v: 'center', t: '가운데' }, { v: 'right', t: '오른쪽' },
                      { v: 'justify', t: '양쪽' }, { v: 'distribute', t: '배분' }] },
          { type: 'group', label: '여백', items: [
            { type: 'number', key: 'ml', unit: 'mm 왼쪽', value: v.mlHu === null ? null : v.mlHu / cMm, min: 0, step: 0.1, dec: 1, width: 70 },
            { type: 'number', key: 'mr', unit: 'mm 오른쪽', value: v.mrHu === null ? null : v.mrHu / cMm, min: 0, step: 0.1, dec: 1, width: 70 }
          ] },
          { type: 'group', label: '첫 줄', items: [
            { type: 'radio', key: 'first', value: ind === null ? null : ind > 0 ? 'indent' : ind < 0 ? 'hang' : 'normal',
              options: [{ v: 'normal', t: '보통' }, { v: 'indent', t: '들여쓰기' }, { v: 'hang', t: '내어쓰기' }] },
            { type: 'number', key: 'firstVal', unit: 'mm', value: ind === null ? null : Math.abs(ind) / cMm, min: 0, step: 0.1, dec: 1, width: 70 }
          ] },
          { type: 'group', label: '간격', items: [
            { type: 'number', key: 'mt', unit: 'pt 문단 위', value: v.mtHu === null ? null : v.mtHu / 100, min: 0, step: 1, dec: 1, width: 70 },
            { type: 'number', key: 'mb', unit: 'pt 문단 아래', value: v.mbHu === null ? null : v.mbHu / 100, min: 0, step: 1, dec: 1, width: 70 }
          ] },
          { type: 'group', label: '줄 간격', items: [
            { type: 'select', key: 'lsType', width: 110, value: v.lsType, options: cLsTypes,
              onChange: function (k, s) { var u = s.field('ls:unit'); if (u) u.textContent = k === 'percent' ? '%' : 'pt'; } },
            { type: 'number', key: 'ls', unit: lsUnit, value: lsVal, min: 0, step: 1, dec: 1, width: 70 }
          ] }
        ] },
        { label: '테두리', rows: [
          { type: 'group', label: '테두리', items: [
            { type: 'select', key: 'bType', width: 110, value: bf ? bf.t.type : 'none', options: cLineTypes },
            { type: 'select', key: 'bWidth', width: 90, value: bf ? bf.t.w : '0.12', options: widthOptions() },
            { type: 'color', key: 'bColor', value: bf ? bf.t.color : '#000000' }
          ] },
          { type: 'group', label: '음영', items: [
            { type: 'color', key: 'bFill', value: (bf && bf.fill) || '#FFFF00' },
            { type: 'check', key: 'bNoFill', label: '없음', value: !(bf && bf.fill) }
          ] },
          { type: 'group', label: '간격', items: [
            { type: 'number', key: 'bsT', unit: 'pt 위', value: v.bsT === null ? null : v.bsT / 100, min: 0, step: 1, dec: 1, width: 60 },
            { type: 'number', key: 'bsB', unit: 'pt 아래', value: v.bsB === null ? null : v.bsB / 100, min: 0, step: 1, dec: 1, width: 60 },
            { type: 'number', key: 'bsL', unit: 'pt 왼쪽', value: v.bsL === null ? null : v.bsL / 100, min: 0, step: 1, dec: 1, width: 60 },
            { type: 'number', key: 'bsR', unit: 'pt 오른쪽', value: v.bsR === null ? null : v.bsR / 100, min: 0, step: 1, dec: 1, width: 60 }
          ] }
        ] }
      ],
      onOk: function (s) {
        var over = {}, t = s.touched, n;
        if (t.align && s.get('align')) over.align = s.get('align');
        if (t.ml && (n = s.get('ml')) !== null) over.mlHu = Math.round(Math.max(0, n) * cMm);
        if (t.mr && (n = s.get('mr')) !== null) over.mrHu = Math.round(Math.max(0, n) * cMm);
        if ((t.first || t.firstVal) && s.get('first')) {
          var kind = s.get('first'), mm = Math.max(0, s.get('firstVal') || 0);
          over.indentHu = kind === 'normal' ? 0 : (kind === 'indent' ? 1 : -1) * Math.round(mm * cMm);
        }
        if (t.mt && (n = s.get('mt')) !== null) over.mtHu = Math.round(Math.max(0, n) * 100);
        if (t.mb && (n = s.get('mb')) !== null) over.mbHu = Math.round(Math.max(0, n) * 100);
        if ((t.lsType || t.ls) && s.get('lsType')) {
          var ty = s.get('lsType'), val = s.get('ls');
          if (val === null) val = ty === 'percent' ? 160 : 10;
          over.lsType = ty;
          over.ls = ty === 'percent' ? Math.round(Math.max(50, Math.min(500, val))) : Math.round(Math.max(0, val) * 100);
        }
        if (t.bsL && (n = s.get('bsL')) !== null) over.bsL = Math.round(Math.max(0, n) * 100);
        if (t.bsR && (n = s.get('bsR')) !== null) over.bsR = Math.round(Math.max(0, n) * 100);
        if (t.bsT && (n = s.get('bsT')) !== null) over.bsT = Math.round(Math.max(0, n) * 100);
        if (t.bsB && (n = s.get('bsB')) !== null) over.bsB = Math.round(Math.max(0, n) * 100);

        /* 테두리·음영은 값을 문단모양에 직접 넣지 않는다 — 테두리/배경 표에 한 줄을 만들고 그 번호를 건다. */
        if (t.bType || t.bWidth || t.bColor || t.bFill || t.bNoFill) {
          var line = { type: s.get('bType') || 'none', w: s.get('bWidth') || '0.12',
                       color: (s.get('bColor') || '#000000').toUpperCase() };
          over.bf = hwFormat.borderFillFor(v.bf, {
            l: line, r: line, t: line, b: line,
            fill: s.get('bNoFill') ? null : (s.get('bFill') || '#FFFF00').toUpperCase()
          });
        }
        if (any(over)) hwFormat.applyPara(over);
      }
    });
  }

  /* 테두리/배경(덤프 3). 셀 블록에서 B·L.
     ★ 적용 위치는 <b>모두·없음</b>만이다 — 바깥쪽·안쪽은 칸마다 변을 달리 줘야 하는데
       우리 cellFmt 는 칸 하나에 테두리 한 벌(네 변)을 건다. */
  function cellBorder() {
    if (!hwDoc) return null;
    var b = hwTable.blockCells();
    var at = b ? null : hwTable.here();
    if (!b && !at) { hwSetStatus({ text: '표 칸 안에서 쓰세요' }); return null; }

    var cell = b ? b.cells[0] : at.cell;
    var bf = hwModel.borderFill(cell.bf);

    return open({
      title: '테두리/배경', width: 460,
      tabs: [
        { label: '테두리', rows: [
          { type: 'radio', key: 'where', label: '위치', value: 'all',
            options: [{ v: 'all', t: '모두' }, { v: 'none', t: '없음' }] },
          { type: 'group', label: '선', items: [
            { type: 'select', key: 'lType', width: 110, value: bf ? bf.t.type : 'solid', options: cLineTypes },
            { type: 'select', key: 'lWidth', width: 90, value: bf ? bf.t.w : '0.12', options: widthOptions() },
            { type: 'color', key: 'lColor', value: bf ? bf.t.color : '#000000' }
          ] }
        ] },
        { label: '배경', rows: [
          { type: 'group', label: '면 색', items: [
            { type: 'color', key: 'fill', value: (bf && bf.fill) || '#FFFF00' },
            { type: 'check', key: 'noFill', label: '없음', value: !(bf && bf.fill) }
          ] },
          { type: 'group', label: '무늬', items: [
            { type: 'select', key: 'pat', width: 130, value: (bf && bf.pat) || 'none', options: cPatterns },
            { type: 'color', key: 'patColor', value: (bf && bf.patColor) || '#000000' }
          ] }
        ] }
      ],
      onOk: function (s) {
        var none = s.get('where') === 'none';
        var line = none ? { type: 'none', w: '0.12', color: '#000000' }
                        : { type: s.get('lType') || 'solid', w: s.get('lWidth') || '0.12',
                            color: (s.get('lColor') || '#000000').toUpperCase() };
        hwTable.setCellFmt({
          bf: hwFormat.borderFillFor(cell.bf, {
            l: line, r: line, t: line, b: line,
            fill: s.get('noFill') ? null : (s.get('fill') || '#FFFF00').toUpperCase(),
            pat: s.get('pat') || 'none',
            patColor: (s.get('patColor') || '#000000').toUpperCase()
          })
        });
      }
    });
  }

  var cPatterns = [{ v: 'none', t: '없음' }, { v: 'horz', t: '가로 줄' }, { v: 'vert', t: '세로 줄' },
                   { v: 'backSlash', t: '왼쪽 대각' }, { v: 'slash', t: '오른쪽 대각' },
                   { v: 'cross', t: '격자' }, { v: 'crossDiagonal', t: '대각 격자' }];

  var cDivides = [{ v: '2', t: '나눔' }, { v: '1', t: '셀 단위로 나눔' }, { v: '0', t: '나누지 않음' }];

  /* 표 속성(덤프 3). 셀 블록에서 P. */
  function tableProps() {
    if (!hwDoc) return null;
    var b = hwTable.blockCells();
    var at = b ? null : hwTable.here();
    if (!b && !at) { hwSetStatus({ text: '표 칸 안에서 쓰세요' }); return null; }

    var obj = b ? b.obj : at.obj, t = obj.table;
    var cell = b ? b.cells[0] : at.cell;

    return open({
      title: '표 속성', width: 470,
      tabs: [
        { label: '표', rows: [
          { type: 'select', key: 'divide', label: '쪽 경계에서', width: 150,
            value: String(t.divide || 0), options: cDivides },
          { type: 'check', key: 'repeatHeader', label: '제목 줄 반복', value: !!t.repeatHeader },
          { type: 'group', label: '바깥 여백', items: [
            { type: 'number', key: 'omL', unit: 'mm 왼쪽', value: (obj.omLHu || 0) / cMm, min: 0, step: 0.1, dec: 1, width: 60 },
            { type: 'number', key: 'omR', unit: 'mm 오른쪽', value: (obj.omRHu || 0) / cMm, min: 0, step: 0.1, dec: 1, width: 60 },
            { type: 'number', key: 'omT', unit: 'mm 위', value: (obj.omTHu || 0) / cMm, min: 0, step: 0.1, dec: 1, width: 60 },
            { type: 'number', key: 'omB', unit: 'mm 아래', value: (obj.omBHu || 0) / cMm, min: 0, step: 0.1, dec: 1, width: 60 }
          ] }
        ] },
        { label: '셀', rows: [
          { type: 'radio', key: 'valign', label: '세로 맞춤', value: String(cell.valign || 0),
            options: [{ v: '0', t: '위쪽' }, { v: '1', t: '가운데' }, { v: '2', t: '아래쪽' }] },
          { type: 'check', key: 'head', label: '제목 칸', value: !!cell.head },
          { type: 'group', label: '셀 여백', items: [
            { type: 'number', key: 'cmL', unit: 'mm 왼쪽', value: (cell.mlHu || 0) / cMm, min: 0, step: 0.1, dec: 1, width: 60 },
            { type: 'number', key: 'cmR', unit: 'mm 오른쪽', value: (cell.mrHu || 0) / cMm, min: 0, step: 0.1, dec: 1, width: 60 },
            { type: 'number', key: 'cmT', unit: 'mm 위', value: (cell.mtHu || 0) / cMm, min: 0, step: 0.1, dec: 1, width: 60 },
            { type: 'number', key: 'cmB', unit: 'mm 아래', value: (cell.mbHu || 0) / cMm, min: 0, step: 0.1, dec: 1, width: 60 }
          ] }
        ] }
      ],
      onOk: function (s) {
        var tv = {}, cv = {};
        if (s.touched.divide && s.get('divide') !== null) tv.divide = parseInt(s.get('divide'), 10);
        if (s.touched.repeatHeader) tv.repeatHeader = !!s.get('repeatHeader');
        if (s.touched.omL || s.touched.omR || s.touched.omT || s.touched.omB) {
          tv.omL = Math.round(Math.max(0, s.get('omL') || 0) * cMm);
          tv.omR = Math.round(Math.max(0, s.get('omR') || 0) * cMm);
          tv.omT = Math.round(Math.max(0, s.get('omT') || 0) * cMm);
          tv.omB = Math.round(Math.max(0, s.get('omB') || 0) * cMm);
        }
        if (any(tv)) hwTable.setTableFmt(tv);

        if (s.touched.valign && s.get('valign') !== null) cv.valign = parseInt(s.get('valign'), 10);
        if (s.touched.head) cv.head = !!s.get('head');
        if (s.touched.cmL || s.touched.cmR || s.touched.cmT || s.touched.cmB) {
          cv.cmL = Math.round(Math.max(0, s.get('cmL') || 0) * cMm);
          cv.cmR = Math.round(Math.max(0, s.get('cmR') || 0) * cMm);
          cv.cmT = Math.round(Math.max(0, s.get('cmT') || 0) * cMm);
          cv.cmB = Math.round(Math.max(0, s.get('cmB') || 0) * cMm);
        }
        if (any(cv)) hwTable.setCellFmt(cv);
      }
    });
  }

  /* 용지 크기 목록(덤프 5-3). 값은 mm — 고른 순간 너비·높이 칸을 채운다. */
  var cPapers = [
    { t: 'A4', w: 210, h: 297 }, { t: 'A3', w: 297, h: 420 }, { t: 'A5', w: 148, h: 210 },
    { t: 'A6', w: 105, h: 148 }, { t: 'B4', w: 257, h: 364 }, { t: 'B5', w: 182, h: 257 },
    { t: 'Letter', w: 215.9, h: 279.4 }, { t: 'Legal', w: 215.9, h: 355.6 },
    { t: 'Executive', w: 184.15, h: 266.7 }
  ];

  function paperOptions() {
    var out = [{ v: '', t: '사용자 지정' }];
    for (var i = 0; i < cPapers.length; i++) out.push({ v: String(i), t: cPapers[i].t });
    return out;
  }

  /* ★ 방향은 용지 크기를 안 건드린다 — 맞바꾸는 것은 배치다(hwPageW·hwPageH). 여기서 w·h 를
     맞바꾸면 저장본의 용지 크기가 한글이 적는 값과 달라진다. */
  function pageSetup() {
    if (!hwDoc) return null;
    var si = hwPage.caretSection();
    var pg = hwDoc.sections[si].page, cols = hwDoc.sections[si].cols;

    function mm(v) { return Math.round((v || 0) / cMm * 10) / 10; }

    return open({
      title: '페이지 설정', width: 470,
      tabs: [
        { label: '페이지', rows: [
          { type: 'radio', key: 'dir', label: '용지 방향', value: pg.landscape ? '1' : '0',
            options: [{ v: '0', t: '세로' }, { v: '1', t: '가로' }] },
          { type: 'select', key: 'paper', label: '용지 종류', width: 150, value: '', options: paperOptions(),
            onChange: function (v, st) {
              var d = cPapers[parseInt(v, 10)];
              if (!d) return;
              st.set('pw', d.w); st.set('ph', d.h);
            } },
          { type: 'group', label: '용지 크기', items: [
            { type: 'number', key: 'pw', unit: 'mm 너비', value: mm(pg.wHu), min: 10, step: 1, dec: 1, width: 70 },
            { type: 'number', key: 'ph', unit: 'mm 높이', value: mm(pg.hHu), min: 10, step: 1, dec: 1, width: 70 }
          ] },
          { type: 'group', label: '여백', items: [
            { type: 'number', key: 'mt', unit: 'mm 위쪽', value: mm(pg.mtHu), min: 0, step: 1, dec: 1, width: 60 },
            { type: 'number', key: 'mb', unit: 'mm 아래쪽', value: mm(pg.mbHu), min: 0, step: 1, dec: 1, width: 60 },
            { type: 'number', key: 'ml', unit: 'mm 왼쪽', value: mm(pg.mlHu), min: 0, step: 1, dec: 1, width: 60 },
            { type: 'number', key: 'mr', unit: 'mm 오른쪽', value: mm(pg.mrHu), min: 0, step: 1, dec: 1, width: 60 },
            { type: 'number', key: 'mh', unit: 'mm 머리말', value: mm(pg.mhHu), min: 0, step: 1, dec: 1, width: 60 },
            { type: 'number', key: 'mf', unit: 'mm 꼬리말', value: mm(pg.mfHu), min: 0, step: 1, dec: 1, width: 60 },
            { type: 'number', key: 'gut', unit: 'mm 제본용', value: mm(pg.gutHu), min: 0, step: 1, dec: 1, width: 60 }
          ] }
        ] },
        { label: '레이아웃', rows: [
          { type: 'number', key: 'colCount', label: '단 개수', value: cols.count || 1, min: 1, max: 8, step: 1, dec: 0, width: 60 },
          { type: 'number', key: 'colGap', unit: 'mm 단 사이', value: mm(cols.gapHu), min: 0, step: 1, dec: 1, width: 60 }
        ] }
      ],
      onOk: function (st) {
        var v = {}, keys = ['ml', 'mr', 'mt', 'mb', 'mh', 'mf', 'gut'];
        if (st.touched.dir && st.get('dir') !== null) v.landscape = st.get('dir') === '1';
        /* 용지 종류를 고르면 너비·높이 칸이 바뀌지만 touched 는 그 칸에 안 찍힌다 — 같이 본다. */
        if (st.touched.pw || st.touched.ph || st.touched.paper) {
          v.pw = Math.round(Math.max(10, st.get('pw') || 0) * cMm);
          v.ph = Math.round(Math.max(10, st.get('ph') || 0) * cMm);
        }
        for (var i = 0; i < keys.length; i++)
          if (st.touched[keys[i]]) v[keys[i]] = Math.round(Math.max(0, st.get(keys[i]) || 0) * cMm);
        if (st.touched.colCount) v.colCount = Math.max(1, Math.round(st.get('colCount') || 1));
        if (st.touched.colGap) v.colGap = Math.round(Math.max(0, st.get('colGap') || 0) * cMm);

        if (any(v)) hwPage.setSection(si, v);
      }
    });
  }

  /* 쪽 번호 매기기(덤프 3·5-11). 위치 11가지 + 번호 모양 + 줄표. */
  var cNumPos = [
    { v: '0', t: '쪽 번호 없음' }, { v: '1', t: '왼쪽 위' }, { v: '2', t: '가운데 위' }, { v: '3', t: '오른쪽 위' },
    { v: '4', t: '왼쪽 아래' }, { v: '5', t: '가운데 아래' }, { v: '6', t: '오른쪽 아래' },
    { v: '9', t: '안쪽 위' }, { v: '7', t: '바깥쪽 위' }, { v: '10', t: '안쪽 아래' }, { v: '8', t: '바깥쪽 아래' }
  ];
  var cNumShape = [
    { v: '0', t: '1, 2, 3' }, { v: '2', t: 'I, II, III' }, { v: '3', t: 'i, ii, iii' },
    { v: '4', t: 'A, B, C' }, { v: '5', t: 'a, b, c' }, { v: '8', t: '가, 나, 다' }
  ];

  function pageNumber() {
    if (!hwDoc) return null;
    var si = hwPage.caretSection();
    var num = hwPage.bandOf(si, 'pgnp');

    return open({
      title: '쪽 번호 매기기', width: 340,
      rows: [
        { type: 'select', key: 'numPos', label: '번호 위치', width: 150,
          value: String(num && num.numPos ? num.numPos : 0), options: cNumPos },
        { type: 'select', key: 'numShape', label: '번호 모양', width: 150,
          value: String(num && num.numShape ? num.numShape : 0), options: cNumShape },
        { type: 'check', key: 'numDash', label: '줄표 넣기', value: !!(num && num.numBefore === '-') },
        num ? { type: 'note', text: '' }
            : { type: 'note', text: '이 문서에는 쪽 번호 컨트롤이 없습니다 — 위치를 바꿀 수 없습니다.' }
      ],
      onOk: function (st) {
        var v = {};
        if (st.touched.numPos && st.get('numPos') !== null) v.numPos = parseInt(st.get('numPos'), 10);
        if (st.touched.numShape && st.get('numShape') !== null) v.numShape = parseInt(st.get('numShape'), 10);
        if (st.touched.numDash) v.numDash = !!st.get('numDash');
        if (any(v)) hwPage.setPageNum(si, v);
      }
    });
  }

  /* 머리말·꼬리말 편집. 새로 만드는 것만 여기서 한다 — 이미 있는 것은 띠를 눌러 본문처럼 고친다. */
  function bandInsert(kind) {
    if (!hwDoc) return null;
    var si = hwPage.caretSection();

    return open({
      title: (kind === 'foot' ? '꼬리말' : '머리말') + ' 넣기', width: 380,
      rows: [
        { type: 'text', key: 'text', label: '내용', width: 230, value: '' },
        { type: 'radio', key: 'apply', label: '적용 쪽', value: 'both',
          options: [{ v: 'both', t: '양 쪽' }, { v: 'odd', t: '홀수 쪽' }, { v: 'even', t: '짝수 쪽' }] }
      ],
      onOk: function (st) {
        hwPage.addBand(si, kind, st.get('apply') || 'both', st.get('text') || '');
      }
    });
  }

  /* 문자표 분류는 덤프 5-5 의 18종. "자주 쓰는 기호" 는 여기서 넣은 것이 앞에 온다(프로그램을 닫으면 사라진다 — 1차). */

  var cRecentSyms = [];
  var cCommon = '※☆★○●◎◇◆□■△▲▽▼→←↑↓↔〓≪≫·‥…「」『』【】§°′″℃±×÷≠≤≥∞①②③';

  var cCats = [
    { t: '자주 쓰는 기호', r: null },
    { t: '문장 부호', r: [[0x2010, 0x2027], [0x2030, 0x203E], [0x3001, 0x3003], [0xA1, 0xA1], [0xB7, 0xB7], [0xBF, 0xBF]] },
    { t: '괄호', r: [[0x3008, 0x3011], [0x3014, 0x301B], [0x2329, 0x232A], [0xFF08, 0xFF09], [0xFF3B, 0xFF3B], [0xFF3D, 0xFF3D], [0xFF5B, 0xFF5B], [0xFF5D, 0xFF5D]] },
    { t: '수학 기호', r: [[0xB1, 0xB1], [0xD7, 0xD7], [0xF7, 0xF7], [0x2200, 0x22FF]] },
    { t: '단위 기호', r: [[0xB0, 0xB0], [0x2100, 0x2138], [0x3380, 0x33DD]] },
    { t: '도형 문자', r: [[0x25A0, 0x25FF], [0x2600, 0x2606], [0x260E, 0x260F], [0x261C, 0x261F], [0x2640, 0x2640], [0x2642, 0x2642], [0x2660, 0x266F], [0x2190, 0x21FF]] },
    { t: '괘선 문자', r: [[0x2500, 0x257F]] },
    { t: '원문자·괄호문자(한글)', r: [[0x3200, 0x321E], [0x3260, 0x327F]] },
    { t: '원문자·괄호문자(영/숫자)', r: [[0x2460, 0x24FF]] },
    { t: '전각 숫자(분수/첨자)', r: [[0xFF10, 0xFF19], [0xBC, 0xBE], [0x2150, 0x218B], [0xB9, 0xB9], [0xB2, 0xB3], [0x2070, 0x209C]] },
    { t: '현대 한글 낱자', r: [[0x3131, 0x318E]] },
    { t: '옛 한글 낱자', r: [[0x1100, 0x11FF]] },
    { t: '전각 로마자', r: [[0xFF21, 0xFF3A], [0xFF41, 0xFF5A]] },
    { t: '그리스 문자', r: [[0x0391, 0x03A1], [0x03A3, 0x03A9], [0x03B1, 0x03C9]] },
    { t: '서유럽/라틴 문자', r: [[0xC0, 0xD6], [0xD8, 0xF6], [0xF8, 0x17F]] },
    { t: '히라가나', r: [[0x3041, 0x3096]] },
    { t: '가타카나', r: [[0x30A1, 0x30FA]] },
    { t: '키릴 문자', r: [[0x0401, 0x0401], [0x0410, 0x044F], [0x0451, 0x0451]] }
  ];

  function charsOf(cat) {
    var c = cCats[cat];
    if (!c.r) {
      var out = cRecentSyms.slice();
      for (var i = 0; i < cCommon.length; i++) if (out.indexOf(cCommon.charAt(i)) < 0) out.push(cCommon.charAt(i));
      return out;
    }
    var list = [];
    for (var r = 0; r < c.r.length; r++)
      for (var u = c.r[r][0]; u <= c.r[r][1]; u++) list.push(String.fromCharCode(u));
    return list;
  }

  function fillGrid(grid, st, cat) {
    grid.innerHTML = '';
    st.pick = null;
    var list = charsOf(cat);
    for (var i = 0; i < list.length; i++) {
      var b = el('button', 'hw-cm-cell', list[i]);
      b.type = 'button';
      b.tabIndex = -1;
      b.setAttribute('data-ch', list[i]);
      b.title = 'U+' + ('0000' + list[i].charCodeAt(0).toString(16).toUpperCase()).slice(-4);
      grid.appendChild(b);
    }
    grid.scrollTop = 0;
    var pv = st.field('cmPreview');
    if (pv) pv.textContent = '';
  }

  function insertSym(ch) {
    if (!ch) return;
    var at = cRecentSyms.indexOf(ch);
    if (at >= 0) cRecentSyms.splice(at, 1);
    cRecentSyms.unshift(ch);
    if (cRecentSyms.length > 32) cRecentSyms.length = 32;
    hwInput.typeText(ch);
  }

  function charMap() {
    if (!hwDoc) return null;
    var cats = [];
    for (var i = 0; i < cCats.length; i++) cats.push({ v: String(i), t: cCats[i].t });

    var st = open({
      title: '문자표', width: 500,
      rows: [
        { type: 'select', key: 'cat', label: '분류', value: '0', options: cats, width: 220,
          onChange: function (v, s) { fillGrid(s.field('cmGrid'), s, parseInt(v, 10) || 0); } },
        { type: 'custom', key: 'cmGrid', build: function (grid, s) {
          grid.className = 'hw-cm-grid';
          grid.addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('.hw-cm-cell') : null;
            if (!b) return;
            var olds = grid.querySelectorAll('.hw-cm-cell.on');
            for (var k = 0; k < olds.length; k++) olds[k].classList.remove('on');
            b.classList.add('on');
            s.pick = b.getAttribute('data-ch');
            var pv = s.field('cmPreview');
            if (pv) pv.textContent = s.pick + '  ' + b.title;
          });
          grid.addEventListener('dblclick', function (e) {
            var b = e.target.closest ? e.target.closest('.hw-cm-cell') : null;
            if (!b) return;
            s.pick = b.getAttribute('data-ch');
            ok(s);
          });
        } },
        { type: 'custom', key: 'cmPreview', build: function (pv) { pv.className = 'hw-cm-preview'; } }
      ],
      buttons: [{ label: '넣기', ok: true }, { label: '닫기', cancel: true }],
      onOk: function (s) {
        var ch = s.pick;
        if (!ch) return false;
        close();
        insertSym(ch);
      }
    });
    fillGrid(st.field('cmGrid'), st, 0);
    return st;
  }

  function tableLines(isDel) {
    if (!hwTable.here()) { hwSetStatus({ text: '표 안에 커서를 두세요' }); return null; }
    return open({
      title: isDel ? '줄/칸 지우기' : '줄/칸 추가하기', width: 340,
      rows: [
        { type: 'radio', key: 'where', label: isDel ? '지울 것' : '넣을 자리', value: isDel ? 'row' : 'down',
          options: isDel ? [{ v: 'row', t: '줄' }, { v: 'col', t: '칸' }]
                         : [{ v: 'up', t: '위' }, { v: 'down', t: '아래' }, { v: 'left', t: '왼쪽' }, { v: 'right', t: '오른쪽' }] },
        { type: 'number', key: 'count', label: '개수', value: 1, min: 1, max: 100, width: 80 }
      ],
      buttons: [{ label: isDel ? '지우기' : '넣기', ok: true }, { label: '취소', cancel: true }],
      onOk: function (s) {
        var n = s.get('count') || 1, w = s.get('where');
        close();
        if (isDel) { if (w === 'col') hwTable.delCol(n); else hwTable.delRow(n); }
        else if (w === 'up') hwTable.addRow(-1, n);
        else if (w === 'down') hwTable.addRow(1, n);
        else if (w === 'left') hwTable.addCol(-1, n);
        else hwTable.addCol(1, n);
      }
    });
  }

  function tableInsert() {
    if (!hwDoc) return null;
    return open({
      title: '표 만들기', width: 320,
      rows: [
        { type: 'number', key: 'cols', label: '칸 개수', value: 5, min: 1, max: 100, width: 80 },
        { type: 'number', key: 'rows', label: '줄 개수', value: 2, min: 1, max: 100, width: 80 }
      ],
      buttons: [{ label: '만들기', ok: true }, { label: '취소', cancel: true }],
      onOk: function (s) {
        var r = s.get('rows') || 1, c = s.get('cols') || 1;
        close();
        hwTable.insertTable(r, c);
      }
    });
  }

  /* 하이퍼링크 넣기(덤프 3). ★ 표시할 텍스트는 <b>고른 글자</b>다 — 고른 것이 없을 때만 쓴다. */
  function hyperlink() {
    if (!hwDoc) return null;

    var sel = hwCaret.selection();
    var shown = '';
    if (sel && sel.fromId === sel.toId) {
      var p = hwModel.byId(sel.fromId);
      if (p) shown = hwModel.text(p).slice(sel.fromPos, sel.toPos);
    }

    return open({
      title: '하이퍼링크', width: 420,
      rows: [
        { type: 'text', key: 'text', label: '표시할 텍스트', value: shown, width: 260 },
        { type: 'text', key: 'url', label: '웹 주소', value: 'https://', width: 260 }
      ],
      buttons: [{ label: '넣기', ok: true }, { label: '취소', cancel: true }],
      onOk: function (s) {
        var url = String(s.get('url') || '').trim();
        if (!hwLink.allowed(url)) { hwSetStatus({ text: '주소는 http·https·mailto 만 됩니다' }); return; }
        close();
        hwLink.insert(url, String(s.get('text') || '').trim());
      }
    });
  }

  /* 책갈피 넣기. 이름 하나만 받는다 — 자리는 캐럿이다. */
  function bookmark() {
    if (!hwDoc) return null;
    return open({
      title: '책갈피', width: 380,
      rows: [{ type: 'text', key: 'name', label: '책갈피 이름', value: '', width: 240 }],
      buttons: [{ label: '넣기', ok: true }, { label: '취소', cancel: true }],
      onOk: function (s) {
        var name = String(s.get('name') || '').trim();
        if (!name) { hwSetStatus({ text: '책갈피 이름을 넣으세요' }); return; }
        close();
        if (hwLink.addMark(name) && window.hwFind) hwFind.fillMarks();
      }
    });
  }

  function tableSplit() {
    if (!hwTable.here() && !hwTable.block()) { hwSetStatus({ text: '표 안에 커서를 두세요' }); return null; }
    return open({
      title: '셀 나누기', width: 320,
      rows: [
        { type: 'number', key: 'cols', label: '칸 개수', value: 2, min: 1, max: 64, width: 80 },
        { type: 'number', key: 'rows', label: '줄 개수', value: 1, min: 1, max: 64, width: 80 }
      ],
      buttons: [{ label: '나누기', ok: true }, { label: '취소', cancel: true }],
      onOk: function (s) {
        var r = s.get('rows') || 1, c = s.get('cols') || 1;
        close();
        hwTable.splitCell(r, c);
      }
    });
  }

  return {
    open: open,
    close: close,
    isOpen: function () { return !!cOpen; },
    current: function () { return cOpen; },
    charShape: charShape,
    paraShape: paraShape,
    cellBorder: cellBorder,
    tableProps: tableProps,
    pageSetup: pageSetup,
    pageNumber: pageNumber,
    bandInsert: bandInsert,
    charMap: charMap,
    tableLines: tableLines,
    tableInsert: tableInsert,
    tableSplit: tableSplit,
    hyperlink: hyperlink,
    bookmark: bookmark,
    categories: function () { return cCats.map(function (c) { return c.t; }); }
  };
})();
