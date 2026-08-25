#!/usr/bin/env python3
"""Inspect a public ATS application form without submitting it."""

from __future__ import annotations

import argparse
import json
from html.parser import HTMLParser
import requests


class FormParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_form = False
        self.action = ""
        self.controls: list[dict[str, str | bool]] = []
        self.labels: list[str] = []
        self._in_label = False
        self._label_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {key: (value or "") for key, value in attrs}
        if tag == "form" and not self.in_form:
            self.in_form = True
            self.action = data.get("action", "")
        if not self.in_form:
            return
        if tag == "label":
            self._in_label = True
            self._label_text = []
        if tag in {"input", "select", "textarea", "button"}:
            self.controls.append(
                {
                    "tag": tag,
                    "type": data.get("type", ""),
                    "name": data.get("name", ""),
                    "value": data.get("value", ""),
                    "id": data.get("id", ""),
                    "required": "required" in data,
                }
            )
        if tag in {"iframe", "script", "a"}:
            url = data.get("src", "") or data.get("href", "")
            if url and ("greenhouse" in url.lower() or "lever" in url.lower()):
                self.controls.append({"tag": tag, "url": url})

    def handle_endtag(self, tag: str) -> None:
        if tag == "label" and self._in_label:
            text = " ".join("".join(self._label_text).split())
            if text:
                self.labels.append(text)
            self._in_label = False
            self._label_text = []
        if tag == "form" and self.in_form:
            self.in_form = False

    def handle_data(self, data: str) -> None:
        if self._in_label:
            self._label_text.append(data)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    args = parser.parse_args()
    response = requests.get(args.url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    response.raise_for_status()
    body = response.text
    form = FormParser()
    form.feed(body)
    print(json.dumps({"action": form.action, "controls": form.controls, "labels": form.labels}, indent=2))


if __name__ == "__main__":
    main()
