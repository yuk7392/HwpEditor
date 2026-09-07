using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Windows.Forms;
using HwpEditor.Files;
using HwpEditor.Models;
using Newtonsoft.Json.Linq;

namespace HwpEditor
{
    /// <summary>
    /// 화면 밖에서 문서를 실제로 배치·렌더한 뒤 lineseg 오라클 결과를 받아 표로 낸다(<c>--render-oracle</c>).
    ///
    /// ★ 사람이 눌러서 확인하지 않는다. 사용자는 같은 데스크톱에서 계속 일하고 있고, 창을 띄우면
    ///   그 창이 사용자의 클릭을 받아 간다(0단계 실측). 화면 밖 좌표 + 비활성 표시로 띄운다.
    /// ★ 진짜 WebView2 안에서 돌린다 — 폰트 로드·canvas 측정이 실제 화면과 같은 조건이어야
    ///   여기서 나온 일치율이 화면에서도 같은 값이다.
    /// </summary>
    internal sealed class cRenderOracleForm : Form
    {
        private readonly cWebHost cWeb = new cWebHost();
        private readonly Panel cPanel = new Panel();
        private readonly Timer cTimeout = new Timer();

        private readonly string[] cPaths;
        private int cAt = -1;
        private bool cFinished;

        internal List<cOracleRow> Rows = new List<cOracleRow>();
        internal string Error;

        internal cRenderOracleForm(string[] pPaths, int pTimeoutSec)
        {
            cPaths = pPaths;

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
            cTimeout.Tick += delegate
            {
                Finish("시한 초과 — " + (cAt >= 0 && cAt < cPaths.Length ? Path.GetFileName(cPaths[cAt]) : "시작 전") + " 에서 응답 없음");
            };
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
                    case "ready": Next(); break;

                    case "docReady":
                        cLastMs = o["ms"] == null ? 0 : (int)o["ms"];
                        cWeb.Invoke("hwReportOracle()");
                        break;

                    case "oracle": OnOracle((JObject)o["r"]); break;
                }
            }
            catch (Exception ex)
            {
                Finish("메시지 처리 실패: " + ex.Message + "  (" + pJson + ")");
            }
        }

        private int cLastMs;

        private void Next()
        {
            cAt++;
            if (cAt >= cPaths.Length) { Finish(null); return; }

            // 파일 하나가 터져도 나머지는 계속 잰다 — 표가 한 줄에서 끊기면 비교가 안 된다.
            try
            {
                cDocument doc = cDocument.Open(cPaths[cAt]);
                cWeb.Invoke("hwLoadDoc(" + cJson.ToJson(doc.Model, false) + ")");
            }
            catch (Exception ex)
            {
                Rows.Add(cOracleRow.Failed(Path.GetFileName(cPaths[cAt]), ex.GetType().Name + ": " + ex.Message));
                Next();
            }
        }

        private void OnOracle(JObject r)
        {
            cOracleRow row = new cOracleRow();
            row.Name = Path.GetFileName(cPaths[cAt]);
            row.Total = (int)r["total"];
            row.Match = (int)r["match"];
            row.Rate = (double)r["rate"];
            row.Pages = (int)r["pages"];
            row.Lines = (int)r["lines"];
            row.DyAvg = (int)r["dyAvg"];
            row.DyMax = (int)r["dyMax"];
            row.Ms = cLastMs;
            row.FontOk = (bool?)r["fontGothic"] == true && (bool?)r["fontMyeongjo"] == true;
            JObject pb = r["probe"] as JObject;
            if (pb != null) row.Probe = "한글 " + (int)pb["hangul"] + " 공백 " + (int)pb["space"] + " 쉼표 " + (int)pb["comma"] + " A " + (int)pb["latinA"];

            JArray det = r["details"] as JArray;
            if (det != null)
                foreach (JToken d in det)
                {
                    if (row.Details.Count >= 5) break;
                    row.Details.Add("      " + (string)d["id"] + "  기대 [" + Join(d["expect"]) + "]  실제 [" + Join(d["actual"]) + "]  \"" + (string)d["text"] + "\"");
                }

            Rows.Add(row);
            Next();
        }

        private static string Join(JToken pArray)
        {
            JArray a = pArray as JArray;
            if (a == null) return "";
            List<string> parts = new List<string>();
            foreach (JToken t in a) parts.Add(((int)t).ToString(CultureInfo.InvariantCulture));
            return string.Join(",", parts.ToArray());
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

    internal sealed class cOracleRow
    {
        internal string Name;
        internal int Total, Match, Pages, Lines, DyAvg, DyMax, Ms;
        internal double Rate;
        internal bool FontOk;
        internal string Err, Probe;
        internal List<string> Details = new List<string>();

        internal static cOracleRow Failed(string pName, string pErr)
        {
            cOracleRow r = new cOracleRow();
            r.Name = pName;
            r.Err = pErr;
            return r;
        }
    }
}
