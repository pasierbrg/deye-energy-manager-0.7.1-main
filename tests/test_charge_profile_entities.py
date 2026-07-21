from __future__ import annotations

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
NUMBER_SOURCE = (ROOT / "custom_components" / "deye_energy_manager" / "number.py").read_text(encoding="utf-8")
INIT_SOURCE = (ROOT / "custom_components" / "deye_energy_manager" / "__init__.py").read_text(encoding="utf-8")


class ChargeProfileEntityContractTests(unittest.TestCase):
    def test_charge_current_uses_physical_deye_range_and_restore_state(self):
        self.assertIn("class DeyeManagerNumber(DeyeEnergyManagerEntity, NumberEntity, RestoreEntity)", NUMBER_SOURCE)
        self.assertIn('"charge_profile_charge_current": self.runtime.charge_current_number', NUMBER_SOURCE)
        self.assertIn("await self.async_get_last_state()", NUMBER_SOURCE)
        self.assertIn("value = float(last_state.state)", NUMBER_SOURCE)
        self.assertIn("math.isfinite(value)", NUMBER_SOURCE)
        self.assertIn("self.native_min_value <= value <= self.native_max_value", NUMBER_SOURCE)
        self.assertIn("setattr(self.runtime, self.attr, value)", NUMBER_SOURCE)
        self.assertIn("self.runtime._charge_profile_loaded_from_store", NUMBER_SOURCE)
        self.assertIn(
            'DeyeManagerNumber(runtime, "charge_profile_charge_current", "Charge profile battery charge current", "charge_profile_charge_current", 0, 240, 5, "A")',
            NUMBER_SOURCE,
        )

    def test_backend_service_schema_uses_distinct_charge_fields(self):
        for required in (
            'vol.Required("charge_current")',
            'vol.Required("discharge_current")',
            'vol.Required("grid_charge_current")',
            'vol.Required("target_soc")',
            'vol.Required("grid_charge_enabled")',
            "await runtime.async_save_charge_profile(dict(call.data))",
        ):
            self.assertIn(required, INIT_SOURCE)


if __name__ == "__main__":
    unittest.main()
