import os
import json
import time
import logging
import sys
from datetime import datetime
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import dotenv
from functools import wraps
import asyncio

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

# Improved database connection handling
def get_db_connection():
    try:
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            logger.warning("DATABASE_URL not set, using fallback connection string")
            db_url = "postgresql://x-monitoring_owner:npg_fh9Ne2BmpcLQ@ep-ancient-smoke-a85mqy3p-pooler.eastus2.azure.neon.tech/x-monitoring?sslmode=require"
        
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

# Try to establish database connection
try:
    conn = get_db_connection()
    logger.info("Successfully connected to database")
except Exception as e:
    logger.error(f"Initial database connection failed: {e}")
    conn = None  # We'll retry connections later

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

class AnalysisRequest(BaseModel):
    postId: int
    postText: str
    authorUsername: str
    authorDisplayName: Optional[str] = None
    postUrl: str
    timestamp: str
    tokenSymbols: Optional[List[str]] = None

class AnalysisResponse(BaseModel):
    analysisId: int
    postId: int
    sentimentScore: float
    confidence: float
    decision: str
    reasons: Dict[str, List[str]]
    marketConditions: Optional[Dict[str, Any]] = None

ANALYSIS_PROMPT_TEMPLATE = """
You are an AI trading advisor specialized in analyzing social media posts from crypto influencers.
Your task is to analyze the following post from X (formerly Twitter) and determine if it signals a good buying opportunity for specific tokens.

Post from {author_name} (@{author_username}):
"{post_text}"
Posted at: {timestamp}
URL: {post_url}

TOKENS OF INTEREST: {token_symbols}

Please analyze this post with a focus on the TOKENS OF INTEREST listed above. Your analysis should determine:
1. Whether the post contains direct or indirect mentions of these tokens
2. If the sentiment towards these tokens is positive, negative, or neutral
3. Whether the post suggests a trading action (buy, sell, or hold)
4. How confident you are in your assessment

Provide your analysis in the following JSON format:
{{
  "sentimentScore": [number between -1 and 1, where 1 is very positive],
  "confidence": [number between 0 and 1, representing your confidence in this analysis],
  "decision": ["buy", "sell", or "hold"],
  "reasons": {{
    "positiveSignals": [array of strings explaining positive signals in the post],
    "negativeSignals": [array of strings explaining negative signals or concerns],
    "neutralSignals": [array of strings explaining neutral or ambiguous signals]
  }},
  "marketConditions": {{
    "overallMarketSentiment": [string describing current market sentiment if mentioned],
    "relatedTokens": [
      {{
        "symbol": [token symbol from TOKENS OF INTEREST],
        "sentiment": [number between -1 and 1],
        "mentioned": [boolean indicating if token was explicitly mentioned],
        "impliedSentiment": [string explanation of why this sentiment was assigned]
      }}
    ]
  }}
}}

IMPORTANT GUIDELINES:
- Focus ONLY on the specific TOKENS OF INTEREST provided
- If a token is not mentioned explicitly but could be affected by the content, indicate this in your analysis
- Assign higher confidence scores only when the post has clear signals about the tokens
- Default to "hold" with low confidence when there's insufficient information
- If the post mentions other tokens not in the TOKENS OF INTEREST list, only include them if they directly relate to our tokens of interest

Use JSON mode to structure your response and provide a comprehensive analysis based solely on the content of the post.
"""

@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
async def analyze_with_gemini(post_data: AnalysisRequest) -> Dict[str, Any]:
    """
    Analyze the post with Gemini API, with retry logic
    """
    token_symbols = ", ".join(post_data.tokenSymbols) if post_data.tokenSymbols else "Any cryptocurrency tokens"
    
    prompt = ANALYSIS_PROMPT_TEMPLATE.format(
        author_name=post_data.authorDisplayName or post_data.authorUsername,
        author_username=post_data.authorUsername,
        post_text=post_data.postText,
        timestamp=post_data.timestamp,
        post_url=post_data.postUrl,
        token_symbols=token_symbols
    )
    
    response = await gemini_model.generate_content_async(prompt)
    
    try:
        result = json.loads(response.text)
        
        required_fields = ["sentimentScore", "confidence", "decision", "reasons"]
        for field in required_fields:
            if field not in result:
                raise ValueError(f"Missing required field: {field}")
        
        if result["decision"] not in ["buy", "sell", "hold"]:
            result["decision"] = "hold"
            
        if not isinstance(result["reasons"], dict):
            result["reasons"] = {
                "positiveSignals": [],
                "negativeSignals": [],
                "neutralSignals": []
            }
            
        for signal_type in ["positiveSignals", "negativeSignals", "neutralSignals"]:
            if signal_type not in result["reasons"]:
                result["reasons"][signal_type] = []
        
        # If tokens of interest were provided, ensure they're in the marketConditions.relatedTokens
        if post_data.tokenSymbols and "marketConditions" in result and "relatedTokens" in result["marketConditions"]:
            existing_tokens = {token["symbol"] for token in result["marketConditions"]["relatedTokens"]}
            
            # Add any missing tokens of interest with neutral sentiment
            for token in post_data.tokenSymbols:
                if token not in existing_tokens:
                    if not result["marketConditions"]["relatedTokens"]:
                        result["marketConditions"]["relatedTokens"] = []
                    
                    result["marketConditions"]["relatedTokens"].append({
                        "symbol": token,
                        "sentiment": 0  # Neutral sentiment
                    })
        
        # If no marketConditions were provided but we have tokens of interest, create it
        elif post_data.tokenSymbols and ("marketConditions" not in result or "relatedTokens" not in result["marketConditions"]):
            if "marketConditions" not in result:
                result["marketConditions"] = {}
            
            result["marketConditions"]["relatedTokens"] = [
                {"symbol": token, "sentiment": 0} for token in post_data.tokenSymbols
            ]
                
        return result
    except Exception as e:
        logger.error(f"Error parsing Gemini response: {e}")
        logger.error(f"Raw response: {response.text}")
        raise HTTPException(status_code=500, detail=f"Error parsing AI response: {str(e)}")

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
async def save_analysis_result(analysis_data: Dict[str, Any], post_id: int) -> int:
    """
    Save the analysis result to the database with retry logic
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
        if conn:
            try:
                conn.rollback()
            except:
                pass
        logger.error(f"Database error: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

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
    Health check endpoint with improved diagnostics
    """
    status = {
        "database": "healthy",
        "gemini_api": "healthy",
        "overall": "healthy",
        "details": {}
    }
    
    # Check database connection
    try:
        global conn
        if conn is None:
            conn = get_db_connection()
            
        with conn.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception as e:
        status["database"] = "unhealthy"
        status["overall"] = "unhealthy"
        status["details"]["database_error"] = str(e)
        logger.error(f"Database health check failed: {e}")
    
    # Check Gemini API key
    gemini_api_key = os.getenv("GEMINI_API_KEY")
    if not gemini_api_key:
        status["gemini_api"] = "unhealthy"
        status["overall"] = "unhealthy"
        status["details"]["gemini_error"] = "API key not configured"
        logger.error("Gemini API key not set")
    
    if status["overall"] == "unhealthy":
        return status, 503  # Service Unavailable
    
    return status

@app.on_event("startup")
async def startup_event():
    """Run when the application starts"""
    global conn
    try:
        if conn is None:
            conn = get_db_connection()
        logger.info("Database connection successful on startup")
    except Exception as e:
        logger.error(f"Failed to connect to database on startup: {e}")
        # We don't raise an exception here, as we'll retry connections later

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True) 