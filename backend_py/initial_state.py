"""Port of shared/scheduler/scheduler.js::createInitialState().

The ONLY domain function ported to Python. It's a dependency-free leaf: it
builds the canonical first-launch state from constants + today's date and
pulls nothing else from the JS engine. GET /api/scheduler/state returns this
on first launch so the response matches Node's
migrateLoadedState(createInitialState()) (migrate is a no-op on this
already-canonical output).

Parity with the JS source — the constants and structure — is locked by
backend_py/tests/test_initial_state.py against the JS-frozen fixture. Keep
these constants in sync with scheduler.js; the parity test fails if they
drift.
"""

from __future__ import annotations

import datetime
from typing import Any

# Mirrors scheduler.js: STORAGE_VERSION, DEFAULT_ATTENDINGS, PROGRAMS.
STORAGE_VERSION = 2

DEFAULT_ATTENDINGS = [
    "Alder",
    "Birch",
    "Gum",
    "Dogwood",
    "Cedar",
    "Elm",
    "Hazel",
]

PROGRAMS = [
    "Methodist",
    "UT Adult Neuro",
    "UT Pediatrics",
    "UT Pediatric Neurology Fellow",
    "UT Med Student",
    "UT Psychiatry",
    "Other",
]


def create_initial_state() -> dict[str, Any]:
    """Canonical first-launch scheduler state. Dates computed from today in
    local time (date.today()), matching the JS local-Y-M-D formatting —
    never UTC, which could land on the wrong calendar day.
    """
    today = datetime.date.today()
    four_weeks_out = today + datetime.timedelta(days=27)

    block = {
        "id": "block-new",
        "name": "New rotation block",
        "startDate": today.isoformat(),
        "endDate": four_weeks_out.isoformat(),
        "status": "Draft",
        "generate": {
            "inpatient": True,
            "outpatient": True,
            "dailyReport": True,
            "legend": True,
            "export": True,
        },
        "holidays": [],
    }

    return {
        "version": STORAGE_VERSION,
        "activeBlockId": block["id"],
        "serviceBlocks": [block],
        "sources": [],
        "rotators": [],
        # Canonical profile-object shape (attending.v1), same as the JS
        # engine emits — bare strings would 400 on the persistence POST.
        "attendings": [
            {"name": name, "recurringClinics": [], "oneOffDates": []}
            for name in DEFAULT_ATTENDINGS
        ],
        "expectedSourcePrograms": list(PROGRAMS),
        "inpatientAssignments": [],
        "outpatientSessions": [],
        # First-class AM/PM schedule facts imported from source schedules.
        # Whole-day inpatient/outpatient arrays remain compatibility views.
        "halfDayFacts": [],
        # Clinic-stage placements (2026-05-28 redesign). Mirrors the JS
        # createInitialState; additive, schema is additionalProperties:true.
        "clinicAssignments": [],
        # Editable poster metadata (2026-05-28 poster feature). Mirrors the JS
        # DEFAULT_POSTER_SETTINGS; additive, schema is additionalProperties:true.
        "posterSettings": {
            "programName": "Pediatric Neurology Residency",
            "chief": "",
            "notes": [
                "Please arrive 15 minutes before clinic starts.",
                "Check Epic for patient lists and clinic location details.",
                "Notify the chief of any schedule conflicts as soon as possible.",
                "This schedule is subject to change.",
            ],
            "locations": [
                {"name": "Main Campus", "address": ""},
            ],
            "tagline": "Thank you for all you do for our patients!",
        },
        "rules": {
            # `methodistOutpatientFirst` was a dead flag, removed 2026-06-01 to
            # match the JS DEFAULT_RULES / createInitialState source of truth.
            # The v1 schema still declares it (optional) for legacy tolerance.
            "maxConsecutiveInpatientDays": 6,
            "honorNoClinicHolidays": True,
        },
        "notes": [],
    }
