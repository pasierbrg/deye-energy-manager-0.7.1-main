from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Iterable


PROVIDER_LABELS = {
    "pge": "PGE Dystrybucja",
    "tauron": "Tauron Dystrybucja",
    "enea": "Enea Operator",
    "energa": "Energa Operator",
    "stoen": "Stoen Operator",
    "other": "Inny operator",
}

TARIFF_LABELS = {
    "g11": "G11 — całodobowa",
    "g12": "G12 — dwustrefowa",
    "g12w": "G12w — dwustrefowa weekendowa",
    "g12e": "G12e — dwustrefowa elastyczna",
    "custom": "Profil własny",
}

# Są to bezpieczne profile startowe. Użytkownik może je zmienić, ponieważ
# dokładne strefy zależą od operatora i aktualnej taryfy.
DEFAULT_OFFPEAK_WINDOWS = {
    "g11": [],
    "g12": [(0, 6), (13, 15), (22, 24)],
    "g12w": [(0, 6), (13, 15), (22, 24)],
    "g12e": [(0, 7), (13, 15), (21, 24)],
    "custom": [],
}

# Operator-specific starting profiles. They remain editable because the exact
# billing windows depend on the current tariff sheet and the customer's contract.
PROVIDER_OFFPEAK_WINDOWS = {
    provider: {
        "g12": [(0, 6), (13, 15), (22, 24)],
        "g12w": [(0, 6), (13, 15), (22, 24)],
        "g12e_winter": [(0, 7), (13, 15), (21, 24)],
        "g12e_summer": [(0, 7), (13, 16), (22, 24)],
    }
    for provider in ("pge", "tauron", "enea", "energa", "stoen", "other")
}


def _easter_sunday(year: int) -> date:
    """Return Gregorian Easter Sunday using the Meeus/Jones/Butcher algorithm."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    length = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * length) // 451
    month = (h + length - 7 * m + 114) // 31
    day = ((h + length - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def polish_holidays(year: int) -> set[date]:
    easter = _easter_sunday(year)
    fixed = {
        date(year, 1, 1),
        date(year, 1, 6),
        date(year, 5, 1),
        date(year, 5, 3),
        date(year, 8, 15),
        date(year, 11, 1),
        date(year, 11, 11),
        date(year, 12, 24),
        date(year, 12, 25),
        date(year, 12, 26),
    }
    return fixed | {
        easter,
        easter + timedelta(days=1),
        easter + timedelta(days=49),
        easter + timedelta(days=60),
    }


def is_polish_holiday(day: date) -> bool:
    return day in polish_holidays(day.year)


def tariff_season(day: date) -> str:
    return "summer" if 4 <= day.month <= 9 else "winter"


def parse_windows(value: str | Iterable[tuple[int, int]] | None) -> list[tuple[int, int]]:
    if not value:
        return []
    if not isinstance(value, str):
        return [(max(0, int(start)), min(24, int(end))) for start, end in value]
    windows: list[tuple[int, int]] = []
    for item in value.split(","):
        if "-" not in item:
            continue
        raw_start, raw_end = item.strip().split("-", 1)
        try:
            start = int(raw_start.split(":", 1)[0])
            end = int(raw_end.split(":", 1)[0])
        except (TypeError, ValueError):
            continue
        if 0 <= start <= 23 and 0 <= end <= 24 and start != end:
            windows.append((start, end))
    return windows


def hour_in_windows(hour: int, windows: Iterable[tuple[int, int]]) -> bool:
    hour = int(hour) % 24
    for start, end in windows:
        if start < end and start <= hour < end:
            return True
        if start > end and (hour >= start or hour < end):
            return True
    return False


def tariff_zone(
    moment: datetime,
    plan: str,
    custom_windows: str | None = None,
    provider: str = "other",
) -> str:
    plan = str(plan or "g11").lower()
    if plan == "g11":
        return "all_day"
    if plan == "g12w" and (moment.weekday() >= 5 or is_polish_holiday(moment.date())):
        return "offpeak"
    profile_key = f"{plan}_{tariff_season(moment.date())}" if plan == "g12e" else plan
    windows = parse_windows(custom_windows) if plan == "custom" else PROVIDER_OFFPEAK_WINDOWS.get(provider, {}).get(profile_key, DEFAULT_OFFPEAK_WINDOWS.get(plan, []))
    return "offpeak" if hour_in_windows(moment.hour, windows) else "peak"


def hourly_tariff_profile(
    moment: datetime,
    plan: str,
    peak_rate: float,
    offpeak_rate: float,
    custom_windows: str | None = None,
    provider: str = "other",
) -> list[dict[str, Any]]:
    profile: list[dict[str, Any]] = []
    start = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    for hour in range(24):
        current = start + timedelta(hours=hour)
        zone = tariff_zone(current, plan, custom_windows, provider)
        rate = offpeak_rate if zone == "offpeak" else peak_rate
        if zone == "all_day":
            rate = peak_rate
        profile.append({
            "hour": hour,
            "zone": zone,
            "rate": round(max(0.0, float(rate)), 4),
            "weekend": current.weekday() >= 5,
            "holiday": is_polish_holiday(current.date()),
            "season": tariff_season(current.date()),
        })
    return profile
