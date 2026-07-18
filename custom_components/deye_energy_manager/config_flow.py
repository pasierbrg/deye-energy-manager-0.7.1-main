from __future__ import annotations

from typing import Any
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_NAME
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
    CONF_BATTERY_SOC_SENSOR,
    CONF_BUY_PRICE_TODAY_SENSOR,
    CONF_BUY_PRICE_TOMORROW_SENSOR,
    CONF_CHARGE_CURRENT_NUMBER,
    CONF_DISCHARGE_CURRENT_NUMBER,
    CONF_DAILY_PV_PRODUCTION_SENSOR,
    CONF_GRID_CHARGE_CURRENT_NUMBER,
    CONF_GRID_POWER_SENSOR,
    CONF_PV_POWER_SENSOR,
    CONF_LOAD_POWER_SENSOR,
    CONF_BATTERY_POWER_SENSOR,
    CONF_MAX_SELL_POWER_NUMBER,
    CONF_PRICE_SENSOR,
    CONF_SELL_PRICE_TOMORROW_SENSOR,
    CONF_SOLCAST_CURRENT_POWER_SENSOR,
    CONF_SOLCAST_FORECAST_DAY_3_SENSOR,
    CONF_SOLCAST_FORECAST_DAY_4_SENSOR,
    CONF_SOLCAST_FORECAST_DAY_5_SENSOR,
    CONF_SOLCAST_FORECAST_DAY_6_SENSOR,
    CONF_SOLCAST_FORECAST_DAY_7_SENSOR,
    CONF_SOLCAST_FORECAST_TODAY_SENSOR,
    CONF_SOLCAST_FORECAST_TOMORROW_SENSOR,
    CONF_SOLCAST_PEAK_POWER_TODAY_SENSOR,
    CONF_SOLCAST_PEAK_TIME_TODAY_SENSOR,
    CONF_SOLCAST_REMAINING_TODAY_SENSOR,
    CONF_WORK_MODE_SELECT,
    DEFAULT_BATTERY_SOC,
    DEFAULT_BUY_PRICE_TODAY_SENSOR,
    DEFAULT_BUY_PRICE_TOMORROW_SENSOR,
    DEFAULT_CHARGE_CURRENT,
    DEFAULT_DISCHARGE_CURRENT,
    DEFAULT_DAILY_PV_PRODUCTION_SENSOR,
    DEFAULT_GRID_CHARGE_CURRENT,
    DEFAULT_GRID_POWER_SENSOR,
    DEFAULT_PV_POWER_SENSOR,
    DEFAULT_LOAD_POWER_SENSOR,
    DEFAULT_BATTERY_POWER_SENSOR,
    DEFAULT_MAX_SELL_POWER,
    DEFAULT_PRICE_SENSOR,
    DEFAULT_SELL_PRICE_TOMORROW_SENSOR,
    DEFAULT_SOLCAST_CURRENT_POWER_SENSOR,
    DEFAULT_SOLCAST_FORECAST_DAY_3_SENSOR,
    DEFAULT_SOLCAST_FORECAST_DAY_4_SENSOR,
    DEFAULT_SOLCAST_FORECAST_DAY_5_SENSOR,
    DEFAULT_SOLCAST_FORECAST_DAY_6_SENSOR,
    DEFAULT_SOLCAST_FORECAST_DAY_7_SENSOR,
    DEFAULT_SOLCAST_FORECAST_TODAY_SENSOR,
    DEFAULT_SOLCAST_FORECAST_TOMORROW_SENSOR,
    DEFAULT_SOLCAST_PEAK_POWER_TODAY_SENSOR,
    DEFAULT_SOLCAST_PEAK_TIME_TODAY_SENSOR,
    DEFAULT_SOLCAST_REMAINING_TODAY_SENSOR,
    DEFAULT_WORK_MODE_SELECT,
    DOMAIN,
)


