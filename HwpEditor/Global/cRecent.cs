using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Newtonsoft.Json;

namespace HwpEditor
{
    /// <summary>
    /// 최근에 연 문서 목록. <c>%LOCALAPPDATA%\HwpEditor\recent.json</c> 에 둔다(8단계).
    ///
    /// ★ 레지스트리가 아니라 파일인 이유: 이 앱은 이미 그 폴더를 자기 집으로 쓰고(webview·web·로더),
    ///   단일 exe 라 지워 줄 언인스톨러가 없다. 지울 자리가 한 곳으로 유지되고,
    ///   검사에서 초기 상태를 만들 때도 파일 하나만 지우면 된다.
    /// ★ 읽기·쓰기 실패는 로그만 남기고 삼킨다 — 최근 목록 때문에 기동이나 저장이 실패하면 안 된다.
    /// ★ 없는 파일은 <see cref="Live"/> 가 걸러 낼 뿐 목록에서 지우지는 않는다.
    ///   네트워크 경로가 잠깐 안 보인다고 영영 사라지면 안 된다.
    /// </summary>
    public static class cRecent
    {
        private const int cMax = 10;

        /// <summary>
        /// 검사 통로가 쓰는 임시 목록 파일. ★ 검사가 사용자의 실제 최근 목록을 지우면 안 된다.
        /// 평소에는 null 이고 <c>--recent-test</c> 만 이것을 채운다.
        /// </summary>
        internal static string cPathOverride;

        private static string FilePath
        {
            get
            {
                if (!string.IsNullOrEmpty(cPathOverride)) return cPathOverride;

                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "HwpEditor", "recent.json");
            }
        }

        /// <summary>저장된 목록 그대로(지금 없는 파일도 들어 있다).</summary>
        public static List<string> All()
        {
            bool read;
            return All(out read);
        }

        /// <summary>
        /// <paramref name="pRead"/> 는 <b>파일을 실제로 읽었는가</b>다.
        ///
        /// ★ "읽기 실패" 와 "빈 목록" 을 가르는 것이 이 인자의 전부다. 둘을 같이 다루면
        ///   다른 창이 파일을 쥐고 있어 한 번 못 읽은 순간 <see cref="Add"/> 가 빈 목록에 하나만
        ///   얹어 덮어써서, 열 개짜리 목록이 한 개로 줄어든다.
        /// </summary>
        public static List<string> All(out bool pRead)
        {
            pRead = true;
            try
            {
                string p = FilePath;
                if (!File.Exists(p)) return new List<string>();

                List<string> list = JsonConvert.DeserializeObject<List<string>>(
                    File.ReadAllText(p, Encoding.UTF8));

                // 내용이 깨진 것은 읽기 실패가 아니다 — 그 파일은 다시 써서 고친다.
                return list ?? new List<string>();
            }
            catch (JsonException ex)
            {
                cLog.Write("최근 목록이 깨져 있다 — 새로 만든다");
                cLog.Write(ex);
                return new List<string>();
            }
            catch (Exception ex)
            {
                cLog.Write("최근 목록을 읽지 못했다 — 이번에는 덮어쓰지 않는다");
                cLog.Write(ex);
                pRead = false;
                return new List<string>();
            }
        }

        /// <summary>화면에 낼 목록 — 지금 실제로 열 수 있는 것만.</summary>
        public static List<string> Live()
        {
            List<string> live = new List<string>();
            foreach (string s in All())
            {
                try { if (!string.IsNullOrEmpty(s) && File.Exists(s)) live.Add(s); }
                catch { /* 경로가 이상해도 목록 하나 때문에 멈추지 않는다 */ }
            }
            return live;
        }

        public static void Add(string pPath)
        {
            if (string.IsNullOrEmpty(pPath)) return;

            string full = Full(pPath);

            bool read;
            List<string> list = All(out read);
            if (!read) return;   // 못 읽었으면 덮어쓰지 않는다 — 있던 목록을 날리는 쪽이 더 나쁘다

            list.RemoveAll(delegate (string s)
            {
                return string.Equals(s, full, StringComparison.OrdinalIgnoreCase);
            });
            list.Insert(0, full);
            if (list.Count > cMax) list.RemoveRange(cMax, list.Count - cMax);

            Save(list);
        }

        public static void Remove(string pPath)
        {
            if (string.IsNullOrEmpty(pPath)) return;

            // ★ 목록에는 전체 경로로 들어 있다 — 상대 경로로 지우려 하면 하나도 안 맞는다
            //   (명령줄로 "HwpEditor.exe doc.hwp" 를 열었다가 실패한 경우가 그렇다).
            string full = Full(pPath);

            bool read;
            List<string> list = All(out read);
            if (!read) return;

            int n = list.RemoveAll(delegate (string s)
            {
                return string.Equals(s, full, StringComparison.OrdinalIgnoreCase);
            });
            if (n > 0) Save(list);
        }

        private static string Full(string pPath)
        {
            try { return Path.GetFullPath(pPath); }
            catch { return pPath; }
        }

        private static void Save(List<string> pList)
        {
            try
            {
                string p = FilePath;
                Directory.CreateDirectory(Path.GetDirectoryName(p));
                File.WriteAllText(p, JsonConvert.SerializeObject(pList), new UTF8Encoding(false));
            }
            catch (Exception ex)
            {
                cLog.Write("최근 목록을 쓰지 못했다");
                cLog.Write(ex);
            }
        }
    }
}
