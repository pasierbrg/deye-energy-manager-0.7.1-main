from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "custom_components" / "deye_energy_manager"


def _install_home_assistant_stubs() -> None:
    homeassistant = types.ModuleType("homeassistant")
    core = types.ModuleType("homeassistant.core")
    helpers = types.ModuleType("homeassistant.helpers")
    event = types.ModuleType("homeassistant.helpers.event")
    storage = types.ModuleType("homeassistant.helpers.storage")
    util = types.ModuleType("homeassistant.util")
    dt = types.ModuleType("homeassistant.util.dt")

    core.HomeAssistant = object
    core.callback = lambda function: function
    event.async_track_time_interval = lambda *_args, **_kwargs: lambda: None

    class Store:
        def __init__(self, *_args, **_kwargs):
            pass

    storage.Store = Store
    dt.now = lambda: datetime(2026, 7, 18, 12, 0, tzinfo=timezone.utc)

    sys.modules.update(
        {
            "homeassistant": homeassistant,
            "homeassistant.core": core,
            "homeassistant.helpers": helpers,
            "homeassistant.helpers.event": event,
            "homeassistant.helpers.storage": storage,
            "homeassistant.util": util,
            "homeassistant.util.dt": dt,
        }
    )


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


_install_home_assistant_stubs()
package = types.ModuleType("custom_components.deye_energy_manager")
package.__path__ = [str(PACKAGE)]
sys.modules[package.__name__] = package
const = _load_module(f"{package.__name__}.const", PACKAGE / "const.py")
manager = _load_module(f"{package.__name__}.manager", PACKAGE / "manager.py")
manager.ha_now = lambda: datetime(2026, 7, 18, 12, 0, tzinfo=timezone.utc)


class FakeState:
    def __init__(self, state, attributes=None, entity_id=""):
        self.entity_id = entity_id
        self.state = str(state)
        self.attributes = attributes or {}


class FakeStates:
    def __init__(self, values=None):
        self.values = values or {}
        for entity_id, state in self.values.items():
            state.entity_id = entity_id

    def get(self, entity_id):
        return self.values.get(entity_id)

    def async_all(self, domain=None):
        prefix = f"{domain}." if domain else ""
        return [state for entity_id, state in self.values.items() if entity_id.startswith(prefix)]


class FakeServices:
    def __init__(self, hass):
        self.hass = hass
        self.calls = []
        self.failures = []

    def fail_once(self, domain, service, *, entity_id=None, option=None):
        self.failures.append(
            {
                "domain": domain,
                "service": service,
                "entity_id": entity_id,
                "option": option,
                "remaining": 1,
            }
        )

    async def async_call(self, domain, service, data, blocking=False):
        self.calls.append((domain, service, dict(data), blocking))
        for failure in self.failures:
            if failure["remaining"] <= 0:
                continue
            if failure["domain"] != domain or failure["service"] != service:
                continue
            if failure["entity_id"] is not None and data.get("entity_id") != failure["entity_id"]:
                continue
            if failure["option"] is not None and data.get("option") != failure["option"]:
                continue
            failure["remaining"] -= 1
            raise RuntimeError(f"Injected {domain}.{service} failure")

        entity_id = data.get("entity_id")
        if not entity_id:
            return
        if domain == "select" and service == "select_option":
            value = data["option"]
        elif domain == "number" and service == "set_value":
            value = data["value"]
        elif domain == "switch":
            value = "on" if service == "turn_on" else "off"
        elif domain == "time" and service == "set_value":
            value = data["time"]
        else:
            return
        self.hass.states.values[entity_id] = FakeState(value, entity_id=entity_id)


class FakeHass:
    def __init__(self, states):
        self.states = FakeStates(states)
        self.services = FakeServices(self)

    def async_create_task(self, coroutine):
        coroutine.close()
        return None


