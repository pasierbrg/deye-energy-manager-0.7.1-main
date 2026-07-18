DOMAIN = "deye_energy_manager"
PLATFORMS = ["switch", "select", "number", "sensor", "binary_sensor", "button"]

CONF_WORK_MODE_SELECT = "work_mode_select"
CONF_MAX_SELL_POWER_NUMBER = "max_sell_power_number"
CONF_DISCHARGE_CURRENT_NUMBER = "discharge_current_number"
CONF_CHARGE_CURRENT_NUMBER = "charge_current_number"
CONF_GRID_CHARGE_CURRENT_NUMBER = "grid_charge_current_number"
CONF_BATTERY_SOC_SENSOR = "battery_soc_sensor"
CONF_PRICE_SENSOR = "price_sensor"
CONF_SELL_PRICE_TOMORROW_SENSOR = "sell_price_tomorrow_sensor"
CONF_BUY_PRICE_TODAY_SENSOR = "buy_price_today_sensor"
CONF_BUY_PRICE_TOMORROW_SENSOR = "buy_price_tomorrow_sensor"
CONF_GRID_POWER_SENSOR = "grid_power_sensor"
CONF_PV_POWER_SENSOR = "pv_power_sensor"
CONF_LOAD_POWER_SENSOR = "load_power_sensor"
CONF_BATTERY_POWER_SENSOR = "battery_power_sensor"
CONF_SOLCAST_CURRENT_POWER_SENSOR = "solcast_current_power_sensor"
CONF_SOLCAST_FORECAST_TODAY_SENSOR = "solcast_forecast_today_sensor"
CONF_SOLCAST_FORECAST_TOMORROW_SENSOR = "solcast_forecast_tomorrow_sensor"
CONF_SOLCAST_FORECAST_DAY_3_SENSOR = "solcast_forecast_day_3_sensor"
CONF_SOLCAST_FORECAST_DAY_4_SENSOR = "solcast_forecast_day_4_sensor"
CONF_SOLCAST_FORECAST_DAY_5_SENSOR = "solcast_forecast_day_5_sensor"
CONF_SOLCAST_FORECAST_DAY_6_SENSOR = "solcast_forecast_day_6_sensor"
CONF_SOLCAST_FORECAST_DAY_7_SENSOR = "solcast_forecast_day_7_sensor"
CONF_SOLCAST_REMAINING_TODAY_SENSOR = "solcast_remaining_today_sensor"
CONF_SOLCAST_PEAK_POWER_TODAY_SENSOR = "solcast_peak_power_today_sensor"
CONF_SOLCAST_PEAK_TIME_TODAY_SENSOR = "solcast_peak_time_today_sensor"
CONF_DAILY_PV_PRODUCTION_SENSOR = "daily_pv_production_sensor"
CONF_WEATHER_ENTITY = "weather_entity"
CONF_PRICE_SOURCE = "price_source"
CONF_OSD_PROVIDER = "osd_provider"
CONF_TARIFF_PLAN = "tariff_plan"
CONF_DISTRIBUTION_PEAK_RATE = "distribution_peak_rate"
CONF_DISTRIBUTION_OFFPEAK_RATE = "distribution_offpeak_rate"
CONF_CUSTOM_OFFPEAK_WINDOWS = "custom_offpeak_windows"
CONF_TARIFF_MODE = "tariff_mode"
CONF_PRICE_INCLUDES_DISTRIBUTION = "price_includes_distribution"
CONF_TARIFF_CATALOG_URL = "tariff_catalog_url"
CONF_GRID_POSITIVE_IS_IMPORT = "grid_positive_is_import"
CONF_BATTERY_POSITIVE_IS_DISCHARGE = "battery_positive_is_discharge"
CONF_MAPPING_MODE = "mapping_mode"

