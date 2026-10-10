import os

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://shoplite:shoplite@localhost:5432/shoplite")

pool = ConnectionPool(
    DATABASE_URL,
    min_size=1,
    max_size=int(os.getenv("DB_POOL_SIZE", "10")),
    kwargs={"row_factory": dict_row},
    open=False,
)


def open_pool():
    pool.open()
    pool.wait(timeout=60)  # waits for Postgres to accept connections (container start order)


def close_pool():
    pool.close()
