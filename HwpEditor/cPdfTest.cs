using System;
using System.IO;
using System.Windows.Forms;
using HwpEditor.Files;
using HwpEditor.Models;
using Newtonsoft.Json.Linq;

namespace HwpEditor
{
    /// <summary>
    /// ★ 사람이 메뉴를 눌러 확인하지 않는다 — 창을 띄우면 사용자가 쓰는 창의 초점을 뺏는다.
    ///   화면 밖에 띄우고 같은 길(hwPrintPrepare → printReady → PrintToPdfAsync)을 그대로 태운다.
    /// </summary>
    internal sealed class cPdfForm : Form
    {
        private readonly cWebHost cWeb = new cWebHost();
        private readonly Panel cPanel = new Panel();
        private readonly Timer cTimeout = new Timer();

        private readonly string cPath;
        private readonly string cOut;
        private bool cFinished;

        internal string Error;
        internal int Pages;
        internal string Shape;
        internal bool Ok;

        internal cPdfForm(string pPath, string pOut, int pTimeoutSec)
        {
            cPath = pPath;
            cOut = pOut;

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

            cTimeout.Interval = Math.Max(10, pTimeoutSec) * 1000;
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
                        cDoc = cDocument.Open(cPath);
                        cWeb.Invoke("hwLoadDoc(" + cJson.ToJson(cDoc.Model, false) + ")");
                        break;

                    case "docReady":
                        cWeb.Invoke("hwPrintPrepare()");
                        break;

                    case "printReady":
                        Pages = o["pages"] == null ? 0 : (int)o["pages"];
                        Shape = "bodyH=" + o["bodyH"] + " bodyW=" + o["bodyW"]
                              + " canvasH=" + o["canvasH"] + " canvasW=" + o["canvasW"]
                              + " pageH=" + o["pageH"] + " | " + o["worst"];
                        Print();
                        break;
                }
            }
            catch (Exception ex)
            {
                Finish("메시지 처리 실패: " + ex.Message);
            }
        }

        private cDocument cDoc;

        private async void Print()
        {
            try
            {
                double wIn = 8.27, hIn = 11.69;
                if (cDoc.Model.Sections.Count > 0)
                {
                    wIn = cDoc.Model.Sections[0].Page.WHu / 7200.0;
                    hIn = cDoc.Model.Sections[0].Page.HHu / 7200.0;
                }

                Ok = await cWeb.PrintToPdfAsync(cOut, wIn, hIn);
                Finish(Ok ? null : "PrintToPdfAsync 가 실패를 돌려줬다");
            }
            catch (Exception ex)
            {
                Finish("인쇄 실패: " + ex.Message);
            }
        }

        private void Finish(string pError)
        {
            if (cFinished) return;
            cFinished = true;
            cTimeout.Stop();
            if (Error == null) Error = pError;
            Close();
        }
    }

    internal static class cPdfRunner
    {
        internal static int Run(string[] pArgs)
        {
            if (pArgs.Length < 3) { Console.WriteLine("사용법: --pdf <문서> <출력.pdf> [시한초]"); return 2; }

            string path = pArgs[1], outPdf = Path.GetFullPath(pArgs[2]);
            int timeout = pArgs.Length > 3 ? int.Parse(pArgs[3]) : 90;

            Program.PrepareWebView2Loader();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            cPdfForm form = new cPdfForm(path, outPdf, timeout);
            using (form) Application.Run(form);

            bool ok = form.Ok && File.Exists(outPdf);
            long size = ok ? new FileInfo(outPdf).Length : 0;
            int pdfPages = ok ? CountPdfPages(outPdf) : 0;

            Console.WriteLine("SHAPE " + form.Shape);
            Console.WriteLine("SUMMARY file=" + Path.GetFileName(path)
                            + " layoutPages=" + form.Pages + " pdfPages=" + pdfPages
                            + " bytes=" + size + " ok=" + (ok && pdfPages == form.Pages));

            if (form.Error != null) { Console.WriteLine("중단: " + form.Error); return 3; }

            Console.WriteLine(Path.GetFileName(path) + " → " + Path.GetFileName(outPdf)
                            + " — 우리 배치 " + form.Pages + "쪽, PDF " + pdfPages + "쪽 "
                            + (pdfPages == form.Pages ? "일치" : "불일치"));
            return (ok && pdfPages == form.Pages) ? 0 : 1;
        }

        /// <summary>
        /// PDF 쪽 수. ★ 라이브러리를 안 쓴다 — 쪽 수 하나 세자고 의존을 늘리지 않는다.
        ///   페이지 개체는 <c>/Type /Page</c> 로 표시되고 목록은 <c>/Type /Pages</c> 다(복수형은 뺀다).
        /// </summary>
        private static int CountPdfPages(string pPath)
        {
            byte[] raw = File.ReadAllBytes(pPath);
            string text = System.Text.Encoding.ASCII.GetString(raw);

            int n = 0, at = 0;
            while (true)
            {
                at = text.IndexOf("/Type", at, StringComparison.Ordinal);
                if (at < 0) break;
                at += 5;

                int i = at;
                while (i < text.Length && (text[i] == ' ' || text[i] == '\r' || text[i] == '\n')) i++;
                if (i + 5 <= text.Length && text.Substring(i, 5) == "/Page")
                {
                    char next = i + 5 < text.Length ? text[i + 5] : ' ';
                    if (next != 's') n++;   // /Pages 는 목록이라 세지 않는다
                }
            }
            return n;
        }
    }
}
