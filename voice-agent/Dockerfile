FROM python:3.11-slim

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir .

COPY . .

EXPOSE 7860

# LiveKit agent worker — connects to LiveKit server and handles voice sessions
CMD ["python", "agent.py", "start"]
