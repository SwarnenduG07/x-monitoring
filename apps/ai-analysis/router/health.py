import logging
from fastapi import APIRouter
from utils.database import check_db_health
from utils.ai_service import check_gemini_api_key

router = APIRouter()
logger = logging.getLogger(__name__)

@router.get("/health")
async def health_check():
    """
    Health check endpoint with improved diagnostics
    """
    status = {
        "database": "healthy",
        "gemini_api": "healthy", 
        "overall": "healthy",
        "details": {}
    }
    
    # Check database connection
    db_healthy, db_error = await check_db_health()
    if not db_healthy:
        status["database"] = "unhealthy"
        status["overall"] = "degraded"
        status["details"]["database_error"] = db_error
        logger.error(f"Database health check failed: {db_error}")
    
    # Check Gemini API key
    gemini_healthy, gemini_error = check_gemini_api_key()
    if not gemini_healthy:
        status["gemini_api"] = "unhealthy"
        status["overall"] = "degraded"
        status["details"]["gemini_error"] = gemini_error
        logger.error("Gemini API key not set")
    
    # Only return 503 if we can't provide any service at all
    if status["database"] == "unhealthy" and status["gemini_api"] == "unhealthy":
        status["overall"] = "unhealthy"
        return status, 503  # Service Unavailable
    
    return status 