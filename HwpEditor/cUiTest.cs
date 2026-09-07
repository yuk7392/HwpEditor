using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Windows.Forms;
using HwpEditor.Files;
using HwpEditor.Models;
using Newtonsoft.Json.Linq;

namespace HwpEditor
{
    /// <summary>
    /// 조작 점검(<c>--ui-test</c>). 눌러 봐야만 나오는 결함을 화면 밖에서 태운다 —
    /// 연타·선택 삭제·실행취소·IME 조합·붙여넣기·그림 넣기, 그리고 캐럿이 글자 자리에 서는지까지.
    ///
    /// ★ 전역 입력 주입(SendKeys)을 쓰지 않는다. 그건 그 순간 포커스를 가진 창 — 사용자가
    ///   타이핑하고 있는 창 — 으로 들어간다. 문서 안 수신기에 이벤트를 직접 보내는 길만 쓴다.
    /// ★ 창은 화면 밖에 두고 활성화도 안 시킨다(<see cref="cSelfTestForm"/> 와 같은 이유).
    /// </summary>
    internal sealed class cUiTestForm : Form
    {
        private readonly cWebHost cWeb = new cWebHost();
        private readonly Panel cPanel = new Panel();
        private readonly Timer cTimeout = new Timer();

        private readonly string cPath;
        private readonly string cImage;
        private bool cFinished;

        internal readonly List<string> Steps = new List<string>();
        internal string Error;
        internal string OpsJson;
        internal bool Ok;
        internal double DriftPx = -1;
        internal string DriftAt;
        internal readonly List<string> Probe = new List<string>();

        internal cUiTestForm(string pPath, string pImage, int pTimeoutSec)
        {
            cPath = pPath;
            cImage = pImage;

            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false;
            StartPosition = FormStartPosition.Manual;
            Location = new System.Drawing.Point(-4000, -4000);
            ClientSize = new System.Drawing.Size(1200, 900);
            Opacity = 0;

            cPanel.Dock = DockStyle.Fill;
            cPanel.BackColor = System.Drawing.Color.White;
            Controls.Add(cPanel);

            cWeb.WebMessage += Web_WebMessage;
            cWeb.Failed += delegate { Finish("화면 초기화 실패: " + cWeb.Status); };

            cTimeout.Interval = Math.Max(5, pTimeoutSec) * 1000;
            cTimeout.Tick += delegate { Finish("시한 초과 — 응답 없음"); };
        }

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
                        {
                            cDocument doc = cDocument.Open(cPath);
                            cWeb.Invoke("hwUiTestImage=" + Newtonsoft.Json.JsonConvert.ToString(cImage ?? ""));

                            // 화면이 저장 전에도 그림을 볼 수 있어야 한다 — 실제 메뉴가 지나는 길을 그대로 태운다.
                            if (!string.IsNullOrEmpty(cImage) && File.Exists(cImage))
                            {
                                long w, h;
                                string src = cImageStore.Preview(cImage, cImageStore.DocKey(doc.Path), 40000, out w, out h);
                                cWeb.Invoke("hwUiTestSrc=" + Newtonsoft.Json.JsonConvert.ToString(src ?? ""));
                            }
                            cWeb.Invoke("hwLoadDoc(" + cJson.ToJson(doc.Model, false) + ")");
                            break;
                        }

                    case "docReady":
                        cWeb.Invoke("hwUiTest()");
                        break;

