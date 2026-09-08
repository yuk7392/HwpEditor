/* 개체 고르기·옮기기·크기 조절(8단계).

   넣은 그림을 그 뒤에 다룰 수가 없었다 — 눌러도 캐럿이 그 글자 자리로 갈 뿐이었다.
   여기서 개체를 골라 테두리·조절점을 얹고, 끌어서 옮기고 모서리로 크기를 바꾼다.

   ★ 오버레이는 캐럿·선택과 <b>같은 층 규칙</b>이다 — .hw-body 안에 절대 좌표로 얹고 본문 DOM
     사이에 끼워 넣지 않는다. 끼워 넣으면 그 줄이 다시 흐르면서 우리 배치와 화면이 갈라진다.
   ★ 자리는 모델 값이 아니라 <b>실제로 그려진 사각형</b>에서 잰다. 떠 있는 그림은 부모가 줄(.hw-line)이고
     표는 본문(.hw-body)이라 원점이 서로 다른데(hwRender.js 의 objEl / hwPage 의 표 배치), rect 로 재면
     그 차이가 애초에 안 생긴다. 모델로 되돌릴 때는 <b>움직인 만큼(델타)</b>만 더한다 —
     절대 좌표를 새로 계산하면 원점 차이가 값에 섞여 들어간다.
   ★ 표는 여기서 안 다룬다. 표는 .hw-obj 가 아니라 .hw-table 로 따로 그려지고 그 위의 글자는 보통 줄로
     놓여 있어서, 표를 누르는 사람은 칸을 편집하려는 것이다. 표는 칸 편집·행열 단추로 다룬다. */

