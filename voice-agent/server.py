"""
Voice agent server: WebSocket ↔ SpeechKit STT + OpenAI TTS + Go backend RAG (SSE).

Browser sends PCM audio chunks over WebSocket.
SpeechKit STT (gRPC streaming with built-in VAD) transcribes in real-time.
On end-of-utterance → stream RAG response from Go backend via SSE.
Sentences are pipelined: TTS for sentence N runs while SSE buffers sentence N+1.
Supports barge-in: new speech cancels current response.
"""

import asyncio
import json
import logging
import os
import re

import aiohttp
import grpc

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# Proto imports (generated during Docker build, on PYTHONPATH)
from yandex.cloud.ai.stt.v3 import stt_pb2, stt_service_pb2_grpc

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice-agent")

# --- Config ---
YANDEX_API_KEY = os.getenv("YANDEX_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8080")
DEFAULT_COMPANY_ID = int(os.getenv("DEFAULT_COMPANY_ID", "1"))
TTS_VOICE = os.getenv("TTS_VOICE", "ash")
TTS_MODEL = os.getenv("TTS_MODEL", "gpt-4o-mini-tts")
TTS_SPEED = float(os.getenv("TTS_SPEED", "1.15"))
TTS_INSTRUCTIONS = os.getenv(
    "TTS_INSTRUCTIONS",
    "Говори быстро и естественно, как оператор колл-центра ветеринарной клиники. "
    "Будь дружелюбной и профессиональной. Темп речи — энергичный, без длинных пауз.",
)

STT_HOST = "stt.api.cloud.yandex.net:443"
SAMPLE_RATE_IN = 16000   # STT input
SAMPLE_RATE_OUT = 24000  # OpenAI TTS PCM output

RAG_STREAM_ENDPOINT = f"{BACKEND_URL}/api/agent/rag/stream"

app = FastAPI(title="Voice Agent")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Sentence splitting ---

def split_sentences(text: str) -> tuple[list[str], str]:
    """Split buffer into speakable chunks.
    First tries sentence boundaries (.!?), then clause boundaries (,;:—)
    for long accumulated text to reduce TTFA."""
    # Sentence boundaries
    parts = re.split(r'(?<=[.!?])\s+', text)
    if len(parts) > 1:
        return parts[:-1], parts[-1]

    # Clause boundaries for long text — don't wait forever for a period
    if len(text) > 50:
        parts = re.split(r'(?<=[,;:—])\s+', text)
        if len(parts) > 1 and len(parts[0]) >= 20:
            return parts[:-1], parts[-1]

    return [], text


def clean_for_tts(text: str) -> str:
    """Strip markdown formatting for TTS."""
    return re.sub(r"[*_#`\[\]()]", "", text).strip()


# --- RAG streaming ---

async def stream_rag(
    session: aiohttp.ClientSession,
    text: str,
    session_id: int,
    company_id: int | None,
    on_sentence,
) -> str:
    """Read SSE stream from Go backend, buffer into sentences, put into queue.
    Returns full response text."""
    payload = {"text": text, "session_id": session_id}
    if company_id is not None:
        payload["company_id"] = company_id

    buffer = ""
    full_response = ""

    async with session.post(
        RAG_STREAM_ENDPOINT,
        json=payload,
        timeout=aiohttp.ClientTimeout(total=120),
    ) as resp:
        if resp.status != 200:
            body = await resp.text()
            raise RuntimeError(f"RAG stream {resp.status}: {body}")

        async for raw_line in resp.content:
            line = raw_line.decode().strip()
            if not line.startswith("data:"):
                continue
            raw = line[5:].strip()
            try:
                data = json.loads(raw)
            except Exception:
                continue

            if "text" in data:
                buffer += data["text"]
                sentences, buffer = split_sentences(buffer)
                for sentence in sentences:
                    clean = clean_for_tts(sentence)
                    if clean:
                        full_response += sentence + " "
                        await on_sentence(clean)

    # Send remainder
    remainder = clean_for_tts(buffer)
    if remainder:
        full_response += buffer
        await on_sentence(remainder)

    return full_response.strip()


