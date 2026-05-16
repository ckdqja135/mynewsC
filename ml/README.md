# ml

모델 학습 디렉토리.

## 설치

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # Windows
.venv/bin/pip install -r requirements.txt        # Linux/Mac
```

## 실행

```bash
./run.sh          # 학습 + ONNX 변환
./run.sh train    # 학습만
./run.sh export   # ONNX 변환만
```

결과:
- 학습된 모델: `models/sentiment/final/`
- ONNX: `models/sentiment/onnx/`
- 로그: `logs/train.log`, `logs/export.log` (10MB 단위 롤링, 백업 5개)
