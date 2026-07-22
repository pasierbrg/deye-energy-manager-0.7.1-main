from __future__ import annotations

import asyncio
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
import math
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import (
    async_track_point_in_time,
    async_track_state_change_event,
    async_track_time_interval,
)
from homeassistant.helpers.storage import Store
from homeassistant.util.dt import now as ha_now

from .const import (
    CONF_BATTERY_SOC_SENSOR,
    CONF_BATTERY_POSITIVE_IS_DISCHARGE,
    CONF_BUY_PRICE_TODAY_SENSOR,
    CONF_BUY_PRICE_TOMORROW_SENSOR,
    CONF_CHARGE_CURRENT_NUMBER,
    CONF_DAILY_PV_PRODUCTION_SENSOR,
    CONF_GRID_CHARGE_CURRENT_NUMBER,
    CONF_GRID_POWER_SENSOR,
    CONF_GRID_POSITIVE_IS_IMPORT,
    CONF_PV_POWER_SENSOR,
    CONF_LOAD_POWER_SENSOR,
    CONF_BATTERY_POWER_SENSOR,
    CONF_DISCHARGE_CURRENT_NUMBER,
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
    CONF_WEATHER_ENTITY,
    CONF_PRICE_SOURCE,
    CONF_OSD_PROVIDER,
    CONF_TARIFF_PLAN,
    CONF_DISTRIBUTION_PEAK_RATE,
    CONF_DISTRIBUTION_OFFPEAK_RATE,
    CONF_CUSTOM_OFFPEAK_WINDOWS,
    CONF_TARIFF_MODE,
    CONF_PRICE_INCLUDES_DISTRIBUTION,
    CONF_TARIFF_CATALOG_URL,
    CONTROL_MODES,
    DOMAIN,
    MODE_SELLING_FIRST,
    MODE_CHARGE,
    MODE_ZERO_EXPORT,
    MODE_ZERO_EXPORT_CT,
    SLOTS,
    SLOT_MODES,
    WORK_MODES,
    DEFAULT_BATTERY_SOC,
    DEFAULT_BUY_PRICE_TODAY_SENSOR,
    DEFAULT_BUY_PRICE_TOMORROW_SENSOR,
    DEFAULT_DAILY_PV_PRODUCTION_SENSOR,
    DEFAULT_GRID_CHARGE_CURRENT,
    DEFAULT_GRID_POWER_SENSOR,
    DEFAULT_PV_POWER_SENSOR,
    DEFAULT_LOAD_POWER_SENSOR,
    DEFAULT_BATTERY_POWER_SENSOR,
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
    DEFAULT_WEATHER_ENTITY,
    DEFAULT_PRICE_SOURCE,
    DEFAULT_OSD_PROVIDER,
    DEFAULT_TARIFF_PLAN,
    DEFAULT_DISTRIBUTION_PEAK_RATE,
    DEFAULT_DISTRIBUTION_OFFPEAK_RATE,
    DEFAULT_CUSTOM_OFFPEAK_WINDOWS,
    DEFAULT_TARIFF_MODE,
    DEFAULT_PRICE_INCLUDES_DISTRIBUTION,
    DEFAULT_TARIFF_CATALOG_URL,
    DEFAULT_GRID_POSITIVE_IS_IMPORT,
    DEFAULT_BATTERY_POSITIVE_IS_DISCHARGE,
)
from .tariff_catalog import TariffCatalogManager
from .ai_planner import build_plan_bundle
from .tariffs import (
    PROVIDER_LABELS,
    TARIFF_LABELS,
    available_tariffs,
    catalog_hourly_profile,
    get_tariff,
    hourly_tariff_profile,
    parse_windows,
    tariff_availability,
    tariff_zone,
)


@dataclass
class SlotSettings:
    key: str
    label: str
    enabled: bool = False
    mode: str = MODE_ZERO_EXPORT
    sell_power: float = 0
    discharge_current: float = 0
    # Per-slot permission for physical Deye TOU Grid Charge.  It is meaningful
    # only while this slot uses MODE_CHARGE; a positive current alone never
    # grants permission to charge from the grid.
    charge_enabled: bool = False
    charge_current: float = 0
    grid_charge_current: float = 0
    # Business-only threshold for Selling First. It is never written to a
    # physical Deye Time Of Use SOC field.
    minimum_sell_soc: float = 0
    # Physical Deye Time Of Use SOC for this logical slot.  It is deliberately
    # unknown until restored from the user's prior configuration or explicitly
    # confirmed by the user.  It must never be inferred from minimum_sell_soc
    # or silently replaced by zero before a physical TOU write.
    tou_soc: float | None = None
    min_sell_price: float = 0


