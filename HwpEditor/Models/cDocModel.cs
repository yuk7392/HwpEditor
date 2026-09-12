using System.Collections.Generic;
using Newtonsoft.Json;

namespace HwpEditor.Models
{
    /// <summary>
    /// ★ 이 폴더는 WinForms 도 HwpLibSharp 도 참조하지 않는다 —
    /// hwp 리더와 hwpx 리더가 <b>같은 모델</b>을 채워야 화면이 한 벌로 유지된다.
    ///
    /// JSON 이름은 짧게 쓴 것은 문서 하나가 통째로 오가기 때문이다
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

        /// <summary>테두리/배경 표. ★ 번호가 1부터라 0번 자리는 비어 있다(<see cref="BorderFillModel"/>).</summary>
        [JsonProperty("borderFills")] public List<BorderFillModel> BorderFills = new List<BorderFillModel>();

        /// <summary>
        /// 문단 번호·글머리표 표. ★ 테두리와 같이 <b>번호가 1부터</b>라 0번 자리는 비어 있다
        /// (hwp <c>ParaHeadId</c>·hwpx <c>hh:numbering@id</c> 둘 다 1부터다 — 실측 2026-09-12).
        /// </summary>
        [JsonProperty("numberings")] public List<NumberingModel> Numberings = new List<NumberingModel>();
        [JsonProperty("bullets")] public List<BulletModel> Bullets = new List<BulletModel>();

        /// <summary>문서 스타일 표. ★ 이쪽은 <b>0부터</b>다(<see cref="StyleModel"/>).</summary>
        [JsonProperty("styles")] public List<StyleModel> Styles = new List<StyleModel>();

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

        /// <summary>
        /// 배치·인쇄가 쓰는 쪽 크기. ★ 가로 방향은 <b>용지 크기를 맞바꾸지 않는다</b> — 파일은 w·h 를
        /// 그대로 두고 플래그만 세우고, 맞바꾸는 것은 배치하는 쪽이다(실측 pagedefs.hwp: 가로 구역도
        /// w=59528 h=84188 인데 lineseg 폭이 84188−8504−8504=67180 이다).
        /// 화면 쪽 짝은 <c>hwPage.js</c> 의 <c>hwPageW</c>·<c>hwPageH</c> 다.
        /// </summary>
        [JsonIgnore] public long LayoutWHu { get { return Landscape ? HHu : WHu; } }
        [JsonIgnore] public long LayoutHHu { get { return Landscape ? WHu : HHu; } }

        /// <summary>본문이 실제로 흐르는 폭. lineseg 의 SegmentWidth 와 맞아야 한다.</summary>
        [JsonIgnore] public long TextWidthHu { get { return LayoutWHu - MlHu - MrHu - GutHu; } }

