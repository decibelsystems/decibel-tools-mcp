"""
Intent Classification for Voice Commands

Uses sentence-transformers for semantic similarity-based classification.
Logs all samples for future fine-tuning.

Usage:
    from ml.intent_classifier import get_classifier
    classifier = get_classifier()
    intent, confidence = classifier.classify("I wish we had better logging")
"""

from sentence_transformers import SentenceTransformer
import numpy as np
from pathlib import Path
import json
from datetime import datetime
from typing import Tuple, Optional

class IntentClassifier:
    def __init__(self, data_root: Optional[str] = None):
        # Load lightweight model (80MB, fast inference)
        self.model = SentenceTransformer('all-MiniLM-L6-v2')

        # Example phrases for each intent (seed data)
        self.examples = {
            "add_wish": [
                "I wish we had",
                "would be nice if",
                "can we add",
                "idea for",
                "we should build",
                "it would help if",
                "we need a way to",
                "feature request",
            ],
            "log_issue": [
                "there's a bug",
                "broken",
                "error when",
                "fails to",
                "not working",
                "crashed",
                "exception in",
                "something wrong with",
            ],
            "log_friction": [
                "annoying that",
                "keeps happening",
                "painful to",
                "frustrating",
                "slows me down",
                "every time I have to",
                "tedious",
                "friction point",
            ],
            "log_crit": [
                "I noticed",
                "observation",
                "the design feels",
                "UI looks",
                "feels off",
                "visually",
                "the layout",
                "spacing seems",
            ],
            "record_learning": [
                "I learned",
                "TIL",
                "figured out",
                "turns out",
                "the trick is",
                "gotcha",
                "lesson learned",
                "discovered that",
            ],
            "search": [
                "find",
                "where is",
                "show me",
                "look up",
                "search for",
                "what is the status of",
            ],
            "ask_oracle": [
                "what should I work on",
                "project status",
                "roadmap",
                "health check",
                "priorities",
                "next actions",
            ],
        }

        # Pre-compute embeddings for all examples
        self.example_embeddings = {
            intent: self.model.encode(phrases)
            for intent, phrases in self.examples.items()
        }

        # Training data log path
        if data_root:
            self.training_log = Path(data_root) / ".decibel" / "ml" / "training_samples.jsonl"
        else:
            self.training_log = Path(".decibel/ml/training_samples.jsonl")
        self.training_log.parent.mkdir(parents=True, exist_ok=True)

    def classify(self, transcript: str) -> Tuple[str, float]:
        """
        Classify a transcript into an intent category.

        Returns:
            tuple: (intent_name, confidence_score)
        """
        # Encode the input transcript
        emb = self.model.encode(transcript)

        best_intent = "unknown"
        best_score = 0.0

        for intent, example_embs in self.example_embeddings.items():
            # Compute cosine similarity with all examples for this intent
            sims = np.dot(example_embs, emb) / (
                np.linalg.norm(example_embs, axis=1) * np.linalg.norm(emb)
            )
            max_sim = float(np.max(sims))

            if max_sim > best_score:
                best_score = max_sim
                best_intent = intent

        return best_intent, best_score

    def log_sample(
        self,
        transcript: str,
        user_label: str,
        predicted: str,
        confidence: float,
        was_overridden: bool = False
    ):
        """
        Log a training sample for future model improvement.

        The user_label (from button tap) is treated as ground truth.
        """
        sample = {
            "transcript": transcript,
            "user_label": user_label,
            "predicted": predicted,
            "confidence": round(confidence, 4),
            "correct": user_label == predicted,
            "was_overridden": was_overridden,
            "ts": datetime.utcnow().isoformat() + "Z"
        }

        with open(self.training_log, "a") as f:
            f.write(json.dumps(sample) + "\n")

    def get_training_stats(self) -> dict:
        """Get statistics on collected training samples."""
        if not self.training_log.exists():
            return {"total": 0, "accuracy": 0, "by_intent": {}}

        total = 0
        correct = 0
        by_intent = {}

        with open(self.training_log) as f:
            for line in f:
                try:
                    sample = json.loads(line)
                    total += 1
                    if sample.get("correct"):
                        correct += 1

                    label = sample.get("user_label", "unknown")
                    if label not in by_intent:
                        by_intent[label] = {"total": 0, "correct": 0}
                    by_intent[label]["total"] += 1
                    if sample.get("correct"):
                        by_intent[label]["correct"] += 1
                except:
                    pass

        return {
            "total": total,
            "accuracy": round(correct / total, 3) if total > 0 else 0,
            "by_intent": by_intent
        }


# Singleton instance
_classifier: Optional[IntentClassifier] = None

def get_classifier(data_root: Optional[str] = None) -> IntentClassifier:
    """Get or create the singleton classifier instance."""
    global _classifier
    if _classifier is None:
        _classifier = IntentClassifier(data_root)
    return _classifier


# CLI for testing
if __name__ == "__main__":
    import sys

    classifier = get_classifier()

    if len(sys.argv) > 1:
        transcript = " ".join(sys.argv[1:])
        intent, confidence = classifier.classify(transcript)
        print(f"Intent: {intent}")
        print(f"Confidence: {confidence:.2%}")
    else:
        # Demo
        test_phrases = [
            "I wish we had a correlation matrix",
            "there's a bug in the login page",
            "it's so annoying that I have to restart every time",
            "the button spacing looks off",
            "I figured out the API needs a trailing slash",
            "show me all open issues",
            "what should I work on next",
        ]

        print("Intent Classification Demo\n" + "="*50)
        for phrase in test_phrases:
            intent, conf = classifier.classify(phrase)
            print(f"\n\"{phrase}\"")
            print(f"  → {intent} ({conf:.0%})")
