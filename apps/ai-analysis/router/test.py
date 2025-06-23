from fastapi import APIRouter
import os
from google import genai
import dotenv
dotenv.load_dotenv()

router = APIRouter()

client = genai.Client(api_key=os.getenv("AIzaSyCpZ38Y0raOVNPon041lqxj6KDi3RLFNr8"))



@router.get("/test")
async def test():
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents="Explain how AI works in a few words",
    )
    return {"message": response.text}


