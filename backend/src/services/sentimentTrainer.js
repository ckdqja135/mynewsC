/**
 * Sentiment Trainer Service
 *
 * 임베딩 기반 감성 분류 학습 파이프라인:
 * 1. @xenova/transformers로 뉴럴 임베딩 생성 (한국어 지원)
 * 2. 임베딩 기반 제로샷 자동 라벨링 (또는 HF Inference API 폴백)
 * 3. 순수 JS 로지스틱 회귀로 분류기 학습
 * 4. JSON 파일 기반 데이터/모델 영속화
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ==================== Logistic Regression ====================

class LogisticRegression {
  constructor(inputDim, numClasses) {
    this.inputDim = inputDim;
    this.numClasses = numClasses;
    this.weights = Array.from({ length: inputDim }, () =>
      Array.from({ length: numClasses }, () => (Math.random() - 0.5) * 0.01)
    );
    this.bias = new Array(numClasses).fill(0);
  }

  _softmax(logits) {
    const max = Math.max(...logits);
    const exps = logits.map(l => Math.exp(l - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sum);
  }

  forward(x) {
    const logits = new Array(this.numClasses).fill(0);
    for (let j = 0; j < this.numClasses; j++) {
      for (let i = 0; i < this.inputDim; i++) {
        logits[j] += x[i] * this.weights[i][j];
      }
      logits[j] += this.bias[j];
    }
    return this._softmax(logits);
  }

  train(X, y, options = {}) {
    const { epochs = 200, lr = 0.1, batchSize = 32, lambda = 0.001 } = options;
    const n = X.length;

    for (let epoch = 0; epoch < epochs; epoch++) {
      // Shuffle
      const indices = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }

      for (let batchStart = 0; batchStart < n; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize, n);
        const batchIndices = indices.slice(batchStart, batchEnd);
        const batchLen = batchIndices.length;

        const gradW = Array.from({ length: this.inputDim }, () =>
          new Array(this.numClasses).fill(0)
        );
        const gradB = new Array(this.numClasses).fill(0);

        for (const idx of batchIndices) {
          const probs = this.forward(X[idx]);
          const label = y[idx];

          for (let j = 0; j < this.numClasses; j++) {
            const dz = probs[j] - (j === label ? 1 : 0);
            for (let i = 0; i < this.inputDim; i++) {
              gradW[i][j] += (dz * X[idx][i]) / batchLen;
            }
            gradB[j] += dz / batchLen;
          }
        }

        // Update with L2 regularization
        for (let i = 0; i < this.inputDim; i++) {
          for (let j = 0; j < this.numClasses; j++) {
            this.weights[i][j] -= lr * (gradW[i][j] + lambda * this.weights[i][j]);
          }
        }
        for (let j = 0; j < this.numClasses; j++) {
          this.bias[j] -= lr * gradB[j];
        }
      }
    }
  }

  predict(x) {
    const probs = this.forward(x);
    let maxIdx = 0;
    for (let i = 1; i < probs.length; i++) {
      if (probs[i] > probs[maxIdx]) maxIdx = i;
    }
    return { classIndex: maxIdx, probabilities: probs, confidence: probs[maxIdx] };
  }

  toJSON() {
    return {
      weights: this.weights,
      bias: this.bias,
      inputDim: this.inputDim,
      numClasses: this.numClasses,
    };
  }

  static fromJSON(json) {
    const model = new LogisticRegression(json.inputDim, json.numClasses);
    model.weights = json.weights;
    model.bias = json.bias;
    return model;
  }
}

// ==================== Sentiment Trainer ====================

class SentimentTrainer {
  constructor() {
    this.dataDir = path.join(__dirname, '..', '..', 'data', 'sentiment');
    this.labelsPath = path.join(this.dataDir, 'labeled_data.json');
    this.modelPath = path.join(this.dataDir, 'model_weights.json');

    this.labeledData = [];
    this.classifier = null;
    this.classes = ['positive', 'negative', 'neutral'];
    this.modelMetadata = null;

    // Lazy-loaded embedding pipeline
    this._pipeline = null;
    this._pipelineLoading = null;

    // HF Inference API
    this.hfApiUrl = 'https://api-inference.huggingface.co/models/alsgyu/sentiment-analysis-fine-tuned-model';

    // Ensure data directory
    fs.mkdirSync(this.dataDir, { recursive: true });

    // Load existing data
    this._loadLabeledData();
    this._loadModel();

    console.log(
      `[SentimentTrainer] Initialized. Labels: ${this.labeledData.length}, Model loaded: ${this.classifier !== null}`
    );
  }

  // ==================== Embedding Pipeline ====================

  async _getEmbeddingPipeline() {
    if (this._pipeline) return this._pipeline;

    // Prevent concurrent loading
    if (this._pipelineLoading) return this._pipelineLoading;

    this._pipelineLoading = (async () => {
      console.log('[SentimentTrainer] Loading embedding model (first time may take a while)...');
      const { pipeline } = await import('@xenova/transformers');
      this._pipeline = await pipeline(
        'feature-extraction',
        'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
      );
      console.log('[SentimentTrainer] Embedding model loaded successfully');
      this._pipelineLoading = null;
      return this._pipeline;
    })();

    return this._pipelineLoading;
  }

  /**
   * 텍스트 배열을 임베딩 벡터로 변환
   * @param {string[]} texts
   * @returns {Promise<number[][]>} 2D array of embeddings
   */
  async getEmbeddings(texts) {
    const pipe = await this._getEmbeddingPipeline();
    const embeddings = [];

    for (const text of texts) {
      const output = await pipe(text, { pooling: 'mean', normalize: true });
      embeddings.push(Array.from(output.data));
    }

    return embeddings;
  }

  // ==================== Data Persistence ====================

  _loadLabeledData() {
    try {
      if (fs.existsSync(this.labelsPath)) {
        const data = fs.readFileSync(this.labelsPath, 'utf-8');
        this.labeledData = JSON.parse(data);
      }
    } catch (err) {
      console.warn(`[SentimentTrainer] Failed to load labeled data: ${err.message}`);
      this.labeledData = [];
    }
  }

  _saveLabeledData() {
    try {
      fs.writeFileSync(this.labelsPath, JSON.stringify(this.labeledData, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[SentimentTrainer] Failed to save labeled data: ${err.message}`);
    }
  }

  _loadModel() {
    try {
      if (fs.existsSync(this.modelPath)) {
        const data = JSON.parse(fs.readFileSync(this.modelPath, 'utf-8'));
        this.classifier = LogisticRegression.fromJSON(data.model);
        this.classes = data.classes;
        this.modelMetadata = data.metadata;
      }
    } catch (err) {
      console.warn(`[SentimentTrainer] Failed to load model: ${err.message}`);
      this.classifier = null;
    }
  }

  _saveModel() {
    try {
      const data = {
        model: this.classifier.toJSON(),
        classes: this.classes,
        metadata: this.modelMetadata,
      };
      fs.writeFileSync(this.modelPath, JSON.stringify(data), 'utf-8');
    } catch (err) {
      console.error(`[SentimentTrainer] Failed to save model: ${err.message}`);
    }
  }

  // ==================== HF Label Mapping ====================

  _mapHfLabel(hfLabel) {
    const label = (hfLabel || '').toLowerCase().trim();

    // 한국어 라벨
    if (label.includes('긍정') || label === 'positive') return 'positive';
    if (label.includes('부정') || label === 'negative') return 'negative';
    if (label.includes('중립') || label === 'neutral') return 'neutral';

    // LABEL_X 형식 (KcBERT 기반 모델에서 흔함)
    if (label === 'label_0') return 'negative';
    if (label === 'label_1') return 'neutral';
    if (label === 'label_2') return 'positive';

    return 'neutral';
  }

  // ==================== Core Methods ====================

  /**
   * 수동 라벨 추가
   */
  addLabel(text, label, articleId = null) {
    if (!['positive', 'negative', 'neutral'].includes(label)) {
      throw new Error('Label must be positive, negative, or neutral');
    }

    const entry = {
      text,
      label,
      articleId,
      source: 'manual',
      createdAt: new Date().toISOString(),
    };

    this.labeledData.push(entry);
    this._saveLabeledData();

    return entry;
  }

  /**
   * 수동 라벨 일괄 추가
   */
  addLabels(items) {
    const results = [];
    for (const { text, label, articleId } of items) {
      results.push(this.addLabel(text, label, articleId));
    }
    return results;
  }

  /**
   * 코사인 유사도 계산
   */
  _cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * 임베딩 기반 제로샷 자동 라벨링
   * 텍스트 임베딩과 감성 설명 임베딩의 유사도로 분류
   */
  async autoLabel(texts, addToTrainingData = true) {
    // 감성별 다중 앵커 문장 (여러 표현의 임베딩 평균으로 정확도 향상)
    const labelAnchors = {
      positive: [
        '긍정적인 좋은 뉴스 호재 성과 달성',
        '주가 급등 사상 최고치 경신 성장',
        '수상 우승 쾌거 혁신 호실적 대박 흥행',
        '성공적인 결과 좋은 성과를 거두었다',
      ],
      negative: [
        '부정적인 나쁜 뉴스 악재 피해 손실',
        '사고 사망 폭발 리콜 결함 불량',
        '하락 급락 폭락 불황 실업 파산',
        '피해가 발생하여 심각한 문제가 되었다',
      ],
      neutral: [
        '중립적인 일반 보도 발표 현황 계획',
        '정부 정책 발표 회의 개최 논의',
        '기업 사업 계획 예정 진행 추진',
        '일반적인 뉴스 보도 내용이다',
      ],
    };

    console.log(`[SentimentTrainer] Auto-labeling ${texts.length} texts with zero-shot embeddings...`);

    // 라벨별 앵커 임베딩 생성 후 평균
    const labelKeys = Object.keys(labelAnchors);
    const labelEmbeddings = [];

    for (const key of labelKeys) {
      const anchors = labelAnchors[key];
      const anchorEmbeddings = await this.getEmbeddings(anchors);
      // 평균 임베딩
      const dim = anchorEmbeddings[0].length;
      const avg = new Array(dim).fill(0);
      for (const emb of anchorEmbeddings) {
        for (let d = 0; d < dim; d++) avg[d] += emb[d];
      }
      for (let d = 0; d < dim; d++) avg[d] /= anchorEmbeddings.length;
      // L2 정규화
      let norm = 0;
      for (let d = 0; d < dim; d++) norm += avg[d] * avg[d];
      norm = Math.sqrt(norm);
      if (norm > 0) for (let d = 0; d < dim; d++) avg[d] /= norm;
      labelEmbeddings.push(avg);
    }

    // 텍스트 임베딩 생성
    const textEmbeddings = await this.getEmbeddings(texts);

    const results = [];

    for (let i = 0; i < texts.length; i++) {
      // 각 라벨과의 유사도 계산
      const rawScores = [];
      for (let j = 0; j < labelKeys.length; j++) {
        rawScores.push(this._cosineSimilarity(textEmbeddings[i], labelEmbeddings[j]));
      }

      // Temperature-scaled softmax으로 확률 분포 생성
      const temperature = 0.1;
      const scaled = rawScores.map(s => Math.exp(s / temperature));
      const scaledSum = scaled.reduce((a, b) => a + b, 0);
      const probs = scaled.map(s => s / scaledSum);

      let maxIdx = 0;
      for (let j = 1; j < probs.length; j++) {
        if (probs[j] > probs[maxIdx]) maxIdx = j;
      }

      const scores = {};
      labelKeys.forEach((k, j) => { scores[k] = Math.round(probs[j] * 1000) / 1000; });

      const result = {
        text: texts[i],
        label: labelKeys[maxIdx],
        confidence: Math.round(probs[maxIdx] * 1000) / 1000,
        scores,
      };

      results.push(result);

      if (addToTrainingData) {
        this.labeledData.push({
          text: texts[i],
          label: result.label,
          articleId: null,
          source: 'auto',
          confidence: result.confidence,
          createdAt: new Date().toISOString(),
        });
      }
    }

    if (addToTrainingData) {
      this._saveLabeledData();
    }

    console.log(`[SentimentTrainer] Auto-labeling complete: ${results.length} texts`);
    return results;
  }

  /**
   * HuggingFace Inference API로 자동 라벨링 (대체 방식)
   * HF API가 사용 가능한 경우에만 동작
   */
  async autoLabelWithHfApi(texts, addToTrainingData = true) {
    const results = [];

    for (let i = 0; i < texts.length; i++) {
      try {
        const response = await axios.post(
          this.hfApiUrl,
          { inputs: texts[i] },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
          }
        );

        const predictions = Array.isArray(response.data[0]) ? response.data[0] : response.data;
        predictions.sort((a, b) => b.score - a.score);

        const topPrediction = predictions[0];
        const mappedLabel = this._mapHfLabel(topPrediction.label);

        results.push({
          text: texts[i],
          label: mappedLabel,
          confidence: topPrediction.score,
          rawLabel: topPrediction.label,
        });

        if (addToTrainingData) {
          this.labeledData.push({
            text: texts[i],
            label: mappedLabel,
            articleId: null,
            source: 'auto-hf',
            confidence: topPrediction.score,
            createdAt: new Date().toISOString(),
          });
        }

        if (i < texts.length - 1) {
          await new Promise(r => setTimeout(r, 100));
        }
      } catch (err) {
        console.error(`[SentimentTrainer] HF API failed for text ${i}: ${err.message}`);
        results.push({ text: texts[i], label: 'neutral', confidence: 0, error: err.message });
      }
    }

    if (addToTrainingData) {
      this._saveLabeledData();
    }

    return results;
  }

  /**
   * 분류기 학습
   */
  async train(options = {}) {
    const { modelType = 'logistic_regression', testSize = 0.2, epochs = 200, lr = 0.1 } = options;

    if (this.labeledData.length < 10) {
      throw new Error(`최소 10개의 라벨링 데이터가 필요합니다. 현재: ${this.labeledData.length}개`);
    }

    // Collect unique classes
    const labelSet = new Set(this.labeledData.map(d => d.label));
    if (labelSet.size < 2) {
      throw new Error(`최소 2개 이상의 클래스가 필요합니다. 현재: ${[...labelSet].join(', ')}`);
    }

    this.classes = [...labelSet].sort();
    const classToIdx = {};
    this.classes.forEach((cls, i) => { classToIdx[cls] = i; });

    console.log(`[SentimentTrainer] Generating embeddings for ${this.labeledData.length} texts...`);
    const texts = this.labeledData.map(d => d.text);
    const labels = this.labeledData.map(d => classToIdx[d.label]);
    const embeddings = await this.getEmbeddings(texts);

    console.log(`[SentimentTrainer] Embedding dimension: ${embeddings[0].length}`);

    // Train/test split
    const n = embeddings.length;
    const indices = Array.from({ length: n }, (_, i) => i);

    // Shuffle
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    const splitIdx = Math.floor(n * (1 - testSize));
    const trainIndices = indices.slice(0, splitIdx);
    const testIndices = indices.slice(splitIdx);

    const X_train = trainIndices.map(i => embeddings[i]);
    const y_train = trainIndices.map(i => labels[i]);
    const X_test = testIndices.map(i => embeddings[i]);
    const y_test = testIndices.map(i => labels[i]);

    console.log(`[SentimentTrainer] Training: ${X_train.length} samples, Testing: ${X_test.length} samples`);

    // Train
    const inputDim = embeddings[0].length;
    this.classifier = new LogisticRegression(inputDim, this.classes.length);
    this.classifier.train(X_train, y_train, { epochs, lr, lambda: 0.001 });

    // Evaluate
    let correct = 0;
    const perClass = {};
    this.classes.forEach(cls => {
      perClass[cls] = { tp: 0, fp: 0, fn: 0 };
    });

    for (let i = 0; i < X_test.length; i++) {
      const pred = this.classifier.predict(X_test[i]);
      const predLabel = this.classes[pred.classIndex];
      const trueLabel = this.classes[y_test[i]];

      if (predLabel === trueLabel) {
        correct++;
        perClass[trueLabel].tp++;
      } else {
        perClass[predLabel].fp++;
        perClass[trueLabel].fn++;
      }
    }

    const accuracy = X_test.length > 0 ? correct / X_test.length : 0;

    // Classification report
    const classificationReport = {};
    for (const cls of this.classes) {
      const { tp, fp, fn } = perClass[cls];
      const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
      const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
      const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
      classificationReport[cls] = {
        precision: Math.round(precision * 1000) / 1000,
        recall: Math.round(recall * 1000) / 1000,
        f1: Math.round(f1 * 1000) / 1000,
        support: tp + fn,
      };
    }

    // Label distribution
    const labelDistribution = {};
    this.labeledData.forEach(d => {
      labelDistribution[d.label] = (labelDistribution[d.label] || 0) + 1;
    });

    this.modelMetadata = {
      modelType,
      accuracy: Math.round(accuracy * 1000) / 1000,
      classes: this.classes,
      sampleCount: n,
      trainCount: X_train.length,
      testCount: X_test.length,
      embeddingDim: inputDim,
      labelDistribution,
      classificationReport,
      trainedAt: new Date().toISOString(),
    };

    // Save model
    this._saveModel();

    console.log(`[SentimentTrainer] Training complete. Accuracy: ${(accuracy * 100).toFixed(1)}%`);

    return {
      accuracy: this.modelMetadata.accuracy,
      classificationReport,
      sampleCount: n,
      modelType,
      labelDistribution,
    };
  }

  /**
   * 감성 예측
   */
  async predict(texts) {
    if (!this.classifier) {
      throw new Error('학습된 모델이 없습니다. /api/sentiment/train을 먼저 호출하세요.');
    }

    const embeddings = await this.getEmbeddings(texts);
    const results = [];

    for (let i = 0; i < texts.length; i++) {
      const pred = this.classifier.predict(embeddings[i]);
      const probabilities = {};
      this.classes.forEach((cls, j) => {
        probabilities[cls] = Math.round(pred.probabilities[j] * 1000) / 1000;
      });

      results.push({
        text: texts[i],
        label: this.classes[pred.classIndex],
        confidence: Math.round(pred.confidence * 1000) / 1000,
        probabilities,
      });
    }

    return results;
  }

  /**
   * 통계 조회
   */
  getStats() {
    const labelDistribution = {};
    const sourceDistribution = {};

    this.labeledData.forEach(d => {
      labelDistribution[d.label] = (labelDistribution[d.label] || 0) + 1;
      sourceDistribution[d.source] = (sourceDistribution[d.source] || 0) + 1;
    });

    return {
      totalLabels: this.labeledData.length,
      labelDistribution,
      sourceDistribution,
      modelTrained: this.classifier !== null,
      modelType: this.modelMetadata?.modelType || null,
      modelAccuracy: this.modelMetadata?.accuracy || null,
      lastTrainedAt: this.modelMetadata?.trainedAt || null,
      embeddingDim: this.modelMetadata?.embeddingDim || null,
      classes: this.classes,
    };
  }

  /**
   * 특정 라벨 데이터 삭제
   */
  removeLabel(index) {
    if (index < 0 || index >= this.labeledData.length) {
      throw new Error('Invalid index');
    }
    const removed = this.labeledData.splice(index, 1)[0];
    this._saveLabeledData();
    return removed;
  }

  /**
   * 자동 라벨링 데이터 전체 삭제
   */
  clearAutoLabels() {
    const before = this.labeledData.length;
    this.labeledData = this.labeledData.filter(d => d.source !== 'auto');
    this._saveLabeledData();
    return { removed: before - this.labeledData.length, remaining: this.labeledData.length };
  }
}

// Singleton
let _instance = null;

function getSentimentTrainer() {
  if (!_instance) {
    _instance = new SentimentTrainer();
  }
  return _instance;
}

module.exports = { SentimentTrainer, getSentimentTrainer };
