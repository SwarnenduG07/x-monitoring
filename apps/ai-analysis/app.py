import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import dotenv
from router import ai_analysis, health, test
from utils.database import init_db_connection

# Load environment variables
dotenv.load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
)
logger = logging.getLogger(__name__)

# Initialize the FastAPI app
app = FastAPI(
    title="AI Analysis Service",
    description="Analyzes X posts using Gemini 1.5 Pro to make trading decisions",
    version="1.0.0",
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(ai_analysis.router, prefix="/api", tags=["ai-analysis"])
app.include_router(health.router, tags=["health"])
app.include_router(test.router, prefix="/api", tags=["test"])

@app.on_event("startup")
async def startup_event():
    """Run when the application starts"""
    logger.info("Starting AI Analysis Service...")
    
    db_success = init_db_connection()
    if db_success:
        logger.info("Database connection successful on startup")
    else:
        logger.warning("Database connection failed on startup - will retry on first request")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True) 