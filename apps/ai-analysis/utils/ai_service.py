import os
import json
import logging
import asyncio
from random import uniform
from typing import Dict, Any
import google.generativeai as genai
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_not_exception_type
from google.api_core.exceptions import ResourceExhausted
from .prompt import ANALYSIS_PROMPT_TEMPLATE, SIMPLE_BATCH_ANALYSIS_PROMPT_TEMPLATE

logger = logging.getLogger(__name__)

# Configure Gemini AI
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
gemini_model = genai.GenerativeModel(
    model_name="gemini-2.5-flash",
    generation_config={
        "temperature": 0.2,
        "top_p": 0.95,
        "top_k": 40,
    }
)

logger.info(f"using ai model {gemini_model.model_name}")

@retry(
    stop=stop_after_attempt(3), 
    wait=wait_exponential(multiplier=2, min=4, max=30),
    retry=retry_if_not_exception_type(ResourceExhausted)
)
async def analyze_with_gemini(post_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Analyze the post with Gemini API
    """
    token_symbols = ", ".join(post_data.get("tokenSymbols", [])) if post_data.get("tokenSymbols") else "Any cryptocurrency tokens"
    
    prompt = ANALYSIS_PROMPT_TEMPLATE.format(
        author_name=post_data.get("authorDisplayName") or post_data.get("authorUsername"),
        author_username=post_data.get("authorUsername"),
        post_text=post_data.get("postText"),
        timestamp=post_data.get("timestamp"),
        post_url=post_data.get("postUrl"),
        token_symbols=token_symbols
    )
    
    try:
        # Add jitter to reduce thundering herd
        await asyncio.sleep(uniform(0.1, 0.5))
        
        response = await gemini_model.generate_content_async(prompt)
        
        result = extract_json_from_response(response.text)
        
        # Validate required fields
        required_fields = ["sentimentScore", "confidence", "decision", "reasons"]
        for field in required_fields:
            if field not in result:
                raise ValueError(f"Missing required field: {field}")
        
        # Validate decision
        if result["decision"] not in ["buy", "sell", "hold"]:
            result["decision"] = "hold"
            
        # Validate reasons structure
        if not isinstance(result["reasons"], dict):
            result["reasons"] = {
                "positiveSignals": [],
                "negativeSignals": [],
                "neutralSignals": []
            }
            
        for signal_type in ["positiveSignals", "negativeSignals", "neutralSignals"]:
            if signal_type not in result["reasons"]:
                result["reasons"][signal_type] = []
        
        # Ensure tokens of interest are in marketConditions
        if post_data.get("tokenSymbols"):
            if "marketConditions" in result and "relatedTokens" in result["marketConditions"]:
                existing_tokens = {token["symbol"] for token in result["marketConditions"]["relatedTokens"]}
                
                # Add any missing tokens of interest with neutral sentiment
                for token in post_data["tokenSymbols"]:
                    if token not in existing_tokens:
                        if not result["marketConditions"]["relatedTokens"]:
                            result["marketConditions"]["relatedTokens"] = []
                        result["marketConditions"]["relatedTokens"].append({
                            "symbol": token,
                            "sentiment": 0,
                            "mentioned": False,
                            "impliedSentiment": "Token not explicitly mentioned in post"
                        })
            else:
                # Create marketConditions if it doesn't exist
                result["marketConditions"] = {
                    "overallMarketSentiment": "neutral",
                    "relatedTokens": [
                        {
                            "symbol": token,
                            "sentiment": 0,
                            "mentioned": False,
                            "impliedSentiment": "Token not explicitly mentioned in post"
                        } for token in post_data["tokenSymbols"]
                    ]
                }
                
        return result
        
    except Exception as e:
        logger.error(f"Error with Gemini API: {e}")
        raise e

@retry(
    stop=stop_after_attempt(3), 
    wait=wait_exponential(multiplier=2, min=4, max=30),
    retry=retry_if_not_exception_type(ResourceExhausted)
)
async def analyze_batch_with_gemini(posts_data: list, token_symbols: list) -> Dict[str, Any]:
    """
    Analyze multiple posts combined as one text with Gemini API in a single call
    """
    # Combine all posts into one text block
    combined_text = ""
    for i, post in enumerate(posts_data, 1):
        combined_text += f"Tweet {i}: {post.get('postText')} "
    
    token_symbols_str = ", ".join(token_symbols) if token_symbols else "Any cryptocurrency tokens"
    
    prompt = SIMPLE_BATCH_ANALYSIS_PROMPT_TEMPLATE.format(
        token_symbols=token_symbols_str,
        combined_posts_text=combined_text.strip()
    )
    
    try:
        # Add jitter to reduce thundering herd
        await asyncio.sleep(uniform(0.1, 0.5))
        
        response = await gemini_model.generate_content_async(prompt)
        
        result = extract_json_from_response(response.text)
        
        # Validate required fields
        required_fields = ["sentimentScore", "confidence", "decision", "reasons"]
        for field in required_fields:
            if field not in result:
                raise ValueError(f"Missing required field: {field}")
        
        # Validate decision
        if result["decision"] not in ["buy", "sell", "hold"]:
            result["decision"] = "hold"
            
        # Validate reasons structure
        if not isinstance(result["reasons"], dict):
            result["reasons"] = {
                "positiveSignals": [],
                "negativeSignals": [],
                "neutralSignals": []
            }
            
        for signal_type in ["positiveSignals", "negativeSignals", "neutralSignals"]:
            if signal_type not in result["reasons"]:
                result["reasons"][signal_type] = []
        
        # Ensure tokens of interest are in marketConditions
        if token_symbols:
            if "marketConditions" in result and "relatedTokens" in result["marketConditions"]:
                existing_tokens = {token["symbol"] for token in result["marketConditions"]["relatedTokens"]}
                
                # Add any missing tokens of interest with neutral sentiment
                for token in token_symbols:
                    if token not in existing_tokens:
                        if not result["marketConditions"]["relatedTokens"]:
                            result["marketConditions"]["relatedTokens"] = []
                        result["marketConditions"]["relatedTokens"].append({
                            "symbol": token,
                            "sentiment": 0,
                            "mentioned": False,
                            "impliedSentiment": "Token not explicitly mentioned in posts"
                        })
            else:
                # Create marketConditions if it doesn't exist
                result["marketConditions"] = {
                    "overallMarketSentiment": "neutral",
                    "relatedTokens": [
                        {
                            "symbol": token,
                            "sentiment": 0,
                            "mentioned": False,
                            "impliedSentiment": "Token not explicitly mentioned in posts"
                        } for token in token_symbols
                    ]
                }
                
        return result
        
    except Exception as e:
        logger.error(f"Error with Gemini API batch analysis: {e}")
        raise e

def check_gemini_api_key():
    """Check if Gemini API key is configured"""
    gemini_api_key = os.getenv("GEMINI_API_KEY")
    return bool(gemini_api_key), "API key not configured" if not gemini_api_key else None 

def extract_json_from_response(response_text: str) -> Dict[str, Any]:
    """Extract JSON from response text, handling potential markdown formatting"""
    text = response_text.strip()
    
    # Remove markdown code block formatting if present
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    
    if text.endswith("```"):
        text = text[:-3]
    
    text = text.strip()
    
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse JSON from response: {text[:200]}...")
        raise ValueError(f"Invalid JSON response from AI: {e}") 