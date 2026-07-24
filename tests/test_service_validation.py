from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
import types
import unittest


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "custom_components" / "deye_energy_manager"


class _FakeVolRequired:
    def __init__(self, key, default=None):
        self.key = key
        self.default = default


class _FakeVolOptional:
    def __init__(self, key, default=None):
        self.key = key
        self.default = default


class _FakeVolInvalid(Exception):
    pass


class _FakeVolSchema:
    def __init__(self, schema):
        self.schema = schema

    def __call__(self, data):
        if not isinstance(data, dict):
            raise _FakeVolInvalid("expected dict")
        result = dict(data)
        for key, validator in self.schema.items():
            actual_key = key.key if isinstance(key, (_FakeVolRequired, _FakeVolOptional)) else key
            if actual_key not in result:
                if isinstance(key, _FakeVolRequired):
                    raise _FakeVolInvalid(f"required key {actual_key} missing")
                if isinstance(key, _FakeVolOptional) and key.default is not None:
                    result[actual_key] = key.default
                continue
            try:
                result[actual_key] = validator(result[actual_key])
            except Exception as err:
                raise _FakeVolInvalid(f"invalid value for {actual_key}: {err}") from err
        return result


def _fake_vol_all(*validators):
    def _run(value):
        for validator in validators:
            value = validator(value)
        return value
    return _run


def _fake_vol_range(*, min=None, max=None):
    def _run(value):
        if not isinstance(value, (int, float)):
            raise _FakeVolInvalid("not a number")
        if min is not None and value < min:
            raise _FakeVolInvalid(f"below {min}")
        if max is not None and value > max:
            raise _FakeVolInvalid(f"above {max}")
        return value
    return _run


def _fake_vol_coerce(type_):
    def _run(value):
        try:
            return type_(value)
        except Exception as err:
            raise _FakeVolInvalid(f"cannot coerce to {type_}") from err
    return _run


def _fake_vol_in(options):
    def _run(value):
        if value not in options:
            raise _FakeVolInvalid(f"not in {options}")
        return value
    return _run


def _fake_vol_length(*, max=None):
    def _run(value):
        if max is not None and len(value) > max:
            raise _FakeVolInvalid(f"length above {max}")
        return value
    return _run


def _install_dependencies() -> None:
    voluptuous = types.ModuleType("voluptuous")
    voluptuous.Schema = _FakeVolSchema
    voluptuous.Required = _FakeVolRequired
    voluptuous.Optional = _FakeVolOptional
    voluptuous.All = _fake_vol_all
    voluptuous.Range = _fake_vol_range
    voluptuous.Coerce = _fake_vol_coerce
    voluptuous.In = _fake_vol_in
    voluptuous.Length = _fake_vol_length
    voluptuous.Invalid = _FakeVolInvalid
    sys.modules["voluptuous"] = voluptuous

    cv = types.ModuleType("homeassistant.helpers.config_validation")
    cv.string = lambda value: value if isinstance(value, str) else (_ for _ in ()).throw(TypeError("expected string"))
    cv.boolean = bool
    sys.modules["homeassistant.helpers.config_validation"] = cv


