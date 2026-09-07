using System.Collections.Generic;
using HwpLib.Object.BodyText;
using HwpLib.Object.BodyText.Control;
using HwpLib.Object.BodyText.Paragraph;
using HwpLib.Object.BodyText.Paragraph.Text;

namespace HwpEditor.Files
{
    /// <summary>
    /// 화면이 쓰는 id 를 원본 객체로 되돌리는 표(계획 B-1).
    ///
    /// ★ <b>인덱스가 아니라 객체 참조</b>로 잡는다. 문단을 넣거나 지우면 인덱스는 밀리는데,
    ///   화면은 자기가 처음 받은 id 를 계속 쓰기 때문이다. 참조로 잡아 두면 s0p12 는
    ///   문서가 어떻게 바뀌어도 그때 그 문단을 가리킨다.
    /// </summary>
    public sealed class cHwpIndex
    {
        public readonly Dictionary<string, cParaRef> Paras = new Dictionary<string, cParaRef>();
        public readonly Dictionary<string, cObjRef> Objs = new Dictionary<string, cObjRef>();

        public void Clear()
        {
            Paras.Clear();
            Objs.Clear();
        }
    }

    /// <summary>문단 하나와 그것이 든 곳.</summary>
    public sealed class cParaRef
    {
        public cParaRef(Paragraph pPara, Section pSec) : this(pPara, pSec, pSec) { }

        public cParaRef(Paragraph pPara, Section pSec, IParagraphList pList)
        {
            Para = pPara;
            Sec = pSec;
            List = pList;
        }

        public readonly Paragraph Para;

        /// <summary>본문 문단이면 그 구역. 표 셀 안의 문단이면 null 이다.</summary>
        public readonly Section Sec;

        /// <summary>
        /// 이 문단이 든 목록. 본문이면 구역 자신이고 표 셀 안이면 그 칸의 문단 목록이다(5단계).
        /// ★ 넣기·지우기가 이걸 쓴다 — 구역만 보면 셀 안에서는 아무것도 못 한다.
        /// </summary>
        public readonly IParagraphList List;
    }

    /// <summary>
    /// 문단 안 개체 한 자리. 되쓸 때 <b>원본 제어문자를 그대로 다시 쓴다</b> —
    /// 확장 제어문자는 8글자 안에 컨트롤 종류와 인스턴스 id 를 담고 있어서 새로 만들면 짝이 깨진다.
    /// </summary>
    public sealed class cObjRef
    {
        public cObjRef(HWPChar pChar, Control pControl)
        {
            Char = pChar;
            Control = pControl;
        }

        public readonly HWPChar Char;

        /// <summary>확장 컨트롤이면 대응 Control. 인라인 제어문자면 null(글자 자체가 전부다).</summary>
        public readonly Control Control;
    }
}