ENTITY_FIELDS = (
    (CONF_WORK_MODE_SELECT, DEFAULT_WORK_MODE_SELECT, "select", True),
    (CONF_MAX_SELL_POWER_NUMBER, DEFAULT_MAX_SELL_POWER, "number", True),
    (CONF_DISCHARGE_CURRENT_NUMBER, DEFAULT_DISCHARGE_CURRENT, "number", True),
    (CONF_CHARGE_CURRENT_NUMBER, DEFAULT_CHARGE_CURRENT, "number", False),
    (CONF_GRID_CHARGE_CURRENT_NUMBER, DEFAULT_GRID_CHARGE_CURRENT, "number", False),
    (CONF_BATTERY_SOC_SENSOR, DEFAULT_BATTERY_SOC, "sensor", False),
    (CONF_PRICE_SENSOR, DEFAULT_PRICE_SENSOR, "sensor", False),
    (CONF_SELL_PRICE_TOMORROW_SENSOR, DEFAULT_SELL_PRICE_TOMORROW_SENSOR, "sensor", False),
    (CONF_BUY_PRICE_TODAY_SENSOR, DEFAULT_BUY_PRICE_TODAY_SENSOR, "sensor", False),
    (CONF_BUY_PRICE_TOMORROW_SENSOR, DEFAULT_BUY_PRICE_TOMORROW_SENSOR, "sensor", False),
    (CONF_GRID_POWER_SENSOR, DEFAULT_GRID_POWER_SENSOR, "sensor", False),
    (CONF_PV_POWER_SENSOR, DEFAULT_PV_POWER_SENSOR, "sensor", False),
    (CONF_LOAD_POWER_SENSOR, DEFAULT_LOAD_POWER_SENSOR, "sensor", False),
    (CONF_BATTERY_POWER_SENSOR, DEFAULT_BATTERY_POWER_SENSOR, "sensor", False),
    (CONF_SOLCAST_CURRENT_POWER_SENSOR, DEFAULT_SOLCAST_CURRENT_POWER_SENSOR, "sensor", False),
    (CONF_SOLCAST_FORECAST_TODAY_SENSOR, DEFAULT_SOLCAST_FORECAST_TODAY_SENSOR, "sensor", False),
    (CONF_SOLCAST_FORECAST_TOMORROW_SENSOR, DEFAULT_SOLCAST_FORECAST_TOMORROW_SENSOR, "sensor", False),
    (CONF_SOLCAST_FORECAST_DAY_3_SENSOR, DEFAULT_SOLCAST_FORECAST_DAY_3_SENSOR, "sensor", False),
    (CONF_SOLCAST_FORECAST_DAY_4_SENSOR, DEFAULT_SOLCAST_FORECAST_DAY_4_SENSOR, "sensor", False),
    (CONF_SOLCAST_FORECAST_DAY_5_SENSOR, DEFAULT_SOLCAST_FORECAST_DAY_5_SENSOR, "sensor", False),
    (CONF_SOLCAST_FORECAST_DAY_6_SENSOR, DEFAULT_SOLCAST_FORECAST_DAY_6_SENSOR, "sensor", False),
    (CONF_SOLCAST_FORECAST_DAY_7_SENSOR, DEFAULT_SOLCAST_FORECAST_DAY_7_SENSOR, "sensor", False),
    (CONF_SOLCAST_REMAINING_TODAY_SENSOR, DEFAULT_SOLCAST_REMAINING_TODAY_SENSOR, "sensor", False),
    (CONF_SOLCAST_PEAK_POWER_TODAY_SENSOR, DEFAULT_SOLCAST_PEAK_POWER_TODAY_SENSOR, "sensor", False),
    (CONF_SOLCAST_PEAK_TIME_TODAY_SENSOR, DEFAULT_SOLCAST_PEAK_TIME_TODAY_SENSOR, "sensor", False),
    (CONF_DAILY_PV_PRODUCTION_SENSOR, DEFAULT_DAILY_PV_PRODUCTION_SENSOR, "sensor", False),
)


def build_config_schema(values: dict[str, Any] | None = None, include_name: bool = True) -> vol.Schema:
    values = values or {}
    fields: dict[Any, Any] = {}
    if include_name:
        fields[vol.Required(CONF_NAME, default=values.get(CONF_NAME, "Deye Energy Manager"))] = str
    for key, default, domain, required in ENTITY_FIELDS:
        marker = vol.Required if required else vol.Optional
        fields[marker(key, default=values.get(key, default))] = selector.EntitySelector(
            selector.EntitySelectorConfig(domain=domain)
        )
    return vol.Schema(fields)


class DeyeEnergyManagerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Config flow for Deye Energy Manager."""

    VERSION = 1
    MINOR_VERSION = 13

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return DeyeEnergyManagerOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(title=user_input[CONF_NAME], data=user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=build_config_schema(),
        )


class DeyeEnergyManagerOptionsFlow(config_entries.OptionsFlowWithReload):
    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)
        current = {**self.config_entry.data, **self.config_entry.options}
        return self.async_show_form(
            step_id="init",
            data_schema=build_config_schema(current, include_name=False),
        )
