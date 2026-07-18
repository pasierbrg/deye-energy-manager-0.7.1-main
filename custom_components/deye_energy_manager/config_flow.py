from __future__ import annotations

from typing import Any, Iterable

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.const import CONF_NAME
from homeassistant.core import callback
from homeassistant.helpers import selector

from .const import (
    CONF_BATTERY_POSITIVE_IS_DISCHARGE,
    CONF_BATTERY_POWER_SENSOR,
    CONF_BATTERY_SOC_SENSOR,
    CONF_BUY_PRICE_TODAY_SENSOR,
    CONF_BUY_PRICE_TOMORROW_SENSOR,
    CONF_CHARGE_CURRENT_NUMBER,
    CONF_CUSTOM_OFFPEAK_WINDOWS,
    CONF_DAILY_PV_PRODUCTION_SENSOR,
    CONF_DISCHARGE_CURRENT_NUMBER,
    CONF_DISTRIBUTION_OFFPEAK_RATE,
    CONF_DISTRIBUTION_PEAK_RATE,
    CONF_GRID_CHARGE_CURRENT_NUMBER,
    CONF_GRID_POSITIVE_IS_IMPORT,
    CONF_GRID_POWER_SENSOR,
    CONF_LOAD_POWER_SENSOR,
    CONF_MAPPING_MODE,
    CONF_MAX_SELL_POWER_NUMBER,
    CONF_OSD_PROVIDER,
    CONF_PRICE_SENSOR,
    CONF_PRICE_SOURCE,
    CONF_PV_POWER_SENSOR,
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
    CONF_TARIFF_PLAN,
    CONF_WEATHER_ENTITY,
    CONF_WORK_MODE_SELECT,
    DEFAULT_BATTERY_POSITIVE_IS_DISCHARGE,
    DEFAULT_BATTERY_POWER_SENSOR,
    DEFAULT_BATTERY_SOC,
    DEFAULT_BUY_PRICE_TODAY_SENSOR,
    DEFAULT_BUY_PRICE_TOMORROW_SENSOR,
    DEFAULT_CHARGE_CURRENT,
    DEFAULT_CUSTOM_OFFPEAK_WINDOWS,
    DEFAULT_DAILY_PV_PRODUCTION_SENSOR,
    DEFAULT_DISCHARGE_CURRENT,
    DEFAULT_DISTRIBUTION_OFFPEAK_RATE,
    DEFAULT_DISTRIBUTION_PEAK_RATE,
    DEFAULT_GRID_CHARGE_CURRENT,
    DEFAULT_GRID_POSITIVE_IS_IMPORT,
    DEFAULT_GRID_POWER_SENSOR,
    DEFAULT_LOAD_POWER_SENSOR,
    DEFAULT_MAPPING_MODE,
    DEFAULT_MAX_SELL_POWER,
    DEFAULT_OSD_PROVIDER,
    DEFAULT_PRICE_SENSOR,
    DEFAULT_PRICE_SOURCE,
    DEFAULT_PV_POWER_SENSOR,
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
    DEFAULT_TARIFF_PLAN,
    DEFAULT_WEATHER_ENTITY,
    DEFAULT_WORK_MODE_SELECT,
    DOMAIN,
)


