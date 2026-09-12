using System.Collections.Generic;
using Newtonsoft.Json;

namespace HwpEditor.Models
{
    /// <summary>
    /// 저장 요청 하나. 편집마다 보내지 않고 <b>저장할 때</b> dirty 문단과 구조 변경만 모아 보낸다 —
    /// 편집마다 왕복하면 IME 조합 중 화면이 깨지고 모델이 두 벌이 된다.
    /// </summary>
    public sealed class SaveRequest
    {
        [JsonProperty("t")] public string T;
        [JsonProperty("rev")] public int Rev;
        [JsonProperty("saveAs")] public bool SaveAs;

        /// <summary>
        /// 화면이 들고 있는 <b>글자모양·문단모양 전체 목록</b>. 원본 뒤에 화면이 새로 만든 것이 붙어 있다.
        ///
        /// ★ 번호를 화면이 정하고 문서는 그대로 받는 구조가 아니다 — 문서에 이미 똑같은 모양이 있으면
        ///   그것을 다시 쓴다. 그래서 저장이 끝나면 번호가 바뀔 수 있고, 바뀐 번호는 응답으로 돌려준다.
        /// </summary>
        [JsonProperty("charShapes")] public List<CharShapeModel> CharShapes;
        [JsonProperty("paraShapes")] public List<ParaShapeModel> ParaShapes;

        /// <summary>
        /// 테두리/배경 표 전체. ★ <b>글자모양·문단모양보다 먼저</b> 등록해야 한다 — 문단모양과 칸이
        /// 이 번호를 가리키므로, 거꾸로 하면 아직 없는 번호를 가리킨다.
        /// </summary>
        [JsonProperty("borderFills")] public List<BorderFillModel> BorderFills;

        [JsonProperty("ops")] public List<EditOp> Ops = new List<EditOp>();
    }

    /// <summary>
    /// ★ 한 클래스로 다 받는다 — 계약이 화면(JS)과 여기 두 곳에만 있어서, 형을 나누면
    ///   JSON 이름이 세 곳(JS·기반형·파생형)으로 흩어진다.
    /// </summary>
    public sealed class EditOp
    {
        /// <summary>"replace" | "insertAfter" | "delete" | "addImage" | "cellFmt" | "tableFmt"</summary>
        [JsonProperty("op")] public string Op;

        /// <summary>대상 문단 id. insertAfter 면 <b>새로 붙일</b> 문단의 id 다.</summary>
        [JsonProperty("id")] public string Id;

        /// <summary>insertAfter 에서 이 문단 <b>뒤에</b> 붙인다. 원본 id 일 수도, 앞서 넣은 새 id 일 수도 있다.</summary>
        [JsonProperty("ref")] public string Ref;

        [JsonProperty("ps")] public int Ps;

        /// <summary>
        /// 이 문단 앞의 강제 나눔. "page" | "column" | "section" | null.
        /// ★ 안 보내면 문단을 나눌 때 <b>새 문단이 기준 문단의 쪽 나눔을 물려받는다</b> —
        ///   화면에는 나눔이 하나인데 파일에는 두 개가 된다.
        /// </summary>
        [JsonProperty("brk")] public string Brk;

        [JsonProperty("runs")] public List<RunModel> Runs;

        /// <summary>
        /// 문단 안 개체. ★ 원본 개체는 <c>oid</c> 만 온다 — 원본 Control 을 그대로 다시 쓰라는 뜻이다.
        /// 새 그림은 <c>tmpId</c> 가 붙고 별도의 addImage op 가 실물을 들고 온다.
        /// </summary>
        [JsonProperty("objs")] public List<EditObj> Objs;

        /// <summary>
        /// 화면이 계산한 줄 배치. ★ 이걸 안 받으면 저장본의 줄 정보가 비어 외부 변환기가 줄 0 으로 읽는다.
        /// </summary>
        [JsonProperty("seg")] public List<SegModel> Seg;

        #region addImage

        /// <summary>삽입 위치(편집 인덱스).</summary>
        [JsonProperty("pos")] public int Pos;

        /// <summary>표 구조를 바꾸는 요청(addRow·delRow·addCol·delCol)이 가리키는 표 개체.</summary>
        [JsonProperty("oid")] public string Oid;

