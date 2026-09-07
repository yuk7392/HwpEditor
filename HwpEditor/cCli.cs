using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;
using HwpEditor.Files;
using HwpEditor.Models;
using HwpLib.Object;
using HwpLib.Object.BodyText;
using HwpLib.Object.BodyText.Paragraph;
using HwpLib.Object.DocInfo;
using HwpLib.Tool.TextExtractor;

namespace HwpEditor
{
    /// <summary>
    /// 화면 없이 도는 검증 통로. 오라클 대조가 화면과 <b>같은 코드</b>를 지나야 하므로
    /// 여기서도 파일은 <see cref="cHwpDocument"/> 로만 열고 저장한다.
    /// </summary>
    internal static class cCli
    {
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AttachConsole(int dwProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool AllocConsole();

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr GetStdHandle(int nStdHandle);

        private const int cStdOutputHandle = -11;

        /// <summary>
        /// WinExe 라 콘솔이 없다 — 부모 콘솔에 붙지 않으면 출력이 통째로 사라진다.
        /// ★ 단 stdout 이 <b>이미 있으면 손대지 않는다</b>. 호출부가 파일·파이프로 받아 가는 중인데
        ///   AttachConsole 을 부르면 표준 핸들이 콘솔로 바뀌어 그쪽 출력이 통째로 빈다(실측 —
        ///   --selftest 가 한 줄도 안 나왔다).
        /// </summary>
        private static void EnsureConsole()
        {
            IntPtr h = GetStdHandle(cStdOutputHandle);
            if (h == IntPtr.Zero || h == new IntPtr(-1))
            {
                if (!AttachConsole(-1)) AllocConsole();
            }

            // ★ Console.OutputEncoding 만 세우면 파일·파이프로 리디렉션된 출력에는 안 먹어서
            //   한글이 CP949 로 나간다(실측 — --selftest 결과를 UTF-8 로 읽으면 전부 깨졌다).
            //   표준 출력 스트림을 UTF-8(BOM 없음) 로 직접 감싼다.
            try
            {
                StreamWriter w = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
                w.AutoFlush = true;
                Console.SetOut(w);
            }
            catch (Exception ex)
            {
                cLog.Write(ex);
            }
        }

        /// <summary>
        /// CLI 인자면 처리하고 종료코드(0 이상)를, 아니면 -1 을 준다.
        /// ★ WinExe 라 콘솔이 없다 — 부모 콘솔에 붙지 않으면 출력이 통째로 사라진다.
        /// </summary>
        internal static int TryRun(string[] pArgs)
        {
            if (pArgs == null || pArgs.Length == 0) return -1;

            string cmd = pArgs[0];
            if (cmd != "--roundtrip" && cmd != "--roundtrip-all"
             && cmd != "--dump-assets" && cmd != "--selftest"
             && cmd != "--oracle" && cmd != "--model" && cmd != "--render-oracle"
             && cmd != "--edit-test" && cmd != "--image-test" && cmd != "--apply"
             && cmd != "--ui-test" && cmd != "--pdf" && cmd != "--grid-test") return -1;

            EnsureConsole();
            try
            {
                try { Console.OutputEncoding = Encoding.UTF8; } catch { /* 리디렉션 대상에 따라 못 바꾼다 */ }
                switch (cmd)
                {
                    case "--roundtrip": return RunRoundTrip(pArgs);
                    case "--roundtrip-all": return RunRoundTripAll(pArgs);
                    case "--dump-assets": return RunDumpAssets(pArgs);
                    case "--selftest": return RunSelfTest(pArgs);
                    case "--oracle": return RunOracle(pArgs);
                    case "--model": return RunModel(pArgs);
                    case "--render-oracle": return RunRenderOracle(pArgs);
                    case "--edit-test": return cEditTest.RunEdit(pArgs);
                    case "--image-test": return cEditTest.RunImage(pArgs);
                    case "--apply": return cEditTest.RunApply(pArgs);
                    case "--ui-test": return cUiTestRunner.Run(pArgs);
                    case "--pdf": return cPdfRunner.Run(pArgs);
                    case "--grid-test": return cGridTest.Run(pArgs);
                }
                return -1;
            }
            catch (Exception ex)
            {
                Console.WriteLine("실패: " + ex.GetType().Name + ": " + ex.Message);
                cLog.Write(ex);
                return 2;
            }
        }

        /// <summary>
        /// 화면 밖에서 편집기 문서를 실제로 띄워 0단계 완료 판정을 기계로 찍는다.
        /// ★ WebView2 를 쓰는 유일한 CLI 통로라 여기서만 네이티브 로더를 올린다
        ///   (Program.Main 은 CLI 분기를 로더 준비보다 앞에 둔다 — 나머지 통로는 런타임이 없어도 돌아야 한다).
        /// </summary>
        private static int RunSelfTest(string[] pArgs)
        {
            int timeoutSec = pArgs.Length > 1 ? int.Parse(pArgs[1]) : 30;

            Program.PrepareWebView2Loader();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            using (cSelfTestForm f = new cSelfTestForm(timeoutSec))
            {
                Application.Run(f);
                Console.WriteLine(f.Report);
                return f.Ok ? 0 : 3;
            }
        }

        /// <summary>
        /// 화면 밖에서 실제로 배치·렌더해 lineseg 오라클 일치율을 잰다(1단계 완료 판정 ②③).
        /// 사용법: <c>--render-oracle &lt;파일 또는 폴더&gt; [시한초]</c>
        /// </summary>
        private static int RunRenderOracle(string[] pArgs)
        {
            if (pArgs.Length < 2) { Console.WriteLine("사용법: --render-oracle <파일 또는 폴더> [시한초]"); return 2; }

            string[] files = DocFiles(pArgs[1]);

            string[] skip = { "password-12345.hwp", "viewtext.hwp" };
            List<string> use = new List<string>();
            foreach (string f in files) if (Array.IndexOf(skip, Path.GetFileName(f)) < 0) use.Add(f);

            int timeout = pArgs.Length > 2 ? int.Parse(pArgs[2]) : 30 + use.Count * 10;

            Program.PrepareWebView2Loader();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            cRenderOracleForm form = new cRenderOracleForm(use.ToArray(), timeout);
            using (form) Application.Run(form);

            Console.WriteLine("| 샘플 | 문단(seg) | 일치 | 일치율 | 쪽 | 줄 | y오차 평균 | y오차 최대 | 폰트 | 배치ms |");
            Console.WriteLine("|---|---|---|---|---|---|---|---|---|---|");

            int totalParas = 0, totalMatch = 0, worstDy = 0;
            foreach (cOracleRow r in form.Rows)
            {
                if (r.Err != null) { Console.WriteLine("| {0} | ERR {1} |", r.Name, r.Err); continue; }
                Console.WriteLine("| {0} | {1} | {2} | {3}% | {4} | {5} | {6} | {7} | {8} | {9} |",
                    r.Name, r.Total, r.Match, r.Rate.ToString("0.0", CultureInfo.InvariantCulture),
                    r.Pages, r.Lines, r.DyAvg, r.DyMax, r.FontOk ? "OK" : "실패", r.Ms);
                totalParas += r.Total;
                totalMatch += r.Match;
                if (r.DyMax > worstDy) worstDy = r.DyMax;
            }

            Console.WriteLine();
            double rate = totalParas > 0 ? totalMatch * 100.0 / totalParas : 0;
            foreach (cOracleRow rr in form.Rows) if (rr.Probe != null) { Console.WriteLine("측정 표본(12pt): " + rr.Probe); break; }
            Console.WriteLine("전체 — 문단 " + totalParas + " 중 " + totalMatch + " 일치 ("
                + rate.ToString("0.0", CultureInfo.InvariantCulture) + "%), y오차 최대 " + worstDy);

            foreach (cOracleRow r in form.Rows)
            {
                if (r.Details.Count == 0) continue;
                Console.WriteLine();
                Console.WriteLine("  · " + r.Name + " 안 맞은 문단 (앞 " + r.Details.Count + "개)");
                foreach (string d in r.Details) Console.WriteLine(d);
            }

            if (form.Error != null) { Console.WriteLine(); Console.WriteLine("중단: " + form.Error); return 3; }
            return rate >= 90 ? 0 : 1;
        }

        /// <summary>폴더면 .hwp 와 .hwpx 를 모두, 파일이면 그 하나를. 이름 순으로 준다.</summary>
        private static string[] DocFiles(string pPathOrDir)
        {
            if (!Directory.Exists(pPathOrDir)) return new string[] { pPathOrDir };
            // ★ Windows 의 "*.hwp" 는 .hwpx 까지 잡는다(8.3 이름 규칙의 잔재) — 확장자를 직접 본다.
            //   안 거르면 같은 파일이 두 번 검사되고 합계가 두 배로 나온다(실측).
            List<string> all = new List<string>();
            foreach (string f in Directory.GetFiles(pPathOrDir))
            {
                string ext = Path.GetExtension(f);
                if (string.Equals(ext, ".hwp", StringComparison.OrdinalIgnoreCase)
                 || string.Equals(ext, ".hwpx", StringComparison.OrdinalIgnoreCase)) all.Add(f);
            }
            string[] arr = all.ToArray();
            Array.Sort(arr, StringComparer.OrdinalIgnoreCase);
            return arr;
        }

        #region 리더 검사 (--oracle / --model)

        /// <summary>
        /// 파일 하나 또는 폴더 전체를 <see cref="DocModel"/> 로 읽어, 문서에 저장돼 있던 lineseg 와
        /// 우리 모델이 어긋나지 않는지 본다. ★ 여기서 재는 것은 <b>리더</b>다 — 레이아웃 엔진의
        /// 줄 나눔 일치율은 화면(hwOracle.js)이 잰다.
        /// </summary>
        private static int RunOracle(string[] pArgs)
        {
            if (pArgs.Length < 2) { Console.WriteLine("사용법: --oracle <파일 또는 폴더>"); return 2; }

            string[] files = DocFiles(pArgs[1]);

            string[] skip = { "password-12345.hwp", "viewtext.hwp" };
            int bad = 0;

            Console.WriteLine("| 샘플 | 문단 | seg문단 | 줄 | 쪽 | 텍스트 | seg 인덱스 |");
            Console.WriteLine("|---|---|---|---|---|---|---|");

            foreach (string path in files)
            {
                string name = Path.GetFileName(path);
                if (Array.IndexOf(skip, name) >= 0) continue;

                try
                {
                    // ★ 형식을 가리지 않는 문으로 연다. 예전에는 hwp 전용 문으로 열어서 .hwpx 를
                    //   "Invalid header signature" 로 떨어뜨렸고, 그래서 hwpx 는 이 검사를
                    //   <b>한 번도 안 지났다</b>(실측 — 폴더를 바꿔 돌려 보고서야 드러났다).
                    cDocument doc = cDocument.Open(path);
                    DocModel m = doc.Model;

                    int paras = 0, segParas = 0, lines = 0, pages = 1;
                    int textBad = 0, idxBad = 0;

                    foreach (SectionModel sec in m.Sections)
                        foreach (ParagraphModel p in sec.Paras)
                        {
                            paras++;
                            if (p.Seg != null && p.Seg.Count > 0)
                            {
                                segParas++;
                                foreach (SegModel s in p.Seg)
                                {
                                    lines++;
                                    if (s.NewPage) pages++;
                                    // ★ B-2 검사: 편집 인덱스로 옮겼으면 문단 길이를 넘을 수 없다.
                                    if (s.S < 0 || s.S > p.Len) idxBad++;
                                }
                            }
                        }

                    // 글자 대조는 hwp 에만 있다 — HwpLibSharp 의 GetNormalString() 이 그 오라클이다.
                    string textCol = "대조없음";
                    if (doc.Hwp != null)
                    {
                        textBad = CountTextMismatch(doc.Hwp, m);
                        textCol = textBad == 0 ? "일치" : ("불일치 " + textBad);
                    }

                    Console.WriteLine("| {0} | {1} | {2} | {3} | {4} | {5} | {6} |",
                        name, paras, segParas, lines, pages, textCol,
                        idxBad == 0 ? "OK" : ("범위밖 " + idxBad));

                    if (textBad != 0 || idxBad != 0) bad++;
                }
                catch (Exception ex)
                {
                    bad++;
                    Console.WriteLine("| {0} | ERR {1}: {2} |", name, ex.GetType().Name, ex.Message);
                }
            }

            Console.WriteLine();
            Console.WriteLine("리더 검사 — 문제 있는 파일 " + bad + " 개");
            return bad == 0 ? 0 : 1;
        }

        /// <summary>
        /// 우리 runs 를 이어 붙인 글자열이 HwpLibSharp 의 <c>GetNormalString()</c> 과 같은지 센다.
        /// ★ 탭·줄바꿈은 우리 쪽에만 있으므로 빼고 비교한다(계획 B-3).
        /// </summary>
        private static int CountTextMismatch(cHwpDocument pDoc, DocModel pModel)
        {
            int bad = 0;
            for (int si = 0; si < pModel.Sections.Count && si < pDoc.File.BodyText.SectionList.Count; si++)
            {
                Section sec = pDoc.File.BodyText.SectionList[si];
                List<ParagraphModel> paras = pModel.Sections[si].Paras;
                for (int pi = 0; pi < paras.Count && pi < sec.ParagraphCount; pi++)
                {
                    StringBuilder b = new StringBuilder();
                    foreach (RunModel r in paras[pi].Runs)
                        if (r.Text != null)
                            foreach (char c in r.Text)
                                if (c != '\t' && c != '\n') b.Append(c);

                    string expect = sec.GetParagraph(pi).GetNormalString() ?? "";
                    if (b.ToString() != expect) bad++;
                }
            }
            return bad;
        }

        /// <summary>문서 하나를 JSON 으로 뽑는다 — 화면이 받는 것과 완전히 같은 것을 눈으로 보려는 통로.</summary>
        private static int RunModel(string[] pArgs)
        {
            if (pArgs.Length < 2) { Console.WriteLine("사용법: --model <파일> [출력.json]"); return 2; }

            cDocument doc = cDocument.Open(pArgs[1]);
            string json = cJson.ToJson(doc.Model, pArgs.Length > 2);

            if (pArgs.Length > 2) { File.WriteAllText(pArgs[2], json, new UTF8Encoding(false)); Console.WriteLine("썼다: " + pArgs[2] + " (" + json.Length + "자)"); }
            else Console.WriteLine(json);
            return 0;
        }

        #endregion

        private static int RunDumpAssets(string[] pArgs)
        {
            if (pArgs.Length < 2) { Console.WriteLine("사용법: --dump-assets <폴더>"); return 2; }
            cWebHost.DumpAssets(pArgs[1]);
            Console.WriteLine("자산을 풀었다: " + pArgs[1]);
            return 0;
        }

        #region 왕복 검사

        private static int RunRoundTrip(string[] pArgs)
        {
            if (pArgs.Length < 3) { Console.WriteLine("사용법: --roundtrip <입력.hwp> <출력.hwp>"); return 2; }

            cMetrics before, after;
            bool ok = RoundTripOne(pArgs[1], pArgs[2], 1, out before, out after);
            Console.WriteLine((ok ? "OK   " : "DIFF ") + Path.GetFileName(pArgs[1]));
            Console.WriteLine("  원본 " + before);
            Console.WriteLine("  왕복 " + after);
            return ok ? 0 : 1;
        }

        private static int RunRoundTripAll(string[] pArgs)
        {
            if (pArgs.Length < 3) { Console.WriteLine("사용법: --roundtrip-all <샘플폴더> <출력폴더> [반복횟수]"); return 2; }

            string src = pArgs[1], dstDir = pArgs[2];
            int rounds = pArgs.Length > 3 ? int.Parse(pArgs[3]) : 1;
            Directory.CreateDirectory(dstDir);

            // ★ 암호·배포용 문서는 열기 자체가 실패한다(G-8). 대조 집합에서 뺀다.
            string[] skip = { "password-12345.hwp", "viewtext.hwp" };

            int ok = 0, diff = 0, err = 0;

            // ★ hwpx 도 같이 돈다. 그전에는 hwpx 가 <b>한 번도 왕복 검사를 안 받았다</b> —
            //   "*.hwp" 로 훑고 HWPFile 로 열어 "Invalid header signature" 로 끝나고 있었다(실측).
            string[] files = DocFiles(src);

            foreach (string path in files)
            {
                string name = Path.GetFileName(path);
                if (Array.IndexOf(skip, name) >= 0) { Console.WriteLine("SKIP " + name); continue; }

                try
                {
                    cMetrics before, after;
                    if (RoundTripOne(path, Path.Combine(dstDir, name), rounds, out before, out after))
                    {
                        ok++;
                        Console.WriteLine("OK   " + name + " | " + before);
                    }
                    else
                    {
                        diff++;
                        Console.WriteLine("DIFF " + name);
                        Console.WriteLine("       원본 " + before);
                        Console.WriteLine("       왕복 " + after);
                    }
                }
                catch (Exception ex)
                {
                    err++;
                    Console.WriteLine("ERR  " + name + " | " + ex.GetType().Name + ": " + ex.Message);
                }
            }

            Console.WriteLine();
            Console.WriteLine("저장 " + rounds + "회 반복 — 합계  OK " + ok + " / DIFF " + diff + " / ERR " + err);
            return (diff == 0 && err == 0) ? 0 : 1;
        }

        /// <summary>pRounds 회 연속 저장한다 — 누적 오차가 있으면 여기서 드러난다.</summary>
        private static bool RoundTripOne(string pSrc, string pDst, int pRounds, out cMetrics pBefore, out cMetrics pAfter)
        {
            // ★ hwpx 는 HWPFile 이 아니다. 우리 모델로 견준다 — 지표가 약해지지만 "안 재는 것" 보다 낫다.
            if (Path.GetExtension(pSrc).Equals(".hwpx", StringComparison.OrdinalIgnoreCase))
            {
                cDocument x = cDocument.Open(pSrc);
                pBefore = cMetrics.OfModel(x.Model);

                for (int k = 0; k < pRounds; k++)
                {
                    x.Save(pDst, new List<EditOp>());       // 무편집 저장 — 고친 것 없이 다시 쓰기만 한다
                    x = cDocument.Open(pDst);
                }

                pAfter = cMetrics.OfModel(x.Model);
                return pBefore.Equals(pAfter);
            }

            cHwpDocument doc = cHwpDocument.Open(pSrc);
            pBefore = cMetrics.Of(doc.File);

            for (int r = 0; r < pRounds; r++)
            {
                doc.Save(pDst);
                doc = cHwpDocument.Open(pDst);
            }

            pAfter = cMetrics.Of(doc.File);
            return pBefore.Equals(pAfter);
        }

        #endregion

        /// <summary>
        /// 왕복 판정용 구조 지표. ★ 바이트 동일은 기대하지 않는다(압축·패딩) — 문단 수·텍스트 해시·
        /// 모양 배열 길이·스타일 매핑이 같은지로 본다.
        /// </summary>
        private sealed class cMetrics
        {
            public int Sections, Paras, Controls, Chars, CharShapes, ParaShapes, FaceNames, BinData;
            public string TextHash, StyleSig;

            public static cMetrics Of(HWPFile pFile)
            {
                cMetrics m = new cMetrics();
                m.Sections = pFile.BodyText.SectionList.Count;
                foreach (Section s in pFile.BodyText.SectionList)
                {
                    m.Paras += s.ParagraphCount;
                    for (int i = 0; i < s.ParagraphCount; i++)
                    {
                        Paragraph p = s.GetParagraph(i);
                        if (p.ControlList != null) m.Controls += p.ControlList.Count;
                        if (p.Text != null) m.Chars += p.Text.CharSize;
                    }
                }
                m.CharShapes = pFile.DocInfo.CharShapeList.Count;
                m.ParaShapes = pFile.DocInfo.ParaShapeList.Count;
                m.FaceNames = pFile.DocInfo.HangulFaceNameList.Count;
                m.BinData = pFile.BinData.EmbeddedBinaryDataList.Count;

                StringBuilder sig = new StringBuilder();
                foreach (StyleInfo st in pFile.DocInfo.StyleList)
                    sig.Append(((st.ParaShapeId % 65536) + 65536) % 65536).Append(',').Append(st.CharShapeId).Append(';');
                m.StyleSig = sig.ToString();

                string text = TextExtractor.Extract(pFile, TextExtractMethod.InsertControlTextBetweenParagraphText);
                using (SHA1 sha = SHA1.Create())
                    m.TextHash = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text ?? "")))
                                             .Replace("-", "").Substring(0, 12);
                return m;
            }