ENTITY_SPECS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    CONF_WORK_MODE_SELECT: (DEFAULT_WORK_MODE_SELECT, "select", ("system work mode", "tryb pracy", "work mode")),
    CONF_MAX_SELL_POWER_NUMBER: (DEFAULT_MAX_SELL_POWER, "number", ("max sell power", "maksymalna moc sprzedaży")),
    CONF_DISCHARGE_CURRENT_NUMBER: (DEFAULT_DISCHARGE_CURRENT, "number", ("battery discharge current", "prąd rozładowania")),
    CONF_CHARGE_CURRENT_NUMBER: (DEFAULT_CHARGE_CURRENT, "number", ("battery charge current", "prąd ładowania")),
    CONF_GRID_CHARGE_CURRENT_NUMBER: (DEFAULT_GRID_CHARGE_CURRENT, "number", ("grid charge current", "ładowania z sieci")),
    CONF_BATTERY_SOC_SENSOR: (DEFAULT_BATTERY_SOC, "sensor", ("battery", "soc", "stan baterii")),
    CONF_GRID_POWER_SENSOR: (DEFAULT_GRID_POWER_SENSOR, "sensor", ("grid power", "moc sieci")),
    CONF_PV_POWER_SENSOR: (DEFAULT_PV_POWER_SENSOR, "sensor", ("pv power", "moc pv")),
    CONF_LOAD_POWER_SENSOR: (DEFAULT_LOAD_POWER_SENSOR, "sensor", ("load power", "moc domu", "zużycie")),
    CONF_BATTERY_POWER_SENSOR: (DEFAULT_BATTERY_POWER_SENSOR, "sensor", ("battery power", "moc baterii")),
    CONF_DAILY_PV_PRODUCTION_SENSOR: (DEFAULT_DAILY_PV_PRODUCTION_SENSOR, "sensor", ("daily pv production", "produkcja pv dzisiaj")),
    CONF_PRICE_SENSOR: (DEFAULT_PRICE_SENSOR, "sensor", ("cena sprzedaży", "sell price", "rce")),
    CONF_SELL_PRICE_TOMORROW_SENSOR: (DEFAULT_SELL_PRICE_TOMORROW_SENSOR, "sensor", ("cena sprzedaży jutro", "sell price tomorrow")),
    CONF_BUY_PRICE_TODAY_SENSOR: (DEFAULT_BUY_PRICE_TODAY_SENSOR, "sensor", ("cena zakupu", "buy price today")),
    CONF_BUY_PRICE_TOMORROW_SENSOR: (DEFAULT_BUY_PRICE_TOMORROW_SENSOR, "sensor", ("cena zakupu jutro", "buy price tomorrow")),
    CONF_SOLCAST_CURRENT_POWER_SENSOR: (DEFAULT_SOLCAST_CURRENT_POWER_SENSOR, "sensor", ("solcast", "aktualna moc")),
    CONF_SOLCAST_FORECAST_TODAY_SENSOR: (DEFAULT_SOLCAST_FORECAST_TODAY_SENSOR, "sensor", ("solcast", "prognoza na dzisiaj")),
    CONF_SOLCAST_FORECAST_TOMORROW_SENSOR: (DEFAULT_SOLCAST_FORECAST_TOMORROW_SENSOR, "sensor", ("solcast", "prognoza na jutro")),
    CONF_SOLCAST_FORECAST_DAY_3_SENSOR: (DEFAULT_SOLCAST_FORECAST_DAY_3_SENSOR, "sensor", ("solcast", "dzień 3", "day 3")),
    CONF_SOLCAST_FORECAST_DAY_4_SENSOR: (DEFAULT_SOLCAST_FORECAST_DAY_4_SENSOR, "sensor", ("solcast", "dzień 4", "day 4")),
    CONF_SOLCAST_FORECAST_DAY_5_SENSOR: (DEFAULT_SOLCAST_FORECAST_DAY_5_SENSOR, "sensor", ("solcast", "dzień 5", "day 5")),
    CONF_SOLCAST_FORECAST_DAY_6_SENSOR: (DEFAULT_SOLCAST_FORECAST_DAY_6_SENSOR, "sensor", ("solcast", "dzień 6", "day 6")),
    CONF_SOLCAST_FORECAST_DAY_7_SENSOR: (DEFAULT_SOLCAST_FORECAST_DAY_7_SENSOR, "sensor", ("solcast", "dzień 7", "day 7")),
    CONF_SOLCAST_REMAINING_TODAY_SENSOR: (DEFAULT_SOLCAST_REMAINING_TODAY_SENSOR, "sensor", ("solcast", "pozostała prognoza")),
    CONF_SOLCAST_PEAK_POWER_TODAY_SENSOR: (DEFAULT_SOLCAST_PEAK_POWER_TODAY_SENSOR, "sensor", ("solcast", "szczytowa moc")),
    CONF_SOLCAST_PEAK_TIME_TODAY_SENSOR: (DEFAULT_SOLCAST_PEAK_TIME_TODAY_SENSOR, "sensor", ("solcast", "czas szczytowej")),
    CONF_WEATHER_ENTITY: (DEFAULT_WEATHER_ENTITY, "weather", ("forecast home", "prognoza domu", "weather")),
}

