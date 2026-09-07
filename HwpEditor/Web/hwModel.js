/* 문서 모델. C# 이 보낸 JSON 을 그대로 들고 있으면서, 화면이 자주 묻는 것만 색인해 둔다.
   ★ 모델을 두 벌로 만들지 않는다 — 편집도 이 객체를 고치고, 저장할 때 dirty 문단만 ops 로 뽑는다
     (계획 6절). 지금(1단계)은 읽기만 쓴다. */

var hwDoc = null;

var hwModel = (function () {
  'use strict';

  /* 문단 id → 문단. 삽입·삭제로 인덱스가 밀려도 안 깨지도록 id 로 잡는다(계획 B-1). */
  var cById = {};

  /* 편집이 일어난 문단 id 집합. 여기 든 문단은 seg(오라클)를 더 이상 믿지 않는다(계획 B-5). */
  var cDirty = {};

  function index(doc) {
    cById = {};
    cDirty = {};
    if (!doc) return;
    for (var si = 0; si < doc.sections.length; si++) {
      var paras = doc.sections[si].paras;
      for (var pi = 0; pi < paras.length; pi++) {
        var p = paras[pi];
        p._sec = si;
        cById[p.id] = p;
        indexCells(p);
      }
    }
  }

  /* 표 안의 문단도 같은 색인에 넣는다 — id 규칙이 이미 유일하다. */
  function indexCells(para) {
    if (!para.objs) return;
    for (var i = 0; i < para.objs.length; i++) {
      var o = para.objs[i];
      if (!o.table || !o.table.cells) continue;
      for (var c = 0; c < o.table.cells.length; c++) {
        var cell = o.table.cells[c];
        for (var k = 0; k < cell.paras.length; k++) {
          cById[cell.paras[k].id] = cell.paras[k];
          indexCells(cell.paras[k]);
        }
      }
    }
  }

  /* 문단의 편집 인덱스 기준 글자열. 개체는 한 자리를 차지하므로 U+FFFC(개체 치환 문자)로 채운다.
     ★ 이 문자열의 길이가 곧 para.len 이어야 한다 — 어긋나면 seg 대조가 통째로 밀린다. */
  function text(para) {
    if (para._text !== undefined) return para._text;

    var parts = [];
    for (var i = 0; i < para.runs.length; i++) parts.push(para.runs[i].text);
    var s = parts.join('');

    if (para.objs && para.objs.length) {
      /* 개체는 pos(편집 인덱스)에 끼워 넣는다. pos 오름차순을 전제로 뒤에서부터 넣는다. */
      var objs = para.objs.slice().sort(function (a, b) { return a.pos - b.pos; });
      for (var k = objs.length - 1; k >= 0; k--) {
        var at = Math.min(objs[k].pos, s.length);
        s = s.slice(0, at) + '￼' + s.slice(at);
      }
    }
    para._text = s;
    return s;
  }

  /* 편집 인덱스 위치의 글자모양 id. run 경계를 훑어 찾는다. */
  function shapeAt(para, pos) {
    var at = 0;
    for (var i = 0; i < para.runs.length; i++) {
      var r = para.runs[i];
      if (pos < at + r.text.length) return r.cs;
      at += r.text.length;
    }
    return para.runs.length ? para.runs[para.runs.length - 1].cs : 0;
  }

  return {
    load: function (doc) {
      hwDoc = doc;
      index(doc);
      return doc;
    },
    byId: function (id) { return cById[id]; },
    text: text,
    shapeAt: shapeAt,
    charShape: function (id) {
      return (hwDoc && hwDoc.charShapes[id]) || hwDoc.charShapes[0];
    },
    paraShape: function (id) {
      return (hwDoc && hwDoc.paraShapes[id]) || hwDoc.paraShapes[0];
    },
    faceName: function (id) {
      return (hwDoc && hwDoc.faceNames[id]) || null;
    },
    isDirty: function (id) { return !!cDirty[id]; },
    markDirty: function (id) { cDirty[id] = true; var p = cById[id]; if (p) { p.seg = null; p._text = undefined; } }
  };
})();

/* C# 이 부르는 진입점.
   ★ 반드시 @font-face 로드를 기다린 뒤에 배치한다. 폰트가 아직 안 붙은 상태로 재면 브라우저가
     대체 글꼴 폭을 돌려주고, 그 값이 캐시에 굳어 오라클이 통째로 어긋난다. */
function hwLoadDoc(doc) {
  hwModel.load(doc);
  hwSetStatus({ text: '배치 중…' });

  hwMeasure.ready().then(function () {
    var t0 = (window.performance && performance.now) ? performance.now() : 0;
    hwLayout();
    hwRender();
    var ms = t0 ? Math.round((window.performance ? performance.now() : 0) - t0) : 0;

    hwSetStatus({
      text: (doc.path || '새 문서') + ' — ' + hwPageCount() + '쪽 (' + ms + 'ms)'
    });
    hwPost({ t: 'docReady', pages: hwPageCount(), ms: ms });
  });
}
