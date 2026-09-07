using System;
using System.Collections.Generic;
using HwpEditor.Models;

namespace HwpEditor.Files
{
    /// <summary>
    /// 형식을 가리지 않는 문서 하나. 화면·CLI 는 전부 이 문을 지난다 — 그래야 hwp 로 본 것과
    /// hwpx 로 본 것이 같은 코드를 지났다고 말할 수 있다.
    /// </summary>
    public sealed class cDocument
    {
        private readonly cHwpDocument cHwp;     // hwp5 일 때만
        private readonly cHwpxDocument cHwpx;   // hwpx 일 때만

        private cDocument(cHwpDocument pHwp) { cHwp = pHwp; }
        private cDocument(cHwpxDocument pHwpx) { cHwpx = pHwpx; }

        public string Path { get { return cHwp != null ? cHwp.Path : cHwpx.Path; } }

        public string Format { get { return cHwp != null ? "hwp5" : "hwpx"; } }

        public DocModel Model { get { return cHwp != null ? cHwp.Model : cHwpx.Model; } }

        /// <summary>hwp5 일 때만. 왕복 검사가 원본 <c>HWPFile</c> 지표를 잰다.</summary>
        public cHwpDocument Hwp { get { return cHwp; } }

        public static cDocument Open(string pPath)
        {
            if (string.IsNullOrEmpty(pPath)) throw new ArgumentNullException("pPath");

            string ext = System.IO.Path.GetExtension(pPath);
            if (string.Equals(ext, ".hwpx", StringComparison.OrdinalIgnoreCase))
                return new cDocument(cHwpxDocument.Open(pPath));

            return new cDocument(cHwpDocument.Open(pPath));
        }

        /// <summary>
        /// 편집분을 메모리의 원본에 반영하고 저장한다(계획 6절).
        ///
        /// ★ 반영과 저장을 한 문으로 묶는다 — 반영만 하고 저장을 못 하면 메모리와 파일이 갈라지는데,
        ///   화면은 저장 결과만 보고 dirty 를 비우므로 그 사실을 영영 모른다.
        /// </summary>
        public SaveResult Save(string pPath, SaveRequest pReq)
        {
            SaveResult r = new SaveResult();

            if (cHwp != null)
            {
                cHwp.Apply(pReq, r);
                cHwp.Save(pPath);
            }
            else
            {
                cHwpx.Apply(pReq, r);
                cHwpx.Save(pPath);
            }

            r.Ok = true;
            r.Path = Path;
            return r;
        }

        /// <summary>편집분 없이 저장만. 검사 통로가 쓴다.</summary>
        public SaveResult Save(string pPath, IList<EditOp> pOps)
        {
            SaveRequest req = new SaveRequest();
            req.Ops = pOps == null ? new List<EditOp>() : new List<EditOp>(pOps);
            return Save(pPath, req);
        }
    }
}
