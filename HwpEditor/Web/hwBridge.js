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

/* C# 이 눌러 주는 "테스트" 버튼. 사람 손 없이 ping 왕복을 태운다. */
function hwFirePing() {
  hwPingSeq += 1;
  hwPost({ t: 'ping', n: hwPingSeq });
}

/* ── 문서 → C# ───────────────────────────────────────────── */

var hwPingSeq = 0;

document.addEventListener('DOMContentLoaded', function () {
  var menu = document.getElementById('hwMenu');
  if (menu) {
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
      if (cmd) hwPost({ t: 'menu', cmd: cmd });
    });
  }

  hwBridge.flush();
  hwPost({ t: 'ready', ver: '0.1' });
});