def make_runtime(soc="50", price="0.50", default_mode=None):
    states = {
        const.DEFAULT_WORK_MODE_SELECT: FakeState(const.MODE_ZERO_EXPORT),
        const.DEFAULT_MAX_SELL_POWER: FakeState("0"),
        const.DEFAULT_DISCHARGE_CURRENT: FakeState("0"),
        const.DEFAULT_CHARGE_CURRENT: FakeState("0"),
        const.DEFAULT_GRID_CHARGE_CURRENT: FakeState("0"),
    }
    if soc is not None:
        states[const.DEFAULT_BATTERY_SOC] = FakeState(soc)
    if price is not None:
        states[const.DEFAULT_PRICE_SENSOR] = FakeState(price)
    runtime = manager.DeyeEnergyManagerRuntime(
        hass=FakeHass(states),
        entry_id="test",
        data={
            const.CONF_WORK_MODE_SELECT: const.DEFAULT_WORK_MODE_SELECT,
            const.CONF_MAX_SELL_POWER_NUMBER: const.DEFAULT_MAX_SELL_POWER,
            const.CONF_DISCHARGE_CURRENT_NUMBER: const.DEFAULT_DISCHARGE_CURRENT,
            const.CONF_CHARGE_CURRENT_NUMBER: const.DEFAULT_CHARGE_CURRENT,
            const.CONF_GRID_CHARGE_CURRENT_NUMBER: const.DEFAULT_GRID_CHARGE_CURRENT,
            const.CONF_BATTERY_SOC_SENSOR: const.DEFAULT_BATTERY_SOC,
            const.CONF_PRICE_SENSOR: const.DEFAULT_PRICE_SENSOR,
        },
    )
    runtime.default_work_mode = default_mode or const.MODE_ZERO_EXPORT
    runtime.default_sell_power = 13000
    runtime.default_discharge_current = 120
    runtime.default_charge_current = 120
    runtime.default_grid_charge_current = 60
    return runtime


CONTROL_NUMBERS = {
    const.DEFAULT_MAX_SELL_POWER: 13000,
    const.DEFAULT_DISCHARGE_CURRENT: 120,
    const.DEFAULT_CHARGE_CURRENT: 120,
    const.DEFAULT_GRID_CHARGE_CURRENT: 60,
}


def configure_selling_slot(runtime):
    runtime.scheduler_enabled = True
    active = runtime.slots[runtime.active_slot_key()]
    active.enabled = True
    active.mode = const.MODE_SELLING_FIRST
    active.sell_power = 5000
    active.discharge_current = 120
    return active


def control_number_calls(runtime):
    return [
        call
        for call in runtime.hass.services.calls
        if call[:2] == ("number", "set_value") and call[2].get("entity_id") in CONTROL_NUMBERS
    ]


class SafetyTests(unittest.TestCase):
    def test_missing_soc_blocks_selling(self):
        runtime = make_runtime(soc=None)
        self.assertFalse(runtime.data_available)
        self.assertFalse(runtime.soc_ok)
        self.assertFalse(runtime.sell_allowed)

    def test_unavailable_and_non_finite_soc_block_selling(self):
        for value in ("unavailable", "unknown", "nan", "inf"):
            with self.subTest(value=value):
                runtime = make_runtime(soc=value)
                self.assertFalse(runtime.soc_ok)
                self.assertFalse(runtime.sell_allowed)

    def test_price_guard_fails_closed(self):
        runtime = make_runtime(price=None)
        runtime.price_guard_enabled = True
        runtime.price_sell_threshold = 0.2
        self.assertFalse(runtime.data_available)
        self.assertFalse(runtime.price_ok)
        self.assertFalse(runtime.sell_allowed)

    def test_disabled_price_guard_does_not_require_price(self):
        runtime = make_runtime(price=None)
        runtime.price_guard_enabled = False
        runtime.price_sell_threshold = 0.2
        self.assertTrue(runtime.data_available)
        self.assertTrue(runtime.price_ok)

    def test_slot_price_limit_is_enforced_without_global_guard(self):
        runtime = make_runtime(price=None)
        runtime.scheduler_enabled = True
        runtime.price_guard_enabled = False
        active = runtime.slots[runtime.active_slot_key()]
        active.enabled = True
        active.min_sell_price = 0.2
        self.assertFalse(runtime.data_available)
        self.assertFalse(runtime.price_ok)


