# Backend Dockerfile - 실행 환경만 제공
FROM python:3.11-slim

WORKDIR /app

# 시스템 의존성 설치
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Python 의존성만 먼저 설치 (캐싱 최적화)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 포트 노출
EXPOSE 8000

# 환경변수 설정
ENV PYTHONUNBUFFERED=1

# 애플리케이션 실행 (코드는 볼륨 마운트됨)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
