FROM python:3.11-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends libglib2.0-0 libgstreamer1.0-0 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir .

COPY . .

EXPOSE 7860

# LiveKit agent worker — connects to LiveKit server and handles voice sessions
CMD ["python", "agent.py", "start"]