class MappingAndTransactionTests(unittest.TestCase):
    def assert_safe_defaults(self, runtime, expected_mode=const.MODE_ZERO_EXPORT):
        calls = control_number_calls(runtime)
        self.assertTrue(calls)
        for entity_id, expected in CONTROL_NUMBERS.items():
            entity_calls = [call for call in calls if call[2]["entity_id"] == entity_id]
            self.assertTrue(entity_calls, entity_id)
            self.assertEqual(entity_calls[-1][2]["value"], expected, entity_id)
        self.assertFalse(
            any(call[2]["value"] == 0 for call in calls),
            "Control entities must never be automatically zeroed",
        )
        select_calls = [call for call in runtime.hass.services.calls if call[:2] == ("select", "select_option")]
        self.assertTrue(select_calls)
        self.assertEqual(select_calls[-1][2]["option"], expected_mode)


    def test_stop_sell_applies_defaults_and_remains_latched(self):
        runtime = make_runtime()
        asyncio.run(runtime.async_request_stop())
        self.assertEqual(runtime.control_mode, "Stop Sell")
        self.assert_safe_defaults(runtime)
        self.assertEqual(runtime.default_sell_power, 13000)
        self.assertEqual(runtime.default_discharge_current, 120)
        self.assertEqual(runtime.default_charge_current, 120)
        self.assertEqual(runtime.default_grid_charge_current, 60)
        runtime.hass.services.calls.clear()
        asyncio.run(runtime.async_tick())
        self.assertEqual(runtime.control_mode, "Stop Sell")
        self.assert_safe_defaults(runtime)

    def test_emergency_stop_latches_stopped_control_mode(self):
        runtime = make_runtime()
        runtime.scheduler_enabled = True
        asyncio.run(runtime.async_emergency_stop())
        self.assertTrue(runtime.emergency_stop)
        self.assertEqual(runtime.control_mode, "Stop Sell")
        self.assert_safe_defaults(runtime)
        runtime.emergency_stop = False
        runtime.hass.services.calls.clear()
        asyncio.run(runtime.async_tick())
        self.assertEqual(runtime.control_mode, "Stop Sell")
        self.assert_safe_defaults(runtime)

    def test_safe_defaults_preserve_a_configured_selling_first_mode(self):
        runtime = make_runtime(default_mode=const.MODE_SELLING_FIRST)
        asyncio.run(runtime.async_emergency_stop())
        self.assert_safe_defaults(runtime, const.MODE_SELLING_FIRST)

    def test_safe_defaults_preserve_zero_export_to_ct(self):
        runtime = make_runtime(default_mode=const.MODE_ZERO_EXPORT_CT)
        asyncio.run(runtime.async_emergency_stop())
        self.assert_safe_defaults(runtime, const.MODE_ZERO_EXPORT_CT)

    def test_user_selected_zero_defaults_are_respected(self):
        runtime = make_runtime()
        runtime.default_sell_power = 0
        runtime.default_discharge_current = 0
        runtime.default_charge_current = 0
        runtime.default_grid_charge_current = 0
        asyncio.run(runtime.async_request_stop())
        calls = control_number_calls(runtime)
        self.assertEqual({call[2]["value"] for call in calls}, {0})

    def test_partial_safe_default_failure_is_reported_as_critical(self):
        runtime = make_runtime(default_mode=const.MODE_ZERO_EXPORT_CT)
        runtime.hass.services.fail_once(
            "number",
            "set_value",
            entity_id=const.DEFAULT_CHARGE_CURRENT,
        )
        self.assertFalse(asyncio.run(runtime.async_apply_safe_defaults("Test awarii")))
        self.assertIn("KRYTYCZNY", runtime.last_error)
        self.assertIn("Maximum Battery Charge Current", runtime.last_error)
        select_calls = [call for call in runtime.hass.services.calls if call[:2] == ("select", "select_option")]
        self.assertTrue(select_calls)
        self.assertTrue(all(call[2]["option"] == const.MODE_ZERO_EXPORT_CT for call in select_calls))

    def test_missing_and_unavailable_soc_apply_defaults(self):
        for soc in (None, "unavailable", "unknown"):
            with self.subTest(soc=soc):
                runtime = make_runtime(soc=soc)
                configure_selling_slot(runtime)
                self.assertFalse(asyncio.run(runtime.async_apply_targets()))
                self.assert_safe_defaults(runtime)

    def test_price_error_applies_defaults(self):
        runtime = make_runtime(price=None)
        runtime.price_guard_enabled = True
        runtime.price_sell_threshold = 0.2
        configure_selling_slot(runtime)
        self.assertFalse(asyncio.run(runtime.async_apply_targets()))
        self.assert_safe_defaults(runtime)

    def test_direct_selling_is_blocked_without_soc(self):
        runtime = make_runtime(soc=None)
        with self.assertRaises(ValueError):
            asyncio.run(runtime.async_apply_settings(const.MODE_SELLING_FIRST, 5000, 120, 0))
        self.assert_safe_defaults(runtime)

    def test_more_than_six_segments_is_rejected(self):
        runtime = make_runtime()
        for index, slot in enumerate(runtime.slots.values()):
            slot.enabled = True
            slot.min_soc = 10 if index % 2 else 20
        self.assertTrue(runtime.mapping_error)
        self.assertGreater(len(runtime._compress_schedule_segments()), 6)
        self.assertFalse(asyncio.run(runtime.async_apply_targets()))
        self.assert_safe_defaults(runtime)

    def test_invalid_patch_rolls_back_and_keeps_safe_mode(self):
        runtime = make_runtime()
        updates = []
        for index, slot_key in enumerate(list(runtime.slots)[:8]):
            updates.append({"slot_key": slot_key, "enabled": True, "min_soc": 10 if index % 2 else 20})
        with self.assertRaises(ValueError):
            asyncio.run(runtime.async_apply_schedule_patch(updates))
        self.assertTrue(all(not slot.enabled for slot in runtime.slots.values()))
        self.assert_safe_defaults(runtime)

    def test_tou_write_error_restores_defaults(self):
        runtime = make_runtime(default_mode=const.MODE_ZERO_EXPORT_CT)
        configure_selling_slot(runtime)
        runtime.hass.services.fail_once("time", "set_value")
        self.assertFalse(asyncio.run(runtime.async_apply_targets()))
        self.assert_safe_defaults(runtime, const.MODE_ZERO_EXPORT_CT)
        self.assertIn("ustawienia domyślne", runtime.last_error)

    def test_numeric_write_error_restores_defaults(self):
        runtime = make_runtime()
        configure_selling_slot(runtime)
        runtime.hass.services.fail_once(
            "number",
            "set_value",
            entity_id=const.DEFAULT_MAX_SELL_POWER,
        )
        self.assertFalse(asyncio.run(runtime.async_apply_targets()))
        self.assert_safe_defaults(runtime)

    def test_target_mode_error_restores_defaults(self):
        runtime = make_runtime()
        configure_selling_slot(runtime)
        runtime.hass.services.fail_once(
            "select",
            "select_option",
            option=const.MODE_SELLING_FIRST,
        )
        self.assertFalse(asyncio.run(runtime.async_apply_targets()))
        self.assert_safe_defaults(runtime)

    def test_failed_schedule_patch_rolls_back_and_restores_defaults(self):
        runtime = make_runtime()
        slot_key = runtime.active_slot_key()
        runtime.hass.services.fail_once(
            "number",
            "set_value",
            entity_id=const.DEFAULT_MAX_SELL_POWER,
        )
        with self.assertRaises(RuntimeError):
            asyncio.run(
                runtime.async_apply_schedule_patch(
                    [
                        {
                            "slot_key": slot_key,
                            "enabled": True,
                            "mode": const.MODE_SELLING_FIRST,
                            "sell_power": 5000,
                            "discharge_current": 120,
                        }
                    ]
                )
            )
        self.assertFalse(runtime.slots[slot_key].enabled)
        self.assert_safe_defaults(runtime)

    def test_selling_update_writes_numbers_before_target_mode(self):
        runtime = make_runtime()
        configure_selling_slot(runtime)
        self.assertTrue(asyncio.run(runtime.async_apply_targets()))
        select_calls = [call for call in runtime.hass.services.calls if call[:2] == ("select", "select_option")]
        self.assertEqual(select_calls[-1][2]["option"], const.MODE_SELLING_FIRST)
        self.assertFalse(any(call[2]["value"] == 0 for call in control_number_calls(runtime)))
        ordered_control_calls = [
            call
            for call in runtime.hass.services.calls
            if call[:2] in (("select", "select_option"), ("number", "set_value"))
            and (
                call[2].get("entity_id") == const.DEFAULT_WORK_MODE_SELECT
                or call[2].get("entity_id") in CONTROL_NUMBERS
            )
        ]
        self.assertEqual(ordered_control_calls[-1][2]["option"], const.MODE_SELLING_FIRST)
        self.assertTrue(all(call[:2] == ("number", "set_value") for call in ordered_control_calls[:-1]))

    def test_direct_settings_do_not_use_transitional_zeroes(self):
        runtime = make_runtime()
        asyncio.run(runtime.async_apply_settings(const.MODE_SELLING_FIRST, 5000, 120, 120))
        self.assertFalse(any(call[2]["value"] == 0 for call in control_number_calls(runtime)))
        select_calls = [call for call in runtime.hass.services.calls if call[:2] == ("select", "select_option")]
        self.assertEqual(len(select_calls), 1)
        self.assertEqual(select_calls[-1][2]["option"], const.MODE_SELLING_FIRST)

    def test_restore_defaults_uses_exact_mode_after_all_numeric_values(self):
        for mode in (
            const.MODE_ZERO_EXPORT,
            const.MODE_ZERO_EXPORT_CT,
            const.MODE_SELLING_FIRST,
        ):
            with self.subTest(mode=mode):
                runtime = make_runtime(default_mode=mode)
                runtime.scheduler_enabled = True
                runtime.charge_scheduler_enabled = True

                asyncio.run(runtime.async_restore_defaults())

                ordered_control_calls = [
                    call
                    for call in runtime.hass.services.calls
                    if call[:2] in (("select", "select_option"), ("number", "set_value"))
                    and (
                        call[2].get("entity_id") == const.DEFAULT_WORK_MODE_SELECT
                        or call[2].get("entity_id") in CONTROL_NUMBERS
                    )
                ]
                self.assertEqual(
                    [call[2]["entity_id"] for call in ordered_control_calls[:-1]],
                    list(CONTROL_NUMBERS),
                )
                self.assertEqual(
                    [call[2]["value"] for call in ordered_control_calls[:-1]],
                    list(CONTROL_NUMBERS.values()),
                )
                self.assertEqual(ordered_control_calls[-1][2]["option"], mode)
                self.assertFalse(runtime.scheduler_enabled)
                self.assertFalse(runtime.charge_scheduler_enabled)
                self.assertEqual(runtime.last_error, "")

    def test_restore_defaults_raises_when_full_set_is_not_confirmed(self):
        runtime = make_runtime(default_mode=const.MODE_ZERO_EXPORT_CT)
        runtime.hass.services.fail_once(
            "number",
            "set_value",
            entity_id=const.DEFAULT_CHARGE_CURRENT,
        )

        with self.assertRaisesRegex(RuntimeError, "KRYTYCZNY"):
            asyncio.run(runtime.async_restore_defaults())

        self.assertIn("Maximum Battery Charge Current", runtime.last_error)
        self.assertNotEqual(runtime.last_error, "")


