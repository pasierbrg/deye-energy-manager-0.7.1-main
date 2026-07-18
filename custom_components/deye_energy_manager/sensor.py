from __future__ import annotations

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import MATCH_ALL
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import DeyeEnergyManagerEntity


class DeyeManagerSensor(DeyeEnergyManagerEntity, SensorEntity):
    # Manager attributes are live dashboard payloads and should not be duplicated in Recorder.
    _unrecorded_attributes = frozenset({MATCH_ALL})
    _attr_should_poll = False

    def __init__(
        self,
        runtime,
        key,
        name,
        value_fn,
        unit=None,
        device_class=None,
        attrs_fn=None,
        unrecorded_attributes=None,
        source_fn=None,
    ):
        super().__init__(runtime, key, name)
        self.value_fn = value_fn
        self.attrs_fn = attrs_fn
        self.source_fn = source_fn or getattr(attrs_fn, "source_fn", None)
        self._attr_native_unit_of_measurement = unit
        self._attr_device_class = device_class

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        if self.source_fn is None:
            return
        entity_id = self.source_fn(self.runtime)
        if not entity_id:
            return

        @callback
        def _source_changed(_event) -> None:
            self.async_write_ha_state()

        self.async_on_remove(async_track_state_change_event(self.hass, [entity_id], _source_changed))

    @property
    def native_value(self):
        return self.value_fn(self.runtime)

    @property
    def extra_state_attributes(self):
        return self.attrs_fn(self.runtime) if self.attrs_fn else None


def source_sensor_attrs(source_fn):
    def attrs(runtime):
        entity_id = source_fn(runtime)
        state = runtime.hass.states.get(entity_id) if entity_id else None
        data = dict(state.attributes) if state is not None else {}
        data["source_entity"] = entity_id
        return data

    attrs.source_fn = source_fn
    return attrs


def sales_stats_attrs(runtime):
    week = runtime.sales_week_rows
    month = runtime.sales_month_rows
    return {
        "hourly_today": runtime.sales_hourly_today(),
        "week": week,
        "month": month,
        "sold_value_today": runtime.sold_value_today,
        "sold_energy_current_hour": runtime.sold_energy_current_hour,
        "sold_value_current_hour": runtime.sold_value_current_hour,
        "sold_energy_week": round(sum(row["kwh"] for row in week), 4),
        "sold_value_week": round(sum(row["value"] for row in week), 4),
        "sold_energy_month": round(sum(row["kwh"] for row in month), 4),
        "sold_value_month": round(sum(row["value"] for row in month), 4),
    }


def ai_state_attrs(runtime):
    return {
        "settings": runtime.ai_settings,
        "history": runtime.ai_history,
        "history_count": len(runtime.ai_history),
        "learning_summary": runtime.learning_summary(),
        "learning_recent": runtime.learning_history[:24],
        "learning_current_hour": runtime._finalize_learning_hour(runtime.learning_tracking) if runtime.learning_tracking else {},
        "daily_summary": runtime.history_daily_summary(),
        "monthly_summary": runtime.history_monthly_summary(),
        "solcast_history": runtime.solcast_history,
        "energy_samples": runtime.energy_samples[-288:],
        "weather": runtime.weather_context(),
        "tariff": runtime.tariff_context(),
    }


def solcast_accuracy_attrs(runtime):
    tracking = runtime.solcast_tracking
    forecast = runtime.safe_float(tracking.get("forecast"), 0)
    actual = runtime.safe_float(tracking.get("actual"), 0)
    summary = runtime.learning_summary()
    return {
        "history": runtime.solcast_history,
        "historical_accuracy_percent": summary.get("solcast_accuracy_avg"),
        "historical_correction_factor": summary.get("solcast_correction_factor"),
        "completed_days": summary.get("solcast_accuracy_days", 0),
        "last_completed_day": summary.get("solcast_last_date"),
        "last_completed_accuracy_percent": summary.get("solcast_last_accuracy"),
        "current_day": tracking.get("date"),
        "forecast_today_kwh": round(forecast, 3),
        "actual_today_kwh": round(actual, 3),
        "difference_today_kwh": round(actual - forecast, 3),
        "forecast_progress_percent": round(min(100, actual / forecast * 100), 1) if forecast > 0 else None,
        "day_complete": False,
        "source_forecast": runtime.solcast_forecast_today_sensor,
        "source_actual": runtime.daily_pv_production_sensor,
    }


