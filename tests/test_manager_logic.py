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
    def __init__(self):
        self.calls = []

    async def async_call(self, domain, service, data, blocking=False):
        self.calls.append((domain, service, dict(data), blocking))


class FakeHass:
    def __init__(self, states):
        self.states = FakeStates(states)
        self.services = FakeServices()

    def async_create_task(self, coroutine):
        coroutine.close()
        return None


def make_runtime(soc="50", price="0.50"):
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
    return runtime


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
    def test_emergency_stop_latches_stopped_control_mode(self):
        runtime = make_runtime()
        runtime.scheduler_enabled = True
        asyncio.run(runtime.async_emergency_stop())
        self.assertTrue(runtime.emergency_stop)
        self.assertEqual(runtime.control_mode, "Stop Sell")
        runtime.emergency_stop = False
        asyncio.run(runtime.async_tick())
        self.assertEqual(runtime.control_mode, "Stop Sell")

    def test_direct_selling_is_blocked_without_soc(self):
        runtime = make_runtime(soc=None)
        with self.assertRaises(ValueError):
            asyncio.run(runtime.async_apply_settings(const.MODE_SELLING_FIRST, 5000, 120, 0))
        select_calls = [call for call in runtime.hass.services.calls if call[:2] == ("select", "select_option")]
        self.assertEqual(select_calls[-1][2]["option"], const.MODE_ZERO_EXPORT)

    def test_more_than_six_segments_is_rejected(self):
        runtime = make_runtime()
        for index, slot in enumerate(runtime.slots.values()):
            slot.enabled = True
            slot.min_soc = 10 if index % 2 else 20
        self.assertTrue(runtime.mapping_error)
        self.assertGreater(len(runtime._compress_schedule_segments()), 6)

    def test_invalid_patch_rolls_back_and_keeps_safe_mode(self):
        runtime = make_runtime()
        updates = []
        for index, slot_key in enumerate(list(runtime.slots)[:8]):
            updates.append({"slot_key": slot_key, "enabled": True, "min_soc": 10 if index % 2 else 20})
        with self.assertRaises(ValueError):
            asyncio.run(runtime.async_apply_schedule_patch(updates))
        self.assertTrue(all(not slot.enabled for slot in runtime.slots.values()))
        select_calls = [call for call in runtime.hass.services.calls if call[:2] == ("select", "select_option")]
        self.assertTrue(select_calls)
        self.assertEqual(select_calls[-1][2]["option"], const.MODE_ZERO_EXPORT)

    def test_selling_update_enters_safe_mode_before_target_mode(self):
        runtime = make_runtime()
        runtime.scheduler_enabled = True
        active = runtime.slots[runtime.active_slot_key()]
        active.enabled = True
        active.mode = const.MODE_SELLING_FIRST
        active.sell_power = 5000
        active.discharge_current = 120
        self.assertTrue(asyncio.run(runtime.async_apply_targets()))
        select_calls = [call for call in runtime.hass.services.calls if call[:2] == ("select", "select_option")]
        self.assertEqual(select_calls[0][2]["option"], const.MODE_ZERO_EXPORT)
        self.assertEqual(select_calls[-1][2]["option"], const.MODE_SELLING_FIRST)


class StatisticsTests(unittest.TestCase):
    def test_current_day_reports_progress_not_accuracy(self):
        runtime = make_runtime()
        runtime.solcast_tracking = {"date": "2026-07-18", "forecast": 50.0, "actual": 10.0}
        rows = runtime.history_daily_summary()
        today = next(row for row in rows if row["date"] == "2026-07-18")
        self.assertIsNone(today["accuracy_percent"])
        self.assertEqual(today["forecast_progress_percent"], 20.0)
        self.assertFalse(today["day_complete"])


if __name__ == "__main__":
    unittest.main()
