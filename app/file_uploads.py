from fastapi import APIRouter, UploadFile, File, HTTPException
import pandas as pd
import fitz  # PyMuPDF

router = APIRouter(prefix="/upload", tags=["File Uploads"])

@router.post("/csv")
async def upload_csv(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")
    # Pandas can read from a file-like object
    df = pd.read_csv(file.file)
    return {"message": "CSV uploaded successfully", "rows": len(df), "columns": list(df.columns)}

@router.post("/pdf")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    # Read the uploaded file bytes (async) then open with PyMuPDF
    pdf_bytes = await file.read()
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    text = ""
    for page in doc:
        text += page.get_text()
    return {
        "message": "PDF uploaded successfully",
        "pages": len(doc),
        "preview": text[:500]
    }