var hwObj = (function () {
  'use strict';

  var cId = null;      /* 고른 개체가 매달린 문단 id */
  var cPos = -1;       /* 그 개체의 자리(편집 인덱스) */
  var cDrag = null;    /* 끄는 중: { kind, dir, x0, y0, box, preview } */

  /* hwRender.sane 과 같은 안전선. 용지 두 장 밖으로 나가는 값은 문서가 깨진 것으로 본다. */
  var cSaneHu = 200000;
  var cMinHu = 1000;

  /* 한 칸씩 밀 때의 걸음(약 3.4mm). 방향키로 미세 조정할 때 쓴다. */
  var cStepHu = 1000;

  function div(cls) { var d = document.createElement('div'); d.className = cls; return d; }

  function objAt(p, pos) {
    var objs = (p && p.objs) || [];
    for (var i = 0; i < objs.length; i++) if (objs[i].pos === pos) return objs[i];
    return null;
  }

  /* 지금 고른 개체. 편집으로 사라졌으면 null 이다. */
  function current() {
    if (cId === null) return null;
    var p = hwModel.byId(cId);
    if (!p) return null;
    var o = objAt(p, cPos);
    return o ? { para: p, obj: o } : null;
  }

  /* 화면에 그려진 그 개체의 요소. 가상 스크롤로 아직 안 채운 쪽이면 없다. */
  function domOf() {
    if (cId === null) return null;
    return document.querySelector('.hw-obj[data-para="' + cId + '"][data-pos="' + cPos + '"]');
  }

  /* 요소의 사각형을 본문(.hw-body) 기준 px 로. */
  function rectIn(el, body) {
    var r = el.getBoundingClientRect(), b = body.getBoundingClientRect();
    return { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height };
  }

  /* ── 고르기 ──────────────────────────────────────────── */

  function select(id, pos) {
    cId = id;
    cPos = pos;
    /* ★ 캐럿도 그 자리로 옮긴다. hwInput.edit 이 <b>캐럿 자리</b>로 고칠 문단을 잡으므로,
       안 옮기면 개체를 옮긴 뒤 되돌리기 스냅샷이 엉뚱한 문단을 담는다.
       캐럿 <b>그림</b>은 hwCaret.paint 가 개체를 고른 동안 그리지 않는다. */
    hwCaret.set(id, pos, false);
  }

  function clear() {
    if (cId === null) return;
    cId = null;
    cPos = -1;
    cDrag = null;
    paint();

    /* ★ 고른 동안 hwCaret.paint 가 캐럿을 안 그리고 지나갔다 — 풀었으면 다시 그려 준다.
       안 그러면 Esc 를 누른 뒤 캐럿이 사라진 채로 남는다(다음 키·클릭 때까지). */
    if (window.hwCaret) hwCaret.paint();
  }

  /* ── 그리기 ──────────────────────────────────────────── */

  /* ★ 여덟 방향을 다 준다. 글자처럼 취급하는 개체도 마찬가지다 — 그 개체의 <b>자리</b>는 글자
     흐름이 정하지만 왼쪽 위 모서리를 잡아 <b>크기</b>를 줄이는 것은 똑같이 된다.
     (처음에 오른쪽·아래 셋만 줬더니 화면에서 "코너가 이상하다" 로 보였다 — 사용자 보고.) */
  var cDirs = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  /* ★ 크기는 <b>그림만</b> 바꾼다. 도형·글상자는 바깥 크기(CtrlHeaderGso)와 안쪽 도형의 크기가
     따로 있어서, 바깥만 늘리면 껍데기만 커지고 안쪽은 원래 크기로 남는다(실물 확인 못 함).
     수식 같은 opaque 개체도 마찬가지다 — 자리만 옮기게 둔다. */
  function canResize(o) { return o.kind === 'image'; }

  function paint() {
    var olds = document.querySelectorAll('.hw-objsel, .hw-handle');
    for (var i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i]);

    var cur = current();
    if (!cur) return;

    var dom = domOf();
    if (!dom) return;

    var body = dom.closest ? dom.closest('.hw-body') : null;
    if (!body) return;

    var box = (cDrag && cDrag.preview) ? cDrag.preview : rectIn(dom, body);

    var sel = div('hw-objsel');
    place(sel, box.x, box.y, box.w, box.h);
    body.appendChild(sel);

    var dirs = canResize(cur.obj) ? cDirs : [];
    for (var d = 0; d < dirs.length; d++) {
      var h = div('hw-handle');
      h.setAttribute('data-dir', dirs[d]);
      var pt = handlePoint(box, dirs[d]);
      h.style.left = (pt.x - 4) + 'px';
      h.style.top = (pt.y - 4) + 'px';
      body.appendChild(h);
    }
  }

  function place(el, x, y, w, h) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = Math.max(0, w) + 'px';
    el.style.height = Math.max(0, h) + 'px';
  }

  function handlePoint(box, dir) {
    var mx = box.x + box.w / 2, my = box.y + box.h / 2;
    var x = dir.indexOf('w') >= 0 ? box.x : (dir.indexOf('e') >= 0 ? box.x + box.w : mx);
    var y = dir.indexOf('n') >= 0 ? box.y : (dir.indexOf('s') >= 0 ? box.y + box.h : my);
    return { x: x, y: y };
  }

  /* ── 마우스 ──────────────────────────────────────────── */

  /* hwInput.onMouseDown 이 캐럿보다 <b>먼저</b> 부른다. 개체를 먹었으면 true. */
  function onDown(e) {
    if (!hwDoc) return false;

    var h = e.target.closest ? e.target.closest('.hw-handle') : null;
    if (h && current()) {
      begin('resize', h.getAttribute('data-dir'), e);
      return true;
    }

    var dom = e.target.closest ? e.target.closest('.hw-obj') : null;
    if (!dom) { clear(); return false; }

    var id = dom.getAttribute('data-para');
    var pos = parseInt(dom.getAttribute('data-pos'), 10);
    if (!id || isNaN(pos)) return false;

    /* ★ 표는 고르지 않는다(hwRender.stamp 가 애초에 신원을 안 붙이지만 여기서도 막는다).
       표 바깥 크기는 칸 격자에서 다시 내므로 여기서 바꾸면 칸 폭 합과 갈라지고, 무엇보다
       Delete 한 번에 표가 통째로 지워진다. */
    var pre = hwModel.byId(id);
    var po = pre ? objAt(pre, pos) : null;
    if (!po || po.table || po.kind === 'table') { clear(); return false; }

    select(id, pos);
    /* ★ 글자처럼 취급하는 개체도 끌 수 있다 — 다만 옮겨지는 것이 자리(offset)가 아니라
       <b>글자 사이의 자리</b>다(endDrag → moveInline). 끌기를 아예 막아 두면 사용자에게는
       "그림이 안 움직인다" 로만 보인다. */
    begin('move', null, e);
    return true;
  }

  function begin(kind, dir, e) {
    var dom = domOf();
    var body = dom && dom.closest ? dom.closest('.hw-body') : null;
    if (!dom || !body) return;

    cDrag = {
      kind: kind, dir: dir,
      x0: e.clientX, y0: e.clientY,
      x1: e.clientX, y1: e.clientY,   /* 마지막 자리 — 놓은 곳의 글자 자리를 찾는 데 쓴다 */
      box: rectIn(dom, body),
      preview: null
    };
    paint();
  }

  function onMove(e) {
    if (!cDrag) return false;

    /* ★ 창 밖에서 단추를 놓으면 mouseup 이 안 온다 — 그러면 개체가 마우스를 계속 따라다닌다.
       단추가 이미 떨어졌으면 그 자리에서 끝낸다. (검사에서 만든 이벤트는 buttons 를 안 줄 수도
       있어서 undefined 는 눌린 것으로 본다.) */
    if (e.buttons === 0) { endDrag(); return true; }

    cDrag.x1 = e.clientX;
    cDrag.y1 = e.clientY;
    cDrag.preview = previewOf(e.clientX - cDrag.x0, e.clientY - cDrag.y0, e.shiftKey);
    paint();
    return true;
  }

  /* 끄는 중의 사각형(px). 모서리는 비율을 지키고, 변은 그 축만 늘린다. */
  function previewOf(dx, dy, shift) {
    var b = cDrag.box;
    if (cDrag.kind === 'move') return { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h };

    /* ★ 글자처럼 취급하는 개체는 <b>자리를 스스로 못 정한다</b> — 왼쪽·위 조절점으로 크기를
       바꿔도 왼쪽 위 모서리는 그 자리에 남고 오른쪽 아래가 따라온다. 미리보기도 그렇게 그린다.
       안 그러면 끌 때는 왼쪽으로 커졌다가 놓는 순간 오른쪽으로 커져 화면이 튄다. */
    var cur = current();
    var fixed = !!(cur && cur.obj.inline);

    var dir = cDrag.dir || 'se';
    var west = dir.indexOf('w') >= 0, east = dir.indexOf('e') >= 0;
    var north = dir.indexOf('n') >= 0, south = dir.indexOf('s') >= 0;

    var w = b.w + (east ? dx : 0) - (west ? dx : 0);
    var h = b.h + (south ? dy : 0) - (north ? dy : 0);

    /* 모서리(가로·세로가 같이 걸린 방향)는 비율을 지킨다. Shift 면 반대로 자유롭게 늘린다. */
    if ((east || west) && (north || south) && !shift && b.w > 0 && b.h > 0) {
      var k = Math.max(w / b.w, h / b.h);
      w = b.w * k;
      h = b.h * k;
    }

    var minPx = hwHu2Px(cMinHu);
    if (w < minPx) w = minPx;
    if (h < minPx) h = minPx;

    return {
      x: (west && !fixed) ? b.x + (b.w - w) : b.x,
      y: (north && !fixed) ? b.y + (b.h - h) : b.y,
      w: w, h: h
    };
  }

  /* document 의 mouseup 에서 부른다. */
  function endDrag() {
    if (!cDrag) return;

    var d = cDrag, pv = d.preview;
    cDrag = null;
    if (!pv) { paint(); return; }

    var dxHu = Math.round(hwPx2Hu(pv.x - d.box.x));
    var dyHu = Math.round(hwPx2Hu(pv.y - d.box.y));
    var dwHu = Math.round(hwPx2Hu(pv.w - d.box.w));
    var dhHu = Math.round(hwPx2Hu(pv.h - d.box.h));

    var cur = current();
    if (d.kind === 'move') {
      /* 글자처럼 취급하는 개체는 offset 이 없다 — 놓은 자리의 <b>글자 사이</b>로 옮긴다. */
      if (cur && cur.obj.inline) moveInline(d.x1, d.y1);
      else commit(0, 0, dxHu, dyHu);
    }
    else commit(dwHu, dhHu, dxHu, dyHu);
  }

  /* 글자처럼 취급하는 개체를 놓은 자리의 글자 사이로 옮긴다.
     ★ 다른 문단·표 칸으로도 간다 — hwCaret.hitTest 가 주는 자리를 그대로 쓰기 때문이다.
     ★ 저장은 지금 있는 길을 그대로 탄다(문단 두 개가 dirty 가 되고 objs 의 pos 가 바뀐다). */
  function moveInline(clientX, clientY) {
    var cur = current();
    if (!cur) return;

    /* ★ 놓은 자리가 쪽 밖(도구줄·상태줄·창 밖)이면 옮기지 않는다. 그때 paint 를 안 부르면
       미리보기 상자가 끌던 자리에 남아 개체가 옮겨진 것처럼 보인다. */
    var hit = hwCaret.hitTest(clientX, clientY);
    if (!hit) { paint(); return; }

    var to = hwModel.byId(hit.id);
    if (!to) { paint(); return; }

    var from = cur.para, o = cur.obj, at = cPos;
    var pos = hit.pos;

    /* 같은 문단 안에서 앞자리를 빼면 그 뒤 자리가 하나씩 당겨진다. */
    if (to === from) {
      if (pos > at) pos--;
      if (pos === at) { paint(); return; }
    }

    var ids = [from.id];
    if (to !== from) ids.push(to.id);

    hwInput.run(function () {
      hwModel.deleteRange(from, at, at + 1);
      hwModel.insertObj(to, pos, o);
      cId = to.id;
      cPos = pos;
      hwCaret.set(to.id, pos, false);
      return null;
    }, null, ids);
  }

  /* ── 모델에 반영 ─────────────────────────────────────── */

  function clampSize(v) { return Math.max(cMinHu, Math.min(cSaneHu, Math.round(v))); }
  function clampOff(v) { return Math.max(-cSaneHu, Math.min(cSaneHu, Math.round(v))); }

  /* ★ 지금 값에 움직인 만큼을 더할 때는 <b>화면이 쓰는 값</b>에 더한다. 모델에는 부호를 잘못 읽은
     42억 같은 값이 남아 있을 수 있는데(hwRender 가 그런 값을 화면에서만 0 으로 접는다),
     그 위에 더하면 조금 밀었는데도 미친 값이 그대로 파일로 간다 — PDF 가 19,926쪽이 됐던 자리다. */
  function shown(v) { return window.hwRenderer && hwRenderer.sane ? hwRenderer.sane(v) : (v || 0); }

  /* ★ hwInput.run 을 타야 되돌리기·재배치·상태줄이 한 벌로 돈다. 직접 고치면 화면만 바뀌고
       저장 요청에도 안 실린다(hwModel.markDirty 는 여기서 손으로 부른다 — 개체 크기만 바꾸는 편집은
       setItems 를 안 지나므로 dirty 로 잡히지도, 줄 캐시가 털리지도 않는다). */
  function commit(dwHu, dhHu, dxHu, dyHu) {
    var cur = current();
    if (!cur) return;
    if (!dwHu && !dhHu && !dxHu && !dyHu) return;

    var p = cur.para, o = cur.obj;

    /* ★ 고칠 문단을 <b>직접</b> 준다. hwInput 이 기본으로 쓰는 affected() 는 캐럿 자리로 목록을 내는데,
       개체를 고른 채로 캐럿만 따로 움직이는 길이 여럿이다 — 글자처럼 취급하는 개체에서 방향키를
       누르면 캐럿에 넘기고(onKey 가 false), Ctrl+Home 도 지나가고, Ctrl+Z 는 스냅샷의 캐럿을 복원한다.
       그때 이 인자가 없으면 되돌리기 스냅샷이 <b>엉뚱한 문단</b>을 담고, 더 나쁘게는 그 스냅샷의
       dirty 집합이 복원되면서 개체 문단의 dirty 표시가 벗겨진다 — 화면은 옮겨진 채 저장 요청에는
       그 문단이 안 실린다(예외도 상태줄 변화도 없다). */
    hwInput.run(function () {
      /* ★ 크기와 자리를 <b>따로</b> 표시한다. 옮기기만 했는데 크기까지 실어 보내면, 리더가
         안쪽 자식에서 읽어 온 크기(hwpx 리더는 재귀로 찾는다)가 바깥 개체에 써질 수 있다 —
         그림이 든 묶음 개체를 조금 밀었더니 묶음이 그림 크기로 줄어드는 식이다. */
      if ((dwHu || dhHu) && canResize(o)) {
        o.wHu = clampSize(shown(o.wHu) + dwHu);
        o.hHu = clampSize(shown(o.hHu) + dhHu);
        o._resized = true;
      }
      if (!o.inline && (dxHu || dyHu)) {
        o.xOffHu = clampOff(shown(o.xOffHu) + dxHu);
        o.yOffHu = clampOff(shown(o.yOffHu) + dyHu);
        o._moved = true;
      }
      hwModel.markDirty(p.id);
      return null;
    }, 'obj:' + (o.oid || o.tmpId || p.id), [p.id]);
  }

  function remove() {
    var cur = current();
    if (!cur) return;

    var p = cur.para, pos = cPos;
    cId = null;
    cPos = -1;

    hwInput.run(function () {
      hwModel.deleteRange(p, pos, pos + 1);
      hwCaret.set(p.id, Math.min(pos, p.len), false);
      return null;
    }, null, [p.id]);
  }

  /* ── 키 ──────────────────────────────────────────────── */

  /* hwInput.onKeyDown 이 캐럿보다 <b>먼저</b> 부른다. 먹었으면 true. */
  function onKey(e) {
    var cur = current();
    if (!cur) return false;

    if (e.key === 'Escape') { clear(); return true; }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (cur.obj.hidden) return false;   /* 안 보이는 컨트롤은 지키고 남긴다 */
      remove();
      return true;
    }

    var dx = 0, dy = 0;
    switch (e.key) {
      case 'ArrowLeft': dx = -cStepHu; break;
      case 'ArrowRight': dx = +cStepHu; break;
      case 'ArrowUp': dy = -cStepHu; break;
      case 'ArrowDown': dy = +cStepHu; break;
      default: return false;
    }

    if (e.shiftKey) {
      if (!canResize(cur.obj)) return false;
      commit(dx, dy, 0, 0);                               /* 크기 */
    }
    else if (!cur.obj.inline) commit(0, 0, dx, dy);       /* 자리 */
    else return false;                                    /* 글자처럼 취급이면 캐럿에 넘긴다 */
    return true;
  }

  /* 글자처럼 취급 <-> 어울림. 줄 배치가 통째로 달라지므로 반드시 재배치를 탄다. */
  function toggleInline() {
    var cur = current();
    if (!cur) return;

    var p = cur.para, o = cur.obj;
    var toFloat = !!o.inline;

    /* ★ 어울림으로 바꿀 때 <b>지금 보이는 자리를 오프셋으로 옮겨 담는다.</b> 그냥 0 으로 두면
       개체가 그 줄 왼쪽 위로 튀어 글자를 덮는데, 사용자 눈에는 "그림이 사라졌다" 로 보인다.
       어울림 개체의 원점은 그 줄(.hw-line)이라 줄 기준 상대 좌표가 곧 오프셋이다. */
    var dx = 0, dy = 0;
    if (toFloat) {
      var dom = domOf();
      var line = dom && dom.closest ? dom.closest('.hw-line') : null;
      if (dom && line) {
        var r = dom.getBoundingClientRect(), lr = line.getBoundingClientRect();
        dx = Math.round(hwPx2Hu(r.left - lr.left));
        dy = Math.round(hwPx2Hu(r.top - lr.top));
      }
    }

    hwInput.run(function () {
      o.inline = !o.inline;
      o.xOffHu = toFloat ? clampOff(dx) : 0;
      o.yOffHu = toFloat ? clampOff(dy) : 0;
      o._moved = true;
      o._flowed = true;          /* 취급 자체를 파일에도 쓴다 */
      hwModel.markDirty(p.id);
      return null;
    }, null, [p.id]);

    hwSetStatus({
      text: toFloat ? '어울림으로 바꿨습니다 — 끌어서 아무 자리에나 놓을 수 있습니다'
                    : '글자처럼 취급합니다 — 끌면 글자 사이 자리로 갑니다'
    });
  }

  return {
    select: select,
    clear: clear,
    current: current,
    paint: paint,
    onDown: onDown,
    onMove: onMove,
    endDrag: endDrag,
    onKey: onKey,
    toggleInline: toggleInline,
    dragging: function () { return !!cDrag; }
  };
})();
