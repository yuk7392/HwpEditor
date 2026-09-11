using System;
using System.Globalization;
using System.IO;
using System.Text;

namespace HwpEditor
{
    internal static class cLog
    {
        private static readonly object cLock = new object();

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
