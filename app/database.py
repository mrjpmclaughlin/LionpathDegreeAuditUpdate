from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
import os

MYSQL_USER = "root"
MYSQL_PASSWORD = "xMJbpvWStHslJJirZNfPVwWcYHzLYEke"
MYSQL_HOST = "interchange.proxy.rlwy.net"
MYSQL_PORT = "31371"
MYSQL_DB = "railway"

SQLALCHEMY_DATABASE_URL = (
    f"mysql+pymysql://{MYSQL_USER}:{MYSQL_PASSWORD}@{MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DB}"
    "?charset=utf8mb4"
)

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=1800,
    echo=False,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, future=True)
Base = declarative_base()
