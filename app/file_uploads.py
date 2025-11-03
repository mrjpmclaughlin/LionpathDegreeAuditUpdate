from fastapi import APIRouter, UploadFile, File, HTTPException
import fitz  # PyMuPDF
import re
import pandas as pd
import os

router = APIRouter(prefix="/upload", tags=["File Uploads"])


#  File Paths & Course Equivalencies

CSV_PATH = os.path.join(os.path.dirname(__file__), "CmpscandEE.csv")

EQUIVALENT_COURSES = {
    "CMPSC 121": "CMPSC 131",
    "CMPSC 122": "CMPSC 132",
    "CMPSC 131": "CMPSC 121",
    "CMPSC 132": "CMPSC 122",
}


def apply_equivalencies(courses: set):
    expanded = set(courses)
    for c in list(courses):
        if c in EQUIVALENT_COURSES:
            expanded.add(EQUIVALENT_COURSES[c])
    return expanded


#  Load Degree CSV Data

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
                "Prescribed Courses": [c.strip().upper() for c in str(row["Prescribed Courses"]).split(",") if c.strip()],
                "Additional Courses": [c.strip().upper() for c in str(row["Additional Courses"]).split(",") if c.strip()],
                "Options": row["Options"].strip(),
                "General Option": [c.strip().upper() for c in str(row["General Option Courses"]).split(",") if c.strip()],
                "Data Science Option": [c.strip().upper() for c in str(row["Data Science Option Courses"]).split(",") if c.strip()],
            }

        return degree_data

    except FileNotFoundError:
        raise HTTPException(status_code=500, detail=f"CSV file not found: {CSV_PATH}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error loading CSV: {str(e)}")



#  Helper Functions

COURSE_CODE_RE = re.compile(r"\b([A-Z]{2,6})\s*(\d{2,3}[A-Z]?)\b")

def canon(code: str) -> str:
    """Normalize course codes like 'CMPSC131' → 'CMPSC 131'."""
    code = code.replace("/", " ").replace("-", " ").strip().upper()
    m = COURSE_CODE_RE.search(code)
    if not m:
        return ""
    subject, num = m.group(1), re.sub(r"[A-Z]$", "", m.group(2))
    return f"{subject} {num}"



#  PDF Extraction Logic

