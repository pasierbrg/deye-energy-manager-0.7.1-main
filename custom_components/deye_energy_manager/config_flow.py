from __future__ import annotations

from typing import Any
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_NAME
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


class DeyeEnergyManagerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Config flow for Deye Energy Manager."""

    VERSION = 1
    MINOR_VERSION = 13

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()

        if user_input is not None:
            return self.async_create_entry(title=user_input[CONF_NAME], data=user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_NAME, default="Deye Energy Manager"): str,
                    vol.Required(CONF_WORK_MODE_SELECT, default=DEFAULT_WORK_MODE_SELECT): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="select")
                    ),
                    vol.Required(CONF_MAX_SELL_POWER_NUMBER, default=DEFAULT_MAX_SELL_POWER): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="number")
                    ),
                    vol.Required(CONF_DISCHARGE_CURRENT_NUMBER, default=DEFAULT_DISCHARGE_CURRENT): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="number")
                    ),
                    vol.Optional(CONF_CHARGE_CURRENT_NUMBER, default=DEFAULT_CHARGE_CURRENT): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="number")
                    ),
                    vol.Optional(CONF_GRID_CHARGE_CURRENT_NUMBER, default=DEFAULT_GRID_CHARGE_CURRENT): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="number")
                    ),
                    vol.Optional(CONF_BATTERY_SOC_SENSOR, default=DEFAULT_BATTERY_SOC): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_PRICE_SENSOR, default=DEFAULT_PRICE_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_SELL_PRICE_TOMORROW_SENSOR, default=DEFAULT_SELL_PRICE_TOMORROW_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_BUY_PRICE_TODAY_SENSOR, default=DEFAULT_BUY_PRICE_TODAY_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_BUY_PRICE_TOMORROW_SENSOR, default=DEFAULT_BUY_PRICE_TOMORROW_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_GRID_POWER_SENSOR, default=DEFAULT_GRID_POWER_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_SOLCAST_CURRENT_POWER_SENSOR, default=DEFAULT_SOLCAST_CURRENT_POWER_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_SOLCAST_FORECAST_TODAY_SENSOR, default=DEFAULT_SOLCAST_FORECAST_TODAY_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_SOLCAST_FORECAST_TOMORROW_SENSOR, default=DEFAULT_SOLCAST_FORECAST_TOMORROW_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_SOLCAST_FORECAST_DAY_3_SENSOR, default=DEFAULT_SOLCAST_FORECAST_DAY_3_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_SOLCAST_FORECAST_DAY_4_SENSOR, default=DEFAULT_SOLCAST_FORECAST_DAY_4_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_SOLCAST_FORECAST_DAY_5_SENSOR, default=DEFAULT_SOLCAST_FORECAST_DAY_5_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_SOLCAST_FORECAST_DAY_6_SENSOR, default=DEFAULT_SOLCAST_FORECAST_DAY_6_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_SOLCAST_FORECAST_DAY_7_SENSOR, default=DEFAULT_SOLCAST_FORECAST_DAY_7_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_SOLCAST_REMAINING_TODAY_SENSOR, default=DEFAULT_SOLCAST_REMAINING_TODAY_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_SOLCAST_PEAK_POWER_TODAY_SENSOR, default=DEFAULT_SOLCAST_PEAK_POWER_TODAY_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_SOLCAST_PEAK_TIME_TODAY_SENSOR, default=DEFAULT_SOLCAST_PEAK_TIME_TODAY_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                    vol.Optional(CONF_DAILY_PV_PRODUCTION_SENSOR, default=DEFAULT_DAILY_PV_PRODUCTION_SENSOR): selector.EntitySelector(
                        selector.EntitySelectorConfig(domain="sensor")
                    ),
                }
            ),
        )
