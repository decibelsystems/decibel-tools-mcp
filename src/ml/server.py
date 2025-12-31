"""
Intent Classifier HTTP Server

Lightweight sidecar service for intent classification.
Called by the TypeScript MCP server.

Usage:
    python3 src/ml/server.py [--port 8790]
"""

import argparse
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from intent_classifier import get_classifier, IntentClassifier

classifier: IntentClassifier = None


class ClassifierHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/classify":
            self._handle_classify()
        elif self.path == "/log":
            self._handle_log()
        else:
            self._send_json(404, {"error": "Not found"})

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {"status": "ok", "model": "all-MiniLM-L6-v2"})
        elif self.path == "/stats":
            self._send_json(200, classifier.get_training_stats())
        else:
            self._send_json(404, {"error": "Not found"})

    def _handle_classify(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_length))

            transcript = body.get("transcript", "")
            if not transcript:
                self._send_json(400, {"error": "Missing transcript"})
                return

            intent, confidence = classifier.classify(transcript)

            self._send_json(200, {
                "intent": intent,
                "confidence": round(confidence, 4)
            })
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def _handle_log(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(content_length))

            classifier.log_sample(
                transcript=body.get("transcript", ""),
                user_label=body.get("user_label", "unknown"),
                predicted=body.get("predicted", "unknown"),
                confidence=body.get("confidence", 0),
                was_overridden=body.get("was_overridden", False)
            )

            self._send_json(200, {"logged": True})
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def _send_json(self, status: int, data: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        # Quieter logging
        if "/health" not in args[0]:
            print(f"[intent-classifier] {args[0]}")


def main():
    global classifier

    parser = argparse.ArgumentParser(description="Intent Classifier Server")
    parser.add_argument("--port", type=int, default=8790, help="Port to listen on")
    parser.add_argument("--data-root", type=str, help="Root directory for .decibel data")
    args = parser.parse_args()

    print(f"[intent-classifier] Loading model...")
    classifier = get_classifier(args.data_root)
    print(f"[intent-classifier] Model loaded, starting server on port {args.port}")

    server = HTTPServer(("127.0.0.1", args.port), ClassifierHandler)
    print(f"[intent-classifier] Ready at http://127.0.0.1:{args.port}")
    print(f"[intent-classifier] Endpoints: POST /classify, POST /log, GET /health, GET /stats")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[intent-classifier] Shutting down")
        server.shutdown()


if __name__ == "__main__":
    main()
