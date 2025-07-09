import os
import sys
import json
import logging
from functools import wraps
import asyncio
from fastapi import HTTPException
import dotenv

dotenv.load_dotenv()

logger = logging.getLogger(__name__)

# Global database connection
conn = None

def get_db_connection():
    """Get database connection with fallback"""
    try:
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            logger.warning("DATABASE_URL not set, using fallback connection string")
            db_url = os.getenv("DATABASE_URL")
        
        logger.info(f"Connecting to database: {db_url.split('@')[1] if '@' in db_url else 'masked'}")
        
        if sys.version_info >= (3, 12):
            import psycopg
            return psycopg.connect(db_url)
        else:
            import psycopg2
            from psycopg2.extras import RealDictCursor
            return psycopg2.connect(db_url)
    except Exception as e:
        logger.error(f"Failed to connect to database: {e}")
        raise HTTPException(status_code=500, detail=f"Database connection failed: {str(e)}")

def init_db_connection():
    """Initialize database connection"""
    global conn
    try:
        conn = get_db_connection()
        logger.info("Successfully connected to database")
        return True
    except Exception as e:
        logger.error(f"Initial database connection failed: {e}")
        conn = None
        return False

def with_db_retry(max_retries=3):
    """Decorator to retry database operations"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            global conn
            retries = 0
            while retries < max_retries:
                try:
                    if conn is None:
                        conn = get_db_connection()
                    return await func(*args, **kwargs)
                except Exception as e:
                    retries += 1
                    logger.error(f"Database operation failed (attempt {retries}/{max_retries}): {e}")
                    
                    # Try to reconnect
                    try:
                        if conn:
                            conn.close()
                        conn = get_db_connection()
                    except Exception as conn_err:
                        logger.error(f"Failed to reconnect to database: {conn_err}")
                    
                    if retries >= max_retries:
                        raise
                    
                    # Wait before retrying
                    await asyncio.sleep(1 * retries)
            
            raise HTTPException(status_code=500, detail="Database operation failed after retries")
        return wrapper
    return decorator

@with_db_retry(max_retries=3)
async def save_analysis_result(analysis_data: dict, post_id: int) -> int:
    """Save the analysis result to the database with retry logic"""
    global conn
    try:
        # Handle both psycopg2 and psycopg v3
        if sys.version_info >= (3, 12):
            # psycopg v3
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO analysis_results 
                    (post_id, sentiment_score, confidence, decision, reasons, market_conditions)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        post_id,
                        analysis_data["sentimentScore"],
                        analysis_data["confidence"],
                        analysis_data["decision"],
                        json.dumps(analysis_data["reasons"]),
                        json.dumps(analysis_data.get("marketConditions", {})) if "marketConditions" in analysis_data else None
                    )
                )
                analysis_id = cursor.fetchone()[0]
                conn.commit()
                return analysis_id
        else:
            # psycopg2
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO analysis_results 
                    (post_id, sentiment_score, confidence, decision, reasons, market_conditions)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        post_id,
                        analysis_data["sentimentScore"],
                        analysis_data["confidence"],
                        analysis_data["decision"],
                        json.dumps(analysis_data["reasons"]),
                        json.dumps(analysis_data.get("marketConditions", {})) if "marketConditions" in analysis_data else None
                    )
                )
                analysis_id = cursor.fetchone()[0]
                conn.commit()
                return analysis_id
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except:
                pass
        logger.error(f"Database error: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

async def check_db_health():
    """Check database health"""
    global conn
    try:
        if conn is None:
            conn = get_db_connection()
            
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1")
        return True, None
    except Exception as e:
        return False, str(e) 