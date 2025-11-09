from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, index=True)
    password = Column(String(255))

    # Relationships
    courses = relationship("Course", back_populates="owner")


class Course(Base):
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(50), index=True)
    title = Column(String(255))
    credits = Column(Integer)
    status = Column(String(50), default="planned")  # completed / in-progress / planned
    user_id = Column(Integer, ForeignKey("users.id"))

    owner = relationship("User", back_populates="courses")
