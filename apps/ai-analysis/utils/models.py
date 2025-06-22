from typing import Dict, Any, List, Optional
from pydantic import BaseModel

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

class SimpleBatchAnalysisRequest(BaseModel):
    posts: List[AnalysisRequest]
    tokenSymbols: List[str]

class SimpleBatchAnalysisResponse(BaseModel):
    sentimentScore: float
    confidence: float
    decision: str
    reasons: Dict[str, List[str]]
    marketConditions: Optional[Dict[str, Any]] = None 