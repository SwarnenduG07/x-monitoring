import os
import json
import time
import uuid
import logging
import sys
from datetime import datetime
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import redis 
import dotenv

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

# Connect to Redis
redis_client = redis.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))

# Connect to PostgreSQL - Support for both psycopg2 and psycopg v3 based on Python version
if sys.version_info >= (3, 12):
    # For Python 3.12+ use psycopg v3
    import psycopg
    conn = psycopg.connect(os.getenv("DATABASE_URL", "postgresql://admin:password@localhost:5432/trading_bot"))
else:
    # For older Python versions use psycopg2
    import psycopg2
    from psycopg2.extras import RealDictCursor
    conn = psycopg2.connect(os.getenv("DATABASE_URL", "postgresql://admin:password@localhost:5432/trading_bot"))

# Initialize Gemini API
import google.generativeai as genai
from tenacity import retry, stop_after_attempt, wait_exponential

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
gemini_model = genai.GenerativeModel(
    model_name="gemini-1.5-pro",
    generation_config={
        "temperature": 0.2,
        "top_p": 0.95,
        "top_k": 40,
        "response_mime_type": "application/json",
    }
)

# Define data models
class AnalysisRequest(BaseModel):
    postId: int
    postText: str
    authorUsername: str
    authorDisplayName: Optional[str] = None
    postUrl: str
    timestamp: str

class AnalysisResponse(BaseModel):
    analysisId: int
    postId: int
    sentimentScore: float
    confidence: float
    decision: str
    reasons: Dict[str, List[str]]
    marketConditions: Optional[Dict[str, Any]] = None

# Gemini prompt for analysis
ANALYSIS_PROMPT_TEMPLATE = """
You are an AI trading advisor specialized in analyzing social media posts from crypto influencers.
Your task is to analyze the following post from X (formerly Twitter) and determine if it signals a good buying opportunity.

Post from {author_name} (@{author_username}):
"{post_text}"
Posted at: {timestamp}
URL: {post_url}

Provide your analysis in JSON format with the following structure:
{
  "sentimentScore": [number between -1 and 1, where 1 is very positive],
  "confidence": [number between 0 and 1, representing your confidence in this analysis],
  "decision": ["buy", "sell", or "hold"],
  "reasons": {
    "positiveSignals": [array of strings explaining positive signals in the post],
    "negativeSignals": [array of strings explaining negative signals or concerns],
    "neutralSignals": [array of strings explaining neutral or ambiguous signals]
  },
  "marketConditions": {
    "overallMarketSentiment": [string describing current market sentiment if mentioned],
    "relatedTokens": [
      {
        "symbol": [token symbol mentioned],
        "sentiment": [number between -1 and 1]
      }
    ]
  }
}

Use JSON mode to structure your response and provide a comprehensive analysis based solely on the content of the post.
Focus on clear buy/sell signals, token mentions, price predictions, and project evaluations.
Only include "marketConditions" if relevant information is present in the post.
Ensure your confidence score accurately reflects the strength of the signal.
"""

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
async def analyze_with_gemini(post_data: AnalysisRequest) -> Dict[str, Any]:
    """
    Analyze the post with Gemini API, with retry logic
    """
    prompt = ANALYSIS_PROMPT_TEMPLATE.format(
        author_name=post_data.authorDisplayName or post_data.authorUsername,
        author_username=post_data.authorUsername,
        post_text=post_data.postText,
        timestamp=post_data.timestamp,
        post_url=post_data.postUrl
    )
    
    response = await gemini_model.generate_content_async(prompt)
    
    try:
        # Parse the JSON response
        result = json.loads(response.text)
        
        # Validate required fields
        required_fields = ["sentimentScore", "confidence", "decision", "reasons"]
        for field in required_fields:
            if field not in result:
                raise ValueError(f"Missing required field: {field}")
        
        # Validate decision values
        if result["decision"] not in ["buy", "sell", "hold"]:
            result["decision"] = "hold"  # Default to hold if invalid
            
        # Ensure reasons object has all required arrays
        if not isinstance(result["reasons"], dict):
            result["reasons"] = {
                "positiveSignals": [],
                "negativeSignals": [],
                "neutralSignals": []
            }
            
        for signal_type in ["positiveSignals", "negativeSignals", "neutralSignals"]:
            if signal_type not in result["reasons"]:
                result["reasons"][signal_type] = []
                
        return result
    except Exception as e:
        logger.error(f"Error parsing Gemini response: {e}")
        logger.error(f"Raw response: {response.text}")
        raise HTTPException(status_code=500, detail=f"Error parsing AI response: {str(e)}")

