using System.Collections.Generic;
using Newtonsoft.Json;

namespace HwpEditor.Models
{
    /// <summary>
    /// 화면(JS)이 받는 문서 하나. ★ 이 폴더는 WinForms 도 HwpLibSharp 도 참조하지 않는다 —
    /// hwp 리더와 hwpx 리더가 <b>같은 모델</b>을 채워야 화면이 한 벌로 유지된다(계획 5절).
    ///
    /// JSON 이름은 계획 5절 그대로다. 짧게 쓴 것은 문서 하나가 통째로 오가기 때문이다
    /// (100쪽 문서면 이름 길이가 그대로 전송량이 된다).
    /// </summary>
    public sealed class DocModel
    {
        [JsonProperty("t")] public string T = "doc";
        [JsonProperty("rev")] public int Rev;

        /// <summary>"hwp5" 또는 "hwpx". 저장 경로가 갈린다.</summary>
        [JsonProperty("format")] public string Format;

        [JsonProperty("path")] public string Path;

        [JsonProperty("faceNames")] public List<FaceNameModel> FaceNames = new List<FaceNameModel>();
        [JsonProperty("charShapes")] public List<CharShapeModel> CharShapes = new List<CharShapeModel>();
        [JsonProperty("paraShapes")] public List<ParaShapeModel> ParaShapes = new List<ParaShapeModel>();
        [JsonProperty("sections")] public List<SectionModel> Sections = new List<SectionModel>();
    }

    public sealed class SectionModel
    {
        [JsonProperty("idx")] public int Idx;
        [JsonProperty("page")] public PageModel Page = new PageModel();
        [JsonProperty("cols")] public ColsModel Cols = new ColsModel();
        [JsonProperty("paras")] public List<ParagraphModel> Paras = new List<ParagraphModel>();
    }

    /// <summary>용지·여백. 전부 HWPUNIT(1/7200인치).</summary>
    public sealed class PageModel
    {
        [JsonProperty("wHu")] public long WHu;
        [JsonProperty("hHu")] public long HHu;
        [JsonProperty("mlHu")] public long MlHu;
        [JsonProperty("mrHu")] public long MrHu;
        [JsonProperty("mtHu")] public long MtHu;
        [JsonProperty("mbHu")] public long MbHu;
        [JsonProperty("mhHu")] public long MhHu;
        [JsonProperty("mfHu")] public long MfHu;
        [JsonProperty("gutHu")] public long GutHu;
        [JsonProperty("landscape")] public bool Landscape;

        /// <summary>본문이 실제로 흐르는 폭. lineseg 의 SegmentWidth 와 맞아야 한다.</summary>
        [JsonIgnore] public long TextWidthHu { get { return WHu - MlHu - MrHu - GutHu; } }

        /// <summary>본문이 실제로 흐르는 높이(머리말·꼬리말 띠를 뺀 값이 아니라 여백만 뺀 값).</summary>
        [JsonIgnore] public long TextHeightHu { get { return HHu - MtHu - MbHu; } }
    }

    public sealed class ColsModel
    {
        [JsonProperty("count")] public int Count = 1;
        [JsonProperty("gapHu")] public long GapHu;
    }

    public sealed class ParagraphModel
    {
        /// <summary>본문 <c>s{섹션}p{원본인덱스}</c>, 셀 내부·신규는 계획 B-1 규칙.</summary>
        [JsonProperty("id")] public string Id;

        /// <summary>ParaShape 인덱스.</summary>
        [JsonProperty("ps")] public int Ps;

        /// <summary>
        /// 이 문단 앞에서 강제로 나뉘는가. "page" | "column" | "section" | null.
        /// ★ 원본 <c>ParaHeader.DivideSort</c> 값이다 — 이걸 안 보면 쪽이 모자라고, 그 뒤 줄의 y 가
        ///   통째로 밀려 lineseg 대조가 의미를 잃는다(실측 — aligns.hwp 가 2쪽인데 1쪽으로 나왔다).
        /// </summary>
        [JsonProperty("brk", NullValueHandling = NullValueHandling.Ignore)]
        public string Brk;

        [JsonProperty("runs")] public List<RunModel> Runs = new List<RunModel>();
        [JsonProperty("objs")] public List<InlineObjModel> Objs = new List<InlineObjModel>();

        /// <summary>
        /// lineseg 오라클. ★ 원본 문단에만 있다 — 편집으로 dirty 가 된 문단은 null 이다(계획 B-5).
        /// 우리 레이아웃 결과가 아니라 <b>문서에 저장돼 있던 값</b>이므로 읽기 전용으로 다룬다.
        /// </summary>
        [JsonProperty("seg", NullValueHandling = NullValueHandling.Ignore)]
        public List<SegModel> Seg;

        /// <summary>편집 인덱스 기준 글자 수(runs 의 text 길이 합 + objs 개수).</summary>
        [JsonProperty("len")] public int Len;
    }

    public sealed class RunModel
    {
        /// <summary>CharShape 인덱스.</summary>
        [JsonProperty("cs")] public int Cs;

        /// <summary>★ 제어문자 없음. 탭은 "\t", 문단 내 줄바꿈은 "\n"(계획 B-3).</summary>
        [JsonProperty("text")] public string Text;
    }

