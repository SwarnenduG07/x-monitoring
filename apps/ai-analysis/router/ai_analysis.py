import time
import logging
from fastapi import APIRouter, HTTPException
from utils.models import AnalysisRequest, AnalysisResponse, SimpleBatchAnalysisRequest, SimpleBatchAnalysisResponse
from utils.ai_service import analyze_with_gemini, analyze_batch_with_gemini
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

@router.post("/analyze-batch", response_model=SimpleBatchAnalysisResponse)
async def analyze_posts_batch(batch_data: SimpleBatchAnalysisRequest):
    """
    Analyze multiple posts combined as one text in a single API call to reduce rate limiting
    """
    start_time = time.time()
    
    try:
        logger.info(f"Received batch analysis request for {len(batch_data.posts)} posts")
        
        # Convert posts to the format expected by the AI service
        posts_data = []
        for post in batch_data.posts:
            posts_data.append({
                "postId": post.postId,
                "postText": post.postText,
                "authorUsername": post.authorUsername,
                "authorDisplayName": post.authorDisplayName,
                "postUrl": post.postUrl,
                "timestamp": post.timestamp,
                "tokenSymbols": post.tokenSymbols
            })
        
        # Get batch analysis from Gemini (combined text approach)
        batch_result = await analyze_batch_with_gemini(posts_data, batch_data.tokenSymbols)
        
        # Save the combined analysis to database (using first post ID as reference)
        first_post_id = posts_data[0]["postId"] if posts_data else 0
        analysis_id = await save_analysis_result(batch_result, first_post_id)
        
        # Create response object
        response = SimpleBatchAnalysisResponse(
            sentimentScore=batch_result["sentimentScore"],
            confidence=batch_result["confidence"],
            decision=batch_result["decision"],
            reasons=batch_result["reasons"],
            marketConditions=batch_result.get("marketConditions")
        )
        
        logger.info(f"Batch analysis completed for {len(posts_data)} posts, decision: {response.decision}")
        
        return response
        
    except Exception as e:
        logger.error(f"Error processing batch analysis request: {e}")
        raise HTTPException(status_code=500, detail=f"Batch analysis failed: {str(e)}")
    finally:
        logger.debug(f"Batch processing completed in {time.time() - start_time:.2f}s")

