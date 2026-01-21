"""
LiveKit voice agent for VetKB — Architecture B.

Pipeline: Deepgram STT → RAG inject → GPT-4o-mini → OpenAI TTS
RAG: FastEmbed (local ONNX) → Qdrant (direct REST) → Backend (articles/prices)

Key design: RAG runs on every user turn via on_user_turn_completed,
injecting KB context BEFORE the LLM generates — no function-call roundtrip.
"""

import json
import logging
import os

from livekit import agents, rtc
from livekit.agents import AgentSession, Agent, ChatContext, ChatMessage, JobContext, cli
from livekit.plugins import deepgram, openai, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from rag import RAGService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("voice-agent")

SYSTEM_INSTRUCTIONS = """\
Ты — Анна, оператор колл-центра ветеринарной клиники «ЗооМедик». \
Клиент звонит тебе по телефону. Ты уже подняла трубку.

ИНФОРМАЦИЯ О КЛИНИКЕ:
Название: Ветеринарная клиника «ЗооМедик»
Адрес: г. Москва, ул. Ветеринарная, д. 12
Телефон: +7 (495) 123-45-67
Режим работы: ежедневно с 9:00 до 21:00, без выходных
Экстренный приём: круглосуточно (звонок по основному номеру)
Сайт: zoomedik.ru

Услуги: терапия, хирургия, вакцинация, стерилизация, УЗИ, рентген, стоматология, \
лабораторная диагностика, чипирование, груминг.
Виды животных: собаки, кошки, грызуны, птицы, рептилии.

СЦЕНАРИЙ РАЗГОВОРА:
1. ПРИВЕТСТВИЕ: Уже сделано автоматически.
2. ВЫЯВЛЕНИЕ ПОТРЕБНОСТИ: Выслушай клиента. Уточняющие вопросы: какое животное, какой возраст, что беспокоит.
3. ПОИСК ИНФОРМАЦИИ: Контекст из базы знаний подставляется автоматически перед каждым ответом.
4. ОТВЕТ: Перескажи найденную информацию простым языком. Назови цену, если есть. Уточни, что точная стоимость — после осмотра.
5. ЗАПИСЬ: Если клиент хочет записаться — уточни удобное время, имя и телефон. Скажи, что администратор перезвонит для подтверждения.
6. ПРОЩАНИЕ: «Будем ждать вас в ЗооМедик! Хорошего дня!»

ПРАВИЛА:
- Говори по-русски, кратко, дружелюбно. 2-3 предложения за раз — это телефонный разговор.
- Говори быстро и энергично, как настоящий оператор. Без длинных пауз.
- НЕ используй Markdown, списки, звёздочки — только устная речь.
- Отвечай ТОЛЬКО на основе предоставленного контекста из базы знаний. \
Если информации нет — скажи: «Одну секунду, уточню у коллег» или «Давайте я запишу ваш вопрос, и наш специалист перезвонит».
- НИКОГДА не говори «позвоните в клинику» или «обратитесь в ветклинику» — клиент УЖЕ звонит в клинику, ты и есть клиника.
- При срочных симптомах (рвота кровью, судороги, потеря сознания, отравление) — \
немедленно предложи экстренный приём: «Это может быть срочно. Приезжайте прямо сейчас, мы примем без записи».
- Цены из прайс-листа называй уверенно, добавляй: «Точная стоимость определяется на приёме после осмотра».
"""

TTS_INSTRUCTIONS = (
    "Говори быстро и естественно, как оператор колл-центра ветеринарной клиники. "
    "Будь дружелюбной и профессиональной. Темп речи — энергичный, без длинных пауз."
)


class VetClinicAgent(Agent):
    def __init__(self, rag: RAGService) -> None:
        super().__init__(instructions=SYSTEM_INSTRUCTIONS)
        self.rag = rag

    async def on_user_turn_completed(
        self, turn_ctx: ChatContext, new_message: ChatMessage,
    ) -> None:
        """RAG injection: search KB on every user turn, inject context before LLM."""
        text = new_message.text_content()
        if not text or len(text.strip()) < 3:
            return

        logger.info(f"[rag] searching for: {text[:100]}")
        result = await self.rag.search(text)

        if result.context:
            parts = []
            parts.append(f"Контекст из базы знаний:\n{result.context}")
            if result.price_info:
                parts.append(f"Цена из прайс-листа: {result.price_info}")

            turn_ctx.add_message(
                role="assistant",
                content="\n\n".join(parts),
            )
            logger.info(f"[rag] injected {len(result.context)} chars, sources={len(result.sources)}")

            # Send sources to frontend via data channel
            if result.sources:
                try:
                    room = self.session.room
                    if room and room.local_participant:
                        await room.local_participant.publish_data(
                            json.dumps({"type": "sources", "sources": result.sources}).encode(),
                            reliable=True,
                        )
                except Exception as e:
                    logger.warning(f"[rag] failed to send sources: {e}")


server = agents.AgentServer()


@server.rtc_session(agent_name="vet-clinic")
async def vet_clinic_agent(ctx: JobContext):
    await ctx.connect(auto_subscribe=agents.AutoSubscribe.AUDIO_ONLY)

    rag = RAGService()
    await rag.initialize()

    tts_voice = os.getenv("TTS_VOICE", "ash")
    tts_speed = float(os.getenv("TTS_SPEED", "1.15"))

    session = AgentSession(
        stt=deepgram.STT(
            model="nova-3",
            language="ru",
        ),
        llm=openai.LLM(
            model=os.getenv("LLM_MODEL", "gpt-4o-mini"),
            temperature=0.3,
        ),
        tts=openai.TTS(
            model=os.getenv("TTS_MODEL", "gpt-4o-mini-tts"),
            voice=tts_voice,
            speed=tts_speed,
            instructions=TTS_INSTRUCTIONS,
        ),
        vad=silero.VAD.load(),
        turn_detection=MultilingualModel(),
    )

    await session.start(
        room=ctx.room,
        agent=VetClinicAgent(rag),
    )

    # Auto-greet when client connects
    await session.generate_reply(
        instructions="Поприветствуй клиента: «Ветеринарная клиника ЗооМедик, оператор Анна, здравствуйте! Чем могу помочь?»"
    )


if __name__ == "__main__":
    cli.run_app(server)