def extract_fields(text: str, degree_data):
    result = {}

    #  Detect major and option
    major_match = re.search(r"(Computer Science|Elementary|Early Childhood Education)", text, re.IGNORECASE)
    result["Major / Program"] = major_match.group(1).title() if major_match else "Not Found"

    option_match = re.search(r"(General Option|Data Science Option)", text, re.IGNORECASE)
    result["Detected Option"] = option_match.group(1).title() if option_match else "General Option"

    #  GPA
    gpa_match = re.search(r"Cum(?:ulative)? GPA:\s*([\d\.]+)", text)
    result["Cumulative GPA"] = gpa_match.group(1) if gpa_match else "Not Found"

    #  Extract course rows (Term, Subject, Number, Units, Grade)
    row_re = re.compile(
        r"""
        (?:FA|SP|SU)\s?\d{2,4}       # Term
        \s+([A-Z]{2,6})              # Subject
        \s+(\d{2,3}[A-Z]?)           # Course number
        .*?(\d+(?:\.\d+)?)\s+        # Units
        (A[+\-]?|B[+\-]?|C[+\-]?|D[+\-]?|F|IP|IN-PROGRESS|EN|TR|TE|P|S|U|W)
        """,
        re.IGNORECASE | re.VERBOSE,
    )

    ledger = {}
    for m in row_re.finditer(text):
        subj, num, units, grade = m.groups()
        code = canon(f"{subj} {num}")
        units = float(units)
        if not code or not (0.0 < units <= 6.0):
            continue
        status = "IP" if "IP" in grade or "PROGRESS" in grade else "COMP"
        ledger[code] = {"grade": grade.upper(), "units": units, "status": status}

    #  Detect “Courses Not Used” section
    not_used_pattern = re.compile(
        r"Courses not used to satisfy degree requirements[\s\S]*?(?=(?:Computer Science|Elementary|Early Childhood|Total|\Z))",
        re.IGNORECASE,
    )
    not_used_match = not_used_pattern.search(text)
    not_used_courses = []

    if not_used_match:
        block = not_used_match.group()

        row_pattern = re.compile(
            r"""
            (FA|SP|SU)\s*\d{4}
            [\s\n]+([A-Z]{2,6})
            [\s\n]+(\d{2,3}[A-Z]?)
            [\s\n]+(.+?)
            [\s\n]+(\d+(?:\.\d+)?)
            [\s\n]+([A-FIPW][+\-]?)
            """,
            re.IGNORECASE | re.VERBOSE | re.DOTALL,
        )

        for m in row_pattern.finditer(block):
            term, subj, num, title, units, grade = m.groups()
            code = canon(f"{subj} {num}")
            title = re.sub(r"\s+", " ", title.strip())
            not_used_courses.append({
                "code": code,
                "title": title,
                "units": float(units),
                "grade": grade.upper(),
            })

    result["Courses"] = {
        "Not Used": sorted([f"{c['code']} — {c['title']} ({c['units']} credits, {c['grade']})" for c in not_used_courses])
    }

    not_used_set = {c["code"] for c in not_used_courses}

    #  Compute credits excluding "Not Used"
    completed_credits = round(sum(v["units"] for c, v in ledger.items() if v["status"] == "COMP" and c not in not_used_set), 2)
    in_progress_credits = round(sum(v["units"] for c, v in ledger.items() if v["status"] == "IP" and c not in not_used_set), 2)

    #  Pull Total Units from Audit Summary (bottom of PDF)
    bottom_match = re.search(
        r"Units:\s*(\d+(?:\.\d+)?)\s*required,\s*(\d+(?:\.\d+)?)\s*used,\s*(\d+(?:\.\d+)?)\s*needed",
        text, re.IGNORECASE
    )
    if bottom_match:
        total_required = float(bottom_match.group(1))
        used_units = float(bottom_match.group(2))
        needed_units = float(bottom_match.group(3))
    else:
        # fallback to CSV value if summary line not found
        if "Computer Science" in result["Major / Program"]:
            total_required = 120.0
        else:
            total_required = 124.0
        used_units = completed_credits + in_progress_credits
        needed_units = max(total_required - used_units, 0.0)

    #  Degree structure matching
    if "Computer Science" in result["Major / Program"]:
        degree_key = "CMPAB_BS"
    else:
        degree_key = "CEAED_BS"

    deg = degree_data.get(degree_key, {})
    have_courses = apply_equivalencies(set(map(canon, ledger.keys())))

    pres = [canon(c) for c in deg.get("Prescribed Courses", [])]
    addl = [canon(c) for c in deg.get("Additional Courses", [])]
    opt_courses = [canon(c) for c in (
        deg.get("Data Science Option", []) if "Data Science" in result["Detected Option"] else deg.get("General Option", [])
    )]

    remaining = sorted(set([c for c in pres + addl + opt_courses if c and c not in have_courses]))

    #  Final listings
    taken = [f"{c} ({ledger[c]['units']} credits)" for c in ledger if ledger[c]["status"] == "COMP" and c not in not_used_set]
    in_progress = [f"{c} ({ledger[c]['units']} credits)" for c in ledger if ledger[c]["status"] == "IP" and c not in not_used_set]
    not_used_display = [f"{c['code']} — {c['title']} ({c['units']} credits, {c['grade']})" for c in not_used_courses]
    remaining_labeled = [f"{c}" for c in remaining]

    result["Courses"].update({
        "Taken": sorted(taken),
        "In Progress": sorted(in_progress),
        "Remaining": remaining_labeled,
        "Remaining_Note": "⚠️ Some courses listed may be optional or already satisfied."
    })

    result["Credits"] = {
        "Completed (Excluding Not Used)": completed_credits,
        "In Progress": in_progress_credits,
        "Not Used Credits": round(sum(c["units"] for c in not_used_courses), 2),
        "Used (from Audit)": used_units,
        "Remaining (from Audit)": needed_units,
        "Total Required": total_required,
        "Progress %": round((used_units / total_required) * 100, 1) if total_required else 0.0,
    }

    return result



#  FastAPI Upload Endpoint

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

