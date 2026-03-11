# Multi-stage Dockerfile for Gorgonetics
# Build stage for Python dependencies
FROM python:3.13-slim as python-builder
RUN pip install uv
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY src/ ./src/
RUN uv venv && uv sync --no-dev

# Frontend build stage  
FROM node:20-slim as frontend-builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install
COPY src/ ./src/
COPY vite.config.js vitest.config.js eslint.config.js svelte.config.js ./
RUN pnpm run build

# Runtime stage
FROM python:3.13-slim
# Create non-root user for security
RUN adduser --disabled-password --gecos '' --uid 1000 appuser

WORKDIR /app

# Copy Python virtual environment
COPY --from=python-builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# Copy built frontend assets
COPY --from=frontend-builder /app/build ./static/svelte/

# Copy Python source code
COPY src/ ./src/
COPY assets/ ./assets/

# Copy sample data files for demo pets
COPY data/Genes_SampleFaeBee.txt data/Genes_SampleHorse.txt ./data/

# Create directories for data persistence
RUN mkdir -p data && chown appuser:appuser data
RUN chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"

# Start the application (PORT env var supported for cloud platforms like Railway, Fly.io, Render)
CMD ["sh", "-c", "uvicorn gorgonetics.web_app:app --host 0.0.0.0 --port ${PORT:-8000}"]