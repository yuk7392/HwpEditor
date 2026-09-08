using System;
using System.Collections.Generic;
using System.IO;

namespace HwpEditor
{
    /// <summary>
    /// 최근 목록 단독 검사(<c>--recent-test</c>, 8단계). 화면도 문서도 없이 돈다.
    ///
    /// ★ 사용자의 실제 목록(<c>%LOCALAPPDATA%\HwpEditor\recent.json</c>)은 건드리지 않는다 —
    ///   <see cref="cRecent.cPathOverride"/> 로 임시 파일을 쓰게 하고 끝나면 지운다.
    /// </summary>
    internal static class cRecentTest
    {
        internal static int Run(string[] pArgs)
        {
            string dir = Path.Combine(Path.GetTempPath(), "hwpe-recent-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            Directory.CreateDirectory(dir);

            string store = Path.Combine(dir, "recent.json");
            cRecent.cPathOverride = store;

            int fail = 0;
            try
            {
                // 실제로 있는 파일 세 개를 만들어 둔다 — Live() 가 없는 파일을 거르기 때문이다.
                List<string> real = new List<string>();
                for (int i = 0; i < 3; i++)
                {
                    string f = Path.Combine(dir, "doc" + i + ".hwp");
                    File.WriteAllText(f, "x");
                    real.Add(f);
                }

                fail += Check("빈 목록", cRecent.All().Count, 0);

                cRecent.Add(real[0]);
                cRecent.Add(real[1]);
                fail += Check("두 개 넣기", cRecent.All().Count, 2);
                fail += Check("마지막에 넣은 것이 맨 앞", cRecent.All()[0], real[1]);

                // 같은 것을 다시 넣으면 늘지 않고 맨 앞으로 올라온다.
                cRecent.Add(real[0]);
                fail += Check("중복은 안 늘어난다", cRecent.All().Count, 2);
                fail += Check("다시 넣으면 맨 앞", cRecent.All()[0], real[0]);

                // 대소문자가 달라도 같은 파일이다.
                cRecent.Add(real[0].ToUpperInvariant());
                fail += Check("대소문자가 달라도 같은 것", cRecent.All().Count, 2);

                // 상한 10개.
                for (int i = 0; i < 15; i++) cRecent.Add(Path.Combine(dir, "many" + i + ".hwp"));
                fail += Check("상한 10개", cRecent.All().Count, 10);

                // 없는 파일은 목록에는 남고 Live 에서만 빠진다.
                cRecent.Add(real[2]);
                int live = cRecent.Live().Count;
                fail += Check("Live 는 있는 파일만", live, 1);
                fail += Check("목록 자체에는 남는다", cRecent.All().Count, 10);

                cRecent.Remove(real[2]);
                fail += Check("지우기", cRecent.Live().Count, 0);

                // 깨진 파일을 만나도 예외로 끝나지 않는다.
                File.WriteAllText(store, "{ 이건 목록이 아니다");
                fail += Check("깨진 파일이면 빈 목록", cRecent.All().Count, 0);
                cRecent.Add(real[0]);
                fail += Check("깨진 뒤에도 다시 쓴다", cRecent.Live().Count, 1);
            }
            catch (Exception ex)
            {
                Console.WriteLine("  예외: " + ex.Message);
                fail++;
            }
            finally
            {
                cRecent.cPathOverride = null;
                try { Directory.Delete(dir, true); } catch { }
            }

            Console.WriteLine();
            Console.WriteLine("RECENTTEST fail=" + fail);
            return fail == 0 ? 0 : 1;
        }

        private static int Check(string pName, object pGot, object pWant)
        {
            bool ok = string.Equals(Convert.ToString(pGot), Convert.ToString(pWant), StringComparison.OrdinalIgnoreCase);
            Console.WriteLine((ok ? "  OK   " : "  실패 ") + pName + "  →  " + pGot + " (기대 " + pWant + ")");
            return ok ? 0 : 1;
        }
    }
}
