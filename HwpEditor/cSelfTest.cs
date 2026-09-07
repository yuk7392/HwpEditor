using System;
using System.Collections.Generic;
using System.Globalization;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;

namespace HwpEditor
{
    /// <summary>
    /// 화면을 사용자에게 안 보이고 편집기 문서를 실제로 띄워 확인하는 통로(<c>--selftest</c>).
    ///
    /// ★ 왜 사람이 눌러서 확인하지 않는가: 사용자는 같은 데스크톱에서 계속 일하고 있다.
    ///   확인하겠다고 창을 띄우면 그 창이 사용자의 클릭을 받아 간다(실측 — 창을 띄워 두는 동안
    ///   "열기" 대화상자가 저 혼자 뜬 것처럼 보였다). 그래서 화면 밖에 두고 활성화도 안 시킨다.
    ///
    /// ★ WebView2 는 창 핸들이 있어야 초기화되므로 폼을 아예 안 띄울 수는 없다.
    ///   화면 밖 좌표 + 작업표시줄 숨김 + <see cref="ShowWithoutActivation"/> 로 포커스를 안 뺏는다.
    /// </summary>
    internal sealed class cSelfTestForm : Form
    {
        private readonly cWebHost cWeb = new cWebHost();
        private readonly Panel cPanel = new Panel();
        private readonly Timer cTimeout = new Timer();
        private readonly List<string> cSteps = new List<string>();

        private int cPhase;      // 0=ready 대기, 1=1차 selftest 대기, 2=ping 후 2차 selftest 대기
        private bool cFinished;

        internal bool Ok { get; private set; }
        internal string Report { get { return string.Join(Environment.NewLine, cSteps.ToArray()); } }

        internal cSelfTestForm(int pTimeoutSec)
        {
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Location = new System.Drawing.Point(-4000, -4000);
            ClientSize = new System.Drawing.Size(1024, 720);
            Opacity = 0;

            cPanel.Dock = DockStyle.Fill;
            cPanel.BackColor = System.Drawing.Color.White;
            Controls.Add(cPanel);

            cWeb.WebMessage += Web_WebMessage;
            cWeb.Failed += delegate { Finish(false, "화면 초기화 실패: " + cWeb.Status); };

            cTimeout.Interval = Math.Max(1, pTimeoutSec) * 1000;
            cTimeout.Tick += delegate { Finish(false, "시한 초과 — 단계 " + cPhase + " 에서 응답 없음"); };
        }

        /// <summary>★ 포커스를 안 뺏는다. 사용자가 타이핑 중인 창이 앞에 그대로 있어야 한다.</summary>
        protected override bool ShowWithoutActivation { get { return true; } }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            cTimeout.Start();
            cWeb.Attach(cPanel);
        }

        private void Web_WebMessage(object sender, string pJson)
        {
            try
            {
                JObject o = JObject.Parse(pJson);
                switch ((string)o["t"])
                {
                    case "ready":
                        if (cPhase != 0) return;
                        cSteps.Add("[1] ready 수신 — 문서가 떴다 (ver=" + (string)o["ver"] + ")");
                        cPhase = 1;
                        // C# → JS 로 상태줄을 세운 뒤, 그 값을 JS 가 되읽어 올려 보내게 한다.
                        cWeb.Invoke("hwSetStatus({\"text\":\"준비됨\"})");
                        cWeb.Invoke("hwSelfTest()");
                        break;

                    case "ping":
                        // mdiHwpEditor 와 같은 응답을 낸 뒤, 그 결과가 문서에 닿았는지 되묻는다.
                        // ExecuteScriptAsync 는 보낸 순서대로 도므로 두 줄의 순서가 곧 보장이다.
                        cWeb.Invoke("hwPong({\"n\":" + (int)o["n"] + ",\"ms\":0})");
                        cWeb.Invoke("hwSelfTest()");
                        break;

                    case "selftest":
                        if (cPhase == 1) OnFirstSelfTest(o);
                        else if (cPhase == 2) OnSecondSelfTest(o);
                        break;

                    case "menu":
                        // 자체점검 중에는 사람이 누를 일이 없다. 눌렸다면 사용자 데스크톱의 클릭이 새어든 것이다.
                        cSteps.Add("[!] 예상치 못한 menu 메시지: " + pJson);
                        break;
                }
            }
            catch (Exception ex)
            {
                Finish(false, "메시지 처리 실패: " + ex.Message + "  (" + pJson + ")");
            }
        }

        private void OnFirstSelfTest(JObject o)
        {
            int pages = (int)o["pages"];
            double w = (double)o["w"], h = (double)o["h"];
            string bg = (string)o["bg"], status = (string)o["status"];

            bool ok = true;
            ok &= Check("빈 A4 1쪽", pages == 1, "pages=" + pages);
            ok &= Check("쪽 폭 793.71px", Math.Abs(w - 793.71) <= 0.02, "w=" + w.ToString(CultureInfo.InvariantCulture));
            ok &= Check("쪽 높이 1122.51px", Math.Abs(h - 1122.51) <= 0.02, "h=" + h.ToString(CultureInfo.InvariantCulture));
            ok &= Check("editor.css 적용(쪽 배경 흰색)", bg == "rgb(255, 255, 255)", "bg=" + bg);
            ok &= Check("C#→JS 상태줄", status == "준비됨", "status=\"" + status + "\"");

            if (!ok) { Finish(false, "1차 점검 실패"); return; }

            cPhase = 2;
            cWeb.Invoke("hwFirePing()");   // JS→C#→JS 왕복을 사람 손 없이 태운다
        }

        private void OnSecondSelfTest(JObject o)
        {
            string status = (string)o["status"];
            bool ok = Check("ping→pong 왕복", status != null && status.StartsWith("pong n=1"), "status=\"" + status + "\"");
            Finish(ok, ok ? "자체점검 통과" : "ping 왕복 실패");
        }

        private bool Check(string pName, bool pOk, string pActual)
        {
            cSteps.Add((pOk ? "  OK   " : "  실패 ") + pName + "  →  " + pActual);
            return pOk;
        }

        private void Finish(bool pOk, string pMessage)
        {
            if (cFinished) return;
            cFinished = true;
            cTimeout.Stop();
            Ok = pOk;
            cSteps.Add((pOk ? "결과: 통과 — " : "결과: 실패 — ") + pMessage);
            Close();
        }
    }
}
