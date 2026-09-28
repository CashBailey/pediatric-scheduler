#!/usr/bin/env python3
"""Write Coordinator DOCX schedule preview artifacts."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend_py.coordinator_docx_import import (  # noqa: E402
    DEFAULT_INPATIENT_PATH,
    DEFAULT_MASTER_PATH,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_OUTPATIENT_PATH,
    parse_coordinator_docx_bundle,
    write_preview_artifacts,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--master", type=Path, default=DEFAULT_MASTER_PATH)
    parser.add_argument("--inpatient", type=Path, default=DEFAULT_INPATIENT_PATH)
    parser.add_argument("--outpatient", type=Path, default=DEFAULT_OUTPATIENT_PATH)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    args = parser.parse_args()

    preview = parse_coordinator_docx_bundle(
        master_path=args.master,
        inpatient_path=args.inpatient,
        outpatient_path=args.outpatient,
    )
    files = write_preview_artifacts(preview, args.output_dir)

    acceptance = preview["acceptance"]
    print(f"Coordinator DOCX preview written to {args.output_dir}")
    print(f"  rotators: {acceptance['rotators']}")
    print(f"  inpatient assignments: {acceptance['inpatientAssignments']}")
    print(f"  outpatient sessions: {acceptance['outpatientSessions']}")
    print(f"  half-day facts: {acceptance['halfDayFacts']}")
    print(f"  unresolved names: {acceptance['unresolvedNames']}")
    print(f"  half-day annotations: {acceptance['halfDayAnnotations']}")
    print(f"  summary: {files['summary']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