class FuturePlanTests(unittest.TestCase):
    class MemoryStore:
        def __init__(self):
            self.value = None

        async def async_save(self, value):
            self.value = value

        async def async_load(self):
            return self.value

    def test_future_plan_is_stored_exactly_and_not_applied_early(self):
        runtime = make_runtime()
        runtime._ai_store = self.MemoryStore()
        update = {
            "slot_key": "05_06", "enabled": True, "charge_enabled": False,
            "mode": const.MODE_SELLING_FIRST, "sell_power": 5000,
            "discharge_current": 120, "charge_current": 0,
            "grid_charge_current": 0, "min_soc": 20, "min_sell_price": 0.9,
        }
        asyncio.run(runtime.async_save_future_plan({
            "date": "2026-07-19", "strategy": "balanced",
            "labels": ["05:00–06:00"], "updates": [update],
        }))
        self.assertEqual("scheduled", runtime.future_plan["status"])
        self.assertEqual([update], runtime.future_plan["updates"])
        before = list(runtime.hass.services.calls)
        asyncio.run(runtime.async_process_future_plan())
        self.assertEqual(before, runtime.hass.services.calls)
        self.assertEqual("scheduled", runtime.future_plan["status"])

    def test_future_plan_rejects_wrong_date(self):
        runtime = make_runtime()
        runtime._ai_store = self.MemoryStore()
        with self.assertRaisesRegex(ValueError, "wyłącznie na jutro"):
            asyncio.run(runtime.async_save_future_plan({
                "date": "2026-07-18",
                "updates": [{"slot_key": "05_06", "mode": const.MODE_SELLING_FIRST}],
            }))

    def test_future_plan_survives_runtime_reload_and_can_be_cancelled(self):
        store = self.MemoryStore()
        store.value = {
            "settings": {}, "history": [], "last_saved_at": "",
            "future_plan": {
                "date": "2026-07-19", "status": "scheduled",
                "updates": [{"slot_key": "05_06", "mode": const.MODE_SELLING_FIRST}],
            },
        }
        runtime = make_runtime()
        previous_store = manager.Store
        manager.Store = lambda *_args, **_kwargs: store
        try:
            asyncio.run(runtime.async_load_ai_data())
        finally:
            manager.Store = previous_store
        self.assertEqual("scheduled", runtime.future_plan["status"])
        asyncio.run(runtime.async_cancel_future_plan())
        self.assertEqual("cancelled", runtime.future_plan["status"])
        self.assertEqual("cancelled", store.value["future_plan"]["status"])

    def test_failed_activation_uses_full_user_defaults(self):
        runtime = make_runtime(price=None, default_mode=const.MODE_ZERO_EXPORT_CT)
        runtime._ai_store = self.MemoryStore()
        runtime.future_plan = {
            "date": "2026-07-19", "status": "scheduled",
            "updates": [{
                "slot_key": "05_06", "enabled": True,
                "mode": const.MODE_SELLING_FIRST,
                "sell_power": 5000, "discharge_current": 120,
            }],
        }
        previous_now = manager.ha_now
        manager.ha_now = lambda: datetime(2026, 7, 19, 0, 1, tzinfo=timezone.utc)
        try:
            asyncio.run(runtime.async_process_future_plan())
        finally:
            manager.ha_now = previous_now
        self.assertEqual("failed", runtime.future_plan["status"])
        calls = control_number_calls(runtime)
        self.assertTrue(calls)
        self.assertFalse(any(call[2]["value"] == 0 for call in calls))
        mode_calls = [call for call in runtime.hass.services.calls if call[:2] == ("select", "select_option")]
        self.assertEqual(const.MODE_ZERO_EXPORT_CT, mode_calls[-1][2]["option"])


