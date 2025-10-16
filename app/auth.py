from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from . import models, database

router = APIRouter(prefix="/auth", tags=["Authentication"])

# DB dependency
def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

#  Schemas 
class UserCreate(BaseModel):
    username: str
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

#  Routes 
@router.post("/register")
def register_user(user: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.username == user.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    new_user = models.User(username=user.username, password=user.password)  # plaintext for now
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"message": "User created successfully"}

@router.post("/login")
def login_user(user: UserLogin, db: Session = Depends(get_db)):
    existing = db.query(models.User).filter(models.User.username == user.username).first()
    if not existing or existing.password != user.password:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return {"message": f"Welcome back, {user.username}!"}
