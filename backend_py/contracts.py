"""Load and validate against the frozen v1 contract schemas.

The schemas live in contracts/v1/*.schema.json (generated from the
canonical JS by scripts/freeze-contracts.mjs). They use Ajv-style name
references: $id "scheduler-state.v1" and $ref "service-block.v1" — bare
names, not URIs or JSON Pointers. Ajv resolves these by registered-schema
name with strict:false.

To get identical resolution in Python we register each schema in a
`referencing` Registry keyed by its own $id, so a relative $ref like
"service-block.v1" resolves against the referring schema's $id base to
the registered resource. The schemas declare no $schema, and Ajv defaults
to draft-07, so we pin DRAFT7 here to match.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT7

CONTRACTS_DIR = Path(__file__).resolve().parent.parent / "contracts" / "v1"


@lru_cache(maxsize=1)
def load_schemas() -> dict[str, dict[str, Any]]:
    """Return {$id: schema} for every frozen v1 schema, via index.json."""
    index = json.loads((CONTRACTS_DIR / "index.json").read_text(encoding="utf-8"))
    schemas: dict[str, dict[str, Any]] = {}
    for entry in index["schemas"]:
        schema = json.loads(
            (CONTRACTS_DIR / entry["filename"]).read_text(encoding="utf-8")
        )
        schemas[schema["$id"]] = schema
    return schemas


@lru_cache(maxsize=1)
def _registry() -> Registry:
    resources = [
        (schema_id, Resource(contents=schema, specification=DRAFT7))
        for schema_id, schema in load_schemas().items()
    ]
    return Registry().with_resources(resources)


@lru_cache(maxsize=None)
def _validator(schema_id: str) -> Draft7Validator:
    schemas = load_schemas()
    if schema_id not in schemas:
        raise KeyError(f"unknown schema id: {schema_id!r}")
    return Draft7Validator(
        schemas[schema_id],
        registry=_registry(),
        format_checker=FormatChecker(),
    )


def validate(schema_id: str, instance: Any) -> list[str]:
    """Validate instance against the named schema.

    Returns a list of human-readable error messages (empty == valid). A
    list rather than a raised exception mirrors how the Node backend
    surfaces Ajv's `errors` array to the caller.
    """
    validator = _validator(schema_id)
    return [
        f"{'/'.join(str(p) for p in error.absolute_path) or '<root>'}: {error.message}"
        for error in sorted(validator.iter_errors(instance), key=str)
    ]