def _install_home_assistant_stubs() -> None:
    homeassistant = types.ModuleType("homeassistant")
    core = types.ModuleType("homeassistant.core")
    helpers = types.ModuleType("homeassistant.helpers")
    event = types.ModuleType("homeassistant.helpers.event")
    storage = types.ModuleType("homeassistant.helpers.storage")
    util = types.ModuleType("homeassistant.util")
    dt = types.ModuleType("homeassistant.util.dt")
    config_entries = types.ModuleType("homeassistant.config_entries")
    config_entries.ConfigEntry = object

    class _ConfigFlowBase:
        pass

    class ConfigFlowMeta(type):
        def __init__(cls, name, bases, namespace, **kwargs):
            super().__init__(name, bases, namespace)

    class ConfigFlow(_ConfigFlowBase, metaclass=ConfigFlowMeta):
        def __init_subclass__(cls, **kwargs):
            super().__init_subclass__()

    config_entries.ConfigFlow = ConfigFlow
    config_entries.OptionsFlowWithReload = object
    const = types.ModuleType("homeassistant.const")
    const.CONF_NAME = "name"
    selector = types.ModuleType("homeassistant.helpers.selector")

    selector.SelectSelector = lambda config: None
    selector.SelectSelectorConfig = lambda **kwargs: kwargs
    selector.EntitySelector = lambda config: None
    selector.EntitySelectorConfig = lambda **kwargs: kwargs
    selector.BooleanSelector = lambda: None
    sys.modules["homeassistant.helpers.selector"] = selector
    sys.modules["homeassistant.const"] = const

    core.HomeAssistant = object
    core.ServiceCall = object
    core.callback = lambda function: function
    event.async_track_time_interval = lambda *_args, **_kwargs: lambda: None
    event.async_track_point_in_time = lambda *_args, **_kwargs: lambda: None
    event.async_track_state_change_event = lambda *_args, **_kwargs: lambda: None

    class Store:
        def __init__(self, *_args, **_kwargs):
            pass

    storage.Store = Store
    dt.now = lambda: None

    sys.modules.update(
        {
            "homeassistant": homeassistant,
            "homeassistant.core": core,
            "homeassistant.config_entries": config_entries,
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


_install_dependencies()
_install_home_assistant_stubs()
package = types.ModuleType("custom_components.deye_energy_manager")
package.__path__ = [str(PACKAGE)]
sys.modules[package.__name__] = package
const = _load_module(f"{package.__name__}.const", PACKAGE / "const.py")
manager = _load_module(f"{package.__name__}.manager", PACKAGE / "manager.py")
init = _load_module(f"{package.__name__}", PACKAGE / "__init__.py")


config_flow = _load_module(f"{package.__name__}.config_flow", PACKAGE / "config_flow.py")


class ConfigFlowRequiredEntitiesTests(unittest.TestCase):
    """Verify that the mapping wizard requires the entities needed for full control."""

    def test_required_fields_includes_all_control_entities(self):
        required = config_flow.REQUIRED_FIELDS
        self.assertIn(const.CONF_WORK_MODE_SELECT, required)
        self.assertIn(const.CONF_MAX_SELL_POWER_NUMBER, required)
        self.assertIn(const.CONF_DISCHARGE_CURRENT_NUMBER, required)
        self.assertIn(const.CONF_CHARGE_CURRENT_NUMBER, required)
        self.assertIn(const.CONF_GRID_CHARGE_CURRENT_NUMBER, required)
        self.assertIn(const.CONF_BATTERY_SOC_SENSOR, required)

    def test_price_sensors_are_not_required_globally(self):
        self.assertNotIn(const.CONF_PRICE_SENSOR, config_flow.REQUIRED_FIELDS)
        self.assertNotIn(const.CONF_SELL_PRICE_TOMORROW_SENSOR, config_flow.REQUIRED_FIELDS)


class ServiceJsonValidationTests(unittest.TestCase):
    """Verify that backend services reject malformed JSON with a clear error."""

    def test_parse_json_payload_rejects_invalid_json(self):
        with self.assertRaises(ValueError) as ctx:
            init._parse_json_payload("not json", dict)
        self.assertIn("Nieprawidłowy JSON", str(ctx.exception))

    def test_parse_json_payload_rejects_wrong_type(self):
        with self.assertRaises(ValueError) as ctx:
            init._parse_json_payload('["list"]', dict)
        self.assertIn("dict", str(ctx.exception))

    def test_parse_json_payload_accepts_valid_object(self):
        result = init._parse_json_payload('{"key": "value"}', dict)
        self.assertEqual(result, {"key": "value"})

    def test_parse_json_payload_accepts_valid_list(self):
        result = init._parse_json_payload('[{"slot": "00_01"}]', list)
        self.assertEqual(result, [{"slot": "00_01"}])

    def test_parse_json_payload_rejects_empty_string(self):
        with self.assertRaises(ValueError):
            init._parse_json_payload("", dict)

    def test_ai_data_schema_enforces_string(self):
        with self.assertRaises(Exception):
            init.AI_DATA_SCHEMA({"data": 123})

    def test_ai_data_schema_rejects_oversized_payload(self):
        with self.assertRaises(Exception):
            init.AI_DATA_SCHEMA({"data": "x" * 200001})

    def test_schedule_patch_schema_accepts_valid_json_string(self):
        result = init.SCHEDULE_PATCH_SCHEMA({"data": '[{"slot": "00_01"}]'})
        self.assertEqual(result["data"], '[{"slot": "00_01"}]')

    def test_tariff_settings_schema_rejects_non_string(self):
        with self.assertRaises(Exception):
            init.TARIFF_SETTINGS_SCHEMA({"data": {"provider": "pge"}})

    def test_apply_settings_schema_accepts_optional_charge_current(self):
        result = init.APPLY_SCHEMA({
            "mode": "Selling First",
            "sell_power": 3000,
            "discharge_current": 80,
        })
        self.assertNotIn("charge_current", result)

    def test_apply_settings_schema_accepts_optional_grid_charge_current(self):
        result = init.APPLY_SCHEMA({
            "mode": "Selling First",
            "sell_power": 3000,
            "discharge_current": 80,
            "grid_charge_current": 60,
        })
        self.assertEqual(result.get("grid_charge_current"), 60)

    def test_apply_settings_schema_rejects_unknown_mode(self):
        with self.assertRaises(Exception):
            init.APPLY_SCHEMA({
                "mode": "Normalna Praca",
                "sell_power": 3000,
                "discharge_current": 80,
            })


if __name__ == "__main__":
    unittest.main()
