using System;
using System.IO;
using HwpEditor.Models;

namespace HwpEditor.Files
{
    /// <summary>
    /// 형식을 가리지 않는 문서 하나. 화면·CLI 는 전부 이 문을 지난다 — 그래야 hwp 로 본 것과
    /// hwpx 로 본 것이 같은 코드를 지났다고 말할 수 있다.
    /// </summary>
    public sealed class cDocument
    {
        private readonly cHwpDocument cHwp;   // hwp5 일 때만
        private readonly DocModel cModel;     // hwpx 일 때만 (hwp 는 cHwp 가 들고 있다)

        private cDocument(cHwpDocument pHwp) { cHwp = pHwp; }
        private cDocument(DocModel pModel, string pPath) { cModel = pModel; Path = pPath; }

        public string Path { get; private set; }

        public string Format { get { return cHwp != null ? "hwp5" : "hwpx"; } }

        public DocModel Model { get { return cHwp != null ? cHwp.Model : cModel; } }

        /// <summary>hwp5 일 때만. hwpx 는 아직 없다(2단계).</summary>
        public cHwpDocument Hwp { get { return cHwp; } }

        public static cDocument Open(string pPath)
        {
            if (string.IsNullOrEmpty(pPath)) throw new ArgumentNullException("pPath");

            string ext = System.IO.Path.GetExtension(pPath);
            if (string.Equals(ext, ".hwpx", StringComparison.OrdinalIgnoreCase))
            {
                cDocument d = new cDocument(cHwpxReader.Read(pPath), pPath);
                return d;
            }

            cDocument h = new cDocument(cHwpDocument.Open(pPath));
            h.Path = pPath;
            return h;
        }

        public void Save(string pPath)
        {
            if (cHwp == null)
                throw new NotSupportedException("hwpx 저장은 2단계에서 붙인다 — 지금은 읽기만 된다.");
            cHwp.Save(pPath);
            Path = pPath;
        }
    }
}