# --- TTS (OpenAI) — streaming response directly to WebSocket ---

async def synthesize_and_stream(
    session: aiohttp.ClientSession, text: str, ws: WebSocket
) -> None:
    """Call OpenAI TTS and stream PCM chunks directly to WebSocket."""
    body: dict = {
        "model": TTS_MODEL,
        "input": text,
        "voice": TTS_VOICE,
        "response_format": "pcm",
        "speed": TTS_SPEED,
    }
    if TTS_INSTRUCTIONS and TTS_MODEL.startswith("gpt-"):
        body["instructions"] = TTS_INSTRUCTIONS

    async with session.post(
        "https://api.openai.com/v1/audio/speech",
        headers={
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        },
        json=body,
    ) as resp:
        if resp.status != 200:
            err = await resp.text()
            logger.error(f"[tts] OpenAI error {resp.status}: {err[:200]}")
            return
        # Stream audio chunks as they arrive from OpenAI
        async for chunk in resp.content.iter_chunked(12000):  # ~250ms of 24kHz
            await ws.send_bytes(chunk)


# --- STT streaming session ---

class STTSession:
    """Manages a streaming STT gRPC session with SpeechKit."""

    def __init__(self):
        self._audio_queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._channel: grpc.Channel | None = None

    def push_audio(self, data: bytes):
        self._audio_queue.put_nowait(data)

    def stop(self):
        self._audio_queue.put_nowait(None)

    def _request_iterator(self):
        recognize_options = stt_pb2.StreamingOptions(
            recognition_model=stt_pb2.RecognitionModelOptions(
                audio_format=stt_pb2.AudioFormatOptions(
                    raw_audio=stt_pb2.RawAudio(
                        audio_encoding=stt_pb2.RawAudio.LINEAR16_PCM,
                        sample_rate_hertz=SAMPLE_RATE_IN,
                        audio_channel_count=1,
                    ),
                ),
                text_normalization=stt_pb2.TextNormalizationOptions(
                    text_normalization=stt_pb2.TextNormalizationOptions.TEXT_NORMALIZATION_ENABLED,
                    profanity_filter=False,
                    literature_text=False,
                ),
                language_restriction=stt_pb2.LanguageRestrictionOptions(
                    restriction_type=stt_pb2.LanguageRestrictionOptions.WHITELIST,
                    language_code=["ru-RU"],
                ),
                audio_processing_type=stt_pb2.RecognitionModelOptions.REAL_TIME,
            ),
        )
        yield stt_pb2.StreamingRequest(session_options=recognize_options)

        while True:
            data = self._sync_queue_get()
            if data is None:
                break
            yield stt_pb2.StreamingRequest(
                chunk=stt_pb2.AudioChunk(data=data)
            )

    def _sync_queue_get(self) -> bytes | None:
        loop = self._loop
        future = asyncio.run_coroutine_threadsafe(self._audio_queue.get(), loop)
        return future.result(timeout=30)

    async def run(self, on_partial=None, on_final=None, on_eou=None):
        self._loop = asyncio.get_event_loop()

        def _stream():
            creds = grpc.ssl_channel_credentials()
            self._channel = grpc.secure_channel(STT_HOST, creds)
            stub = stt_service_pb2_grpc.RecognizerStub(self._channel)
            metadata = [("authorization", f"Api-Key {YANDEX_API_KEY}")]

            try:
                responses = stub.RecognizeStreaming(
                    self._request_iterator(), metadata=metadata
                )
                for r in responses:
                    event_type = r.WhichOneof("Event")

                    if event_type == "partial" and r.partial.alternatives:
                        text = r.partial.alternatives[0].text
                        if text and on_partial:
                            asyncio.run_coroutine_threadsafe(
                                on_partial(text), self._loop
                            )

                    elif event_type == "final" and r.final.alternatives:
                        text = r.final.alternatives[0].text
                        if text and on_final:
                            asyncio.run_coroutine_threadsafe(
                                on_final(text), self._loop
                            )

                    elif event_type == "final_refinement":
                        alts = r.final_refinement.normalized_text.alternatives
                        if alts:
                            text = alts[0].text
                            if text and on_final:
                                asyncio.run_coroutine_threadsafe(
                                    on_final(text), self._loop
                                )

                    elif event_type == "eou_update":
                        if on_eou:
                            asyncio.run_coroutine_threadsafe(
                                on_eou(), self._loop
                            )

            except grpc.RpcError as e:
                logger.error(f"[stt] gRPC error: {e.code()} {e.details()}")
            finally:
                if self._channel:
                    self._channel.close()

        await asyncio.to_thread(_stream)

    def close(self):
        if self._channel:
            try:
                self._channel.close()
            except Exception:
                pass


