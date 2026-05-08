"""
TOONFormat utilities — Token-Oriented Object Notation.

Serializers for structuring data in LLM prompts and a parser for decoding
TOON-formatted LLM responses. Reduces token overhead vs JSON for uniform arrays.

Spec: https://toonformat.dev/guide/getting-started.html
"""

from __future__ import annotations

import csv
import io
import re


def toon_list(name: str, items: list[str]) -> str:
    """Encode a flat string list as a TOON block.

    Output format:
        name[N]:
          item1
          item2
    """
    if not items:
        return f"{name}[0]:\n  (none)"
    lines = [f"{name}[{len(items)}]:"]
    for item in items:
        lines.append(f"  {item}")
    return "\n".join(lines)


def toon_table(name: str, fields: list[str], rows: list[dict]) -> str:
    """Encode a list of dicts as a TOON tabular block.

    Output format:
        name[N]{field1,field2,field3}:
          val1,val2,"val with, comma"
          val1,val2,val3
    """
    header = f"{name}[{len(rows)}]{{{','.join(fields)}}}:"
    if not rows:
        return f"{header}\n  (none)"
    lines = [header]
    for row in rows:
        values = [str(row.get(f, "")) for f in fields]
        buf = io.StringIO()
        writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
        writer.writerow(values)
        lines.append(f"  {buf.getvalue().rstrip()}")
    return "\n".join(lines)


def parse_toon_table(text: str, fields: list[str]) -> list[dict]:
    """Parse a TOON table block into a list of dicts.

    Accepts the full block (with header) or just data rows.
    Returns an empty list on empty input or parse errors.
    """
    if not text or not text.strip():
        return []

    result = []
    for line in text.strip().splitlines():
        stripped = line.strip()
        # Skip header line (matches name[N]{fields}: pattern)
        if re.match(r"^\w+\[\d+\]\{[^}]*\}:", stripped):
            continue
        if not stripped or stripped == "(none)":
            continue
        try:
            reader = csv.reader(io.StringIO(stripped))
            row_values = next(reader, [])
        except Exception:
            continue
        if not row_values:
            continue
        # Pad or trim to match field count
        row_values = (row_values + [""] * len(fields))[: len(fields)]
        result.append(dict(zip(fields, row_values)))
    return result
