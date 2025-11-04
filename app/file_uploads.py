from fastapi import APIRouter, UploadFile, File, HTTPException
import fitz  # PyMuPDF
import re
import pandas as pd
import os

router = APIRouter(prefix="/upload", tags=["File Uploads"])


# File Paths & Course Equivalencies

CSV_PATH = os.path.join(os.path.dirname(__file__), "CmpscandEE.csv")

DIRECT_EQUIVS = {
    "CMPSC 121": {"CMPSC 131"},
    "CMPSC 131": {"CMPSC 121"},
    "CMPSC 122": {"CMPSC 132"},
    "CMPSC 132": {"CMPSC 122"},
}

COURSE_CODE_RE = re.compile(r"\b([A-Z]{2,6})\s*([0-9][0-9]?[0-9]?[A-Z]?)\b")

def canon(code: str) -> str:
    if not code:
        return ""
    s = code.replace("-", " ").upper().strip()
    m = COURSE_CODE_RE.search(s)
    if not m:
        return ""
    subj = m.group(1)
    raw = re.sub(r"\s+", "", m.group(2))
    return f"{subj} {raw}"

def variant_forms(c: str) -> set:
    base = canon(c)
    if not base:
        return set()
    subj, num = base.split()
    m = re.match(r"(\d{2,3})([A-Z]?)$", num)
    if not m:
        return {base}
    n, suf = m.group(1), m.group(2)
    out = {f"{subj} {n}"}
    if suf:
        out.add(f"{subj} {n}{suf}")
    else:
        out.add(f"{subj} {n}W")
        out.add(f"{subj} {n}H")
    return out

def expand_with_equivalents(codes: set) -> set:
    expanded = set()
    for c in codes:
        cc = canon(c)
        if not cc:
            continue
        expanded.add(cc)
        expanded |= variant_forms(cc)
        if cc in DIRECT_EQUIVS:
            expanded |= DIRECT_EQUIVS[cc]
            for e in list(DIRECT_EQUIVS[cc]):
                expanded |= variant_forms(e)
    return expanded



# Load Degree CSV Data

def load_degree_data():
    try:
        df = pd.read_csv(CSV_PATH, encoding="utf-8").fillna("")
        degree_data = {}
        for _, row in df.iterrows():
            code = row["Major Code"].strip()
            degree_data[code] = {
                "Major Name": row["Major Name"].strip(),
                "Total Credits Required": int(row["Total Credits Required"] or 120),
                "Credits for Major": int(row["Credits for Major"] or 0),
                "Credits for GenEd": int(row["Credits for General Education"] or 0),
                "Prescribed Courses": [canon(c) for c in str(row["Prescribed Courses"]).split(",") if c.strip()],
                "Additional Courses": [canon(c) for c in str(row["Additional Courses"]).split(",") if c.strip()],
                "Options": row["Options"].strip(),
                "General Option": [canon(c) for c in str(row["General Option Courses"]).split(",") if c.strip()],
                "Data Science Option": [canon(c) for c in str(row["Data Science Option Courses"]).split(",") if c.strip()],
            }
        return degree_data
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail=f"CSV file not found: {CSV_PATH}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading CSV: {str(e)}")



# Helpers for parsing totals

UNITS_LINE = re.compile(
    r"Units:\s*(?P<req>\d+(?:\.\d+)?)\s*required,\s*(?P<used>\d+(?:\.\d+)?)\s*used,\s*(?P<need>\d+(?:\.\d+)?)\s*needed",
    re.IGNORECASE,
)

def pick_degree_totals(full_text: str):
    total_blocks = list(re.finditer(r"Total units required for the degree", full_text, re.IGNORECASE))
    for tb in total_blocks:
        segment = full_text[tb.end(): tb.end() + 600]
        m = UNITS_LINE.search(segment)
        if m:
            req = float(m.group("req")); used = float(m.group("used")); need = float(m.group("need"))
            if 60.0 <= req <= 180.0:
                return req, used, need, "picked_from_total_degree_block"
    all_matches = list(UNITS_LINE.finditer(full_text))
    if all_matches:
        best = max(all_matches, key=lambda mm: float(mm.group("req")))
        req = float(best.group("req")); used = float(best.group("used")); need = float(best.group("need"))
        if 60.0 <= req <= 180.0:
            return req, used, need, "picked_largest_required"
    return None, None, None, "no_units_lines_found"



