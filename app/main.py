from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .auth import router as auth_router
from .file_uploads import router as file_router

app = FastAPI(title="Backend API - Degree Audit")

# CORS defaults for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(auth_router)
app.include_router(file_router)

@app.get("/")
def root():
    return {"message": "Backend API running successfully"}

@app.get("/home")
def home():
    return {"message": "Welcome to the Degree Audit backend"}
