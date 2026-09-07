using System;
using System.Globalization;
using System.IO;
using System.Text;

namespace HwpEditor
{
    /// <summary>
    /// exe 옆 log 폴더에 하루 한 파일. 화면이 WebView2 안에 있어서 초기화가 실패하면
    /// 사용자에게 보일 자리가 없다 — 그때 사유가 남는 유일한 곳이 여기다.
    /// </summary>
    internal static class cLog
    {
        private static readonly object cLock = new object();

        /// <summary>로그 폴더의 부모. Program.Run 이 Application.StartupPath 로 세운다.</summary>
        internal static string BaseDir = AppDomain.CurrentDomain.BaseDirectory;

        internal static void Write(string pText)
        {
            try
            {
                lock (cLock)
                {
                    string dir = Path.Combine(BaseDir, "log");
                    Directory.CreateDirectory(dir);
                    string path = Path.Combine(dir,
                        "HwpEditor-" + DateTime.Now.ToString("yyyyMMdd", CultureInfo.InvariantCulture) + ".log");
                    File.AppendAllText(path,
                        DateTime.Now.ToString("HH:mm:ss.fff", CultureInfo.InvariantCulture) + "  " + pText + Environment.NewLine,
                        Encoding.UTF8);
                }
            }
            catch
            {
                // 로그를 못 남기는 것으로 앱을 죽이지 않는다.
            }
        }

        internal static void Write(Exception pEx)
        {
            if (pEx == null) return;
            StringBuilder b = new StringBuilder();
            b.Append(pEx.GetType().FullName).Append(": ").Append(pEx.Message);
            if (pEx.StackTrace != null) b.Append(Environment.NewLine).Append(pEx.StackTrace);
            if (pEx.InnerException != null)
                b.Append(Environment.NewLine).Append("  ← ").Append(pEx.InnerException.GetType().Name)
                 .Append(": ").Append(pEx.InnerException.Message);
            Write(b.ToString());
        }
    }
}
