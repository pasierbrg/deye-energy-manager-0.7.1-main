"""Polish distribution tariff catalog and hourly profile engine."""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable


CATALOG_PATH = Path(__file__).with_name("tariff_catalog.json")


def load_bundled_catalog() -> dict[str, Any]:
    with CATALOG_PATH.open("r", encoding="utf-8") as file:
        catalog = json.load(file)
    validate_catalog(catalog)
    return catalog


def validate_catalog(catalog: Any) -> dict[str, Any]:
    """Validate the externally updateable catalog before it becomes active."""
    if not isinstance(catalog, dict) or catalog.get("schema_version") != 1:
        raise ValueError("Unsupported tariff catalog schema")
    if not isinstance(catalog.get("catalog_version"), str):
        raise ValueError("Missing tariff catalog version")
    if catalog.get("currency") != "PLN" or catalog.get("vat_included") is not True:
        raise ValueError("Tariff catalog must contain gross PLN rates")
    try:
        date.fromisoformat(str(catalog.get("effective_from")))
        datetime.fromisoformat(str(catalog.get("generated_at")).replace("Z", "+00:00"))
    except ValueError as err:
        raise ValueError("Invalid tariff catalog dates") from err
    common_fees = catalog.get("common_variable_fees")
    if not isinstance(common_fees, dict):
        raise ValueError("Missing common variable fees")
    for rate in common_fees.values():
        if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not 0 <= float(rate) <= 10:
            raise ValueError("Invalid common variable fee")

    def validate_windows(windows: Any, location: str) -> None:
        if not isinstance(windows, list):
            raise ValueError(f"Invalid time windows in {location}")
        for window in windows:
            if not isinstance(window, list) or len(window) != 2:
                raise ValueError(f"Invalid time window in {location}")
            start, end = window
            if any(isinstance(value, bool) or not isinstance(value, int) for value in window):
                raise ValueError(f"Invalid time window in {location}")
            if not 0 <= start <= 23 or not 0 <= end <= 24 or start == end:
                raise ValueError(f"Invalid time window in {location}")

    def validate_zones(zones: Any, location: str, rates: dict[str, Any]) -> None:
        if not isinstance(zones, dict):
            raise ValueError(f"Invalid zones in {location}")
        for zone, windows in zones.items():
            if zone not in rates:
                raise ValueError(f"Zone {zone} has no rate in {location}")
            validate_windows(windows, location)

    providers = catalog.get("providers")
    if not isinstance(providers, dict) or not providers:
        raise ValueError("Tariff catalog has no providers")
    for provider_id, provider in providers.items():
        if not isinstance(provider_id, str) or not isinstance(provider, dict):
            raise ValueError("Invalid tariff provider")
        source = provider.get("source")
        if not isinstance(provider.get("name"), str) or not isinstance(source, str) or not (source == "manual" or source.startswith("https://")):
            raise ValueError(f"Provider {provider_id} has no trusted source")
        tariffs = provider.get("tariffs")
        if not isinstance(tariffs, dict) or not tariffs:
            raise ValueError(f"Provider {provider_id} has no tariffs")
        for plan_id, plan in tariffs.items():
            if not isinstance(plan_id, str) or not isinstance(plan, dict):
                raise ValueError(f"Invalid tariff plan for {provider_id}")
            rates = plan.get("rates")
            if not isinstance(rates, dict) or not rates:
                raise ValueError(f"Tariff {provider_id}/{plan_id} has no rates")
            for rate in rates.values():
                if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not 0 <= float(rate) <= 10:
                    raise ValueError(f"Invalid rate in {provider_id}/{plan_id}")
            for zone_key in ("all_day_zone", "default_zone", "weekend_zone", "holiday_zone", "weekday_zone", "saturday_zone"):
                zone = plan.get(zone_key)
                if zone is not None and zone not in rates:
                    raise ValueError(f"Unknown {zone_key} in {provider_id}/{plan_id}")
            if "zones" in plan:
                validate_zones(plan["zones"], f"{provider_id}/{plan_id}", rates)
            for windows_key in ("weekday_windows", "saturday_windows"):
                if windows_key in plan:
                    validate_windows(plan[windows_key], f"{provider_id}/{plan_id}/{windows_key}")
            for season_name, season in plan.get("seasons", {}).items():
                if not isinstance(season, dict) or not isinstance(season.get("months"), list):
                    raise ValueError(f"Invalid season in {provider_id}/{plan_id}")
                season_rates = {**rates, **season.get("rates", {})}
                if "zones" in season:
                    validate_zones(season["zones"], f"{provider_id}/{plan_id}/{season_name}", season_rates)
            for month, zones in plan.get("month_zones", {}).items():
                if str(month) not in {str(value) for value in range(1, 13)}:
                    raise ValueError(f"Invalid month in {provider_id}/{plan_id}")
                validate_zones(zones, f"{provider_id}/{plan_id}/month-{month}", rates)
            if plan.get("effective_from"):
                try:
                    date.fromisoformat(str(plan["effective_from"]))
                except ValueError as err:
                    raise ValueError(f"Invalid effective date in {provider_id}/{plan_id}") from err
    return catalog


