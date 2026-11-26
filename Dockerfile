FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Do not COPY uv.lock* so Cloud Build resolves from public PyPI
COPY pyproject.toml ./
RUN uv sync --no-dev

COPY server.py ./
COPY app/ ./app/
COPY static/ ./static/

ENV PORT=8080
EXPOSE 8080

CMD ["uv", "run", "--no-dev", "python", "server.py", "--host", "0.0.0.0"]