class StatisticsTests(unittest.TestCase):
    def test_current_day_reports_progress_not_accuracy(self):
        runtime = make_runtime()
        runtime.solcast_tracking = {"date": "2026-07-18", "forecast": 50.0, "actual": 10.0}
        rows = runtime.history_daily_summary()
        today = next(row for row in rows if row["date"] == "2026-07-18")
        self.assertIsNone(today["accuracy_percent"])
        self.assertEqual(today["forecast_progress_percent"], 20.0)
        self.assertFalse(today["day_complete"])

    def test_historical_accuracy_uses_only_completed_days(self):
        runtime = make_runtime()
        runtime.solcast_history = [
            {"date": "2026-07-17", "forecast_kwh": 50, "actual_kwh": 40, "accuracy_percent": 80, "day_complete": True},
            {"date": "2026-07-16", "forecast_kwh": 20, "actual_kwh": 40, "accuracy_percent": 0, "day_complete": True},
            {"date": "2026-07-18", "forecast_kwh": 60, "actual_kwh": 6, "accuracy_percent": None, "day_complete": False},
        ]
        runtime.solcast_tracking = {"date": "2026-07-18", "forecast": 60, "actual": 6}
        summary = runtime.learning_summary()
        self.assertEqual(summary["solcast_accuracy_days"], 2)
        self.assertEqual(summary["solcast_accuracy_avg"], 40.0)
        self.assertEqual(summary["solcast_correction_factor"], 1.15)
        self.assertEqual(summary["current_forecast_progress"], 10.0)

    def test_g12w_weekend_is_offpeak_all_day(self):
        saturday = datetime(2026, 7, 18, 12, 0, tzinfo=timezone.utc)
        profile = manager.hourly_tariff_profile(saturday, "g12w", 0.5, 0.2)
        self.assertTrue(all(row["zone"] == "offpeak" for row in profile))
        self.assertTrue(all(row["rate"] == 0.2 for row in profile))

    def test_flow_signs_are_configurable(self):
        runtime = make_runtime()
        runtime.hass.states.values[const.DEFAULT_GRID_POWER_SENSOR] = FakeState("500")
        runtime.hass.states.values[const.DEFAULT_BATTERY_POWER_SENSOR] = FakeState("-700")
        runtime.data[const.CONF_GRID_POWER_SENSOR] = const.DEFAULT_GRID_POWER_SENSOR
        runtime.data[const.CONF_BATTERY_POWER_SENSOR] = const.DEFAULT_BATTERY_POWER_SENSOR
        self.assertEqual(runtime.normalized_grid_power(), 500)
        self.assertEqual(runtime.normalized_battery_power(), -700)
        runtime.data[const.CONF_GRID_POSITIVE_IS_IMPORT] = False
        runtime.data[const.CONF_BATTERY_POSITIVE_IS_DISCHARGE] = False
        self.assertEqual(runtime.normalized_grid_power(), -500)
        self.assertEqual(runtime.normalized_battery_power(), 700)


if __name__ == "__main__":
    unittest.main()
