"""
Voice agent relay: Browser WebSocket ↔ OpenAI Realtime API WebSocket.

Single-service voice-to-voice with native STT + LLM + TTS in one connection.
RAG context is provided via function calling → Go backend /api/agent/context.
On session start, pre-loads general KB context into instructions.
"""

import asyncio
import base64
import json
import logging
import os

import aiohttp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import websockets

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice-agent")

# --- Config ---
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8080")
DEFAULT_COMPANY_ID = int(os.getenv("DEFAULT_COMPANY_ID", "1"))
TTS_VOICE = os.getenv("TTS_VOICE", "ash")

REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview"
CONTEXT_ENDPOINT = f"{BACKEND_URL}/api/agent/context"

# --- Clinic identity (baked into every session) ---
CLINIC_INFO = """ИНФОРМАЦИЯ О КЛИНИКЕ:
Название: Ветеринарная клиника «ЗооМедик»
Адрес: г. Москва, ул. Ветеринарная, д. 12
Телефон: +7 (495) 123-45-67
Режим работы: ежедневно с 9:00 до 21:00, без выходных
Экстренный приём: круглосуточно (звонок по основному номеру)
Сайт: zoomedik.ru

Услуги: терапия, хирургия, вакцинация, стерилизация, УЗИ, рентген, стоматология, \
лабораторная диагностика, чипирование, груминг.
Виды животных: собаки, кошки, грызуны, птицы, рептилии."""

BASE_INSTRUCTIONS = """Ты — Анна, оператор колл-центра ветеринарной клиники «ЗооМедик». \
Клиент звонит тебе по телефону. Ты уже подняла трубку.

{clinic_info}

СЦЕНАРИЙ РАЗГОВОРА:
1. ПРИВЕТСТВИЕ: При первом обращении представься: «Ветеринарная клиника ЗооМедик, оператор Анна, здравствуйте! Чем могу помочь?»
2. ВЫЯВЛЕНИЕ ПОТРЕБНОСТИ: Выслушай клиента. Уточняющие вопросы: какое животное, какой возраст, что беспокоит.
3. ПОИСК ИНФОРМАЦИИ: Для ответов об услугах, ценах, процедурах — ОБЯЗАТЕЛЬНО вызови search_knowledge_base.
4. ОТВЕТ: Перескажи найденную информацию простым языком. Назови цену, если есть. Уточни, что точная стоимость — после осмотра.
5. ЗАПИСЬ: Если клиент хочет записаться — уточни удобное время, имя и телефон. Скажи, что администратор перезвонит для подтверждения.
6. ПРОЩАНИЕ: «Будем ждать вас в ЗооМедик! Хорошего дня!»

ПРАВИЛА:
- Говори по-русски, кратко, дружелюбно. 2-3 предложения за раз — это телефонный разговор.
- Говори быстро и энергично, как настоящий оператор. Без длинных пауз.
- НЕ используй Markdown, списки, звёздочки — только устная речь.
- Если информации нет в базе знаний — НЕ выдумывай. Скажи: «Одну секунду, уточню у коллег» или «Давайте я запишу ваш вопрос, и наш специалист перезвонит».
- НИКОГДА не говори «позвоните в клинику» или «обратитесь в ветклинику» — клиент УЖЕ звонит в клинику, ты и есть клиника.
- При срочных симптомах (рвота кровью, судороги, потеря сознания, отравление) — немедленно предложи экстренный приём: «Это может быть срочно. Приезжайте прямо сейчас, мы примем без записи».
- Цены из прайс-листа называй уверенно, добавляй: «Точная стоимость определяется на приёме после осмотра»."""

SEARCH_TOOL = {
    "type": "function",
    "name": "search_knowledge_base",
    "description": "Поиск в базе знаний клиники ЗооМедик: услуги, цены, процедуры, скрипты общения, FAQ. "
                   "Вызывай ПЕРЕД ответом на любой вопрос об услугах, ценах, процедурах, записи.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Поисковый запрос — что хочет узнать клиент"
            }
        },
        "required": ["query"],
    },
}