                    case "uitest":
                        OnResult(o);
                        break;
                }
            }
            catch (Exception ex)
            {
                Finish("메시지 처리 실패: " + ex.Message);
            }
        }

        private void OnResult(JObject o)
        {
            bool all = true;
            JArray steps = o["steps"] as JArray;
            if (steps != null)
                foreach (JToken s in steps)
                {
                    bool ok = (bool?)s["ok"] == true;
                    all &= ok;
                    Steps.Add((ok ? "  OK   " : "  실패 ") + (string)s["name"] + "  →  " + (string)s["got"]);
                }

            JObject d = o["drift"] as JObject;
            if (d != null)
            {
                DriftPx = (double)d["px"];
                DriftAt = (string)d["at"];

                JArray probe = d["probe"] as JArray;
                if (probe != null)
                    foreach (JToken t in probe)
                        Probe.Add("    k=" + t["k"] + " nth=" + t["nth"] + " '" + t["ch"] + "'"
                                + " 우리=" + t["our"] + "px 화면=" + t["dom"] + "px"
                                + " 폭 " + t["cw"] + "/" + t["nat"] + " (크기 " + t["size"] + ")");
            }

            // ★ 모양 목록까지 같이 담는다 — 서식을 건 저장 요청은 그것 없이는 되쓰기가 못 푼다.
            JToken ops = o["ops"];
            if (ops != null)
            {
                JObject req = new JObject();
                req["t"] = "save";
                req["rev"] = 1;
                req["saveAs"] = false;
                if (o["charShapes"] != null) req["charShapes"] = o["charShapes"];
                if (o["paraShapes"] != null) req["paraShapes"] = o["paraShapes"];
                req["ops"] = ops;
                OpsJson = req.ToString(Newtonsoft.Json.Formatting.None);
            }

            Ok = all;
            Finish(null);
        }

        private void Finish(string pError)
        {
            if (cFinished) return;
            cFinished = true;
            cTimeout.Stop();
            Error = pError;
            Close();
        }
    }

    internal static class cUiTestRunner
    {
        /// <summary>사용법: <c>--ui-test &lt;문서&gt; [그림파일] [ops출력.json] [시한초]</c></summary>
        internal static int Run(string[] pArgs)
        {
            if (pArgs.Length < 2) { Console.WriteLine("사용법: --ui-test <문서> [그림파일] [ops출력.json] [시한초]"); return 2; }

            string path = pArgs[1];
            string image = pArgs.Length > 2 ? Path.GetFullPath(pArgs[2]) : "";
            string opsOut = pArgs.Length > 3 ? pArgs[3] : null;
            int timeout = pArgs.Length > 4 ? int.Parse(pArgs[4]) : 60;

            Program.PrepareWebView2Loader();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            cUiTestForm form = new cUiTestForm(path, image, timeout);
            using (form) Application.Run(form);

            foreach (string s in form.Steps) Console.WriteLine(s);

            // Form 은 MarshalByRefObject 라 필드 멤버를 바로 부르면 경고가 난다 — 값을 옮겨 쓴다.
            double drift = form.DriftPx;
            if (drift >= 0)
            {
                Console.WriteLine();
                Console.WriteLine("캐럿 어긋남 최대 " + drift.ToString("0.0") + "px"
                                + (string.IsNullOrEmpty(form.DriftAt) ? "" : "  (" + form.DriftAt + ")"));
                foreach (string s2 in form.Probe) Console.WriteLine(s2);
            }

            if (opsOut != null && form.OpsJson != null)
            {
                File.WriteAllText(opsOut, form.OpsJson, new UTF8Encoding(false));
                Console.WriteLine("저장 요청을 썼다: " + opsOut + " (" + form.OpsJson.Length + "자)");
            }

            // ★ 한 줄 요약은 ASCII 로 낸다 — 여러 개를 한꺼번에 돌리고 걸러 볼 때
            //   한글 패턴은 셸의 인코딩에 걸려 조용히 하나도 안 맞는다(실측).
            int fail = 0;
            foreach (string s3 in form.Steps) if (s3.StartsWith("  실패")) fail++;
            Console.WriteLine();
            Console.WriteLine("SUMMARY file=" + Path.GetFileName(path) + " steps=" + form.Steps.Count
                            + " fail=" + fail + " driftPx=" + drift.ToString("0.0"));

            Console.WriteLine();
            if (form.Error != null) { Console.WriteLine("중단: " + form.Error); return 3; }

            Console.WriteLine(Path.GetFileName(path) + " 조작 점검 — " + (form.Ok ? "통과" : "실패"));
            return form.Ok ? 0 : 1;
        }
    }
}