def diagnostics_attrs(runtime):
    return runtime.diagnostics()


def tariff_attrs(runtime):
    return runtime.tariff_context()


def weather_attrs(runtime):
    return runtime.weather_context()


def manager_status_attrs(runtime):
    return {
        "slot_grid_charge": {
            key: {
                "enabled": bool(slot.charge_enabled or slot.mode == "Charge"),
                "grid_charge_current": round(slot.grid_charge_current, 2),
                "min_soc": round(slot.min_soc, 1),
            }
            for key, slot in runtime.slots.items()
        }
    }


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback):
    runtime = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        [
            DeyeManagerSensor(runtime, "manager_status", "Manager status", lambda r: r.manager_status, attrs_fn=manager_status_attrs),
            DeyeManagerSensor(runtime, "decision_reason", "Decision reason", lambda r: r.decision_reason),
            DeyeManagerSensor(runtime, "next_active_slot", "Next active slot", lambda r: r.next_active_slot),
            DeyeManagerSensor(runtime, "last_applied_at", "Last settings applied", lambda r: r.last_applied_at or "never"),
            DeyeManagerSensor(runtime, "mapping_status", "Mapping status", lambda r: "ERROR" if r.mapping_error else "OK"),
            DeyeManagerSensor(
                runtime,
                "diagnostics",
                "System diagnostics",
                lambda r: "connected" if r.data_available else "problem",
                attrs_fn=diagnostics_attrs,
                unrecorded_attributes={"entities"},
            ),
            DeyeManagerSensor(runtime, "active_slot", "Active slot", lambda r: r.active_slot_key()),
            DeyeManagerSensor(runtime, "target_mode", "Target mode", lambda r: r.target_mode),
            DeyeManagerSensor(runtime, "target_sell_power", "Target sell power", lambda r: r.target_sell_power, "W", SensorDeviceClass.POWER),
            DeyeManagerSensor(runtime, "target_discharge_current", "Target discharge current", lambda r: r.target_discharge_current, "A", SensorDeviceClass.CURRENT),
            DeyeManagerSensor(runtime, "target_charge_current", "Target charge current", lambda r: r.target_charge_current, "A", SensorDeviceClass.CURRENT),
            DeyeManagerSensor(runtime, "battery_soc", "Battery SOC", lambda r: r.state_float(r.battery_soc_sensor, 0), "%", SensorDeviceClass.BATTERY, source_fn=lambda r: r.battery_soc_sensor),
            DeyeManagerSensor(runtime, "pv_power", "PV power", lambda r: r.state_float(r.pv_power_sensor, 0), "W", SensorDeviceClass.POWER, source_fn=lambda r: r.pv_power_sensor),
            DeyeManagerSensor(runtime, "load_power", "Load power", lambda r: r.state_float(r.load_power_sensor, 0), "W", SensorDeviceClass.POWER, source_fn=lambda r: r.load_power_sensor),
            DeyeManagerSensor(runtime, "battery_power", "Battery power", lambda r: r.normalized_battery_power(), "W", SensorDeviceClass.POWER, source_fn=lambda r: r.battery_power_sensor),
            DeyeManagerSensor(runtime, "grid_power", "Grid power", lambda r: r.normalized_grid_power(), "W", SensorDeviceClass.POWER, source_fn=lambda r: r.grid_power_sensor),
            DeyeManagerSensor(runtime, "energy_price", "Energy price", lambda r: r.state_float(r.price_sensor, 0), "PLN/kWh", source_fn=lambda r: r.price_sensor),
            DeyeManagerSensor(
                runtime,
                "sold_energy_today",
                "Sold energy today",
                lambda r: round(r.sold_energy_today, 3),
                "kWh",
                SensorDeviceClass.ENERGY,
                attrs_fn=sales_stats_attrs,
                unrecorded_attributes={"hourly_today", "week", "month"},
            ),
            DeyeManagerSensor(runtime, "sold_value_today", "Sold value today", lambda r: round(r.sold_value_today, 2), "PLN"),
            DeyeManagerSensor(runtime, "sold_energy_current_hour", "Sold energy current hour", lambda r: round(r.sold_energy_current_hour, 3), "kWh", SensorDeviceClass.ENERGY),
            DeyeManagerSensor(runtime, "sold_value_current_hour", "Sold value current hour", lambda r: round(r.sold_value_current_hour, 2), "PLN"),
            DeyeManagerSensor(runtime, "sell_price_today", "Sell price today", lambda r: r.state_float(r.price_sensor, 0), "PLN/kWh", attrs_fn=source_sensor_attrs(lambda r: r.price_sensor), source_fn=lambda r: r.price_sensor),
            DeyeManagerSensor(runtime, "sell_price_tomorrow", "Sell price tomorrow", lambda r: r.state_float(r.sell_price_tomorrow_sensor, 0), "PLN/kWh", attrs_fn=source_sensor_attrs(lambda r: r.sell_price_tomorrow_sensor), source_fn=lambda r: r.sell_price_tomorrow_sensor),
            DeyeManagerSensor(runtime, "buy_price_today", "Buy price today", lambda r: r.state_float(r.buy_price_today_sensor, 0), "PLN/kWh", attrs_fn=source_sensor_attrs(lambda r: r.buy_price_today_sensor), source_fn=lambda r: r.buy_price_today_sensor),
            DeyeManagerSensor(runtime, "buy_price_tomorrow", "Buy price tomorrow", lambda r: r.state_float(r.buy_price_tomorrow_sensor, 0), "PLN/kWh", attrs_fn=source_sensor_attrs(lambda r: r.buy_price_tomorrow_sensor), source_fn=lambda r: r.buy_price_tomorrow_sensor),
            DeyeManagerSensor(runtime, "solcast_current_power", "Solcast current power", lambda r: r.state_float(r.solcast_current_power_sensor, 0), "W", SensorDeviceClass.POWER, attrs_fn=source_sensor_attrs(lambda r: r.solcast_current_power_sensor), source_fn=lambda r: r.solcast_current_power_sensor),
            DeyeManagerSensor(runtime, "solcast_forecast_today", "Solcast forecast today", lambda r: r.solcast_forecast_today_value(), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.solcast_forecast_today_sensor), source_fn=lambda r: r.solcast_forecast_today_sensor),
            DeyeManagerSensor(runtime, "solcast_forecast_tomorrow", "Solcast forecast tomorrow", lambda r: r.state_float(r.solcast_forecast_tomorrow_sensor, 0), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.solcast_forecast_tomorrow_sensor)),
            DeyeManagerSensor(runtime, "solcast_forecast_day_3", "Solcast forecast day 3", lambda r: r.state_float(r.solcast_forecast_day_3_sensor, 0), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.solcast_forecast_day_3_sensor)),
            DeyeManagerSensor(runtime, "solcast_forecast_day_4", "Solcast forecast day 4", lambda r: r.state_float(r.solcast_forecast_day_4_sensor, 0), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.solcast_forecast_day_4_sensor)),
            DeyeManagerSensor(runtime, "solcast_forecast_day_5", "Solcast forecast day 5", lambda r: r.state_float(r.solcast_forecast_day_5_sensor, 0), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.solcast_forecast_day_5_sensor)),
            DeyeManagerSensor(runtime, "solcast_forecast_day_6", "Solcast forecast day 6", lambda r: r.state_float(r.solcast_forecast_day_6_sensor, 0), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.solcast_forecast_day_6_sensor)),
            DeyeManagerSensor(runtime, "solcast_forecast_day_7", "Solcast forecast day 7", lambda r: r.state_float(r.solcast_forecast_day_7_sensor, 0), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.solcast_forecast_day_7_sensor)),
            DeyeManagerSensor(runtime, "solcast_remaining_today", "Solcast remaining today", lambda r: r.state_float(r.solcast_remaining_today_sensor, 0), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.solcast_remaining_today_sensor)),
            DeyeManagerSensor(runtime, "solcast_peak_power_today", "Solcast peak power today", lambda r: r.state_float(r.solcast_peak_power_today_sensor, 0), "W", SensorDeviceClass.POWER, attrs_fn=source_sensor_attrs(lambda r: r.solcast_peak_power_today_sensor)),
            DeyeManagerSensor(runtime, "solcast_peak_time_today", "Solcast peak time today", lambda r: r.state_text(r.solcast_peak_time_today_sensor), attrs_fn=source_sensor_attrs(lambda r: r.solcast_peak_time_today_sensor)),
            DeyeManagerSensor(runtime, "current_work_mode", "Current work mode", lambda r: r.state_text(r.work_mode_select), source_fn=lambda r: r.work_mode_select),
            DeyeManagerSensor(runtime, "current_sell_power", "Current sell power", lambda r: r.state_float(r.max_sell_power_number, 0), "W", SensorDeviceClass.POWER, source_fn=lambda r: r.max_sell_power_number),
            DeyeManagerSensor(runtime, "current_discharge_current", "Current discharge current", lambda r: r.state_float(r.discharge_current_number, 0), "A", SensorDeviceClass.CURRENT, source_fn=lambda r: r.discharge_current_number),
            DeyeManagerSensor(runtime, "current_charge_current", "Current charge current", lambda r: r.state_float(r.charge_current_number, 0), "A", SensorDeviceClass.CURRENT, source_fn=lambda r: r.charge_current_number),
            DeyeManagerSensor(runtime, "current_grid_charge_current", "Current grid charge current", lambda r: r.state_float(r.grid_charge_current_number, 0), "A", SensorDeviceClass.CURRENT, source_fn=lambda r: r.grid_charge_current_number),
            DeyeManagerSensor(runtime, "last_action", "Last action", lambda r: r.last_action),
            DeyeManagerSensor(
                runtime,
                "ai_state",
                "AI state",
                lambda r: "ready",
                attrs_fn=ai_state_attrs,
                unrecorded_attributes={
                    "settings",
                    "history",
                    "learning_summary",
                    "learning_recent",
                    "learning_current_hour",
                    "daily_summary",
                    "monthly_summary",
                    "solcast_history",
                    "energy_samples",
                    "weather",
                    "tariff",
                },
            ),
            DeyeManagerSensor(runtime, "daily_pv_production", "Daily PV production", lambda r: r.state_float(r.daily_pv_production_sensor, 0), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.daily_pv_production_sensor), source_fn=lambda r: r.daily_pv_production_sensor),
            DeyeManagerSensor(runtime, "solcast_accuracy", "Historical Solcast accuracy", lambda r: r.learning_summary().get("solcast_accuracy_avg"), "%", attrs_fn=solcast_accuracy_attrs),
            DeyeManagerSensor(runtime, "weather_forecast", "Weather forecast support", lambda r: r.weather_context().get("condition"), attrs_fn=weather_attrs, source_fn=lambda r: r.weather_entity),
            DeyeManagerSensor(runtime, "tariff_status", "Distribution tariff", lambda r: r.tariff_context().get("zone"), attrs_fn=tariff_attrs),
        ]
    )
