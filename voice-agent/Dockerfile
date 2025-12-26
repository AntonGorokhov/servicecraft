FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

# Clone Yandex Cloud API protos + Google API protos (needed for imports)
RUN git clone --depth 1 https://github.com/yandex-cloud/cloudapi /tmp/cloudapi && \
    git clone --depth 1 https://github.com/googleapis/googleapis /tmp/googleapis && \
    git clone --depth 1 https://github.com/grpc/grpc-proto /tmp/grpc-proto

COPY pyproject.toml .
RUN pip install --no-cache-dir .

# Generate proto stubs into /app/proto (added to PYTHONPATH)
RUN mkdir -p /app/proto && \
    find /tmp/cloudapi/yandex/cloud -name '*.proto' | xargs \
    python -m grpc_tools.protoc \
        -I/tmp/cloudapi \
        -I/tmp/googleapis \
        -I/tmp/grpc-proto \
        --python_out=/app/proto \
        --grpc_python_out=/app/proto \
    && rm -rf /tmp/cloudapi /tmp/googleapis /tmp/grpc-proto

# Create __init__.py for yandex package hierarchy (skip google — it's a pip namespace pkg)
RUN find /app/proto/yandex -type d -exec touch {}/__init__.py \;

ENV PYTHONPATH="/app/proto:${PYTHONPATH}"

COPY . .

EXPOSE 7860

CMD ["python", "server.py"]
