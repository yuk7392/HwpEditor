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

                    case "save":
                        OnSave(o.ToObject<SaveRequest>());
                        break;

                    case "printReady":
                        ExportPdf();
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

                case "insertImage":
                    OnInsertImage();
                    break;

                case "pdf":
                    // 실제 인쇄는 화면이 "모든 쪽을 채웠다"고 알린 뒤에 한다(printReady).
                    cPdfPath = AskPdfPath();
                    if (string.IsNullOrEmpty(cPdfPath)) return;
                    SetStatus("PDF 준비 중…");
                    cWeb.Invoke("hwPrintPrepare()");
                    break;

                default:
                    SetStatus("아직 없는 명령: " + pCmd);
                    break;
            }
        }

        /// <summary>
        /// 문서를 열어 화면에 보낸다. ★ 파일을 여는 길은 <see cref="cDocument"/> 하나뿐이다 —
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

        #region 저장 · 그림

        /// <summary>
        /// 화면이 모은 편집분을 받아 원본에 반영하고 저장한다(계획 6절).
        ///
        /// ★ 실패를 조용히 삼키지 않는다 — 화면은 ok 를 보고 dirty 집합을 비우므로,
        ///   실패했는데 성공이라고 답하면 사용자가 고친 것이 그 자리에서 사라진다.
        /// </summary>
        private void OnSave(SaveRequest pReq)
        {
            if (cDoc == null) { Reply(Fail("문서를 먼저 여세요")); return; }

            string path = cDoc.Path;
            if (pReq != null && pReq.SaveAs) path = AskSavePath();
            if (string.IsNullOrEmpty(path)) { Reply(Fail("저장을 취소했습니다")); return; }

            try
            {
                SetStatus("저장 중… " + System.IO.Path.GetFileName(path));
                SaveResult r = cDoc.Save(path, pReq);
                r.Rev = (pReq == null ? 1 : pReq.Rev) + 1;
                Reply(r);
                SetStatus("저장함 — " + path);

                // ★ 표 구조를 바꿨으면 문서를 다시 읽어 화면에 보낸다. 다시 세운 표의 문단은
                //   전부 새 객체라, 화면이 들고 있던 id 로는 그다음 편집을 되쓸 수 없다.
                if (r.Reload) OpenDocument(path);
            }
            catch (Exception ex)
            {
                cLog.Write(ex);
                Reply(Fail(ex.Message));
                MessageBox.Show(this, "저장하지 못했습니다." + Environment.NewLine + Environment.NewLine + ex.Message,
                    "HwpEditor", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private string AskSavePath()
        {
            using (SaveFileDialog dlg = new SaveFileDialog())
            {
                bool hwpx = string.Equals(cDoc.Format, "hwpx", StringComparison.OrdinalIgnoreCase);
                dlg.Filter = hwpx ? "한글 OWPML (*.hwpx)|*.hwpx" : "한글 5.0 (*.hwp)|*.hwp";
                dlg.DefaultExt = hwpx ? "hwpx" : "hwp";
                dlg.Title = "다른 이름으로 저장";
                if (!string.IsNullOrEmpty(cDoc.Path)) dlg.FileName = System.IO.Path.GetFileName(cDoc.Path);
                return dlg.ShowDialog(this) == DialogResult.OK ? dlg.FileName : null;
            }
        }

        private static SaveResult Fail(string pMsg)
        {
            SaveResult r = new SaveResult();
            r.Ok = false;
            r.Msg = pMsg;
            return r;
        }

        private void Reply(SaveResult pResult)
        {
            cWeb.Invoke("hwSaved(" + cJson.ToJson(pResult, false) + ")");
        }

        /// <summary>
        /// 그림 파일을 골라 화면에 넘긴다. 실물은 <b>저장할 때</b> 문서에 들어가고, 지금은 미리보기만 간다
        /// (계획 6절 — 편집마다 왕복하지 않는다).
        /// </summary>
        private void OnInsertImage()
        {
            if (cDoc == null) { SetStatus("문서를 먼저 여세요"); return; }

            string file;
            using (OpenFileDialog dlg = new OpenFileDialog())
            {
                dlg.Filter = "그림 (*.png;*.jpg;*.jpeg;*.gif;*.bmp)|*.png;*.jpg;*.jpeg;*.gif;*.bmp|모든 파일 (*.*)|*.*";
                dlg.Title = "그림 넣기";
                if (dlg.ShowDialog(this) != DialogResult.OK) return;
                file = dlg.FileName;
            }

            try
            {
                long maxW = 40000;
                DocModel m = cDoc.Model;
                if (m.Sections.Count > 0) maxW = m.Sections[0].Page.TextWidthHu;

                long wHu, hHu;
                string src = cImageStore.Preview(file, cImageStore.DocKey(cDoc.Path), maxW, out wHu, out hHu);

                JObject info = new JObject();
                info["file"] = file;
                info["src"] = src;
                info["wHu"] = wHu;
                info["hHu"] = hHu;
                cWeb.Invoke("hwInsertImage(" + info.ToString(Formatting.None) + ")");
            }
            catch (Exception ex)
            {
                cLog.Write(ex);
                SetStatus("그림을 넣지 못했습니다: " + ex.Message);
            }
        }

        #endregion

        #region PDF 내보내기(7단계)

        private string cPdfPath;

        private string AskPdfPath()
        {
            using (SaveFileDialog dlg = new SaveFileDialog())
            {
                dlg.Filter = "PDF (*.pdf)|*.pdf";
                dlg.DefaultExt = "pdf";
                dlg.Title = "PDF 로 내보내기";
                if (!string.IsNullOrEmpty(cDoc.Path))
                    dlg.FileName = System.IO.Path.GetFileNameWithoutExtension(cDoc.Path) + ".pdf";
                return dlg.ShowDialog(this) == DialogResult.OK ? dlg.FileName : null;
            }
        }

        /// <summary>
        /// ★ async void 다 — 여기서 새는 예외는 프로세스를 죽인다. 전부 감싼다.
        /// ★ 끝나면 반드시 가상 스크롤을 되돌린다(hwPrintDone). 안 그러면 100쪽 문서가
        ///   전부 펼쳐진 채로 남아 그 뒤 편집이 눈에 띄게 느려진다.
        /// </summary>
        private async void ExportPdf()
        {
            string path = cPdfPath;
            cPdfPath = null;
            if (string.IsNullOrEmpty(path) || cDoc == null) return;

            try
            {
                double wIn = 8.27, hIn = 11.69;
                DocModel m = cDoc.Model;
                if (m.Sections.Count > 0)
                {
                    wIn = m.Sections[0].Page.WHu / 7200.0;
                    hIn = m.Sections[0].Page.HHu / 7200.0;
                }

                bool ok = await cWeb.PrintToPdfAsync(path, wIn, hIn);
                SetStatus(ok ? "PDF 로 내보냈습니다 — " + path : "PDF 내보내기 실패");
            }
            catch (Exception ex)
            {
                cLog.Write(ex);
                SetStatus("PDF 내보내기 실패: " + ex.Message);
            }
            finally
            {
                cWeb.Invoke("hwPrintDone()");
            }
        }

        #endregion

        private cDocument cDoc;

        private void SetStatus(string pText)
        {
            cWeb.Invoke("hwSetStatus({\"text\":" + JsonConvert.ToString(pText ?? "") + "})");
        }
    }
}
