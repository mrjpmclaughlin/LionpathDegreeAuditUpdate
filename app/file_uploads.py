from fastapi import APIRouter, UploadFile, File, HTTPException
import fitz  # PyMuPDF
import re
import pandas as pd
import os

router = APIRouter(prefix="/upload", tags=["File Uploads"])


# --- File Paths & Course Equivalencies ----------------------------------------------------------------------------------------------------

# CSV for containing degree/major requirements
CSV_PATH = os.path.join(os.path.dirname(__file__), "CmpscandEE.csv")

# Dictionary for direct course 
DIRECT_EQUIVS = {
    "CMPSC 121": {"CMPSC 131"},
    "CMPSC 131": {"CMPSC 121"},
    "CMPSC 122": {"CMPSC 132"},
    "CMPSC 132": {"CMPSC 122"},
}

# Regex to parse course codes like "CMPSC 121"
COURSE_CODE_RE = re.compile(r"\b([A-Z]{2,6})\s*([0-9][0-9]?[0-9]?[A-Z]?)\b")

# --- Course Code Normalization ------------------------------------------------------------------------------------------------------------

# Removes hyphens, extra spaces, and ensures uppercase
# 'CmpSc-121' -> 'CMPSC 121'
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

# Generate possible variants of code
# 'CMPSC 121' -> 'CMPSC 121', 'CMPSC 121W', 'CMPSC 121H', etc.
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

# Expand set of course codes to include variants 
# 'CMPSC 121' -> 'CMPSC 122', 'CMPSC 131', 'CMPSC 132', etc.
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



# --- Load Degree CSV Data ------------------------------------------------------------------------------------------------------------------

# Load degree requirements from CSV into dictionary
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



# --- Helpers for parsing totals --------------------------------------------------------------------------------------------------------------

# Regex designed to find line that summarizes degree credits
UNITS_LINE = re.compile(
    r"Units:\s*(?P<req>\d+(?:\.\d+)?)\s*required,\s*(?P<used>\d+(?:\.\d+)?)\s*used,\s*(?P<need>\d+(?:\.\d+)?)\s*needed",
    re.IGNORECASE,
)

# Exrtract total credits required, used, and remaining from PDF text.
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


# Year grouping helpers 
# Convert a term like 'FA 22'/'SP 2023' to a sortable pair where order is SP=0, SU=1, FA=2
def _parse_term(term: str):
    t = term.upper().strip()
    m = re.match(r"(FA|SP|SU)\s*(\d{2,4})", t)
    if not m:
        return (0, 0)
    s, y = m.group(1), m.group(2)
    year = int(y)
    if year < 100:
        year = 2000 + year
    order = {"SP": 0, "SU": 1, "FA": 2}[s]
    return (year, order)