    /// <summary>
    /// 문단 안에 박히는 개체. ★ pos 는 <b>편집 인덱스</b>다 — 원시 인덱스에서 확장 컨트롤이
    /// 8글자인 것을 1글자로 접은 좌표계(계획 B-2).
    /// </summary>
    public sealed class InlineObjModel
    {
        [JsonProperty("pos")] public int Pos;
        [JsonProperty("oid")] public string Oid;

        /// <summary>"image" | "table" | "opaque" | "ctrl"</summary>
        [JsonProperty("kind")] public string Kind;

        /// <summary>
        /// 화면에 아무것도 그리지 않는 자리다. 용지·단 정의(secd·cold)와 필드 같은 인라인 컨트롤이
        /// 여기 든다.
        ///
        /// ★ 그래도 <b>개체 한 자리를 차지한다</b> — 안 그러면 저장할 때 이 컨트롤이 통째로 사라진다.
        ///   문단을 되쓸 때는 runs·objs 만 보고 원시 글자열을 다시 만드는데, 목록에 없는 컨트롤은
        ///   다시 쓸 방법이 없기 때문이다(첫 문단을 한 번 고치면 그 구역의 용지 정의가 날아간다).
        /// </summary>
        [JsonProperty("hidden", NullValueHandling = NullValueHandling.Ignore)]
        public bool? Hidden;

        [JsonProperty("wHu")] public long WHu;
        [JsonProperty("hHu")] public long HHu;

        /// <summary>
        /// "글자처럼 취급"인가(<c>GsoHeaderProperty.IsLikeWord</c>).
        ///
        /// ★ 이걸 안 보면 레이아웃이 크게 어긋난다 — 떠 있는 개체는 줄의 <b>폭도 높이도 안 먹는데</b>,
        ///   인라인으로 다루면 그 문단이 억지로 여러 줄로 쪼개지고 뒤 문단의 y 가 통째로 밀린다
        ///   (실측 — aligns.hwp 는 문단 16개가 전부 떠 있는 그리기 개체다).
        /// </summary>
        [JsonProperty("inline")] public bool Inline;

        /// <summary>떠 있는 개체의 배치 기준 좌표(HWPUNIT). 인라인이면 뜻이 없다.</summary>
        [JsonProperty("xOffHu")] public long XOffHu;
        [JsonProperty("yOffHu")] public long YOffHu;

        /// <summary>가로·세로 배치 기준: "paper" | "page" | "column" | "para"</summary>
        [JsonProperty("relH", NullValueHandling = NullValueHandling.Ignore)] public string RelH;
        [JsonProperty("relV", NullValueHandling = NullValueHandling.Ignore)] public string RelV;

        /// <summary>본문과의 배치: "takePlace"(자리 차지) | "fit"(어울림) | "behind" | "front".</summary>
        [JsonProperty("flow", NullValueHandling = NullValueHandling.Ignore)] public string Flow;

        [JsonProperty("src", NullValueHandling = NullValueHandling.Ignore)] public string Src;

        /// <summary>opaque 일 때 원본 컨트롤 종류(eqed·secd 등)와 화면에 띄울 라벨.</summary>
        [JsonProperty("ctrl", NullValueHandling = NullValueHandling.Ignore)] public string Ctrl;
        [JsonProperty("label", NullValueHandling = NullValueHandling.Ignore)] public string Label;

        [JsonProperty("table", NullValueHandling = NullValueHandling.Ignore)] public TableModel Table;
    }

    public sealed class TableModel
    {
        [JsonProperty("rows")] public int Rows;
        [JsonProperty("cols")] public int Cols;
        [JsonProperty("cells")] public List<CellModel> Cells = new List<CellModel>();
    }

    public sealed class CellModel
    {
        [JsonProperty("r")] public int R;
        [JsonProperty("c")] public int C;
        [JsonProperty("rs")] public int Rs = 1;
        [JsonProperty("cs")] public int Cs = 1;
        [JsonProperty("wHu")] public long WHu;
        [JsonProperty("hHu")] public long HHu;

        /// <summary>칸 안쪽 여백(HWPUNIT). 글은 이만큼 들어가서 시작한다.</summary>
        [JsonProperty("mlHu")] public long MlHu;
        [JsonProperty("mrHu")] public long MrHu;
        [JsonProperty("mtHu")] public long MtHu;
        [JsonProperty("mbHu")] public long MbHu;

        [JsonProperty("paras")] public List<ParagraphModel> Paras = new List<ParagraphModel>();
    }

    /// <summary>
    /// lineseg 한 줄. 필드 이름은 계획 5절 그대로 짧게 간다.
    /// <c>s</c> 는 <b>편집 인덱스로 변환된</b> 줄 시작 위치다.
    /// </summary>
    public sealed class SegModel
    {
        [JsonProperty("s")] public int S;
        [JsonProperty("y")] public long Y;

        /// <summary>줄 높이. 읽을 때는 파일의 글자 높이, 저장 요청에서는 <b>다음 줄까지의 거리</b>다.</summary>
        [JsonProperty("h")] public long H;

        /// <summary>글자 높이. 저장할 때 줄 높이와 줄 사이 여분을 가르는 데 쓴다(h - th = 여분).</summary>
        [JsonProperty("th")] public long Th;
        [JsonProperty("b")] public long B;
        [JsonProperty("x")] public long X;
        [JsonProperty("w")] public long W;

        /// <summary>이 줄에서 쪽이 넘어갔는가. ★ 파일의 태그가 아니라 y 리셋으로 판정한 값이다.</summary>
        [JsonProperty("np")] public bool NewPage;
    }
}
