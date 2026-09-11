using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace HwpEditor
{
    /// <summary>
    /// 편집기 문서를 띄우는 WebView2 호스트. 메뉴·툴바·상태줄·본문이 전부 이 문서 안에 있다.
    ///
    /// ★ 왜 디자이너에 안 올리는가: 디자이너 프로세스는 32비트인데 네이티브 로더는 x64 만 임베드했고,
    ///   Program.PrepareWebView2Loader 는 디자이너에서 돌지 않는다. 폼에 올리는 순간 깨진다.
    ///   디자이너에는 빈 Panel 만 두고 여기서 코드로 채운다.
    /// </summary>
    public sealed class cWebHost
    {
        private const string cHost = "hwpeditor.local";
        private const string cPage = "editor.html";

        /// <summary>
        /// ★ csproj 에 EmbeddedResource 로 넣는 것만으로는 안 풀린다 — 여기에도 이름을 넣어야 한다.
        ///   빠뜨리면 404 라 화면에는 "스타일이 안 먹는다 / 버튼이 안 눌린다" 로만 보인다.
        /// </summary>
        private static readonly string[] cWebAssets =
        {
            "editor.css",
            "hwUnit.js", "hwModel.js", "hwMeasure.js", "hwBreak.js", "hwTable.js", "hwPage.js", "hwRender.js",
            "hwCaret.js", "hwObj.js", "hwUndo.js", "hwFormat.js", "hwInput.js", "hwFind.js", "hwDialog.js", "hwUi.js", "hwOracle.js", "hwBridge.js",
            "NanumGothic.ttf", "NanumGothic-Bold.ttf", "NanumMyeongjo.ttf", "NanumMyeongjo-Bold.ttf"
        };

        private WebView2 cView;
        private readonly List<string> cPendingScripts = new List<string>();
        private bool cReady;
        private bool cFailed;
        private bool cTriedFile;

        /// <summary>디버그·로그가 읽는 한 줄 상태. 초기화는 조용히 실패할 수 있어서 남긴다.</summary>
        public string Status { get; private set; }

        public cWebHost()
        {
            Status = "미초기화";
        }

        /// <summary>초기화·로드가 실패했을 때. 실패는 비동기로 오므로 Attach 반환값으로는 알 수 없다.</summary>
        public event EventHandler Failed;

        /// <summary>★ UI 스레드에서 발생한다.</summary>
        public event EventHandler<string> WebMessage;

        #region 환경 · 자산

        /// <summary>
        /// 프로세스 하나에 환경 하나. 비싼 것은 컨트롤이 아니라 환경 생성(브라우저 프로세스 기동)이다.
        /// 실패한 Task 를 물고 있으면 영영 못 고치므로 그때는 버리고 다시 만든다.
        /// </summary>
        private static System.Threading.Tasks.Task<CoreWebView2Environment> cEnvTask;

        private static System.Threading.Tasks.Task<CoreWebView2Environment> SharedEnvAsync()
        {
            if (cEnvTask != null && cEnvTask.IsFaulted) cEnvTask = null;
            if (cEnvTask == null) cEnvTask = CreateEnvAsync();
            return cEnvTask;
        }

        private static async System.Threading.Tasks.Task<CoreWebView2Environment> CreateEnvAsync()
        {
            DumpAssets(WebDir);

            // ★ userDataFolder 를 명시하지 않으면 exe 옆에 만든다. 배포 경로가 읽기 전용이면 거기서 터진다.
            string userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "HwpEditor", "webview");

            return await CoreWebView2Environment.CreateAsync(null, userData, null);
        }

        /// <summary>문서와 자산을 폴더 하나에 푼다. CLI 통로도 같은 함수를 쓴다 — 목록이 두 벌이 되면 안 된다.</summary>
        public static void DumpAssets(string pDir)
        {
            Directory.CreateDirectory(pDir);

            // ★ 문서(cPage)보다 자산을 먼저 푼다. 문서가 이것들을 곧바로 요청하므로,
            //   순서가 뒤바뀌면 첫 기동에서만 스타일 없는 화면이 한 번 스친다.
            long token = 0;
            for (int i = 0; i < cWebAssets.Length; i++)
            {
                byte[] bytes = ReadEmbedded(cWebAssets[i]);
                WriteIfChanged(Path.Combine(pDir, cWebAssets[i]), bytes);
                token = token * 31 + (bytes == null ? 0 : bytes.Length);
            }

            WriteIfChanged(Path.Combine(pDir, cPage), Versioned(ReadEmbedded(cPage), token));
        }

        /// <summary>
        /// ★ 이게 없으면 <b>고친 스크립트가 안 먹는다</b>. 브라우저가 지난 판을 캐시에서 그대로 내주고
        ///   파일은 새것이라 눈으로는 구분이 안 된다(실측 — 고친 줄이 화면에 안 나타나서 같은 자리를
        ///   두 번 고쳤다). 자산 크기 합을 판 번호로 쓰면 내용이 바뀔 때만 주소가 바뀐다.
        /// </summary>
        private static byte[] Versioned(byte[] pHtml, long pToken)
        {
            if (pHtml == null) return null;

            string v = "?v=" + pToken.ToString("X", System.Globalization.CultureInfo.InvariantCulture);
            string html = Encoding.UTF8.GetString(pHtml)
                .Replace(".js\"", ".js" + v + "\"")
                .Replace(".css\"", ".css" + v + "\"");
            return Encoding.UTF8.GetBytes(html);
        }

        public static string WebDir
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "HwpEditor", "web");
            }
        }

        private static byte[] ReadEmbedded(string pFileName)
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            string[] names = asm.GetManifestResourceNames();
            for (int i = 0; i < names.Length; i++)
                if (names[i].EndsWith("." + pFileName, StringComparison.OrdinalIgnoreCase))
                    return Program.ReadResource(asm, names[i]);
            throw new FileNotFoundException("임베드 자산을 찾지 못했다: " + pFileName);
        }

        /// <summary>내용이 같으면 안 쓴다 — 매 기동마다 파일 시각이 바뀌면 브라우저 캐시가 헛돈다.</summary>
        private static void WriteIfChanged(string pPath, byte[] pBytes)
        {
            if (pBytes == null) return;
            if (File.Exists(pPath))
            {
                FileInfo fi = new FileInfo(pPath);
                if (fi.Length == pBytes.Length)
                {
                    byte[] old = File.ReadAllBytes(pPath);
                    bool same = true;
                    for (int i = 0; i < old.Length; i++) if (old[i] != pBytes[i]) { same = false; break; }
                    if (same) return;
                }
            }
            File.WriteAllBytes(pPath, pBytes);
        }

        #endregion

        public void Attach(Control pHost)
        {
            if (pHost == null) throw new ArgumentNullException("pHost");

            cView = new WebView2();
            cView.Dock = DockStyle.Fill;

            // ★ WebView2 의 기본 표면색은 검정이다 — 문서가 뜨기 전까지 새까맣게 보인다.
            cView.DefaultBackgroundColor = System.Drawing.Color.White;

            // 문서가 실제로 그려질 때까지는 아예 숨긴다. NavigationCompleted 에서 켠다.
            cView.Visible = false;

            // ★ 파일 드롭을 WebView2 가 먹지 않게 한다. 먹게 두면 브라우저가 그 파일로 이동해 버리고,
            //   문서 쪽에서 받아도 전체 경로가 없어(Chromium 보안) 우리가 열 수가 없다.
            //   꺼 두면 호스트 폼의 DragEnter/DragDrop 으로 올라온다.
            cView.AllowExternalDrop = false;

            pHost.Controls.Add(cView);
            cView.BringToFront();

            StartAsync();
        }

        /// <summary>
        /// ★ async void 다 — 여기서 새어나간 예외는 프로세스를 죽인다.
        ///   전부 감싸고, 실패해도 앱은 살려 둔 채 사유만 Status 와 로그에 남긴다.
        /// </summary>
        private async void StartAsync()
        {
            try
            {
                CoreWebView2Environment env = await SharedEnvAsync();
                await cView.EnsureCoreWebView2Async(env);

                cView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    cHost, WebDir, CoreWebView2HostResourceAccessKind.Deny);

                CoreWebView2Settings s = cView.CoreWebView2.Settings;
                s.AreDefaultContextMenusEnabled = false;
                s.IsStatusBarEnabled = false;
                s.IsZoomControlEnabled = false;
#if DEBUG
                s.AreDevToolsEnabled = true;
#else
                s.AreDevToolsEnabled = false;
#endif

                cView.CoreWebView2.WebMessageReceived += Core_WebMessageReceived;
                cView.NavigationCompleted += View_NavigationCompleted;
                cView.CoreWebView2.Navigate("https://" + cHost + "/" + cPage);
            }
            catch (Exception ex)
            {
                Fail("초기화 실패: " + ex.Message);
                cLog.Write(ex);
            }
        }

        private void View_NavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (!e.IsSuccess)
            {
                // ★ WebErrorStatus 만으로는 자리를 못 찾는다 — 404 인지(자산이 안 풀렸다) 아예 못 붙은
                //   것인지(호스트 매핑이 안 걸렸다) 가리려면 HTTP 상태와 최종 주소가 같이 있어야 한다.
                string url = "";
                try { url = cView.CoreWebView2.Source; } catch { }
                string why = e.WebErrorStatus + " http=" + e.HttpStatusCode + " url=" + url;

                // ★ 가상 호스트가 안 서는 PC 가 있다(응답 자체가 없고 http=0 으로 온다).
                //   같은 폴더를 file:// 로 다시 연다 — 문서와 자산이 한 폴더라 상대 경로가 그대로 맞는다.
                if (!cTriedFile)
                {
                    cTriedFile = true;
                    cLog.Write("가상 호스트 실패(" + why + ") — file:// 로 다시 붙는다");
                    Status = "가상 호스트 실패, file:// 재시도";
                    try { cView.CoreWebView2.Navigate(new Uri(Path.Combine(WebDir, cPage)).AbsoluteUri); return; }
                    catch (Exception ex) { cLog.Write(ex); }
                }

                Fail("문서 로드 실패: " + why);
                return;
            }

            cReady = true;
            Status = "정상";
            cView.Visible = true;

            for (int i = 0; i < cPendingScripts.Count; i++) Run(cPendingScripts[i]);
            cPendingScripts.Clear();
        }

        private void Core_WebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                string json = e.TryGetWebMessageAsString();
                if (string.IsNullOrEmpty(json)) return;
                if (WebMessage != null) WebMessage(this, json);
            }
            catch (Exception ex)
            {
                // ★ 여기서 새는 예외는 WebView2 이벤트 경계를 넘어 프로세스를 죽인다.
                cLog.Write(ex);
            }
        }

        /// <summary>문서의 전역 함수 하나를 부른다. 준비 전이면 큐에 쌓았다가 문서가 뜨면 순서대로 낸다.</summary>
        public void Invoke(string pScript)
        {
            if (string.IsNullOrEmpty(pScript)) return;

            // ★ 실패가 확정된 뒤에는 큐에 쌓지 않는다 — 문서가 영영 안 뜨므로 나갈 일이 없고 늘기만 한다.
            if (cFailed) return;

            if (!cReady) { cPendingScripts.Add(pScript); return; }
            Run(pScript);
        }

        private void Run(string pScript)
        {
            try { cView.CoreWebView2.ExecuteScriptAsync(pScript); }
            catch (Exception ex) { cLog.Write(ex); }
        }

        /// <summary>
        /// 지금 떠 있는 문서를 PDF 로 찍는다.
        ///
        /// ★ 용지 크기를 <b>인치</b>로 준다(HWPUNIT / 7200). 여백은 0 이다 — 우리 쪽 상자가 곧 용지이고
        ///   본문 여백은 이미 그 안의 배치에 들어 있다. 여백을 또 주면 한 쪽이 두 쪽으로 쪼개진다.
        /// ★ 배경을 찍게 켠다. 안 켜면 표 채우기·글자 배경이 통째로 빠진다.
        /// </summary>
        public async System.Threading.Tasks.Task<bool> PrintToPdfAsync(string pPath, double pWidthIn, double pHeightIn)
        {
            if (cView == null || cView.CoreWebView2 == null) return false;

            CoreWebView2Environment env = await SharedEnvAsync();
            CoreWebView2PrintSettings s = env.CreatePrintSettings();
            s.PageWidth = pWidthIn;
            s.PageHeight = pHeightIn;
            s.MarginTop = 0;
            s.MarginBottom = 0;
            s.MarginLeft = 0;
            s.MarginRight = 0;
            s.ShouldPrintBackgrounds = true;
            s.ShouldPrintHeaderAndFooter = false;
            s.ScaleFactor = 1;

            return await cView.CoreWebView2.PrintToPdfAsync(pPath, s);
        }

        private void Fail(string pReason)
        {
            cFailed = true;
            Status = pReason;
            cPendingScripts.Clear();
            cLog.Write("cWebHost " + pReason);
            if (Failed != null) Failed(this, EventArgs.Empty);
        }
    }
}