            /// <summary>모델로 재는 지표(hwpx). 표 칸 안의 문단까지 센다.</summary>
            public static cMetrics OfModel(DocModel pModel)
            {
                cMetrics m = new cMetrics();
                m.Sections = pModel.Sections.Count;
                m.CharShapes = pModel.CharShapes.Count;
                m.ParaShapes = pModel.ParaShapes.Count;
                m.FaceNames = pModel.FaceNames.Count;

                StringBuilder text = new StringBuilder();
                foreach (SectionModel sec in pModel.Sections)
                    foreach (ParagraphModel p in sec.Paras) CountPara(p, m, text);

                StringBuilder sig = new StringBuilder();
                foreach (SectionModel sec in pModel.Sections)
                    foreach (ParagraphModel p in sec.Paras) sig.Append(p.Ps).Append(';');
                m.StyleSig = sig.ToString();

                using (SHA1 sha = SHA1.Create())
                    m.TextHash = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text.ToString())))
                                             .Replace("-", "").Substring(0, 12);
                return m;
            }

            private static void CountPara(ParagraphModel pPara, cMetrics pM, StringBuilder pText)
            {
                pM.Paras++;
                pM.Chars += pPara.Len;
                foreach (RunModel r in pPara.Runs) if (r.Text != null) pText.Append(r.Text);
                pText.Append('\n');

                if (pPara.Objs == null) return;
                foreach (InlineObjModel o in pPara.Objs)
                {
                    pM.Controls++;
                    if (o.Table == null) continue;
                    foreach (CellModel c in o.Table.Cells)
                        foreach (ParagraphModel q in c.Paras) CountPara(q, pM, pText);
                }
            }

            public bool Equals(cMetrics pOther)
            {
                return pOther != null
                    && Sections == pOther.Sections && Paras == pOther.Paras && Controls == pOther.Controls
                    && Chars == pOther.Chars && CharShapes == pOther.CharShapes && ParaShapes == pOther.ParaShapes
                    && FaceNames == pOther.FaceNames && BinData == pOther.BinData
                    && TextHash == pOther.TextHash && StyleSig == pOther.StyleSig;
            }

            public override string ToString()
            {
                return "sec=" + Sections + " para=" + Paras + " ctl=" + Controls + " cs=" + CharShapes
                     + " ps=" + ParaShapes + " fn=" + FaceNames + " bin=" + BinData + " ch=" + Chars
                     + " h=" + TextHash;
            }
        }
    }
}
