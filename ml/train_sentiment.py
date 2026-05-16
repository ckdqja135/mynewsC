import argparse
import json
import random
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from datasets import Dataset
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import train_test_split
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    DataCollatorWithPadding,
    Trainer,
    TrainingArguments,
)

from logger import setup_logging

log = setup_logging("train")

ROOT = Path(__file__).resolve().parent
LABELED_DATA = ROOT.parent / "backend" / "data" / "sentiment" / "labeled_data.json"
OUTPUT_DIR = ROOT / "models" / "sentiment"

LABELS = ["negative", "neutral", "positive"]
LABEL2ID = {label: idx for idx, label in enumerate(LABELS)}
ID2LABEL = {idx: label for idx, label in enumerate(LABELS)}


def load_data():
    with open(LABELED_DATA, "r", encoding="utf-8") as f:
        raw = json.load(f)
    records = [r for r in raw if r.get("label") in LABEL2ID and r.get("text")]
    texts = [r["text"] for r in records]
    labels = [LABEL2ID[r["label"]] for r in records]
    return texts, labels


def compute_metrics(eval_pred):
    logits, labels = eval_pred
    preds = np.argmax(logits, axis=-1)
    return {
        "accuracy": accuracy_score(labels, preds),
        "f1_macro": f1_score(labels, preds, average="macro"),
    }


def oversample(texts, labels, seed=42):
    rng = random.Random(seed)
    counts = Counter(labels)
    target = max(counts.values())

    out_texts, out_labels = [], []
    for label_id in sorted(counts.keys()):
        indices = [i for i, l in enumerate(labels) if l == label_id]
        if not indices:
            continue
        repeats = target // len(indices)
        remainder = target - repeats * len(indices)
        sampled = indices * repeats + rng.sample(indices, remainder)
        for idx in sampled:
            out_texts.append(texts[idx])
            out_labels.append(labels[idx])

    combined = list(zip(out_texts, out_labels))
    rng.shuffle(combined)
    return [t for t, _ in combined], [l for _, l in combined]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="klue/roberta-base")
    parser.add_argument("--epochs", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--max-length", type=int, default=128)
    parser.add_argument("--val-size", type=float, default=0.1)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    log.info(f"Loading data from {LABELED_DATA}")
    texts, labels = load_data()
    log.info(f"Loaded {len(texts)} samples")

    counts = {label: labels.count(idx) for label, idx in LABEL2ID.items()}
    log.info(f"Label distribution: {counts}")

    train_texts, val_texts, train_labels, val_labels = train_test_split(
        texts,
        labels,
        test_size=args.val_size,
        stratify=labels,
        random_state=args.seed,
    )

    train_texts, train_labels = oversample(train_texts, train_labels, seed=args.seed)
    oversampled_counts = {
        label: train_labels.count(idx) for label, idx in LABEL2ID.items()
    }
    log.info(f"Oversampled train distribution: {oversampled_counts}")

    tokenizer = AutoTokenizer.from_pretrained(args.model)

    def tokenize(batch):
        return tokenizer(batch["text"], truncation=True, max_length=args.max_length)

    train_ds = Dataset.from_dict(
        {"text": train_texts, "labels": train_labels}
    ).map(tokenize, batched=True)
    val_ds = Dataset.from_dict(
        {"text": val_texts, "labels": val_labels}
    ).map(tokenize, batched=True)

    model = AutoModelForSequenceClassification.from_pretrained(
        args.model,
        num_labels=len(LABELS),
        id2label=ID2LABEL,
        label2id=LABEL2ID,
    )
    model.config.return_dict = True

    checkpoint_dir = OUTPUT_DIR / "checkpoint"
    training_args = TrainingArguments(
        output_dir=str(checkpoint_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size * 2,
        learning_rate=args.lr,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1_macro",
        greater_is_better=True,
        logging_steps=50,
        save_total_limit=2,
        seed=args.seed,
        report_to="none",
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        tokenizer=tokenizer,
        data_collator=DataCollatorWithPadding(tokenizer),
        compute_metrics=compute_metrics,
    )

    trainer.train()

    final_dir = OUTPUT_DIR / "final"
    trainer.save_model(str(final_dir))
    tokenizer.save_pretrained(str(final_dir))

    metrics = trainer.evaluate()
    log.info(f"Final metrics: {metrics}")

    with open(final_dir / "training_metrics.json", "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2, ensure_ascii=False)

    log.info(f"Model saved to {final_dir}")


if __name__ == "__main__":
    main()
