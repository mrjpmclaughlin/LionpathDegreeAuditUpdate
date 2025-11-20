from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from . import models, database

router = APIRouter(prefix="/courses", tags=["Courses"])

# reuse DB pattern from auth.py
def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

# pydantic schemas 

class CourseBase(BaseModel):
    code: str
    title: str
    credits: int
    status: str = "planned"  # planned / in progress / completed

class CourseCreate(CourseBase):
    user_id: int  # which user this course belongs to

class CourseUpdate(BaseModel):
    title: Optional[str] = None
    credits: Optional[int] = None
    status: Optional[str] = None

class CourseOut(CourseBase):
    id: int
    user_id: int

    class Config:
        orm_mode = True

# routes

@router.get("/", response_model=List[CourseOut])
def list_courses(user_id: int, db: Session = Depends(get_db)):
    """Return all courses for a given user."""
    courses = (
        db.query(models.Course)
        .filter(models.Course.user_id == user_id)
        .order_by(models.Course.id)
        .all()
    )
    return courses

@router.post("/", response_model=CourseOut)
def create_course(course: CourseCreate, db: Session = Depends(get_db)):
    new_course = models.Course(
        code=course.code,
        title=course.title,
        credits=course.credits,
        status=course.status,
        user_id=course.user_id,
    )
    db.add(new_course)
    db.commit()
    db.refresh(new_course)
    return new_course

@router.patch("/{course_id}", response_model=CourseOut)
def update_course(course_id: int, update: CourseUpdate, db: Session = Depends(get_db)):
    course = db.query(models.Course).filter(models.Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # update only provided fields
    if update.title is not None:
        course.title = update.title
    if update.credits is not None:
        course.credits = update.credits
    if update.status is not None:
        course.status = update.status

    db.commit()
    db.refresh(course)
    return course

@router.delete("/{course_id}")
def delete_course(course_id: int, db: Session = Depends(get_db)):
    course = db.query(models.Course).filter(models.Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    db.delete(course)
    db.commit()
    return {"message": "Course deleted"}
