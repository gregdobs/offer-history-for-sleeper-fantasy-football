"""Tiny local server for the browser test suite.

Serves the repository over http://localhost:8765/ and fakes Sleeper's /graphql endpoint
with canned dummy data so extension/inject.js can be exercised without touching sleeper.com.

Run from the repository root:   python tests/server.py
Then open:                      http://localhost:8765/tests/test.html
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))

TRADES = {
    "data": {
        "league_transactions_filtered": [
            {"transaction_id": "t-inject-1", "league_id": "100000000000000001", "type": "trade", "status": "rejected",
             "created": 1700000000000, "status_updated": 1700000100000, "creator": "U_ME",
             "roster_ids": [1, 2], "adds": {"1": 2, "3": 1}, "drops": {"1": 1, "3": 2},
             "draft_picks": ["2,2027,2,1,2"], "consenter_ids": None, "metadata": None, "settings": None, "leg": 3},
            # Not a trade: must be ignored.
            {"transaction_id": "w-1", "league_id": "100000000000000001", "type": "waiver", "status": "complete"},
        ]
    }
}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8", "replace") if length else ""
        mode = self.path.split("?", 1)[1] if "?" in self.path else ""
        if not self.path.startswith("/graphql"):
            self.send_response(404)
            self.end_headers()
            return
        if mode == "text":
            body, ctype, code = "this is not json", "text/plain", 200
        elif mode == "error":
            body, ctype, code = json.dumps({"errors": [{"message": "boom"}]}), "application/json", 500
        elif mode == "errors":
            body, ctype, code = json.dumps({"data": None, "errors": [{"message": "Unauthorized"}]}), "application/json", 200
        elif mode == "empty":
            body, ctype, code = json.dumps({"data": {"league_transactions_filtered": []}}), "application/json", 200
        elif mode == "weird":
            body, ctype, code = json.dumps({"data": {"league_transactions_filtered": [None, 5, "x", {"type": "trade"}],
                                                      "other": {"a": 1}}}), "application/json", 200
        else:
            body, ctype, code = json.dumps(TRADES), "application/json", 200
        data = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"Serving {ROOT} on http://localhost:{port}/")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