def catalog_labels(catalog: dict[str, Any] | None = None) -> tuple[dict[str, str], dict[str, str]]:
    source = catalog or load_bundled_catalog()
    providers = {
        key: str(value.get("name") or key)
        for key, value in source.get("providers", {}).items()
    }
    tariffs: dict[str, str] = {"custom": "Profil własny"}
    for provider in source.get("providers", {}).values():
        for key, value in provider.get("tariffs", {}).items():
            tariffs.setdefault(key, str(value.get("name") or key.upper()))
    return providers, tariffs


_BUNDLED = load_bundled_catalog()
PROVIDER_LABELS, TARIFF_LABELS = catalog_labels(_BUNDLED)


def _easter_sunday(year: int) -> date:
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
        date(year, 1, 1), date(year, 1, 6), date(year, 5, 1),
        date(year, 5, 3), date(year, 8, 15), date(year, 11, 1),
        date(year, 11, 11), date(year, 12, 24), date(year, 12, 25),
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


def day_type(moment: datetime) -> str:
    if is_polish_holiday(moment.date()):
        return "holiday"
    if moment.weekday() >= 5:
        return "weekend"
    return "workday"


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


def get_tariff(catalog: dict[str, Any], provider: str, plan: str) -> dict[str, Any] | None:
    return catalog.get("providers", {}).get(provider, {}).get("tariffs", {}).get(plan)


def tariff_availability(plan: dict[str, Any], on_date: date | None = None) -> tuple[bool, str]:
    """Tell the UI and optimizer whether a catalog plan can be used safely."""
    if plan.get("requires_dynamic_signal"):
        return False, "wymaga osobnego sygnału stref dynamicznych"
    effective_from = plan.get("effective_from")
    if effective_from:
        try:
            effective_day = date.fromisoformat(str(effective_from))
        except ValueError:
            return False, "ma nieprawidłową datę obowiązywania"
        if effective_day > (on_date or date.today()):
            return False, f"obowiązuje od {effective_day.isoformat()}"
    return True, ""


def available_tariffs(catalog: dict[str, Any], provider: str) -> list[dict[str, Any]]:
    tariffs = catalog.get("providers", {}).get(provider, {}).get("tariffs", {})
    result: list[dict[str, Any]] = []
    for key, value in tariffs.items():
        available, reason = tariff_availability(value)
        result.append({
            "id": key,
            "name": str(value.get("name") or key.upper()),
            "available": available,
            "unavailable_reason": reason,
        })
    return result


def _active_rule(plan: dict[str, Any], moment: datetime) -> dict[str, Any]:
    rule: dict[str, Any] = plan
    for candidate in plan.get("seasons", {}).values():
        if moment.month in candidate.get("months", []):
            rule = {**plan, **candidate, "rates": {**plan.get("rates", {}), **candidate.get("rates", {})}}
            break
    month_rule = plan.get("month_zones", {}).get(str(moment.month))
    if isinstance(month_rule, dict):
        rule = {**plan, "zones": month_rule}
    if moment.weekday() >= 5:
        weekend_rates = plan.get("weekend_rates", {}).get(tariff_season(moment.date()))
        if isinstance(weekend_rates, dict):
            rule = {**rule, "rates": weekend_rates}
    return rule


