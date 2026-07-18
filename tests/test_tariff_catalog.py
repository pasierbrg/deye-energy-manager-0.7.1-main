from __future__ import annotations

from datetime import date, datetime
import importlib.util
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "custom_components" / "deye_energy_manager" / "tariffs.py"
SPEC = importlib.util.spec_from_file_location("dem_tariffs_catalog_tests", MODULE_PATH)
tariffs = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(tariffs)


class TariffCatalogTests(unittest.TestCase):
    def setUp(self):
        self.catalog = tariffs.load_bundled_catalog()

    def test_all_primary_polish_dso_are_present(self):
        self.assertTrue({"pge", "tauron", "enea", "energa", "stoen"}.issubset(self.catalog["providers"]))
        for provider in ("pge", "tauron", "enea", "energa", "stoen"):
            self.assertIn("g11", self.catalog["providers"][provider]["tariffs"])

    def test_pge_two_hour_window_changes_with_season(self):
        summer = tariffs.catalog_tariff_row(datetime(2026, 7, 18, 16), self.catalog, "pge", "g12")
        winter = tariffs.catalog_tariff_row(datetime(2026, 1, 15, 14), self.catalog, "pge", "g12")
        wrong_summer_hour = tariffs.catalog_tariff_row(datetime(2026, 7, 18, 14), self.catalog, "pge", "g12")
        self.assertEqual("offpeak", summer["zone"])
        self.assertEqual("offpeak", winter["zone"])
        self.assertEqual("peak", wrong_summer_hour["zone"])

    def test_weekends_and_polish_holidays_use_offpeak_zone(self):
        saturday = tariffs.catalog_tariff_row(datetime(2026, 7, 18, 12), self.catalog, "energa", "g12w")
        christmas = tariffs.catalog_tariff_row(datetime(2026, 12, 25, 12), self.catalog, "enea", "g12w")
        self.assertEqual("offpeak", saturday["zone"])
        self.assertEqual("offpeak", christmas["zone"])

    def test_seasonal_enea_profile_uses_summer_day_window(self):
        summer = tariffs.catalog_tariff_row(datetime(2026, 7, 20, 12), self.catalog, "enea", "g12sezon")
        winter = tariffs.catalog_tariff_row(datetime(2026, 1, 20, 12), self.catalog, "enea", "g12sezon")
        self.assertEqual("recommended", summer["zone"])
        self.assertEqual("recommended", winter["zone"])

    def test_profile_contains_today_and_tomorrow(self):
        profile = tariffs.catalog_hourly_profile(datetime(2026, 7, 18, 8), self.catalog, "tauron", "g13", 48)
        self.assertEqual(48, len(profile))
        self.assertEqual("2026-07-18", profile[0]["date"])
        self.assertEqual("2026-07-19", profile[-1]["date"])
        self.assertTrue(all(row["total_distribution_rate"] >= row["rate"] for row in profile))

    def test_invalid_remote_catalog_is_rejected(self):
        with self.assertRaises(ValueError):
            tariffs.validate_catalog({"schema_version": 1, "catalog_version": "x", "providers": {}})

    def test_dynamic_plan_is_listed_but_not_used_without_signal(self):
        plans = {row["id"]: row for row in tariffs.available_tariffs(self.catalog, "tauron")}
        self.assertIn("g14dynamic", plans)
        self.assertFalse(plans["g14dynamic"]["available"])
        self.assertIn("sygnału", plans["g14dynamic"]["unavailable_reason"])

    def test_future_plan_is_not_activated_early(self):
        plan = self.catalog["providers"]["stoen"]["tariffs"]["g12eko"]
        available, reason = tariffs.tariff_availability(plan, date(2026, 7, 18))
        self.assertFalse(available)
        self.assertIn("2026-10-01", reason)

    def test_manual_profile_honors_custom_windows(self):
        profile = tariffs.hourly_tariff_profile(
            datetime(2026, 7, 20, 0), "custom", 0.55, 0.10, "09:00-11:00", "other"
        )
        self.assertEqual("offpeak", profile[9]["zone"])
        self.assertEqual(0.10, profile[9]["rate"])
        self.assertEqual("peak", profile[12]["zone"])


if __name__ == "__main__":
    unittest.main()
