"""Deterministic 48-hour energy planner used by the AI suggestions screen.

The planner never writes inverter entities.  It only calculates proposals from
explicit inputs; applying today or scheduling tomorrow remains a separate,
user-confirmed operation.
"""

from __future__ import annotations

from datetime import date, timedelta
import math
from typing import Any


def _number(value: Any, default: float = 0.0) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def _hour_map(value: Any) -> dict[int, float]:
    if not isinstance(value, dict):
        return {}
    result: dict[int, float] = {}
    for key, raw in value.items():
        try:
            hour = int(str(key).split(":", 1)[0])
            number = float(raw)
        except (TypeError, ValueError):
            continue
        if 0 <= hour <= 23 and math.isfinite(number) and number > 0:
            result[hour] = number
    return result


def _profile24(value: Any) -> list[float]:
    if isinstance(value, dict):
        return [_number(value.get(hour, value.get(str(hour))), 0) for hour in range(24)]
    if isinstance(value, list):
        return [_number(value[hour], 0) if hour < len(value) else 0 for hour in range(24)]
    return [0.0] * 24


def _normalised_shape(profile: list[float], fallback_solar: bool) -> tuple[list[float], bool]:
    positive = [max(0.0, value) for value in profile]
    total = sum(positive)
    if total > 0:
        return [value / total for value in positive], True
    if not fallback_solar:
        return [0.0] * 24, False
    # Only a distribution curve, never an invented energy forecast.
    curve = [max(0.0, math.sin(math.pi * (hour - 5.5) / 13.0)) for hour in range(24)]
    curve_total = sum(curve) or 1.0
    return [value / curve_total for value in curve], False


def _best_contiguous_window(
    prices: dict[int, float],
    hours: list[int],
    length: int,
    maximize: bool,
    threshold: float,
    excluded: set[int] | None = None,
) -> list[int]:
    if length <= 0:
        return []
    excluded = excluded or set()
    allowed = set(hours)
    best: tuple[float, list[int]] | None = None
    for start in hours:
        window = list(range(start, start + length))
        if any(hour not in allowed or hour in excluded or hour not in prices for hour in window):
            continue
        values = [prices[hour] for hour in window]
        if maximize and any(value < threshold for value in values):
            continue
        if not maximize and any(value > threshold for value in values):
            continue
        score = sum(values) / len(values)
        if best is None or (score > best[0] if maximize else score < best[0]):
            best = (score, window)
    return best[1] if best else []


def _confidence(inputs: dict[str, Any], day_index: int, pv_profile_learned: bool) -> float:
    recorded_days = max(0, int(_number(inputs.get("recorded_days"), 0)))
    price_ok = bool(_hour_map(inputs.get("sell_prices", [])[day_index] if day_index < len(inputs.get("sell_prices", [])) else {}))
    buy_ok = bool(_hour_map(inputs.get("buy_prices", [])[day_index] if day_index < len(inputs.get("buy_prices", [])) else {}))
    solcast_ok = _number(inputs.get("pv_forecast", [0, 0])[day_index], 0) > 0
    weather_rows = inputs.get("weather_factors") if isinstance(inputs.get("weather_factors"), list) else []
    weather_ok = any(value is not None for value in weather_rows[day_index * 24:(day_index + 1) * 24])
    value = 28 + min(28, recorded_days * 2.0)
    value += 13 if price_ok and buy_ok else 4 if price_ok or buy_ok else 0
    value += 12 if solcast_ok else 0
    value += 7 if weather_ok else 0
    value += 7 if pv_profile_learned else 0
    if recorded_days < 7:
        value = min(value, 49)
    elif recorded_days < 14:
        value = min(value, 70)
    return round(max(20, min(95, value)), 1)