INVERTER_FIELDS = (
    CONF_WORK_MODE_SELECT, CONF_MAX_SELL_POWER_NUMBER, CONF_DISCHARGE_CURRENT_NUMBER,
    CONF_CHARGE_CURRENT_NUMBER, CONF_GRID_CHARGE_CURRENT_NUMBER, CONF_BATTERY_SOC_SENSOR,
    CONF_GRID_POWER_SENSOR, CONF_PV_POWER_SENSOR, CONF_LOAD_POWER_SENSOR,
    CONF_BATTERY_POWER_SENSOR, CONF_DAILY_PV_PRODUCTION_SENSOR,
)
PRICE_FIELDS = (CONF_PRICE_SENSOR, CONF_SELL_PRICE_TOMORROW_SENSOR, CONF_BUY_PRICE_TODAY_SENSOR, CONF_BUY_PRICE_TOMORROW_SENSOR)
SOLCAST_FIELDS = (
    CONF_SOLCAST_CURRENT_POWER_SENSOR, CONF_SOLCAST_FORECAST_TODAY_SENSOR,
    CONF_SOLCAST_FORECAST_TOMORROW_SENSOR, CONF_SOLCAST_FORECAST_DAY_3_SENSOR,
    CONF_SOLCAST_FORECAST_DAY_4_SENSOR, CONF_SOLCAST_FORECAST_DAY_5_SENSOR,
    CONF_SOLCAST_FORECAST_DAY_6_SENSOR, CONF_SOLCAST_FORECAST_DAY_7_SENSOR,
    CONF_SOLCAST_REMAINING_TODAY_SENSOR, CONF_SOLCAST_PEAK_POWER_TODAY_SENSOR,
    CONF_SOLCAST_PEAK_TIME_TODAY_SENSOR,
)
REQUIRED_FIELDS = {CONF_WORK_MODE_SELECT, CONF_MAX_SELL_POWER_NUMBER, CONF_DISCHARGE_CURRENT_NUMBER, CONF_BATTERY_SOC_SENSOR}


def select_with_labels(options: list[tuple[str, str]]):
    return selector.SelectSelector(selector.SelectSelectorConfig(
        options=[{"value": value, "label": label} for value, label in options],
        mode="dropdown",
    ))


def discover_entity(states: Iterable[Any], domain: str, default: str, tokens: tuple[str, ...]) -> str:
    candidates = [state for state in states if str(getattr(state, "entity_id", "")).startswith(f"{domain}.")]
    if any(state.entity_id == default for state in candidates):
        return default
    best = (0, default)
    for state in candidates:
        haystack = " ".join((state.entity_id, str(getattr(state, "attributes", {}).get("friendly_name", "")))).lower()
        score = sum(3 if token in haystack else 0 for token in tokens)
        score += 1 if "deye" in haystack and domain in ("select", "number", "sensor") else 0
        if score > best[0]:
            best = (score, state.entity_id)
    return best[1]