        /// <summary>
        /// 행·열을 넣을 때 <b>본뜰</b> 행·열 번호. ★ Pos 로 대신 쓰면 안 된다 — 아래쪽에 넣을 때
        /// Pos 는 이미 밀린 자리라, 그것을 본뜨면 방금 넣으려는 빈 칸을 본뜨거나 표 밖을 가리킨다.
        /// </summary>
        [JsonProperty("from")] public int From = -1;

        /// <summary>
        /// 칸 사각형. mergeCells 는 네 값을 다 쓰고, sameWidth 는 <c>C0·C1</c>, sameHeight 는 <c>R0·R1</c>,
        /// splitCell 은 <c>R0·C0</c>(나눌 칸)만 쓴다. ★ 값은 <b>격자를 곱하기 전</b> 번호다.
        /// </summary>
        [JsonProperty("r0")] public int R0 = -1;
        [JsonProperty("c0")] public int C0 = -1;
        [JsonProperty("r1")] public int R1 = -1;
        [JsonProperty("c1")] public int C1 = -1;

        /// <summary>splitCell 이 나눌 줄·칸 수, addTable 이 만들 표 크기.</summary>
        [JsonProperty("rows")] public int Rows;
        [JsonProperty("cols")] public int Cols;

        /// <summary>
        /// addTable 이 만들 칸. ★ 칸 내용도 여기 실린다 — 새 표의 칸 문단은 문서 쪽 id 표에 없어서
        /// replace 로는 갈 수 없다(화면은 그 문단을 <c>_tblNew</c> 로 걸러 낸다).
        /// </summary>
        [JsonProperty("cells")] public List<CellModel> Cells;

        /// <summary>이 op 가 만드는 개체의 임시 id. 같은 저장 요청 안의 objs[].tmpId 와 맞춘다.</summary>
        [JsonProperty("tmpId")] public string TmpId;

        [JsonProperty("file")] public string File;

        [JsonProperty("wHu")] public long WHu;
        [JsonProperty("hHu")] public long HHu;

        #endregion

        #region cellFmt · tableFmt

        /// <summary>
        /// 칸·표 서식. ★ 전부 nullable 이다 — null 은 "안 바꿨다" 이지 0 이 아니다
        /// (<see cref="EditObj.WHu"/> 와 같은 이유: 화면은 고른 것만 싣는다).
        /// <c>cellFmt</c> 는 <see cref="R0"/>~<see cref="C1"/> 사각형의 칸에, <c>tableFmt</c> 는 표에 건다.
        /// ★ 둘 다 <b>구조를 안 바꾼다</b> — <see cref="SaveResult.Reload"/> 를 켜지 않는다.
        /// </summary>
        [JsonProperty("bf", NullValueHandling = NullValueHandling.Ignore)] public int? Bf;
        [JsonProperty("valign", NullValueHandling = NullValueHandling.Ignore)] public int? Valign;
        [JsonProperty("head", NullValueHandling = NullValueHandling.Ignore)] public bool? Head;

        [JsonProperty("cmL", NullValueHandling = NullValueHandling.Ignore)] public long? CmL;
        [JsonProperty("cmR", NullValueHandling = NullValueHandling.Ignore)] public long? CmR;
        [JsonProperty("cmT", NullValueHandling = NullValueHandling.Ignore)] public long? CmT;
        [JsonProperty("cmB", NullValueHandling = NullValueHandling.Ignore)] public long? CmB;

        [JsonProperty("divide", NullValueHandling = NullValueHandling.Ignore)] public int? Divide;
        [JsonProperty("repeatHeader", NullValueHandling = NullValueHandling.Ignore)] public bool? RepeatHeader;

        [JsonProperty("omL", NullValueHandling = NullValueHandling.Ignore)] public long? OmL;
        [JsonProperty("omR", NullValueHandling = NullValueHandling.Ignore)] public long? OmR;
        [JsonProperty("omT", NullValueHandling = NullValueHandling.Ignore)] public long? OmT;
        [JsonProperty("omB", NullValueHandling = NullValueHandling.Ignore)] public long? OmB;

        #endregion
    }

    /// <summary>replace·insertAfter 가 들고 오는 개체 자리. 실물은 원본이거나(oid) 새 그림이다(tmpId).</summary>
    public sealed class EditObj
    {
        [JsonProperty("pos")] public int Pos;
        [JsonProperty("oid")] public string Oid;
        [JsonProperty("tmpId")] public string TmpId;