def catalog_tariff_row(
    moment: datetime,
    catalog: dict[str, Any],
    provider: str,
    plan_id: str,
) -> dict[str, Any]:
    plan = get_tariff(catalog, provider, plan_id)
    if plan is None:
        raise ValueError(f"Unknown tariff {provider}/{plan_id}")
    kind = day_type(moment)
    season = tariff_season(moment.date())
    if plan.get("requires_dynamic_signal"):
        zone = "dynamic_unavailable"
        rate = 0.0
    elif plan.get("all_day_zone"):
        zone = str(plan["all_day_zone"])
        rate = float(plan.get("rates", {}).get(zone, 0.0))
    else:
        rule = _active_rule(plan, moment)
        zone = str(rule.get("default_zone") or plan.get("default_zone") or "peak")
        if kind == "holiday" and plan.get("holiday_zone"):
            zone = str(plan["holiday_zone"])
        elif kind == "weekend" and plan.get("weekend_zone"):
            zone = str(plan["weekend_zone"])
        else:
            if moment.weekday() == 5 and plan.get("saturday_zone"):
                zone = str(plan.get("default_zone") or zone)
                if hour_in_windows(moment.hour, plan.get("saturday_windows", [])):
                    zone = str(plan["saturday_zone"])
            if moment.weekday() < 5 and plan.get("weekday_zone"):
                zone = str(plan.get("default_zone") or zone)
                if hour_in_windows(moment.hour, plan.get("weekday_windows", [])):
                    zone = str(plan["weekday_zone"])
            windows = rule.get("zones", plan.get("zones", {}))
            for candidate_zone, candidate_windows in windows.items():
                if hour_in_windows(moment.hour, candidate_windows):
                    zone = str(candidate_zone)
                    break
        rates = rule.get("rates", plan.get("rates", {}))
        rate = float(rates.get(zone, plan.get("rates", {}).get(zone, 0.0)))
    common = catalog.get("common_variable_fees", {})
    common_rate = sum(float(value) for value in common.values() if isinstance(value, (int, float)))
    return {
        "date": moment.date().isoformat(),
        "hour": moment.hour,
        "label": f"{moment.hour:02d}:00-{(moment.hour + 1) % 24:02d}:00",
        "zone": zone,
        "rate": round(max(0.0, rate), 4),
        "common_rate": round(common_rate, 5),
        "total_distribution_rate": round(max(0.0, rate + common_rate), 5),
        "day_type": kind,
        "weekend": moment.weekday() >= 5,
        "holiday": is_polish_holiday(moment.date()),
        "season": season,
    }


def catalog_hourly_profile(
    moment: datetime,
    catalog: dict[str, Any],
    provider: str,
    plan: str,
    hours: int = 48,
) -> list[dict[str, Any]]:
    start = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    return [catalog_tariff_row(start + timedelta(hours=offset), catalog, provider, plan) for offset in range(hours)]


def tariff_zone(
    moment: datetime,
    plan: str,
    custom_windows: str | None = None,
    provider: str = "other",
) -> str:
    """Backward-compatible two-zone helper used by earlier tests and migrations."""
    normalized_plan = str(plan).lower()
    if normalized_plan == "custom":
        return "offpeak" if hour_in_windows(moment.hour, parse_windows(custom_windows)) else "peak"
    catalog = _BUNDLED
    if get_tariff(catalog, provider, plan):
        return catalog_tariff_row(moment, catalog, provider, plan)["zone"]
    if normalized_plan == "g11":
        return "all_day"
    if normalized_plan == "g12w" and (moment.weekday() >= 5 or is_polish_holiday(moment.date())):
        return "offpeak"
    return "offpeak" if hour_in_windows(moment.hour, parse_windows(custom_windows)) else "peak"


def hourly_tariff_profile(
    moment: datetime,
    plan: str,
    peak_rate: float,
    offpeak_rate: float,
    custom_windows: str | None = None,
    provider: str = "other",
) -> list[dict[str, Any]]:
    """Backward-compatible manually priced 24-hour profile."""
    profile: list[dict[str, Any]] = []
    start = moment.replace(hour=0, minute=0, second=0, microsecond=0)
    for hour in range(24):
        current = start + timedelta(hours=hour)
        zone = tariff_zone(current, plan, custom_windows, provider)
        rate = peak_rate if zone in ("all_day", "peak") else offpeak_rate
        profile.append({
            "date": current.date().isoformat(),
            "hour": hour,
            "label": f"{hour:02d}:00-{(hour + 1) % 24:02d}:00",
            "zone": zone,
            "rate": round(max(0.0, float(rate)), 4),
            "day_type": day_type(current),
            "weekend": current.weekday() >= 5,
            "holiday": is_polish_holiday(current.date()),
            "season": tariff_season(current.date()),
        })
    return profile
