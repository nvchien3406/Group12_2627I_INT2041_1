"""Một lệnh chạy cả web, backend và AI local."""
from pathlib import Path
import argparse
import os
import socket
import threading
import time
import urllib.request
import webbrowser


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    os.chdir(Path(__file__).resolve().parent)
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", args.port))
        except OSError:
            raise SystemExit(f"Cong {args.port} dang duoc dung. Tat server cu hoac chay run.py --port 8001.")
    url = f"http://127.0.0.1:{args.port}"
    print(f"Mo {url} | Dung server bang Ctrl+C", flush=True)
    if not args.no_browser:
        def open_when_ready():
            for _ in range(50):
                try:
                    with urllib.request.urlopen(url + "/api/health", timeout=1) as response:
                        if response.status == 200:
                            webbrowser.open(url)
                            return
                except OSError:
                    time.sleep(0.2)
        threading.Thread(target=open_when_ready, daemon=True).start()
    import uvicorn
    uvicorn.run("Backend.main:app", host="127.0.0.1", port=args.port, workers=1)


if __name__ == "__main__":
    main()
