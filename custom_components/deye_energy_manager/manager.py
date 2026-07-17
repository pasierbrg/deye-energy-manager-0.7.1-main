from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store
from homeassistant.util.dt import now as ha_now

from .const import (
    CONF_BATTERY_SOC_SENSOR,
    CONF_BUY_PRICE_TODAY_SENSOR,
    CONF_BUY_PRICE_TOMORROW_SENSOR,
    CONF_CHARGE_CURRENT_NUMBER,
    CONF_DAILY_PV_PRODUCTION_SENSOR,
    CONF_GRID_CHARGE_CURRENT_NUMBER,
    CONF_GRID_POWER_SENSOR,
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
)


@dataclass
class SlotSettings:
    key: str
    label: str
    enabled: bool = False
    mode: str = MODE_ZERO_EXPORT
    sell_power: float = 0
    discharge_current: float = 0
    charge_enabled: bool = False
    charge_current: float = 0
    grid_charge_current: float = 0
    min_soc: float = 0
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
    charge_scheduler_enabled: bool = False
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
    sold_energy_today: float = 0
    sold_value_today: float = 0
    sold_energy_current_hour: float = 0
    sold_value_current_hour: float = 0
    _energy_last_update: datetime | None = None
    _energy_day: str = ""
    _stats_store: Store | None = None
    _ai_store: Store | None = None
    _solcast_store: Store | None = None
    _learning_store: Store | None = None
    _stats_dirty: bool = False
    sales_stats: dict[str, Any] = field(default_factory=dict)
    ai_settings: dict[str, Any] = field(default_factory=dict)
    ai_history: list[dict[str, Any]] = field(default_factory=list)
    solcast_history: list[dict[str, Any]] = field(default_factory=list)
    solcast_tracking: dict[str, Any] = field(default_factory=dict)
    learning_history: list[dict[str, Any]] = field(default_factory=list)
    learning_tracking: dict[str, Any] = field(default_factory=dict)
    slots: dict[str, SlotSettings] = field(default_factory=dict)
    last_action: str = "Idle"
    last_applied_at: str = ""
    last_saved_at: str = ""
    last_error: str = ""
    unsub_timer: Any = None
    entities: list[Any] = field(default_factory=list)
    _last_tou_signature: str = ""

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
        if not entity_id:
            return default
        state = self.hass.states.get(entity_id)
        if state is None:
            return default
        try:
            return float(state.state)
        except (TypeError, ValueError):
            return default

    def state_text(self, entity_id: str | None) -> str:
        if not entity_id:
            return "unknown"
        state = self.hass.states.get(entity_id)
        return state.state if state is not None else "unknown"

    @property
    def data_available(self) -> bool:
        required = (self.work_mode_select, self.max_sell_power_number, self.discharge_current_number)
        return all(
            entity_id
            and (state := self.hass.states.get(entity_id)) is not None
            and state.state not in ("unknown", "unavailable")
            for entity_id in required
        )

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
            "GRID CHARGE ACTIVE": "Aktywny slot ładowania z sieci",
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

    def diagnostics(self) -> dict[str, Any]:
        entity_ids = [
            self.work_mode_select,
            self.max_sell_power_number,
            self.discharge_current_number,
            self.charge_current_number,
            self.grid_charge_current_number,
            self.battery_soc_sensor,
            self.price_sensor,
            self.grid_power_sensor,
        ]
        entities = []
        for entity_id in entity_ids:
            state = self.hass.states.get(entity_id) if entity_id else None
            entities.append({
                "entity_id": entity_id or "not_configured",
                "state": state.state if state is not None else "missing",
                "ok": state is not None and state.state not in ("unknown", "unavailable"),
            })
        return {
            "integration_version": "0.7.5",
            "connected": self.data_available,
            "entities": entities,
            "last_saved_at": self.last_saved_at or "never",
            "last_applied_at": self.last_applied_at or "never",
            "last_error": self.last_error or "none",
            "manager_status": self.manager_status,
            "mapping_status": "ERROR" if self.mapping_error else "OK",
            "mapping_segments": len(self._compress_schedule_segments()),
            "active_slot": self.active_slot_key(),
            "next_active_slot": self.next_active_slot,
        }

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
        self.last_saved_at = str(data.get("last_saved_at") or "")

    async def async_save_ai_data(self) -> None:
        if self._ai_store is None:
            return
        await self._ai_store.async_save({"settings": self.ai_settings, "history": self.ai_history[:365], "last_saved_at": self.last_saved_at})

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

    async def async_clear_all_history(self) -> None:
        self.ai_history = []
        self.solcast_history = []
        self.solcast_tracking = {}
        self.learning_history = []
        self.learning_tracking = {}
        await self.async_save_ai_data()
        await self.async_save_solcast_history()
        await self.async_save_learning_history()
        self.notify_update()

    async def async_load_solcast_history(self) -> None:
        self._solcast_store = Store(self.hass, 1, f"{DOMAIN}_{self.entry_id}_solcast_history")
        raw = await self._solcast_store.async_load()
        data = raw if isinstance(raw, dict) else {}
        history = data.get("history")
        tracking = data.get("tracking")
        self.solcast_history = history[:90] if isinstance(history, list) else []
        self.solcast_tracking = tracking if isinstance(tracking, dict) else {}

    async def async_save_solcast_history(self) -> None:
        if self._solcast_store is None:
            return
        await self._solcast_store.async_save({"history": self.solcast_history[:90], "tracking": self.solcast_tracking})

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
            }, *[row for row in self.solcast_history if row.get("date") != tracked_day]][:90]
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
        self.learning_history = history[:2160] if isinstance(history, list) else []
        self.learning_tracking = tracking if isinstance(tracking, dict) else {}

    async def async_save_learning_history(self) -> None:
        if self._learning_store is None:
            return
        await self._learning_store.async_save({
            "history": self.learning_history[:2160],
            "tracking": self.learning_tracking,
        })

    def _new_learning_hour(self, hour_key: str, now: datetime) -> dict[str, Any]:
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
                ][:2160]
            self.learning_tracking = self._new_learning_hour(hour_key, now)

        tracking = self.learning_tracking
        try:
            previous = datetime.fromisoformat(str(tracking.get("last_sample")))
            elapsed_seconds = max(0.0, min(120.0, (now - previous).total_seconds()))
        except (TypeError, ValueError):
            elapsed_seconds = 0.0
        hours = elapsed_seconds / 3600.0

        pv_power = self.state_float("sensor.deye_inverter_pv_power", 0)
        load_power = self.state_float("sensor.deye_inverter_load_power", 0)
        grid_power = self.state_float(self.grid_power_sensor, 0)
        battery_power = self.state_float("sensor.deye_inverter_battery_power", 0)
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
        accuracy_rows = [self.safe_float(row.get("accuracy_percent"), 0) for row in self.solcast_history if row.get("accuracy_percent") is not None]
        correction_rows = [
            self.safe_float(row.get("actual_kwh"), 0) / self.safe_float(row.get("forecast_kwh"), 1)
            for row in self.solcast_history
            if self.safe_float(row.get("forecast_kwh"), 0) > 0
        ]
        return {
            "retention_days": 90,
            "recorded_days": len(dates),
            "recorded_hours": len(rows),
            "solcast_accuracy_avg": round(sum(accuracy_rows) / len(accuracy_rows), 1) if accuracy_rows else None,
            "solcast_correction_factor": round(sum(correction_rows) / len(correction_rows), 3) if correction_rows else None,
            "typical_daily_pv_kwh": round(sum(row["pv_kwh"] for row in per_hour), 2),
            "typical_daily_load_kwh": round(sum(row["load_kwh"] for row in per_hour), 2),
            "typical_daily_grid_export_kwh": round(sum(row["grid_export_kwh"] for row in per_hour), 2),
            "typical_daily_battery_charge_kwh": round(sum(row["battery_charge_kwh"] for row in per_hour), 2),
            "typical_daily_battery_discharge_kwh": round(sum(row["battery_discharge_kwh"] for row in per_hour), 2),
            "sources": {
                "pv_power": "sensor.deye_inverter_pv_power",
                "load_power": "sensor.deye_inverter_load_power",
                "grid_power": self.grid_power_sensor,
                "battery_power": "sensor.deye_inverter_battery_power",
                "battery_soc": self.battery_soc_sensor,
                "daily_pv": self.daily_pv_production_sensor,
                "solcast": self.solcast_forecast_today_sensor,
                "sell_price": self.price_sensor,
                "buy_price": self.buy_price_today_sensor,
            },
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
            error_percent = ((actual - forecast) / forecast * 100) if forecast > 0 else 0
            grouped.setdefault(tracking_day, {"date": tracking_day}).update({
                "forecast_kwh": forecast,
                "actual_kwh": actual,
                "accuracy_percent": max(0, 100 - abs(error_percent)) if forecast > 0 else 0,
            })
        return [
            {key: round(value, 3) if isinstance(value, float) else value for key, value in row.items()}
            for _day, row in sorted(grouped.items(), reverse=True)[:120]
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
        return [
            {key: round(value, 3) if isinstance(value, float) else value for key, value in row.items()}
            for _month, row in sorted(grouped.items(), reverse=True)[:24]
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
            for old_day in sorted(daily)[:-370]:
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
        grid_power = self.state_float(self.grid_power_sensor, 0)
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
        if self.control_mode == "Schedule" and self.active_slot.enabled and self.active_slot.min_soc > 0:
            return self.active_slot.min_soc
        return self.min_sell_soc

    @property
    def active_min_sell_price(self) -> float:
        if self.control_mode == "Schedule" and self.active_slot.enabled and self.active_slot.min_sell_price > 0:
            return self.active_slot.min_sell_price
        return self.price_sell_threshold

    @property
    def soc_ok(self) -> bool:
        return (not self.soc_guard_enabled) or self.state_float(self.battery_soc_sensor, 100) >= self.active_min_sell_soc

    @property
    def price_ok(self) -> bool:
        if self.active_min_sell_price <= 0:
            return True
        return self.state_float(self.price_sensor, 0) >= self.active_min_sell_price

    @property
    def sell_allowed(self) -> bool:
        return not self.emergency_stop and self.soc_ok and self.price_ok and self.control_mode != "Protect Battery"

    @property
    def charge_allowed(self) -> bool:
        return not self.emergency_stop and self.control_mode in ("Schedule", "Charge Battery")

    @property
    def target_mode(self) -> str:
        if self.control_mode == "Manual Sell":
            return MODE_SELLING_FIRST
        if self.control_mode in ("Stop Sell", "Protect Battery", "Charge Battery"):
            return MODE_ZERO_EXPORT
        if self.control_mode == "Schedule" and self.active_slot.enabled and not self.price_ok:
            return self.default_work_mode
        if self.control_mode == "Schedule" and self.active_slot.enabled and (
            self.active_slot.mode == MODE_CHARGE or self.active_slot.charge_enabled
        ):
            return MODE_ZERO_EXPORT
        return self.active_slot.mode if self.active_slot.enabled else self.default_work_mode

    @property
    def target_sell_power(self) -> float:
        if self.control_mode == "Manual Sell":
            return self.manual_sell_power
        if self.control_mode != "Schedule":
            return 0
        if self.active_slot.enabled and not self.price_ok:
            return self.default_sell_power
        if self.active_slot.enabled and (self.active_slot.mode == MODE_CHARGE or self.active_slot.charge_enabled):
            return 0
        return self.active_slot.sell_power if self.active_slot.enabled else self.default_sell_power

    @property
    def target_discharge_current(self) -> float:
        if self.control_mode == "Manual Sell":
            return self.manual_discharge_current
        if self.control_mode != "Schedule":
            return 0
        if self.active_slot.enabled and not self.price_ok:
            return self.default_discharge_current
        if self.active_slot.enabled and (self.active_slot.mode == MODE_CHARGE or self.active_slot.charge_enabled):
            return 0
        return self.active_slot.discharge_current if self.active_slot.enabled else self.default_discharge_current

    @property
    def target_charge_current(self) -> float:
        if self.control_mode == "Charge Battery":
            return self.manual_charge_current
        if self.control_mode == "Schedule" and self.active_slot.enabled and not self.price_ok:
            return self.default_charge_current
        if self.control_mode == "Schedule" and self.active_slot.enabled:
            return self.active_slot.charge_current
        if self.control_mode == "Schedule":
            return self.default_charge_current
        return 0

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
            if not self.soc_ok:
                return "SOC TOO LOW"
            if not self.price_ok:
                return "PRICE TOO LOW"
            if self.active_slot.mode == MODE_CHARGE or self.active_slot.charge_enabled:
                return "GRID CHARGE ACTIVE"
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

    async def async_set_switch(self, entity_id: str | None, value: bool) -> None:
        if entity_id:
            await self.hass.services.async_call(
                "switch", "turn_on" if value else "turn_off", {"entity_id": entity_id}, blocking=True
            )

    async def async_set_time(self, entity_id: str | None, value: str) -> None:
        if entity_id:
            time_value = value if len(value) == 8 else f"{value}:00"
            await self.hass.services.async_call("time", "set_value", {"entity_id": entity_id, "time": time_value}, blocking=True)

    def _tou_entity(self, idx: int, kind: str) -> str:
        if kind == "start":
            return f"time.deye_inverter_time_of_use_{idx}_start"
        if kind == "soc":
            return f"number.deye_inverter_time_of_use_{idx}_soc"
        if kind == "grid":
            return f"switch.deye_inverter_time_of_use_{idx}_grid_charge"
        return ""

    def _compress_schedule_segments(self) -> list[dict[str, Any]]:
        segments: list[dict[str, Any]] = []
        for _key, _label, start, end in SLOTS:
            slot = self.slots[_key]
            mode = slot.mode if slot.enabled else MODE_ZERO_EXPORT
            grid_charge = bool(
                slot.enabled
                and (slot.mode == MODE_CHARGE or slot.charge_enabled)
            )
            grid_charge_current = float(
                slot.grid_charge_current
                if slot.grid_charge_current > 0
                else self.default_grid_charge_current
            )
            data = {
                "start": start,
                "end": end if end < 24 else 0,
                "mode": mode,
                "sell_power": float(slot.sell_power if slot.enabled and not grid_charge else 0),
                "discharge_current": float(slot.discharge_current if slot.enabled and not grid_charge else 0),
                "charge_current": float(slot.charge_current if slot.enabled else 0),
                "grid_charge_current": grid_charge_current if slot.enabled else 0,
                "min_soc": float(slot.min_soc),
                "grid_charge": grid_charge,
            }
            comparable = {"min_soc": data["min_soc"], "grid_charge": data["grid_charge"]}
            previous = (
                {"min_soc": segments[-1]["min_soc"], "grid_charge": segments[-1]["grid_charge"]}
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

    async def async_apply_time_of_use_map(self) -> bool:
        segments = self._compress_schedule_segments()
        if len(segments) > 6:
            self.last_action = f"Time Of Use map skipped: {len(segments)} segments"
            self.last_error = f"Mapowanie wymaga {len(segments)} zakresów; Deye obsługuje maksymalnie 6"
            self.notify_update()
            return False

        signature = "|".join(
            f"{item['start']}-{item['end']}:{item['mode']}:{item['grid_charge']}:{item['min_soc']}:{item['charge_current']}:{item['grid_charge_current']}"
            for item in segments
        )
        if signature == self._last_tou_signature:
            return True

        try:
            await self.async_set_switch("switch.deye_inverter_time_of_use", True)
            for idx in range(1, 7):
                item = segments[idx - 1] if idx <= len(segments) else None
                if item is None:
                    await self.async_set_switch(self._tou_entity(idx, "grid"), False)
                    continue
                await self.async_set_time(self._tou_entity(idx, "start"), f"{int(item['start']):02d}:00")
                await self.async_set_number(self._tou_entity(idx, "soc"), max(item["min_soc"], 0))
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
        """Write one logical slot through the validated six-slot Deye mapping."""
        if slot_key not in self.slots:
            return False
        self._last_tou_signature = ""
        if not await self.async_apply_time_of_use_map():
            return False
        slot = self.slots[slot_key]
        if slot.enabled and (slot.mode == MODE_CHARGE or slot.charge_enabled):
            current = slot.grid_charge_current if slot.grid_charge_current > 0 else self.default_grid_charge_current
            await self.async_set_switch("switch.deye_inverter_time_of_use", True)
            await self.async_set_number(self.grid_charge_current_number, current)
            if slot_key == self.active_slot_key():
                await self.async_set_work_mode(MODE_ZERO_EXPORT)
                await self.async_set_number(self.charge_current_number, slot.charge_current)
                self.last_action = (
                    f"Ładowanie z sieci {slot.label}: {current:g} A, "
                    f"SOC {slot.min_soc:g}%"
                )
        self.last_error = ""
        self.mark_settings_applied()
        self.notify_update()
        return True

    async def async_apply_targets(self) -> None:
        sell_requested = self.control_mode == "Manual Sell" or (
            self.control_mode == "Schedule"
            and self.active_slot.enabled
            and self.active_slot.mode == MODE_SELLING_FIRST
            and not self.active_slot.charge_enabled
        )
        charge_requested = self.control_mode == "Charge Battery" or (
            self.control_mode == "Schedule"
            and self.active_slot.enabled
            and (
                self.active_slot.mode == MODE_CHARGE
                or self.active_slot.charge_enabled
                or self.active_slot.charge_current > 0
            )
        )
        if sell_requested and not self.sell_allowed:
            if not self.price_ok:
                await self.async_apply_default_values("Defaults applied by price guard")
                return
            await self.async_stop_selling("Blocked by guard")
            return
        if charge_requested and not self.charge_allowed:
            await self.async_stop_selling("Charge blocked")
            return
        await self.async_set_work_mode(self.target_mode)
        await self.async_set_number(self.max_sell_power_number, self.target_sell_power)
        await self.async_set_number(self.discharge_current_number, self.target_discharge_current)
        await self.async_set_number(self.charge_current_number, self.target_charge_current)
        if self.control_mode == "Schedule":
            await self.async_apply_time_of_use_map()
        if self.active_slot.enabled and (self.active_slot.mode == MODE_CHARGE or self.active_slot.charge_enabled):
            grid_charge_current = (
                self.active_slot.grid_charge_current
                if self.active_slot.grid_charge_current > 0
                else self.default_grid_charge_current
            )
            await self.async_set_switch("switch.deye_inverter_time_of_use", True)
            await self.async_set_number(self.grid_charge_current_number, grid_charge_current)
        self.last_action = f"Applied {self.control_mode}"
        self.mark_settings_applied()
        self.notify_update()

    async def async_apply_default_values(self, reason: str = "Defaults applied") -> None:
        await self.async_set_work_mode(self.default_work_mode)
        await self.async_set_number(self.max_sell_power_number, self.default_sell_power)
        await self.async_set_number(self.discharge_current_number, self.default_discharge_current)
        await self.async_set_number(self.charge_current_number, self.default_charge_current)
        await self.async_set_number(self.grid_charge_current_number, self.default_grid_charge_current)
        self.last_action = reason
        self.mark_settings_applied()
        self.notify_update()

    async def async_manual_sell(self) -> None:
        self.control_mode = "Manual Sell"
        await self.async_apply_targets()

    async def async_charge_now(self) -> None:
        self.control_mode = "Charge Battery"
        await self.async_apply_targets()

    async def async_stop_selling(self, reason: str = "Stopped") -> None:
        await self.async_set_work_mode(MODE_ZERO_EXPORT)
        await self.async_set_number(self.max_sell_power_number, 0)
        await self.async_set_number(self.discharge_current_number, 0)
        self.last_action = reason
        self.mark_settings_applied()
        self.notify_update()

    async def async_restore_defaults(self) -> None:
        self.emergency_stop = False
        self.control_mode = "Schedule"
        await self.async_apply_default_values("Defaults restored")
        self.scheduler_enabled = False
        self.charge_scheduler_enabled = False
        self.notify_update()

    async def async_emergency_stop(self) -> None:
        self.emergency_stop = True
        await self.async_stop_selling("Emergency stop")

    async def _async_tick_impl(self, *_args: Any) -> None:
        previous_sold_energy = self.sold_energy_today
        previous_sold_value = self.sold_value_today
        await self.async_update_sold_energy_today()
        await self.async_update_solcast_history()
        await self.async_update_learning_history()
        if self.emergency_stop:
            await self.async_stop_selling("Emergency stop")
        elif self.control_mode in ("Manual Sell", "Charge Battery"):
            await self.async_apply_targets()
        elif self.control_mode in ("Stop Sell", "Protect Battery"):
            await self.async_stop_selling(self.control_mode)
        elif self.scheduler_enabled:
            if self.active_slot.enabled:
                await self.async_apply_targets()
            else:
                await self.async_apply_default_values("Defaults applied by inactive slot")
        if self.sold_energy_today != previous_sold_energy or self.sold_value_today != previous_sold_value:
            self.notify_update()

    async def async_tick(self, *_args: Any) -> None:
        try:
            await self._async_tick_impl(*_args)
            self.last_error = ""
        except Exception as err:
            self.last_error = f"{type(err).__name__}: {err}"
            self.notify_update()
            raise

    async def async_start(self) -> None:
        await self.async_load_sales_stats()
        await self.async_load_ai_data()
        await self.async_load_solcast_history()
        await self.async_update_solcast_history()
        await self.async_load_learning_history()
        await self.async_update_learning_history()
        self.unsub_timer = async_track_time_interval(self.hass, self.async_tick, timedelta(minutes=1))

    async def async_unload(self) -> None:
        if self.unsub_timer:
            self.unsub_timer()
            self.unsub_timer = None
        await self.async_save_sales_stats()
        await self.async_save_ai_data()
        await self.async_save_solcast_history()
        await self.async_save_learning_history()

    def set_control_mode(self, mode: str) -> None:
        if mode in CONTROL_MODES:
            self.control_mode = mode
            self.notify_update()

    def set_work_mode_for_slot(self, slot_key: str, mode: str) -> None:
        if mode in SLOT_MODES:
            slot = self.slots[slot_key]
            slot.mode = mode
            if mode == MODE_CHARGE:
                slot.charge_enabled = True
                slot.enabled = True
                self.scheduler_enabled = True
                if slot.grid_charge_current <= 0 and self.default_grid_charge_current > 0:
                    slot.grid_charge_current = self.default_grid_charge_current
            self.notify_update()

    def set_default_work_mode(self, mode: str) -> None:
        if mode in WORK_MODES:
            self.default_work_mode = mode
            self.notify_update()
