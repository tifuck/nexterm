# ============================================================================
# Nexterm — Multi-stage Docker Build
# ============================================================================
# Stage 1: Build the React frontend
# Stage 2: Python runtime with built frontend + backend
# ============================================================================

# -- Stage 1: Frontend build ----------------------------------------------
FROM node:20-alpine AS frontend-build

WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --silent

COPY frontend/ ./
RUN npx vite build


# -- Stage 2: Python runtime ----------------------------------------------
FROM python:3.12-slim AS runtime

# System dependencies for asyncssh / cryptography / bcrypt
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        gcc \
        libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd --create-home --shell /bin/bash nexterm

WORKDIR /app

# Install Python dependencies first (layer cache)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./backend/
COPY run.py ./
COPY config.example.yaml ./

# Copy built frontend from stage 1
COPY --from=frontend-build /build/frontend/dist ./frontend/dist/

# Copy entrypoint
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Create data and cert directories
RUN mkdir -p data certs \
    && chown -R nexterm:nexterm /app

USER nexterm

EXPOSE 8443

VOLUME ["/app/data", "/app/certs"]

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["python", "run.py"]
