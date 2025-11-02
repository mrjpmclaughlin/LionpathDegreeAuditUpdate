from fastapi import APIRouter, UploadFile, File, HTTPException
import fitz  # PyMuPDF
import re

router = APIRouter(prefix="/upload", tags=["File Uploads"])

def extract_fields(text: str):
    """Extract detailed degree audit data from Penn State LionPath report"""
    result = {}

    #  Core Fields 
    gpa_match = re.search(r"Cum GPA:\s*([\d\.]+)", text)
    sem_match = re.search(r"Level:\s*(\d+..*?Sem)", text)
    major_match = re.search(r"([A-Za-z\s\(\)]+)\s+Major\s+[A-Za-z]+\s+\d{4}", text)

    result["Cumulative GPA"] = gpa_match.group(1) if gpa_match else "Not Found"
    result["Semester"] = sem_match.group(1) if sem_match else "Not Found"
    result["Major / Program"] = major_match.group(1).strip() if major_match else "Not Found"

    #  Course Extraction 
    course_pattern = re.compile(
        r"(FA|SP)\s?\d{4}\s+([A-Z]{2,5})\s+(\d{2,3})\s+([A-Za-z&\s]+?)\s+([\d\.]+)\s+([A-Z\+\-]+|IP)"
    )

    taken, in_progress = [], []

    for match in course_pattern.findall(text):
        term, subject, number, title, units, grade = match
        course_code = f"{subject} {number}".strip()

        if grade.upper() == "IP":
            in_progress.append(course_code)
        else:
            taken.append(course_code)

    result["Courses"] = {
        "Taken": sorted(list(set(taken))),
        "In Progress": sorted(list(set(in_progress))),
    }

    #  Remaining Courses (based on "Still Needed"/"Not Satisfied") 
    remaining = re.findall(r"(?i)(?<=Not Satisfied: Complete the following).*?Course List: (.*?)\n", text)
    remaining_cleaned = []
    for block in remaining:
        remaining_cleaned.extend(re.findall(r"[A-Z]{2,5}\s+\d{3}", block))
    result["Courses"]["Remaining"] = sorted(list(set(remaining_cleaned))) or ["Not listed"]

    #  Summary
    summary = f"""
 Major/Program: {result['Major / Program']}
 Semester: {result['Semester']}
 Cumulative GPA: {result['Cumulative GPA']}

 Taken ({len(result['Courses']['Taken'])}): {', '.join(result['Courses']['Taken'][:10])}...
 In Progress ({len(result['Courses']['In Progress'])}): {', '.join(result['Courses']['In Progress'][:10])}...
 Remaining ({len(result['Courses']['Remaining'])}): {', '.join(result['Courses']['Remaining'][:10])}...
"""

    return result, summary.strip()


@router.post("/pdf")
async def upload_pdf(file: UploadFile = File(...)):
    """Uploads and parses a LionPath degree audit PDF"""
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a valid PDF file.")

    try:
        text = ""
        with fitz.open(stream=await file.read(), filetype="pdf") as doc:
            for page in doc:
                text += page.get_text("text")

        data, summary = extract_fields(text)

        return {
            "file_name": file.filename,
            "summary_text": summary,
            "structured_data": data
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing PDF: {str(e)}")