        /// <summary>본문이 실제로 흐르는 높이(머리말·꼬리말 띠를 뺀 값이 아니라 여백만 뺀 값).</summary>
        [JsonIgnore] public long TextHeightHu { get { return LayoutHHu - MtHu - MbHu; } }
    }

    public sealed class ColsModel
    {
        [JsonProperty("count")] public int Count = 1;
        [JsonProperty("gapHu")] public long GapHu;
    }

    public sealed class ParagraphModel
    {
        /// <summary>본문 <c>s{섹션}p{원본인덱스}</c>, 셀 내부·신규는 규칙.</summary>
        [JsonProperty("id")] public string Id;

        [JsonProperty("ps")] public int Ps;

        /// <summary>스타일 번호(0부터). hwp <c>ParaHeader.StyleId</c>·hwpx <c>hp:p@styleIDRef</c>.</summary>
        [JsonProperty("sty")] public int Sty;

        /// <summary>
        /// 이 문단 앞에서 강제로 나뉘는가. "page" | "column" | "section" | null.
        /// ★ 원본 <c>ParaHeader.DivideSort</c> 값이다 — 이걸 안 보면 쪽이 모자라고, 그 뒤 줄의 y 가
        ///   통째로 밀려 lineseg 대조가 의미를 잃는다 (실측 — aligns.hwp 가 2쪽인데 1쪽으로 나왔다).
        /// </summary>
        [JsonProperty("brk", NullValueHandling = NullValueHandling.Ignore)]
        public string Brk;

        [JsonProperty("runs")] public List<RunModel> Runs = new List<RunModel>();
        [JsonProperty("objs")] public List<InlineObjModel> Objs = new List<InlineObjModel>();

        /// <summary>
        /// lineseg 오라클. ★ 원본 문단에만 있다 — 편집으로 dirty 가 된 문단은 null 이다.
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

        /// <summary>★ 제어문자 없음. 탭은 "\t", 문단 내 줄바꿈은 "\n".</summary>
        [JsonProperty("text")] public string Text;
    }

    /// <summary>
    /// 문단 안에 박히는 개체. ★ pos 는 <b>편집 인덱스</b>다 — 원시 인덱스에서 확장 컨트롤이
    /// 8글자인 것을 1글자로 접은 좌표계.
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

        /// <summary>앞뒤 순서. 큰 값이 앞이다. 글자처럼 취급하는 개체에는 뜻이 없다.</summary>
        [JsonProperty("z")] public long Z;

        [JsonProperty("src", NullValueHandling = NullValueHandling.Ignore)] public string Src;

        /// <summary>opaque 일 때 원본 컨트롤 종류(eqed·secd 등)와 화면에 띄울 라벨.</summary>
        [JsonProperty("ctrl", NullValueHandling = NullValueHandling.Ignore)] public string Ctrl;
        [JsonProperty("label", NullValueHandling = NullValueHandling.Ignore)] public string Label;

        /// <summary>
        /// 하이퍼링크 주소(<c>ctrl</c> 이 "fldb"). hwp 명령 문자열 <c>http\://google.com;1;0;0;</c> 의
        /// <b>첫 조각</b>이다 — 둘째 조각(1)의 뜻은 표본으로 못 쟀다.
        /// </summary>
        [JsonProperty("link", NullValueHandling = NullValueHandling.Ignore)] public string Link;

        /// <summary>책갈피 이름(<c>ctrl</c> 이 "bookm").</summary>
        [JsonProperty("name", NullValueHandling = NullValueHandling.Ignore)] public string Name;

        /// <summary>개체 바깥 여백(HWPUNIT). 표 속성의 "바깥 여백" 이 이것이다.</summary>
        [JsonProperty("omLHu")] public long OmLHu;
        [JsonProperty("omRHu")] public long OmRHu;
        [JsonProperty("omTHu")] public long OmTHu;
        [JsonProperty("omBHu")] public long OmBHu;

        [JsonProperty("table", NullValueHandling = NullValueHandling.Ignore)] public TableModel Table;

        /// <summary>
        /// 머리말·꼬리말(<c>ctrl</c> 이 "head"·"foot")의 내용 문단. 표 칸과 <b>같은 규칙</b>으로
        /// 문단 id 를 매기고 인덱스에 넣는다 — 그래야 <c>replace</c> 로 고칠 수 있다.
        /// ★ 이 개체는 본문 흐름에서 <c>hidden</c>·<c>inline</c> 그대로다. 줄의 폭도 높이도 안 먹는다.
        /// </summary>
        [JsonProperty("paras", NullValueHandling = NullValueHandling.Ignore)] public List<ParagraphModel> Paras;

        /// <summary>머리말·꼬리말을 어느 쪽에 그리나: "both" | "odd" | "even".</summary>
        [JsonProperty("apply", NullValueHandling = NullValueHandling.Ignore)] public string Apply;

        /// <summary>
        /// 쪽 번호 위치(<c>ctrl</c> 이 "pgnp"). 0=없음 1~6=왼·가운데·오른 위/아래,
        /// 7=바깥 위 8=바깥 아래 9=안쪽 위 10=안쪽 아래(덤프 5-11, hwplibsharp <c>NumberPosition</c>).
        /// </summary>
        [JsonProperty("numPos", NullValueHandling = NullValueHandling.Ignore)] public int? NumPos;

        /// <summary>번호 모양(hwplibsharp <c>NumberShape</c>). 0=1,2,3 · 2=I,II · 3=i,ii · 4=A,B · 5=a,b.</summary>
        [JsonProperty("numShape", NullValueHandling = NullValueHandling.Ignore)] public int? NumShape;

        /// <summary>번호 앞뒤 줄표. 한글의 "줄표 넣기" 가 이 둘을 <c>-</c> 로 채운다.</summary>
        [JsonProperty("numBefore", NullValueHandling = NullValueHandling.Ignore)] public string NumBefore;
        [JsonProperty("numAfter", NullValueHandling = NullValueHandling.Ignore)] public string NumAfter;
    }

    public sealed class TableModel
    {
        [JsonProperty("rows")] public int Rows;
        [JsonProperty("cols")] public int Cols;

        /// <summary>표 전체가 가리키는 <see cref="BorderFillModel"/> 번호. 0 이면 없음.</summary>
        [JsonProperty("bf")] public int Bf;

        /// <summary>쪽 경계에서 0=나누지 않음 1=셀 단위로 나눔 2=나눔.</summary>
        [JsonProperty("divide")] public int Divide;

        /// <summary>제목 줄을 쪽마다 반복한다.</summary>
        [JsonProperty("repeatHeader")] public bool RepeatHeader;

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

        /// <summary>칸이 가리키는 <see cref="BorderFillModel"/> 번호. 0 이면 없음.</summary>
        [JsonProperty("bf")] public int Bf;

        /// <summary>세로 맞춤 0=위 1=가운데 2=아래(덤프 5-8).</summary>
        [JsonProperty("valign")] public int Valign;

        /// <summary>제목 칸(쪽마다 반복할 줄).</summary>
        [JsonProperty("head")] public bool Head;

        [JsonProperty("paras")] public List<ParagraphModel> Paras = new List<ParagraphModel>();
    }

    /// <summary>
    /// lineseg 한 줄. 필드 이름은 짧게 간다.
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
