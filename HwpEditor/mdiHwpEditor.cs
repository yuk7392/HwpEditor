using System;
using System.Diagnostics;
using System.Windows.Forms;
using HwpEditor.Files;
using HwpEditor.Models;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace HwpEditor
{
    public partial class mdiHwpEditor : Form
    {
        private readonly cWebHost cWeb = new cWebHost();

        internal string cStartPath;

        public mdiHwpEditor()
        {
            InitializeComponent();

            cWeb.WebMessage += Web_WebMessage;
            cWeb.Failed += Web_Failed;
        }

        protected override void OnLoad(EventArgs e)
        {
            base.OnLoad(e);

            // ★ 파일 드롭은 WinForms 쪽에서 받는다. 문서(WebView2) 쪽에서 받으면 전체 경로를 못 얻어
            //   우리가 열 수가 없다 — cWebHost 가 AllowExternalDrop 을 꺼서 여기로 넘겨준다.
            AllowDrop = true;
            pnlWeb.AllowDrop = true;
            pnlWeb.DragEnter += Host_DragEnter;
            pnlWeb.DragDrop += Host_DragDrop;

            cWeb.Attach(pnlWeb);
        }

        #region 드래그&드롭으로 열기

        private void Host_DragEnter(object sender, DragEventArgs e)
        {
            e.Effect = DropPath(e.Data) != null ? DragDropEffects.Copy : DragDropEffects.None;
        }

        private void Host_DragDrop(object sender, DragEventArgs e)
        {
            string path = DropPath(e.Data);
            if (path == null) return;

            // 창을 앞으로 세운다 — 탐색기에서 끌어다 놓으면 그쪽에 초점이 남아 있다.
            Activate();
            if (!ConfirmDiscard()) return;
            OpenDocument(path);
        }

        /// <summary>끌어온 것 중 우리가 열 수 있는 <b>첫 파일 하나</b>. 여러 개를 열 창이 없다.</summary>
        private static string DropPath(IDataObject pData)
        {
            if (pData == null || !pData.GetDataPresent(DataFormats.FileDrop)) return null;

            string[] files = pData.GetData(DataFormats.FileDrop) as string[];
            if (files == null) return null;

            foreach (string f in files)
            {
                if (string.IsNullOrEmpty(f)) continue;
                string ext = System.IO.Path.GetExtension(f);
                if (string.Equals(ext, ".hwp", StringComparison.OrdinalIgnoreCase)
                 || string.Equals(ext, ".hwpx", StringComparison.OrdinalIgnoreCase)) return f;
            }
            return null;
        }

        #endregion

        private void Web_Failed(object sender, EventArgs e)
        {
            MessageBox.Show(this,
                "편집기 화면을 띄우지 못했습니다." + Environment.NewLine + Environment.NewLine
                + "진단: " + cWeb.Status + Environment.NewLine
                + "로더: " + Program.WebView2LoaderStatus,
                "HwpEditor", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }

        /// <summary>★ UI 스레드에서 온다.</summary>
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
                        SendRecent();
                        UpdateTitle();

                        // ★ 명령줄로 받은 문서는 화면이 뜬 <b>뒤에</b> 연다. 먼저 열면 무거운 파싱이
                        //   화면 기동을 막아 흰 창이 오래 보인다.
                        if (!string.IsNullOrEmpty(cStartPath))
                        {
                            string start = cStartPath;
                            cStartPath = null;
                            OpenDocument(start);
                        }
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
                        OnMenu(o);
                        break;

                    case "save":
                        OnSave(o.ToObject<SaveRequest>());
                        break;

                    case "printReady":
                        ExportPdf();
                        break;

                    // ★ 고친 것이 있는지는 화면만 안다. 물어볼 길이 없으므로(스크립트 실행은 비동기고
                    //   FormClosing 은 기다릴 수 없다) 화면이 바뀔 때마다 밀어 준다.
                    case "dirty":
                        cDirty = o["n"] == null ? 0 : (int)o["n"];
                        UpdateTitle();
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

        private void OnMenu(JObject pMsg)
        {
            string pCmd = (string)pMsg["cmd"];
            switch (pCmd)
            {
                case "open":
                    using (OpenFileDialog dlg = new OpenFileDialog())
                    {
                        dlg.Filter = "한글 문서 (*.hwp;*.hwpx)|*.hwp;*.hwpx|한글 5.0 (*.hwp)|*.hwp|한글 OWPML (*.hwpx)|*.hwpx|모든 파일 (*.*)|*.*";
                        dlg.Title = "문서 열기";
                        if (dlg.ShowDialog(this) != DialogResult.OK) return;
                        if (!ConfirmDiscard()) return;
                        OpenDocument(dlg.FileName);
                    }
                    break;

                case "openRecent":
                    {
                        // ★ 우리가 준 목록에서 되돌아온 값이라도 다시 검사한다.
                        string path = (string)pMsg["path"];
                        if (string.IsNullOrEmpty(path) || !System.IO.File.Exists(path))
                        {
                            SetStatus("그 파일이 없습니다: " + path);
                            cRecent.Remove(path);
                            SendRecent();
                            return;
                        }
                        if (!ConfirmDiscard()) return;
                        OpenDocument(path);
                    }
                    break;

                case "insertImage":
                    OnInsertImage();
                    break;

                case "pdf":
                    {
                        // ★ 하나가 끝나기 전에 또 받지 않는다. 경로를 필드 하나에 두므로, 두 번째 대화상자를
                        //   취소하면 첫 번째 경로가 null 로 덮여 printReady 가 와도 인쇄도 hwPrintDone 도 안 돈다 —
                        //   모든 쪽이 펼쳐진 채 남는다. 한 번 더 누르면 앞의 인쇄가 끝나며 가상 스크롤을 되돌려
                        //   두 번째 PDF 가 빈 쪽으로 나가기도 한다.
                        if (cPdfBusy) { SetStatus("PDF 를 만드는 중입니다 — 끝난 뒤에 다시 하세요"); return; }

                        // 실제 인쇄는 화면이 "모든 쪽을 채웠다"고 알린 뒤에 한다(printReady).
                        string pdf = AskPdfPath();
                        if (string.IsNullOrEmpty(pdf)) return;
                        cPdfPath = pdf;
                        cPdfBusy = true;
                        SetStatus("PDF 준비 중…");
                        cWeb.Invoke("hwPrintPrepare()");
                    }
                    break;

                default:
                    SetStatus("아직 없는 명령: " + pCmd);
                    break;
            }
        }

        /// <summary>
        /// ★ 파일을 여는 길은 <see cref="cDocument"/> 하나뿐이다 —
        /// CLI 오라클도 같은 길을 지나야 화면에서 본 것과 검사한 것이 같아진다.
        /// </summary>
        internal void OpenDocument(string pPath)
        {
            try
            {
                SetStatus("여는 중… " + System.IO.Path.GetFileName(pPath));
                cDoc = cDocument.Open(pPath);
                cWeb.Invoke("hwLoadDoc(" + cJson.ToJson(cDoc.Model, false) + ")");

                // 새 문서를 받은 화면은 고친 것이 없다 — 화면이 알려 줄 때까지 우리 쪽도 0 으로 둔다.
                cDirty = 0;
                cRecent.Add(pPath);
                SendRecent();
                UpdateTitle();
            }
            catch (Exception ex)
            {
                cLog.Write(ex);
                SetStatus("열기 실패: " + ex.Message);

                // ★ 목록에서 빼는 것은 <b>파일이 없을 때뿐</b>이다. 한글이 물고 있거나 네트워크가
                //   잠깐 안 보여 못 연 문서까지 빼면 멀쩡한 항목이 영구히 사라진다.
                if (ex is System.IO.FileNotFoundException || ex is System.IO.DirectoryNotFoundException)
                {
                    cRecent.Remove(pPath);
                    SendRecent();
                }
                MessageBox.Show(this, "문서를 열지 못했습니다." + Environment.NewLine + Environment.NewLine + ex.Message,
                    "HwpEditor", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        #region 최근 파일 · 창 제목 · 저장 확인

        private int cDirty;
        private bool cCloseAfterSave;
        private bool cForceClose;

        private void SendRecent()
        {
            cWeb.Invoke("hwSetRecent(" + JsonConvert.SerializeObject(cRecent.Live()) + ")");
        }

        private void UpdateTitle()
        {
            string name = cDoc == null || string.IsNullOrEmpty(cDoc.Path)
                ? "새 문서" : System.IO.Path.GetFileName(cDoc.Path);
            Text = (cDirty > 0 ? "*" : "") + name + " - HwpEditor";
        }

        /// <summary>
        /// 지금 문서를 버려도 되는지 묻는다(열기·최근 파일·드롭이 지나는 자리).
        ///
        /// ★ 여기서는 저장까지 이어 붙이지 않는다 — 대화상자 두 개와 비동기 저장 왕복이 겹치면
        ///   취소 경로가 늘어나고, 그중 하나만 어긋나도 고친 것이 조용히 사라진다.
        ///   창을 닫을 때(<see cref="OnFormClosing"/>)만 저장까지 태운다.
        /// </summary>
        private bool ConfirmDiscard()
        {
            if (cDirty <= 0) return true;

            DialogResult r = MessageBox.Show(this,
                "저장하지 않은 변경이 있습니다." + Environment.NewLine
                + "다른 문서를 열면 그 변경은 사라집니다. 계속할까요?",
                "HwpEditor", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            return r == DialogResult.Yes;
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (cForceClose || cDirty <= 0) { base.OnFormClosing(e); return; }

            DialogResult r = MessageBox.Show(this,
                "저장하지 않은 변경이 있습니다. 저장할까요?",
                "HwpEditor", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Warning);

            if (r == DialogResult.Cancel) { e.Cancel = true; return; }

            if (r == DialogResult.No)
            {
                cForceClose = true;
                base.OnFormClosing(e);
                return;
            }

            // ★ 저장은 화면을 한 번 거쳐 돌아온다(고친 내용은 화면이 들고 있다). 지금은 닫지 않고,
            //   OnSave 가 <b>성공</b>했을 때만 닫는다 — "다른 이름으로" 를 취소하면 저장이 실패하는데
            //   그때 창이 닫히면 고친 것이 그대로 사라진다.
            e.Cancel = true;
            cCloseAfterSave = true;
            cWeb.Invoke("hwSave(false)");
        }

        #endregion

        #region 저장 · 그림

        /// <summary>
        /// 화면이 모은 편집분을 받아 원본에 반영하고 저장한다.
        ///
        /// ★ 실패를 조용히 삼키지 않는다 — 화면은 ok 를 보고 dirty 집합을 비우므로,
        ///   실패했는데 성공이라고 답하면 사용자가 고친 것이 그 자리에서 사라진다.
        /// </summary>
        private void OnSave(SaveRequest pReq)
        {
            // ★ 저장이 성사되지 않는 길에서는 "저장하고 닫기" 를 반드시 내린다 —
            //   안 내리면 다음 저장이 성공할 때 사용자가 시키지도 않은 닫기가 따라 붙는다.
            if (cDoc == null) { cCloseAfterSave = false; Reply(Fail("문서를 먼저 여세요")); return; }

            string path = cDoc.Path;
            if (pReq != null && pReq.SaveAs) path = AskSavePath();
            if (string.IsNullOrEmpty(path)) { cCloseAfterSave = false; Reply(Fail("저장을 취소했습니다")); return; }

            try
            {
                SetStatus("저장 중… " + System.IO.Path.GetFileName(path));
                SaveResult r = cDoc.Save(path, pReq);
                r.Rev = (pReq == null ? 1 : pReq.Rev) + 1;
                Reply(r);
                SetStatus("저장함 — " + path);

                cDirty = 0;
                cRecent.Add(path);
                SendRecent();
                UpdateTitle();

                // ★ 닫는 중이었으면 여기서 닫는다. 다시 읽기(r.Reload)는 건너뛴다 —
                //   닫히는 창에 문서를 밀어 넣게 된다.
                if (cCloseAfterSave) { cCloseAfterSave = false; cForceClose = true; BeginInvoke(new Action(Close)); return; }

                // ★ 표 구조를 바꿨으면 문서를 다시 읽어 화면에 보낸다. 다시 세운 표의 문단은
                //   전부 새 객체라, 화면이 들고 있던 id 로는 그다음 편집을 되쓸 수 없다.
                if (r.Reload) OpenDocument(path);
            }
            catch (Exception ex)
            {
                cLog.Write(ex);
                cCloseAfterSave = false;   // 저장이 실패했으면 창을 닫지 않는다
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
        /// 그림 파일을 골라 화면에 넘긴다. 실물은 <b>저장할 때</b> 문서에 들어가고, 지금은 미리보기만 간다.
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

        #region PDF 내보내기

        private string cPdfPath;
        private bool cPdfBusy;   // 대화상자를 지나 hwPrintPrepare 를 부른 뒤 ExportPdf 가 끝날 때까지

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
        ///   printReady 가 왔다는 것 자체가 화면이 펼쳐졌다는 뜻이라, 인쇄할 것이 없어 빠지는 길도
        ///   try 안에 둬서 finally 를 지나게 한다(hwPrintDone 은 여러 번 불려도 무해하다).
        /// </summary>
        private async void ExportPdf()
        {
            string path = cPdfPath;
            cPdfPath = null;

            try
            {
                if (string.IsNullOrEmpty(path) || cDoc == null) return;

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
                cPdfBusy = false;
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