async def save_analysis_result(analysis_data: Dict[str, Any], post_id: int) -> int:
    """
    Save the analysis result to the database
    """
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
        conn.rollback()
        logger.error(f"Database error: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

async def publish_analysis_result(analysis_result: Dict[str, Any]) -> None:
    """
    Publish the analysis result to Redis
    """
    try:
        message = {
            "topic": "analysis-result",
            "data": analysis_result,
            "timestamp": datetime.now().isoformat(),
            "messageId": str(uuid.uuid4())
        }
        redis_client.publish("analysis-result", json.dumps(message))
    except Exception as e:
        logger.error(f"Redis publish error: {e}")
        # Don't fail the request if publishing fails

async def process_analysis_request(post_data: AnalysisRequest) -> AnalysisResponse:
    """
    Process an analysis request from start to finish
    """
    start_time = time.time()
    
    try:
        # Get analysis from Gemini
        analysis_result = await analyze_with_gemini(post_data)
        
        # Save to database
        analysis_id = await save_analysis_result(analysis_result, post_data.postId)
        
        # Prepare response
        response = AnalysisResponse(
            analysisId=analysis_id,
            postId=post_data.postId,
            sentimentScore=analysis_result["sentimentScore"],
            confidence=analysis_result["confidence"],
            decision=analysis_result["decision"],
            reasons=analysis_result["reasons"],
            marketConditions=analysis_result.get("marketConditions")
        )
        
        # Publish result to Redis
        await publish_analysis_result(response.dict())
        
        logger.info(f"Analysis completed for post {post_data.postId}, decision: {response.decision}, confidence: {response.confidence}")
        
        return response
    except Exception as e:
        logger.error(f"Error processing analysis request: {e}")
        raise e
    finally:
        logger.debug(f"Processing completed in {time.time() - start_time:.2f}s")

@app.post("/api/analyze", response_model=AnalysisResponse)
async def analyze_post(post_data: AnalysisRequest):
    """
    Analyze a post from X and return the trading decision
    """
    logger.info(f"Received analysis request for post ID: {post_data.postId}")
    return await process_analysis_request(post_data)

@app.get("/health")
async def health_check():
    """
    Health check endpoint
    """
    # Check Redis connection
    try:
        redis_client.ping()
    except Exception as e:
        logger.error(f"Redis health check failed: {e}")
        raise HTTPException(status_code=500, detail="Redis connection failed")
        
    # Check database connection
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
        raise HTTPException(status_code=500, detail="Database connection failed")
        
    # Check Gemini API key is set
    if not os.getenv("GEMINI_API_KEY"):
        logger.error("Gemini API key not set")
        raise HTTPException(status_code=500, detail="Gemini API key not configured")
        
    return {"status": "healthy"}

# Setup Redis subscriber for new posts
def setup_redis_subscriber():
    """
    Setup Redis subscriber to listen for new posts
    """
    pubsub = redis_client.pubsub()
    pubsub.subscribe("new-post")
    
    logger.info("Redis subscriber started for 'new-post' channel")
    
    for message in pubsub.listen():
        if message["type"] == "message":
            try:
                data = json.loads(message["data"])
                post_data = AnalysisRequest(**data["data"])
                
                # Process the analysis as a background task
                # Note: In FastAPI context, we'd use BackgroundTasks but here we'll run directly
                import asyncio
                asyncio.create_task(process_analysis_request(post_data))
                
                logger.info(f"Received new post via Redis: {post_data.postId}")
            except Exception as e:
                logger.error(f"Error processing Redis message: {e}")

# Start the Redis subscriber in a background thread when the app starts
@app.on_event("startup")
async def startup_event():
    import threading
    threading.Thread(target=setup_redis_subscriber, daemon=True).start()
    logger.info("AI Analysis Service started")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True) 