app = FastAPI(title="Voice Agent")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


async def call_context_api(http: aiohttp.ClientSession, query: str, company_id: int | None) -> dict:
    """Call Go backend /api/agent/context for RAG retrieval."""
    payload = {"query": query}
    if company_id is not None:
        payload["company_id"] = company_id

    try:
        async with http.post(
            CONTEXT_ENDPOINT,
            json=payload,
            timeout=aiohttp.ClientTimeout(total=5),
        ) as resp:
            if resp.status != 200:
                body = await resp.text()
                logger.error(f"[context] backend error {resp.status}: {body[:200]}")
                return {"context": "", "sources": [], "price_info": ""}
            return await resp.json()
    except Exception as e:
        logger.error(f"[context] request failed: {e}")
        return {"context": "", "sources": [], "price_info": ""}


def build_function_output(result: dict) -> str:
    """Format context API result as function call output string."""
    parts = []
    if result.get("context"):
        parts.append(result["context"])
    if result.get("price_info"):
        parts.append(f"\nЦена из прайс-листа: {result['price_info']}")
    if not parts:
        return "Информация не найдена в базе знаний. Предложи клиенту оставить контакт — специалист перезвонит."
    return "\n\n".join(parts)


async def build_session_instructions(http: aiohttp.ClientSession) -> str:
    """Build enriched instructions: base prompt + pre-loaded KB context."""
    instructions = BASE_INSTRUCTIONS.format(clinic_info=CLINIC_INFO)

    # Pre-load general clinic context from KB
    general_queries = [
        "приём записать на приём к ветеринару",
        "услуги и цены клиники",
    ]
    preloaded_parts = []
    for query in general_queries:
        result = await call_context_api(http, query, DEFAULT_COMPANY_ID)
        ctx = result.get("context", "")
        if ctx:
            preloaded_parts.append(ctx)

    if preloaded_parts:
        instructions += "\n\n--- БАЗОВЫЕ ЗНАНИЯ (используй в разговоре) ---\n\n"
        instructions += "\n\n---\n\n".join(preloaded_parts)

    return instructions


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    logger.info("Browser WebSocket connected")

    openai_ws = None
    http_session = None

    try:
        http_session = aiohttp.ClientSession()

        # Pre-load KB context for enriched instructions
        instructions = await build_session_instructions(http_session)
        logger.info(f"Instructions built: {len(instructions)} chars")

        # Connect to OpenAI Realtime API
        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "OpenAI-Beta": "realtime=v1",
        }
        openai_ws = await websockets.connect(REALTIME_URL, additional_headers=headers)
        logger.info("Connected to OpenAI Realtime API")

        # Configure session
        session_config = {
            "type": "session.update",
            "session": {
                "modalities": ["text", "audio"],
                "instructions": instructions,
                "voice": TTS_VOICE,
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
                "input_audio_transcription": {"model": "whisper-1"},
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.5,
                    "prefix_padding_ms": 300,
                    "silence_duration_ms": 500,
                },
                "tools": [SEARCH_TOOL],
                "tool_choice": "auto",
            },
        }
        await openai_ws.send(json.dumps(session_config))
        logger.info("Session configured")

        await ws.send_json({"type": "status", "status": "listening"})

        # --- Relay tasks ---

        async def browser_to_openai():
            """Forward browser audio/config to OpenAI Realtime API."""
            try:
                while True:
                    message = await ws.receive()
                    if message["type"] == "websocket.disconnect":
                        break

                    if "bytes" in message:
                        audio_b64 = base64.b64encode(message["bytes"]).decode("ascii")
                        await openai_ws.send(json.dumps({
                            "type": "input_audio_buffer.append",
                            "audio": audio_b64,
                        }))

                    elif "text" in message:
                        data = json.loads(message["text"])
                        if data.get("type") == "config":
                            logger.info(f"Config received: {data}")

            except WebSocketDisconnect:
                logger.info("Browser disconnected")
            except Exception as e:
                logger.error(f"[browser→openai] error: {e}")

        async def openai_to_browser():
            """Forward OpenAI Realtime events to browser."""
            try:
                async for raw_msg in openai_ws:
                    event = json.loads(raw_msg)
                    event_type = event.get("type", "")

                    if event_type == "response.audio.delta":
                        audio_bytes = base64.b64decode(event["delta"])
                        await ws.send_bytes(audio_bytes)

                    elif event_type == "response.audio.done":
                        await ws.send_json({"type": "audio_end"})

                    elif event_type == "response.audio_transcript.done":
                        transcript = event.get("transcript", "")
                        if transcript:
                            await ws.send_json({"type": "response", "text": transcript})

                    elif event_type == "conversation.item.input_audio_transcription.completed":
                        transcript = event.get("transcript", "")
                        if transcript:
                            await ws.send_json({"type": "transcript", "text": transcript})

                    elif event_type == "conversation.item.input_audio_transcription.failed":
                        logger.warning(f"[stt] transcription failed: {event.get('error', {})}")

                    elif event_type == "input_audio_buffer.speech_started":
                        await ws.send_json({"type": "interrupt"})
                        await ws.send_json({"type": "status", "status": "listening"})

                    elif event_type == "input_audio_buffer.speech_stopped":
                        await ws.send_json({"type": "status", "status": "thinking"})

                    elif event_type == "response.output_item.added":
                        item = event.get("item", {})
                        if item.get("type") == "message":
                            await ws.send_json({"type": "status", "status": "speaking"})

                    elif event_type == "response.done":
                        response = event.get("response", {})
                        if response.get("status") == "completed":
                            await ws.send_json({"type": "status", "status": "listening"})

                    elif event_type == "response.function_call_arguments.done":
                        call_id = event.get("call_id", "")
                        arguments = event.get("arguments", "{}")
                        name = event.get("name", "")

                        logger.info(f"[function_call] {name}: {arguments}")

                        if name == "search_knowledge_base":
                            try:
                                args = json.loads(arguments)
                                query = args.get("query", "")
                            except json.JSONDecodeError:
                                query = arguments

                            result = await call_context_api(
                                http_session, query, DEFAULT_COMPANY_ID
                            )
                            output = build_function_output(result)

                            logger.info(f"[function_call] context: {output[:200]}...")

                            sources = result.get("sources", [])
                            if sources:
                                await ws.send_json({"type": "sources", "sources": sources})

                            await openai_ws.send(json.dumps({
                                "type": "conversation.item.create",
                                "item": {
                                    "type": "function_call_output",
                                    "call_id": call_id,
                                    "output": output,
                                },
                            }))
                            await openai_ws.send(json.dumps({
                                "type": "response.create",
                            }))

                    elif event_type == "error":
                        error = event.get("error", {})
                        logger.error(f"[openai] error: {error}")
                        await ws.send_json({
                            "type": "error",
                            "message": error.get("message", "Unknown error"),
                        })

                    elif event_type == "session.created":
                        logger.info(f"[openai] session created: {event.get('session', {}).get('id', '')}")

                    elif event_type == "session.updated":
                        logger.info("[openai] session updated")

            except websockets.exceptions.ConnectionClosed:
                logger.info("OpenAI WebSocket closed")
            except Exception as e:
                logger.error(f"[openai→browser] error: {e}")

        # Run both relay directions concurrently
        browser_task = asyncio.create_task(browser_to_openai())
        openai_task = asyncio.create_task(openai_to_browser())

        done, pending = await asyncio.wait(
            [browser_task, openai_task],
            return_when=asyncio.FIRST_COMPLETED,
        )

        for task in pending:
            task.cancel()

    except Exception as e:
        logger.error(f"[session] error: {e}")
    finally:
        if openai_ws:
            await openai_ws.close()
        if http_session:
            await http_session.close()
        logger.info("Session cleaned up")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "7860"))
    uvicorn.run(app, host="0.0.0.0", port=port)