#  PDF Extraction Lgic

def extract_fields(text: str, degree_data):
    result = {}

    #  Major / Option / GPA
    major_match = re.search(r"(Computer Science|Elementary|Early Childhood Education)", text, re.IGNORECASE)
    result["Major / Program"] = major_match.group(1).title() if major_match else "Not Found"

    option_match = re.search(r"(General Option|Data Science Option)", text, re.IGNORECASE)
    option_selected = option_match.group(1).title() if option_match else "General Option"
    result["Detected Option"] = option_selected

    gpa_match = re.search(r"Cum(?:ulative)?\s*GPA:\s*([\d\.]+)", text, re.IGNORECASE)
    result["Cumulative GPA"] = gpa_match.group(1) if gpa_match else "Not Found"

    #  Ledger rows 
    row_re = re.compile(
        r"""
        (?P<term>(FA|SP|SU)\s*\d{2,4})
        [\s\n]+(?P<subj>[A-Z]{2,6})
        [\s\n]+(?P<num>[\d\s]{2,3}[A-Z]?)
        [\s\S]{0,120}?
        (?P<units>\d+(?:\.\d+)?)
        [\s\n]+(?P<grade>A[+\-]?|B[+\-]?|C[+\-]?|D[+\-]?|F|IP|IN-?PROGRESS|EN|TR|TE|P|S|U|W)
        """,
        re.IGNORECASE | re.VERBOSE,
    )

    ledger = {}
    for m in row_re.finditer(text):
        term = re.sub(r"\s+", " ", m.group("term").upper().strip())
        subj = m.group("subj").upper().strip()
        raw_num = re.sub(r"\s+", "", m.group("num").upper().strip())
        code = canon(f"{subj} {raw_num}")
        try:
            units = float(m.group("units"))
        except:
            continue
        grade = m.group("grade").upper().strip().replace("INPROGRESS", "IN-PROGRESS")
        if not code or not (0.0 < units <= 6.0):
            continue
        status = "IP" if ("IP" in grade or "PROGRESS" in grade) else "COMP"
        prev = ledger.get(code)
        if (prev is None) or (term > prev["term"]):
            ledger[code] = {"term": term, "units": units, "grade": grade, "status": status}

    
    #  Courses Not Used 
    
    not_used = []

    #   Anchor on the  heading 
    hdr = re.search(
        r"Courses\s+not\s+used\s+to\s+satisfy\s+degree\s+requirements.*?[\n\r]",
        text, re.IGNORECASE | re.DOTALL
    )
    if hdr:
        #  Grab everything after the heading until the next major section
        tail = text[hdr.end():]
        tail = re.split(r"\n\s*(Total|Computer Science|Elementary|Early Childhood|Cumulative GPA)", tail, 1)[0]

        # Row pattern ;Term  Subject  Num  Title(ignored)  Units  Grade
        row_re = re.compile(
            r"^\s*(?P<term>(FA|SP|SU)\d{2,4})\s+"
            r"(?P<subj>[A-Z]{2,6})\s+"
            r"(?P<num>\d{1,3}[A-Z]?)\s+"
            r".*?"                      # non-greedy anything (title)
            r"(?P<units>\d+(?:\.\d+)?)\s+"
            r"(?P<grade>[A-F][+-]?|IP|IN-PROGRESS|EN|TR|TE|P|S|U|W)\s*$",
            re.IGNORECASE | re.MULTILINE
        )

        seen = set()            # (code, term, units)
        for m in row_re.finditer(tail):
            code = canon(f"{m.group('subj')} {m.group('num')}")
            if not code:
                continue
            term = m.group("term").upper().strip()
            units = float(m.group("units"))
            grade = m.group("grade").upper().strip().replace("INPROGRESS", "IN-PROGRESS")
            key = (code, term, units)
            if key in seen:
                continue
            seen.add(key)
            not_used.append({
                "code": code,
                "term": term,
                "title": "",
                "units": units,
                "grade": grade,
            })

    not_used_set = {c["code"] for c in not_used}

    #  Build Taken / In Progress 
    taken_list, ip_list = [], []
    for code, info in ledger.items():
        if code in not_used_set:
            continue
        entry = {
            "code": code,
            "term": info["term"],
            "units": info["units"],
            "grade": info["grade"],
            "status": info["status"],
        }
        if info["status"] == "COMP":
            taken_list.append(entry)
        else:
            ip_list.append(entry)

    #  Credits (reverted calculation that was correct)
    completed_credits = round(sum(v["units"] for v in taken_list), 2)
    in_progress_credits = round(sum(v["units"] for v in ip_list), 2)
    used_units_from_ledger = completed_credits + in_progress_credits

    #  Totals from audit
    req, used, need, _ = pick_degree_totals(text)
    if req is not None:
        used_display = round(used, 2)
        remaining_display = round(need, 2)
        progress_display = round((used / req) * 100, 1)
        total_required = round(req, 2)
    else:
        total_required = 120.0 if "Computer Science" in result["Major / Program"] else 124.0
        used_display = round(used_units_from_ledger, 2)
        remaining_display = round(max(total_required - used_units_from_ledger, 0.0), 2)
        progress_display = round((used_units_from_ledger / total_required) * 100, 1)

    # Degree structure & remaining requirements
    degree_key = "CMPAB_BS" if "Computer Science" in result["Major / Program"] else "CEAED_BS"
    deg = degree_data.get(degree_key, {})
    have = expand_with_equivalents({e["code"] for e in taken_list} | {e["code"] for e in ip_list})

    req_blocks = []
    req_blocks += [c for c in deg.get("Prescribed Courses", []) if c]
    req_blocks += [c for c in deg.get("Additional Courses", []) if c]
    opt_list = deg.get("Data Science Option", []) if "Data Science" in option_selected else deg.get("General Option", [])
    req_blocks += [c for c in opt_list if c]

    remaining = []
    for raw in req_blocks:
        if not raw:
            continue
        group_parts = re.split(r"\s+or\s+", raw, flags=re.IGNORECASE)
        satisfied = False
        pending = []
        for g in group_parts:
            options = [canon(x) for x in re.split(r"[\/,]", g) if x.strip()]
            expanded_opts = set()
            for x in options:
                expanded_opts |= expand_with_equivalents({x})
            if expanded_opts & have:
                satisfied = True
                break
            else:
                pending.extend(options)
        if not satisfied:
            remaining.extend(pending)

    # Build structured output response
    result["Courses"] = {
        "Taken": sorted(taken_list, key=lambda x: x["term"]),
        "In Progress": sorted(ip_list, key=lambda x: x["term"]),
        "Not Used": sorted(not_used, key=lambda x: x["term"]),
        "Remaining": sorted(set(remaining)),
        "Remaining_Note": "⚠️ Some courses may belong to elective/GenEd categories and are flexible.",
    }

    result["Credits"] = {
        "Completed Credits": completed_credits,
        "In Progress Credits": in_progress_credits,
        "Not Used Credits": round(sum(c["units"] for c in not_used), 2),
        "Used Credits": used_display,
        "Remaining Credits": remaining_display,
        "Total Required": total_required,
        "Progress %": progress_display,
    }

    return result



# FastAPI Upload Endpoint

@router.post("/pdf")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a valid PDF file.")
    try:
        text = ""
        with fitz.open(stream=await file.read(), filetype="pdf") as doc:
            for page in doc:
                text += page.get_text("text")

        degree_data = load_degree_data()
        data = extract_fields(text, degree_data)

        return {
            "file_name": file.filename,
            "structured_data": data,
            "summary": f"{data['Major / Program']} | GPA: {data['Cumulative GPA']} | Progress: {data['Credits']['Progress %']}%"
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {str(e)}")
