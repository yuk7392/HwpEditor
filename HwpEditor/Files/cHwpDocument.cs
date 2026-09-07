using System;
using System.Collections.Generic;
using System.IO;
using HwpEditor.Models;
using HwpLib.Object;
using HwpLib.Object.DocInfo;
using HwpLib.Reader;
using HwpLib.Writer;

namespace HwpEditor.Files
{
    /// <summary>
    /// 열어 둔 .hwp 하나. 읽은 <see cref="HWPFile"/> 를 그대로 들고 있다가 편집분만 되쓴다
    /// (계획 2절 "원본 객체 유지 + 변경분만 반영"). 미지원 요소는 손대지 않아 보존된다.
    ///
    /// ★ WinForms 를 참조하지 않는다 — CLI(cCli)도 같은 길로 열고 저장해야 오라클이 화면과 같은 것을 본다.
    /// </summary>
    public sealed class cHwpDocument
    {
        private readonly HWPFile cFile;

        /// <summary>
        /// 이 문서가 아래 region 의 되쓰기 버그 보정 대상인지. 문서마다 한 번만 재고 캐시한다.
        /// null 이면 아직 안 쟀다.
        /// </summary>
        private bool? cNeedsStyleFix;

        private cHwpDocument(HWPFile pFile, string pPath)
        {
            cFile = pFile;
            Path = pPath;
        }

        /// <summary>마지막으로 읽거나 저장한 경로. 새 문서면 null.</summary>
        public string Path { get; private set; }

        public HWPFile File { get { return cFile; } }

        /// <summary>
        /// 화면에 보내는 문서 모델. 처음 쓸 때 만들고 그대로 들고 있는다.
        ///
        /// ★ 만들면서 <see cref="Index"/>(화면 id → 원본 객체)도 같이 채우고 그림을 파일로 푼다 —
        ///   둘 다 이 모델과 같은 순간의 문서를 봐야 짝이 맞는다.
        /// </summary>
        public DocModel Model
        {
            get
            {
                if (cModel == null)
                {
                    cModel = cHwpReader.Read(cFile, Path, cIndex);
                    cImageStore.Extract(cFile, cModel, cIndex, cImageStore.DocKey(Path));
                }
                return cModel;
            }
        }

        private DocModel cModel;

        private readonly cHwpIndex cIndex = new cHwpIndex();

        /// <summary>편집분을 되쓸 때 쓰는 id 표. <see cref="Model"/> 을 한 번은 읽어야 채워진다.</summary>
        public cHwpIndex Index
        {
            get
            {
                if (cModel == null) { DocModel unused = Model; }
                return cIndex;
            }
        }

        /// <summary>
        /// 편집분을 메모리의 원본에 반영한다. ★ 반영 뒤에도 <b>다시 읽지 않는다</b> —
        /// 다시 읽으면 문단 id 가 새로 매겨져 화면이 들고 있는 id 와 어긋난다.
        /// 대신 <see cref="Index"/> 를 그 자리에서 갱신해 id 를 계속 유효하게 둔다.
        /// </summary>
        public void Apply(SaveRequest pReq, SaveResult pResult)
        {
            if (pReq == null) return;
            cHwpWriter.Apply(cFile, Index, pReq, pResult);

            if (pResult != null)
            {
                pResult.CharShapes = cHwpReader.CharShapesOf(cFile.DocInfo);
                pResult.ParaShapes = cHwpReader.ParaShapesOf(cFile.DocInfo);
            }
        }

        public static cHwpDocument Open(string pPath)
        {
            if (string.IsNullOrEmpty(pPath)) throw new ArgumentNullException("pPath");
            return new cHwpDocument(HWPReader.FromFile(pPath), pPath);
        }

        public void Save(string pPath)
        {
            if (string.IsNullOrEmpty(pPath)) throw new ArgumentNullException("pPath");

            if (cNeedsStyleFix == null) cNeedsStyleFix = MeasureStyleShift(cFile);

            if (cNeedsStyleFix.Value) ShiftStyleParaShapeId(cFile, +1);
            try { HWPWriter.ToFile(cFile, pPath); }
            finally { if (cNeedsStyleFix.Value) ShiftStyleParaShapeId(cFile, -1); }

            Path = pPath;
        }

        #region HwpLibSharp 되쓰기 버그 보정 — StyleInfo.ParaShapeId

        // ★ 실측 버그(2026-09-07). HwpLibSharp 1.1.10.8 로 저장하면 구버전 문서에서
        //   DocInfo.StyleList[].ParaShapeId 가 전부 1씩 줄어든 채로 저장된다. 저장할 때마다 누적되므로
        //   (3회 저장 = -3) 문서를 열고 저장만 반복해도 스타일이 엉뚱한 문단모양을 가리키게 된다.
        //
        //   실측 범위: 샘플 36개 중 파일 버전 5.0.1.7 인 34개가 전부 밀리고, 5.0.2.4 / 5.0.3.4 인
        //   2개(basicsReport, noori)는 멀쩡하다. 즉 버전에 걸린 분기인데 정확한 경계는 모른다 —
        //   경계 상수를 추측해 박으면 그 사이 버전에서 조용히 틀린다. 그래서 상수 대신
        //   MeasureStyleShift 로 문서마다 한 번 재서 판정한다.
        //
        //   증상이 안 보이는 자리다: 저장은 성공하고, 문단은 자기 ParaShapeId 를 따로 들고 있어서
        //   본문 모양은 그대로다. 어긋나는 것은 스타일 목록이라 다시 열어 봐도 눈에 안 띈다.

        /// <summary>0xFFFF 가 읽기에 따라 -1 로도 65535 로도 올라온다 — 16비트 무부호로 맞춰 비교한다.</summary>
        private static int U16(int pValue)
        {
            return ((pValue % 65536) + 65536) % 65536;
        }

        /// <summary>
        /// 메모리로 한 번 써 보고 되읽어, StyleInfo.ParaShapeId 가 전부 1씩 밀리는 문서인지 판정한다.
        /// 문서당 한 번만 돈다(<see cref="cNeedsStyleFix"/> 캐시).
        /// </summary>
        private static bool MeasureStyleShift(HWPFile pFile)
        {
            try
            {
                IReadOnlyList<StyleInfo> styles = pFile.DocInfo.StyleList;
                if (styles.Count == 0) return false;

                int[] before = new int[styles.Count];
                for (int i = 0; i < styles.Count; i++) before[i] = U16(styles[i].ParaShapeId);

                using (MemoryStream ms = new MemoryStream())
                {
                    HWPWriter.ToStream(pFile, ms);
                    ms.Position = 0;
                    HWPFile probe = HWPReader.FromStream(ms);

                    IReadOnlyList<StyleInfo> after = probe.DocInfo.StyleList;
                    if (after.Count != before.Length) return false;

                    for (int i = 0; i < before.Length; i++)
                        if (U16(after[i].ParaShapeId) != U16(before[i] - 1)) return false;

                    return true;
                }
            }
            catch (Exception ex)
            {
                // 재기에 실패하면 보정하지 않는다 — 잘못 보정하면 멀쩡한 문서를 망친다.
                cLog.Write("스타일 밀림 측정 실패, 보정 없이 저장한다");
                cLog.Write(ex);
                return false;
            }
        }

        private static void ShiftStyleParaShapeId(HWPFile pFile, int pDelta)
        {
            IReadOnlyList<StyleInfo> styles = pFile.DocInfo.StyleList;
            for (int i = 0; i < styles.Count; i++)
                styles[i].ParaShapeId = U16(styles[i].ParaShapeId + pDelta);
        }

        #endregion
    }
}
