/* 하이퍼링크 필드와 책갈피. ★ 필드는 <b>문단을 넘어 걸친다</b>(실측 issue144 — p1 에서 열고 p2 에서 닫는다) —
     그래서 범위는 문서 순서로 훑으며 <b>열림 스택</b>으로 잡는다.
   ★ 글자모양은 안 건드린다 — 한글도 링크 색·밑줄을 글자모양으로 준다. 우리가 덧칠하면 저장 왕복이 갈린다.
     화면은 클래스 하나만 얹는다(hwRender 의 묶음 키에 링크가 들어가 경계에서 저절로 끊긴다). */

var hwLink = (function () {
  'use strict';

  var cCache = null, cMarks = null, cGen = -1;
  var cLastOpen = null;

  /* 열어도 되는 주소만. ★ 임의 문자열을 C# 으로 넘기면 <c>Process.Start</c> 가 로컬 실행 파일을 띄운다. */
  function allowed(url) {
    return /^(https?|mailto):/i.test(String(url || ''));
  }

  function build() {
    var links = {}, marks = [];
    if (!hwDoc) return { links: links, marks: marks };

    var paras = hwModel.allParas();
    var open = [];   /* 아직 안 닫힌 링크들. 마지막 것이 지금 유효한 링크다. */

    for (var i = 0; i < paras.length; i++) {
      var p = paras[i];
      var objs = p.objs || [];
      var at = 0, list = [];

      for (var k = 0; k < objs.length; k++) {
        var o = objs[k];
        if (o.ctrl === 'bookm') { marks.push({ name: o.name || '', id: p.id, pos: o.pos }); continue; }

        if (o.ctrl === 'fldb') {
          if (at < o.pos && open.length) list.push({ from: at, to: o.pos, url: open[open.length - 1] });
          open.push(o.link || '');
          at = o.pos;
          continue;
        }

        if (o.ctrl === 'flde') {
          if (open.length && at < o.pos) list.push({ from: at, to: o.pos, url: open[open.length - 1] });
          open.pop();
          at = o.pos;
        }
      }

      /* 문단 끝까지 안 닫혔으면 그대로 이어 간다 — 다음 문단이 같은 링크로 시작한다. */
      if (open.length && at < p.len) list.push({ from: at, to: p.len, url: open[open.length - 1] });
      if (list.length) links[p.id] = list;
    }
    return { links: links, marks: marks };
  }

  function all() {
    var gen = hwModel.gen();
    if (cCache === null || cGen !== gen) {
      var r = build();
      cCache = r.links; cMarks = r.marks; cGen = gen;
    }
    return cCache;
  }

  return {
    /* 이 자리의 링크 주소. 링크가 아니면 null 이다. */
    at: function (para, pos) {
      var list = para ? all()[para.id] : null;
      if (!list) return null;
      for (var i = 0; i < list.length; i++)
        if (pos >= list[i].from && pos < list[i].to) return list[i].url || '';
      return null;
    },

    /* 문서의 책갈피 전부. 찾아가기가 이름 목록으로 쓴다. */
    marks: function () { all(); return cMarks || []; },

    /* 이름으로 찾아가기. 없으면 false. */
    goto: function (name) {
      var list = this.marks();
      for (var i = 0; i < list.length; i++)
        if (list[i].name === name) { hwCaret.set(list[i].id, list[i].pos, false); return true; }
      return false;
    },

    /* Ctrl+클릭으로 열기. ★ 여는 것은 C# 이고, 거기서도 <b>같은 화이트리스트</b>를 한 번 더 본다. */
    open: function (url) {
      cLastOpen = { url: String(url || ''), ok: allowed(url) };
      if (!cLastOpen.ok) { hwSetStatus({ text: '열 수 없는 주소입니다: ' + cLastOpen.url }); return false; }
      hwPost({ t: 'openUrl', url: cLastOpen.url });
      return true;
    },

    allowed: allowed,

    /* 고른 글자를 하이퍼링크로 감싼다. 고른 것이 없으면 주소를 글자로 넣고 그것을 감싼다.
       ★ 시작·끝을 <b>한 문단 안</b>에만 넣는다 — 문단을 넘는 링크는 읽기만 한다(문단 둘을 한 번에
         고치는 저장 요청이 서로의 자리를 밀어 짝이 어긋난다). */
    insert: function (url, text) {
      if (!hwDoc || !allowed(url)) { hwSetStatus({ text: '주소는 http·https·mailto 만 됩니다' }); return false; }

      var sel = hwCaret.selection();
      var at = hwCaret.at();
      var id = sel && sel.fromId === sel.toId ? sel.fromId : at.id;
      var p = hwModel.byId(id);
      if (!p) return false;

      /* ★ 저장 전 새 표의 칸은 <b>막는다</b>. 그 문단은 문서 쪽 id 표에 없어서 buildOps 가 통째로 건너뛰는데
         (hwModel.pushOp·imageOps 의 `_tblNew`), 화면에는 링크가 그려져 저장에서만 조용히 빠진다. */
      if (p._tblNew) { hwSetStatus({ text: '새 표는 저장한 뒤에 링크를 넣을 수 있습니다' }); return false; }

      var from = sel && sel.fromId === sel.toId ? sel.fromPos : at.pos;
      var to = sel && sel.fromId === sel.toId ? sel.toPos : from;

      hwInput.run(function () {
        if (to === from) {
          var body = text || url;
          hwModel.insertText(p, from, body, hwModel.shapeAt(p, from));
          to = from + body.length;
        }
        var seq = 'lk' + (Date.now() % 100000);
        hwModel.insertObj(p, to, { pos: to, kind: 'ctrl', ctrl: 'flde', label: '필드 끝',
                                   hidden: true, inline: true, wHu: 0, hHu: 0, tmpId: seq + 'e' });
        hwModel.insertObj(p, from, { pos: from, kind: 'ctrl', ctrl: 'fldb', label: '필드',
                                     hidden: true, inline: true, wHu: 0, hHu: 0, link: url, tmpId: seq });
        return { id: p.id, pos: to + 2 };
      });
      return true;
    },

    /* 책갈피 하나를 캐럿 자리에 박는다. 링크와 같은 틀이지만 짝이 없는 표식 하나다.
       ★ 저장 전 새 표의 칸은 막는다(insert 와 같은 이유 — 그 문단은 저장 요청에 안 실린다). */
    addMark: function (name) {
      if (!hwDoc) return false;
      name = (name || '').trim();
      if (!name) { hwSetStatus({ text: '책갈피 이름을 넣으세요' }); return false; }

      var marks = this.marks();
      for (var i = 0; i < marks.length; i++)
        if (marks[i].name === name) { hwSetStatus({ text: '같은 이름의 책갈피가 이미 있습니다' }); return false; }

      var at = hwCaret.at();
      var p = hwModel.byId(at.id);
      if (!p) return false;
      if (p._tblNew) { hwSetStatus({ text: '새 표는 저장한 뒤에 책갈피를 넣을 수 있습니다' }); return false; }

      var pos = at.pos;
      hwInput.run(function () {
        hwModel.insertObj(p, pos, { pos: pos, kind: 'ctrl', ctrl: 'bookm', label: '책갈피',
                                    hidden: true, inline: true, wHu: 0, hHu: 0,
                                    name: name, tmpId: 'bm' + (Date.now() % 100000) });
        return { id: p.id, pos: pos + 1 };
      });
      hwSetStatus({ text: '책갈피 "' + name + '" 를 넣었습니다' });
      return true;
    },

    /* 검사 통로. ★ 화면 밖 검사에서 브라우저가 실제로 뜨면 안 되므로, 무엇을 열려 했는지만 남긴다. */
    lastOpen: function () { return cLastOpen; }
  };
})();