def build_energy_plan(inputs: dict[str, Any], strategy: str = "balanced") -> dict[str, Any]:
    """Return a chronological, physically bounded 48-hour proposal."""
    start_date = date.fromisoformat(str(inputs.get("date")))
    current_hour = max(0, min(23, int(_number(inputs.get("current_hour"), 0))))
    capacity = max(0.1, _number(inputs.get("battery_capacity_kwh"), 10))
    efficiency = max(0.5, min(1.0, _number(inputs.get("battery_efficiency"), 0.9)))
    min_soc = max(0.0, min(100.0, _number(inputs.get("min_soc"), 20)))
    target_soc = max(min_soc, min(100.0, _number(inputs.get("target_soc"), 100)))
    reserve_kwh = max(0.0, _number(inputs.get("reserve_kwh"), 0))
    protected_kwh = min(capacity, capacity * min_soc / 100 + reserve_kwh)
    target_kwh = min(capacity, max(protected_kwh, capacity * target_soc / 100))
    stored_kwh = min(capacity, max(0.0, capacity * _number(inputs.get("soc"), 0) / 100))
    max_sell_kw = max(0.1, _number(inputs.get("max_sell_power_w"), 5000) / 1000)
    charge_kwh = max(0.25, min(capacity, _number(inputs.get("charge_kwh_per_hour"), capacity * 0.25)))
    min_sell = _number(inputs.get("min_sell_price"), 0)
    max_buy = _number(inputs.get("max_buy_price"), 999)
    allow_sell = bool(inputs.get("allow_battery_sell", True))
    allow_charge = bool(inputs.get("allow_grid_charge", True))

    sell_source = inputs.get("sell_prices") if isinstance(inputs.get("sell_prices"), list) else []
    buy_source = inputs.get("buy_prices") if isinstance(inputs.get("buy_prices"), list) else []
    sell_prices = [_hour_map(sell_source[index] if index < len(sell_source) else {}) for index in range(2)]
    buy_prices = [_hour_map(buy_source[index] if index < len(buy_source) else {}) for index in range(2)]
    distribution = inputs.get("distribution") if isinstance(inputs.get("distribution"), list) else []
    total_buy = [
        {
            hour: price + _number(distribution[day_index * 24 + hour], 0)
            for hour, price in buy_prices[day_index].items()
        }
        for day_index in range(2)
    ]
    if inputs.get("price_includes_distribution"):
        total_buy = buy_prices

    load_shape = _profile24(inputs.get("load_profile"))
    pv_shape, learned_pv_shape = _normalised_shape(_profile24(inputs.get("pv_profile")), True)
    pv_forecast = inputs.get("pv_forecast") if isinstance(inputs.get("pv_forecast"), list) else [0, 0]
    weather = inputs.get("weather_factors") if isinstance(inputs.get("weather_factors"), list) else []
    hourly_load = [
        0.0 if day_index == 0 and hour < current_hour else max(0.0, load_shape[hour])
        for day_index in range(2) for hour in range(24)
    ]
    hourly_pv: list[float] = []
    for day_index in range(2):
        total = max(0.0, _number(pv_forecast[day_index] if day_index < len(pv_forecast) else 0))
        active_shape = [
            0.0 if day_index == 0 and hour < current_hour else pv_shape[hour]
            for hour in range(24)
        ]
        active_total = sum(active_shape) or 1.0
        for hour in range(24):
            factor_raw = weather[day_index * 24 + hour] if day_index * 24 + hour < len(weather) else None
            factor = 1.0 if factor_raw is None else max(0.65, min(1.05, _number(factor_raw, 1)))
            value = total * active_shape[hour] / active_total * factor
            hourly_pv.append(max(0.0, value))

    # Select compact contiguous windows so Deye's six-range constraint remains tractable.
    sell_hours: list[set[int]] = [set(), set()]
    buy_hours: list[set[int]] = [set(), set()]
    sell_lengths = {"safe": 1, "balanced": 3, "profit": 4}
    buy_lengths = {"safe": 1, "balanced": 2, "profit": 3}
    for day_index in range(2):
        active_hours = list(range(current_hour, 24)) if day_index == 0 else list(range(24))
        if allow_sell and sell_prices[day_index]:
            sell_hours[day_index] = set(_best_contiguous_window(
                sell_prices[day_index], active_hours, sell_lengths.get(strategy, 3), True, min_sell
            ))
        future_sell = max(
            [value for later in range(day_index, 2) for value in sell_prices[later].values()],
            default=0,
        )
        profitable_buy_limit = future_sell * efficiency - 0.02 if future_sell > 0 else max_buy
        threshold = min(max_buy, profitable_buy_limit) if strategy != "safe" else min(max_buy, profitable_buy_limit * 0.95)
        if allow_charge and total_buy[day_index] and (stored_kwh < target_kwh or future_sell > 0):
            buy_hours[day_index] = set(_best_contiguous_window(
                total_buy[day_index], active_hours, buy_lengths.get(strategy, 2), False, threshold, sell_hours[day_index]
            ))

    rows: list[dict[str, Any]] = []
    summaries: list[dict[str, Any]] = []
    for day_index in range(2):
        day_start_energy = stored_kwh
        day_balance = 0.0
        sold = 0.0
        bought = 0.0
        confidence = _confidence(inputs, day_index, learned_pv_shape)
        for hour in range(24):
            idx = day_index * 24 + hour
            pv = hourly_pv[idx]
            load = hourly_load[idx]
            stored_kwh = min(capacity, max(0.0, stored_kwh + max(0.0, pv - load) * efficiency))
            deficit = max(0.0, load - pv)
            from_battery = min(deficit / efficiency, max(0.0, stored_kwh - protected_kwh))
            stored_kwh -= from_battery
            grid_import = max(0.0, deficit - from_battery * efficiency)
            action = "none"
            mode = "Bez zmiany"
            energy = 0.0
            balance = -grid_import * total_buy[day_index].get(hour, buy_prices[day_index].get(hour, 0))
            if hour in buy_hours[day_index] and hour in total_buy[day_index] and stored_kwh < target_kwh:
                input_energy = min(charge_kwh, (capacity - stored_kwh) / efficiency)
                if input_energy > 0.01:
                    stored_kwh += input_energy * efficiency
                    action = "charge"
                    mode = "Charge"
                    energy = input_energy
                    bought += input_energy
                    balance -= input_energy * total_buy[day_index][hour]
            if hour in sell_hours[day_index] and hour in sell_prices[day_index]:
                available = max(0.0, stored_kwh - protected_kwh)
                output_energy = min(max_sell_kw, available * efficiency)
                if output_energy > 0.01:
                    stored_kwh -= output_energy / efficiency
                    action = "sell"
                    mode = "Selling First"
                    energy = output_energy
                    sold += output_energy
                    balance += output_energy * sell_prices[day_index][hour]
            day_balance += balance
            rows.append({
                "day": "today" if day_index == 0 else "tomorrow",
                "date": (start_date + timedelta(days=day_index)).isoformat(),
                "hour": hour,
                "label": f"{hour:02d}:00–{(hour + 1) % 24:02d}:00",
                "action": action,
                "mode": mode,
                "proposed": action != "none",
                "pv_kwh": round(pv, 3),
                "load_kwh": round(load, 3),
                "sell_price": sell_prices[day_index].get(hour),
                "buy_price": buy_prices[day_index].get(hour),
                "distribution": round(_number(distribution[idx] if idx < len(distribution) else 0), 5),
                "weather_factor": weather[idx] if idx < len(weather) else None,
                "total_buy_price": total_buy[day_index].get(hour),
                "energy_kwh": round(energy, 3),
                "soc_after": round(stored_kwh / capacity * 100, 1),
                "balance_pln": round(balance, 2),
                "confidence": confidence,
            })
        summaries.append({
            "day": "today" if day_index == 0 else "tomorrow",
            "date": (start_date + timedelta(days=day_index)).isoformat(),
            "start_soc": round(day_start_energy / capacity * 100, 1),
            "end_soc": round(stored_kwh / capacity * 100, 1),
            "sold_kwh": round(sold, 3),
            "bought_kwh": round(bought, 3),
            "balance_pln": round(day_balance, 2),
            "confidence": confidence,
            "prices_available": bool(sell_prices[day_index] or buy_prices[day_index]),
        })

    checkpoints = {}
    for day_name, hour in (("today_end", 23), ("tomorrow_00", 0), ("tomorrow_05", 5), ("tomorrow_09", 9), ("tomorrow_end", 23)):
        day_index = 0 if day_name == "today_end" else 1
        row = next((item for item in rows if item["day"] == ("today" if day_index == 0 else "tomorrow") and item["hour"] == hour), None)
        checkpoints[day_name] = row["soc_after"] if row else None
    return {
        "strategy": strategy,
        "rows": rows,
        "days": summaries,
        "checkpoints": checkpoints,
        "data_quality": {
            "learning_stage": "gotowe" if int(_number(inputs.get("recorded_days"), 0)) >= 14 else "wstępne uczenie",
            "recorded_days": int(_number(inputs.get("recorded_days"), 0)),
            "pv_profile_learned": learned_pv_shape,
            "tomorrow_sell_prices": len(sell_prices[1]),
            "tomorrow_buy_prices": len(buy_prices[1]),
            "weather_hours": sum(value is not None for value in weather[:48]),
        },
    }


def build_plan_bundle(inputs: dict[str, Any], selected_strategy: str = "balanced") -> dict[str, Any]:
    variants = {
        strategy: build_energy_plan(inputs, strategy)
        for strategy in ("safe", "balanced", "profit")
    }
    selected = selected_strategy if selected_strategy in variants else "balanced"
    return {
        **variants[selected],
        "selected_strategy": selected,
        "variants": {
            key: {
                "days": value["days"],
                "checkpoints": value["checkpoints"],
            }
            for key, value in variants.items()
        },
    }