@dataclass
class DeyeEnergyManagerRuntime:
    hass: HomeAssistant
    entry_id: str
    data: dict[str, Any]
    scheduler_enabled: bool = False
    soc_guard_enabled: bool = True
    price_guard_enabled: bool = False
    emergency_stop: bool = False
    control_mode: str = "Schedule"
    min_sell_soc: float = 30
    price_sell_threshold: float = 0
    manual_sell_power: float = 3000
    manual_discharge_current: float = 80
    manual_charge_current: float = 60
    default_work_mode: str = MODE_ZERO_EXPORT
    default_sell_power: float = 0
    default_discharge_current: float = 0
    default_charge_current: float = 0
    default_grid_charge_current: float = 0
    # Separate values used exclusively by planned Charge slots.  They are
    # independent from the full default/recovery state above.
    charge_profile_charge_current: float = 0
    charge_profile_discharge_current: float = 0
    charge_profile_grid_charge_current: float = 0
    charge_profile_target_soc: float = 100
    # The only permission to enable Deye Grid Charge for Charge slots.
    charge_profile_grid_enabled: bool = False
    sold_energy_today: float = 0
    sold_value_today: float = 0
    sold_energy_current_hour: float = 0
    sold_value_current_hour: float = 0
    _energy_last_update: datetime | None = None
    _energy_day: str = ""
    _stats_store: Store | None = None
    _ai_store: Store | None = None
    _charge_profile_loaded_from_store: bool = False
    _solcast_store: Store | None = None
    _learning_store: Store | None = None
    _samples_store: Store | None = None
    _tariff_catalog_manager: TariffCatalogManager | None = None
    _stats_dirty: bool = False
    sales_stats: dict[str, Any] = field(default_factory=dict)
    ai_settings: dict[str, Any] = field(default_factory=dict)
    ai_history: list[dict[str, Any]] = field(default_factory=list)
    future_plan: dict[str, Any] = field(default_factory=dict)
    solcast_history: list[dict[str, Any]] = field(default_factory=list)
    solcast_tracking: dict[str, Any] = field(default_factory=dict)
    learning_history: list[dict[str, Any]] = field(default_factory=list)
    learning_tracking: dict[str, Any] = field(default_factory=dict)
    energy_samples: list[dict[str, Any]] = field(default_factory=list)
    daily_archive: list[dict[str, Any]] = field(default_factory=list)
    monthly_archive: list[dict[str, Any]] = field(default_factory=list)
    weather_forecast: list[dict[str, Any]] = field(default_factory=list)
    weather_daily_forecast: list[dict[str, Any]] = field(default_factory=list)
    weather_last_updated: str = ""
    weather_last_error: str = ""
    _last_energy_sample_at: datetime | None = None
    slots: dict[str, SlotSettings] = field(default_factory=dict)
    last_action: str = "Idle"
    last_applied_at: str = ""
    last_saved_at: str = ""
    last_error: str = ""
    last_schedule_attempt: dict[str, Any] = field(default_factory=dict)
    control_confirmation_timeout: float = 12.0
    _pending_control_transaction: dict[str, Any] = field(default_factory=dict)
    unsub_confirmation_timer: Any = None
    unsub_confirmation_listener: Any = None
    unsub_confirmation_poll: Any = None
    unsub_input_listener: Any = None
    unsub_input_debounce: Any = None
    unsub_timer: Any = None
    entities: list[Any] = field(default_factory=list)
    _last_tou_signature: str = ""
    # Tracks whether the latest TOU operation crossed the preflight boundary
    # and issued at least one physical Deye service call.  Validation failures
    # must not trigger a second transaction that restores defaults.
    _last_tou_write_started: bool = False
    _last_slot_failure_signature: str = ""
    _last_sell_block_signature: str = ""
    _operation_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def __post_init__(self) -> None:
        self.slots = {key: SlotSettings(key=key, label=label) for key, label, *_ in SLOTS}

    @property
    def work_mode_select(self) -> str:
        return self.data[CONF_WORK_MODE_SELECT]

    @property
    def max_sell_power_number(self) -> str:
        return self.data[CONF_MAX_SELL_POWER_NUMBER]

    @property
    def discharge_current_number(self) -> str:
        return self.data[CONF_DISCHARGE_CURRENT_NUMBER]

    @property
    def charge_current_number(self) -> str | None:
        return self.data.get(CONF_CHARGE_CURRENT_NUMBER)

    @property
    def grid_charge_current_number(self) -> str | None:
        return self.data.get(CONF_GRID_CHARGE_CURRENT_NUMBER, DEFAULT_GRID_CHARGE_CURRENT)

    @property
    def grid_power_sensor(self) -> str | None:
        configured = self.data.get(CONF_GRID_POWER_SENSOR)
        if configured and self.hass.states.get(configured) is not None:
            return configured
        if self.hass.states.get(DEFAULT_GRID_POWER_SENSOR) is not None:
            return DEFAULT_GRID_POWER_SENSOR
        return configured

    @property
    def pv_power_sensor(self) -> str | None:
        return self.configured_sensor(CONF_PV_POWER_SENSOR, DEFAULT_PV_POWER_SENSOR)

    @property
    def load_power_sensor(self) -> str | None:
        return self.configured_sensor(CONF_LOAD_POWER_SENSOR, DEFAULT_LOAD_POWER_SENSOR)

    @property
    def battery_power_sensor(self) -> str | None:
        return self.configured_sensor(CONF_BATTERY_POWER_SENSOR, DEFAULT_BATTERY_POWER_SENSOR)

    @property
    def battery_soc_sensor(self) -> str | None:
        configured = self.data.get(CONF_BATTERY_SOC_SENSOR)
        if configured and self.hass.states.get(configured) is not None:
            return configured
        if self.hass.states.get(DEFAULT_BATTERY_SOC) is not None:
            return DEFAULT_BATTERY_SOC
        return configured

    def configured_sensor(self, key: str, default_entity: str) -> str | None:
        configured = self.data.get(key)
        if configured and self.hass.states.get(configured) is not None:
            return configured
        if self.hass.states.get(default_entity) is not None:
            return default_entity
        return configured or default_entity

    @property
    def price_sensor(self) -> str | None:
        configured = self.data.get(CONF_PRICE_SENSOR)
        if configured and self.hass.states.get(configured) is not None:
            return configured
        if self.hass.states.get(DEFAULT_PRICE_SENSOR) is not None:
            return DEFAULT_PRICE_SENSOR
        return configured

    @property
    def sell_price_tomorrow_sensor(self) -> str | None:
        configured = self.data.get(CONF_SELL_PRICE_TOMORROW_SENSOR)
        if configured and self.hass.states.get(configured) is not None:
            return configured
        if self.hass.states.get(DEFAULT_SELL_PRICE_TOMORROW_SENSOR) is not None:
            return DEFAULT_SELL_PRICE_TOMORROW_SENSOR
        return configured

    @property
    def buy_price_today_sensor(self) -> str | None:
        configured = self.data.get(CONF_BUY_PRICE_TODAY_SENSOR)
        if configured and self.hass.states.get(configured) is not None:
            return configured
        if self.hass.states.get(DEFAULT_BUY_PRICE_TODAY_SENSOR) is not None:
            return DEFAULT_BUY_PRICE_TODAY_SENSOR
        return configured

    @property
    def buy_price_tomorrow_sensor(self) -> str | None:
        configured = self.data.get(CONF_BUY_PRICE_TOMORROW_SENSOR)
        if configured and self.hass.states.get(configured) is not None:
            return configured
        if self.hass.states.get(DEFAULT_BUY_PRICE_TOMORROW_SENSOR) is not None:
            return DEFAULT_BUY_PRICE_TOMORROW_SENSOR
        return configured

    @property
    def solcast_current_power_sensor(self) -> str | None:
        return self.configured_sensor(CONF_SOLCAST_CURRENT_POWER_SENSOR, DEFAULT_SOLCAST_CURRENT_POWER_SENSOR)

    @property
    def solcast_forecast_today_sensor(self) -> str | None:
        return self.configured_sensor(CONF_SOLCAST_FORECAST_TODAY_SENSOR, DEFAULT_SOLCAST_FORECAST_TODAY_SENSOR)

    @property
    def daily_pv_production_sensor(self) -> str | None:
        return self.configured_sensor(CONF_DAILY_PV_PRODUCTION_SENSOR, DEFAULT_DAILY_PV_PRODUCTION_SENSOR)

    @property
    def solcast_forecast_tomorrow_sensor(self) -> str | None:
        return self.configured_sensor(CONF_SOLCAST_FORECAST_TOMORROW_SENSOR, DEFAULT_SOLCAST_FORECAST_TOMORROW_SENSOR)

    @property
    def solcast_forecast_day_3_sensor(self) -> str | None:
        return self.configured_sensor(CONF_SOLCAST_FORECAST_DAY_3_SENSOR, DEFAULT_SOLCAST_FORECAST_DAY_3_SENSOR)

    @property
    def solcast_forecast_day_4_sensor(self) -> str | None:
        return self.configured_sensor(CONF_SOLCAST_FORECAST_DAY_4_SENSOR, DEFAULT_SOLCAST_FORECAST_DAY_4_SENSOR)

    @property
    def solcast_forecast_day_5_sensor(self) -> str | None:
        return self.configured_sensor(CONF_SOLCAST_FORECAST_DAY_5_SENSOR, DEFAULT_SOLCAST_FORECAST_DAY_5_SENSOR)

    @property
    def solcast_forecast_day_6_sensor(self) -> str | None:
        return self.configured_sensor(CONF_SOLCAST_FORECAST_DAY_6_SENSOR, DEFAULT_SOLCAST_FORECAST_DAY_6_SENSOR)

    @property
    def solcast_forecast_day_7_sensor(self) -> str | None:
        return self.configured_sensor(CONF_SOLCAST_FORECAST_DAY_7_SENSOR, DEFAULT_SOLCAST_FORECAST_DAY_7_SENSOR)

    @property
    def solcast_remaining_today_sensor(self) -> str | None:
        return self.configured_sensor(CONF_SOLCAST_REMAINING_TODAY_SENSOR, DEFAULT_SOLCAST_REMAINING_TODAY_SENSOR)

    @property
    def solcast_peak_power_today_sensor(self) -> str | None:
        return self.configured_sensor(CONF_SOLCAST_PEAK_POWER_TODAY_SENSOR, DEFAULT_SOLCAST_PEAK_POWER_TODAY_SENSOR)

    @property
    def solcast_peak_time_today_sensor(self) -> str | None:
        return self.configured_sensor(CONF_SOLCAST_PEAK_TIME_TODAY_SENSOR, DEFAULT_SOLCAST_PEAK_TIME_TODAY_SENSOR)

    @property
    def weather_entity(self) -> str | None:
        return self.data.get(CONF_WEATHER_ENTITY) or DEFAULT_WEATHER_ENTITY

    @property
    def osd_provider(self) -> str:
        return str(self.data.get(CONF_OSD_PROVIDER, DEFAULT_OSD_PROVIDER)).lower()

    @property
    def tariff_plan(self) -> str:
        return str(self.data.get(CONF_TARIFF_PLAN, DEFAULT_TARIFF_PLAN)).lower()

    @property
    def price_source(self) -> str:
        return str(self.data.get(CONF_PRICE_SOURCE, DEFAULT_PRICE_SOURCE)).lower()

    @property
    def distribution_peak_rate(self) -> float:
        return max(0.0, self.safe_float(self.data.get(CONF_DISTRIBUTION_PEAK_RATE), DEFAULT_DISTRIBUTION_PEAK_RATE))

    @property
    def distribution_offpeak_rate(self) -> float:
        return max(0.0, self.safe_float(self.data.get(CONF_DISTRIBUTION_OFFPEAK_RATE), DEFAULT_DISTRIBUTION_OFFPEAK_RATE))

    @property
    def custom_offpeak_windows(self) -> str:
        return str(self.data.get(CONF_CUSTOM_OFFPEAK_WINDOWS, DEFAULT_CUSTOM_OFFPEAK_WINDOWS))

    @property
    def tariff_mode(self) -> str:
        value = str(self.data.get(CONF_TARIFF_MODE, DEFAULT_TARIFF_MODE)).lower()
        return value if value in ("automatic", "manual") else DEFAULT_TARIFF_MODE

    @property
    def price_includes_distribution(self) -> bool:
        return bool(self.data.get(CONF_PRICE_INCLUDES_DISTRIBUTION, DEFAULT_PRICE_INCLUDES_DISTRIBUTION))

    @property
    def tariff_catalog(self) -> dict[str, Any]:
        if self._tariff_catalog_manager is not None:
            return self._tariff_catalog_manager.catalog
        from .tariffs import load_bundled_catalog

        return load_bundled_catalog()

    def normalized_grid_power(self) -> float:
        value = self.state_float(self.grid_power_sensor, 0)
        return value if bool(self.data.get(CONF_GRID_POSITIVE_IS_IMPORT, DEFAULT_GRID_POSITIVE_IS_IMPORT)) else -value

    def normalized_battery_power(self) -> float:
        value = self.state_float(self.battery_power_sensor, 0)
        return value if bool(self.data.get(CONF_BATTERY_POSITIVE_IS_DISCHARGE, DEFAULT_BATTERY_POSITIVE_IS_DISCHARGE)) else -value

    def tariff_context(self, moment: datetime | None = None) -> dict[str, Any]:
        current = moment or ha_now()
        catalog = self.tariff_catalog
        tariff = get_tariff(catalog, self.osd_provider, self.tariff_plan)
        tariff_available, tariff_error = tariff_availability(tariff, current.date()) if tariff else (False, "brak taryfy w katalogu")
        automatic = self.tariff_mode == "automatic" and tariff is not None and tariff_available
        if automatic:
            profile = catalog_hourly_profile(current, catalog, self.osd_provider, self.tariff_plan, 48)
        elif self.tariff_mode == "manual":
            today = hourly_tariff_profile(
                current,
                "custom",
                self.distribution_peak_rate,
                self.distribution_offpeak_rate,
                self.custom_offpeak_windows,
                "other",
            )
            tomorrow = hourly_tariff_profile(
                current + timedelta(days=1),
                "custom",
                self.distribution_peak_rate,
                self.distribution_offpeak_rate,
                self.custom_offpeak_windows,
                "other",
            )
            profile = [*today, *tomorrow]
        else:
            profile = []
        current_row = next(
            (row for row in profile if row.get("date") == current.date().isoformat() and row.get("hour") == current.hour),
            profile[current.hour] if len(profile) > current.hour else {},
        )
        catalog_rates = tariff.get("rates", {}) if automatic and tariff else {}
        numeric_rates = [float(value) for value in catalog_rates.values() if isinstance(value, (int, float))]
        display_peak_rate = max(numeric_rates) if numeric_rates else self.distribution_peak_rate
        display_offpeak_rate = min(numeric_rates) if numeric_rates else self.distribution_offpeak_rate
        providers = [
            {
                "id": key,
                "name": str(value.get("name") or key),
                "tariffs": available_tariffs(catalog, key),
            }
            for key, value in catalog.get("providers", {}).items()
        ]
        context = {
            "provider": self.osd_provider,
            "provider_name": PROVIDER_LABELS.get(self.osd_provider, self.osd_provider),
            "plan": self.tariff_plan,
            "plan_name": str(tariff.get("name")) if tariff else TARIFF_LABELS.get(self.tariff_plan, self.tariff_plan.upper()),
            "mode": self.tariff_mode,
            "configured": automatic or self.tariff_mode == "manual",
            "tariff_error": "" if automatic or self.tariff_mode == "manual" else tariff_error,
            "zone": current_row.get("zone"),
            "season": current_row.get("season"),
            "day_type": current_row.get("day_type"),
            "distribution_rate": current_row.get("rate", 0),
            "common_rate": current_row.get("common_rate", 0),
            "total_distribution_rate": current_row.get("total_distribution_rate", current_row.get("rate", 0)),
            "peak_rate": round(display_peak_rate, 5),
            "offpeak_rate": round(display_offpeak_rate, 5),
            "custom_offpeak_windows": self.custom_offpeak_windows,
            "price_source": self.price_source,
            "price_includes_distribution": self.price_includes_distribution,
            "grid_positive_is_import": bool(self.data.get(CONF_GRID_POSITIVE_IS_IMPORT, DEFAULT_GRID_POSITIVE_IS_IMPORT)),
            "battery_positive_is_discharge": bool(self.data.get(CONF_BATTERY_POSITIVE_IS_DISCHARGE, DEFAULT_BATTERY_POSITIVE_IS_DISCHARGE)),
            "providers": providers,
            "tariffs": available_tariffs(catalog, self.osd_provider),
            "hourly_profile": profile,
        }
        if self._tariff_catalog_manager is not None:
            context.update(self._tariff_catalog_manager.status())
        return context

    def validate_tariff_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        """Return a safe, normalized tariff configuration from the card."""
        if not isinstance(settings, dict):
            raise ValueError("Ustawienia taryfy muszą być obiektem")
        mode = str(settings.get(CONF_TARIFF_MODE, self.tariff_mode)).lower()
        if mode not in ("automatic", "manual"):
            raise ValueError("Nieznany tryb taryfy")
        provider = str(settings.get(CONF_OSD_PROVIDER, self.osd_provider)).lower()
        plan = str(settings.get(CONF_TARIFF_PLAN, self.tariff_plan)).lower()
        selected_tariff = get_tariff(self.tariff_catalog, provider, plan)
        if mode == "automatic" and selected_tariff is None:
            raise ValueError("Wybrana taryfa nie występuje w katalogu operatora")
        if mode == "automatic" and selected_tariff is not None:
            available, unavailable_reason = tariff_availability(selected_tariff, ha_now().date())
            if not available:
                raise ValueError(f"Wybrana taryfa nie może być jeszcze użyta: {unavailable_reason}")
        if provider not in self.tariff_catalog.get("providers", {}):
            raise ValueError("Nieznany operator OSD")
        price_source = str(settings.get(CONF_PRICE_SOURCE, self.price_source)).lower()
        if price_source not in ("pstryk", "pse_rce", "other", "none"):
            raise ValueError("Nieznane źródło cen energii")
        peak = self.safe_float(settings.get(CONF_DISTRIBUTION_PEAK_RATE), self.distribution_peak_rate)
        offpeak = self.safe_float(settings.get(CONF_DISTRIBUTION_OFFPEAK_RATE), self.distribution_offpeak_rate)
        if not 0 <= peak <= 10 or not 0 <= offpeak <= 10:
            raise ValueError("Stawka dystrybucyjna musi mieścić się w zakresie 0–10 PLN/kWh")
        windows = str(settings.get(CONF_CUSTOM_OFFPEAK_WINDOWS, self.custom_offpeak_windows)).strip()
        if mode == "manual" and not parse_windows(windows):
            raise ValueError("Profil ręczny wymaga poprawnych przedziałów godzin")
        return {
            CONF_TARIFF_MODE: mode,
            CONF_OSD_PROVIDER: provider,
            CONF_TARIFF_PLAN: plan,
            CONF_DISTRIBUTION_PEAK_RATE: round(peak, 5),
            CONF_DISTRIBUTION_OFFPEAK_RATE: round(offpeak, 5),
            CONF_CUSTOM_OFFPEAK_WINDOWS: windows,
            CONF_PRICE_SOURCE: price_source,
            CONF_PRICE_INCLUDES_DISTRIBUTION: bool(settings.get(CONF_PRICE_INCLUDES_DISTRIBUTION, self.price_includes_distribution)),
            CONF_GRID_POSITIVE_IS_IMPORT: bool(settings.get(CONF_GRID_POSITIVE_IS_IMPORT, self.data.get(CONF_GRID_POSITIVE_IS_IMPORT, DEFAULT_GRID_POSITIVE_IS_IMPORT))),
            CONF_BATTERY_POSITIVE_IS_DISCHARGE: bool(settings.get(CONF_BATTERY_POSITIVE_IS_DISCHARGE, self.data.get(CONF_BATTERY_POSITIVE_IS_DISCHARGE, DEFAULT_BATTERY_POSITIVE_IS_DISCHARGE))),
        }

    async def async_update_tariff_settings(self, settings: dict[str, Any]) -> dict[str, Any]:
        normalized = self.validate_tariff_settings(settings)
        previous = self.tariff_context()
        self.data.update(normalized)
        self.learning_tracking["tariff_changed_at"] = ha_now().isoformat(timespec="seconds")
        await self.async_add_ai_analysis({
            "type": "tariff_configuration",
            "status": "saved",
            "previous": {"provider": previous.get("provider"), "plan": previous.get("plan"), "catalog_version": previous.get("catalog_version")},
            "current": {"provider": self.osd_provider, "plan": self.tariff_plan, "catalog_version": self.tariff_context().get("catalog_version")},
        })
        self.mark_config_saved()
        return normalized

    async def async_refresh_tariff_catalog(self) -> bool:
        if self._tariff_catalog_manager is None:
            return False
        changed = await self._tariff_catalog_manager.async_refresh(force=True)
        self.notify_update()
        return changed

    def weather_context(self) -> dict[str, Any]:
        state = self.hass.states.get(self.weather_entity) if self.weather_entity else None
        attrs = dict(state.attributes) if state is not None else {}
        cloud = self.safe_float(attrs.get("cloud_coverage"), 0)
        precipitation = self.safe_float(attrs.get("precipitation_probability"), 0)
        # Weather is a conservative auxiliary signal. Solcast remains the primary forecast.
        risk_factor = max(0.75, min(1.0, 1.0 - cloud * 0.0015 - precipitation * 0.001))
        return {
            "entity_id": self.weather_entity,
            "available": state is not None and state.state not in ("unknown", "unavailable"),
            "condition": state.state if state is not None else "unavailable",
            "temperature": attrs.get("temperature"),
            "temperature_unit": attrs.get("temperature_unit"),
            "pressure": attrs.get("pressure"),
            "pressure_unit": attrs.get("pressure_unit"),
            "humidity": attrs.get("humidity"),
            "wind_speed": attrs.get("wind_speed"),
            "wind_speed_unit": attrs.get("wind_speed_unit"),
            "wind_bearing": attrs.get("wind_bearing"),
            "wind_gust_speed": attrs.get("wind_gust_speed"),
            "visibility": attrs.get("visibility"),
            "visibility_unit": attrs.get("visibility_unit"),
            "cloud_coverage": attrs.get("cloud_coverage"),
            "precipitation_probability": attrs.get("precipitation_probability"),
            "precipitation_unit": attrs.get("precipitation_unit"),
            "risk_factor": round(risk_factor, 3),
            "forecast": self.weather_forecast[:48],
            "daily_forecast": self.weather_daily_forecast[:7],
            "hourly_count": len(self.weather_forecast[:48]),
            "daily_count": len(self.weather_daily_forecast[:7]),
            "last_updated": self.weather_last_updated,
            "last_error": self.weather_last_error,
        }

    @staticmethod
    def _price_from_object(item: Any) -> float | None:
        if not isinstance(item, dict):
            return None
        for key in (
            "price", "value", "state", "amount", "total", "net_price", "gross_price",
            "energy_price", "unit_price", "price_with_tax", "pln_kwh", "pln_per_kwh",
            "sell_price", "buy_price", "sprzedaz", "zakup", "cena", "pln", "rce",
        ):
            if key not in item:
                continue
            try:
                value = float(item[key])
            except (TypeError, ValueError):
                continue
            if math.isfinite(value) and value > 0:
                return value
        return None

    @staticmethod
    def _hour_from_value(value: Any, fallback: int | None = None) -> int | None:
        if isinstance(value, (int, float)) and 0 <= int(value) <= 23:
            return int(value)
        text = str(value or "")
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            return parsed.hour
        except (TypeError, ValueError):
            pass
        import re

        match = re.search(r"(?:^|\D)(\d{1,2})(?::\d{2})?", text)
        if match and 0 <= int(match.group(1)) <= 23:
            return int(match.group(1))
        return fallback if fallback is not None and 0 <= fallback <= 23 else None

    def price_map(self, entity_id: str | None, allow_state_fallback: bool = True) -> dict[int, float]:
        """Read common hourly-price attribute layouts used by Polish integrations."""
        state = self.hass.states.get(entity_id) if entity_id else None
        if state is None:
            return {}
        result: dict[int, float] = {}

        def add(item: Any, fallback: int | None = None) -> None:
            hour: int | None = fallback
            value: float | None = None
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                hour = self._hour_from_value(item[0], fallback)
                try:
                    value = float(item[1])
                except (TypeError, ValueError):
                    value = None
            elif isinstance(item, dict):
                for key in (
                    "hour", "start", "from", "time", "date", "datetime", "timestamp",
                    "period", "label", "name", "start_time", "starts_at", "valid_from", "begin", "od",
                ):
                    if key in item:
                        hour = self._hour_from_value(item[key], fallback)
                        break
                value = self._price_from_object(item)
            else:
                try:
                    value = float(item)
                except (TypeError, ValueError):
                    value = None
            if hour is not None and value is not None and math.isfinite(value) and value > 0:
                result.setdefault(hour, value)

        def parse(source: Any) -> None:
            if isinstance(source, list):
                for index, item in enumerate(source):
                    add(item, index if index < 24 else None)
            elif isinstance(source, dict):
                for index, (key, value) in enumerate(source.items()):
                    if isinstance(value, dict):
                        add({**value, "hour": value.get("hour", key)}, index if index < 24 else None)
                    else:
                        add([key, value], index if index < 24 else None)

        attrs = dict(state.attributes)
        for key in (
            "prices", "price", "today", "tomorrow", "hourly", "hours", "data", "values",
            "items", "entries", "forecast", "raw_today", "raw_tomorrow", "source", "price_list",
            "hourly_prices", "prices_today", "prices_tomorrow", "today_prices", "tomorrow_prices",
            "sell_prices", "buy_prices", "ceny", "ceny_godzinowe", "energy_prices",
        ):
            parse(attrs.get(key))
        if not result and allow_state_fallback:
            for key, value in attrs.items():
                if self._hour_from_value(key) is not None or isinstance(value, (list, dict)):
                    parse({key: value})
        if not result:
            value = self.state_float_or_none(entity_id)
            if value is not None and value > 0:
                result[ha_now().hour] = value
        return result

    def _weather_factors_48h(self) -> list[float | None]:
        factors: list[float | None] = [None] * 48
        current = ha_now()
        for fallback_index, row in enumerate(self.weather_forecast[:48]):
            if not isinstance(row, dict):
                continue
            index: int | None = None
            raw_time = row.get("datetime", row.get("time"))
            if raw_time:
                try:
                    stamp = datetime.fromisoformat(str(raw_time).replace("Z", "+00:00"))
                    if current.tzinfo is not None and stamp.tzinfo is not None:
                        stamp = stamp.astimezone(current.tzinfo)
                    day_offset = (stamp.date() - current.date()).days
                    if 0 <= day_offset <= 1:
                        index = day_offset * 24 + stamp.hour
                except (TypeError, ValueError):
                    index = None
            if index is None:
                stamp = current + timedelta(hours=fallback_index)
                day_offset = (stamp.date() - current.date()).days
                if 0 <= day_offset <= 1:
                    index = day_offset * 24 + stamp.hour
            if index is None or not 0 <= index < 48:
                continue
            cloud = self.safe_float(row.get("cloud_coverage"), 0)
            precipitation = self.safe_float(row.get("precipitation_probability"), 0)
            factors[index] = round(max(0.65, min(1.05, 1 - cloud * 0.002 - precipitation * 0.001)), 3)
        return factors

    def ai_plan_48h(self) -> dict[str, Any]:
        """Build the read-only AI proposal payload exposed to the Lovelace card."""
        settings = self.ai_settings
        learning = self.learning_summary()
        profile = learning.get("hourly_profile") if isinstance(learning.get("hourly_profile"), list) else []
        by_hour = {int(str(row.get("hour", "0"))[:2]): row for row in profile if isinstance(row, dict)}
        tariff = self.tariff_context()
        distribution = [
            self.safe_float(row.get("total_distribution_rate", row.get("rate")), 0)
            for row in tariff.get("hourly_profile", [])[:48]
            if isinstance(row, dict)
        ]
        distribution.extend([0.0] * (48 - len(distribution)))
        today_forecast = self.solcast_forecast_today_value()
        today_actual = max(0, self.state_float(self.daily_pv_production_sensor, 0))
        remaining = max(0, self.state_float(self.solcast_remaining_today_sensor, 0))
        if remaining <= 0:
            remaining = max(0, today_forecast - today_actual)
        selected_strategy = str(settings.get("strategy") or "balanced")
        if selected_strategy == "autoconsumption":
            selected_strategy = "safe"
        payload = {
            "date": ha_now().date().isoformat(),
            "current_hour": ha_now().hour,
            "soc": self.state_float(self.battery_soc_sensor, 0),
            "battery_capacity_kwh": self.safe_float(settings.get("batteryCapacityKwh"), 10),
            "battery_efficiency": self.safe_float(settings.get("batteryEfficiency"), 90) / 100,
            "min_soc": self.safe_float(settings.get("minSoc"), 20),
            "target_soc": self.safe_float(settings.get("targetSoc"), 100),
            "reserve_kwh": self.safe_float(settings.get("reserveKwh"), 0),
            "max_sell_power_w": self.safe_float(settings.get("maxSellPower"), 5000),
            "charge_kwh_per_hour": max(0.25, self.safe_float(settings.get("batteryCapacityKwh"), 10) * 0.25),
            "min_sell_price": self.safe_float(settings.get("minSellPrice"), 0),
            "max_buy_price": self.safe_float(settings.get("maxBuyPrice"), 999),
            "allow_battery_sell": bool(settings.get("allowBatterySell", True)),
            "allow_grid_charge": bool(settings.get("allowGridCharge", True)),
            "sell_prices": [self.price_map(self.price_sensor), self.price_map(self.sell_price_tomorrow_sensor, False)],
            "buy_prices": [self.price_map(self.buy_price_today_sensor), self.price_map(self.buy_price_tomorrow_sensor, False)],
            "distribution": distribution,
            "price_includes_distribution": self.price_includes_distribution,
            "pv_forecast": [remaining, max(0, self.state_float(self.solcast_forecast_tomorrow_sensor, 0))],
            "pv_forecast_full": [today_forecast, max(0, self.state_float(self.solcast_forecast_tomorrow_sensor, 0))],
            "pv_forecast_available": [
                self.entity_available(self.solcast_forecast_today_sensor),
                self.entity_available(self.solcast_forecast_tomorrow_sensor),
            ],
            "forecast_correction": self.safe_float(learning.get("solcast_correction_factor"), 1),
            "forecast_accuracy": learning.get("solcast_accuracy_avg"),
            "pv_profile": [self.safe_float(by_hour.get(hour, {}).get("pv_kwh"), 0) for hour in range(24)],
            "load_profile": [self.safe_float(by_hour.get(hour, {}).get("load_kwh"), 0) for hour in range(24)],
            "weather_factors": self._weather_factors_48h(),
            "recorded_days": learning.get("recorded_days", 0),
        }
        result = build_plan_bundle(payload, selected_strategy)
        result["generated_at"] = ha_now().isoformat(timespec="seconds")
        return result

    def register_entity(self, entity: Any) -> None:
        self.entities.append(entity)

    @callback
    def notify_update(self) -> None:
        for entity in list(self.entities):
            if getattr(entity, "hass", None) is not None:
                entity.async_write_ha_state()

    def active_slot_key(self) -> str:
        hour = ha_now().hour
        for key, _label, start, end in SLOTS:
            if start <= hour < end:
                return key
        return "23_00"

    @property
    def active_slot(self) -> SlotSettings:
        return self.slots[self.active_slot_key()]

    def state_float(self, entity_id: str | None, default: float = 0) -> float:
        value = self.state_float_or_none(entity_id)
        return default if value is None else value

    def state_float_or_none(self, entity_id: str | None) -> float | None:
        """Return a finite numeric state or None when the source is not trustworthy."""
        if not entity_id:
            return None
        state = self.hass.states.get(entity_id)
        if state is None or state.state in ("unknown", "unavailable", "none", ""):
            return None
        try:
            value = float(state.state)
        except (TypeError, ValueError):
            return None
        return value if math.isfinite(value) else None

    def entity_available(self, entity_id: str | None) -> bool:
        if not entity_id:
            return False
        state = self.hass.states.get(entity_id)
        return state is not None and state.state not in ("unknown", "unavailable", "none", "")

    def state_text(self, entity_id: str | None) -> str:
        if not entity_id:
            return "unknown"
        state = self.hass.states.get(entity_id)
        return state.state if state is not None else "unknown"

    @property
    def data_available(self) -> bool:
        """Check only entities required to write a complete Deye control plan.

        SOC and price are conditions of Selling First, not a global data
        interlock.  A Zero Export slot must therefore remain executable when
        price data is absent.
        """
        required = [
            self.work_mode_select,
            self.max_sell_power_number,
            self.discharge_current_number,
            self.charge_current_number,
            self.grid_charge_current_number,
        ]
        return all(self.entity_available(entity_id) for entity_id in required)

    @property
    def mapping_error(self) -> bool:
        return len(self._compress_schedule_segments()) > 6

    @property
    def next_active_slot(self) -> str:
        keys = [key for key, *_rest in SLOTS]
        current_index = keys.index(self.active_slot_key())
        for offset in range(1, len(keys) + 1):
            key, label, *_rest = SLOTS[(current_index + offset) % len(SLOTS)]
            if self.slots[key].enabled:
                return label
        return "NONE"

    @property
    def decision_reason(self) -> str:
        status = self.manager_status
        if status == "MAPPING ERROR":
            return f"Mapowanie wymaga {len(self._compress_schedule_segments())} zakresów; Deye obsługuje 6"
        if status == "NO DATA":
            return "Brak wymaganych danych lub encji sterujących falownikiem"
        if status == "SELL BLOCKED":
            issue = self._selling_slot_guard_issue()
            return issue[1] if issue else "Sprzedaż wstrzymana przez warunek aktywnego slotu"
        if status == "PRICE TOO LOW":
            price = self.state_float(self.price_sensor, 0)
            return f"Cena {price:.2f} PLN/kWh jest niższa od progu {self.active_min_sell_price:.2f} PLN/kWh"
        if status == "SOC TOO LOW":
            soc = self.state_float(self.battery_soc_sensor, 0)
            return f"SOC {soc:.0f}% jest niższy od limitu {self.active_min_sell_soc:.0f}%"
        reasons = {
            "SLOT DISABLED": "Bieżący slot jest wyłączony; obowiązują ustawienia domyślne",
            "SCHEDULER OFF": "Harmonogram jest wyłączony; manager oczekuje",
            "STOPPED": "Sterowanie zatrzymane; obowiązują ustawienia domyślne",
            "EMERGENCY STOP": "Aktywne zatrzymanie awaryjne",
            "PROTECT BATTERY": "Aktywna ochrona baterii",
            "MANUAL SELL": "Aktywny ręczny tryb sprzedaży",
            "CHARGE BATTERY": "Aktywne ręczne ładowanie baterii",
            "GRID CHARGE ACTIVE": "Ładowanie z sieci według harmonogramu",
            "PV CHARGE ACTIVE": "Ładowanie z PV według harmonogramu",
            "SELLING ACTIVE": "Warunki sprzedaży są spełnione",
            "ZERO EXPORT CT ACTIVE": "Aktywny tryb Zero Export To CT",
            "ZERO EXPORT LOAD ACTIVE": "Aktywny tryb Zero Export To Load",
            "WAITING": "Manager oczekuje na zmianę warunków lub kolejny slot",
        }
        return reasons.get(status, status)

    def mark_settings_applied(self) -> None:
        self.last_applied_at = ha_now().isoformat(timespec="seconds")

    def mark_config_saved(self) -> None:
        self.last_saved_at = ha_now().isoformat(timespec="seconds")
        if self._ai_store is not None:
            self.hass.async_create_task(self.async_save_ai_data())
        self.notify_update()

    def _tou_entities(self) -> list[tuple[str, str]]:
        entities = [("Deye Time Of Use", "switch.deye_inverter_time_of_use")]
        for idx in range(1, 7):
            entities.extend([
                (f"TOU {idx} — start", self._tou_entity(idx, "start")),
                (f"TOU {idx} — minimalny SOC", self._tou_entity(idx, "soc")),
                (f"TOU {idx} — ładowanie z sieci", self._tou_entity(idx, "grid")),
            ])
        return entities

    def tou_mapping_diagnostics(self) -> dict[str, Any]:
        entities = [
            {"label": label, "entity_id": entity_id, "ok": self.entity_available(entity_id)}
            for label, entity_id in self._tou_entities()
        ]
        missing = [item["entity_id"] for item in entities if not item["ok"]]
        return {"ok": not missing, "missing": missing, "entities": entities}

    def control_values_snapshot(self) -> dict[str, str]:
        ids = {
            "System Work Mode": self.work_mode_select,
            "Max Sell Power": self.max_sell_power_number,
            "Prąd rozładowania": self.discharge_current_number,
            "Prąd ładowania baterii": self.charge_current_number,
            "Prąd ładowania z sieci": self.grid_charge_current_number,
        }
        return {label: self.state_text(entity_id) if entity_id else "nie skonfigurowano" for label, entity_id in ids.items()}

    def physical_tou_snapshot(self) -> list[dict[str, Any]]:
        """Describe expected and actually reported values of all six Deye ranges."""
        segments = self._compress_schedule_segments()
        current_hour = ha_now().hour
        rows: list[dict[str, Any]] = []
        for idx in range(1, 7):
            segment = segments[idx - 1] if idx <= len(segments) else None
            expected_start = (
                f"{int(segment['start']):02d}:00" if segment is not None else None
            )
            expected_end = None
            active = False
            if segment is not None:
                end_hour = 24 if int(segment["end"]) == 0 else int(segment["end"])
                expected_end = f"{end_hour % 24:02d}:00"
                active = int(segment["start"]) <= current_hour < end_hour
            rows.append({
                "range": idx,
                "active": active,
                "expected_start": expected_start,
                "expected_end": expected_end,
                "expected_soc": segment.get("tou_soc") if segment is not None else None,
                "actual_start": self.state_text(self._tou_entity(idx, "start")),
                "actual_soc": self.state_text(self._tou_entity(idx, "soc")),
                "expected_grid_charge": bool(segment and segment.get("grid_charge")),
                "actual_grid_charge": self.state_text(self._tou_entity(idx, "grid")),
            })
        return rows

    def active_slot_control_diagnostics(self) -> dict[str, Any]:
        """Keep logical sale guards separate from physical TOU/control values."""
        slot = self.active_slot
        charge_slot = bool(slot.enabled and slot.mode == MODE_CHARGE)
        effective_soc = slot.tou_soc
        physical_tou = self.physical_tou_snapshot()
        active_range = next((row for row in physical_tou if row["active"]), None)
        expected_grid_current = (
            slot.grid_charge_current
            if charge_slot
            else self.default_grid_charge_current
        )
        return {
            "slot": slot.key,
            "mode": slot.mode if slot.enabled else "Wyłączony",
            "minimum_sell_soc": slot.minimum_sell_soc,
            "tou_soc": slot.tou_soc,
            "charge_profile_target_soc": self.charge_profile_target_soc,
            "effective_tou_soc": effective_soc,
            "physical_range": active_range.get("range") if active_range else None,
            "physical_soc_actual": active_range.get("actual_soc") if active_range else "brak",
            "grid_charge_expected": bool(charge_slot and slot.charge_enabled),
            "grid_charge_actual": active_range.get("actual_grid_charge") if active_range else "brak",
            "currents": {
                "charge_expected": self.target_charge_current,
                "charge_actual": self.state_text(self.charge_current_number),
                "discharge_expected": self.target_discharge_current,
                "discharge_actual": self.state_text(self.discharge_current_number),
                "grid_charge_expected": expected_grid_current,
                "grid_charge_actual": self.state_text(self.grid_charge_current_number),
            },
        }

    def record_schedule_attempt(self, status: str, stage: str, expected: dict[str, Any], message: str = "") -> None:
        self.last_schedule_attempt = {
            "status": status,
            "at": ha_now().isoformat(timespec="seconds"),
            "slot": self.active_slot_key(),
            "stage": stage,
            "expected": expected,
            "actual": self.control_values_snapshot(),
            "message": message,
        }

    def diagnostics(self) -> dict[str, Any]:
        entity_ids = [self.work_mode_select, self.max_sell_power_number, self.discharge_current_number,
                      self.charge_current_number, self.grid_charge_current_number, self.battery_soc_sensor,
                      self.price_sensor, self.grid_power_sensor, self.pv_power_sensor, self.load_power_sensor,
                      self.battery_power_sensor, self.weather_entity]
        entities = []
        for entity_id in entity_ids:
            state = self.hass.states.get(entity_id) if entity_id else None
            entities.append({"entity_id": entity_id or "not_configured", "state": state.state if state is not None else "missing", "ok": state is not None and state.state not in ("unknown", "unavailable")})
        tou = self.tou_mapping_diagnostics()
        mapping_status = "ERROR" if self.mapping_error else ("TOU ERROR" if not tou["ok"] else "OK")
        return {"integration_version": "0.7.6", "connected": self.data_available, "entities": entities,
                "last_saved_at": self.last_saved_at or "never", "last_applied_at": self.last_applied_at or "never",
                "last_error": self.last_error or "none", "last_schedule_attempt": self.last_schedule_attempt,
                "manager_status": self.manager_status, "mapping_status": mapping_status,
                "mapping_segments": len(self._compress_schedule_segments()), "tou": tou,
                "physical_tou": self.physical_tou_snapshot(),
                "active_slot_control": self.active_slot_control_diagnostics(),
                "soc_semantics": {
                    "minimum_sell_soc": "warunek Selling First; nie jest zapisywany do Deye TOU",
                    "tou_soc": "fizyczny SOC Deye TOU dla slotów niebędących Charge",
                    "charge_profile_target_soc": "fizyczny SOC Deye TOU dla wszystkich slotów Charge",
                },
                "charge_profile": {
                    "grid_charge_enabled": self.charge_profile_grid_enabled,
                    "charge_current": self.charge_profile_charge_current,
                    "discharge_current": self.charge_profile_discharge_current,
                    "grid_charge_current": self.charge_profile_grid_charge_current,
                    "target_soc": self.charge_profile_target_soc,
                },
                "active_slot": self.active_slot_key(), "next_active_slot": self.next_active_slot,
                "energy_samples": len(self.energy_samples), "weather": self.weather_context(), "tariff": self.tariff_context()}

    def empty_hourly_stats(self) -> dict[str, dict[str, float]]:
        return {f"{hour:02d}": {"kwh": 0.0, "value": 0.0} for hour in range(24)}

    def empty_sales_stats(self) -> dict[str, Any]:
        return {
            "current_day": ha_now().date().isoformat(),
            "hourly": self.empty_hourly_stats(),
            "daily": {},
            "last_update": None,
        }

    def normalize_sales_stats(self, raw: dict[str, Any] | None) -> dict[str, Any]:
        stats = self.empty_sales_stats()
        if isinstance(raw, dict):
            stats.update(raw)
        hourly = stats.get("hourly")
        if not isinstance(hourly, dict):
            hourly = {}
        normalized_hourly = self.empty_hourly_stats()
        for hour, values in hourly.items():
            key = f"{int(hour):02d}" if str(hour).isdigit() else str(hour).zfill(2)
            if key not in normalized_hourly or not isinstance(values, dict):
                continue
            normalized_hourly[key]["kwh"] = self.safe_float(values.get("kwh"), 0)
            normalized_hourly[key]["value"] = self.safe_float(values.get("value"), 0)
        stats["hourly"] = normalized_hourly
        daily = stats.get("daily")
        stats["daily"] = daily if isinstance(daily, dict) else {}
        return stats

    async def async_load_sales_stats(self) -> None:
        self._stats_store = Store(self.hass, 1, f"{DOMAIN}_{self.entry_id}_sales_stats")
        self.sales_stats = self.normalize_sales_stats(await self._stats_store.async_load())
        last_update = self.sales_stats.get("last_update")
        if last_update:
            try:
                self._energy_last_update = datetime.fromisoformat(last_update)
            except (TypeError, ValueError):
                self._energy_last_update = None
        self._energy_day = str(self.sales_stats.get("current_day") or ha_now().date().isoformat())
        self.refresh_sales_totals()

    async def async_save_sales_stats(self) -> None:
        if self._stats_store is None or not self._stats_dirty:
            return
        self.sales_stats["last_update"] = self._energy_last_update.isoformat() if self._energy_last_update else None
        await self._stats_store.async_save(self.sales_stats)
        self._stats_dirty = False

    async def async_load_ai_data(self) -> None:
        self._ai_store = Store(self.hass, 1, f"{DOMAIN}_{self.entry_id}_ai_data")
        raw = await self._ai_store.async_load()
        data = raw if isinstance(raw, dict) else {}
        settings = data.get("settings")
        history = data.get("history")
        self.ai_settings = settings if isinstance(settings, dict) else {}
        self.ai_history = history[:365] if isinstance(history, list) else []
        future_plan = data.get("future_plan")
        self.future_plan = future_plan if isinstance(future_plan, dict) else {}
        self.last_saved_at = str(data.get("last_saved_at") or "")

        # The Charge template is one atomic user-owned record.  Loading all
        # fields together prevents individual RestoreEntity callbacks from
        # rebuilding a mixed profile after a restart.
        raw_profile = data.get("charge_profile")
        if isinstance(raw_profile, dict):
            numeric = {
                "charge_profile_charge_current": self.safe_float(raw_profile.get("charge_current"), float("nan")),
                "charge_profile_discharge_current": self.safe_float(raw_profile.get("discharge_current"), float("nan")),
                "charge_profile_grid_charge_current": self.safe_float(raw_profile.get("grid_charge_current"), float("nan")),
                "charge_profile_target_soc": self.safe_float(raw_profile.get("target_soc"), float("nan")),
            }
            grid_enabled = raw_profile.get("grid_charge_enabled")
            currents_ok = all(
                math.isfinite(value) and 0 <= value <= 240
                for key, value in numeric.items()
                if key != "charge_profile_target_soc"
            )
            soc_ok = math.isfinite(numeric["charge_profile_target_soc"]) and 0 <= numeric["charge_profile_target_soc"] <= 100
            if currents_ok and soc_ok and isinstance(grid_enabled, bool):
                for key, value in numeric.items():
                    setattr(self, key, value)
                self.charge_profile_grid_enabled = grid_enabled
                self._charge_profile_loaded_from_store = True

    async def async_save_ai_data(self) -> None:
        if self._ai_store is None:
            return
        await self._ai_store.async_save({
            "settings": self.ai_settings,
            "history": self.ai_history[:365],
            "future_plan": self.future_plan,
            "last_saved_at": self.last_saved_at,
            "charge_profile": {
                "charge_current": self.charge_profile_charge_current,
                "discharge_current": self.charge_profile_discharge_current,
                "grid_charge_current": self.charge_profile_grid_charge_current,
                "target_soc": self.charge_profile_target_soc,
                "grid_charge_enabled": self.charge_profile_grid_enabled,
            },
        })

    async def async_set_ai_settings(self, settings: dict[str, Any]) -> None:
        self.ai_settings = dict(settings)
        await self.async_save_ai_data()
        self.notify_update()

    async def async_add_ai_analysis(self, analysis: dict[str, Any]) -> None:
        analysis = dict(analysis)
        analysis.setdefault("event", "suggestion")
        if analysis.get("event") == "suggestion":
            latest = next((item for item in self.ai_history if item.get("event", "suggestion") == "suggestion"), None)
            if latest and analysis.get("fingerprint") and latest.get("fingerprint") == analysis.get("fingerprint"):
                return
        self.ai_history = [analysis, *self.ai_history][:365]
        await self.async_save_ai_data()
        self.notify_update()

    async def async_rate_ai_analysis(self, timestamp: float, rating: int) -> None:
        for item in self.ai_history:
            if self.safe_float(item.get("timestamp"), -1) == timestamp:
                item["rating"] = max(1, min(5, int(rating)))
                item["rated_at"] = int(ha_now().timestamp() * 1000)
                await self.async_save_ai_data()
                self.notify_update()
                return

    async def async_clear_ai_history(self) -> None:
        self.ai_history = []
        await self.async_save_ai_data()
        self.notify_update()

    def _validate_future_plan_updates(self, updates: Any) -> list[dict[str, Any]]:
        """Validate a dated AI plan without touching the live 24-hour schedule."""
        if not isinstance(updates, list) or not updates:
            raise ValueError("Plan na jutro nie zawiera wybranych godzin")
        numeric_limits = {
            "sell_power": (0.0, 13000.0),
            "discharge_current": (0.0, 240.0),
            "charge_current": (0.0, 240.0),
            "grid_charge_current": (0.0, 240.0),
            "minimum_sell_soc": (0.0, 100.0),
            "tou_soc": (0.0, 100.0),
            "min_sell_price": (0.0, 5.0),
        }
        allowed = {"slot_key", "enabled", "mode", "charge_enabled", *numeric_limits}
        normalized: list[dict[str, Any]] = []
        seen: set[str] = set()
        for raw in updates:
            raw = dict(raw) if isinstance(raw, dict) else raw
            if not isinstance(raw, dict):
                raise ValueError("Każda pozycja planu musi być obiektem")
            # ``min_soc`` remains an old spelling of the Selling First
            # threshold.  ``tou_soc`` is deliberately independent.
            if "min_soc" in raw:
                raw.setdefault("minimum_sell_soc", raw.pop("min_soc"))
            unknown = set(raw) - allowed
            if unknown:
                raise ValueError(f"Nieobsługiwane pola planu: {', '.join(sorted(unknown))}")
            slot_key = str(raw.get("slot_key") or "")
            if slot_key not in self.slots or slot_key in seen:
                raise ValueError(f"Nieprawidłowa lub powtórzona godzina planu: {slot_key}")
            seen.add(slot_key)
            item: dict[str, Any] = {"slot_key": slot_key}
            if "enabled" in raw:
                item["enabled"] = bool(raw["enabled"])
            if "charge_enabled" in raw:
                item["charge_enabled"] = bool(raw["charge_enabled"])
            if "mode" in raw:
                mode = str(raw["mode"])
                if mode not in SLOT_MODES:
                    raise ValueError(f"Nieobsługiwany tryb planu: {mode}")
                item["mode"] = mode
            for name, (minimum, maximum) in numeric_limits.items():
                if name not in raw:
                    continue
                value = float(raw[name])
                if not math.isfinite(value) or not minimum <= value <= maximum:
                    raise ValueError(f"{name} musi mieścić się w zakresie {minimum:g}–{maximum:g}")
                item[name] = value
            normalized.append(item)
        return normalized

    async def async_save_future_plan(self, payload: dict[str, Any]) -> None:
        """Persist an explicitly accepted plan for the next calendar day."""
        if not isinstance(payload, dict):
            raise ValueError("Plan na jutro musi być obiektem")
        expected_date = (ha_now().date() + timedelta(days=1)).isoformat()
        plan_date = str(payload.get("date") or "")
        if plan_date != expected_date:
            raise ValueError(f"Plan można zapisać wyłącznie na jutro ({expected_date})")
        updates = self._validate_future_plan_updates(payload.get("updates"))
        self.future_plan = {
            "date": plan_date,
            "status": "scheduled",
            "created_at": ha_now().isoformat(timespec="seconds"),
            "updated_at": ha_now().isoformat(timespec="seconds"),
            "strategy": str(payload.get("strategy") or "balanced"),
            "updates": updates,
            "labels": [str(value) for value in payload.get("labels", []) if value is not None][:24],
        }
        await self.async_add_ai_analysis({
            "timestamp": int(ha_now().timestamp() * 1000),
            "event": "future_plan_scheduled",
            "date": plan_date,
            "selected_hours": self.future_plan["labels"],
        })
        await self.async_save_ai_data()
        self.notify_update()

    async def async_cancel_future_plan(self, reason: str = "Anulowano przez użytkownika") -> None:
        if not self.future_plan:
            return
        self.future_plan = {
            **self.future_plan,
            "status": "cancelled",
            "cancelled_at": ha_now().isoformat(timespec="seconds"),
            "reason": reason,
        }
        await self.async_save_ai_data()
        self.notify_update()

    async def async_process_future_plan(self) -> None:
        """Apply the accepted dated plan once, after validating live safety inputs."""
        plan = self.future_plan
        if not plan or plan.get("status") != "scheduled":
            return
        today = ha_now().date().isoformat()
        plan_date = str(plan.get("date") or "")
        if plan_date > today:
            return
        if plan_date < today:
            await self.async_cancel_future_plan("Plan wygasł przed zastosowaniem")
            async with self._operation_lock:
                await self.async_apply_safe_defaults("Plan na jutro wygasł przed zastosowaniem")
            return
        try:
            updates = self._validate_future_plan_updates(plan.get("updates"))
            selling_needing_soc = any(
                item.get("mode") == MODE_SELLING_FIRST and self.safe_float(item.get("minimum_sell_soc"), 0) > 0
                for item in updates
            )
            selling_needing_price = any(
                item.get("mode") == MODE_SELLING_FIRST and self.safe_float(item.get("min_sell_price"), 0) > 0
                for item in updates
            )
            if selling_needing_soc and self.state_float_or_none(self.battery_soc_sensor) is None:
                raise RuntimeError("brak poprawnego odczytu SOC dla sprzedaży")
            if selling_needing_price and self.state_float_or_none(self.price_sensor) is None:
                raise RuntimeError("brak ceny sprzedaży")
            await self.async_apply_schedule_patch(updates)
            self.future_plan = {
                **plan,
                "status": "applied",
                "applied_at": ha_now().isoformat(timespec="seconds"),
            }
            await self.async_add_ai_analysis({
                "timestamp": int(ha_now().timestamp() * 1000),
                "event": "future_plan_applied",
                "date": plan_date,
                "selected_hours": plan.get("labels", []),
            })
            await self.async_save_ai_data()
        except Exception as err:
            self.future_plan = {
                **plan,
                "status": "failed",
                "failed_at": ha_now().isoformat(timespec="seconds"),
                "reason": str(err),
            }
            await self.async_save_ai_data()
            async with self._operation_lock:
                await self.async_apply_safe_defaults(f"Plan na dziś anulowany: {err}")
        self.notify_update()

    async def async_clear_all_history(self) -> None:
        self.ai_history = []
        self.solcast_history = []
        self.solcast_tracking = {}
        self.learning_history = []
        self.learning_tracking = {}
        self.energy_samples = []
        self.daily_archive = []
        self.monthly_archive = []
        await self.async_save_ai_data()
        await self.async_save_solcast_history()
        await self.async_save_learning_history()
        await self.async_save_energy_history()
        self.notify_update()

    async def async_load_solcast_history(self) -> None:
        self._solcast_store = Store(self.hass, 1, f"{DOMAIN}_{self.entry_id}_solcast_history")
        raw = await self._solcast_store.async_load()
        data = raw if isinstance(raw, dict) else {}
        history = data.get("history")
        tracking = data.get("tracking")
        self.solcast_history = history[:1825] if isinstance(history, list) else []
        self.solcast_tracking = tracking if isinstance(tracking, dict) else {}

    async def async_save_solcast_history(self) -> None:
        if self._solcast_store is None:
            return
        await self._solcast_store.async_save({"history": self.solcast_history[:1825], "tracking": self.solcast_tracking})

    async def async_update_solcast_history(self) -> None:
        now = ha_now()
        today = now.date().isoformat()
        forecast = self.solcast_forecast_today_value()
        actual = max(0, self.state_float(self.daily_pv_production_sensor, 0))
        tracked_day = str(self.solcast_tracking.get("date") or "")
        changed_day = bool(tracked_day and tracked_day != today)
        if changed_day:
            previous_forecast = self.safe_float(self.solcast_tracking.get("forecast"), 0)
            previous_actual = self.safe_float(self.solcast_tracking.get("actual"), 0)
            error = previous_actual - previous_forecast
            error_percent = (error / previous_forecast * 100) if previous_forecast > 0 else 0
            accuracy = max(0, 100 - abs(error_percent)) if previous_forecast > 0 else 0
            sales = self.sales_stats.get("daily", {}).get(tracked_day, {})
            for item in self.ai_history:
                timestamp = self.safe_float(item.get("timestamp"), 0)
                item_day = datetime.fromtimestamp(timestamp / 1000, tz=now.tzinfo).date().isoformat() if timestamp > 0 else ""
                if item.get("event") == "accepted" and item_day == tracked_day and not item.get("outcome"):
                    item["outcome"] = {
                        "sold_kwh": round(self.safe_float(sales.get("kwh"), 0), 3),
                        "sold_value": round(self.safe_float(sales.get("value"), 0), 2),
                        "pv_accuracy_percent": round(accuracy, 1),
                    }
                    item["evaluated_at"] = int(now.timestamp() * 1000)
            self.solcast_history = [{
                "date": tracked_day,
                "forecast_kwh": round(previous_forecast, 3),
                "actual_kwh": round(previous_actual, 3),
                "error_kwh": round(error, 3),
                "error_percent": round(error_percent, 1),
                "accuracy_percent": round(accuracy, 1),
                "day_complete": True,
            }, *[row for row in self.solcast_history if row.get("date") != tracked_day]][:1825]
            await self.async_add_ai_analysis({
                "timestamp": int(now.timestamp() * 1000),
                "event": "daily_summary",
                "date": tracked_day,
                "forecast_kwh": round(previous_forecast, 3),
                "actual_kwh": round(previous_actual, 3),
                "accuracy_percent": round(accuracy, 1),
            })
            self.solcast_tracking = {}
        if not self.solcast_tracking:
            self.solcast_tracking = {"date": today, "forecast": forecast, "actual": actual}
        else:
            if self.safe_float(self.solcast_tracking.get("forecast"), 0) <= 0 and forecast > 0:
                self.solcast_tracking["forecast"] = forecast
            self.solcast_tracking["actual"] = actual
        if changed_day or now.minute % 15 == 0:
            await self.async_save_solcast_history()

    async def async_load_learning_history(self) -> None:
        self._learning_store = Store(self.hass, 1, f"{DOMAIN}_{self.entry_id}_learning_history")
        raw = await self._learning_store.async_load()
        data = raw if isinstance(raw, dict) else {}
        history = data.get("history")
        tracking = data.get("tracking")
        self.learning_history = history[:17520] if isinstance(history, list) else []
        self.learning_tracking = tracking if isinstance(tracking, dict) else {}

    async def async_save_learning_history(self) -> None:
        if self._learning_store is None:
            return
        await self._learning_store.async_save({
            "history": self.learning_history[:17520],
            "tracking": self.learning_tracking,
        })

    async def async_load_energy_history(self) -> None:
        self._samples_store = Store(self.hass, 1, f"{DOMAIN}_{self.entry_id}_energy_samples")
        raw = await self._samples_store.async_load()
        data = raw if isinstance(raw, dict) else {}
        self.energy_samples = data.get("samples", []) if isinstance(data.get("samples"), list) else []
        self.daily_archive = data.get("daily", []) if isinstance(data.get("daily"), list) else []
        self.monthly_archive = data.get("monthly", []) if isinstance(data.get("monthly"), list) else []
        last = data.get("last_sample")
        try:
            self._last_energy_sample_at = datetime.fromisoformat(str(last)) if last else None
        except (TypeError, ValueError):
            self._last_energy_sample_at = None

    async def async_save_energy_history(self) -> None:
        if self._samples_store is None:
            return
        await self._samples_store.async_save({
            "samples": self.energy_samples,
            "daily": self.daily_archive,
            "monthly": self.monthly_archive,
            "last_sample": self._last_energy_sample_at.isoformat() if self._last_energy_sample_at else None,
        })

    def _archive_energy_samples(self, now: datetime) -> None:
        cutoff = now - timedelta(days=90)
        old = []
        retained = []
        for sample in self.energy_samples:
            try:
                stamp = datetime.fromisoformat(str(sample.get("timestamp")))
                is_old = stamp < cutoff
            except (TypeError, ValueError):
                continue
            (old if is_old else retained).append(sample)
        self.energy_samples = retained
        if not old:
            return
        grouped: dict[str, list[dict[str, Any]]] = {}
        for sample in old:
            grouped.setdefault(str(sample.get("timestamp"))[:10], []).append(sample)
        existing = {str(row.get("date")): row for row in self.daily_archive}
        for day, samples in grouped.items():
            row: dict[str, Any] = {"date": day, "samples": len(samples)}
            for key in ("pv_power", "load_power", "grid_power", "battery_power", "soc", "sell_price", "buy_price"):
                values = [self.safe_float(item.get(key), 0) for item in samples if item.get(key) is not None]
                row[f"{key}_avg"] = round(sum(values) / len(values), 3) if values else None
            sample_hours = 5 / 60
            row["pv_kwh"] = round(sum(max(0, self.safe_float(item.get("pv_power"), 0)) for item in samples) / 1000 * sample_hours, 3)
            row["load_kwh"] = round(sum(max(0, self.safe_float(item.get("load_power"), 0)) for item in samples) / 1000 * sample_hours, 3)
            row["grid_import_kwh"] = round(sum(max(0, self.safe_float(item.get("grid_power"), 0)) for item in samples) / 1000 * sample_hours, 3)
            row["grid_export_kwh"] = round(sum(max(0, -self.safe_float(item.get("grid_power"), 0)) for item in samples) / 1000 * sample_hours, 3)
            row["battery_charge_kwh"] = round(sum(max(0, -self.safe_float(item.get("battery_power"), 0)) for item in samples) / 1000 * sample_hours, 3)
            row["battery_discharge_kwh"] = round(sum(max(0, self.safe_float(item.get("battery_power"), 0)) for item in samples) / 1000 * sample_hours, 3)
            existing[day] = row
        daily_cutoff = (now - timedelta(days=1825)).date().isoformat()
        expired_daily = [row for day, row in existing.items() if day < daily_cutoff]
        self.daily_archive = sorted(
            (row for day, row in existing.items() if day >= daily_cutoff),
            key=lambda row: str(row.get("date")),
            reverse=True,
        )
        months: dict[str, list[dict[str, Any]]] = {}
        for row in self.daily_archive:
            months.setdefault(str(row.get("date"))[:7], []).append(row)
        energy_keys = ("pv_kwh", "load_kwh", "grid_import_kwh", "grid_export_kwh", "battery_charge_kwh", "battery_discharge_kwh")
        def month_row(month: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
            return {
                "month": month,
                "days": len(rows),
                "samples": sum(int(row.get("samples", 0)) for row in rows),
                **{key: round(sum(self.safe_float(row.get(key), 0) for row in rows), 3) for key in energy_keys},
            }
        retained_months = [month_row(month, rows) for month, rows in sorted(months.items(), reverse=True)]
        permanent = {
            str(row.get("month")): row
            for row in self.monthly_archive
            if str(row.get("month")) < daily_cutoff[:7]
        }
        expired_months: dict[str, list[dict[str, Any]]] = {}
        for row in expired_daily:
            expired_months.setdefault(str(row.get("date"))[:7], []).append(row)
        for month, rows in expired_months.items():
            permanent[month] = month_row(month, rows)
        self.monthly_archive = sorted([*retained_months, *permanent.values()], key=lambda row: str(row.get("month")), reverse=True)

    async def async_update_energy_sample(self) -> None:
        now = ha_now()
        if self._last_energy_sample_at:
            try:
                if (now - self._last_energy_sample_at).total_seconds() < 285:
                    return
            except TypeError:
                self._last_energy_sample_at = None
        fields = {
            "pv_power": self.state_float_or_none(self.pv_power_sensor),
            "load_power": self.state_float_or_none(self.load_power_sensor),
            "grid_power": self.normalized_grid_power() if self.entity_available(self.grid_power_sensor) else None,
            "battery_power": self.normalized_battery_power() if self.entity_available(self.battery_power_sensor) else None,
            "soc": self.state_float_or_none(self.battery_soc_sensor),
            "sell_price": self.state_float_or_none(self.price_sensor),
            "buy_price": self.state_float_or_none(self.buy_price_today_sensor),
            "daily_pv": self.state_float_or_none(self.daily_pv_production_sensor),
        }
        tariff = self.tariff_context(now)
        sample = {
            "timestamp": now.replace(second=0, microsecond=0).isoformat(),
            **fields,
            "missing": [key for key, value in fields.items() if value is None],
            "tariff": {
                key: tariff.get(key)
                for key in ("provider", "plan", "zone", "season", "day_type", "distribution_rate", "catalog_version")
            },
        }
        self.energy_samples.append(sample)
        self._last_energy_sample_at = now
        self._archive_energy_samples(now)
        await self.async_save_energy_history()

    async def async_update_weather_forecast(self) -> None:
        entity_id = self.weather_entity
        if not entity_id or not self.entity_available(entity_id):
            self.weather_forecast = []
            self.weather_daily_forecast = []
            self.weather_last_error = "Encja pogody jest niedostępna"
            return

        async def fetch_forecast(kind: str) -> list[dict[str, Any]]:
            response = await self.hass.services.async_call(
                "weather",
                "get_forecasts",
                {"type": kind},
                target={"entity_id": entity_id},
                blocking=True,
                return_response=True,
            )
            payload = response.get(entity_id, response) if isinstance(response, dict) else {}
            forecast = payload.get("forecast", []) if isinstance(payload, dict) else []
            return [row for row in forecast if isinstance(row, dict)] if isinstance(forecast, list) else []

        errors: list[str] = []
        hourly: list[dict[str, Any]] = []
        daily: list[dict[str, Any]] = []
        try:
            hourly = await fetch_forecast("hourly")
        except Exception as err:  # Weather is optional and must never block inverter safety logic.
            errors.append(f"godzinowa: {err}")
        try:
            daily = await fetch_forecast("daily")
        except Exception as err:
            errors.append(f"dzienna: {err}")

        # Compatibility fallback for older weather entities exposing forecast as an attribute.
        if not hourly:
            state = self.hass.states.get(entity_id)
            fallback = state.attributes.get("forecast", []) if state is not None else []
            hourly = [row for row in fallback if isinstance(row, dict)] if isinstance(fallback, list) else []

        # Some providers implement only the hourly endpoint. Build a truthful
        # daily summary from those samples instead of displaying invented zeros.
        if not daily and hourly:
            grouped: dict[str, list[dict[str, Any]]] = {}
            local_now = ha_now()
            for row in hourly:
                raw_time = row.get("datetime", row.get("time"))
                try:
                    stamp = datetime.fromisoformat(str(raw_time).replace("Z", "+00:00"))
                    if local_now.tzinfo is not None and stamp.tzinfo is not None:
                        stamp = stamp.astimezone(local_now.tzinfo)
                    day_key = stamp.date().isoformat()
                except (TypeError, ValueError):
                    continue
                grouped.setdefault(day_key, []).append(row)
            for day_key, rows in sorted(grouped.items())[:7]:
                temperatures = [
                    self.safe_float(row.get("temperature"), float("nan"))
                    for row in rows
                    if row.get("temperature") is not None
                ]
                temperatures = [value for value in temperatures if value == value]
                condition_counts: dict[str, int] = {}
                for row in rows:
                    condition = str(row.get("condition") or "")
                    if condition:
                        condition_counts[condition] = condition_counts.get(condition, 0) + 1
                condition = max(condition_counts, key=condition_counts.get) if condition_counts else None
                probabilities = [
                    self.safe_float(row.get("precipitation_probability"), 0)
                    for row in rows
                    if row.get("precipitation_probability") is not None
                ]
                daily.append({
                    "datetime": day_key,
                    "condition": condition,
                    "temperature": max(temperatures) if temperatures else None,
                    "templow": min(temperatures) if temperatures else None,
                    "precipitation_probability": max(probabilities) if probabilities else None,
                    "derived_from_hourly": True,
                })

        self.weather_forecast = hourly[:48]
        self.weather_daily_forecast = daily[:7]
        self.weather_last_error = "; ".join(errors)
        if hourly or daily:
            self.weather_last_updated = ha_now().isoformat(timespec="seconds")

    def _new_learning_hour(self, hour_key: str, now: datetime) -> dict[str, Any]:
        tariff = self.tariff_context(now)
        return {
            "hour": hour_key,
            "last_sample": now.isoformat(),
            "samples": 0,
            "pv_kwh": 0.0,
            "load_kwh": 0.0,
            "grid_import_kwh": 0.0,
            "grid_export_kwh": 0.0,
            "battery_charge_kwh": 0.0,
            "battery_discharge_kwh": 0.0,
            "soc_sum": 0.0,
            "soc_min": None,
            "soc_max": None,
            "sell_price_sum": 0.0,
            "buy_price_sum": 0.0,
            "solcast_forecast_kwh": self.solcast_forecast_today_value(),
            "daily_pv_kwh": max(0, self.state_float(self.daily_pv_production_sensor, 0)),
            "tariff": {
                key: tariff.get(key)
                for key in ("provider", "plan", "zone", "season", "day_type", "distribution_rate", "catalog_version")
            },
        }

    def _finalize_learning_hour(self, tracking: dict[str, Any]) -> dict[str, Any]:
        samples = max(1, int(tracking.get("samples", 0)))
        return {
            "hour": tracking.get("hour"),
            "samples": int(tracking.get("samples", 0)),
            "pv_kwh": round(self.safe_float(tracking.get("pv_kwh"), 0), 4),
            "load_kwh": round(self.safe_float(tracking.get("load_kwh"), 0), 4),
            "grid_import_kwh": round(self.safe_float(tracking.get("grid_import_kwh"), 0), 4),
            "grid_export_kwh": round(self.safe_float(tracking.get("grid_export_kwh"), 0), 4),
            "battery_charge_kwh": round(self.safe_float(tracking.get("battery_charge_kwh"), 0), 4),
            "battery_discharge_kwh": round(self.safe_float(tracking.get("battery_discharge_kwh"), 0), 4),
            "soc_avg": round(self.safe_float(tracking.get("soc_sum"), 0) / samples, 1),
            "soc_min": round(self.safe_float(tracking.get("soc_min"), 0), 1),
            "soc_max": round(self.safe_float(tracking.get("soc_max"), 0), 1),
            "sell_price_avg": round(self.safe_float(tracking.get("sell_price_sum"), 0) / samples, 3),
            "buy_price_avg": round(self.safe_float(tracking.get("buy_price_sum"), 0) / samples, 3),
            "solcast_forecast_kwh": round(self.safe_float(tracking.get("solcast_forecast_kwh"), 0), 3),
            "daily_pv_kwh": round(self.safe_float(tracking.get("daily_pv_kwh"), 0), 3),
            "tariff": tracking.get("tariff", {}),
        }

    async def async_update_learning_history(self) -> None:
        now = ha_now()
        hour_key = now.strftime("%Y-%m-%dT%H:00:00%z")
        if self.learning_tracking.get("hour") != hour_key:
            if self.learning_tracking.get("hour"):
                completed = self._finalize_learning_hour(self.learning_tracking)
                self.learning_history = [
                    completed,
                    *[row for row in self.learning_history if row.get("hour") != completed["hour"]],
                ][:17520]
            self.learning_tracking = self._new_learning_hour(hour_key, now)

        tracking = self.learning_tracking
        try:
            previous = datetime.fromisoformat(str(tracking.get("last_sample")))
            elapsed_seconds = max(0.0, min(120.0, (now - previous).total_seconds()))
        except (TypeError, ValueError):
            elapsed_seconds = 0.0
        hours = elapsed_seconds / 3600.0

        pv_power = self.state_float(self.pv_power_sensor, 0)
        load_power = self.state_float(self.load_power_sensor, 0)
        grid_power = self.normalized_grid_power()
        battery_power = self.normalized_battery_power()
        soc = self.state_float(self.battery_soc_sensor, 0)
        sell_price = self.state_float(self.price_sensor, 0)
        buy_price = self.state_float(self.buy_price_today_sensor, 0)

        tracking["pv_kwh"] = self.safe_float(tracking.get("pv_kwh"), 0) + max(0, pv_power) / 1000 * hours
        tracking["load_kwh"] = self.safe_float(tracking.get("load_kwh"), 0) + max(0, load_power) / 1000 * hours
        tracking["grid_import_kwh"] = self.safe_float(tracking.get("grid_import_kwh"), 0) + max(0, grid_power) / 1000 * hours
        tracking["grid_export_kwh"] = self.safe_float(tracking.get("grid_export_kwh"), 0) + max(0, -grid_power) / 1000 * hours
        tracking["battery_charge_kwh"] = self.safe_float(tracking.get("battery_charge_kwh"), 0) + max(0, -battery_power) / 1000 * hours
        tracking["battery_discharge_kwh"] = self.safe_float(tracking.get("battery_discharge_kwh"), 0) + max(0, battery_power) / 1000 * hours
        tracking["samples"] = int(tracking.get("samples", 0)) + 1
        tracking["soc_sum"] = self.safe_float(tracking.get("soc_sum"), 0) + soc
        tracking["sell_price_sum"] = self.safe_float(tracking.get("sell_price_sum"), 0) + sell_price
        tracking["buy_price_sum"] = self.safe_float(tracking.get("buy_price_sum"), 0) + buy_price
        tracking["soc_min"] = soc if tracking.get("soc_min") is None else min(self.safe_float(tracking.get("soc_min"), soc), soc)
        tracking["soc_max"] = soc if tracking.get("soc_max") is None else max(self.safe_float(tracking.get("soc_max"), soc), soc)
        tracking["daily_pv_kwh"] = max(0, self.state_float(self.daily_pv_production_sensor, 0))
        tracking["last_sample"] = now.isoformat()

        if now.minute % 15 == 0:
            await self.async_save_learning_history()
            self.notify_update()

    def learning_summary(self) -> dict[str, Any]:
        rows = self.learning_history
        dates = {str(row.get("hour", ""))[:10] for row in rows if row.get("hour")}
        per_hour: list[dict[str, Any]] = []
        for hour in range(24):
            matches = [row for row in rows if str(row.get("hour", ""))[11:13] == f"{hour:02d}"]
            if not matches:
                continue
            count = len(matches)
            per_hour.append({
                "hour": f"{hour:02d}:00",
                "samples": count,
                "pv_kwh": round(sum(self.safe_float(row.get("pv_kwh"), 0) for row in matches) / count, 3),
                "load_kwh": round(sum(self.safe_float(row.get("load_kwh"), 0) for row in matches) / count, 3),
                "grid_export_kwh": round(sum(self.safe_float(row.get("grid_export_kwh"), 0) for row in matches) / count, 3),
                "battery_charge_kwh": round(sum(self.safe_float(row.get("battery_charge_kwh"), 0) for row in matches) / count, 3),
                "battery_discharge_kwh": round(sum(self.safe_float(row.get("battery_discharge_kwh"), 0) for row in matches) / count, 3),
                "soc_avg": round(sum(self.safe_float(row.get("soc_avg"), 0) for row in matches) / count, 1),
                "sell_price_avg": round(sum(self.safe_float(row.get("sell_price_avg"), 0) for row in matches) / count, 3),
                "buy_price_avg": round(sum(self.safe_float(row.get("buy_price_avg"), 0) for row in matches) / count, 3),
            })
        completed_rows = [
            row for row in self.solcast_history
            if row.get("accuracy_percent") is not None
            and self.safe_float(row.get("forecast_kwh"), 0) > 0
            and row.get("day_complete", True)
        ]
        accuracy_rows = [self.safe_float(row.get("accuracy_percent"), 0) for row in completed_rows]
        correction_rows = [
            max(0.5, min(1.5, self.safe_float(row.get("actual_kwh"), 0) / self.safe_float(row.get("forecast_kwh"), 1)))
            for row in completed_rows
        ]
        current_forecast = self.safe_float(self.solcast_tracking.get("forecast"), 0)
        current_actual = self.safe_float(self.solcast_tracking.get("actual"), 0)
        current_progress = min(100.0, current_actual / current_forecast * 100) if current_forecast > 0 else None
        latest = completed_rows[0] if completed_rows else {}
        tariff_groups: dict[tuple[str, ...], list[dict[str, Any]]] = {}
        for row in rows:
            tariff = row.get("tariff") if isinstance(row.get("tariff"), dict) else {}
            if not tariff:
                continue
            key = (
                str(tariff.get("provider") or ""),
                str(tariff.get("plan") or ""),
                str(tariff.get("zone") or ""),
                str(tariff.get("day_type") or ""),
                str(tariff.get("season") or ""),
                str(row.get("hour") or "")[11:13],
            )
            tariff_groups.setdefault(key, []).append(row)
        tariff_learning = []
        for key, matches in tariff_groups.items():
            count = len(matches)
            tariff_learning.append({
                "provider": key[0], "plan": key[1], "zone": key[2],
                "day_type": key[3], "season": key[4], "hour": key[5],
                "samples": count,
                "load_kwh": round(sum(self.safe_float(row.get("load_kwh"), 0) for row in matches) / count, 3),
                "grid_import_kwh": round(sum(self.safe_float(row.get("grid_import_kwh"), 0) for row in matches) / count, 3),
                "battery_charge_kwh": round(sum(self.safe_float(row.get("battery_charge_kwh"), 0) for row in matches) / count, 3),
            })
        return {
            "retention_days": 730,
            "retention": {"raw_5_min_days": 90, "hourly_months": 24, "daily_years": 5, "monthly_limit": None},
            "raw_samples": len(self.energy_samples),
            "daily_archive_rows": len(self.daily_archive),
            "monthly_archive_rows": len(self.monthly_archive),
            "recorded_days": len(dates),
            "recorded_hours": len(rows),
            "solcast_accuracy_avg": round(sum(accuracy_rows) / len(accuracy_rows), 1) if accuracy_rows else None,
            "solcast_correction_factor": round(sum(correction_rows) / len(correction_rows), 3) if correction_rows else None,
            "solcast_accuracy_days": len(accuracy_rows),
            "solcast_last_accuracy": latest.get("accuracy_percent"),
            "solcast_last_date": latest.get("date"),
            "current_forecast_progress": round(current_progress, 1) if current_progress is not None else None,
            "typical_daily_pv_kwh": round(sum(row["pv_kwh"] for row in per_hour), 2),
            "typical_daily_load_kwh": round(sum(row["load_kwh"] for row in per_hour), 2),
            "typical_daily_grid_export_kwh": round(sum(row["grid_export_kwh"] for row in per_hour), 2),
            "typical_daily_battery_charge_kwh": round(sum(row["battery_charge_kwh"] for row in per_hour), 2),
            "typical_daily_battery_discharge_kwh": round(sum(row["battery_discharge_kwh"] for row in per_hour), 2),
            "sources": {
                "pv_power": self.pv_power_sensor,
                "load_power": self.load_power_sensor,
                "grid_power": self.grid_power_sensor,
                "battery_power": self.battery_power_sensor,
                "battery_soc": self.battery_soc_sensor,
                "daily_pv": self.daily_pv_production_sensor,
                "solcast": self.solcast_forecast_today_sensor,
                "sell_price": self.price_sensor,
                "buy_price": self.buy_price_today_sensor,
                "weather": self.weather_entity,
            },
            "weather": self.weather_context(),
            "tariff": self.tariff_context(),
            "tariff_learning": tariff_learning[:500],
            "hourly_profile": per_hour,
        }

    def history_daily_summary(self) -> list[dict[str, Any]]:
        grouped: dict[str, dict[str, Any]] = {}
        for row in self.learning_history:
            day = str(row.get("hour") or "")[:10]
            if not day:
                continue
            item = grouped.setdefault(day, {"date": day})
            for key in ("pv_kwh", "load_kwh", "grid_import_kwh", "grid_export_kwh", "battery_charge_kwh", "battery_discharge_kwh"):
                item[key] = self.safe_float(item.get(key), 0) + self.safe_float(row.get(key), 0)
            item["soc_min"] = min(self.safe_float(item.get("soc_min"), 100), self.safe_float(row.get("soc_min"), 100))
            item["soc_max"] = max(self.safe_float(item.get("soc_max"), 0), self.safe_float(row.get("soc_max"), 0))
        for day, values in self.sales_stats.get("daily", {}).items():
            item = grouped.setdefault(day, {"date": day})
            item["sold_kwh"] = self.safe_float(values.get("kwh"), 0)
            item["sold_value"] = self.safe_float(values.get("value"), 0)
        for row in self.solcast_history:
            day = str(row.get("date") or "")
            item = grouped.setdefault(day, {"date": day})
            item.update({
                "forecast_kwh": self.safe_float(row.get("forecast_kwh"), 0),
                "actual_kwh": self.safe_float(row.get("actual_kwh"), 0),
                "accuracy_percent": self.safe_float(row.get("accuracy_percent"), 0),
            })
        tracking_day = str(self.solcast_tracking.get("date") or "")
        if tracking_day:
            forecast = self.safe_float(self.solcast_tracking.get("forecast"), 0)
            actual = self.safe_float(self.solcast_tracking.get("actual"), 0)
            grouped.setdefault(tracking_day, {"date": tracking_day}).update({
                "forecast_kwh": forecast,
                "actual_kwh": actual,
                "accuracy_percent": None,
                "forecast_progress_percent": min(100, actual / forecast * 100) if forecast > 0 else None,
                "day_complete": False,
            })
        for row in self.daily_archive:
            day = str(row.get("date") or "")
            if day:
                grouped.setdefault(day, dict(row))
        return [
            {key: round(value, 3) if isinstance(value, float) else value for key, value in row.items()}
            for _day, row in sorted(grouped.items(), reverse=True)[:1825]
        ]

    def history_monthly_summary(self) -> list[dict[str, Any]]:
        grouped: dict[str, dict[str, Any]] = {}
        for row in self.history_daily_summary():
            month = str(row.get("date") or "")[:7]
            if not month:
                continue
            item = grouped.setdefault(month, {"month": month, "days": 0})
            item["days"] += 1
            for key in ("pv_kwh", "load_kwh", "grid_import_kwh", "grid_export_kwh", "battery_charge_kwh", "battery_discharge_kwh", "sold_kwh", "sold_value", "forecast_kwh", "actual_kwh"):
                item[key] = self.safe_float(item.get(key), 0) + self.safe_float(row.get(key), 0)
        for row in self.monthly_archive:
            month = str(row.get("month") or "")
            if month and month not in grouped:
                grouped[month] = dict(row)
        return [
            {key: round(value, 3) if isinstance(value, float) else value for key, value in row.items()}
            for _month, row in sorted(grouped.items(), reverse=True)
        ]

    def safe_float(self, value: Any, default: float = 0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def solcast_forecast_today_value(self) -> float:
        """Return today's Solcast forecast, tolerating renamed source entities."""
        configured = max(0, self.state_float(self.solcast_forecast_today_sensor, 0))
        if configured > 0:
            return configured

        for state in self.hass.states.async_all("sensor"):
            entity_id = state.entity_id.lower()
            friendly_name = str(state.attributes.get("friendly_name") or "").lower()
            searchable = f"{entity_id} {friendly_name}"
            if "solcast" not in searchable:
                continue
            if not any(token in searchable for token in ("prognoza_na_dzis", "prognoza na dziś", "forecast_today", "forecast today")):
                continue
            if any(token in searchable for token in ("pozostal", "remaining", "aktualna_moc", "current_power", "szczyt", "peak")):
                continue
            value = max(0, self.safe_float(state.state, 0))
            unit = str(state.attributes.get("unit_of_measurement") or "").lower()
            if value > 0 and unit in ("kwh", "wh"):
                return value / 1000 if unit == "wh" else value

        actual = max(0, self.state_float(self.daily_pv_production_sensor, 0))
        remaining = max(0, self.state_float(self.solcast_remaining_today_sensor, 0))
        if remaining > 0:
            return actual + remaining
        return 0

    def ensure_current_day_stats(self, day: str) -> None:
        if not self.sales_stats:
            self.sales_stats = self.empty_sales_stats()
        if self.sales_stats.get("current_day") == day:
            return

        previous_day = str(self.sales_stats.get("current_day") or "")
        if previous_day:
            kwh = sum(self.safe_float(values.get("kwh"), 0) for values in self.sales_stats.get("hourly", {}).values())
            value = sum(self.safe_float(values.get("value"), 0) for values in self.sales_stats.get("hourly", {}).values())
            daily = self.sales_stats.setdefault("daily", {})
            daily[previous_day] = {"kwh": round(kwh, 4), "value": round(value, 4)}
            for old_day in sorted(daily)[:-1825]:
                daily.pop(old_day, None)

        self.sales_stats["current_day"] = day
        self.sales_stats["hourly"] = self.empty_hourly_stats()
        self._stats_dirty = True

    def refresh_sales_totals(self) -> None:
        hourly = self.sales_stats.get("hourly", {}) if self.sales_stats else {}
        current_hour = f"{ha_now().hour:02d}"
        current = hourly.get(current_hour, {})
        self.sold_energy_today = round(sum(self.safe_float(values.get("kwh"), 0) for values in hourly.values()), 4)
        self.sold_value_today = round(sum(self.safe_float(values.get("value"), 0) for values in hourly.values()), 4)
        self.sold_energy_current_hour = round(self.safe_float(current.get("kwh"), 0), 4)
        self.sold_value_current_hour = round(self.safe_float(current.get("value"), 0), 4)

    def sales_hourly_today(self) -> list[dict[str, Any]]:
        hourly = self.sales_stats.get("hourly", {}) if self.sales_stats else {}
        data: list[dict[str, Any]] = []
        for hour in range(24):
            key = f"{hour:02d}"
            values = hourly.get(key, {})
            kwh = round(self.safe_float(values.get("kwh"), 0), 4)
            value = round(self.safe_float(values.get("value"), 0), 4)
            data.append(
                {
                    "hour": hour,
                    "label": f"{hour:02d}-{(hour + 1) % 24:02d}",
                    "kwh": kwh,
                    "value": value,
                    "avg_price": round(value / kwh, 4) if kwh > 0 else 0,
                }
            )
        return data

    def sales_daily_rows(self, days: int | None = None, month_only: bool = False) -> list[dict[str, Any]]:
        today = ha_now().date()
        daily = dict(self.sales_stats.get("daily", {}) if self.sales_stats else {})
        daily[today.isoformat()] = {"kwh": self.sold_energy_today, "value": self.sold_value_today}
        rows: list[dict[str, Any]] = []
        for day, values in sorted(daily.items()):
            try:
                date_obj = datetime.fromisoformat(day).date()
            except ValueError:
                continue
            if month_only and (date_obj.year != today.year or date_obj.month != today.month):
                continue
            rows.append(
                {
                    "date": day,
                    "label": date_obj.strftime("%d.%m"),
                    "kwh": round(self.safe_float(values.get("kwh"), 0), 4),
                    "value": round(self.safe_float(values.get("value"), 0), 4),
                }
            )
        if days is not None:
            rows = rows[-days:]
        return rows

    @property
    def sales_week_rows(self) -> list[dict[str, Any]]:
        return self.sales_daily_rows(days=7)

    @property
    def sales_month_rows(self) -> list[dict[str, Any]]:
        return self.sales_daily_rows(month_only=True)

    async def async_update_sold_energy_today(self) -> None:
        current = ha_now()
        current_day = current.date().isoformat()
        self.ensure_current_day_stats(current_day)
        self._energy_day = current_day
        if self._energy_last_update is None:
            self._energy_last_update = current
            self._stats_dirty = True
            self.refresh_sales_totals()
            await self.async_save_sales_stats()
            return
        delta_seconds = max((current - self._energy_last_update).total_seconds(), 0)
        delta_seconds = min(delta_seconds, 300)
        delta_hours = delta_seconds / 3600
        self._energy_last_update = current
        grid_power = self.normalized_grid_power()
        exported_power_w = max(0, -grid_power)
        if exported_power_w > 0 and delta_hours > 0:
            kwh = (exported_power_w / 1000) * delta_hours
            value = kwh * max(self.state_float(self.price_sensor, 0), 0)
            hour_key = f"{current.hour:02d}"
            hourly = self.sales_stats.setdefault("hourly", self.empty_hourly_stats())
            values = hourly.setdefault(hour_key, {"kwh": 0.0, "value": 0.0})
            values["kwh"] = round(self.safe_float(values.get("kwh"), 0) + kwh, 6)
            values["value"] = round(self.safe_float(values.get("value"), 0) + value, 6)
            self._stats_dirty = True
        self.refresh_sales_totals()
        await self.async_save_sales_stats()

    @property
    def active_min_sell_soc(self) -> float:
        if (
            self.control_mode == "Schedule"
            and self.active_slot.enabled
            and self.active_slot.mode == MODE_SELLING_FIRST
            and self.active_slot.minimum_sell_soc > 0
        ):
            return self.active_slot.minimum_sell_soc
        return self.min_sell_soc

    @property
    def active_min_sell_price(self) -> float:
        if self.control_mode == "Schedule" and self.active_slot.enabled and self.active_slot.min_sell_price > 0:
            return self.active_slot.min_sell_price
        return self.price_sell_threshold if self.price_guard_enabled else 0

    @property
    def soc_ok(self) -> bool:
        if not self.soc_guard_enabled or self.active_min_sell_soc <= 0:
            return True
        soc = self.state_float_or_none(self.battery_soc_sensor)
        return soc is not None and 0 <= soc <= 100 and soc >= self.active_min_sell_soc

    @property
    def price_ok(self) -> bool:
        if self.active_min_sell_price <= 0:
            return True
        price = self.state_float_or_none(self.price_sensor)
        return price is not None and price >= self.active_min_sell_price

    @property
    def sell_allowed(self) -> bool:
        return (
            not self.emergency_stop
            and self.data_available
            and self.soc_ok
            and self.price_ok
            and self.control_mode != "Protect Battery"
        )

    def _selling_slot_guard_issue(self) -> tuple[str, str] | None:
        """Classify a Selling First guard as a normal block or a data error.

        A valid SOC or price below the slot threshold is an expected runtime
        condition, not a failed Deye transaction.  An absent or malformed
        source remains an error because the manager cannot make a safe
        selling decision from it.
        """
        if not (
            self.control_mode == "Schedule"
            and self.active_slot.enabled
            and self.active_slot.mode == MODE_SELLING_FIRST
        ):
            return None

        if self.soc_guard_enabled and self.active_min_sell_soc > 0:
            soc = self.state_float_or_none(self.battery_soc_sensor)
            if soc is None or not 0 <= soc <= 100:
                return ("error", "Brak poprawnego odczytu SOC dla sprzedaży")
            if soc < self.active_min_sell_soc:
                return (
                    "blocked",
                    f"Sprzedaż wstrzymana: SOC {soc:.0f}% jest niższy od limitu "
                    f"{self.active_min_sell_soc:.0f}%",
                )

        if self.active_min_sell_price > 0:
            price = self.state_float_or_none(self.price_sensor)
            if price is None:
                return ("error", "Brak poprawnego odczytu ceny sprzedaży")
            if price < self.active_min_sell_price:
                return (
                    "blocked",
                    f"Sprzedaż wstrzymana: cena {price:.2f} PLN/kWh jest niższa od progu "
                    f"{self.active_min_sell_price:.2f} PLN/kWh",
                )
        return None

    def _selling_slot_is_blocked(self) -> bool:
        issue = self._selling_slot_guard_issue()
        return issue is not None and issue[0] == "blocked"

    def _sell_block_fingerprint(self, reason: str) -> str:
        """Identify one continuous, normal sale block without repeated writes."""
        return f"{self.active_slot_key()}:{reason.split(':', 1)[0]}"

    @property
    def charge_allowed(self) -> bool:
        """Compatibility status for manual charge controls.

        It never grants grid charging.  That permission belongs exclusively
        to the active Charge slot's explicit ``charge_enabled`` flag.
        """
        return not self.emergency_stop and self.data_available

    @property
    def active_charge_slot(self) -> bool:
        """Whether the current schedule slot uses its copied Charge settings."""
        return (
            self.control_mode == "Schedule"
            and self.active_slot.enabled
            and self.active_slot.mode == MODE_CHARGE
        )

    @property
    def target_mode(self) -> str:
        if self.control_mode == "Manual Sell":
            return MODE_SELLING_FIRST
        if self.control_mode in ("Stop Sell", "Protect Battery", "Charge Battery"):
            return MODE_ZERO_EXPORT
        if (
            self.control_mode == "Schedule"
            and self.active_slot.enabled
            and self.active_slot.mode == MODE_SELLING_FIRST
            and self._selling_slot_is_blocked()
        ):
            return self.default_work_mode
        if self.active_charge_slot:
            # Charge is a manager profile, not a fourth Deye work mode.  Keep
            # the user's selected default topology (e.g. Zero Export To CT).
            return self.default_work_mode
        return self.active_slot.mode if self.active_slot.enabled else self.default_work_mode

    @property
    def target_sell_power(self) -> float:
        if self.control_mode == "Manual Sell":
            return self.manual_sell_power
        if self.control_mode != "Schedule":
            return self.default_sell_power
        if self.active_slot.enabled and self.active_slot.mode == MODE_SELLING_FIRST and self._selling_slot_is_blocked():
            return self.default_sell_power
        if self.active_charge_slot:
            return self.default_sell_power
        return self.active_slot.sell_power if self.active_slot.enabled else self.default_sell_power

    @property
    def target_discharge_current(self) -> float:
        if self.control_mode == "Manual Sell":
            return self.manual_discharge_current
        if self.control_mode != "Schedule":
            return self.default_discharge_current
        if self.active_slot.enabled and self.active_slot.mode == MODE_SELLING_FIRST and self._selling_slot_is_blocked():
            return self.default_discharge_current
        if self.active_charge_slot:
            return self.active_slot.discharge_current
        return self.active_slot.discharge_current if self.active_slot.enabled else self.default_discharge_current

    @property
    def target_charge_current(self) -> float:
        if self.control_mode == "Charge Battery":
            return self.manual_charge_current
        if self.active_charge_slot:
            return self.active_slot.charge_current
        if (
            self.control_mode == "Schedule"
            and self.active_slot.enabled
            and self.active_slot.mode == MODE_SELLING_FIRST
            and self._selling_slot_is_blocked()
        ):
            return self.default_charge_current
        if self.control_mode == "Schedule" and self.active_slot.enabled:
            return (
                self.active_slot.charge_current
                if self.active_slot.charge_current > 0
                else self.default_charge_current
            )
        return self.default_charge_current

    @property
    def manager_status(self) -> str:
        if self.emergency_stop:
            return "EMERGENCY STOP"
        if not self.data_available:
            return "NO DATA"
        if self.mapping_error and self.control_mode == "Schedule":
            return "MAPPING ERROR"
        if self.control_mode == "Protect Battery":
            return "PROTECT BATTERY"
        if self.control_mode == "Manual Sell":
            return "MANUAL SELL"
        if self.control_mode == "Charge Battery":
            return "CHARGE BATTERY"
        if self.control_mode == "Stop Sell":
            return "STOPPED"
        if self.control_mode == "Schedule":
            if not self.scheduler_enabled:
                return "SCHEDULER OFF"
            if not self.active_slot.enabled:
                return "SLOT DISABLED"
            guard_issue = self._selling_slot_guard_issue()
            if guard_issue and guard_issue[0] == "blocked":
                return "SELL BLOCKED"
            if self.last_schedule_attempt.get("status") == "failed" and self.last_schedule_attempt.get("slot") == self.active_slot_key():
                return "SCHEDULE APPLY ERROR"
            if self.active_slot.mode == MODE_SELLING_FIRST and not self.soc_ok:
                return "SOC TOO LOW"
            if self.active_slot.mode == MODE_SELLING_FIRST and not self.price_ok:
                return "PRICE TOO LOW"
            if self.active_charge_slot:
                return "GRID CHARGE ACTIVE" if self.active_slot.charge_enabled else "PV CHARGE ACTIVE"
            if self.active_slot.mode == MODE_SELLING_FIRST:
                return "SELLING ACTIVE"
            if self.active_slot.mode == MODE_ZERO_EXPORT_CT:
                return "ZERO EXPORT CT ACTIVE"
            if self.active_slot.mode == MODE_ZERO_EXPORT:
                return "ZERO EXPORT LOAD ACTIVE"
            return "WAITING"
        return "WAITING"

    async def async_set_work_mode(self, mode: str) -> None:
        await self.hass.services.async_call(
            "select", "select_option", {"entity_id": self.work_mode_select, "option": mode}, blocking=True
        )

    async def async_set_number(self, entity_id: str | None, value: float) -> None:
        if entity_id:
            await self.hass.services.async_call("number", "set_value", {"entity_id": entity_id, "value": value}, blocking=True)

    async def async_set_number_if_needed(self, entity_id: str | None, value: float) -> bool:
        """Write a number only when Deye does not already report that value."""
        state = self.hass.states.get(entity_id) if entity_id else None
        current = None if state is None else self.safe_float(state.state, float("nan"))
        if current is not None and math.isfinite(current) and math.isclose(current, float(value), abs_tol=0.1):
            return False
        await self.async_set_number(entity_id, value)
        return True

    async def async_set_work_mode_if_needed(self, mode: str) -> bool:
        """Avoid re-sending an unchanged select option during a schedule tick."""
        state = self.hass.states.get(self.work_mode_select)
        if state is not None and str(state.state) == mode:
            return False
        await self.async_set_work_mode(mode)
        return True

    async def async_set_switch(self, entity_id: str | None, value: bool) -> None:
        if entity_id:
            await self.hass.services.async_call(
                "switch", "turn_on" if value else "turn_off", {"entity_id": entity_id}, blocking=True
            )

    async def async_set_switch_if_needed(self, entity_id: str | None, value: bool) -> bool:
        """Write a switch only if its current state differs from the target."""
        state = self.hass.states.get(entity_id) if entity_id else None
        if state is not None and state.state == ("on" if value else "off"):
            return False
        await self.async_set_switch(entity_id, value)
        return True

    async def async_set_time(self, entity_id: str | None, value: str) -> None:
        if entity_id:
            time_value = value if len(value) == 8 else f"{value}:00"
            await self.hass.services.async_call("time", "set_value", {"entity_id": entity_id, "time": time_value}, blocking=True)

    def _validate_number_entity(self, label: str, entity_id: str | None, value: float) -> None:
        """Validate a Number entity and its Home Assistant limits before write."""
        if not entity_id or not entity_id.startswith("number."):
            raise ValueError(f"Missing required Deye number entity: {label}")
        state = self.hass.states.get(entity_id)
        if state is None or state.state in ("unknown", "unavailable", "none", ""):
            raise ValueError(f"Unavailable Deye number entity: {label}")
        numeric = float(value)
        if not math.isfinite(numeric):
            raise ValueError(f"Invalid numeric value for {label}")
        attrs = getattr(state, "attributes", {}) or {}
        minimum = self.safe_float(attrs.get("min"), float("-inf"))
        maximum = self.safe_float(attrs.get("max"), float("inf"))
        step = self.safe_float(attrs.get("step"), 0)
        if numeric < minimum or numeric > maximum:
            raise ValueError(f"{label} must be between {minimum:g} and {maximum:g}")
        if step > 0 and math.isfinite(minimum):
            steps = (numeric - minimum) / step
            if not math.isclose(steps, round(steps), abs_tol=1e-6):
                raise ValueError(f"{label} must follow step {step:g}")

    def _validate_select_entity(self, label: str, entity_id: str | None, option: str) -> None:
        if not entity_id or not entity_id.startswith("select."):
            raise ValueError(f"Missing required Deye select entity: {label}")
        state = self.hass.states.get(entity_id)
        if state is None or state.state in ("unknown", "unavailable", "none", ""):
            raise ValueError(f"Unavailable Deye select entity: {label}")
        options = (getattr(state, "attributes", {}) or {}).get("options")
        if isinstance(options, (list, tuple)) and option not in options:
            raise ValueError(f"Unsupported option for {label}: {option}")

    def _validate_switch_entity(self, label: str, entity_id: str | None) -> None:
        if not entity_id or not entity_id.startswith("switch."):
            raise ValueError(f"Missing required Deye switch entity: {label}")
        state = self.hass.states.get(entity_id)
        if state is None or state.state not in ("on", "off"):
            raise ValueError(f"Unavailable Deye switch entity: {label}")

    def _validate_time_entity(self, label: str, entity_id: str | None, value: str) -> None:
        if not entity_id or not entity_id.startswith("time."):
            raise ValueError(f"Missing required Deye time entity: {label}")
        state = self.hass.states.get(entity_id)
        if state is None or state.state in ("unknown", "unavailable", "none", ""):
            raise ValueError(f"Unavailable Deye time entity: {label}")
        try:
            hour, minute = (int(part) for part in value.split(":")[:2])
        except (TypeError, ValueError):
            raise ValueError(f"Invalid time for {label}: {value}") from None
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            raise ValueError(f"Invalid time for {label}: {value}")

    def _validate_control_plan(
        self,
        mode: str,
        sell_power: float,
        discharge_current: float,
        charge_current: float,
        grid_charge_current: float,
    ) -> None:
        """Reject an invalid control plan before the first write to Deye."""
        if mode not in WORK_MODES:
            raise ValueError(f"Unsupported Deye work mode: {mode}")
        values = {
            "Max Sell Power": (sell_power, 0.0, 13000.0),
            "Maximum Battery Discharge Current": (discharge_current, 0.0, 240.0),
            "Maximum Battery Charge Current": (charge_current, 0.0, 240.0),
            "Maximum Battery Grid Charge Current": (grid_charge_current, 0.0, 240.0),
        }
        for label, (raw_value, minimum, maximum) in values.items():
            value = float(raw_value)
            if not math.isfinite(value) or not minimum <= value <= maximum:
                raise ValueError(f"{label} must be between {minimum:g} and {maximum:g}")
        self._validate_select_entity("System Work Mode", self.work_mode_select, mode)
        self._validate_number_entity("Max Sell Power", self.max_sell_power_number, sell_power)
        self._validate_number_entity(
            "Maximum Battery Discharge Current", self.discharge_current_number, discharge_current
        )
        self._validate_number_entity(
            "Maximum Battery Charge Current", self.charge_current_number, charge_current
        )
        self._validate_number_entity(
            "Maximum Battery Grid Charge Current", self.grid_charge_current_number, grid_charge_current
        )

    async def async_verify_control_values(
        self, mode: str | None, sell_power: float, discharge_current: float,
        charge_current: float, grid_charge_current: float,
    ) -> list[str]:
        """Read the current control state once, without writing it again.

        Some Deye integrations publish the requested values several seconds
        after the service call.  Re-sending a mode during that interval can
        undo a perfectly valid in-flight change, therefore delayed polling is
        handled by the pending transaction instead of this verifier.
        """
        expected_numbers = {
            self.max_sell_power_number: ("Max Sell Power", float(sell_power)),
            self.discharge_current_number: ("Maximum Battery Discharge Current", float(discharge_current)),
        }
        if self.charge_current_number:
            expected_numbers[self.charge_current_number] = ("Maximum Battery Charge Current", float(charge_current))
        if self.grid_charge_current_number:
            expected_numbers[self.grid_charge_current_number] = ("Maximum Battery Grid Charge Current", float(grid_charge_current))
        unconfirmed: list[str] = []
        if mode is not None:
            mode_state = self.hass.states.get(self.work_mode_select)
            if mode_state is None or str(mode_state.state) != mode:
                actual_mode = "brak" if mode_state is None else str(mode_state.state)
                unconfirmed.append(f"System Work Mode={actual_mode} (oczekiwano {mode})")
        for entity_id, (label, expected) in expected_numbers.items():
            state = self.hass.states.get(entity_id)
            actual = None if state is None else self.safe_float(state.state, float("nan"))
            if actual is None or not math.isfinite(actual) or not math.isclose(actual, expected, abs_tol=0.1):
                actual_label = "brak" if actual is None or not math.isfinite(actual) else f"{actual:g}"
                unconfirmed.append(f"{label}={actual_label} (oczekiwano {expected:g})")
        return unconfirmed

    def _pending_control_key(self) -> str:
        """Identify the user-visible target that owns an in-flight write."""
        return (
            f"{self.control_mode}:{self.active_slot_key()}"
            if self.control_mode == "Schedule"
            else self.control_mode
        )

    def _clear_pending_control_transaction(self) -> None:
        self._pending_control_transaction = {}
        if self.unsub_confirmation_timer:
            self.unsub_confirmation_timer()
            self.unsub_confirmation_timer = None
        if self.unsub_confirmation_listener:
            self.unsub_confirmation_listener()
            self.unsub_confirmation_listener = None
        if self.unsub_confirmation_poll:
            self.unsub_confirmation_poll()
            self.unsub_confirmation_poll = None

    def _control_confirmation_entities(self) -> list[str]:
        """Return every Deye entity whose state confirms a control write."""
        return [
            entity_id
            for entity_id in (
                self.work_mode_select,
                self.max_sell_power_number,
                self.discharge_current_number,
                self.charge_current_number,
                self.grid_charge_current_number,
            )
            if entity_id
        ]

    def _start_schedule_input_listener(self) -> None:
        """Re-evaluate a price/SOC guard promptly, without parallel writes."""
        if self.unsub_input_listener:
            return
        entities = [entity_id for entity_id in (self.battery_soc_sensor, self.price_sensor) if entity_id]
        if not entities:
            return

        @callback
        def _on_input_change(_event: Any) -> None:
            if not self.scheduler_enabled or self.control_mode != "Schedule" or self.unsub_input_debounce:
                return

            @callback
            def _on_debounce(_now: datetime) -> None:
                self.unsub_input_debounce = None
                self.hass.async_create_task(self.async_tick())

            self.unsub_input_debounce = async_track_point_in_time(
                self.hass, _on_debounce, ha_now() + timedelta(seconds=1)
            )

        self.unsub_input_listener = async_track_state_change_event(
            self.hass, entities, _on_input_change
        )

    def _schedule_pending_control_poll(self, delay: float | None = None) -> None:
        """Read pending writes quickly without ever sending them again."""
        if not self._pending_control_transaction or self.unsub_confirmation_poll:
            return
        if delay is None:
            # State changes are the preferred confirmation mechanism.  These
            # short read-only checks are a fallback for late Deye updates.
            poll_index = int(self._pending_control_transaction.get("poll_index", 0))
            delay = (0.5, 1.0, 2.0)[min(poll_index, 2)]
            self._pending_control_transaction["poll_index"] = poll_index + 1

        @callback
        def _on_poll(_now: datetime) -> None:
            self.unsub_confirmation_poll = None
            self.hass.async_create_task(self._async_recheck_pending_control())

        self.unsub_confirmation_poll = async_track_point_in_time(
            self.hass,
            _on_poll,
            ha_now() + timedelta(seconds=delay),
        )

    def _start_pending_control_watchers(self) -> None:
        """Confirm from Deye state events first, with a read-only poll fallback."""
        if not self.unsub_confirmation_listener:
            entities = self._control_confirmation_entities()

            @callback
            def _on_state_change(_event: Any) -> None:
                if self._pending_control_transaction:
                    self.hass.async_create_task(self._async_recheck_pending_control())

            self.unsub_confirmation_listener = async_track_state_change_event(
                self.hass, entities, _on_state_change
            )
        self._schedule_pending_control_poll()

    def _schedule_pending_control_timeout(self) -> None:
        """Finish delayed confirmation at the promised deadline, not next tick."""
        if self.unsub_confirmation_timer:
            self.unsub_confirmation_timer()
            self.unsub_confirmation_timer = None

        @callback
        def _on_timeout(_now: datetime) -> None:
            self.unsub_confirmation_timer = None
            self.hass.async_create_task(self._async_finish_pending_control_confirmation())

        self.unsub_confirmation_timer = async_track_point_in_time(
            self.hass,
            _on_timeout,
            ha_now() + timedelta(seconds=self.control_confirmation_timeout),
        )

    async def _async_finish_pending_control_confirmation(self) -> None:
        """Perform one final serialized read when the confirmation window ends."""
        await self._async_recheck_pending_control()

    async def _async_recheck_pending_control(self) -> None:
        """Recheck a pending write under the transaction lock without re-writing."""
        async with self._operation_lock:
            pending = self._pending_control_transaction
            if not pending:
                return
            await self._async_confirm_or_wait_for_control(
                dict(pending.get("expected") or {}),
                str(pending.get("stage") or "potwierdzenie falownika"),
            )
            if self._pending_control_transaction:
                self._schedule_pending_control_poll()

    async def _async_confirm_or_wait_for_control(
        self, expected: dict[str, Any], stage: str, *, started: bool = False
    ) -> bool | None:
        """Confirm an in-flight write, or leave it pending without re-writing.

        ``True`` means confirmed, ``False`` means the 12-second confirmation
        window expired and defaults were restored, and ``None`` means that the
        caller must perform the first write.
        """
        key = self._pending_control_key()
        pending = self._pending_control_transaction
        if not started:
            if not pending:
                return None
            if pending.get("key") != key or pending.get("expected") != expected:
                self._clear_pending_control_transaction()
                return None
        unconfirmed = await self.async_verify_control_values(
            expected.get("System Work Mode"),
            float(expected.get("Max Sell Power", 0)),
            float(expected.get("Prąd rozładowania", 0)),
            float(expected.get("Prąd ładowania baterii", 0)),
            float(expected.get("Prąd ładowania z sieci", 0)),
        )
        if not unconfirmed:
            self._clear_pending_control_transaction()
            self.record_schedule_attempt("applied", "potwierdzenie", expected, "Potwierdzono pełny zestaw ustawień slotu")
            self._clear_slot_failure_latch()
            self.last_action = f"Applied {self.control_mode}"
            self.last_error = ""
            self.mark_settings_applied()
            self.notify_update()
            return True

        now = ha_now().timestamp()
        if started:
            self._pending_control_transaction = {
                "key": key,
                "slot": self.active_slot_key(),
                "expected": dict(expected),
                "stage": stage,
                "started_at": now,
                "poll_index": 0,
            }
            pending = self._pending_control_transaction
            self._schedule_pending_control_timeout()
            self._start_pending_control_watchers()
        elapsed = max(0.0, now - float(pending.get("started_at", now)))
        remaining = max(0, math.ceil(self.control_confirmation_timeout - elapsed))
        if elapsed < self.control_confirmation_timeout:
            message = f"Oczekiwanie na potwierdzenie falownika ({remaining} s): {'; '.join(unconfirmed)}"
            self.record_schedule_attempt("pending", "potwierdzenie falownika", expected, message)
            self.last_action = "Oczekiwanie na potwierdzenie ustawień przez falownik"
            self.last_error = ""
            self.notify_update()
            return True

        self._clear_pending_control_transaction()
        reason = f"Niepotwierdzone ustawienia po {int(self.control_confirmation_timeout)} s: {'; '.join(unconfirmed)}"
        return await self._async_handle_slot_failure(reason, "potwierdzenie falownika", expected)

    async def async_apply_safe_defaults(self, reason: str) -> bool:
        """Apply user defaults as the single fail-safe path without forced zeroes."""
        mode = self.default_work_mode
        failures: list[str] = []
        try:
            self._validate_control_plan(
                mode,
                self.default_sell_power,
                self.default_discharge_current,
                self.default_charge_current,
                self.default_grid_charge_current,
            )
        except Exception as err:
            failures.append(str(err))

        operations = (
            ("Max Sell Power", self.async_set_number, (self.max_sell_power_number, self.default_sell_power)),
            (
                "Maximum Battery Discharge Current",
                self.async_set_number,
                (self.discharge_current_number, self.default_discharge_current),
            ),
            (
                "Maximum Battery Charge Current",
                self.async_set_number,
                (self.charge_current_number, self.default_charge_current),
            ),
            (
                "Maximum Battery Grid Charge Current",
                self.async_set_number,
                (self.grid_charge_current_number, self.default_grid_charge_current),
            ),
            ("System Work Mode", self.async_set_work_mode, (mode,)),
        )
        if not failures:
            for label, writer, args in operations:
                try:
                    await writer(*args)
                except Exception as err:
                    failures.append(f"{label}: {err}")

        if not failures:
            failures.extend(
                await self.async_verify_control_values(
                    mode,
                    self.default_sell_power,
                    self.default_discharge_current,
                    self.default_charge_current,
                    self.default_grid_charge_current,
                )
            )

        if failures:
            try:
                await self.async_set_work_mode(self.default_work_mode)
            except Exception as err:
                failures.append(f"System Work Mode: {err}")
            self.last_action = "Nie udało się w pełni zastosować ustawień domyślnych — sprawdź falownik."
            self.last_error = (
                f"KRYTYCZNY błąd częściowego zapisu ({reason}). "
                f"Niepotwierdzone wartości: {'; '.join(failures)}"
            )
            self.notify_update()
            return False

        self.last_action = f"{reason}. Zastosowano ustawienia domyślne."
        self.last_error = self.last_action
        self.notify_update()
        return True

    def _tou_entity(self, idx: int, kind: str) -> str:
        if kind == "start":
            return f"time.deye_inverter_time_of_use_{idx}_start"
        if kind == "soc":
            return f"number.deye_inverter_time_of_use_{idx}_soc"
        if kind == "grid":
            return f"switch.deye_inverter_time_of_use_{idx}_grid_charge"
        return ""

    @staticmethod
    def _time_to_minutes(value: Any) -> int | None:
        """Return minutes after midnight for an HA time state."""
        text = str(value or "").strip()
        try:
            hour, minute = (int(part) for part in text.split(":", 2)[:2])
        except (TypeError, ValueError):
            return None
        if not 0 <= hour <= 23 or not 0 <= minute <= 59:
            return None
        return hour * 60 + minute

    def physical_tou_soc_for_slot(self, slot_key: str) -> float | None:
        """Read the physical Deye TOU SOC covering an hourly schedule slot.

        This is used only to seed a missing new helper.  An existing restored
        slot value, including an intentional zero, always has priority.
        """
        slot_row = next((row for row in SLOTS if row[0] == slot_key), None)
        if slot_row is None:
            return None
        target = int(slot_row[2]) * 60
        starts = [
            self._time_to_minutes(self.state_text(self._tou_entity(idx, "start")))
            for idx in range(1, 7)
        ]
        if any(value is None for value in starts):
            return None
        for offset, start in enumerate(starts):
            end = starts[(offset + 1) % 6]
            if start == end:
                continue
            contains = start <= target < end if start < end else target >= start or target < end
            if not contains:
                continue
            value = self.safe_float(
                self.state_text(self._tou_entity(offset + 1, "soc")),
                float("nan"),
            )
            return value if math.isfinite(value) and 0 <= value <= 100 else None
        return None

    def tou_mapping_errors(self) -> list[str]:
        return [item["entity_id"] for item in self.tou_mapping_diagnostics()["entities"] if not item["ok"]]

    def _compress_schedule_segments(self) -> list[dict[str, Any]]:
        segments: list[dict[str, Any]] = []
        for _key, _label, start, end in SLOTS:
            slot = self.slots[_key]
            mode = slot.mode if slot.enabled else MODE_ZERO_EXPORT
            charge_slot = bool(slot.enabled and slot.mode == MODE_CHARGE)
            # The profile is copied into a slot when Charge is selected.  From
            # then on this slot is authoritative and may be edited independently.
            grid_charge = bool(charge_slot and slot.charge_enabled)
            grid_charge_current = float(
                slot.grid_charge_current
                if charge_slot
                else (
                    slot.grid_charge_current
                    if slot.grid_charge_current > 0
                    else self.default_grid_charge_current
                )
            )
            data = {
                "start": start,
                "end": end if end < 24 else 0,
                "mode": mode,
                "sell_power": float(slot.sell_power if slot.enabled and not charge_slot else 0),
                "discharge_current": float(slot.discharge_current if slot.enabled else 0),
                "charge_current": float(slot.charge_current if slot.enabled else 0),
                "grid_charge_current": grid_charge_current if charge_slot else 0,
                # This is the only SOC written to physical Deye TOU.  The
                # Selling First eligibility threshold is never used here.
                "tou_soc": slot.tou_soc,
                "grid_charge": grid_charge,
            }
            comparable = {"tou_soc": data["tou_soc"], "grid_charge": data["grid_charge"]}
            previous = (
                {"tou_soc": segments[-1]["tou_soc"], "grid_charge": segments[-1]["grid_charge"]}
                if segments
                else None
            )
            if segments and previous == comparable:
                segments[-1]["end"] = data["end"]
            else:
                segments.append(data)
        while len(segments) < 6:
            split_index = -1
            longest = 0
            for index, segment in enumerate(segments):
                segment_end = 24 if segment["end"] == 0 else int(segment["end"])
                duration = segment_end - int(segment["start"])
                if duration > longest and duration > 1:
                    longest = duration
                    split_index = index
            if split_index < 0:
                break
            segment = segments[split_index]
            segment_end = 24 if segment["end"] == 0 else int(segment["end"])
            middle = int(segment["start"]) + (segment_end - int(segment["start"])) // 2
            first = {**segment, "end": middle}
            second = {**segment, "start": middle}
            segments[split_index : split_index + 1] = [first, second]
        return segments

    def _tou_grid_state_matches(self, segments: list[dict[str, Any]]) -> bool:
        """Return whether physical TOU Grid Charge switches match the plan.

        The cached map signature avoids unnecessary writes, but it must never
        turn ``Grid: nie`` into merely a visual setting.  If an inverter or a
        user changed a physical Grid Charge switch after the previous write,
        the next tick writes the intended value again.
        """
        for idx in range(1, 7):
            item = segments[idx - 1] if idx <= len(segments) else None
            expected = "on" if item and item["grid_charge"] else "off"
            if self.state_text(self._tou_entity(idx, "grid")) != expected:
                return False
        return True

    async def async_apply_time_of_use_map(self) -> bool:
        self._last_tou_write_started = False
        segments = self._compress_schedule_segments()
        missing_soc = [
            self.slots[key].label
            for key, _label, _start, _end in SLOTS
            if self.slots[key].tou_soc is None
        ]
        if missing_soc:
            self.last_error = (
                "SOC baterii Deye (TOU) wymaga potwierdzenia dla slotów: "
                + ", ".join(missing_soc)
            )
            self.notify_update()
            return False
        if len(segments) > 6:
            self.last_action = f"Time Of Use map skipped: {len(segments)} segments"
            self.last_error = f"Mapowanie wymaga {len(segments)} zakresów; Deye obsługuje maksymalnie 6"
            self.notify_update()
            return False

        missing = self.tou_mapping_errors()
        if missing:
            self._last_tou_signature = ""
            self.last_error = "Brak wymaganych encji Deye Time Of Use: " + ", ".join(missing)
            self.notify_update()
            return False

        signature = "|".join(
            f"{item['start']}-{item['end']}:{item['grid_charge']}:{item['tou_soc']}"
            for item in segments
        )
        if signature == self._last_tou_signature and self._tou_grid_state_matches(segments):
            return True

        try:
            # Validate the whole physical map before its first write.  A
            # missing later TOU entity must not leave the earlier ranges
            # partially updated.
            self._validate_switch_entity(
                "Deye Time Of Use", "switch.deye_inverter_time_of_use"
            )
            for idx in range(1, 7):
                item = segments[idx - 1] if idx <= len(segments) else None
                if item is None:
                    self._validate_switch_entity(
                        f"TOU {idx} Grid Charge", self._tou_entity(idx, "grid")
                    )
                    continue
                start_value = f"{int(item['start']):02d}:00"
                self._validate_time_entity(f"TOU {idx} start", self._tou_entity(idx, "start"), start_value)
                self._validate_number_entity(f"TOU {idx} SOC", self._tou_entity(idx, "soc"), float(item["tou_soc"]))
                self._validate_switch_entity(f"TOU {idx} Grid Charge", self._tou_entity(idx, "grid"))
                if item["grid_charge"]:
                    self._validate_number_entity(
                        "Maximum Battery Grid Charge Current",
                        self.grid_charge_current_number,
                        item["grid_charge_current"],
                    )

            self._last_tou_write_started = True
            await self.async_set_switch("switch.deye_inverter_time_of_use", True)
            for idx in range(1, 7):
                item = segments[idx - 1] if idx <= len(segments) else None
                if item is None:
                    await self.async_set_switch(self._tou_entity(idx, "grid"), False)
                    continue
                start_value = f"{int(item['start']):02d}:00"
                await self.async_set_time(self._tou_entity(idx, "start"), start_value)
                await self.async_set_number(self._tou_entity(idx, "soc"), float(item["tou_soc"]))
                await self.async_set_switch(self._tou_entity(idx, "grid"), bool(item["grid_charge"]))
                if item["grid_charge"]:
                    await self.async_set_number(self.grid_charge_current_number, item["grid_charge_current"])
        except Exception as err:
            self._last_tou_signature = ""
            self.last_error = f"Błąd zapisu Deye Time Of Use: {err}"
            self.notify_update()
            return False
        self._last_tou_signature = signature
        return True

    async def async_apply_slot_grid_charge(self, slot_key: str) -> bool:
        """Apply the current schedule after a per-slot Grid Charge change."""
        if slot_key not in self.slots:
            raise ValueError(f"Unknown schedule slot: {slot_key}")
        slot = self.slots[slot_key]
        if slot.mode != MODE_CHARGE:
            slot.charge_enabled = False
        self._last_tou_signature = ""
        self._clear_slot_failure_latch()
        self.mark_config_saved()
        self.notify_update()
        return bool(await self.async_tick())

    async def async_apply_schedule_patch(self, updates: list[dict[str, Any]]) -> None:
        """Validate and apply a group of logical slot changes as one operation."""
        if not isinstance(updates, list) or not updates:
            raise ValueError("Schedule patch must contain at least one slot")

        numeric_limits = {
            "sell_power": (0.0, 13000.0),
            "discharge_current": (0.0, 240.0),
            "charge_current": (0.0, 240.0),
            "grid_charge_current": (0.0, 240.0),
            "minimum_sell_soc": (0.0, 100.0),
            "tou_soc": (0.0, 100.0),
            "min_sell_price": (0.0, 5.0),
        }
        allowed_fields = {"enabled", "mode", "charge_enabled", *numeric_limits}

        async with self._operation_lock:
            previous_slots = {key: replace(slot) for key, slot in self.slots.items()}
            previous_scheduler = self.scheduler_enabled
            self._clear_pending_control_transaction()
            try:
                for update in updates:
                    update = dict(update) if isinstance(update, dict) else update
                    if not isinstance(update, dict):
                        raise ValueError("Each schedule update must be an object")
                    slot_key = str(update.get("slot_key") or "")
                    if slot_key not in self.slots:
                        raise ValueError(f"Unknown schedule slot: {slot_key}")
                    if "min_soc" in update:
                        update.setdefault("minimum_sell_soc", update.pop("min_soc"))
                    unknown = set(update) - allowed_fields - {"slot_key"}
                    if unknown:
                        raise ValueError(f"Unsupported schedule fields: {', '.join(sorted(unknown))}")
                    slot = self.slots[slot_key]
                    if "enabled" in update:
                        slot.enabled = bool(update["enabled"])
                    previous_mode = slot.mode
                    if "mode" in update:
                        mode = str(update["mode"])
                        if mode not in SLOT_MODES:
                            raise ValueError(f"Unsupported slot mode: {mode}")
                        slot.mode = mode
                        if mode == MODE_CHARGE:
                            slot.enabled = True
                            if previous_mode != MODE_CHARGE:
                                slot.charge_current = self.charge_profile_charge_current
                                slot.discharge_current = self.charge_profile_discharge_current
                                slot.grid_charge_current = self.charge_profile_grid_charge_current
                                slot.tou_soc = self.charge_profile_target_soc
                                slot.charge_enabled = self.charge_profile_grid_enabled
                        elif previous_mode == MODE_CHARGE:
                            slot.charge_enabled = False
                    if "charge_enabled" in update:
                        slot.charge_enabled = bool(update["charge_enabled"]) if slot.mode == MODE_CHARGE else False
                    for field_name, (minimum, maximum) in numeric_limits.items():
                        if field_name not in update:
                            continue
                        value = float(update[field_name])
                        if not math.isfinite(value) or not minimum <= value <= maximum:
                            raise ValueError(
                                f"{field_name} for {slot_key} must be between {minimum:g} and {maximum:g}"
                            )
                        setattr(slot, field_name, value)

                if any(slot.enabled for slot in self.slots.values()):
                    self.scheduler_enabled = True
                self._last_slot_failure_signature = ""
                if self.mapping_error:
                    raise ValueError(
                        f"Mapowanie wymaga {len(self._compress_schedule_segments())} zakresów; "
                        "Deye obsługuje maksymalnie 6"
                    )
                applied = await self._async_tick_impl()
                if not applied:
                    raise RuntimeError(self.last_error or "Nie udało się zastosować harmonogramu")
                self.mark_config_saved()
            except Exception as err:
                self.slots = previous_slots
                self.scheduler_enabled = previous_scheduler
                # ``_async_tick_impl`` already restores the full defaults when
                # an active slot fails.  Do not repeat the same inverter
                # transaction from this outer patch handler.  A mapping
                # rejected during preflight has not touched Deye at all, so it
                # must only roll back the logical schedule.
                self.notify_update()
                raise

    async def async_apply_settings(
        self,
        mode: str,
        sell_power: float,
        discharge_current: float,
        charge_current: float,
    ) -> None:
        """Apply direct inverter settings using a safe, serialized write order."""
        async with self._operation_lock:
            if mode == MODE_SELLING_FIRST and not self.sell_allowed:
                await self.async_apply_safe_defaults("Sprzedaż zablokowana przez ochronę SOC lub ceny")
                raise ValueError(self.decision_reason)
            try:
                self._validate_control_plan(
                    mode,
                    sell_power,
                    discharge_current,
                    charge_current,
                    self.default_grid_charge_current,
                )
            except Exception as err:
                await self.async_apply_safe_defaults(f"Nieprawidłowy plan ustawień: {err}")
                raise
            try:
                await self.async_set_number(self.charge_current_number, charge_current)
                await self.async_set_number(
                    self.grid_charge_current_number,
                    self.default_grid_charge_current,
                )
                await self.async_set_number(self.max_sell_power_number, sell_power)
                await self.async_set_number(self.discharge_current_number, discharge_current)
                unconfirmed = await self.async_verify_control_values(
                    None,
                    sell_power,
                    discharge_current,
                    charge_current,
                    self.default_grid_charge_current,
                )
                if unconfirmed:
                    raise RuntimeError(f"Niepotwierdzone wartości: {'; '.join(unconfirmed)}")
                await self.async_set_work_mode(mode)
                unconfirmed = await self.async_verify_control_values(
                    mode,
                    sell_power,
                    discharge_current,
                    charge_current,
                    self.default_grid_charge_current,
                )
                if unconfirmed:
                    raise RuntimeError(f"Niepotwierdzone wartości końcowe: {'; '.join(unconfirmed)}")
            except Exception as err:
                await self.async_apply_safe_defaults(f"Błąd bezpośredniego zapisu ustawień: {err}")
                raise
            self.last_action = "Zastosowano ustawienia bezpośrednie"
            self.last_error = ""
            self.mark_settings_applied()
            self.notify_update()

    def _slot_failure_fingerprint(self, reason: str) -> str:
        """Return a stable signature of an active-slot fault.

        This prevents the minute timer from restoring the same defaults over
        and over.  It changes when the slot, schedule, relevant source state
        or TOU mapping availability changes.
        """
        slot = self.active_slot
        control_entities = [
            self.work_mode_select,
            self.max_sell_power_number,
            self.discharge_current_number,
            self.charge_current_number,
            self.grid_charge_current_number,
            *self.tou_mapping_errors(),
        ]
        # Control values are deliberately represented only by availability:
        # applying defaults changes their values and must not defeat the
        # failure latch on the next minute tick.
        availability = [
            f"{entity_id}:{self.entity_available(entity_id)}" for entity_id in control_entities if entity_id
        ]
        sensor_states = [
            f"{entity_id}:{self.state_text(entity_id)}"
            for entity_id in (
                self.battery_soc_sensor if slot.mode == MODE_SELLING_FIRST else None,
                self.price_sensor if slot.mode == MODE_SELLING_FIRST and slot.min_sell_price > 0 else None,
            )
            if entity_id
        ]
        slot_data = (
            slot.key, slot.enabled, slot.mode, slot.sell_power,
            slot.discharge_current, slot.charge_current,
            slot.grid_charge_current,
            slot.minimum_sell_soc, slot.tou_soc, slot.min_sell_price,
            slot.charge_enabled,
        )
        return repr((self.control_mode, slot_data, tuple(availability), tuple(sensor_states), self.mapping_error))

    def _clear_slot_failure_latch(self) -> None:
        self._last_slot_failure_signature = ""

    async def _async_handle_slot_failure(
        self, reason: str, stage: str, expected: dict[str, Any]
    ) -> bool:
        self._clear_pending_control_transaction()
        signature = self._slot_failure_fingerprint(stage)
        if signature == self._last_slot_failure_signature:
            message = f"{reason}. Ustawienia domyślne zostały już zastosowane dla tego samego błędu."
            self.record_schedule_attempt("failed", stage, expected, message)
            self.last_error = message
            self.notify_update()
            return False
        self._last_slot_failure_signature = signature
        self.record_schedule_attempt("failed", stage, expected, reason)
        await self.async_apply_safe_defaults(reason)
        return False

    def _report_tou_preflight_failure(self) -> bool:
        """Report an oversized TOU map without touching the inverter."""
        required = len(self._compress_schedule_segments())
        reason = (
            f"Błąd mapowania: wymagane {required} zakresów, "
            "Deye obsługuje maksymalnie 6"
        )
        self._clear_pending_control_transaction()
        self.record_schedule_attempt("failed", "mapowanie TOU", {}, reason)
        self.last_action = "Nie zastosowano mapowania Deye Time Of Use"
        self.last_error = reason
        self.notify_update()
        return False

    async def async_apply_targets(self) -> bool:
        if self.control_mode == "Schedule" and self.mapping_error:
            return self._report_tou_preflight_failure()
        if not self.data_available:
            return await self._async_handle_slot_failure(
                "Brak wymaganej encji sterującej Deye", "walidacja encji", {}
            )
        if (
            self.control_mode == "Schedule"
            and self.active_slot.enabled
            and self._last_slot_failure_signature
            and self._last_slot_failure_signature == self._slot_failure_fingerprint("")
        ):
            message = "Bieżący slot pozostaje zablokowany po poprzednim błędzie; ustawienia domyślne zostały już zastosowane."
            self.record_schedule_attempt("failed", "blokada po błędzie", {}, message)
            self.last_error = message
            self.notify_update()
            return False
        sell_requested = self.control_mode == "Manual Sell" or (
            self.control_mode == "Schedule"
            and self.active_slot.enabled
            and self.active_slot.mode == MODE_SELLING_FIRST
        )
        sell_block_reason = ""
        if sell_requested:
            guard_issue = self._selling_slot_guard_issue()
            if guard_issue and guard_issue[0] == "error":
                return await self._async_handle_slot_failure(
                    guard_issue[1], "warunki sprzedaży", {}
                )
            if guard_issue and guard_issue[0] == "blocked":
                sell_block_reason = guard_issue[1]
            elif not self.sell_allowed:
                reason = "Błąd ceny" if not self.price_ok else "Błąd lub brak odczytu SOC"
                return await self._async_handle_slot_failure(reason, "warunki sprzedaży", {})
        target_mode = self.target_mode
        target_sell_power = self.target_sell_power
        target_discharge_current = self.target_discharge_current
        target_charge_current = self.target_charge_current
        grid_charge_current = self.default_grid_charge_current
        if self.control_mode == "Schedule" and self.active_slot.enabled:
            # A positive limit does not grant grid charging. Only the active
            # Charge slot's explicit flag may enable the physical TOU switch.
            grid_charge_current = (
                self.active_slot.grid_charge_current
                if self.active_charge_slot
                else self.default_grid_charge_current
            )
        expected = {"System Work Mode": target_mode, "Max Sell Power": target_sell_power, "Prąd rozładowania": target_discharge_current, "Prąd ładowania baterii": target_charge_current, "Prąd ładowania z sieci": grid_charge_current}
        pending_result = await self._async_confirm_or_wait_for_control(expected, "potwierdzenie falownika")
        if pending_result is not None:
            return pending_result
        if sell_block_reason:
            block_signature = self._sell_block_fingerprint(sell_block_reason)
            if block_signature == self._last_sell_block_signature:
                unconfirmed = await self.async_verify_control_values(
                    expected["System Work Mode"],
                    float(expected["Max Sell Power"]),
                    float(expected["Prąd rozładowania"]),
                    float(expected["Prąd ładowania baterii"]),
                    float(expected["Prąd ładowania z sieci"]),
                )
                if not unconfirmed:
                    self.record_schedule_attempt(
                        "blocked", "warunki sprzedaży", expected, sell_block_reason
                    )
                    self.last_action = sell_block_reason
                    self.last_error = ""
                    self.notify_update()
                    return True
            self._last_sell_block_signature = block_signature
        else:
            self._last_sell_block_signature = ""
        stage = "walidacja planu"
        self.record_schedule_attempt("pending", stage, expected)
        try:
            self._validate_control_plan(target_mode, target_sell_power, target_discharge_current, target_charge_current, grid_charge_current)
            stage = "mapowanie Deye Time Of Use"
            if self.control_mode == "Schedule" and not await self.async_apply_time_of_use_map():
                raise RuntimeError(self.last_error or "Błąd zapisu mapowania TOU")
            stage = "wartości liczbowe"
            await self.async_set_number_if_needed(self.charge_current_number, target_charge_current)
            if self.control_mode == "Schedule" and self.active_charge_slot:
                await self.async_set_switch_if_needed("switch.deye_inverter_time_of_use", True)
            await self.async_set_number_if_needed(self.grid_charge_current_number, grid_charge_current)
            await self.async_set_number_if_needed(self.max_sell_power_number, target_sell_power)
            await self.async_set_number_if_needed(self.discharge_current_number, target_discharge_current)
            stage = "tryb pracy"
            await self.async_set_work_mode_if_needed(target_mode)
        except Exception as err:
            message = f"Nieudana transakcja sterująca ({stage}): {err}"
            if stage == "mapowanie Deye Time Of Use" and not self._last_tou_write_started:
                # The complete TOU map was rejected before the first physical
                # call.  Report it without starting a defaults transaction;
                # the inverter remains exactly as it was.
                self.record_schedule_attempt("failed", stage, expected, message)
                self.last_action = "Nie zastosowano mapowania Deye Time Of Use"
                self.last_error = message
                self.notify_update()
                return False
            if self.control_mode == "Schedule" and self.active_slot.enabled:
                return await self._async_handle_slot_failure(message, stage, expected)
            self.record_schedule_attempt("failed", stage, expected, message)
            await self.async_apply_safe_defaults(message)
            return False
        return bool(await self._async_confirm_or_wait_for_control(expected, stage, started=True))

    async def async_apply_default_values(self, reason: str = "Defaults applied") -> None:
        self._validate_control_plan(
            self.default_work_mode,
            self.default_sell_power,
            self.default_discharge_current,
            self.default_charge_current,
            self.default_grid_charge_current,
        )
        try:
            await self.async_set_number(self.max_sell_power_number, self.default_sell_power)
            await self.async_set_number(self.discharge_current_number, self.default_discharge_current)
            await self.async_set_number(self.charge_current_number, self.default_charge_current)
            await self.async_set_number(self.grid_charge_current_number, self.default_grid_charge_current)
            unconfirmed = await self.async_verify_control_values(
                None,
                self.default_sell_power,
                self.default_discharge_current,
                self.default_charge_current,
                self.default_grid_charge_current,
            )
            if unconfirmed:
                raise RuntimeError(f"Niepotwierdzone ustawienia domyślne: {'; '.join(unconfirmed)}")
            await self.async_set_work_mode(self.default_work_mode)
            unconfirmed = await self.async_verify_control_values(
                self.default_work_mode,
                self.default_sell_power,
                self.default_discharge_current,
                self.default_charge_current,
                self.default_grid_charge_current,
            )
            if unconfirmed:
                raise RuntimeError(f"Niepotwierdzone ustawienia końcowe: {'; '.join(unconfirmed)}")
        except Exception as err:
            await self.async_apply_safe_defaults(f"Błąd ręcznego przywracania ustawień: {err}")
            raise
        self.last_action = reason
        self.last_error = ""
        self.mark_settings_applied()
        self.notify_update()

    async def async_save_charge_profile(self, profile: dict[str, Any]) -> None:
        """Atomically save the user-owned profile used by Charge slots."""
        values = {
            "charge_profile_charge_current": self.safe_float(profile.get("charge_current"), float("nan")),
            "charge_profile_discharge_current": self.safe_float(profile.get("discharge_current"), float("nan")),
            "charge_profile_grid_charge_current": self.safe_float(profile.get("grid_charge_current"), float("nan")),
            "charge_profile_target_soc": self.safe_float(profile.get("target_soc"), float("nan")),
        }
        grid_enabled = profile.get("grid_charge_enabled")
        if not isinstance(grid_enabled, bool):
            raise ValueError("Grid Charge musi mieć wartość TAK albo NIE")
        profile_entities = {
            "charge_profile_charge_current": ("Maximum Battery Charge Current", self.charge_current_number),
            "charge_profile_discharge_current": ("Maximum Battery Discharge Current", self.discharge_current_number),
            "charge_profile_grid_charge_current": ("Maximum Battery Grid Charge Current", self.grid_charge_current_number),
            # Every Deye TOU SOC input has the same physical range. Validate
            # the profile before persisting it or starting a schedule write.
            "charge_profile_target_soc": ("Deye Time Of Use SOC", self._tou_entity(1, "soc")),
        }
        for key, value in values.items():
            self._validate_number_entity(*profile_entities[key], value)
        previous = {
            key: getattr(self, key)
            for key in values
        }
        previous_grid = self.charge_profile_grid_enabled
        previous_loaded = self._charge_profile_loaded_from_store
        previous_saved_at = self.last_saved_at
        for key, value in values.items():
            setattr(self, key, value)
        self.charge_profile_grid_enabled = grid_enabled
        self._charge_profile_loaded_from_store = True
        self.last_saved_at = ha_now().isoformat(timespec="seconds")
        try:
            # Await the durable write before reporting success to the card.
            # This avoids a close/reopen race with five independent helpers.
            await self.async_save_ai_data()
        except Exception:
            for key, value in previous.items():
                setattr(self, key, value)
            self.charge_profile_grid_enabled = previous_grid
            self._charge_profile_loaded_from_store = previous_loaded
            self.last_saved_at = previous_saved_at
            self.notify_update()
            raise
        self.last_error = ""
        self.last_action = "Zapisano szablon ustawień ładowania"
        self.notify_update()
        # This is a template for future transitions into Charge.  Existing
        # Charge slots, including manual overrides, are deliberately untouched.

    async def async_save_default_settings(self, values: dict[str, Any]) -> None:
        """Save the user-owned recovery profile without writing to Deye now."""
        mode = str(values.get("mode") or "")
        if mode not in WORK_MODES:
            raise ValueError("Domyślny tryb falownika jest nieprawidłowy")
        fields = {
            "default_sell_power": self.safe_float(values.get("sell_power"), float("nan")),
            "default_discharge_current": self.safe_float(values.get("discharge_current"), float("nan")),
            "default_charge_current": self.safe_float(values.get("charge_current"), float("nan")),
            "default_grid_charge_current": self.safe_float(values.get("grid_charge_current"), float("nan")),
        }
        default_entities = {
            "default_sell_power": ("Max Sell Power", self.max_sell_power_number),
            "default_discharge_current": ("Maximum Battery Discharge Current", self.discharge_current_number),
            "default_charge_current": ("Maximum Battery Charge Current", self.charge_current_number),
            "default_grid_charge_current": ("Maximum Battery Grid Charge Current", self.grid_charge_current_number),
        }
        self._validate_select_entity("System Work Mode", self.work_mode_select, mode)
        for key, value in fields.items():
            self._validate_number_entity(*default_entities[key], value)
        self.default_work_mode = mode
        for key, value in fields.items():
            setattr(self, key, value)
        self.mark_config_saved()
        self.last_error = ""
        self.last_action = "Zapisano ustawienia domyślne"
        self.notify_update()

    async def async_manual_sell(self) -> None:
        self.control_mode = "Manual Sell"
        await self.async_tick()

    async def async_charge_now(self) -> None:
        self.control_mode = "Charge Battery"
        await self.async_tick()

    async def async_stop_selling(self, reason: str = "Stopped") -> None:
        await self.async_apply_safe_defaults(reason)

    async def async_request_stop(self) -> None:
        async with self._operation_lock:
            self._clear_pending_control_transaction()
            self.control_mode = "Stop Sell"
            await self.async_apply_safe_defaults("Sprzedaż zatrzymana")

    async def async_restore_defaults(self) -> None:
        async with self._operation_lock:
            self._clear_pending_control_transaction()
            applied = await self.async_apply_safe_defaults(
                "Ręczne zastosowanie ustawień domyślnych"
            )
            if not applied:
                raise RuntimeError(
                    self.last_error
                    or "Nie udało się potwierdzić pełnego zestawu ustawień domyślnych"
                )
            self.emergency_stop = False
            self.control_mode = "Schedule"
            self.scheduler_enabled = False
            self._clear_slot_failure_latch()
            self.last_action = "Zastosowano ustawienia domyślne"
            self.last_error = ""
            self.mark_settings_applied()
            self.notify_update()

    async def async_resume_manager(self) -> None:
        """Consciously re-enable Schedule after Stop Sell or an emergency stop."""
        async with self._operation_lock:
            self._clear_pending_control_transaction()
            self.emergency_stop = False
            self.control_mode = "Schedule"
            self.scheduler_enabled = True
            self._clear_slot_failure_latch()
            applied = await self._async_tick_impl()
            if not applied:
                raise RuntimeError(self.last_error or "Nie udało się zastosować bieżącego slotu harmonogramu")
            self.last_action = "Włączono Manager i harmonogram"
            self.last_error = ""
            self.mark_config_saved()
            self.notify_update()

    async def async_emergency_stop(self) -> None:
        async with self._operation_lock:
            self._clear_pending_control_transaction()
            self.emergency_stop = True
            self.control_mode = "Stop Sell"
            await self.async_apply_safe_defaults("Zatrzymanie awaryjne")

    async def _async_tick_impl(self, *_args: Any) -> bool:
        previous_sold_energy = self.sold_energy_today
        previous_sold_value = self.sold_value_today
        await self.async_update_sold_energy_today()
        await self.async_update_solcast_history()
        await self.async_update_learning_history()
        await self.async_update_energy_sample()
        if not self.weather_last_updated or ha_now().minute == 0:
            await self.async_update_weather_forecast()
        if self.emergency_stop:
            return await self.async_apply_safe_defaults("Zatrzymanie awaryjne")
        elif self.control_mode == "Schedule" and self.mapping_error:
            return self._report_tou_preflight_failure()
        elif self.control_mode in ("Manual Sell", "Charge Battery"):
            return await self.async_apply_targets()
        elif self.control_mode in ("Stop Sell", "Protect Battery"):
            return await self.async_apply_safe_defaults(
                "Sprzedaż zatrzymana" if self.control_mode == "Stop Sell" else "Aktywna ochrona baterii"
            )
        elif self.scheduler_enabled:
            if self.active_slot.enabled:
                return await self.async_apply_targets()
            else:
                await self.async_apply_default_values("Defaults applied by inactive slot")
        if self.sold_energy_today != previous_sold_energy or self.sold_value_today != previous_sold_value:
            self.notify_update()
        return True

    async def async_tick(self, *_args: Any) -> None:
        if self._tariff_catalog_manager is not None and self._tariff_catalog_manager.refresh_due():
            await self._tariff_catalog_manager.async_refresh()
            self.notify_update()
        await self.async_process_future_plan()
        async with self._operation_lock:
            try:
                await self._async_tick_impl(*_args)
            except Exception as err:
                await self.async_apply_safe_defaults(f"Nieudana transakcja sterująca: {type(err).__name__}: {err}")
                raise

    async def async_start(self) -> None:
        self._tariff_catalog_manager = TariffCatalogManager(
            self.hass,
            self.entry_id,
            str(self.data.get(CONF_TARIFF_CATALOG_URL, DEFAULT_TARIFF_CATALOG_URL)),
        )
        await self._tariff_catalog_manager.async_load()
        await self.async_load_sales_stats()
        await self.async_load_ai_data()
        await self.async_load_solcast_history()
        await self.async_update_solcast_history()
        await self.async_load_learning_history()
        await self.async_update_learning_history()
        await self.async_load_energy_history()
        await self.async_update_energy_sample()
        await self.async_update_weather_forecast()
        self._start_schedule_input_listener()
        self.unsub_timer = async_track_time_interval(self.hass, self.async_tick, timedelta(minutes=1))
        if self._tariff_catalog_manager.refresh_due():
            self.hass.async_create_task(self.async_refresh_tariff_catalog())

    async def async_unload(self) -> None:
        self._clear_pending_control_transaction()
        if self.unsub_input_listener:
            self.unsub_input_listener()
            self.unsub_input_listener = None
        if self.unsub_input_debounce:
            self.unsub_input_debounce()
            self.unsub_input_debounce = None
        if self.unsub_timer:
            self.unsub_timer()
            self.unsub_timer = None
        await self.async_save_sales_stats()
        await self.async_save_ai_data()
        await self.async_save_solcast_history()
        await self.async_save_learning_history()
        await self.async_save_energy_history()

    def set_control_mode(self, mode: str) -> None:
        if mode in CONTROL_MODES:
            self.control_mode = mode
            self.notify_update()

    def set_work_mode_for_slot(self, slot_key: str, mode: str) -> None:
        if mode in SLOT_MODES:
            slot = self.slots[slot_key]
            previous_mode = slot.mode
            slot.mode = mode
            if mode == MODE_CHARGE:
                slot.enabled = True
                self.scheduler_enabled = True
                if previous_mode != MODE_CHARGE:
                    slot.charge_current = self.charge_profile_charge_current
                    slot.discharge_current = self.charge_profile_discharge_current
                    slot.grid_charge_current = self.charge_profile_grid_charge_current
                    slot.tou_soc = self.charge_profile_target_soc
                    slot.charge_enabled = self.charge_profile_grid_enabled
            elif previous_mode == MODE_CHARGE:
                slot.charge_enabled = False
            self._clear_slot_failure_latch()
            self.notify_update()

    def set_default_work_mode(self, mode: str) -> None:
        if mode in WORK_MODES:
            self.default_work_mode = mode
            self.notify_update()
