import time
import logging
from fastapi import APIRouter, HTTPException
from utils.models import AnalysisRequest, AnalysisResponse
from utils.ai_service import analyze_with_gemini
from utils.database import save_analysis_result

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_post(post_data: AnalysisRequest):
    """
    Analyze a post from X and return the trading decision
    """
    start_time = time.time()
    
    try:
        logger.info(f"Received analysis request for post ID: {post_data.postId}")
        
        # Convert Pydantic model to dict for compatibility
        post_dict = {
            "postId": post_data.postId,
            "postText": post_data.postText,
            "authorUsername": post_data.authorUsername,
            "authorDisplayName": post_data.authorDisplayName,
            "postUrl": post_data.postUrl,
            "timestamp": post_data.timestamp,
            "tokenSymbols": post_data.tokenSymbols
        }
        
        # Get analysis from Gemini
        analysis_result = await analyze_with_gemini(post_dict)
        
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
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")
    finally:
        logger.debug(f"Processing completed in {time.time() - start_time:.2f}s")

