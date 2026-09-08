using System;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace HwpEditor
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            // ★ 이 등록은 Main 의 첫 줄이어야 하고 실제 작업은 Run() 으로 빠져 있어야 한다.
            //   인라인하면 Main 이 JIT 될 때 폼 타입이 먼저 해석되어 등록보다 앞선다.
            AppDomain.CurrentDomain.AssemblyResolve += CurrentDomain_AssemblyResolve;

            // ★ Main 이 인자를 안 받는 시그니처라 여기서 꺼낸다 — 첫 항목은 exe 경로다.
            string[] argv = Environment.GetCommandLineArgs();
            string[] args = new string[argv.Length > 0 ? argv.Length - 1 : 0];
            for (int i = 1; i < argv.Length; i++) args[i - 1] = argv[i];

            // ★ 자리가 여기인 것이 사양이다: 위 AssemblyResolve 뒤여야 hwplibsharp 를 꺼내 쓸 수 있고,
            //   아래 WebView2 준비 앞이어야 런타임이 없는 PC 에서도 검증 통로가 돈다.
            int cliCode = cCli.TryRun(args);
            if (cliCode >= 0) { Environment.Exit(cliCode); return; }

            // ★ WebView2 의 네이티브 로더는 AssemblyResolve 로 못 잡는다 — 관리 어셈블리가 아니다.
            //   Core.dll 이 [DllImport("WebView2Loader.dll")] 로 이름만 부르므로, 같은 이름의 모듈을
            //   미리 올려 두면 Windows 로더가 그것에 바인딩한다. 반드시 WebView2 타입을 건드리기 전에.
            PrepareWebView2Loader();

            // 탐색기에서 문서를 더블클릭했거나 끌어다 놓으면 그 경로가 첫 인자로 온다.
            string startPath = null;
            if (args.Length > 0 && !args[0].StartsWith("--"))
            {
                string ext = System.IO.Path.GetExtension(args[0]);
                if (System.IO.File.Exists(args[0])
                 && (string.Equals(ext, ".hwp", StringComparison.OrdinalIgnoreCase)
                  || string.Equals(ext, ".hwpx", StringComparison.OrdinalIgnoreCase))) startPath = args[0];
            }

            Run(startPath);
        }

        /// <summary>로더 준비 결과. 실패해도 앱을 죽이지 않으므로 사유가 남는 곳이 여기뿐이다.</summary>
        internal static string WebView2LoaderStatus = "미시도";

        [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr LoadLibraryW(string lpFileName);

        /// <summary>
        /// 임베드한 WebView2Loader.dll 을 %LOCALAPPDATA% 에 풀고 LoadLibrary 로 올린다.
        /// 폴더 이름에 바이트 수를 박아 두면 SDK 를 올렸을 때 덮어쓰기가 필요 없고,
        /// 두 개를 띄워도 앞 인스턴스가 물고 있는 파일을 건드리지 않는다.
        /// </summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        internal static void PrepareWebView2Loader()
        {
            try
            {
                // AnyCPU + Prefer32Bit=false 라 64비트로 도는 것이 전제이고 x64 로더만 임베드했다.
                // 32비트로 돌면 절대 안 올라가므로 여기서 사유를 남긴다 — 안 그러면 나중에
                // EnsureCoreWebView2Async 에서 엉뚱한 예외로만 보인다.
                if (IntPtr.Size != 8)
                {
                    WebView2LoaderStatus = "32비트 프로세스 - x64 로더만 임베드돼 있다";
                    return;
                }

                Assembly thisAssembly = Assembly.GetExecutingAssembly();
                string resourceName = thisAssembly.GetManifestResourceNames()
                    .FirstOrDefault(s => s.EndsWith("WebView2Loader.dll", StringComparison.OrdinalIgnoreCase));
                if (resourceName == null)
                {
                    WebView2LoaderStatus = "리소스 없음";
                    return;
                }

                byte[] buffer = ReadResource(thisAssembly, resourceName);
                if (buffer == null) { WebView2LoaderStatus = "리소스 스트림 없음"; return; }

                string dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "HwpEditor", "wv2loader-" + buffer.Length.ToString(CultureInfo.InvariantCulture));
                Directory.CreateDirectory(dir);

                string path = Path.Combine(dir, "WebView2Loader.dll");
                if (!File.Exists(path) || new FileInfo(path).Length != buffer.Length)
                    File.WriteAllBytes(path, buffer);

                IntPtr handle = LoadLibraryW(path);
                WebView2LoaderStatus = handle == IntPtr.Zero
                    ? "LoadLibrary 실패 win32=" + Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture)
                    : "정상";
            }
            catch (Exception ex)
            {
                WebView2LoaderStatus = "예외 " + ex.GetType().Name;
                cLog.Write(ex);
            }
        }

        [MethodImpl(MethodImplOptions.NoInlining)]
        static void Run(string pStartPath)
        {
            cLog.BaseDir = Application.StartupPath;

            Application.ThreadException += delegate (object s, System.Threading.ThreadExceptionEventArgs e)
            {
                cLog.Write(e.Exception);
            };
            AppDomain.CurrentDomain.UnhandledException += delegate (object s, UnhandledExceptionEventArgs e)
            {
                cLog.Write(e.ExceptionObject as Exception);
            };
            TaskScheduler.UnobservedTaskException += delegate (object s, UnobservedTaskExceptionEventArgs e)
            {
                cLog.Write(e.Exception);
                e.SetObserved();
            };

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            // ★ 메뉴·툴바·상태줄·본문이 전부 WebView2 문서 안이다 — 런타임이 없으면 화면에 아무것도
            //   안 남는다. 조용히 빈 창으로 뜨게 두지 않고 여기서 끊는다.
            if (!EnsureWebView2Runtime()) return;

            mdiHwpEditor form = new mdiHwpEditor();
            form.cStartPath = pStartPath;
            Application.Run(form);
        }

        /// <summary>
        /// WebView2 런타임이 쓸 수 있는 상태인지 본다.
        /// ★ 레지스트리가 아니라 실제 소비 경로로 판정한다 — 레지스트리는 설치 여부만 알려 주는데,
        ///   우리가 실제로 걸리는 실패에는 PrepareWebView2Loader 가 못 올린 로더도 있다.
        /// </summary>
        [MethodImpl(MethodImplOptions.NoInlining)]
        static bool EnsureWebView2Runtime()
        {
            string reason;
            try
            {
                string ver = Microsoft.Web.WebView2.Core.CoreWebView2Environment.GetAvailableBrowserVersionString();
                reason = string.IsNullOrEmpty(ver) ? "버전 문자열이 비어 있습니다" : null;
            }
            catch (Exception ex)
            {
                reason = ex.GetType().Name + ": " + ex.Message;
                cLog.Write(ex);
            }

            if (reason == null) return true;

            MessageBox.Show(
                "HwpEditor 는 Microsoft Edge WebView2 런타임이 있어야 실행됩니다." + Environment.NewLine
                + "이 PC 에서 런타임을 찾지 못해 종료합니다." + Environment.NewLine + Environment.NewLine
                + "설치 방법" + Environment.NewLine
                + "  https://developer.microsoft.com/microsoft-edge/webview2/ 에서" + Environment.NewLine
                + "  'Evergreen Standalone Installer (x64)' 를 받아 설치한 뒤 다시 실행하세요." + Environment.NewLine + Environment.NewLine
                + "진단: " + reason + Environment.NewLine
                + "로더: " + WebView2LoaderStatus,
                "HwpEditor - WebView2 런타임 없음",
                MessageBoxButtons.OK, MessageBoxIcon.Error);

            return false;
        }

        static Assembly CurrentDomain_AssemblyResolve(object sender, ResolveEventArgs args)
        {
            try
            {
                if (args.Name.IndexOf(".resources", StringComparison.OrdinalIgnoreCase) >= 0)
                    return null;

                Assembly thisAssembly = Assembly.GetExecutingAssembly();

                int comma = args.Name.IndexOf(',');
                string name = (comma < 0 ? args.Name : args.Name.Substring(0, comma)) + ".dll";

                string resourceName = thisAssembly.GetManifestResourceNames()
                    .FirstOrDefault(s => s.EndsWith(name, StringComparison.OrdinalIgnoreCase));
                if (resourceName == null) return null;

                byte[] buffer = ReadResource(thisAssembly, resourceName);
                return buffer == null ? null : Assembly.Load(buffer);
            }
            catch (Exception ex)
            {
                cLog.Write(ex);
                return null;
            }
        }

        internal static byte[] ReadResource(Assembly pAssembly, string pResourceName)
        {
            using (Stream stream = pAssembly.GetManifestResourceStream(pResourceName))
            {
                if (stream == null) return null;
                byte[] buffer = new byte[stream.Length];
                int read = 0;
                while (read < buffer.Length)
                {
                    int n = stream.Read(buffer, read, buffer.Length - read);
                    if (n <= 0) break;
                    read += n;
                }
                return buffer;
            }
        }
    }
}