# Compute 'Year N' index relative to the earliest detected term
def _year_index(term: str, start_term: str | None) -> int:
    if not start_term:
        return 1
    sy, so = _parse_term(start_term)
    ty, to = _parse_term(term)
    if sy == 0 or ty == 0:
        return 1
    start_idx = sy * 3 + so
    term_idx = ty * 3 + to
    delta = term_idx - start_idx
    if delta < 0:
        return 1
    return (delta // 3) + 1



# --- PDF Extraction ---------------------------------------------------------------------------------------------------------------------------------------

# Extracts data from PDF text string
# Returns dictionary of student info, courses, and credit summary
def extract_fields(text: str, degree_data):
    result = {}

    #  Students Name
    name_last_index = text.find(':')
    campus_index = text.find('Campus')
    if name_last_index < campus_index:
        student_name = text[0:name_last_index]
    else:
        student_name = '-Unknown-'
    result["Student Name"] = student_name

    #  Major / Option / GPA
    major_match = re.search(r"(Computer Science|Elementary|Early Childhood Education)", text, re.IGNORECASE)
    result["Major / Program"] = major_match.group(1).title() if major_match else "Not Found"

    option_match = re.search(r"(General Option|Data Science Option)", text, re.IGNORECASE)
    option_selected = option_match.group(1).title() if option_match else "General Option"
    result["Detected Option"] = option_selected

    gpa_match = re.search(r"Cum(?:ulative)?\s*GPA:\s*([\d\.]+)", text, re.IGNORECASE)
    result["Cumulative GPA"] = gpa_match.group(1) if gpa_match else "Not Found"

    #  Parse ledger rows (course history)
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

    # Find the main header
    hdr_main = re.search(
        r"courses?\s+not\s+used\s+to\s+satisfy\s+degree\s+requirements.*?(?:\r?\n)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if hdr_main:
        tail = text[hdr_main.end():]

        #  subheading "Courses Not Used"
        sub = re.search(r"^\s*Courses\s+Not\s+Used\s*$", tail, re.IGNORECASE | re.MULTILINE)
        if sub:
            tail = tail[sub.end():]

        # Stop before next major section
        stop_re = re.compile(
            r"(?im)^(Teacher\s+Education|Course\s+History|Total\s+Units\s+Earned|Page\s+\d+\s+of\s+\d+)"
        )
        mstop = stop_re.search(tail)
        if mstop:
            tail = tail[:mstop.start()]

        # Normalize line wraps: join lines that don't start with a term 
        lines = [ln.strip() for ln in tail.splitlines() if ln.strip()]
        merged_lines = []
        for ln in lines:
            if re.match(r"^(FA|SP|SU|WI)\s*\d{2,4}\b", ln):  # new course line
                merged_lines.append(ln)
            elif merged_lines:
                merged_lines[-1] += " " + ln  # continuation line

        merged_text = "\n".join(merged_lines)

        # Regex for course rows
        course_re = re.compile(
            r"""(?x)
            ^\s*
            (?P<term>(?:FA|SP|SU|WI)\s*\d{2,4})\s+
            (?P<subj>[A-Z&]{2,6})\s+
            (?P<num>\d{1,3}[A-Z]?)\s+
            (?P<title>.*?)\s+(?=\d+(?:\.\d+)?\s+[A-Z])
            (?P<units>\d+(?:\.\d+)?)\s+
            (?P<grade>[A-Z][+-]?|IP|LD|WD|W|IN|IN-?PROGRESS)\s*$
            """,
            re.MULTILINE,
        )

        seen = set()
        for m in course_re.finditer(merged_text):
            code = f"{m.group('subj')} {m.group('num')}".strip()
            term = m.group("term").strip()
            title = re.sub(r"\s+", " ", m.group("title").strip())
            print(title)
            try:
                units = float(m.group("units"))
            except:
                units = 0.0
            grade = m.group("grade").strip().upper()
            key = (code, term, units)
            if key in seen:
                continue
            seen.add(key)
            not_used.append(
                {"code": code, "term": term, "title": title, "units": units, "grade": grade}
            )

    not_used_set = {c["code"] for c in not_used}

    #  Auto-detect earliest start term for Year grouping 
    all_terms = [v["term"] for v in ledger.values()] + [c["term"] for c in not_used]
    def _idx(t: str) -> int:
        y, o = _parse_term(t)
        return y * 3 + o if y else 10**9
    start_term_auto = min(all_terms, key=_idx) if all_terms else None

    #  Build Taken / In Progress  (add 'year' field; leave everything else intact)
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
            "year": f"Year {_year_index(info['term'], start_term_auto)}",  # added
        }
        if info["status"] == "COMP":
            taken_list.append(entry)
        else:
            ip_list.append(entry)

    #  Credit Calculations
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
        "Remaining_Note": " Some courses may belong to elective/GenEd categories and are flexible.",
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



# --- FastAPI Upload Endpoint -------------------------------------------------------------------------------------------------------

# For retrieving and sending information to the front-end, App.js
# Returns student info, course history, credits, and a progress summary.
@router.post("/pdf")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a valid PDF file and Try Again.")
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