# --- WebSocket handler ---

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    logger.info("WebSocket connected")

    session_id = 0
    accumulated_text = ""
    current_task: asyncio.Task | None = None

    stt = STTSession()

    async def on_partial(text: str):
        try:
            await ws.send_json({"type": "partial", "text": text})
        except Exception:
            pass

    async def on_final(text: str):
        nonlocal accumulated_text
        accumulated_text = text
        logger.info(f"[stt] final: {text}")
        try:
            await ws.send_json({"type": "transcript", "text": text})
        except Exception:
            pass

    async def process_utterance(text: str):
        """Pipeline: SSE RAG → sentence queue → TTS stream → WebSocket audio."""
        tts_task = None
        try:
            await ws.send_json({"type": "status", "status": "thinking"})

            sentence_queue: asyncio.Queue[str | None] = asyncio.Queue()
            first_audio_sent = False

            async with aiohttp.ClientSession() as http:
                # TTS consumer: takes sentences from queue, streams audio
                async def tts_consumer():
                    nonlocal first_audio_sent
                    while True:
                        sentence = await sentence_queue.get()
                        if sentence is None:
                            break
                        if not first_audio_sent:
                            await ws.send_json({"type": "status", "status": "speaking"})
                            first_audio_sent = True
                        await synthesize_and_stream(http, sentence, ws)

                tts_task = asyncio.create_task(tts_consumer())

                # Producer: read SSE stream, buffer sentences, push to queue
                full_response = await stream_rag(
                    http, text, session_id, DEFAULT_COMPANY_ID,
                    on_sentence=sentence_queue.put,
                )

                # Signal TTS consumer to finish
                await sentence_queue.put(None)
                await tts_task

            if full_response:
                await ws.send_json({"type": "response", "text": full_response})

            await ws.send_json({"type": "audio_end"})
            await ws.send_json({"type": "status", "status": "listening"})

        except asyncio.CancelledError:
            if tts_task and not tts_task.done():
                tts_task.cancel()
            logger.info("[process] cancelled (barge-in)")
        except Exception as e:
            if tts_task and not tts_task.done():
                tts_task.cancel()
            logger.error(f"[process] error: {e}")
            try:
                await ws.send_json({"type": "error", "message": str(e)})
                await ws.send_json({"type": "status", "status": "listening"})
            except Exception:
                pass

    async def on_eou():
        nonlocal accumulated_text, current_task
        text = accumulated_text.strip()
        accumulated_text = ""

        if not text:
            return

        # Barge-in: cancel current processing
        if current_task and not current_task.done():
            current_task.cancel()
            try:
                await ws.send_json({"type": "interrupt"})
            except Exception:
                pass

        logger.info(f"[eou] processing: {text}")
        current_task = asyncio.create_task(process_utterance(text))

    # Start STT stream in background
    stt_task = asyncio.create_task(
        stt.run(on_partial=on_partial, on_final=on_final, on_eou=on_eou)
    )

    try:
        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break
            if "text" in message:
                data = json.loads(message["text"])
                if data.get("type") == "config":
                    session_id = data.get("session_id", 0)
                    logger.info(f"Config: session_id={session_id}")
            elif "bytes" in message:
                stt.push_audio(message["bytes"])
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if current_task and not current_task.done():
            current_task.cancel()
        stt.stop()
        stt_task.cancel()
        stt.close()
        logger.info("Session cleaned up")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "7860"))
    uvicorn.run(app, host="0.0.0.0", port=port)
