from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
INDEX_FILE = STATIC_DIR / "index.html"


def create_app() -> FastAPI:
    app = FastAPI(title="CleanSync API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    if STATIC_DIR.exists():
        app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    app.include_router(router)

    @app.get("/health")
    async def health_check():
        return {"status": "ok"}

    @app.get("/", include_in_schema=False)
    async def frontend():
        if INDEX_FILE.exists():
            return FileResponse(INDEX_FILE)
        return JSONResponse({"message": "CleanSync API"})

    @app.get("/admin", include_in_schema=False)
    async def admin_frontend():
        if INDEX_FILE.exists():
            return FileResponse(INDEX_FILE)
        return JSONResponse({"message": "CleanSync Admin"})

    return app


app = create_app()