class MappingWizardMixin:
    _values: dict[str, Any]
    _is_options = False

    def _prepare_values(self) -> None:
        if hasattr(self, "_values"):
            return
        current = {**self.config_entry.data, **self.config_entry.options} if self._is_options else {}
        self._values = current

    def _entity_default(self, key: str) -> str:
        default, domain, tokens = ENTITY_SPECS[key]
        current = self._values.get(key)
        if self._values.get(CONF_MAPPING_MODE, DEFAULT_MAPPING_MODE) == "automatic":
            candidate = discover_entity(self.hass.states.async_all(domain), domain, default, tokens)
            if self.hass.states.get(candidate) is not None:
                return candidate
        return str(current or default)

    def _entity_schema(self, fields: tuple[str, ...]) -> vol.Schema:
        schema: dict[Any, Any] = {}
        for key in fields:
            _default, domain, _tokens = ENTITY_SPECS[key]
            marker = vol.Required if key in REQUIRED_FIELDS else vol.Optional
            schema[marker(key, default=self._entity_default(key))] = selector.EntitySelector(
                selector.EntitySelectorConfig(domain=domain)
            )
        return vol.Schema(schema)

    def _missing_required(self) -> list[str]:
        missing = []
        for key in REQUIRED_FIELDS:
            entity_id = self._values.get(key)
            state = self.hass.states.get(entity_id) if entity_id else None
            if state is None or state.state in ("unknown", "unavailable"):
                missing.append(key)
        return missing

    async def async_step_inverter(self, user_input=None):
        if user_input is not None:
            self._values.update(user_input)
            return await self.async_step_prices()
        return self.async_show_form(step_id="inverter", data_schema=self._entity_schema(INVERTER_FIELDS))

    async def async_step_prices(self, user_input=None):
        if user_input is not None:
            self._values.update(user_input)
            return await self.async_step_solcast()
        schema: dict[Any, Any] = {
            vol.Required(CONF_PRICE_SOURCE, default=self._values.get(CONF_PRICE_SOURCE, DEFAULT_PRICE_SOURCE)): select_with_labels([("pstryk", "Pstryk"), ("pse_rce", "PSE / RCE"), ("other", "Inne źródło"), ("none", "Bez cen")]),
            vol.Required(CONF_OSD_PROVIDER, default=self._values.get(CONF_OSD_PROVIDER, DEFAULT_OSD_PROVIDER)): select_with_labels([("pge", "PGE Dystrybucja"), ("tauron", "Tauron Dystrybucja"), ("enea", "Enea Operator"), ("energa", "Energa Operator"), ("stoen", "Stoen Operator"), ("other", "Inny operator")]),
            vol.Required(CONF_TARIFF_PLAN, default=self._values.get(CONF_TARIFF_PLAN, DEFAULT_TARIFF_PLAN)): select_with_labels([("g11", "G11 — całodobowa"), ("g12", "G12 — dwustrefowa"), ("g12w", "G12w — weekendowa"), ("g12e", "G12e — elastyczna"), ("custom", "Profil własny")]),
            vol.Required(CONF_DISTRIBUTION_PEAK_RATE, default=self._values.get(CONF_DISTRIBUTION_PEAK_RATE, DEFAULT_DISTRIBUTION_PEAK_RATE)): vol.All(vol.Coerce(float), vol.Range(min=0, max=5)),
            vol.Required(CONF_DISTRIBUTION_OFFPEAK_RATE, default=self._values.get(CONF_DISTRIBUTION_OFFPEAK_RATE, DEFAULT_DISTRIBUTION_OFFPEAK_RATE)): vol.All(vol.Coerce(float), vol.Range(min=0, max=5)),
            vol.Required(CONF_CUSTOM_OFFPEAK_WINDOWS, default=self._values.get(CONF_CUSTOM_OFFPEAK_WINDOWS, DEFAULT_CUSTOM_OFFPEAK_WINDOWS)): str,
            vol.Required(CONF_GRID_POSITIVE_IS_IMPORT, default=self._values.get(CONF_GRID_POSITIVE_IS_IMPORT, DEFAULT_GRID_POSITIVE_IS_IMPORT)): selector.BooleanSelector(),
            vol.Required(CONF_BATTERY_POSITIVE_IS_DISCHARGE, default=self._values.get(CONF_BATTERY_POSITIVE_IS_DISCHARGE, DEFAULT_BATTERY_POSITIVE_IS_DISCHARGE)): selector.BooleanSelector(),
        }
        for key in PRICE_FIELDS:
            _default, domain, _tokens = ENTITY_SPECS[key]
            schema[vol.Optional(key, default=self._entity_default(key))] = selector.EntitySelector(selector.EntitySelectorConfig(domain=domain))
        return self.async_show_form(step_id="prices", data_schema=vol.Schema(schema))

    async def async_step_solcast(self, user_input=None):
        if user_input is not None:
            self._values.update(user_input)
            return await self.async_step_weather()
        return self.async_show_form(step_id="solcast", data_schema=self._entity_schema(SOLCAST_FIELDS))

    async def async_step_weather(self, user_input=None):
        if user_input is not None:
            self._values.update(user_input)
            return await self.async_step_summary()
        return self.async_show_form(step_id="weather", data_schema=self._entity_schema((CONF_WEATHER_ENTITY,)))

    async def async_step_summary(self, user_input=None):
        missing = self._missing_required()
        if user_input is not None and bool(user_input.get("confirm")) and not missing:
            data = dict(self._values)
            configured_name = str(data.pop(CONF_NAME, "Deye Energy Manager"))
            title = "" if self._is_options else configured_name
            return self.async_create_entry(title=title, data=data)
        errors = {"base": "required_entity_missing"} if missing else {}
        return self.async_show_form(
            step_id="summary",
            data_schema=vol.Schema({vol.Required("confirm", default=False): selector.BooleanSelector()}),
            errors=errors,
            description_placeholders={
                "mapped": str(sum(1 for key in ENTITY_SPECS if self._values.get(key))),
                "missing": ", ".join(missing) if missing else "brak",
            },
        )


class DeyeEnergyManagerConfigFlow(MappingWizardMixin, config_entries.ConfigFlow, domain=DOMAIN):
    """Configuration wizard for Deye Energy Manager."""

    VERSION = 1
    MINOR_VERSION = 14

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return DeyeEnergyManagerOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        self._prepare_values()
        if user_input is not None:
            self._values.update(user_input)
            return await self.async_step_inverter()
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({
                vol.Required(CONF_NAME, default="Deye Energy Manager"): str,
                vol.Required(CONF_MAPPING_MODE, default=DEFAULT_MAPPING_MODE): select_with_labels([("automatic", "Automatyczne podpowiedzi (zalecane)"), ("manual", "Wybór ręczny"), ("existing", "Zachowaj bieżące mapowanie")]),
            }),
        )


class DeyeEnergyManagerOptionsFlow(MappingWizardMixin, config_entries.OptionsFlowWithReload):
    _is_options = True

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        self._prepare_values()
        if user_input is not None:
            self._values.update(user_input)
            return await self.async_step_inverter()
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({
                vol.Required(CONF_MAPPING_MODE, default=self._values.get(CONF_MAPPING_MODE, DEFAULT_MAPPING_MODE)): select_with_labels([("automatic", "Automatyczne podpowiedzi (zalecane)"), ("manual", "Wybór ręczny"), ("existing", "Zachowaj bieżące mapowanie")]),
            }),
        )
