from __future__ import annotations

from datetime import date
import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "custom_components" / "deye_energy_manager" / "ai_planner.py"
SPEC = importlib.util.spec_from_file_location("deye_ai_planner_tests", MODULE_PATH)
planner = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(planner)


def base_inputs():
    pv_shape = [0] * 6 + [0.1, 0.3, 0.7, 1.1, 1.5, 1.8, 2.0, 1.8, 1.4, 1.0, 0.6, 0.2] + [0] * 6
    return {
        "date": date(2026, 7, 18).isoformat(),
        "current_hour": 0,
        "soc": 50,
        "battery_capacity_kwh": 30,
        "battery_efficiency": 0.92,
        "min_soc": 20,
        "target_soc": 90,
        "reserve_kwh": 2,
        "max_sell_power_w": 5000,
        "charge_kwh_per_hour": 5,
        "min_sell_price": 0.2,
        "max_buy_price": 0.8,
        "allow_battery_sell": True,
        "allow_grid_charge": True,
        "sell_prices": [
            {hour: 0.3 + hour * 0.01 for hour in range(24)},
            {hour: (1.4 if 5 <= hour <= 8 else 0.35) for hour in range(24)},
        ],
        "buy_prices": [
            {hour: (0.18 if hour in (22, 23) else 0.7) for hour in range(24)},
            {hour: (0.2 if hour in (0, 1) else 0.75) for hour in range(24)},
        ],
        "distribution": [0.1] * 48,
        "price_includes_distribution": False,
        "pv_forecast": [24, 18],
        "pv_forecast_full": [30, 18],
        "pv_forecast_available": [True, True],
        "forecast_correction": 0.9,
        "forecast_accuracy": 82,
        "pv_profile": pv_shape,
        "load_profile": [0.5] * 24,
        "weather_factors": [1.0] * 48,
        "recorded_days": 20,
    }


class AiPlannerTests(unittest.TestCase):
    def test_returns_complete_48_hour_soc_projection(self):
        result = planner.build_plan_bundle(base_inputs(), "balanced")
        self.assertEqual(48, len(result["rows"]))
        self.assertEqual({"today_end", "tomorrow_00", "tomorrow_05", "tomorrow_09", "tomorrow_end"}, set(result["checkpoints"]))
        self.assertTrue(all(0 <= row["soc_after"] <= 100 for row in result["rows"]))

    def test_reserves_energy_for_tomorrow_morning_high_prices(self):
        result = planner.build_energy_plan(base_inputs(), "balanced")
        tomorrow_sales = [row for row in result["rows"] if row["day"] == "tomorrow" and row["action"] == "sell"]
        self.assertTrue(tomorrow_sales)
        self.assertTrue(all(5 <= row["hour"] <= 9 for row in tomorrow_sales))
        self.assertTrue(all(row["soc_after"] >= 20 for row in tomorrow_sales))

    def test_cheap_night_charge_requires_profitable_future_sale(self):
        values = base_inputs()
        result = planner.build_energy_plan(values, "balanced")
        night_charges = [row for row in result["rows"] if row["action"] == "charge" and (row["hour"] >= 22 or row["hour"] <= 1)]
        self.assertTrue(night_charges)
        expensive = base_inputs()
        expensive["buy_prices"] = [{hour: 2.0 for hour in range(24)} for _ in range(2)]
        result_expensive = planner.build_energy_plan(expensive, "balanced")
        self.assertFalse(any(row["action"] == "charge" for row in result_expensive["rows"]))

    def test_missing_tomorrow_prices_creates_no_fake_tomorrow_trade(self):
        values = base_inputs()
        values["sell_prices"][1] = {}
        values["buy_prices"][1] = {}
        values["weather_factors"] = [None] * 48
        result = planner.build_energy_plan(values, "balanced")
        tomorrow = [row for row in result["rows"] if row["day"] == "tomorrow"]
        self.assertFalse(any(row["proposed"] for row in tomorrow))
        self.assertEqual(0, result["data_quality"]["tomorrow_sell_prices"])
        self.assertEqual(0, result["data_quality"]["weather_hours"])

    def test_variants_are_real_separate_simulations(self):
        result = planner.build_plan_bundle(base_inputs(), "profit")
        safe = result["variants"]["safe"]["days"][0]
        profit = result["variants"]["profit"]["days"][0]
        self.assertNotEqual((safe["sold_kwh"], safe["bought_kwh"]), (profit["sold_kwh"], profit["bought_kwh"]))

    def test_small_learning_sample_never_claims_high_confidence(self):
        values = base_inputs()
        values["recorded_days"] = 2
        result = planner.build_energy_plan(values, "balanced")
        proposed = [row for row in result["rows"] if row["proposed"]]
        self.assertTrue(proposed)
        self.assertTrue(all(row["confidence"] < 50 for row in proposed))
        self.assertEqual("wstępne uczenie", result["data_quality"]["learning_stage"])

    def test_each_day_stays_within_deye_six_range_limit(self):
        result = planner.build_energy_plan(base_inputs(), "profit")
        for day in ("today", "tomorrow"):
            rows = [row for row in result["rows"] if row["day"] == day]
            ranges = 0
            previous = "none"
            for row in rows:
                if row["action"] != previous:
                    ranges += 1
                    previous = row["action"]
            self.assertLessEqual(ranges, 6)

    def test_chart_series_preserve_solcast_correction_and_interval(self):
        result = planner.build_energy_plan(base_inputs(), "balanced")
        self.assertEqual(48, len(result["rows"]))
        for row in result["rows"]:
            self.assertIn("solcast_kwh", row)
            self.assertIn("corrected_pv_kwh", row)
            self.assertIn("forecast_low_kwh", row)
            self.assertIn("forecast_high_kwh", row)
            self.assertLessEqual(row["forecast_low_kwh"], row["corrected_pv_kwh"])
            self.assertGreaterEqual(row["forecast_high_kwh"], row["corrected_pv_kwh"])
        self.assertAlmostEqual(30, sum(row["solcast_kwh"] for row in result["rows"][:24]), places=2)

    def test_missing_solcast_is_not_rendered_as_zero_forecast(self):
        values = base_inputs()
        values["pv_forecast_available"] = [True, False]
        result = planner.build_energy_plan(values, "balanced")
        tomorrow = [row for row in result["rows"] if row["day"] == "tomorrow"]
        self.assertTrue(all(row["solcast_kwh"] is None for row in tomorrow))
        self.assertTrue(all(row["corrected_pv_kwh"] is None for row in tomorrow))
        self.assertTrue(all(row["forecast_low_kwh"] is None and row["forecast_high_kwh"] is None for row in tomorrow))


if __name__ == "__main__":
    unittest.main()
