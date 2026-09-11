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
          { key: 'sup', label: 'x²', title: '위 첨자', disabled: true },
          { key: 'sub', label: 'x₂', title: '아래 첨자', disabled: true },
          { key: 'outline', label: '외', title: '외곽선', disabled: true },
          { key: 'shadow', label: '그', title: '그림자', disabled: true },
          { key: 'emboss', label: '양', title: '양각', disabled: true },
          { key: 'engrave', label: '음', title: '음각', disabled: true }
        ] },
        { type: 'select', key: 'underline', label: '밑줄', width: 100,
          value: v.underline === null ? null : String(v.underline || 0),
          options: [{ v: '0', t: '없음' }, { v: '1', t: '아래' }, { v: '2', t: '가운데' }, { v: '3', t: '위' }] },
        { type: 'group', label: '밑줄 모양', disabled: true, items: [
          { type: 'select', key: 'ulShape', width: 100, value: '0', options: [{ v: '0', t: '실선' }], disabled: true },
          { type: 'color', key: 'ulColor', disabled: true }
        ] },
        { type: 'select', key: 'emph', label: '강조점', width: 100, value: '0', options: [{ v: '0', t: '없음' }], disabled: true },
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
          { type: 'note', label: '', text: '문단 테두리·음영은 아직 지원하지 않습니다.' }
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
        if (any(over)) hwFormat.applyPara(over);
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

  return {
    open: open,
    close: close,
    isOpen: function () { return !!cOpen; },
    current: function () { return cOpen; },
    charShape: charShape,
    paraShape: paraShape,
    charMap: charMap,
    categories: function () { return cCats.map(function (c) { return c.t; }); }
  };
})();