DEFAULT_WORK_MODE_SELECT = "select.deye_inverter_system_work_mode"
DEFAULT_MAX_SELL_POWER = "number.deye_inverter_max_sell_power"
DEFAULT_DISCHARGE_CURRENT = "number.deye_inverter_maximum_battery_discharge_current"
DEFAULT_CHARGE_CURRENT = "number.deye_inverter_maximum_battery_charge_current"
DEFAULT_GRID_CHARGE_CURRENT = "number.deye_inverter_maximum_battery_grid_charge_current"
DEFAULT_BATTERY_SOC = "sensor.deye_inverter_battery"
DEFAULT_PRICE_SENSOR = "sensor.pstryk_aio_obecna_cena_sprzedazy_pradu"
DEFAULT_SELL_PRICE_TOMORROW_SENSOR = "sensor.pstryk_aio_cena_sprzedazy_pradu_jutro"
DEFAULT_BUY_PRICE_TODAY_SENSOR = "sensor.pstryk_aio_obecna_cena_zakupu_pradu"
DEFAULT_BUY_PRICE_TOMORROW_SENSOR = "sensor.pstryk_aio_cena_zakupu_pradu_jutro"
DEFAULT_GRID_POWER_SENSOR = "sensor.deye_inverter_grid_power"
DEFAULT_PV_POWER_SENSOR = "sensor.deye_inverter_pv_power"
DEFAULT_LOAD_POWER_SENSOR = "sensor.deye_inverter_load_power"
DEFAULT_BATTERY_POWER_SENSOR = "sensor.deye_inverter_battery_power"
DEFAULT_SOLCAST_CURRENT_POWER_SENSOR = "sensor.solcast_pv_forecast_aktualna_moc"
DEFAULT_SOLCAST_FORECAST_TODAY_SENSOR = "sensor.solcast_pv_forecast_prognoza_na_dzisiaj"
DEFAULT_SOLCAST_FORECAST_TOMORROW_SENSOR = "sensor.solcast_pv_forecast_prognoza_na_jutro"
DEFAULT_SOLCAST_FORECAST_DAY_3_SENSOR = "sensor.solcast_pv_forecast_prognoza_na_dzien_3"
DEFAULT_SOLCAST_FORECAST_DAY_4_SENSOR = "sensor.solcast_pv_forecast_prognoza_na_dzien_4"
DEFAULT_SOLCAST_FORECAST_DAY_5_SENSOR = "sensor.solcast_pv_forecast_prognoza_na_dzien_5"
DEFAULT_SOLCAST_FORECAST_DAY_6_SENSOR = "sensor.solcast_pv_forecast_prognoza_na_dzien_6"
DEFAULT_SOLCAST_FORECAST_DAY_7_SENSOR = "sensor.solcast_pv_forecast_prognoza_na_dzien_7"
DEFAULT_SOLCAST_REMAINING_TODAY_SENSOR = "sensor.solcast_pv_forecast_pozostala_prognoza_na_dzis"
DEFAULT_SOLCAST_PEAK_POWER_TODAY_SENSOR = "sensor.solcast_pv_forecast_szczytowa_moc_dzisiaj"
DEFAULT_SOLCAST_PEAK_TIME_TODAY_SENSOR = "sensor.solcast_pv_forecast_czas_szczytowej_mocy_dzisiaj"
DEFAULT_DAILY_PV_PRODUCTION_SENSOR = "sensor.deye_inverter_daily_pv_production"
DEFAULT_WEATHER_ENTITY = "weather.forecast_home_2"
DEFAULT_PRICE_SOURCE = "pstryk"
DEFAULT_OSD_PROVIDER = "pge"
DEFAULT_TARIFF_PLAN = "g11"
DEFAULT_DISTRIBUTION_PEAK_RATE = 0.0
DEFAULT_DISTRIBUTION_OFFPEAK_RATE = 0.0
DEFAULT_CUSTOM_OFFPEAK_WINDOWS = "13:00-15:00,22:00-06:00"
DEFAULT_TARIFF_MODE = "automatic"
DEFAULT_PRICE_INCLUDES_DISTRIBUTION = False
DEFAULT_TARIFF_CATALOG_URL = "https://raw.githubusercontent.com/pasierbrg/deye-energy-manager-0.7.1-main/main/custom_components/deye_energy_manager/tariff_catalog.json"
DEFAULT_GRID_POSITIVE_IS_IMPORT = True
DEFAULT_BATTERY_POSITIVE_IS_DISCHARGE = True
DEFAULT_MAPPING_MODE = "automatic"

PRICE_SOURCES = ["pstryk", "pse_rce", "other", "none"]
OSD_PROVIDERS = ["pge", "tauron", "enea", "energa", "stoen", "other"]
TARIFF_PLANS = ["g11", "g11f", "g11p", "g11pewna", "g12", "g12w", "g12e", "g12n", "g12r", "g12p", "g12as", "g12sezon", "g12eko", "g13", "g13s", "g13active", "g14dynamic", "custom"]

MODE_SELLING_FIRST = "Selling First"
MODE_ZERO_EXPORT = "Zero Export To Load"
MODE_ZERO_EXPORT_CT = "Zero Export To CT"
MODE_CHARGE = "Charge"

CONTROL_MODES = ["Schedule", "Manual Sell", "Stop Sell", "Protect Battery", "Charge Battery"]
WORK_MODES = [MODE_SELLING_FIRST, MODE_ZERO_EXPORT, MODE_ZERO_EXPORT_CT]
SLOT_MODES = [MODE_SELLING_FIRST, MODE_ZERO_EXPORT, MODE_ZERO_EXPORT_CT, MODE_CHARGE]

SLOTS = [
    ("00_01", "00:00-01:00", 0, 1),
    ("01_02", "01:00-02:00", 1, 2),
    ("02_03", "02:00-03:00", 2, 3),
    ("03_04", "03:00-04:00", 3, 4),
    ("04_05", "04:00-05:00", 4, 5),
    ("05_06", "05:00-06:00", 5, 6),
    ("06_07", "06:00-07:00", 6, 7),
    ("07_08", "07:00-08:00", 7, 8),
    ("08_09", "08:00-09:00", 8, 9),
    ("09_10", "09:00-10:00", 9, 10),
    ("10_11", "10:00-11:00", 10, 11),
    ("11_12", "11:00-12:00", 11, 12),
    ("12_13", "12:00-13:00", 12, 13),
    ("13_14", "13:00-14:00", 13, 14),
    ("14_15", "14:00-15:00", 14, 15),
    ("15_16", "15:00-16:00", 15, 16),
    ("16_17", "16:00-17:00", 16, 17),
    ("17_18", "17:00-18:00", 17, 18),
    ("18_19", "18:00-19:00", 18, 19),
    ("19_20", "19:00-20:00", 19, 20),
    ("20_21", "20:00-21:00", 20, 21),
    ("21_22", "21:00-22:00", 21, 22),
    ("22_23", "22:00-23:00", 22, 23),
    ("23_00", "23:00-00:00", 23, 24),
]
