# Frontend Dockerfile - 실행 환경만 제공
FROM node:20-alpine

WORKDIR /app

# 의존성만 먼저 설치 (캐싱 최적화)
COPY package.json package-lock.json* ./
RUN npm ci

# 포트 노출
EXPOSE 3000

# 환경변수 설정
ENV NODE_ENV=development

# 개발 서버 실행 (코드는 볼륨 마운트됨)
CMD ["npm", "run", "dev"]
