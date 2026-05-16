import argparse
import shutil
from pathlib import Path

from optimum.onnxruntime import ORTModelForSequenceClassification
from transformers import AutoTokenizer

from logger import setup_logging

log = setup_logging("export")

ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL = ROOT / "models" / "sentiment" / "final"
DEFAULT_OUT = ROOT / "models" / "sentiment" / "onnx"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=str(DEFAULT_MODEL))
    parser.add_argument("--output", default=str(DEFAULT_OUT))
    args = parser.parse_args()

    log.info(f"Loading {args.model}")
    model = ORTModelForSequenceClassification.from_pretrained(args.model, export=True)
    tokenizer = AutoTokenizer.from_pretrained(args.model)

    log.info(f"Saving ONNX to {args.output}")
    model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)

    # @xenova/transformers expects ONNX files under onnx/ subdir
    output_dir = Path(args.output)
    onnx_subdir = output_dir / "onnx"
    onnx_subdir.mkdir(exist_ok=True)
    for onnx_file in output_dir.glob("*.onnx*"):
        target = onnx_subdir / onnx_file.name
        if target.exists():
            target.unlink()
        shutil.move(str(onnx_file), str(target))
    log.info(f"Moved ONNX files into {onnx_subdir}")

    log.info("Done")


if __name__ == "__main__":
    main()
