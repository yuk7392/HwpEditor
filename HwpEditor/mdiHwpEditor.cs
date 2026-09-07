using System;
using System.Diagnostics;
using System.Windows.Forms;
using HwpEditor.Files;
using HwpEditor.Models;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace HwpEditor
{
    /// <summary>
    /// 창 하나. WinForms 쪽 역할은 빈 Panel 하나와 파일 대화상자뿐이고,
    /// 메뉴·툴바·상태줄은 전부 문서 안(cWebHost)에 있다.
    /// </summary>
    public partial class mdiHwpEditor : Form
    {
        private readonly cWebHost cWeb = new cWebHost();

        public mdiHwpEditor()
        {
            InitializeComponent();

            cWeb.WebMessage += Web_WebMessage;
            cWeb.Failed += Web_Failed;
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            cWeb.Attach(pnlWeb);
        }

        private void Web_Failed(object sender, EventArgs e)
        {
            MessageBox.Show(this,
                "편집기 화면을 띄우지 못했습니다." + Environment.NewLine + Environment.NewLine
                + "진단: " + cWeb.Status + Environment.NewLine
                + "로더: " + Program.WebView2LoaderStatus,
                "HwpEditor", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }

        /// <summary>문서에서 올라온 메시지 한 줄. ★ UI 스레드에서 온다.</summary>
        private void Web_WebMessage(object sender, string pJson)
        {
            try
            {
                JObject o = JObject.Parse(pJson);
                string t = (string)o["t"];
                switch (t)
                {
                    case "ready":
                        SetStatus("준비됨");
                        break;

                    case "ping":
                        {
                            Stopwatch sw = Stopwatch.StartNew();
                            int n = o["n"] == null ? 0 : (int)o["n"];
                            sw.Stop();
                            cWeb.Invoke("hwPong({\"n\":" + n + ",\"ms\":" + sw.ElapsedMilliseconds + "})");
                            break;
                        }

                    case "menu":
                        OnMenu((string)o["cmd"]);
                        break;

                    default:
                        cLog.Write("모르는 메시지: " + pJson);
                        break;
                }
            }
            catch (Exception ex)
            {
                cLog.Write("메시지 처리 실패: " + pJson);
                cLog.Write(ex);
            }
        }

        private void OnMenu(string pCmd)
        {
            switch (pCmd)
            {
                case "open":
                    using (OpenFileDialog dlg = new OpenFileDialog())
                    {
                        dlg.Filter = "한글 문서 (*.hwp;*.hwpx)|*.hwp;*.hwpx|한글 5.0 (*.hwp)|*.hwp|한글 OWPML (*.hwpx)|*.hwpx|모든 파일 (*.*)|*.*";
                        dlg.Title = "문서 열기";
                        if (dlg.ShowDialog(this) != DialogResult.OK) return;
                        OpenDocument(dlg.FileName);
                    }
                    break;

                default:
                    SetStatus("아직 없는 명령: " + pCmd);
                    break;
            }
        }

        /// <summary>
        /// 문서를 열어 화면에 보낸다. ★ 파일을 여는 길은 <see cref="cHwpDocument"/> 하나뿐이다 —
        /// CLI 오라클도 같은 길을 지나야 화면에서 본 것과 검사한 것이 같아진다.
        /// </summary>
        internal void OpenDocument(string pPath)
        {
            try
            {
                SetStatus("여는 중… " + System.IO.Path.GetFileName(pPath));
                cDoc = cDocument.Open(pPath);
                cWeb.Invoke("hwLoadDoc(" + cJson.ToJson(cDoc.Model, false) + ")");
            }
            catch (Exception ex)
            {
                cLog.Write(ex);
                SetStatus("열기 실패: " + ex.Message);
                MessageBox.Show(this, "문서를 열지 못했습니다." + Environment.NewLine + Environment.NewLine + ex.Message,
                    "HwpEditor", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private cDocument cDoc;

        private void SetStatus(string pText)
        {
            cWeb.Invoke("hwSetStatus({\"text\":" + JsonConvert.ToString(pText ?? "") + "})");
        }
    }
}
