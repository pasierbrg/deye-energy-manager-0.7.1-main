from __future__ import annotations

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import DeyeEnergyManagerEntity


class DeyeManagerSensor(DeyeEnergyManagerEntity, SensorEntity):
    def __init__(self, runtime, key, name, value_fn, unit=None, device_class=None, attrs_fn=None):
        super().__init__(runtime, key, name)
        self.value_fn = value_fn
        self.attrs_fn = attrs_fn
        self._attr_native_unit_of_measurement = unit
        self._attr_device_class = device_class

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
    }


def solcast_accuracy_attrs(runtime):
    tracking = runtime.solcast_tracking
    forecast = runtime.safe_float(tracking.get("forecast"), 0)
    actual = runtime.safe_float(tracking.get("actual"), 0)
    return {
        "history": runtime.solcast_history,
        "current_day": tracking.get("date"),
        "forecast_today_kwh": round(forecast, 3),
        "actual_today_kwh": round(actual, 3),
        "difference_today_kwh": round(actual - forecast, 3),
        "source_forecast": runtime.solcast_forecast_today_sensor,
        "source_actual": runtime.daily_pv_production_sensor,
    }


def diagnostics_attrs(runtime):
    return runtime.diagnostics()


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
            DeyeManagerSensor(runtime, "diagnostics", "System diagnostics", lambda r: "connected" if r.data_available else "problem", attrs_fn=diagnostics_attrs),
            DeyeManagerSensor(runtime, "active_slot", "Active slot", lambda r: r.active_slot_key()),
            DeyeManagerSensor(runtime, "target_mode", "Target mode", lambda r: r.target_mode),
            DeyeManagerSensor(runtime, "target_sell_power", "Target sell power", lambda r: r.target_sell_power, "W", SensorDeviceClass.POWER),
            DeyeManagerSensor(runtime, "target_discharge_current", "Target discharge current", lambda r: r.target_discharge_current, "A", SensorDeviceClass.CURRENT),
            DeyeManagerSensor(runtime, "target_charge_current", "Target charge current", lambda r: r.target_charge_current, "A", SensorDeviceClass.CURRENT),
            DeyeManagerSensor(runtime, "battery_soc", "Battery SOC", lambda r: r.state_float(r.battery_soc_sensor, 0), "%", SensorDeviceClass.BATTERY),
            DeyeManagerSensor(runtime, "energy_price", "Energy price", lambda r: r.state_float(r.price_sensor, 0), "PLN/kWh"),
            DeyeManagerSensor(runtime, "sold_energy_today", "Sold energy today", lambda r: round(r.sold_energy_today, 3), "kWh", SensorDeviceClass.ENERGY, attrs_fn=sales_stats_attrs),
            DeyeManagerSensor(runtime, "sold_value_today", "Sold value today", lambda r: round(r.sold_value_today, 2), "PLN"),
            DeyeManagerSensor(runtime, "sold_energy_current_hour", "Sold energy current hour", lambda r: round(r.sold_energy_current_hour, 3), "kWh", SensorDeviceClass.ENERGY),
            DeyeManagerSensor(runtime, "sold_value_current_hour", "Sold value current hour", lambda r: round(r.sold_value_current_hour, 2), "PLN"),
            DeyeManagerSensor(runtime, "sell_price_today", "Sell price today", lambda r: r.state_float(r.price_sensor, 0), "PLN/kWh", attrs_fn=source_sensor_attrs(lambda r: r.price_sensor)),
            DeyeManagerSensor(runtime, "sell_price_tomorrow", "Sell price tomorrow", lambda r: r.state_float(r.sell_price_tomorrow_sensor, 0), "PLN/kWh", attrs_fn=source_sensor_attrs(lambda r: r.sell_price_tomorrow_sensor)),
            DeyeManagerSensor(runtime, "buy_price_today", "Buy price today", lambda r: r.state_float(r.buy_price_today_sensor, 0), "PLN/kWh", attrs_fn=source_sensor_attrs(lambda r: r.buy_price_today_sensor)),
            DeyeManagerSensor(runtime, "buy_price_tomorrow", "Buy price tomorrow", lambda r: r.state_float(r.buy_price_tomorrow_sensor, 0), "PLN/kWh", attrs_fn=source_sensor_attrs(lambda r: r.buy_price_tomorrow_sensor)),
            DeyeManagerSensor(runtime, "solcast_current_power", "Solcast current power", lambda r: r.state_float(r.solcast_current_power_sensor, 0), "W", SensorDeviceClass.POWER, attrs_fn=source_sensor_attrs(lambda r: r.solcast_current_power_sensor)),
            DeyeManagerSensor(runtime, "solcast_forecast_today", "Solcast forecast today", lambda r: r.solcast_forecast_today_value(), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.solcast_forecast_today_sensor)),
            DeyeManagerSensor(runtime, "solcast_forecast_tomorrow", "Solcast forecast tomorrow", lambda r: r.state_float(r.solcast_forecast_tomorrow_sensor, 0), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.solcast_forecast_tomorrow_sensor)),
            DeyeManagerSensor(runtime, "solcast_forecast_day_3", "Solcast forecast day 3", lambda r: r.state_float(r.solcast_forecast_day_3_sensor, 0), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.solcast_forecast_day_3_sensor)),
            DeyeManagerSensor(runtime, "solcast_forecast_day_4", "Solcast forecast day 4", lambda r: r.state_float(r.solcast_forecast_day_4_sensor, 0), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.solcast_forecast_day_4_sensor)),
            DeyeManagerSensor(runtime, "solcast_forecast_day_5", "Solcast forecast day 5", lambda r: r.state_float(r.solcast_forecast_day_5_sensor, 0), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.solcast_forecast_day_5_sensor)),
            DeyeManagerSensor(runtime, "solcast_forecast_day_6", "Solcast forecast day 6", lambda r: r.state_float(r.solcast_forecast_day_6_sensor, 0), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.solcast_forecast_day_6_sensor)),
            DeyeManagerSensor(runtime, "solcast_forecast_day_7", "Solcast forecast day 7", lambda r: r.state_float(r.solcast_forecast_day_7_sensor, 0), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.solcast_forecast_day_7_sensor)),
            DeyeManagerSensor(runtime, "solcast_remaining_today", "Solcast remaining today", lambda r: r.state_float(r.solcast_remaining_today_sensor, 0), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.solcast_remaining_today_sensor)),
            DeyeManagerSensor(runtime, "solcast_peak_power_today", "Solcast peak power today", lambda r: r.state_float(r.solcast_peak_power_today_sensor, 0), "W", SensorDeviceClass.POWER, attrs_fn=source_sensor_attrs(lambda r: r.solcast_peak_power_today_sensor)),
            DeyeManagerSensor(runtime, "solcast_peak_time_today", "Solcast peak time today", lambda r: r.state_text(r.solcast_peak_time_today_sensor), attrs_fn=source_sensor_attrs(lambda r: r.solcast_peak_time_today_sensor)),
            DeyeManagerSensor(runtime, "current_work_mode", "Current work mode", lambda r: r.state_text(r.work_mode_select)),
            DeyeManagerSensor(runtime, "current_sell_power", "Current sell power", lambda r: r.state_float(r.max_sell_power_number, 0), "W", SensorDeviceClass.POWER),
            DeyeManagerSensor(runtime, "current_discharge_current", "Current discharge current", lambda r: r.state_float(r.discharge_current_number, 0), "A", SensorDeviceClass.CURRENT),
            DeyeManagerSensor(runtime, "current_charge_current", "Current charge current", lambda r: r.state_float(r.charge_current_number, 0), "A", SensorDeviceClass.CURRENT),
            DeyeManagerSensor(runtime, "current_grid_charge_current", "Current grid charge current", lambda r: r.state_float(r.grid_charge_current_number, 0), "A", SensorDeviceClass.CURRENT),
            DeyeManagerSensor(runtime, "last_action", "Last action", lambda r: r.last_action),
            DeyeManagerSensor(runtime, "ai_state", "AI state", lambda r: "ready", attrs_fn=ai_state_attrs),
            DeyeManagerSensor(runtime, "daily_pv_production", "Daily PV production", lambda r: r.state_float(r.daily_pv_production_sensor, 0), "kWh", SensorDeviceClass.ENERGY, attrs_fn=source_sensor_attrs(lambda r: r.daily_pv_production_sensor)),
            DeyeManagerSensor(runtime, "solcast_accuracy", "Solcast accuracy", lambda r: round(r.solcast_history[0].get("accuracy_percent", 0), 1) if r.solcast_history else 0, "%", attrs_fn=solcast_accuracy_attrs),
        ]
    )