        /// <summary>
        /// 화면에서 <b>실제로 옮기거나 크기를 바꾼</b> 개체의 값(HWPUNIT).
        ///
        /// ★ null 은 "안 바꿨다" 이지 0 이 아니다 — <b>반드시 nullable 이어야 한다</b>.
        ///   화면은 dirty 문단의 <b>모든</b> 개체에 대해 자리를 실어 보내고(hwModel.objRefs),
        ///   그중에는 안 보이는 용지 정의·단 정의도 들어 있다. 값형으로 두면 문단에 글자 하나만 쳐도
        ///   그 문단의 개체가 전부 크기 0 으로 덮인다.
        /// </summary>
        [JsonProperty("wHu", NullValueHandling = NullValueHandling.Ignore)] public long? WHu;
        [JsonProperty("hHu", NullValueHandling = NullValueHandling.Ignore)] public long? HHu;
        [JsonProperty("xOffHu", NullValueHandling = NullValueHandling.Ignore)] public long? XOffHu;
        [JsonProperty("yOffHu", NullValueHandling = NullValueHandling.Ignore)] public long? YOffHu;

        /// <summary>
        /// 글자처럼 취급하는가. null 이면 안 바꿨다.
        ///
        /// ★ 이 하나가 <b>네 가지 설정을 한 벌로</b> 움직인다 — hwp 는 <c>SetLikeWord</c>·
        ///   <c>SetTextFlowMethod</c>·<c>SetHorzRelTo</c>·<c>SetVertRelTo</c>, hwpx 는
        ///   <c>@treatAsChar</c> 와 그 이웃들이다. 하나만 어긋나면 저장은 되고 여는 쪽에서만 깨진다.
        /// </summary>
        [JsonProperty("inline", NullValueHandling = NullValueHandling.Ignore)] public bool? Inline;

        [JsonIgnore]
        public bool HasGeom
        {
            get { return WHu.HasValue || HHu.HasValue || XOffHu.HasValue || YOffHu.HasValue || Inline.HasValue; }
        }
    }

    /// <summary>저장 결과. 화면은 ok 를 보고 dirty 집합을 비운다.</summary>
    public sealed class SaveResult
    {
        [JsonProperty("ok")] public bool Ok;
        [JsonProperty("path")] public string Path;
        [JsonProperty("rev")] public int Rev;
        [JsonProperty("msg")] public string Msg;

        /// <summary>
        /// 저장하면서 문서 구조가 통째로 다시 세워졌다(표 행·열 변경). 화면은 이걸 보면 다시 읽어야 한다 —
        /// ★ 문단 객체가 전부 새것이라 화면이 들고 있던 id 표가 더는 안 맞는다.
        /// </summary>
        [JsonProperty("reload")] public bool Reload;

        /// <summary>
        /// 새로 만든 개체의 <c>tmpId → oid</c>. 화면은 이걸로 개체를 원본 개체로 바꿔 달아
        /// 다음 저장 때 같은 그림을 두 번 넣지 않는다.
        /// </summary>
        [JsonProperty("newOids")] public Dictionary<string, string> NewOids = new Dictionary<string, string>();

        /// <summary>
        /// 화면 번호 → 문서 번호. 화면은 이걸로 자기 runs 의 <c>cs</c> 와 문단의 <c>ps</c> 를 다시 매긴다.
        /// ★ 이 왕복이 없으면 같은 서식을 다시 적용할 때마다 모양이 하나씩 늘어난다.
        /// </summary>
        [JsonProperty("csMap", NullValueHandling = NullValueHandling.Ignore)] public int[] CsMap;
        [JsonProperty("psMap", NullValueHandling = NullValueHandling.Ignore)] public int[] PsMap;
        [JsonProperty("bfMap", NullValueHandling = NullValueHandling.Ignore)] public int[] BfMap;

        /// <summary>저장 뒤 문서가 실제로 들고 있는 목록. 화면은 자기 목록을 이것으로 갈아 끼운다.</summary>
        [JsonProperty("charShapes", NullValueHandling = NullValueHandling.Ignore)] public List<CharShapeModel> CharShapes;
        [JsonProperty("paraShapes", NullValueHandling = NullValueHandling.Ignore)] public List<ParaShapeModel> ParaShapes;
        [JsonProperty("borderFills", NullValueHandling = NullValueHandling.Ignore)] public List<BorderFillModel> BorderFills;
    }
}
