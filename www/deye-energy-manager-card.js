class DeyeEnergyManagerCard extends HTMLElement {
  setConfig(config) {
    this.config = config || {};
    this._interacting = false;
    this._pendingRender = false;
    this._dialog = null;
    this._slotGridChargeOptimistic = {};
    this._scrollTops = {};
    this._pageScrollTops = [];
    this._interactionRelease = null;
    this._isRendered = false;
    this._optimisticStates = {};
    this._pendingSaves = 0;
    this._saveStatus = "idle";
    this._saveMessage = "";
    this._saveStatusTimer = null;
    this._saveHadError = false;
    this._selectionMode = false;
    this._selectedSlots = new Set();
    this._settingsTab = "defaults";
    this._historyFilters = { from: "", to: "", type: "all" };
    this._lastAiAnalysisCheck = 0;
    this._defaultsApplying = false;
    this._defaultsStatus = "";
    this._defaultsMessage = "";
    this._chargeProfileDraft = {};
    this._chargeProfileGridDraft = null;
    this._normalProfileDraft = {};
    this._defaultSettingsDraft = {};
    this._aiProposalSelection = null;
    this._aiChartHiddenSeries = new Set();
    this._aiChartPinned = null;
    this._aiView = "proposals";
    this._aiDay = "today";
    this._aiShow24 = false;
    this._aiWeatherMode = "daily";
  }

  connectedCallback() {
    if (!this._dialogCloseHandler) {
      this._dialogCloseHandler = (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const closeControl = target?.closest("[data-close-dialog]");
        if (!closeControl || !this.contains(closeControl)) return;
        if (closeControl.classList.contains("overlay") && target !== closeControl) return;
        event.preventDefault();
        event.stopPropagation();
        this.closeDialog();
      };
      this.addEventListener("click", this._dialogCloseHandler);
    }
    if (!this._dialogEscapeHandler) {
      this._dialogEscapeHandler = (event) => {
        if (event.key === "Escape" && this._dialog) this.closeDialog();
      };
      this.ownerDocument?.addEventListener("keydown", this._dialogEscapeHandler);
    }
    this.addEventListener("wheel", () => this.holdInteraction(900), { passive: true });
    this.addEventListener("touchstart", () => this.holdInteraction(1300), { passive: true });
    this.addEventListener("touchmove", () => this.holdInteraction(1300), { passive: true });
    this.addEventListener("focusin", () => {
      this._interacting = true;
    });
    this.addEventListener("focusout", () => {
      window.setTimeout(() => {
        this._interacting = false;
      }, 350);
    });
  }

  disconnectedCallback() {
    if (this._dialogEscapeHandler) {
      this.ownerDocument?.removeEventListener("keydown", this._dialogEscapeHandler);
      this._dialogEscapeHandler = null;
    }
  }

  closeDialog() {
    if (!this._dialog) return;
    this._dialog = null;
    this._interacting = false;
    this.render();
  }

  set hass(hass) {
    this._hass = hass;
    if (this._isRendered) {
      this.updateDynamicValues();
      return;
    }
    this.render(true);
  }

  getCardSize() {
    return 12;
  }

  isInteracting() {
    const active = this.ownerDocument?.activeElement;
    return this._interacting || (active && this.contains(active));
  }

  releaseInteraction(delay = 350) {
    window.clearTimeout(this._interactionRelease);
    this._interactionRelease = window.setTimeout(() => {
      this._interacting = false;
    }, delay);
  }

  holdInteraction(delay = 850) {
    this._interacting = true;
    this.releaseInteraction(delay);
  }

  captureScrollPositions() {
    this.querySelectorAll("[data-scroll-key]").forEach((el) => {
      this._scrollTops[el.dataset.scrollKey] = el.scrollTop;
    });
    this._pageScrollTops = this.pageScrollContainers().map((el) => ({
      el,
      top: el.scrollTop,
      left: el.scrollLeft,
    }));
  }

  pageScrollContainers() {
    const containers = [];
    const seen = new Set();
    const add = (el) => {
      if (!el || seen.has(el)) return;
      seen.add(el);
      const canScrollY = (el.scrollHeight || 0) - (el.clientHeight || 0) > 1;
      const canScrollX = (el.scrollWidth || 0) - (el.clientWidth || 0) > 1;
      if (canScrollY || canScrollX) containers.push(el);
    };

    add(document.scrollingElement);
    add(document.documentElement);
    add(document.body);

    let node = this;
    while (node) {
      if (node.nodeType === 1) add(node);
      if (node.assignedSlot) {
        node = node.assignedSlot;
      } else if (node.parentNode) {
        node = node.parentNode;
      } else {
        const root = node.getRootNode?.();
        node = root?.host || null;
      }
    }
    return containers;
  }

  restorePageScrollPositions() {
    const restore = () => {
      (this._pageScrollTops || []).forEach(({ el, top, left }) => {
        if (!el) return;
        try {
          el.scrollTop = top;
          el.scrollLeft = left;
        } catch (_err) {
          // Some Home Assistant containers are read-only during view transitions.
        }
      });
    };
    restore();
    requestAnimationFrame(restore);
    window.setTimeout(restore, 0);
  }

  restoreScrollPositions() {
    this.querySelectorAll("[data-scroll-key]").forEach((el) => {
      const key = el.dataset.scrollKey;
      if (this._scrollTops[key] !== undefined) el.scrollTop = this._scrollTops[key];
      this.attachScrollHandlers(el);
    });
    this.restorePageScrollPositions();
  }

  attachScrollHandlers(el) {
    if (!el || el._demScrollBound) return;
    el._demScrollBound = true;
    el.addEventListener("scroll", () => {
      this._scrollTops[el.dataset.scrollKey] = el.scrollTop;
      this.holdInteraction(900);
    }, { passive: true });
    el.addEventListener("wheel", () => this.holdInteraction(900), { passive: true });
    el.addEventListener("touchstart", () => this.holdInteraction(1200), { passive: true });
    el.addEventListener("touchmove", () => this.holdInteraction(1200), { passive: true });
    el.addEventListener("pointerenter", () => this.holdInteraction(900));
    el.addEventListener("pointerleave", () => this.releaseInteraction(350));
  }

  setText(selector, value) {
    const el = this.querySelector(selector);
    if (el) el.textContent = value;
  }

  setHtml(selector, value) {
    const el = this.querySelector(selector);
    if (el) el.innerHTML = value;
  }

  setClass(selector, baseClass, activeClass, isActive) {
    const el = this.querySelector(selector);
    if (!el) return;
    el.className = `${baseClass}${isActive ? ` ${activeClass}` : ""}`;
  }

  updateDynamicValues() {
    if (!this._hass || !this._isRendered) return;
    const slots = this.scheduleSlots();
    const statusEntity = this.entity("sensor", "manager_status");
    const activeSlotEntity = this.entity("sensor", "active_slot");
    const rawStatus = this.state(statusEntity);
    const [modeText, modeClass] = this.readMode(rawStatus);
    const activeSlot = this.state(activeSlotEntity);
    const activeSlotLabel = (slots.find(([key]) => key === activeSlot)?.[1] || activeSlot).replace(/:00/g, "");
    const batterySoc = this.entity("sensor", "battery_soc");
    const soldEnergyToday = this.entity("sensor", "sold_energy_today");
    const soldValueToday = this.entity("sensor", "sold_value_today");
    const sellPriceToday = this.entity("sensor", ["sell_price_today", "energy_price"]);
    const sellPriceTomorrow = this.entity("sensor", "sell_price_tomorrow");
    const buyPriceToday = this.entity("sensor", "buy_price_today");
    const buyPriceTomorrow = this.entity("sensor", "buy_price_tomorrow");
    const solcastPower = this.entity("sensor", "solcast_current_power");
    const solcastToday = this.entity("sensor", "solcast_forecast_today");
    const solcastTomorrow = this.entity("sensor", "solcast_forecast_tomorrow");
    const solcastDay3 = this.entity("sensor", "solcast_forecast_day_3");
    const solcastDay4 = this.entity("sensor", "solcast_forecast_day_4");
    const solcastDay5 = this.entity("sensor", "solcast_forecast_day_5");
    const solcastDay6 = this.entity("sensor", "solcast_forecast_day_6");
    const solcastDay7 = this.entity("sensor", "solcast_forecast_day_7");
    const solcastRemaining = this.entity("sensor", "solcast_remaining_today");
    const solcastPeakPower = this.entity("sensor", "solcast_peak_power_today");
    const solcastPeakTime = this.entity("sensor", "solcast_peak_time_today");
    const dailyPvProduction = this.entity("sensor", "daily_pv_production");
    const solcastAccuracy = this.entity("sensor", "solcast_accuracy");
    const minSellPrice = this.entity("number", "minimum_sell_price");
    const priceThreshold = this.asNumber(this.numberState(minSellPrice, 0)) || 0;
    const scheduler = this.entity("switch", "scheduler");
    const controlMode = this.entity("select", "control_mode");
    const lastAction = this.state(this.entity("sensor", "last_action"), "");
    const decisionText = this.state(this.entity("sensor", "decision_reason"));
    const statusUpper = String(rawStatus || "").toUpperCase();
    const lastActionUpper = String(lastAction || "").toUpperCase();
    const schedulerOn = this.state(scheduler) === "on";
    const defaultsActive = statusUpper.includes("DEFAULT") || statusUpper.includes("PRICE") || statusUpper.includes("SOC") || (!schedulerOn && lastActionUpper.includes("DEFAULT"));
    const sellActive = schedulerOn && statusUpper.includes("SCHEDULE") && !defaultsActive;
    const stopActive = statusUpper.includes("STOP") || this.state(controlMode) === "Stop Sell" || (!schedulerOn && (statusUpper.includes("IDLE") || lastActionUpper.includes("RESTORED") || lastActionUpper.includes("STOP")));
    const defaultButtonActive = defaultsActive && !stopActive;
    const analysisNow = Date.now();
    if (this.aiSettings().enabled && analysisNow - this._lastAiAnalysisCheck >= 900000) {
      this._lastAiAnalysisCheck = analysisNow;
      this.saveAiAnalysis(this.aiSuggestions(slots));
    }

    this.setText("[data-live='mode']", modeText);
    this.setClass("[data-live-card='mode']", "stat status-mode", modeClass, Boolean(modeClass));
    this.setText("[data-live='pv']", `${this.state("sensor.deye_inverter_pv_power")} W`);
    this.setText("[data-live='load']", `${this.state("sensor.deye_inverter_load_power")} W`);
    this.setText("[data-live='grid']", this.gridFlow(this.state("sensor.deye_inverter_grid_power")));
    this.setText("[data-live='battery-power']", this.batteryFlow(this.state("sensor.deye_inverter_battery_power")));
    this.setText("[data-live='soc']", `${this.state(batterySoc)} %`);
    this.setText("[data-live='sold-today']", `${this.state(soldEnergyToday)} kWh / ${this.state(soldValueToday)} PLN`);
    this.setText("[data-live='active-slot']", activeSlotLabel);
    this.setText("[data-live='inverter-mode']", this.state(this.entity("sensor", "current_work_mode")));
    this.setText("[data-live='target-inverter-mode']", this.state(this.entity("sensor", "target_mode")));
    this.setText("[data-live='decision-reason']", decisionText);
    this.setClass("[data-live-card='decision-reason']", "stat status-mode", modeClass, Boolean(modeClass));
    this.setText("[data-live='decision-strip-text']", decisionText);
    this.setText("[data-live='decision-strip-target']", this.state(this.entity("sensor", "target_mode")));
    const decisionStrip = this.querySelector("[data-decision-strip]");
    if (decisionStrip) decisionStrip.className = `decision-strip ${modeClass || "neutral"}`;

    this.querySelector("[data-action='sell']")?.classList.toggle("active", sellActive);
    this.querySelector("[data-action='stop']")?.classList.toggle("active", stopActive);
    this.querySelector("[data-action='defaults']")?.classList.toggle("active", defaultButtonActive);

    this.setText("[data-live='sell-now']", `${this.formatPrice(this.state(sellPriceToday))} PLN/kWh`);
    this.updatePriceTable("sell-prices", sellPriceToday, sellPriceTomorrow, priceThreshold, true);

    this.setText("[data-live='target-mode']", this.state(this.entity("sensor", "target_mode")));
    this.setText("[data-live='target-sell-power']", `${this.state(this.entity("sensor", "target_sell_power"))} W`);
    this.setText("[data-live='target-discharge']", `${this.state(this.entity("sensor", "target_discharge_current"))} A`);
    this.setText("[data-live='target-charge']", `${this.state(this.entity("sensor", "target_charge_current"))} A`);
    this.setText("[data-live='current-mode']", this.state(this.entity("sensor", "current_work_mode")));
    this.setText("[data-live='current-sell-power']", `${this.state(this.entity("sensor", "current_sell_power"))} W`);
    this.setText("[data-live='current-discharge']", `${this.state(this.entity("sensor", "current_discharge_current"))} A`);
    this.setText("[data-live='current-charge']", `${this.state(this.entity("sensor", "current_charge_current"))} A`);
    this.setText("[data-live='current-grid-charge']", `${this.state(this.entity("sensor", "current_grid_charge_current"))} A`);

    this.setText("[data-live='buy-now']", `${this.formatPrice(this.state(buyPriceToday))} PLN/kWh`);
    this.updatePriceTable("buy-prices", buyPriceToday, buyPriceTomorrow, 0, false);
    this.setText("[data-live='solcast-power']", this.formatPower(this.state(solcastPower)));
    this.setText("[data-live='solcast-today']", this.formatEnergy(this.state(solcastToday)));
    this.setText("[data-live='solcast-remaining']", this.formatEnergy(this.state(solcastRemaining)));
    this.setText("[data-live='solcast-tomorrow']", this.formatEnergy(this.state(solcastTomorrow)));
    this.setText("[data-live='solcast-peak-power']", this.formatPower(this.state(solcastPeakPower)));
    this.setText("[data-live='solcast-best-day']", this.bestSolcastDay([solcastToday, solcastTomorrow, solcastDay3, solcastDay4, solcastDay5, solcastDay6, solcastDay7]));
    const solcastForecastValue = this.asNumber(this.state(solcastToday));
    const dailyPvValue = this.asNumber(this.state(dailyPvProduction));
    const solcastDifference = solcastForecastValue !== null && dailyPvValue !== null ? dailyPvValue - solcastForecastValue : null;
    const solcastAccuracyValue = this.asNumber(this.state(solcastAccuracy));
    this.setText("[data-live='solcast-performance-forecast']", this.formatEnergy(solcastForecastValue));
    this.setText("[data-live='solcast-performance-actual']", this.formatEnergy(dailyPvValue));
    this.setText("[data-live='solcast-performance-difference']", this.formatSignedEnergy(solcastDifference));
    this.setText("[data-live='solcast-performance-accuracy']", solcastAccuracyValue === null ? "brak" : `${solcastAccuracyValue.toFixed(1)} %`);
    if (!this.isInteracting()) {
      this.setHtml("[data-live-html='solcast-days']", this.solcastDaysChart([solcastToday, solcastTomorrow, solcastDay3, solcastDay4, solcastDay5, solcastDay6, solcastDay7]));
      this.setHtml("[data-live-html='solcast-chart']", this.solcastChart(solcastToday, solcastTomorrow));
    }
    if (!this.isInteracting()) {
      const salesScrollTop = this.querySelector("[data-scroll-key='sales-month']")?.scrollTop;
      const salesHourlyTop = this.querySelector("[data-scroll-key='sales-hourly']")?.scrollTop;
      this.setHtml("[data-live-html='sales-stats']", this.salesStatsPanel());
      const salesScroll = this.querySelector("[data-scroll-key='sales-month']");
      const salesHourly = this.querySelector("[data-scroll-key='sales-hourly']");
      if (salesScrollTop !== undefined && salesScroll) salesScroll.scrollTop = salesScrollTop;
      if (salesHourlyTop !== undefined && salesHourly) salesHourly.scrollTop = salesHourlyTop;
      if (salesScroll) this.attachScrollHandlers(salesScroll);
      if (salesHourly) this.attachScrollHandlers(salesHourly);
    }
    this.updateToggleButtons();
  }

  updatePriceTable(scrollKey, todayEntity, tomorrowEntity, threshold = 0, highIsGood = true) {
    const today = this.readPriceMap(todayEntity);
    const tomorrow = this.readPriceMap(tomorrowEntity);
    const currentHour = new Date().getHours();
    for (let hour = 0; hour < 24; hour += 1) {
      this.setHtml(`[data-price='${scrollKey}:today:${hour}']`, this.priceCell(today.get(hour), threshold, highIsGood));
      this.setHtml(`[data-price='${scrollKey}:tomorrow:${hour}']`, this.priceCell(tomorrow.get(hour), threshold, highIsGood));
      this.querySelector(`[data-price-row='${scrollKey}:${hour}']`)?.classList.toggle("active", hour === currentHour);
    }
  }

  exists(entityId) {
    return Boolean(this._hass?.states?.[entityId]);
  }

  state(entityId, fallback = "brak") {
    return this._hass?.states?.[entityId]?.state ?? fallback;
  }

  displayState(entityId, fallback = "brak") {
    if (Object.prototype.hasOwnProperty.call(this._optimisticStates || {}, entityId)) {
      const actual = this.state(entityId, fallback);
      const optimistic = this._optimisticStates[entityId];
      const actualNumber = this.asNumber(actual);
      const optimisticNumber = this.asNumber(optimistic);
      const numericComparable = /\d/.test(String(actual)) && /\d/.test(String(optimistic));
      const valuesMatch = actual === optimistic
        || (numericComparable && actualNumber !== null && optimisticNumber !== null && actualNumber === optimisticNumber);
      if (valuesMatch) {
        delete this._optimisticStates[entityId];
      } else {
        return optimistic;
      }
    }
    return this.state(entityId, fallback);
  }

  numberState(entityId, fallback = "0") {
    const value = this.displayState(entityId, fallback);
    return value === "unknown" || value === "unavailable" ? fallback : value;
  }

  asNumber(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const parsed = Number(String(value).replace(",", ".").replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  formatPrice(value) {
    const number = this.asNumber(value);
    if (number === null) return "brak";
    return number.toFixed(2);
  }

  formatNumber(value, digits = 2) {
    const number = this.asNumber(value);
    return number === null ? "0" : number.toFixed(digits);
  }

  hourLabel(hour) {
    const start = String(hour).padStart(2, "0");
    const end = String((hour + 1) % 24).padStart(2, "0");
    return `${start}-${end}`;
  }

  hourFromValue(value, fallback = null) {
    if (typeof value === "number" && value >= 0 && value < 24) return Math.floor(value);
    const text = String(value ?? "");
    const isoMatch = text.match(/T(\d{1,2}):\d{2}/);
    if (isoMatch) return Number(isoMatch[1]);
    const hourMatch = text.match(/(^|\D)(\d{1,2})(?::\d{2})?/);
    if (hourMatch) {
      const hour = Number(hourMatch[2]);
      if (hour >= 0 && hour < 24) return hour;
    }
    return fallback;
  }

  priceFromObject(item) {
    if (!item || typeof item !== "object") return null;
    const keys = [
      "price", "value", "state", "amount", "total", "net_price", "gross_price",
      "energy_price", "unit_price", "price_with_tax", "pln_kwh", "pln_per_kwh",
      "sell_price", "buy_price", "sprzedaz", "zakup", "cena", "pln", "rce"
    ];
    for (const key of keys) {
      if (item[key] !== undefined) {
        const value = this.asNumber(item[key]);
        if (value !== null) return value;
      }
    }
    return null;
  }

  timeFromObject(item) {
    if (!item || typeof item !== "object") return null;
    const keys = [
      "hour", "start", "from", "time", "date", "datetime", "timestamp", "period", "label", "name",
      "start_time", "starts_at", "valid_from", "valid_from_date", "begin", "od"
    ];
    for (const key of keys) {
      if (item[key] !== undefined) return item[key];
    }
    return null;
  }

  addPriceCandidate(map, item, fallbackHour = null) {
    let hour = null;
    let price = null;
    if (Array.isArray(item)) {
      hour = this.hourFromValue(item[0], fallbackHour);
      price = this.asNumber(item[1]);
    } else if (item && typeof item === "object") {
      hour = this.hourFromValue(this.timeFromObject(item), fallbackHour);
      price = this.priceFromObject(item);
    } else {
      hour = fallbackHour;
      price = this.asNumber(item);
    }
    if (hour !== null && price !== null && price > 0 && !map.has(hour)) map.set(hour, price);
  }

  readPriceMap(entityId) {
    const entity = this._hass?.states?.[entityId];
    const map = new Map();
    if (!entity) return map;

    const parseSource = (source) => {
      if (!source) return;
      if (Array.isArray(source)) {
        source.forEach((item, index) => this.addPriceCandidate(map, item, index < 24 ? index : null));
        return;
      }
      if (typeof source === "object") {
        Object.entries(source).forEach(([key, value], index) => {
          if (value && typeof value === "object" && !Array.isArray(value)) {
            this.addPriceCandidate(map, { ...value, hour: value.hour ?? key }, index < 24 ? index : null);
          } else {
            this.addPriceCandidate(map, [key, value], index < 24 ? index : null);
          }
        });
      }
    };

    const attrs = entity.attributes || {};
    [
      attrs.prices, attrs.price, attrs.today, attrs.tomorrow, attrs.hourly, attrs.hours,
      attrs.data, attrs.values, attrs.items, attrs.entries, attrs.forecast,
      attrs.raw_today, attrs.raw_tomorrow, attrs.source, attrs.price_list, attrs.hourly_prices,
      attrs.prices_today, attrs.prices_tomorrow, attrs.today_prices, attrs.tomorrow_prices,
      attrs.sell_prices, attrs.buy_prices, attrs.ceny, attrs.ceny_godzinowe, attrs.energy_prices
    ].forEach(parseSource);

    if (map.size === 0) {
      Object.entries(attrs).forEach(([key, value], index) => {
        if (this.hourFromValue(key) !== null || Array.isArray(value) || (value && typeof value === "object")) {
          parseSource({ [key]: value });
        }
      });
    }

    if (map.size === 0) {
      const currentHour = new Date().getHours();
      const stateValue = this.asNumber(entity.state);
      if (stateValue !== null) map.set(currentHour, stateValue);
    }
    return map;
  }

  priceCell(value, threshold = 0, highIsGood = true) {
    const number = this.asNumber(value);
    if (number === null) return `<span class="price missing">brak</span>`;
    let cls = "";
    if (threshold > 0) cls = highIsGood ? (number >= threshold ? "good" : "warn") : (number <= threshold ? "good" : "warn");
    return `<span class="price ${cls}">${this.formatPrice(number)}</span>`;
  }

  priceTable(todayEntity, tomorrowEntity, threshold = 0, highIsGood = true, scrollKey = "prices") {
    const today = this.readPriceMap(todayEntity);
    const tomorrow = this.readPriceMap(tomorrowEntity);
    const currentHour = new Date().getHours();
    return `<div class="price-scroll" data-scroll-key="${scrollKey}"><table class="price-table">
      <thead><tr><th>Godz.</th><th>Dzisiaj</th><th>Jutro</th></tr></thead>
      <tbody>${Array.from({ length: 24 }, (_, hour) => `<tr class="${hour === currentHour ? "active" : ""}" data-price-row="${scrollKey}:${hour}">
        <td>${this.hourLabel(hour)}</td>
        <td data-price="${scrollKey}:today:${hour}">${this.priceCell(today.get(hour), threshold, highIsGood)}</td>
        <td data-price="${scrollKey}:tomorrow:${hour}">${this.priceCell(tomorrow.get(hour), threshold, highIsGood)}</td>
      </tr>`).join("")}</tbody>
    </table></div>`;
  }

  formatPower(value) {
    const number = this.asNumber(value);
    if (number === null) return "brak";
    if (Math.abs(number) >= 1000) return `${(number / 1000).toFixed(2)} kW`;
    return `${Math.round(number)} W`;
  }

  formatEnergy(value) {
    const number = this.asNumber(value);
    if (number === null) return "brak";
    return `${number.toFixed(2)} kWh`;
  }

  formatSignedEnergy(value) {
    const number = this.asNumber(value);
    if (number === null) return "brak";
    return `${number > 0 ? "+" : ""}${number.toFixed(2)} kWh`;
  }

  formatTimeShort(value) {
    const text = String(value ?? "");
    if (!text || text === "unknown" || text === "unavailable" || text === "brak") return "brak";
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    const match = text.match(/(\d{1,2}):(\d{2})/);
    return match ? `${match[1].padStart(2, "0")}:${match[2]}` : text;
  }

  forecastFromObject(item) {
    if (!item || typeof item !== "object") return null;
    const keys = ["pv_estimate", "estimate", "value", "energy", "kwh", "forecast", "state"];
    for (const key of keys) {
      if (item[key] !== undefined) {
        const value = this.asNumber(item[key]);
        if (value !== null) return value;
      }
    }
    return null;
  }

  forecastTimeFromObject(item) {
    if (!item || typeof item !== "object") return null;
    const keys = ["period_start", "start", "from", "time", "datetime", "timestamp", "hour"];
    for (const key of keys) {
      if (item[key] !== undefined) return item[key];
    }
    return null;
  }

  addForecastCandidate(map, item, fallbackHour = null, aggregate = false) {
    let hour = null;
    let value = null;
    if (Array.isArray(item)) {
      hour = this.hourFromValue(item[0], fallbackHour);
      value = this.asNumber(item[1]);
    } else if (item && typeof item === "object") {
      hour = this.hourFromValue(this.forecastTimeFromObject(item), fallbackHour);
      value = this.forecastFromObject(item);
    } else {
      hour = fallbackHour;
      value = this.asNumber(item);
    }
    if (hour === null || value === null || value < 0) return;
    map.set(hour, aggregate ? (map.get(hour) || 0) + value : (map.has(hour) ? map.get(hour) : value));
  }

  readForecastMap(entityId) {
    const entity = this._hass?.states?.[entityId];
    const map = new Map();
    if (!entity) return map;
    const attrs = entity.attributes || {};

    const parseSource = (source, aggregate = false) => {
      if (!source) return;
      if (Array.isArray(source)) {
        source.forEach((item, index) => this.addForecastCandidate(map, item, index < 24 ? index : null, aggregate));
        return;
      }
      if (typeof source === "object") {
        Object.entries(source).forEach(([key, value], index) => {
          const fallbackHour = index < 24 ? index : null;
          if (value && typeof value === "object" && !Array.isArray(value)) {
            this.addForecastCandidate(map, { ...value, hour: value.hour ?? key }, fallbackHour, aggregate);
          } else {
            this.addForecastCandidate(map, [key, value], fallbackHour, aggregate);
          }
        });
      }
    };

    [
      attrs.detailedHourly,
      attrs.detailed_hourly,
      attrs.hourly,
      attrs.hours,
      attrs.today,
      attrs.tomorrow,
    ].forEach((source) => parseSource(source, false));

    if (map.size === 0) {
      [attrs.detailedForecast, attrs.detailed_forecast, attrs.forecast, attrs.intervals].forEach((source) => parseSource(source, true));
    }
    return map;
  }

  solcastChart(todayEntity, tomorrowEntity) {
    const today = this.readForecastMap(todayEntity);
    const tomorrow = this.readForecastMap(tomorrowEntity);
    const values = [...today.values(), ...tomorrow.values()].map((value) => this.asNumber(value) || 0);
    const max = Math.max(0.001, ...values);
    const currentHour = new Date().getHours();
    const bars = Array.from({ length: 24 }, (_, hour) => {
      const todayValue = this.asNumber(today.get(hour)) || 0;
      const tomorrowValue = this.asNumber(tomorrow.get(hour)) || 0;
      const todayHeight = Math.max(3, Math.round((todayValue / max) * 100));
      const tomorrowHeight = Math.max(3, Math.round((tomorrowValue / max) * 100));
      return `<div class="solcast-bar ${hour === currentHour ? "now" : ""}" title="${this.hourLabel(hour)}: dzisiaj ${todayValue.toFixed(2)} kWh, jutro ${tomorrowValue.toFixed(2)} kWh">
        <div class="solcast-columns">
          <span class="today" style="height:${todayHeight}%"></span>
          <span class="tomorrow" style="height:${tomorrowHeight}%"></span>
        </div>
        <em>${String(hour).padStart(2, "0")}</em>
      </div>`;
    }).join("");
    return `<div class="solcast-chart"><div class="solcast-bars">${bars}</div></div>
      <div class="solcast-legend"><span class="today"></span>Dzisiaj <span class="tomorrow"></span>Jutro</div>`;
  }

  solcastDaysChart(entities) {
    const days = this.solcastDayData(entities);
    const max = Math.max(0.001, ...days.map((day) => day.value || 0));
    const bars = days.map((day) => {
      const number = day.value || 0;
      const height = Math.max(6, Math.round((number / max) * 100));
      const missing = day.value === null;
      return `<div class="solcast-day ${missing ? "missing" : ""}" title="${day.label}: ${missing ? "brak" : `${number.toFixed(2)} kWh`}">
        <div class="solcast-day-head"><strong>${day.label}</strong><em>${day.date}</em></div>
        <div class="solcast-day-meter"><span style="height:${height}%"></span></div>
        <b>${missing ? "-" : number.toFixed(1)} kWh</b>
      </div>`;
    }).join("");
    return `<div class="solcast-days">${bars}</div>`;
  }

  solcastDayData(entities) {
    const labels = ["Dzi\u015b", "Jutro", "za 2 dni", "za 3 dni", "za 4 dni", "za 5 dni", "za 6 dni"];
    return entities.map((entityId, index) => {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() + index);
      return {
        label: labels[index],
        date: date.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" }),
        value: this.asNumber(this.state(entityId)),
      };
    });
  }

  bestSolcastDay(entities) {
    const days = this.solcastDayData(entities).filter((day) => day.value !== null);
    if (!days.length) return "brak";
    const best = days.reduce((winner, day) => (day.value > winner.value ? day : winner), days[0]);
    return `${best.label} / ${best.value.toFixed(1)} kWh`;
  }

  salesAttributes() {
    return this._hass?.states?.[this.entity("sensor", "sold_energy_today")]?.attributes || {};
  }

  salesRows(key) {
    const attrs = this.salesAttributes();
    const rows = attrs[key];
    return Array.isArray(rows) ? rows : [];
  }

  formatKwh(value) {
    const number = this.asNumber(value);
    if (number === null) return "0.000";
    return number.toFixed(3);
  }

  formatMoney(value) {
    const number = this.asNumber(value);
    if (number === null) return "0.00";
    return number.toFixed(2);
  }

  salesStatsPanel() {
    const attrs = this.salesAttributes();
    const hourly = this.salesRows("hourly_today");
    const week = this.salesRows("week");
    const month = this.salesRows("month");
    const todayKwh = this.asNumber(this.state(this.entity("sensor", "sold_energy_today"), 0)) || 0;
    const todayValue = this.asNumber(attrs.sold_value_today) || this.asNumber(this.state(this.entity("sensor", "sold_value_today"), 0)) || 0;
    const hourKwh = this.asNumber(attrs.sold_energy_current_hour) || this.asNumber(this.state(this.entity("sensor", "sold_energy_current_hour"), 0)) || 0;
    const hourValue = this.asNumber(attrs.sold_value_current_hour) || this.asNumber(this.state(this.entity("sensor", "sold_value_current_hour"), 0)) || 0;
    const maxHour = Math.max(0.001, ...hourly.map((row) => this.asNumber(row.kwh) || 0));
    const weekKwh = this.asNumber(attrs.sold_energy_week) || week.reduce((sum, row) => sum + (this.asNumber(row.kwh) || 0), 0);
    const weekValue = this.asNumber(attrs.sold_value_week) || week.reduce((sum, row) => sum + (this.asNumber(row.value) || 0), 0);
    const monthKwh = this.asNumber(attrs.sold_energy_month) || month.reduce((sum, row) => sum + (this.asNumber(row.kwh) || 0), 0);
    const monthValue = this.asNumber(attrs.sold_value_month) || month.reduce((sum, row) => sum + (this.asNumber(row.value) || 0), 0);
    const currentHour = new Date().getHours();

    const bars = hourly.map((row) => {
      const hour = this.asNumber(row.hour) ?? 0;
      const kwh = this.asNumber(row.kwh) || 0;
      const value = this.asNumber(row.value) || 0;
      const height = Math.max(4, Math.round((kwh / maxHour) * 86));
      return `<div class="sales-bar ${hour === currentHour ? "now" : ""}" title="${row.label}: ${this.formatKwh(kwh)} kWh / ${this.formatMoney(value)} PLN">
        <span style="height:${height}%"></span><em>${String(hour).padStart(2, "0")}</em>
      </div>`;
    }).join("");

    const dailyRows = (rows, emptyText) => {
      if (!rows.length) return `<tr><td colspan="3">${emptyText}</td></tr>`;
      return rows.slice(-31).reverse().map((row) => `<tr>
        <td>${row.label || row.date || "-"}</td>
        <td>${this.formatKwh(row.kwh)} kWh</td>
        <td>${this.formatMoney(row.value)} PLN</td>
      </tr>`).join("");
    };
    const hourlyRows = hourly.map((row) => `<tr>
      <td>${row.label || this.hourLabel(row.hour || 0)}</td>
      <td>${this.formatKwh(row.kwh)} kWh</td>
      <td>${this.formatMoney(row.value)} PLN</td>
    </tr>`).join("");

    return `
      <div class="sales-summary">
        ${this.stat("Dzisiaj energia", `${this.formatKwh(todayKwh)} kWh`, "sales-energy", "", "sell")}
        ${this.stat("Dzisiaj warto\u015b\u0107", `${this.formatMoney(todayValue)} PLN`, "sales-value", "", "money")}
        ${this.stat("Ta godzina", `${this.formatKwh(hourKwh)} kWh / ${this.formatMoney(hourValue)} PLN`, "sales-hour", "", "clock")}
        ${this.stat("Tydzie\u0144", `${this.formatKwh(weekKwh)} kWh / ${this.formatMoney(weekValue)} PLN`, "sales-week", "", "chart")}
        ${this.stat("Miesi\u0105c", `${this.formatKwh(monthKwh)} kWh / ${this.formatMoney(monthValue)} PLN`, "sales-month", "", "calendar")}
      </div>
      <div class="sales-chart">${bars}</div>
      <div class="sales-tables">
        <div><div class="section-label">Dzisiaj godzina po godzinie</div><div class="sales-scroll" data-scroll-key="sales-hourly"><table class="mini-table"><tbody>${hourlyRows}</tbody></table></div></div>
        <div><div class="section-label">Ostatnie 7 dni</div><table class="mini-table"><tbody>${dailyRows(week, "Brak historii tygodnia")}</tbody></table></div>
        <div><div class="section-label">Bie\u017c\u0105cy miesi\u0105c</div><div class="sales-scroll" data-scroll-key="sales-month"><table class="mini-table"><tbody>${dailyRows(month, "Brak historii miesi\u0105ca")}</tbody></table></div></div>
      </div>`;
  }

  options(entityId, fallback = []) {
    return this._hass?.states?.[entityId]?.attributes?.options || fallback;
  }

  norm(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  exactEntity(domain, suffixes) {
    const list = Array.isArray(suffixes) ? suffixes : [suffixes];
    for (const suffix of list) {
      const direct = `${domain}.deye_energy_manager_${suffix}`;
      if (this.exists(direct)) return direct;
      const doubled = `${domain}.deye_energy_manager_deye_energy_manager_${suffix}`;
      if (this.exists(doubled)) return doubled;
    }
    return "";
  }

  entity(domain, suffixes) {
    const list = Array.isArray(suffixes) ? suffixes : [suffixes];
    const exact = this.exactEntity(domain, list);
    if (exact) return exact;

    const candidates = Object.keys(this._hass.states).filter((id) => id.startsWith(`${domain}.`));
    for (const suffix of list) {
      const normalized = this.norm(suffix);
      const found = candidates.find((id) => {
        const flatId = this.norm(id);
        const friendly = this.norm(this._hass.states[id]?.attributes?.friendly_name || "");
        return (flatId.includes("deyeenergymanager") && flatId.includes(normalized))
          || (friendly.includes("deyeenergymanager") && friendly.includes(normalized));
      });
      if (found) return found;
    }
    return `${domain}.deye_energy_manager_${list[0]}`;
  }

  findEntity(domain, wanted, excluded = [], fallbackSuffixes = []) {
    const fallbackList = Array.isArray(fallbackSuffixes) ? fallbackSuffixes : [fallbackSuffixes];
    const byId = this.exactEntity(domain, fallbackList);
    if (byId) return byId;
    const wantedParts = wanted.map((value) => this.norm(value)).filter(Boolean);
    const excludedParts = excluded.map((value) => this.norm(value)).filter(Boolean);
    const found = Object.entries(this._hass.states).find(([id, entity]) => {
      if (!id.startsWith(`${domain}.`)) return false;
      const friendly = this.norm(entity.attributes?.friendly_name || "");
      const flatId = this.norm(id);
      const haystack = `${flatId} ${friendly}`;
      return wantedParts.every((part) => haystack.includes(part))
        && !excludedParts.some((part) => haystack.includes(part));
    });
    return found?.[0] || `${domain}.deye_energy_manager_${fallbackList[0] || wantedParts.join("_")}`;
  }

  slotEntity(domain, key, label, suffixes, wanted, excluded = []) {
    const fallbackList = Array.isArray(suffixes) ? suffixes : [suffixes];
    const byId = this.exactEntity(domain, fallbackList);
    if (byId) return byId;

    const candidates = Object.entries(this._hass.states).filter(([id]) => id.startsWith(`${domain}.`));
    const excludedParts = excluded.map((value) => this.norm(value)).filter(Boolean);
    const keyToken = this.norm(`slot_${key}`);
    const labelToken = this.norm(label);
    const wantedParts = wanted.map((value) => this.norm(value)).filter(Boolean);

    const matches = ([id, entity], requireKeyToken = true) => {
      const flatId = this.norm(id);
      const friendly = this.norm(entity.attributes?.friendly_name || "");
      const haystack = `${flatId} ${friendly}`;
      const hasSlot = requireKeyToken
        ? flatId.includes(keyToken)
        : flatId.includes(keyToken) || friendly.includes(labelToken);
      return hasSlot
        && wantedParts.every((part) => haystack.includes(part))
        && !excludedParts.some((part) => haystack.includes(part));
    };

    return candidates.find((entry) => matches(entry, true))?.[0]
      || candidates.find((entry) => matches(entry, false))?.[0]
      || this.findEntity(domain, [keyToken, ...wantedParts], excluded, fallbackList);
  }

  slotEntities(key, label) {
    return {
      sellEnabled: this.slotEntity("switch", key, label, [`slot_${key}_enabled`, `${key}_enabled`, `slot_${key}`, key], [], ["charge"]),
      chargeEnabled: this.slotEntity("switch", key, label, [`slot_${key}_charge_enabled`, `${key}_charge_enabled`, `charge_${key}`], ["charge"]),
      mode: this.slotEntity("select", key, label, [`slot_${key}_mode`, `${key}_mode`], ["mode"]),
      sellPower: this.slotEntity("number", key, label, [`slot_${key}_sell_power`, `${key}_sell_power`], ["sell", "power"]),
      dischargeCurrent: this.slotEntity("number", key, label, [`slot_${key}_discharge_current`, `${key}_discharge_current`], ["discharge", "current"]),
      chargeCurrent: this.slotEntity("number", key, label, [`slot_${key}_charge_current`, `${key}_charge_current`], ["charge", "current"], ["discharge"]),
      gridChargeCurrent: this.slotEntity("number", key, label, [`slot_${key}_grid_charge_current`, `${key}_grid_charge_current`], ["grid", "charge", "current"]),
      minSoc: this.slotEntity("number", key, label, [`slot_${key}_min_soc`, `${key}_min_soc`], ["minimum", "soc"]),
      touSoc: this.slotEntity("number", key, label, [`slot_${key}_tou_soc`, `${key}_tou_soc`, `slot_${key}_min_soc`, `${key}_min_soc`], ["soc", "tou"]),
      minSellPrice: this.slotEntity("number", key, label, [`slot_${key}_min_sell_price`, `${key}_min_sell_price`], ["minimum", "sell", "price"]),
    };
  }

  slotGridChargeState(key, entities) {
    if (Object.prototype.hasOwnProperty.call(this._slotGridChargeOptimistic, key)) {
      return this._slotGridChargeOptimistic[key] ? "on" : "off";
    }
    if (this.exists(entities.chargeEnabled)) {
      return this.displayState(entities.chargeEnabled, "off") === "on" ? "on" : "off";
    }
    const status = this.entity("sensor", "manager_status");
    const data = this._hass.states[status]?.attributes?.slot_grid_charge?.[key];
    return data?.enabled ? "on" : "off";
  }

  slotGridChargePill(key, entities) {
    const state = this.slotGridChargeState(key, entities);
    return `<button type="button" class="pill ${state}" data-slot-grid-charge="${key}" data-grid-entity="${entities.chargeEnabled}">${state === "on" ? "tak" : "nie"}</button>`;
  }

  async setSlotGridCharge(key, entities, enabled, gridChargeCurrent = null, minSoc = null, refresh = true) {
    this._slotGridChargeOptimistic[key] = Boolean(enabled);
    if (refresh) this.render();
    try {
      const data = { slot_key: key, enabled: Boolean(enabled) };
      if (gridChargeCurrent !== null) data.grid_charge_current = Number(gridChargeCurrent);
      if (minSoc !== null) data.min_soc = Number(minSoc);
      if (this.hasService("deye_energy_manager", "set_slot_grid_charge")) {
        await this.callService("deye_energy_manager", "set_slot_grid_charge", data);
      } else {
        // Starsza instancja backendu może jeszcze nie udostępniać tej usługi.
        // Zapisz helpery i fizyczne sloty Deye bezpośrednio standardowymi usługami HA.
        if (gridChargeCurrent !== null && this.exists(entities.gridChargeCurrent)) {
          await this.setNumber(entities.gridChargeCurrent, Number(gridChargeCurrent));
        }
        if (minSoc !== null && this.exists(entities.minSoc)) {
          await this.setNumber(entities.minSoc, Number(minSoc));
        }
        if (this.exists(entities.chargeEnabled)) {
          await this.turnSwitch(entities.chargeEnabled, enabled);
        }
        await this.applyDeyeTimeOfUseMap();
      }
      window.setTimeout(() => {
        delete this._slotGridChargeOptimistic[key];
        if (refresh) this.render();
      }, 2500);
      return true;
    } catch (error) {
      delete this._slotGridChargeOptimistic[key];
      this.failSave(entities.chargeEnabled || `slot:${key}:grid_charge`, error);
      if (refresh) this.render();
      return false;
    }
  }

  touEntities(idx) {
    const nextIdx = idx === 6 ? 1 : idx + 1;
    return {
      start: `time.deye_inverter_time_of_use_${idx}_start`,
      end: `time.deye_inverter_time_of_use_${nextIdx}_start`,
      soc: `number.deye_inverter_time_of_use_${idx}_soc`,
      grid: `switch.deye_inverter_time_of_use_${idx}_grid_charge`,
      gridCurrent: "number.deye_inverter_maximum_battery_grid_charge_current",
    };
  }

  async applyDeyeTimeOfUseMap() {
    const segments = this.scheduleSegments(this.scheduleSlots());
    if (segments.length > 6) {
      throw new Error(`Mapowanie wymaga ${segments.length} zakresów, a Deye obsługuje maksymalnie 6.`);
    }
    await this.turnSwitch("switch.deye_inverter_time_of_use", true);
    for (let idx = 1; idx <= 6; idx += 1) {
      const item = segments[idx - 1];
      const tou = this.touEntities(idx);
      if (!item) {
        if (this.exists(tou.grid)) await this.turnSwitch(tou.grid, false);
        continue;
      }
      if (this.exists(tou.start)) {
        await this.setTime(tou.start, `${String(item.start).padStart(2, "0")}:00`);
      }
      if (this.exists(tou.soc)) await this.setNumber(tou.soc, item.minSoc);
      if (this.exists(tou.grid)) await this.turnSwitch(tou.grid, Boolean(item.chargeEnabled));
    }
    const activeKey = this.state(this.entity("sensor", "active_slot"));
    const active = this.scheduleSlots().find(([key]) => key === activeKey);
    if (active) {
      const activeEntities = this.slotEntities(active[0], active[1]);
      if (this.slotGridChargeState(active[0], activeEntities) === "on") {
        const current = this.numberState(activeEntities.gridChargeCurrent, 0);
        if (this.exists("number.deye_inverter_maximum_battery_grid_charge_current")) {
          await this.setNumber("number.deye_inverter_maximum_battery_grid_charge_current", current);
        }
        if (this.exists("number.deye_inverter_maximum_battery_charge_current")) {
          await this.setNumber(
            "number.deye_inverter_maximum_battery_charge_current",
            this.numberState(activeEntities.chargeCurrent, 0),
          );
        }
      }
    }
  }

  callService(domain, service, data = {}) {
    return this._hass.callService(domain, service, data);
  }

  hasService(domain, service) {
    return Boolean(this._hass?.services?.[domain]?.[service]);
  }

  updateSaveIndicator() {
    const el = this.querySelector("[data-save-indicator]");
    if (!el) return;
    el.className = `save-indicator ${this._saveStatus}`;
    el.textContent = this._saveStatus === "saving"
      ? "Zapisywanie..."
      : this._saveStatus === "saved"
        ? "Zapisano"
        : this._saveStatus === "error"
          ? this._saveMessage || "Błąd zapisu"
          : "";
  }

  beginSave() {
    window.clearTimeout(this._saveStatusTimer);
    if (this._pendingSaves === 0) this._saveHadError = false;
    this._pendingSaves += 1;
    this._saveStatus = "saving";
    this._saveMessage = "";
    this.updateSaveIndicator();
  }

  finishSave() {
    this._pendingSaves = Math.max(0, this._pendingSaves - 1);
    if (this._pendingSaves > 0) return;
    if (this._saveHadError) {
      this._saveStatus = "error";
      this.updateSaveIndicator();
      return;
    }
    this._saveStatus = "saved";
    this.updateSaveIndicator();
    this._saveStatusTimer = window.setTimeout(() => {
      this._saveStatus = "idle";
      this.updateSaveIndicator();
    }, 2500);
  }

  failSave(entityId, error) {
    this._pendingSaves = Math.max(0, this._pendingSaves - 1);
    this._saveHadError = true;
    delete this._optimisticStates[entityId];
    this._saveStatus = "error";
    this._saveMessage = `Błąd zapisu: ${error?.message || "brak potwierdzenia Home Assistant"}`;
    this.captureScrollPositions();
    this.render();
    this.updateSaveIndicator();
  }

  optimisticService(entityId, value, domain, service, data) {
    if (!this.exists(entityId)) return Promise.resolve(false);
    this._optimisticStates[entityId] = String(value);
    this.beginSave();
    const request = this.callService(domain, service, data);
    return Promise.resolve(request).then(() => {
      this.finishSave();
      window.setTimeout(() => {
        if (Object.prototype.hasOwnProperty.call(this._optimisticStates, entityId)) {
          delete this._optimisticStates[entityId];
          this.updateToggleButtons();
        }
      }, 15000);
      return true;
    }).catch((error) => {
      this.failSave(entityId, error);
      return false;
    });
  }

  setNumber(entityId, value) {
    const parsed = Number(String(value).replace(",", "."));
    if (!Number.isFinite(parsed) || !this.exists(entityId)) return Promise.resolve(false);
    return this.optimisticService(entityId, parsed, "number", "set_value", { entity_id: entityId, value: parsed });
  }

  setSelect(entityId, option) {
    if (!this.exists(entityId)) return Promise.resolve(false);
    const request = this.optimisticService(entityId, option, "select", "select_option", { entity_id: entityId, option });
    if (option === "Charge" && /_slot_.*_mode$/.test(entityId)) {
      const gridEntity = entityId.replace(/^select\./, "switch.").replace(/_mode$/, "_charge_enabled");
      if (this.exists(gridEntity)) this.turnSwitch(gridEntity, true);
    }
    return request;
  }

  turnSwitch(entityId, value) {
    if (!this.exists(entityId)) return Promise.resolve(false);
    const target = value ? "on" : "off";
    this._optimisticStates[entityId] = target;
    this.updateToggleButtons();
    return this.optimisticService(entityId, target, "switch", value ? "turn_on" : "turn_off", { entity_id: entityId });
  }

  setTime(entityId, value) {
    if (!this.exists(entityId)) return Promise.resolve(false);
    const time = value.length === 5 ? `${value}:00` : value;
    return this.optimisticService(entityId, time, "time", "set_value", { entity_id: entityId, time });
  }

  updatePillElement(el) {
    const entityId = el.dataset.toggle;
    const state = this.displayState(entityId, "brak");
    el.classList.toggle("on", state === "on");
    el.classList.toggle("off", state === "off");
    el.classList.toggle("missing", state !== "on" && state !== "off");
    el.textContent = state === "on" ? "tak" : state === "off" ? "nie" : "brak";
  }

  updateToggleButtons() {
    this.querySelectorAll("[data-toggle]").forEach((el) => this.updatePillElement(el));
  }

  toggle(entityId) {
    const entity = this._hass.states[entityId];
    if (!entity) return;
    const turnOn = this.displayState(entityId, entity.state) !== "on";
    const target = turnOn ? "on" : "off";
    this.captureScrollPositions();
    this.turnSwitch(entityId, turnOn);
    this.render();
    window.setTimeout(() => {
      if (this._optimisticStates?.[entityId] === target) {
        delete this._optimisticStates[entityId];
        this.updateToggleButtons();
      }
    }, 12000);
  }

  pill(entityId, text = null) {
    const state = this.displayState(entityId, "brak");
    const cls = state === "on" ? "on" : state === "off" ? "off" : "missing";
    const label = text || (state === "on" ? "tak" : state === "off" ? "nie" : "brak");
    return `<button class="pill ${cls}" data-toggle="${entityId}" ${this.exists(entityId) ? "" : "disabled"}>${label}</button>`;
  }

  selectInput(entityId, fallbackOptions = []) {
    const current = this.state(entityId, "");
    const options = this.options(entityId, fallbackOptions);
    const merged = options.includes(current) || !current ? options : [current, ...options];
    return `<select data-select="${entityId}" ${this.exists(entityId) ? "" : "disabled"}>
      ${merged.map((option) => `<option value="${option}" ${option === current ? "selected" : ""}>${option}</option>`).join("")}
    </select>`;
  }

  numberInput(entityId, unit = "") {
    return `<label class="field">
      <input data-number="${entityId}" type="text" inputmode="decimal" value="${this.numberState(entityId)}" ${this.exists(entityId) ? "" : "disabled"}>
      <span>${unit}</span>
    </label>`;
  }

  touSocInput(entityId) {
    const entity = this._hass?.states?.[entityId];
    const raw = this.state(entityId, "");
    const invalid = ["unknown", "unavailable", ""].includes(raw);
    const value = invalid ? "" : raw;
    return `<label class="field">
      <input data-number="${entityId}" type="text" inputmode="decimal" value="${this.escapeHtml(value)}" placeholder="wymaga potwierdzenia" ${this.exists(entityId) ? "" : "disabled"}>
      <span>%</span>
    </label>`;
  }

  rawSelect(name, options = [], value = "") {
    return `<select data-raw="${name}">
      ${options.map((option) => {
        const optionValue = Array.isArray(option) ? option[0] : option;
        const optionLabel = Array.isArray(option) ? option[1] : option;
        return `<option value="${optionValue}" ${optionValue === value ? "selected" : ""}>${optionLabel}</option>`;
      }).join("")}
    </select>`;
  }

  rawNumber(name, value = 0, unit = "") {
    return `<label class="field">
      <input data-raw="${name}" type="text" inputmode="decimal" value="${value}">
      <span>${unit}</span>
    </label>`;
  }

  rawValue(name, fallback = "") {
    return this.querySelector(`[data-raw="${name}"]`)?.value ?? fallback;
  }

  aiDefaults() {
    return {
      enabled: true,
      mode: "proposal",
      strategy: "balanced",
      forecastEnabled: true,
      forecastMargin: 10,
      realPv: true,
      history: true,
      prices: true,
      minSellPrice: 0.2,
      maxBuyPrice: 0.7,
      minSoc: 20,
      targetSoc: 80,
      batteryCapacityKwh: 10,
      batteryEfficiency: 90,
      reserveKwh: 2,
      maxSellPower: 5000,
      gridExportLimit: 5000,
      maxDischargeCurrent: 120,
      maxChargeCurrent: 120,
      maxGridChargeCurrent: 60,
      allowGridCharge: true,
      allowBatterySell: true,
      allowDeyeMode: true,
    };
  }

  aiSettings() {
    const defaults = this.aiDefaults();
    if (this._aiSettingsCache) return { ...defaults, ...this._aiSettingsCache };
    const entity = this._hass?.states?.[this.entity("sensor", "ai_state")];
    const backend = entity?.attributes?.settings;
    if (backend && typeof backend === "object" && !Array.isArray(backend) && Object.keys(backend).length) {
      return { ...defaults, ...backend };
    }
    try {
      const saved = JSON.parse(localStorage.getItem("deye_energy_manager_ai_settings_v073") || "{}");
      return { ...defaults, ...saved };
    } catch (_err) {
      return defaults;
    }
  }

  saveAiSettings(settings) {
    this._aiSettingsCache = { ...settings };
    this.callService("deye_energy_manager", "save_ai_settings", { data: JSON.stringify(settings) });
    try {
      localStorage.setItem("deye_energy_manager_ai_settings_v073", JSON.stringify(settings));
    } catch (_err) {
      // LocalStorage can be blocked in some HA webviews. In that case the UI still works for this render.
    }
  }

  aiHistory() {
    if (this._aiHistoryCache) return this._aiHistoryCache;
    const entity = this._hass?.states?.[this.entity("sensor", "ai_state")];
    const backend = entity?.attributes?.history;
    if (Array.isArray(backend)) return backend;
    try {
      const history = JSON.parse(localStorage.getItem("deye_energy_manager_ai_history_v073") || "[]");
      return Array.isArray(history) ? history : [];
    } catch (_err) {
      return [];
    }
  }

  saveAiAnalysis(ai, event = "suggestion", extra = {}) {
    try {
      const now = Date.now();
      const entry = {
        timestamp: now,
        event,
        bestSell: ai.bestSell.slice(0, 3),
        cheapBuy: ai.cheapBuy.slice(0, 3),
        solcastToday: ai.solcastToday,
        solcastRemaining: ai.solcastRemaining,
        dailyPv: ai.dailyPv,
        forecastCorrection: ai.forecastCorrection,
        learningDays: ai.learning?.recorded_days || 0,
        learningHours: ai.learning?.recorded_hours || 0,
        solcastAccuracy: ai.learning?.solcast_accuracy_avg ?? null,
        expectedRemainingLoad: ai.expectedRemainingLoad,
        estimatedSurplus: ai.estimatedSurplus,
        predictedSoc: ai.predictedSoc,
        predictedSocTrend: ai.predictedSocTrend,
        activeConfigured: ai.activeConfigured,
        strategy: ai.settings.strategy,
        maxSellPower: ai.settings.maxSellPower,
        minSoc: ai.settings.minSoc,
        forecastMargin: ai.settings.forecastMargin,
        ...extra,
      };
      entry.fingerprint = JSON.stringify({
        event,
        bestSell: entry.bestSell,
        cheapBuy: entry.cheapBuy,
        strategy: entry.strategy,
        activeConfigured: entry.activeConfigured,
        predictedSocTrend: entry.predictedSocTrend,
        forecastCorrection: Math.round((entry.forecastCorrection || 0) * 20) / 20,
        estimatedSurplus: Math.round((entry.estimatedSurplus || 0) * 2) / 2,
      });
      const history = this.aiHistory();
      const latest = history.find((item) => (item.event || "suggestion") === "suggestion");
      if (event === "suggestion" && latest?.fingerprint === entry.fingerprint) return;
      const updated = [entry, ...history].slice(0, 365);
      this._aiHistoryCache = updated;
      this.callService("deye_energy_manager", "save_ai_analysis", { data: JSON.stringify(entry) });
      localStorage.setItem("deye_energy_manager_ai_history_v073", JSON.stringify(updated));
    } catch (_err) {
      // Historia jest pomocnicza i może być niedostępna w części webview Home Assistant.
    }
  }

  clearAiHistory() {
    this._aiHistoryCache = [];
    this.callService("deye_energy_manager", "clear_ai_history", {});
    try {
      localStorage.removeItem("deye_energy_manager_ai_history_v073");
    } catch (_err) {
      // Brak dostępu do localStorage nie powinien blokować karty.
    }
  }

  historyData() {
    const entity = this._hass?.states?.[this.entity("sensor", "ai_state")];
    const attrs = entity?.attributes || {};
    return {
      analyses: this.aiHistory(),
      daily: Array.isArray(attrs.daily_summary) ? attrs.daily_summary : [],
      monthly: Array.isArray(attrs.monthly_summary) ? attrs.monthly_summary : [],
      solcast: Array.isArray(attrs.solcast_history) ? attrs.solcast_history : [],
    };
  }

  escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  filteredAnalyses() {
    const { analyses } = this.historyData();
    const filters = this._historyFilters || {};
    return analyses.filter((item) => {
      const date = new Date(Number(item.timestamp) || item.date || 0);
      const day = Number.isNaN(date.getTime()) ? String(item.date || "") : date.toISOString().slice(0, 10);
      if (filters.from && day < filters.from) return false;
      if (filters.to && day > filters.to) return false;
      return !filters.type || filters.type === "all" || (item.event || "suggestion") === filters.type;
    });
  }

  downloadHistory(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  exportHistory(format) {
    const data = this.historyData();
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "json") {
      this.downloadHistory(`deye-historia-${stamp}.json`, JSON.stringify(data, null, 2), "application/json");
      return;
    }
    const rows = [["typ", "data", "pv_kwh", "zuzycie_kwh", "import_kwh", "eksport_kwh", "sprzedaz_kwh", "wartosc_pln", "prognoza_kwh", "trafnosc_pct"]];
    data.daily.forEach((item) => rows.push(["dzien", item.date, item.pv_kwh, item.load_kwh, item.grid_import_kwh, item.grid_export_kwh, item.sold_kwh, item.sold_value, item.forecast_kwh, item.accuracy_percent]));
    data.analyses.forEach((item) => rows.push([item.event || "suggestion", new Date(item.timestamp).toISOString(), item.dailyPv, item.expectedRemainingLoad, "", "", "", "", item.solcastToday, item.solcastAccuracy]));
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    this.downloadHistory(`deye-historia-${stamp}.csv`, csv, "text/csv;charset=utf-8");
  }

  exportMonthlyReport() {
    const rows = [["miesiac", "dni", "pv_kwh", "zuzycie_kwh", "import_kwh", "eksport_kwh", "sprzedaz_kwh", "wartosc_pln", "prognoza_kwh", "produkcja_kwh"]];
    this.historyData().monthly.forEach((item) => rows.push([item.month, item.days, item.pv_kwh, item.load_kwh, item.grid_import_kwh, item.grid_export_kwh, item.sold_kwh, item.sold_value, item.forecast_kwh, item.actual_kwh]));
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    this.downloadHistory(`deye-raport-miesieczny-${new Date().toISOString().slice(0, 7)}.csv`, csv, "text/csv;charset=utf-8");
  }

  editableConfigEntities() {
    const editableDomains = new Set(["number", "select", "switch", "time", "input_number", "input_select", "input_boolean", "input_datetime"]);
    const managerEntities = Object.keys(this._hass?.states || {}).filter((entityId) => {
      const [domain] = entityId.split(".");
      return editableDomains.has(domain) && entityId.includes("deye_energy_manager_");
    });
    const touEntities = [];
    for (let index = 1; index <= 6; index += 1) {
      const tou = this.touEntities(index);
      touEntities.push(tou.start, tou.soc, tou.grid, tou.gridCurrent);
    }
    return [...new Set([...managerEntities, ...touEntities])].filter((entityId) => this.exists(entityId));
  }

  configurationSnapshot() {
    const values = {};
    this.editableConfigEntities().forEach((entityId) => { values[entityId] = this.state(entityId); });
    return {
      format: "deye-energy-manager-config",
      version: "0.7.6",
      created_at: new Date().toISOString(),
      values,
      ai_settings: this.aiSettings(),
      card: { theme: this.config?.theme || "deye" },
    };
  }

  async applyConfigurationSnapshot(snapshot) {
    if (!snapshot || snapshot.format !== "deye-energy-manager-config" || typeof snapshot.values !== "object") throw new Error("Nieprawidłowy plik konfiguracji");
    for (const [entityId, value] of Object.entries(snapshot.values)) {
      if (!this.exists(entityId)) continue;
      const domain = entityId.split(".")[0];
      if (["switch", "input_boolean"].includes(domain)) await this.callService(domain, value === "on" ? "turn_on" : "turn_off", { entity_id: entityId });
      else if (["select", "input_select"].includes(domain)) await this.callService(domain, "select_option", { entity_id: entityId, option: value });
      else if (["number", "input_number"].includes(domain)) await this.callService(domain, "set_value", { entity_id: entityId, value: Number(value) });
      else if (domain === "time") await this.callService(domain, "set_value", { entity_id: entityId, time: String(value).slice(0, 8) });
      else if (domain === "input_datetime") await this.callService(domain, "set_datetime", { entity_id: entityId, time: String(value).slice(0, 8) });
    }
    if (snapshot.ai_settings && typeof snapshot.ai_settings === "object") this.saveAiSettings(snapshot.ai_settings);
  }

  exportConfiguration() {
    const snapshot = this.configurationSnapshot();
    this.downloadHistory(`deye-konfiguracja-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(snapshot, null, 2), "application/json");
  }

  createConfigurationBackup() {
    const snapshot = this.configurationSnapshot();
    localStorage.setItem("deye_energy_manager_config_backup_v074", JSON.stringify(snapshot));
    this.downloadHistory(`deye-kopia-zapasowa-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(snapshot, null, 2), "application/json");
  }

  async restoreConfigurationBackup() {
    const raw = localStorage.getItem("deye_energy_manager_config_backup_v074");
    if (!raw) throw new Error("Brak lokalnej kopii zapasowej");
    await this.applyConfigurationSnapshot(JSON.parse(raw));
  }

  refreshConfiguredEntities() {
    const entityIds = Object.keys(this._hass?.states || {}).filter((entityId) => entityId.includes("deye_energy_manager_") || entityId.startsWith("select.deye_inverter_") || entityId.startsWith("number.deye_inverter_") || entityId.startsWith("sensor.deye_inverter_"));
    if (entityIds.length) this.callService("homeassistant", "update_entity", { entity_id: entityIds });
  }

  renderDiagnostics(slots) {
    const entity = this._hass?.states?.[this.entity("sensor", "diagnostics")];
    const attrs = entity?.attributes || {};
    const required = Array.isArray(attrs.entities) ? attrs.entities : [];
    const entityRows = required.length ? required.map((item) => `<tr><td>${item.entity_id}</td><td><span class="diag-badge ${item.ok ? "ok" : "error"}">${item.ok ? "OK" : item.state}</span></td></tr>`).join("") : `<tr><td colspan="2">Brak danych diagnostycznych. Uruchom ponownie Home Assistant.</td></tr>`;
    const connected = attrs.connected === true;
    const mappingSegments = attrs.mapping_segments ?? this.scheduleSegments(slots).length;
    const logical = attrs.logical_state || {};
    const physical = attrs.physical_state || {};
    return `<div class="diagnostic-summary">
      <div><span>Połączenie z falownikiem</span><strong class="${connected ? "good" : "bad"}">${connected ? "Połączono" : "Problem"}</strong></div>
      <div><span>Stan managera</span><strong>${this.readMode(attrs.manager_status || "NO DATA")[0]}</strong></div>
      <div><span>Slot harmonogramu</span><strong>${attrs.active_slot || "brak"} · następny ${attrs.next_active_slot || "brak"}</strong></div>
      <div><span>Harmonogram i mapowanie</span><strong class="${attrs.mapping_status === "ERROR" ? "bad" : "good"}">${attrs.mapping_status || "brak"} · ${mappingSegments}/6</strong></div>
      <div><span>Ostatni zapis</span><strong>${this.formatAppliedAt(attrs.last_saved_at)}</strong></div>
      <div><span>Ostatnie zastosowanie</span><strong>${this.formatAppliedAt(attrs.last_applied_at)}</strong></div>
      <div><span>Ostatni błąd</span><strong class="${attrs.last_error && attrs.last_error !== "none" ? "bad" : "good"}">${attrs.last_error && attrs.last_error !== "none" ? attrs.last_error : "Brak"}</strong></div>
      <div><span>Wersje</span><strong>Integracja ${attrs.integration_version || "0.7.6"} · karta 0.7.6</strong></div>
    </div>
    <section class="diagnostic-section"><h3>Wymagane encje</h3><div class="diagnostic-entities"><table class="settings-table"><thead><tr><th>Encja</th><th>Stan</th></tr></thead><tbody>${entityRows}</tbody></table></div></section>
    <section class="diagnostic-section"><h3>Sterowanie i odczyt</h3><div class="diagnostic-actions"><button data-system-defaults="1">Zatrzymaj managera i zastosuj domyślne</button><button data-resume-manager="1">Wznów managera</button><button data-refresh-entities="1">Ponownie odczytaj encje</button></div></section>
    <section class="diagnostic-section"><h3>Stan logiczny i fizyczny</h3><div class="diagnostic-summary">
      <div><span>active_slot_control</span><strong>${logical.active_slot_control ?? "brak"}</strong></div>
      <div><span>physical_tou</span><strong>${physical.physical_tou ?? "brak"}</strong></div>
      <div><span>minimum_sell_soc</span><strong>${logical.minimum_sell_soc ?? "brak"}%</strong></div>
      <div><span>tou_soc</span><strong>${logical.tou_soc ?? "brak"}%</strong></div>
      <div><span>charge_profile_target_soc</span><strong>${logical.charge_profile_target_soc ?? "brak"}%</strong></div>
      <div><span>effective_tou_soc</span><strong>${logical.effective_tou_soc ?? "brak"}%</strong></div>
      <div><span>physical_soc_actual</span><strong>${physical.physical_soc_actual ?? "brak"}%</strong></div>
      <div><span>grid_charge_expected</span><strong>${logical.grid_charge_expected ? "tak" : "nie"}</strong></div>
      <div><span>grid_charge_actual</span><strong>${physical.grid_charge_actual ? "tak" : "nie"}</strong></div>
      <div><span>currents</span><strong>${JSON.stringify(logical.currents || {})}</strong></div>
    </div></section>
    <section class="diagnostic-section"><h3>Konfiguracja i kopia zapasowa</h3><div class="diagnostic-actions"><button data-export-config="1">Eksport konfiguracji</button><button data-import-config-open="1">Import konfiguracji</button><input type="file" accept="application/json,.json" data-import-config hidden><button data-create-backup="1">Utwórz kopię zapasową</button><button data-restore-backup="1">Przywróć kopię</button><button class="danger" data-restore-defaults="1">Przywróć ustawienia domyślne</button></div></section>`;
  }

  aiCheck(name, label, value) {
    return `<div class="settings-row"><span>${label}</span><input data-ai-setting="${name}" type="checkbox" ${value ? "checked" : ""}></div>`;
  }

  aiNumber(name, label, value, unit = "") {
    return `<div class="settings-row"><span>${label}</span><label class="field compact-field"><input data-ai-setting="${name}" type="text" inputmode="decimal" value="${value}"><span>${unit}</span></label></div>`;
  }

  aiSelect(name, label, options, value) {
    return `<div class="settings-row"><span>${label}</span><select data-ai-setting="${name}">
      ${options.map((option) => {
        const optionValue = Array.isArray(option) ? option[0] : option;
        const optionLabel = Array.isArray(option) ? option[1] : option;
        return `<option value="${optionValue}" ${optionValue === value ? "selected" : ""}>${optionLabel}</option>`;
      }).join("")}
    </select></div>`;
  }

  async applyMultiEdit(slots) {
    const selected = this.selectedSlotList(slots);
    if (!selected.length) return;
    const checked = (name) => this.querySelector(`[data-apply-field="${name}"]`)?.checked;
    const activeValue = this.rawValue("multi-active", "on") === "on";
    const mode = this.rawValue("multi-mode", "Selling First");
    const sellPower = this.rawValue("multi-sell-power", 5000);
    const dischargeCurrent = this.rawValue("multi-discharge-current", 120);
    const chargeCurrent = this.rawValue("multi-charge-current", 0);
    const gridChargeValue = this.rawValue("multi-grid-charge", "off") === "on";
    const gridChargeCurrent = this.rawValue("multi-grid-charge-current", 0);
    const minSoc = this.rawValue("multi-min-soc", 40);
    const minSellPrice = this.rawValue("multi-min-sell-price", 0);
    const forceGridCharge = checked("mode") && mode === "Charge";

    for (const [key, label] of selected) {
      const entities = this.slotEntities(key, label);
      if (checked("sellPower")) await this.setNumber(entities.sellPower, sellPower);
      if (checked("dischargeCurrent")) await this.setNumber(entities.dischargeCurrent, dischargeCurrent);
      if (checked("chargeCurrent")) await this.setNumber(entities.chargeCurrent, chargeCurrent);
      if (checked("gridChargeCurrent")) await this.setNumber(entities.gridChargeCurrent, gridChargeCurrent);
      if (checked("minSoc")) await this.setNumber(entities.minSoc, minSoc);
      if (checked("minSellPrice")) await this.setNumber(entities.minSellPrice, minSellPrice);
      if (checked("mode")) await this.setSelect(entities.mode, mode);
      if (checked("active") || forceGridCharge) await this.turnSwitch(entities.sellEnabled, forceGridCharge || activeValue);
      if (checked("gridCharge") || forceGridCharge) {
        await this.setSlotGridCharge(
          key,
          entities,
          forceGridCharge || gridChargeValue,
          checked("gridChargeCurrent") ? gridChargeCurrent : null,
          checked("minSoc") ? minSoc : null,
          false,
        );
      }
    }
    this._dialog = null;
    this.render();
  }

  timeInput(entityId) {
    const raw = this.state(entityId, "00:00:00");
    const value = raw.length >= 5 ? raw.slice(0, 5) : raw;
    return `<input class="time-input" data-time="${entityId}" type="time" value="${value}" ${this.exists(entityId) ? "" : "disabled"}>`;
  }

  stat(label, value, cls = "", liveKey = "", icon = "") {
    const liveCard = liveKey ? ` data-live-card="${liveKey}"` : "";
    const liveValue = liveKey ? ` data-live="${liveKey}"` : "";
    return `<div class="stat ${cls}"${liveCard}>${icon ? `<i class="stat-icon">${this.iconSvg(icon)}</i>` : ""}<div class="stat-copy"><span>${label}</span><strong${liveValue}>${value}</strong></div></div>`;
  }

  row(label, value, cls = "") {
    return `<div class="row ${cls}"><span>${label}</span><strong>${value}</strong></div>`;
  }

  readMode(rawStatus) {
    const status = String(rawStatus || "").toUpperCase();
    if (status.includes("EMERGENCY")) return ["Awaryjnie zatrzymany", "bad"];
    if (status.includes("MAPPING ERROR")) return ["Błąd mapowania Deye", "bad"];
    if (status.includes("NO DATA")) return ["Brak danych sterowania", "warn"];
    if (status.includes("DEFAULT")) return ["Ustawienia domyślne", "warn"];
    if (status.includes("PROTECT")) return ["Ochrona baterii", "warn"];
    if (status.includes("SCHEDULER OFF")) return ["Harmonogram wy\u0142\u0105czony", "neutral"];
    if (status.includes("SLOT DISABLED")) return ["Slot wy\u0142\u0105czony - domy\u015blne", "warn"];
    if (status.includes("GRID CHARGE")) return ["\u0141adowanie z sieci", "charge"];
    if (status.includes("SELLING ACTIVE")) return ["Sprzeda\u017c wed\u0142ug harmonogramu", "good"];
    if (status.includes("ZERO EXPORT CT")) return ["Zero Export To CT", "ct"];
    if (status.includes("ZERO EXPORT LOAD")) return ["Zero Export To Load", "zero"];
    if (status.includes("SCHEDULE")) return ["Harmonogram aktywny", "good"];
    if (status.includes("MANUAL")) return ["Sprzeda\u017c r\u0119czna", "good"];
    if (status.includes("CHARGE")) return ["\u0141adowanie r\u0119czne", "charge"];
    if (status.includes("STOP")) return ["Zatrzymany - ustawienia domy\u015blne", "bad"];
    if (status.includes("SOC")) return ["Sprzeda\u017c zablokowana przez SOC", "warn"];
    if (status.includes("PRICE")) return ["Sprzeda\u017c zablokowana przez cen\u0119", "warn"];
    if (status.includes("WAITING")) return ["Oczekiwanie na decyzję", "neutral"];
    if (status.includes("IDLE")) return ["Bezczynny", ""];
    if (!rawStatus || rawStatus === "brak") return ["Brak danych", "warn"];
    return [rawStatus, ""];
  }

  formatAppliedAt(value) {
    if (!value || value === "brak" || value === "never") return "Jeszcze nie zastosowano";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  readAction(rawAction) {
    const action = String(rawAction || "");
    const upper = action.toUpperCase();
    if (!action || action === "brak" || upper === "IDLE") return "Brak ostatniej akcji";
    if (upper.includes("INACTIVE SLOT")) return "Ustawienia domy\u015blne - slot wy\u0142\u0105czony";
    if (upper.includes("PRICE GUARD")) return "Ustawienia domy\u015blne - blokada ceny";
    if (upper.includes("DEFAULTS RESTORED")) return "Przywr\u00f3cono ustawienia domy\u015blne";
    if (upper.includes("EMERGENCY")) return "Wykonano zatrzymanie awaryjne";
    if (upper.includes("BLOCKED BY GUARD")) return "Sterowanie zablokowane przez ochron\u0119";
    if (upper.includes("CHARGE BLOCKED")) return "\u0141adowanie zablokowane";
    if (upper.includes("APPLIED SCHEDULE")) return "Zastosowano bie\u017c\u0105cy slot harmonogramu";
    if (upper.includes("APPLIED MANUAL SELL")) return "Zastosowano sprzeda\u017c r\u0119czn\u0105";
    if (upper.includes("APPLIED CHARGE BATTERY")) return "Zastosowano \u0142adowanie baterii";
    return action;
  }

  gridFlow(value) {
    const power = this.asNumber(value);
    if (power === null) return "Brak danych";
    if (power < -1) return `Oddawanie ${Math.abs(power).toFixed(0)} W`;
    if (power > 1) return `Pobór ${power.toFixed(0)} W`;
    return "Bilans 0 W";
  }

  batteryFlow(value) {
    const power = this.asNumber(value);
    if (power === null) return "Brak danych";
    if (power < -1) return `\u0141adowanie ${Math.abs(power).toFixed(0)} W`;
    if (power > 1) return `Roz\u0142adowanie ${power.toFixed(0)} W`;
    return "Spoczynek 0 W";
  }

  scheduleSlots() {
    return Array.from({ length: 24 }, (_, hour) => {
      const next = (hour + 1) % 24;
      const key = `${String(hour).padStart(2, "0")}_${String(next).padStart(2, "0")}`;
      const label = `${String(hour).padStart(2, "0")}:00-${String(next).padStart(2, "0")}:00`;
      const touSlot = hour < 4 ? 1 : hour < 8 ? 2 : hour < 12 ? 3 : hour < 16 ? 4 : hour < 20 ? 5 : 6;
      return [key, label, touSlot];
    });
  }

  async startSell() {
    const scheduler = this.entity("switch", "scheduler");
    const chargeScheduler = this.entity("switch", "charge_scheduler");
    const controlMode = this.entity("select", "control_mode");
    if (this.exists(controlMode)) await this.callService("select", "select_option", { entity_id: controlMode, option: "Schedule" });
    if (this.exists(scheduler)) await this.callService("switch", "turn_on", { entity_id: scheduler });
    if (this.exists(chargeScheduler)) await this.callService("switch", "turn_off", { entity_id: chargeScheduler });
  }

  async stopManager() {
    return this.applyDefaultValues();
  }

  async restoreDefaults() {
    return this.applyDefaultValues();
  }

  async resumeManager() {
    this._saveStatus = "saving";
    this._saveMessage = "Włączanie managera...";
    this.render();
    try {
      await this.callService("deye_energy_manager", "resume_manager", {});
      this._saveStatus = "saved";
      this._saveMessage = "Manager włączony";
    } catch (error) {
      this._saveStatus = "error";
      this._saveMessage = `SCHEDULE APPLY ERROR: ${error?.message || error}`;
    }
    this.render();
  }

  async applyDefaultValues() {
    if (this._defaultsApplying) return false;
    this._defaultsApplying = true;
    this._defaultsStatus = "saving";
    this._defaultsMessage = "Stosowanie ustawień domyślnych…";
    this.render();
    try {
      await this.callService("deye_energy_manager", "restore_defaults", {});
      this._defaultsStatus = "saved";
      this._defaultsMessage = "Zastosowano ustawienia domyślne";
    } catch (error) {
      this._defaultsStatus = "error";
      this._defaultsMessage = `Nie udało się potwierdzić pełnego zestawu ustawień domyślnych: ${error?.message || error}`;
    }
    this._defaultsApplying = false;
    this.render();
  }

  async saveNormalProfile() {
    const values = {
      physical_work_mode: this.rawValue("normal-profile-mode"),
      sell_power: Number(this.querySelector('[data-normal-profile-number="sell_power"]')?.value ?? 0),
      discharge_current: Number(this.querySelector('[data-normal-profile-number="discharge_current"]')?.value ?? 0),
      charge_current: Number(this.querySelector('[data-normal-profile-number="charge_current"]')?.value ?? 0),
      grid_charge_current: Number(this.querySelector('[data-normal-profile-number="grid_charge_current"]')?.value ?? 0),
      tou_soc: Number(this.querySelector('[data-normal-profile-number="tou_soc"]')?.value ?? 0),
    };
    this._saveStatus = "saving";
    this._saveMessage = "Zapisywanie profilu Normalnej Pracy...";
    this.render();
    try {
      await this.callService("deye_energy_manager", "save_normal_profile", values);
      this._saveStatus = "saved";
      this._saveMessage = "Zapisano profil Normalnej Pracy";
    } catch (error) {
      this._saveStatus = "error";
      this._saveMessage = `Błąd zapisu profilu: ${error?.message || error}`;
    }
    this.render();
  }

  async saveDefaultSettings() {
    const values = {
      mode: this.rawValue("default-work-mode"),
      sell_power: Number(this.querySelector('[data-default-settings-number="sell_power"]')?.value ?? 0),
      discharge_current: Number(this.querySelector('[data-default-settings-number="discharge_current"]')?.value ?? 0),
      charge_current: Number(this.querySelector('[data-default-settings-number="charge_current"]')?.value ?? 0),
      grid_charge_current: Number(this.querySelector('[data-default-settings-number="grid_charge_current"]')?.value ?? 0),
      minimum_sell_soc: Number(this.querySelector('[data-default-settings-number="minimum_sell_soc"]')?.value ?? 0),
    };
    this._saveStatus = "saving";
    this._saveMessage = "Zapisywanie ustawień domyślnych...";
    this.render();
    try {
      await this.callService("deye_energy_manager", "save_default_settings", values);
      this._saveStatus = "saved";
      this._saveMessage = "Zapisano ustawienia domyślne";
    } catch (error) {
      this._saveStatus = "error";
      this._saveMessage = `Błąd zapisu ustawień domyślnych: ${error?.message || error}`;
    }
    this.render();
  }

  async saveChargeProfile() {
    const entities = {
      chargeCurrent: this.entity("number", "charge_profile_charge_current"),
      dischargeCurrent: this.entity("number", "charge_profile_discharge_current"),
      gridChargeCurrent: this.entity("number", "charge_profile_grid_charge_current"),
      targetSoc: this.entity("number", "charge_profile_target_soc"),
    };
    const stored = this.chargeProfileStoredValues();
    const values = {
      charge_current: Number(this.querySelector('[data-charge-profile-number="charge_current"]')?.value ?? stored.charge_current ?? ""),
      discharge_current: Number(this.querySelector('[data-charge-profile-number="discharge_current"]')?.value ?? stored.discharge_current ?? ""),
      grid_charge_current: Number(this.querySelector('[data-charge-profile-number="grid_charge_current"]')?.value ?? stored.grid_charge_current ?? ""),
      target_soc: Number(this.querySelector('[data-charge-profile-number="target_soc"]')?.value ?? stored.target_soc ?? ""),
      grid_charge_enabled: this._chargeProfileGridDraft !== null
        ? this._chargeProfileGridDraft
        : (this.chargeProfileStoredValues().grid_charge_enabled ?? false),
    };
    if (!entities.chargeCurrent && !entities.dischargeCurrent && !entities.targetSoc) {
      window.alert("Brak encji profilu Charge.");
      return;
    }
    this._saveStatus = "saving";
    this._saveMessage = "Zapisywanie profilu Charge...";
    this.render();
    try {
      await this.callService("deye_energy_manager", "save_charge_profile", values);
      this._chargeProfileDraft = {};
      this._chargeProfileGridDraft = null;
      this._saveStatus = "saved";
      this._saveMessage = "Zapisano profil Charge";
    } catch (error) {
      this._saveStatus = "error";
      this._saveMessage = `Błąd zapisu profilu Charge: ${error?.message || error}`;
    }
    this.render();
  }

  async reloadNormalProfileSlot(slotKey) {
    const updates = [{ enabled: true, mode: "Normalna Praca", force_copy_normal_profile: true }];
    await this.callService("deye_energy_manager", "apply_schedule_patch", { updates });
    this._saveStatus = "saved";
    this._saveMessage = `Skopiowano profil Normalnej Praca do slotu ${slotKey || "bieżącego"}`;
    this.render();
  }

  inverterWorkModes() {
    return ["Selling First", "Zero Export To Load", "Zero Export To CT"];
  }

  slotWorkModes() {
    return ["Selling First", "Normalna Praca", "Charge"];
  }

  modeMeta(mode, enabled = true) {
    if (!enabled) {
      return { cls: "disabled", title: "Wy\u0142\u0105czone", subtitle: "Sprzeda\u017c wy\u0142\u0105czona", icon: "shield" };
    }
    const normalized = this.norm(mode);
    if (normalized.includes("selling")) {
      return { cls: "selling", title: "Selling First", subtitle: "Priorytet sprzeda\u017cy", icon: "sell" };
    }
    if (normalized.includes("normalna praca") || normalized.includes("normal_operation")) {
      return { cls: "normal", title: "Normalna Praca", subtitle: "Praca wed\u0142ug zapisanego profilu", icon: "normal" };
    }
    if (normalized.includes("charge")) {
      return { cls: "charge", title: "Charge", subtitle: "\u0141adowanie z sieci", icon: "charge" };
    }
    return { cls: "zero", title: "Zero Export To Load", subtitle: "Zero eksport do LOAD", icon: "load" };
  }

  defaultSettingsStoredValues() {
    const statusId = this.entity("sensor", "manager_status");
    const defaults = this._hass?.states?.[statusId]?.attributes?.default_settings;
    return defaults && typeof defaults === "object" ? defaults : {};
  }

  defaultSettingsInput(name, entityId, unit = "") {
    const defaults = this.defaultSettingsStoredValues();
    const entity = this._hass?.states?.[entityId];
    const current = this.numberState(entityId);
    const fallbackValue = defaults[name];
    const known = current && current !== "unknown" && current !== "unavailable";
    const value = known ? current : (fallbackValue ?? "");
    const fallback = {
      min: 0,
      max: name === "minimum_sell_soc" ? 100 : 240,
      step: name === "minimum_sell_soc" ? 1 : 0.1,
    };
    const min = entity?.attributes?.min ?? fallback.min;
    const max = entity?.attributes?.max ?? fallback.max;
    const step = entity?.attributes?.step ?? fallback.step;
    return `<label class="field"><input data-default-settings-number="${this.escapeHtml(name)}" type="number" inputmode="decimal" value="${this.escapeHtml(value ?? "")}" min="${min}" max="${max}" step="${step}"><span>${this.escapeHtml(unit)}</span></label>`;
  }

  chargeProfileStoredValues() {
    const statusId = this.entity("sensor", "manager_status");
    const profile = this._hass?.states?.[statusId]?.attributes?.charge_profile;
    return profile && typeof profile === "object" ? profile : {};
  }

  normalProfileStoredValues() {
    const statusId = this.entity("sensor", "manager_status");
    const profile = this._hass?.states?.[statusId]?.attributes?.normal_profile;
    return profile && typeof profile === "object" ? profile : {};
  }

  normalProfileInput(name, entityId, unit = "") {
    const profile = this.normalProfileStoredValues();
    const entity = this._hass?.states?.[entityId];
    const current = this.numberState(entityId);
    const fallbackValue = profile[name];
    const known = current && current !== "unknown" && current !== "unavailable";
    const value = known ? current : (fallbackValue ?? "");
    const fallback = {
      min: name === "tou_soc" ? 0 : 0,
      max: name === "tou_soc" ? 100 : 240,
      step: name === "tou_soc" ? 1 : 0.1,
    };
    const min = entity?.attributes?.min ?? fallback.min;
    const max = entity?.attributes?.max ?? fallback.max;
    const step = entity?.attributes?.step ?? fallback.step;
    return `<label class="field"><input data-normal-profile-number="${this.escapeHtml(name)}" type="number" inputmode="decimal" value="${this.escapeHtml(value ?? "")}" min="${min}" max="${max}" step="${step}"><span>${this.escapeHtml(unit)}</span></label>`;
  }

  chargeProfileInput(name, entityId, unit = "") {
    const entity = this._hass?.states?.[entityId];
    const current = this.state(entityId, "");
    const invalid = ["unknown", "unavailable", ""].includes(current);
    const profileKey = name;
    const fallbackValue = this.chargeProfileStoredValues()[profileKey];
    const value = invalid ? (this._chargeProfileDraft[name] ?? fallbackValue ?? "") : current;
    const fallback = {
      min: name === "target_soc" ? 0 : 0,
      max: name === "target_soc" ? 100 : 240,
      step: name === "target_soc" ? 1 : 0.1,
    };
    const min = entity?.attributes?.min ?? fallback.min;
    const max = entity?.attributes?.max ?? fallback.max;
    const step = entity?.attributes?.step ?? fallback.step;
    return `<label class="field"><input data-charge-profile-number="${this.escapeHtml(name)}" type="number" inputmode="decimal" value="${this.escapeHtml(value)}" min="${min}" max="${max}" step="${step}"><span>${this.escapeHtml(unit)}</span></label>`;
  }

  normalProfilePhysicalMode() {
    const entityId = this.entity("select", "normal_profile_mode");
    const state = this.state(entityId);
    if (state && state !== "unknown" && state !== "unavailable" && state !== "") return state;
    const profile = this.normalProfileStoredValues();
    return profile.physical_work_mode || "";
  }

  modeInfoTooltip(mode) {
    const normalized = this.norm(mode);
    if (normalized.includes("selling")) {
      return `<strong>Selling First</strong><br>Moc: ${this.numberState(this.entity("number", "default_sell_power"), 0)} W<br>Rozładowanie: ${this.numberState(this.entity("number", "default_discharge_current"), 0)} A<br>Ładowanie: ${this.numberState(this.entity("number", "default_charge_current"), 0)} A<br>Sieć: ${this.numberState(this.entity("number", "default_grid_charge_current"), 0)} A<br>Min. SOC: ${this.numberState(this.entity("number", "minimum_sell_soc"), 0)}%<br>Cena min.: ${this.numberState(this.entity("number", "minimum_sell_price"), 0)} PLN`;
    }
    if (normalized.includes("normalna praca") || normalized.includes("normal_operation")) {
      const profile = this.normalProfileStoredValues();
      return `<strong>Normalna Praca</strong><br>Fizyczny tryb: ${profile.physical_work_mode || "—"}<br>Moc: ${profile.sell_power ?? "—"} W<br>Rozładowanie: ${profile.discharge_current ?? "—"} A<br>Ładowanie: ${profile.charge_current ?? "—"} A<br>Sieć: ${profile.grid_charge_current ?? "—"} A<br>SOC: ${profile.tou_soc ?? "—"}%`;
    }
    if (normalized.includes("charge")) {
      const profile = this.chargeProfileStoredValues();
      return `<strong>Charge</strong><br>Ładowanie: ${profile.charge_current ?? "—"} A<br>Rozładowanie: ${profile.discharge_current ?? "—"} A<br>Sieć: ${profile.grid_charge_current ?? "—"} A<br>Docelowy SOC: ${profile.target_soc ?? "—"}%<br>Grid enabled: ${profile.grid_charge_enabled ? "TAK" : "NIE"}`;
    }
    const defaults = this.defaultSettingsStoredValues();
    return `<strong>Wyłączone</strong><br>Domyślny tryb: ${defaults.mode || "—"}<br>Moc: ${defaults.sell_power ?? "—"} W<br>Rozładowanie: ${defaults.discharge_current ?? "—"} A<br>Ładowanie: ${defaults.charge_current ?? "—"} A<br>Sieć: ${defaults.grid_charge_current ?? "—"} A`;
  }

  iconSvg(type) {
    const icons = {
      sell: '<svg viewBox="0 0 24 24"><path d="M4 14h4l2-6 4 12 2-6h4"/><path d="M4 18h16"/></svg>',
      load: '<svg viewBox="0 0 24 24"><path d="M6 12h6V6l6 6h-6v6z"/><path d="M4 20h16"/></svg>',
      ct: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/><path d="M12 8v8M8 12h8"/></svg>',
      charge: '<svg viewBox="0 0 24 24"><path d="M13 2 5 13h6l-1 9 8-12h-6z"/></svg>',
      normal: '<svg viewBox="0 0 24 24"><path d="M12 3L4 9v12h6v-7h4v7h6V9l-8-6z"/></svg>',
      shield: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/><path d="M9 12l2 2 4-5"/></svg>',
      edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4l11-11-4-4L4 16z"/><path d="M13 6l4 4"/></svg>',
      gear: '<svg viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/><path d="M4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6 1.4 1.4m0-11.4-1.4 1.4m-8.6 8.6-1.4 1.4"/></svg>',
      ai: '<svg viewBox="0 0 24 24"><path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/></svg>',
      info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 10v6"/><path d="M12 7h.01"/></svg>',
      check: '<svg viewBox="0 0 24 24"><path d="M5 12l4 4L19 6"/></svg>',
      copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 16H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
      close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
      pv: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3"/><path d="M12 2v2M12 12v2M6 8H4m16 0h-2M7.8 3.8 6.4 2.4m9.8 1.4 1.4-1.4"/><path d="M4 17h16l-2 5H6z"/></svg>',
      home: '<svg viewBox="0 0 24 24"><path d="m3 11 9-8 9 8"/><path d="M5 10v11h14V10M9 21v-7h6v7"/></svg>',
      grid: '<svg viewBox="0 0 24 24"><path d="M12 2 6 22m6-20 6 20M8 8h8M6 14h12M4 22h16"/></svg>',
      battery: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="17" height="12" rx="2"/><path d="M20 10h2v4h-2M7 12h9M11 8v8"/></svg>',
      clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      chart: '<svg viewBox="0 0 24 24"><path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/></svg>',
      money: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.8-.7-1.8-1-3-1-1.7 0-3 .9-3 2s1 1.8 3 2.2 3 1.1 3 2.3-1.3 2-3 2c-1.3 0-2.5-.4-3.3-1.2M12 5v14"/></svg>',
      calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18M8 14h.01m4 0h.01m4 0h.01M8 18h.01m4 0h.01"/></svg>',
    };
    return icons[type] || icons.gear;
  }

  iconButton(icon, label, dataAttr = "") {
    return `<button class="icon-action" ${dataAttr} title="${label}">${this.iconSvg(icon)}<span>${label}</span></button>`;
  }

  modeLegend() {
    return this.slotWorkModes().concat(["Wy\u0142\u0105czone"]).map((mode) => {
      const meta = mode === "Wy\u0142\u0105czone" ? this.modeMeta("", false) : this.modeMeta(mode, true);
      return `<div class="mode-tile ${meta.cls}" data-mode-info="${this.escapeHtml(meta.title)}">
        <div class="mode-icon">${this.iconSvg(meta.icon)}</div>
        <div><strong>${meta.title}</strong><span>${meta.subtitle}</span></div>
      </div>`;
    }).join("");
  }

  modePill(mode, enabled) {
    const meta = this.modeMeta(this.normalizeScheduleMode(mode), enabled);
    return `<span class="mode-pill ${meta.cls}">${meta.title}</span>`;
  }

  normalizeScheduleMode(mode) {
    const normalized = this.norm(mode);
    if (normalized.includes("zero") || normalized.includes("ct")) return "Normalna Praca";
    if (normalized.includes("selling")) return "Selling First";
    if (normalized.includes("charge")) return "Charge";
    if (normalized.includes("normalna praca") || normalized.includes("normal_operation")) return "Normalna Praca";
    return mode;
  }

  slotSummary(entities, enabled) {
    if (!enabled) return `<span class="empty-value">-</span>`;
    const mode = this.state(entities.mode, "Zero Export To Load");
    const sell = this.numberState(entities.sellPower, 0);
    const discharge = this.numberState(entities.dischargeCurrent, 0);
    const charge = this.numberState(entities.chargeCurrent, 0);
    const soc = this.numberState(entities.minSoc, 0);
    return `
      <span class="metric sell">${this.iconSvg("sell")} ${sell} W</span>
      <span class="metric discharge">\u2193 ${discharge} A</span>
      <span class="metric charge">\u2191 ${charge} A</span>
      <span class="metric soc">\u25c7 ${soc}%</span>
      <span class="sr-only">${mode}</span>`;
  }

  selectedSlotList(slots) {
    return slots.filter(([key]) => this._selectedSlots?.has(key));
  }

  selectedRangeText(slots) {
    const selected = this.selectedSlotList(slots);
    if (!selected.length) return "Brak zaznaczonych godzin";
    const labels = selected.map(([, label]) => label);
    if (selected.length === 1) return labels[0];
    const first = labels[0].slice(0, 5);
    const last = labels[labels.length - 1].slice(6, 11);
    return `${first} - ${last}`;
  }

  bulkValues(slots) {
    const selected = this.selectedSlotList(slots);
    const [key, label] = selected[0] || slots[0] || [];
    if (!key) {
      return {
        active: "off",
        mode: "Selling First",
        sellPower: 0,
        dischargeCurrent: 0,
        chargeCurrent: 0,
        gridCharge: "off",
        gridChargeCurrent: 0,
        minSoc: 0,
        minSellPrice: 0,
      };
    }
    const entities = this.slotEntities(key, label);
    return {
      active: this.displayState(entities.sellEnabled, "off") === "on" ? "on" : "off",
      mode: this.state(entities.mode, "Selling First"),
      sellPower: this.numberState(entities.sellPower, 0),
      dischargeCurrent: this.numberState(entities.dischargeCurrent, 0),
      chargeCurrent: this.numberState(entities.chargeCurrent, 0),
      gridCharge: this.displayState(entities.chargeEnabled, "off") === "on" ? "on" : "off",
      gridChargeCurrent: this.numberState(entities.gridChargeCurrent, 0),
      minSoc: this.numberState(entities.minSoc, 0),
      minSellPrice: this.numberState(entities.minSellPrice, 0),
    };
  }

  syncBulkPanelValues(slots) {
    if (!this._selectionMode || !this.selectedSlotList(slots).length || this.isInteracting()) return;
    const bulk = this.bulkValues(slots);
    const values = {
      "multi-active": bulk.active,
      "multi-mode": bulk.mode,
      "multi-sell-power": bulk.sellPower,
      "multi-discharge-current": bulk.dischargeCurrent,
      "multi-charge-current": bulk.chargeCurrent,
      "multi-grid-charge": bulk.gridCharge,
      "multi-grid-charge-current": bulk.gridChargeCurrent,
      "multi-min-soc": bulk.minSoc,
      "multi-min-sell-price": bulk.minSellPrice,
    };
    Object.entries(values).forEach(([name, value]) => {
      this.querySelectorAll(`[data-raw="${name}"]`).forEach((el) => {
        if (this.ownerDocument?.activeElement !== el) el.value = value;
      });
    });
  }

  scheduleSegments(slots) {
    const rows = slots.map(([key, label]) => {
      const entities = this.slotEntities(key, label);
      const enabled = this.state(entities.sellEnabled) === "on";
      const mode = enabled ? this.state(entities.mode, "Zero Export To Load") : "Wy\u0142\u0105czone";
      const chargeEnabled = this.slotGridChargeState(key, entities) === "on";
      const isCharge = this.norm(mode).includes("charge");
      const data = {
        key,
        label,
        start: Number(key.slice(0, 2)),
        end: key.endsWith("_00") ? 0 : Number(key.slice(3, 5)),
        enabled,
        mode,
        sellPower: this.asNumber(this.numberState(entities.sellPower, 0)) || 0,
        dischargeCurrent: this.asNumber(this.numberState(entities.dischargeCurrent, 0)) || 0,
        chargeCurrent: this.asNumber(this.numberState(entities.chargeCurrent, 0)) || 0,
        gridChargeCurrent: this.asNumber(this.numberState(entities.gridChargeCurrent, 0)) || 0,
        minSoc: this.asNumber(this.numberState(entities.minSoc, 0)) || 0,
        minSellPrice: this.asNumber(this.numberState(entities.minSellPrice, 0)) || 0,
        chargeEnabled: enabled && (chargeEnabled || isCharge),
        chargeMode: isCharge,
      };
      return data;
    });
    // Fizyczne sloty Deye Time of Use przechowuja granice czasu, SOC i Grid Charge.
    // Pozostale parametry harmonogramu sa stosowane godzinowo przez manager.
    const same = (a, b) => ["minSoc", "chargeEnabled"].every((key) => a[key] === b[key]);
    const segments = [];
    rows.forEach((row) => {
      if (segments.length && same(segments[segments.length - 1], row)) {
        segments[segments.length - 1].end = row.end;
      } else {
        segments.push({ ...row });
      }
    });
    while (segments.length < 6) {
      let splitIndex = -1;
      let longest = 0;
      segments.forEach((segment, index) => {
        const end = segment.end === 0 ? 24 : segment.end;
        const duration = end - segment.start;
        if (duration > longest && duration > 1) {
          longest = duration;
          splitIndex = index;
        }
      });
      if (splitIndex < 0) break;
      const segment = segments[splitIndex];
      const end = segment.end === 0 ? 24 : segment.end;
      const middle = segment.start + Math.floor((end - segment.start) / 2);
      segments.splice(
        splitIndex,
        1,
        { ...segment, end: middle },
        { ...segment, start: middle },
      );
    }
    return segments;
  }

  mapWarning(slots) {
    const count = this.scheduleSegments(slots).length;
    if (count <= 6) return `<span class="good">OK: ${count}/6 zakres\u00f3w Deye</span>`;
    return `<span class="bad">Za du\u017co zmian: ${count}/6 zakres\u00f3w Deye</span>`;
  }

  aiSuggestions(slots) {
    const settings = this.aiSettings();
    const aiState = this._hass?.states?.[this.entity("sensor", "ai_state")];
    const learning = aiState?.attributes?.learning_summary || {};
    const sellPriceToday = this.entity("sensor", ["sell_price_today", "energy_price"]);
    const buyPriceToday = this.entity("sensor", "buy_price_today");
    const solcastToday = this.asNumber(this.state(this.entity("sensor", "solcast_forecast_today"), 0)) || 0;
    const solcastRemaining = this.asNumber(this.state(this.entity("sensor", "solcast_remaining_today"), 0)) || 0;
    const dailyPv = this.asNumber(this.state(this.entity("sensor", "daily_pv_production"), 0)) || 0;
    const soldToday = this.asNumber(this.state(this.entity("sensor", "sold_energy_today"), 0)) || 0;
    const sellPrices = this.readPriceMap(sellPriceToday);
    const buyPrices = this.readPriceMap(buyPriceToday);
    const minSell = this.asNumber(settings.minSellPrice) ?? 0;
    const maxBuy = this.asNumber(settings.maxBuyPrice) ?? Number.POSITIVE_INFINITY;
    const profileRows = Array.isArray(learning.hourly_profile) ? learning.hourly_profile : [];
    const profileByHour = new Map(profileRows.map((row) => [Number(String(row.hour || "0").slice(0, 2)), row]));
    const hourlySurplus = new Map(profileRows.map((row) => {
      const hour = Number(String(row.hour || "0").slice(0, 2));
      return [hour, (this.asNumber(row.pv_kwh) || 0) - (this.asNumber(row.load_kwh) || 0)];
    }));
    const maxSurplus = Math.max(0.001, ...[...hourlySurplus.values()].map((value) => Math.max(0, value)));
    const surplusWeight = settings.strategy === "autoconsumption" ? 0.25 : settings.strategy === "balanced" ? 0.12 : 0.04;
    const sellRanking = new Map([...sellPrices.entries()].map(([hour, price]) => [
      hour,
      (settings.prices ? price : 0) + (Math.max(0, hourlySurplus.get(hour) || 0) / maxSurplus) * (settings.prices ? surplusWeight : 1),
    ]));
    const bestSell = [...sellPrices.entries()]
      .filter(([, price]) => !settings.prices || price >= minSell)
      .sort((a, b) => (sellRanking.get(b[0]) || b[1]) - (sellRanking.get(a[0]) || a[1]))
      .slice(0, 4);
    const cheapBuy = [...buyPrices.entries()].filter(([, price]) => price <= maxBuy).sort((a, b) => a[1] - b[1]).slice(0, 4);
    const activeConfigured = slots.filter(([key, label]) => {
      const e = this.slotEntities(key, label);
      return this.state(e.sellEnabled) === "on";
    }).length;
    const margin = Math.max(0, this.asNumber(settings.forecastMargin) ?? 0) / 100;
    const historicalCorrection = this.asNumber(learning.solcast_correction_factor);
    const forecastCorrection = settings.forecastEnabled && settings.history && settings.realPv
      ? (historicalCorrection ?? 1)
      : 1;
    const currentHour = new Date().getHours();
    const expectedRemainingPv = profileRows
      .filter((row) => Number(String(row.hour || "0").slice(0, 2)) >= currentHour)
      .reduce((sum, row) => sum + (this.asNumber(row.pv_kwh) || 0), 0);
    const forecastBase = settings.forecastEnabled ? solcastRemaining : expectedRemainingPv;
    const usableForecast = Math.max(0, forecastBase * forecastCorrection * (1 - margin));
    const expectedRemainingLoad = profileRows
      .filter((row) => Number(String(row.hour || "0").slice(0, 2)) >= currentHour)
      .reduce((sum, row) => sum + (this.asNumber(row.load_kwh) || 0), 0);
    const reserveKwh = Math.max(0, this.asNumber(settings.reserveKwh) || 0);
    const estimatedSurplus = Math.max(0, usableForecast - expectedRemainingLoad - reserveKwh);
    const solcastGap = solcastToday > 0 ? Math.max(0, estimatedSurplus - soldToday) : 0;
    const learningReady = (this.asNumber(learning.recorded_hours) || 0) >= 24;
    const soc = this.asNumber(this.state(this.entity("sensor", "battery_soc"))) || 0;
    const batteryCapacityKwh = Math.max(0.1, this.asNumber(settings.batteryCapacityKwh) || 10);
    const batteryEfficiency = Math.max(0.5, Math.min(1, (this.asNumber(settings.batteryEfficiency) || 90) / 100));
    const storedEnergyKwh = batteryCapacityKwh * Math.max(0, Math.min(100, soc)) / 100;
    const protectedEnergyKwh = batteryCapacityKwh * Math.max(0, Math.min(100, this.asNumber(settings.minSoc) || 0)) / 100;
    const usableBatteryKwh = Math.max(0, storedEnergyKwh - protectedEnergyKwh - reserveKwh) * batteryEfficiency;
    const targetEnergyKwh = batteryCapacityKwh * Math.max(0, Math.min(100, this.asNumber(settings.targetSoc) || 0)) / 100;
    const chargeNeedKwh = Math.max(0, targetEnergyKwh - storedEnergyKwh - Math.max(0, usableForecast - expectedRemainingLoad));
    const sellableEnergyKwh = estimatedSurplus + (settings.allowBatterySell ? usableBatteryKwh : 0);
    const predictedSoc = this.asNumber(profileByHour.get((currentHour + 1) % 24)?.soc_avg);
    const predictedSocTrend = estimatedSurplus > 1 ? "wzrost" : usableForecast < expectedRemainingLoad ? "spadek" : "stabilny";
    return {
      bestSell,
      cheapBuy,
      settings,
      activeConfigured,
      solcastToday,
      solcastRemaining,
      usableForecast,
      dailyPv,
      forecastCorrection,
      solcastGap,
      learning,
      learningReady,
      profileByHour,
      sellRanking,
      expectedRemainingLoad,
      expectedRemainingPv,
      estimatedSurplus,
      predictedSocTrend,
      predictedSoc,
      soc,
      batteryCapacityKwh,
      batteryEfficiency,
      storedEnergyKwh,
      usableBatteryKwh,
      chargeNeedKwh,
      sellableEnergyKwh,
    };
  }

  aiBestWindow(prices, length, threshold, maximize, excluded = new Set(), ranking = prices) {
    let best = null;
    for (let start = 0; start < 24; start += 1) {
      const hours = Array.from({ length }, (_, index) => (start + index) % 24);
      if (hours.some((hour) => excluded.has(hour) || !prices.has(hour))) continue;
      const values = hours.map((hour) => prices.get(hour));
      if (maximize && values.some((value) => value < threshold)) continue;
      if (!maximize && values.some((value) => value > threshold)) continue;
      const scoreValues = hours.map((hour) => ranking.get(hour) ?? prices.get(hour));
      const score = scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length;
      if (!best || (maximize ? score > best.score : score < best.score)) best = { hours, score };
    }
    return best;
  }

  aiProposal(slots) {
    const ai = this.aiSuggestions(slots);
    const settings = ai.settings;
    const sellPrices = this.readPriceMap(this.entity("sensor", ["sell_price_today", "energy_price"]));
    const buyPrices = this.readPriceMap(this.entity("sensor", "buy_price_today"));
    const maxSellPower = Math.min(
      Math.max(100, this.asNumber(settings.maxSellPower) || 0),
      Math.max(100, this.asNumber(settings.gridExportLimit) || this.asNumber(settings.maxSellPower) || 0),
    );
    const maxSellKw = maxSellPower / 1000;
    const learnedSellLength = ai.learningReady ? Math.min(4, Math.max(0, Math.ceil(ai.sellableEnergyKwh / maxSellKw))) : null;
    const defaultSellLength = settings.strategy === "profit" ? 3 : settings.strategy === "autoconsumption" ? 1 : 2;
    const sellLength = learnedSellLength === null ? defaultSellLength : learnedSellLength;
    const chargeRateKwh = Math.max(0.5, ai.batteryCapacityKwh * 0.25);
    const buyLength = settings.strategy === "autoconsumption" ? 0 : Math.min(4, Math.ceil(ai.chargeNeedKwh / chargeRateKwh));
    const batterySellAvailable = ai.soc > (this.asNumber(settings.minSoc) || 0);
    const sellThreshold = settings.prices ? (this.asNumber(settings.minSellPrice) ?? 0) : Number.NEGATIVE_INFINITY;
    const sellWindow = settings.allowBatterySell && sellLength > 0 && (ai.sellableEnergyKwh > 0 || (settings.strategy === "profit" && batterySellAvailable))
      ? this.aiBestWindow(sellPrices, sellLength, sellThreshold, true, new Set(), ai.sellRanking)
      : null;
    const sellHours = new Set(sellWindow?.hours || []);
    const buyWindow = settings.allowGridCharge && settings.prices && buyLength
      ? this.aiBestWindow(buyPrices, buyLength, this.asNumber(settings.maxBuyPrice) ?? Number.POSITIVE_INFINITY, false, sellHours)
      : null;
    const buyHours = new Set(buyWindow?.hours || []);
    const sellAllocations = new Map();
    let remainingSellKwh = Math.max(0, ai.sellableEnergyKwh);
    [...sellHours]
      .sort((a, b) => (sellPrices.get(b) || 0) - (sellPrices.get(a) || 0))
      .forEach((hour) => {
        const energy = Math.min(maxSellKw, remainingSellKwh);
        sellAllocations.set(hour, energy);
        remainingSellKwh = Math.max(0, remainingSellKwh - energy);
      });
    let projectedStoredKwh = Math.min(
      ai.batteryCapacityKwh,
      ai.storedEnergyKwh + ai.estimatedSurplus * ai.batteryEfficiency,
    );
    const confidence = Math.max(25, Math.min(95,
      (ai.learningReady ? 65 : 40)
      + (ai.settings.forecastEnabled ? 10 : 0)
      - Math.abs(1 - ai.forecastCorrection) * 35,
    ));
    const rows = slots.map(([key, label]) => {
      const hour = Number(key.slice(0, 2));
      if (sellHours.has(hour)) {
        const energyKwh = Math.max(0, sellAllocations.get(hour) || 0);
        const sellPower = Math.round(Math.min(maxSellPower, energyKwh * 1000));
        projectedStoredKwh = Math.max(0, projectedStoredKwh - (energyKwh / ai.batteryEfficiency));
        return {
        key, label, enabled: true, mode: "Selling First", chargeEnabled: false,
        sellPower, dischargeCurrent: settings.maxDischargeCurrent,
        chargeCurrent: 0, gridChargeCurrent: 0, minSoc: settings.minSoc, minSellPrice: settings.minSellPrice,
        energyKwh, projectedSoc: Math.max(Number(settings.minSoc) || 0, projectedStoredKwh / ai.batteryCapacityKwh * 100),
        estimatedRevenue: energyKwh * (sellPrices.get(hour) || 0), confidence,
      };
      }
      if (buyHours.has(hour)) {
        const chargeEnergyKwh = Math.min(chargeRateKwh, ai.chargeNeedKwh / Math.max(1, buyHours.size));
        projectedStoredKwh = Math.min(ai.batteryCapacityKwh, projectedStoredKwh + chargeEnergyKwh * ai.batteryEfficiency);
        return {
        key, label, enabled: true, mode: "Charge", chargeEnabled: true,
        sellPower: 0, dischargeCurrent: 0, chargeCurrent: settings.maxChargeCurrent,
        gridChargeCurrent: settings.maxGridChargeCurrent, minSoc: settings.targetSoc, minSellPrice: 0,
        energyKwh: chargeEnergyKwh, projectedSoc: projectedStoredKwh / ai.batteryCapacityKwh * 100,
        estimatedRevenue: -chargeEnergyKwh * (buyPrices.get(hour) || 0), confidence,
      };
      }
      return { key, label, enabled: false, mode: "Wy&#322;&#261;czone", chargeEnabled: false };
    });
    const segmentCount = rows.reduce((count, row, index) => {
      if (index === 0) return 1;
      const previous = rows[index - 1];
      return count + ((row.enabled !== previous.enabled || row.mode !== previous.mode) ? 1 : 0);
    }, 0);
    return { rows, segmentCount, sellWindow, buyWindow };
  }

  async applyAiProposal(slots) {
    const proposal = this.aiProposal(slots);
    const selected = this._aiProposalSelection instanceof Set ? this._aiProposalSelection : new Set();
    const rows = proposal.rows.filter((row) => selected.has(row.key));
    if (!rows.length) return;
    if (!window.confirm(`Zastosowa\u0107 propozycj\u0119 AI dla ${rows.length} wybranych godzin? Pozosta\u0142e godziny nie zostan\u0105 zmienione.`)) return;
    for (const row of rows) {
      const entities = this.slotEntities(row.key, row.label);
      if (this.exists(entities.sellEnabled)) await this.callService("switch", row.enabled ? "turn_on" : "turn_off", { entity_id: entities.sellEnabled });
      if (this.exists(entities.chargeEnabled)) await this.callService("switch", row.chargeEnabled ? "turn_on" : "turn_off", { entity_id: entities.chargeEnabled });
      if (!row.enabled) continue;
      if (this.exists(entities.mode)) await this.callService("select", "select_option", { entity_id: entities.mode, option: row.mode });
      const numbers = [
        [entities.sellPower, row.sellPower], [entities.dischargeCurrent, row.dischargeCurrent],
        [entities.chargeCurrent, row.chargeCurrent], [entities.gridChargeCurrent, row.gridChargeCurrent],
        [entities.minSoc, row.minSoc], [entities.minSellPrice, row.minSellPrice],
      ];
      for (const [entityId, value] of numbers) {
        if (this.exists(entityId)) await this.callService("number", "set_value", { entity_id: entityId, value: Number(value) || 0 });
      }
    }
    await this.startSell();
    this.saveAiAnalysis(this.aiSuggestions(slots), "accepted", { segmentCount: proposal.segmentCount, accepted: true, selectedHours: rows.map((row) => row.label) });
    this._dialog = null;
    this.render();
  }

  renderAnalysisDetails(item) {
    const strategy = {
      balanced: "Zrównoważony",
      profit: "Maksymalny zysk",
      autoconsumption: "Maksymalna autokonsumpcja",
    }[item.strategy] || item.strategy || "Brak danych";
    const priceRows = (rows, empty) => Array.isArray(rows) && rows.length
      ? rows.map(([hour, price]) => `<li><strong>${this.hourLabel(hour)}</strong><span>${this.formatPrice(price)} PLN/kWh</span></li>`).join("")
      : `<li><span>${empty}</span></li>`;
    const sellRows = priceRows(item.bestSell, "Brak godzin spełniających warunki sprzedaży");
    const buyRows = priceRows(item.cheapBuy, "Brak godzin spełniających warunki zakupu");
    const applied = item.event === "accepted" || item.accepted
      ? "Zastosowana ręcznie"
      : item.event === "daily_summary" ? "Podsumowanie dnia" : "Nie zastosowano";
    const reason = item.event === "daily_summary"
      ? "Podsumowanie zebranych danych dobowych."
      : item.strategy === "profit"
        ? "Wybrano godziny o najwyższych cenach sprzedaży i najniższych cenach zakupu."
        : item.strategy === "autoconsumption"
          ? "Priorytetem jest wykorzystanie energii w domu i ograniczenie poboru z sieci."
          : "Sugestia równoważy ceny energii, prognozę PV, zużycie domu i rezerwę magazynu.";
    const outcome = item.outcome
      ? `${this.formatNumber(item.outcome.sold_kwh, 2)} kWh / ${this.formatNumber(item.outcome.sold_value, 2)} PLN, trafność PV ${this.formatNumber(item.outcome.pv_accuracy_percent, 0)}%`
      : item.rating ? `Ocena użytkownika: ${item.rating}/5` : "Brak zakończonego wyniku";
    const correction = this.asNumber(item.forecastCorrection);
    const predictedSoc = this.asNumber(item.predictedSoc);
    const maxSellPower = this.asNumber(item.maxSellPower);
    const minSoc = this.asNumber(item.minSoc);
    return `<div class="analysis-details">
      <div class="analysis-detail-grid">
        <div><span>Status</span><strong>${applied}</strong></div>
        <div><span>Strategia</span><strong>${strategy}</strong></div>
        <div><span>Maks. moc sprzedaży</span><strong>${maxSellPower === null ? "Brak danych" : `${this.formatNumber(maxSellPower, 0)} W`}</strong></div>
        <div><span>Minimalny SOC</span><strong>${minSoc === null ? "Brak danych" : `${this.formatNumber(minSoc, 0)}%`}</strong></div>
        <div><span>Prognoza Solcast</span><strong>${this.formatNumber(item.solcastToday, 2)} kWh</strong></div>
        <div><span>Pozostała prognoza</span><strong>${this.formatNumber(item.solcastRemaining, 2)} kWh</strong></div>
        <div><span>Rzeczywista produkcja PV</span><strong>${this.formatNumber(item.dailyPv, 2)} kWh</strong></div>
        <div><span>Korekta prognozy</span><strong>${correction === null ? "Brak danych" : `${this.formatNumber(correction * 100, 0)}%`}</strong></div>
        <div><span>Przewidywane zużycie domu</span><strong>${this.formatNumber(item.expectedRemainingLoad, 2)} kWh</strong></div>
        <div><span>Szacowana nadwyżka</span><strong>${this.formatNumber(item.estimatedSurplus, 2)} kWh</strong></div>
        <div><span>Prognozowany SOC</span><strong>${predictedSoc === null ? "Brak danych" : `${this.formatNumber(predictedSoc, 0)}%`}</strong></div>
        <div><span>Trend magazynu</span><strong>${item.predictedSocTrend || "Brak danych"}</strong></div>
      </div>
      <div class="analysis-price-groups">
        <section><h4>Najlepsze godziny sprzedaży</h4><ul>${sellRows}</ul></section>
        <section><h4>Najtańsze godziny zakupu</h4><ul>${buyRows}</ul></section>
      </div>
      <div class="analysis-explanation"><span>Powód sugestii</span><strong>${reason}</strong></div>
      <div class="analysis-explanation"><span>Wynik i skuteczność</span><strong>${outcome}</strong></div>
    </div>`;
  }

  renderHistoryTab() {
    const data = this.historyData();
    const filters = this._historyFilters || { from: "", to: "", type: "all" };
    const inRange = (date) => (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
    const analyses = this.filteredAnalyses();
    const daily = data.daily.filter((item) => inRange(String(item.date || "")));
    const monthly = data.monthly.filter((item) => inRange(`${item.month || ""}-01`));
    const eventLabel = (event) => ({ suggestion: "Sugestia", accepted: "Zaakceptowana", daily_summary: "Podsumowanie dnia" }[event] || event || "Sugestia");
    const analysisRows = analyses.length ? analyses.map((item) => {
      const date = new Date(Number(item.timestamp) || item.date || 0);
      const dateLabel = Number.isNaN(date.getTime()) ? (item.date || "brak") : date.toLocaleString("pl-PL");
      const sell = item.bestSell?.[0] ? `${this.hourLabel(item.bestSell[0][0])} · ${this.formatPrice(item.bestSell[0][1])} PLN` : "brak";
      const outcome = item.event === "daily_summary" ? `Trafno&#347;&#263; ${this.formatNumber(item.accuracy_percent, 1)}%` : item.outcome ? `${this.formatNumber(item.outcome.sold_kwh, 2)} kWh / ${this.formatNumber(item.outcome.sold_value, 2)} PLN · PV ${this.formatNumber(item.outcome.pv_accuracy_percent, 0)}%` : item.rating ? `Ocena ${item.rating}/5` : item.event === "accepted" ? "Oczekuje na wynik dnia" : "Nie zastosowano";
      const rating = item.event === "accepted" || item.event === "suggestion" ? `<span class="history-rating">${[1,2,3,4,5].map((value) => `<button data-rate-history="${item.timestamp}" data-rating="${value}" class="${Number(item.rating) === value ? "active" : ""}">${value}</button>`).join("")}</span>` : "";
      return `<tr><td>${dateLabel}</td><td>${eventLabel(item.event)}</td><td>${sell}</td><td>${outcome}<br>${rating}</td><td></td></tr>
        <tr class="analysis-detail-row"><td colspan="5"><details class="analysis-record"><summary>Szczeg&#243;&#322;y</summary>${this.renderAnalysisDetails(item)}</details></td></tr>`;
    }).join("") : `<tr><td colspan="5">Brak rekord&#243;w dla wybranych filtr&#243;w</td></tr>`;
    const dailyRows = daily.length ? daily.map((item) => `<tr><td>${item.date}</td><td>${this.formatNumber(item.forecast_kwh, 2)}</td><td>${this.formatNumber(item.actual_kwh ?? item.pv_kwh, 2)}</td><td>${this.formatNumber(item.accuracy_percent, 1)}%</td><td>${this.formatNumber(item.load_kwh, 2)}</td><td>${this.formatNumber(item.battery_charge_kwh, 2)} / ${this.formatNumber(item.battery_discharge_kwh, 2)}</td><td>${this.formatNumber(item.sold_kwh, 2)} / ${this.formatNumber(item.sold_value, 2)} PLN</td></tr>`).join("") : `<tr><td colspan="7">Brak podsumowa&#324; dziennych</td></tr>`;
    const monthlyRows = monthly.length ? monthly.map((item) => `<tr><td>${item.month}</td><td>${item.days}</td><td>${this.formatNumber(item.pv_kwh, 1)}</td><td>${this.formatNumber(item.load_kwh, 1)}</td><td>${this.formatNumber(item.grid_import_kwh, 1)} / ${this.formatNumber(item.grid_export_kwh, 1)}</td><td>${this.formatNumber(item.sold_kwh, 1)} / ${this.formatNumber(item.sold_value, 2)} PLN</td></tr>`).join("") : `<tr><td colspan="6">Brak podsumowa&#324; miesi&#281;cznych</td></tr>`;
    return `<div class="history-toolbar">
      <label>Od<input type="date" data-history-filter="from" value="${filters.from || ""}"></label>
      <label>Do<input type="date" data-history-filter="to" value="${filters.to || ""}"></label>
      <label>Typ<select data-history-filter="type"><option value="all">Wszystkie</option><option value="suggestion" ${filters.type === "suggestion" ? "selected" : ""}>Sugestie</option><option value="accepted" ${filters.type === "accepted" ? "selected" : ""}>Zaakceptowane</option><option value="daily_summary" ${filters.type === "daily_summary" ? "selected" : ""}>Podsumowania dnia</option></select></label>
      <button data-export-history="csv">Eksport CSV</button><button data-export-history="json">Eksport JSON</button><button data-export-monthly="1">Raport miesi&#281;czny</button>
    </div>
    <section class="history-section"><h3>Prognoza i rzeczywista produkcja</h3><div class="history-scroll"><table class="settings-table"><thead><tr><th>Data</th><th>Prognoza kWh</th><th>Produkcja kWh</th><th>Trafno&#347;&#263;</th><th>Dom kWh</th><th>&#321;ad./roz&#322;. kWh</th><th>Sprzeda&#380;</th></tr></thead><tbody>${dailyRows}</tbody></table></div></section>
    <section class="history-section"><h3>Wcze&#347;niejsze sugestie i skuteczno&#347;&#263;</h3><div class="history-scroll analysis-history-scroll"><table class="settings-table analysis-history-table"><thead><tr><th>Data</th><th>Typ</th><th>Najlepsza sprzeda&#380;</th><th>Wynik / ocena</th><th>Rekord</th></tr></thead><tbody>${analysisRows}</tbody></table></div></section>
    <section class="history-section"><h3>Podsumowania miesi&#281;czne</h3><div class="history-scroll"><table class="settings-table"><thead><tr><th>Miesi&#261;c</th><th>Dni</th><th>PV kWh</th><th>Dom kWh</th><th>Import / eksport</th><th>Sprzeda&#380;</th></tr></thead><tbody>${monthlyRows}</tbody></table></div></section>
    <button class="danger-action" data-clear-all-history="1">Wyczy&#347;&#263; histori&#281; i dane</button>`;
  }

  renderDialog(slots, touStarts) {
    if (!this._dialog) return "";

    if (this._dialog.type === "settings") {
      const tab = this._settingsTab || "defaults";
      const tabButton = (key, label) => `<button class="${tab === key ? "active" : ""}" data-settings-tab="${key}">${label}</button>`;
      const touRows = [1, 2, 3, 4, 5, 6].map((idx) => {
        const tou = this.touEntities(idx);
        const end = touStarts[idx % 6] || "00:00";
        const start = this.state(tou.start, "00:00:00").slice(0, 5);
        return `<tr>
          <td>${idx}</td><td>${start}</td><td>${end}</td><td>${this.numberState(tou.soc)}%</td>
          <td>${this.numberState(tou.gridCurrent)} A</td><td>${this.pill(tou.grid)}</td>
          <td><button class="set-btn" data-open-tou="${idx}">Edytuj</button></td>
        </tr>`;
      }).join("");
      const aiSettings = this.aiSettings();
      const segments = this.scheduleSegments(slots);
      const segmentRows = segments.map((item, index) => `<tr>
        <td>${index + 1}</td>
        <td>${String(item.start).padStart(2, "0")}:00</td>
        <td>${String(item.end).padStart(2, "0")}:00</td>
        <td>${item.chargeMode ? "Charge" : "Limit SOC"}</td>
        <td>${item.chargeEnabled ? "tak" : "nie"}</td>
        <td>${item.minSoc}%</td>
      </tr>`).join("");

      let body = "";
      if (tab === "defaults") {
        const physicalMode = this.normalProfilePhysicalMode();
        const physicalOptions = this.inverterWorkModes().map((mode) => [mode, mode]);
        const chargeProfile = this.chargeProfileStoredValues();
        body = `
          <h3>Ustawienia domy</h3>
          <div class="hint">Warto&#347;ci u&#380;ywane, gdy &#380;aden slot harmonogramu nie jest aktywny lub manager jest zatrzymany.</div>
          ${this.row("Domy&#347;lny tryb falownika", this.rawSelect("default-work-mode", physicalOptions, physicalMode))}
          ${this.row("Domy&#347;lna moc sprzeda&#380;y", this.defaultSettingsInput("sell_power", this.entity("number", "default_sell_power"), "W"))}
          ${this.row("Domy&#347;lny pr&#261;d roz&#322;adowania", this.defaultSettingsInput("discharge_current", this.entity("number", "default_discharge_current"), "A"))}
          ${this.row("Domy&#347;lny pr&#261;d &#322;adowania baterii", this.defaultSettingsInput("charge_current", this.entity("number", "default_charge_current"), "A"))}
          ${this.row("Domy&#347;lny pr&#261;d &#322;adowania z sieci", this.defaultSettingsInput("grid_charge_current", this.entity("number", "default_grid_charge_current"), "A"))}
          ${this.row("Minimalny SOC sprzeda&#380;y", this.defaultSettingsInput("minimum_sell_soc", this.entity("number", "minimum_sell_soc"), "%"))}
          <button class="wide-action" data-save-default-settings="1">Zapisz ustawienia domy&#347;lne</button>
          <button class="wide-action" data-default-action="1" ${this._defaultsApplying ? "disabled" : ""}>Zastosuj ustawienia domy&#347;lne teraz</button>
          <h3>Ustawienia normalnej pracy</h3>
          <div class="hint">Te warto&#347;ci s&#261; kopiowane do slotu, gdy harmonogram wybierze tryb "Normalna Praca".</div>
          ${this.row("Fizyczny tryb falownika", this.rawSelect("normal-profile-mode", physicalOptions, physicalMode))}
          ${this.row("Moc sprzeda&#380;y", this.normalProfileInput("sell_power", this.entity("number", "normal_profile_sell_power"), "W"))}
          ${this.row("Pr&#261;d roz&#322;adowania", this.normalProfileInput("discharge_current", this.entity("number", "normal_profile_discharge_current"), "A"))}
          ${this.row("Pr&#261;d &#322;adowania", this.normalProfileInput("charge_current", this.entity("number", "normal_profile_charge_current"), "A"))}
          ${this.row("Pr&#261;d &#322;adowania z sieci", this.normalProfileInput("grid_charge_current", this.entity("number", "normal_profile_grid_charge_current"), "A"))}
          ${this.row("Minimalny SOC", this.normalProfileInput("tou_soc", this.entity("number", "normal_profile_tou_soc"), "%"))}
          <button class="wide-action" data-save-normal-profile="1">Zapisz profil Normalnej Pracy</button>
          <button class="wide-action" data-reload-normal-profile="current">Przeładuj do aktywnego slotu</button>
          <h3>Ustawienia profilu Charge</h3>
          <div class="hint">Szablon u&#380;ywany, gdy slot harmonogramu ma tryb Charge. Warto&#347;ci pocz&#261;tkowe skopiowano z ostatniego profilu.</div>
          ${this.row("Pr&#261;d &#322;adowania", this.chargeProfileInput("charge_current", this.entity("number", "charge_profile_charge_current"), "A"))}
          ${this.row("Pr&#261;d roz&#322;adowania", this.chargeProfileInput("discharge_current", this.entity("number", "charge_profile_discharge_current"), "A"))}
          ${this.row("Pr&#261;d &#322;adowania z sieci", this.chargeProfileInput("grid_charge_current", this.entity("number", "charge_profile_grid_charge_current"), "A"))}
          ${this.row("Docelowy SOC", this.chargeProfileInput("target_soc", this.entity("number", "charge_profile_target_soc"), "%"))}
          ${this.row("&#321;adowanie z sieci", this.pill(this.entity("switch", "charge_profile_grid_charge_enabled"), chargeProfile.grid_charge_enabled ? "TAK" : "NIE"))}
          <button class="wide-action" data-save-charge-profile="1">Zapisz profil Charge</button>`;
      } else if (tab === "tou") {
        body = `<div class="hint">Sze&#347;&#263; fizycznych slot&#243;w Deye. Zakres ko&#324;czy si&#281; na starcie nast&#281;pnego slotu.</div>
          <table class="settings-table"><thead><tr><th>Slot</th><th>Od</th><th>Do</th><th>SOC</th><th>Pr&#261;d</th><th>&#321;adowanie z sieci</th><th>Akcja</th></tr></thead><tbody>${touRows}</tbody></table>`;
      } else if (tab === "mapping") {
        body = `<div class="hint">${this.mapWarning(slots)}. Harmonogram 24h jest kompresowany do zakres&#243;w zgodnych z 6 slotami Deye.</div>
          <table class="settings-table"><thead><tr><th>Slot Deye</th><th>Od</th><th>Do</th><th>Funkcja</th><th>Grid</th><th>SOC</th></tr></thead><tbody>${segmentRows}</tbody></table>`;
      } else if (tab === "ai") {
        body = `
          <div class="hint">AI w 0.7.6 analizuje dane i pokazuje sugestie. Nie zmienia harmonogramu automatycznie.</div>
          ${this.aiCheck("enabled", "W&#322;&#261;cz inteligentne planowanie", aiSettings.enabled)}
          ${this.aiSelect("mode", "Tryb dzia&#322;ania", [["proposal", "Tylko sugestie"], ["manual", "Sugestie + r&#281;czne zatwierdzenie"], ["future_auto", "Automatyka w przysz&#322;o&#347;ci"]], aiSettings.mode)}
          ${this.aiSelect("strategy", "Priorytet", [["balanced", "Zr&#243;wnowa&#380;ony"], ["profit", "Maksymalny zysk"], ["autoconsumption", "Maksymalna autokonsumpcja"]], aiSettings.strategy)}
          ${this.aiCheck("forecastEnabled", "Uwzgl&#281;dniaj prognoz&#281; Solcast", aiSettings.forecastEnabled)}
          ${this.aiNumber("forecastMargin", "Margines bezpiecze&#324;stwa prognozy", aiSettings.forecastMargin, "%")}
          ${this.aiCheck("realPv", "Por&#243;wnuj z realn&#261; produkcj&#261; PV", aiSettings.realPv)}
          ${this.aiCheck("history", "Uwzgl&#281;dniaj histori&#281; produkcji i sprzeda&#380;y", aiSettings.history)}
          ${this.aiCheck("prices", "Uwzgl&#281;dniaj ceny energii", aiSettings.prices)}
          ${this.aiNumber("minSellPrice", "Minimalna cena sprzeda&#380;y", aiSettings.minSellPrice, "PLN")}
          ${this.aiNumber("maxBuyPrice", "Maksymalna cena zakupu", aiSettings.maxBuyPrice, "PLN")}
          ${this.aiNumber("minSoc", "Minimalny SOC", aiSettings.minSoc, "%")}
          ${this.aiNumber("targetSoc", "Docelowy SOC magazynu", aiSettings.targetSoc, "%")}
          ${this.aiNumber("batteryCapacityKwh", "Pojemno&#347;&#263; u&#380;ytkowa magazynu", aiSettings.batteryCapacityKwh, "kWh")}
          ${this.aiNumber("batteryEfficiency", "Sprawno&#347;&#263; magazynu", aiSettings.batteryEfficiency, "%")}
          ${this.aiNumber("reserveKwh", "Rezerwa energii w magazynie", aiSettings.reserveKwh, "kWh")}
          ${this.aiNumber("maxSellPower", "Maksymalna moc sprzeda&#380;y", aiSettings.maxSellPower, "W")}
          ${this.aiNumber("gridExportLimit", "Limit oddawania do sieci", aiSettings.gridExportLimit, "W")}
          ${this.aiNumber("maxDischargeCurrent", "Limit pr&#261;du roz&#322;adowania", aiSettings.maxDischargeCurrent, "A")}
          ${this.aiNumber("maxChargeCurrent", "Limit pr&#261;du &#322;adowania", aiSettings.maxChargeCurrent, "A")}
          ${this.aiNumber("maxGridChargeCurrent", "Limit pr&#261;du &#322;adowania z sieci", aiSettings.maxGridChargeCurrent, "A")}
          ${this.aiCheck("allowGridCharge", "AI mo&#380;e sugerowa&#263; &#322;adowanie z sieci", aiSettings.allowGridCharge)}
           ${this.aiCheck("allowBatterySell", "AI mo&#380;e sugerowa&#263; sprzeda&#380; z baterii", aiSettings.allowBatterySell)}
           ${this.aiCheck("allowDeyeMode", "AI mo&#380;e sugerowa&#263; zmian&#281; trybu Deye", aiSettings.allowDeyeMode)}`;
      } else if (tab === "history") {
        body = this.renderHistoryTab();
      } else if (tab === "system") {
        body = this.renderDiagnostics(slots);
      }

      return `<div class="overlay" data-close-dialog="1">
        <section class="dialog settings-dialog" data-dialog-box="1">
          <div class="dialog-head"><strong>Ustawienia i diagnostyka</strong><button type="button" data-close-dialog="1">${this.iconSvg("close")}</button></div>
          <div class="settings-layout">
            <nav class="settings-nav">
              ${tabButton("defaults", "Ustawienia Trybów pracy")}
              ${tabButton("tou", "Deye Time Of Use")}
              ${tabButton("mapping", "Mapowanie 24h")}
              ${tabButton("ai", "AI i analiza")}
              ${tabButton("history", "Historia i dane")}
              ${tabButton("system", "System i diagnostyka")}
            </nav>
            <div class="settings-content">${body}</div>
          </div>
        </section>
      </div>`;
    }

    if (this._dialog.type === "ai") {
      const ai = this.aiSuggestions(slots);
      const proposal = this.aiProposal(slots);
      if (!(this._aiProposalSelection instanceof Set)) {
        this._aiProposalSelection = new Set(proposal.rows.filter((row) => row.enabled).map((row) => row.key));
      }
      const sellRows = ai.bestSell.length ? ai.bestSell.map(([hour, price]) => `<li>${this.hourLabel(hour)}: ${this.formatPrice(price)} PLN/kWh</li>`).join("") : "<li>Brak danych cen sprzeda&#380;y</li>";
      const buyRows = ai.cheapBuy.length ? ai.cheapBuy.map(([hour, price]) => `<li>${this.hourLabel(hour)}: ${this.formatPrice(price)} PLN/kWh</li>`).join("") : "<li>Brak danych cen zakupu</li>";
      const strategyLabel = { balanced: "Zr&#243;wnowa&#380;ony", profit: "Maksymalny zysk", autoconsumption: "Maksymalna autokonsumpcja" }[ai.settings.strategy] || ai.settings.strategy;
      const correction = ai.forecastCorrection ? `${Math.round(ai.forecastCorrection * 100)}%` : "brak danych";
      const selectedProposalCount = proposal.rows.filter((row) => this._aiProposalSelection.has(row.key)).length;
      const proposalRows = proposal.rows.map((row) => `<tr>
        <td><input type="checkbox" data-ai-proposal-slot="${row.key}" ${this._aiProposalSelection.has(row.key) ? "checked" : ""}></td>
        <td>${row.label}</td><td>${this.modePill(row.mode, row.enabled)}</td>
        <td>${row.enabled ? `${row.sellPower || 0} W` : "-"}</td>
        <td>${row.enabled ? `${row.dischargeCurrent || 0} A` : "-"}</td>
        <td>${row.enabled ? `${row.chargeCurrent || 0} A` : "-"}</td>
        <td>${row.enabled ? `${row.minSoc || 0}%` : "-"}</td>
        <td>${row.enabled ? this.formatEnergy(row.energyKwh || 0) : "-"}</td>
        <td>${row.enabled ? `${this.formatNumber(row.projectedSoc, 1)}%` : "-"}</td>
        <td>${row.enabled ? `${this.formatNumber(row.estimatedRevenue, 2)} PLN` : "-"}</td>
        <td>${row.enabled ? `${this.formatNumber(row.confidence, 0)}%` : "-"}</td>
      </tr>`).join("");
      const proposalReady = Boolean(proposal.sellWindow || proposal.buyWindow) && proposal.segmentCount <= 6;
      const proposalStatus = !proposalReady
        ? "Brak godzin spe&#322;niaj&#261;cych ustawione progi cenowe."
        : proposal.segmentCount > 6 ? `Propozycja wymaga ${proposal.segmentCount} zakres&#243;w, limit Deye wynosi 6.` : `Gotowe: ${proposal.segmentCount}/6 zakres&#243;w Deye.`;
      return `<div class="overlay" data-close-dialog="1">
        <!-- AI navigation: Przegląd, Proponowane zmiany, Plan na dziś, Plan na jutro, Plan energii 48h, Jakość danych -->
        <!-- AI controls: Zaznacz wszystkie, Odznacz wszystkie, Pełne 24h, save_future_plan, cancel_future_plan -->
        <!-- AI chart labels: Produkcja rzeczywista, Prognoza Solcast, Prognoza skorygowana, Przedział prognozy, data-ai-chart-point, data-ai-weather-mode, aiReadableEnergyChart, aiReadableDayChart, ai-crisp-weather-grid, data-ai-chart-series, ai-readable-weather, ai-status-sell, ai-status-charge, ai-status-tariff -->
        <section class="dialog ai-dialog" data-dialog-box="1">
          <div class="dialog-head"><strong>Sugestie AI</strong><button type="button" data-close-dialog="1">${this.iconSvg("close")}</button></div>
          <div class="dialog-body ai-grid">
            <div class="ai-card"><h3>Najlepsze godziny sprzeda&#380;y</h3><ul>${sellRows}</ul></div>
            <div class="ai-card"><h3>Najta&#324;sze godziny zakupu</h3><ul>${buyRows}</ul></div>
            <div class="ai-card"><h3>Solcast, PV i magazyn</h3><p>Dzisiaj: ${this.formatEnergy(ai.solcastToday)}<br>Pozosta&#322;o: ${this.formatEnergy(ai.solcastRemaining)}<br>Realna produkcja: ${this.formatEnergy(ai.dailyPv)}<br>Historyczna korekta: ${correction}<br>Prognozowana nadwy&#380;ka PV: ${this.formatEnergy(ai.estimatedSurplus)}<br>Pojemno&#347;&#263; magazynu: ${this.formatEnergy(ai.batteryCapacityKwh)}<br>Energia w magazynie: ${this.formatEnergy(ai.storedEnergyKwh)}<br>Dost&#281;pne do sprzeda&#380;y: ${this.formatEnergy(ai.sellableEnergyKwh)}<br>Brakuj&#261;ce do celu: ${this.formatEnergy(ai.chargeNeedKwh)}</p></div>
            <div class="ai-card"><h3>Profil energetyczny</h3><p>Dane: ${ai.learningReady ? "gotowe" : "trwa uczenie"}<br>Zapisane dni: ${ai.learning?.recorded_days || 0}<br>Zapisane godziny: ${ai.learning?.recorded_hours || 0}<br>Typowe zu&#380;ycie domu: ${this.formatEnergy(ai.learning?.typical_daily_load_kwh)}<br>Pozosta&#322;e zu&#380;ycie dzisiaj: ${this.formatEnergy(ai.expectedRemainingLoad)}<br>Typowy SOC nast&#281;pnej godziny: ${ai.predictedSoc === null ? "brak" : `${ai.predictedSoc.toFixed(1)}%`}<br>Kierunek SOC: ${ai.predictedSocTrend}</p></div>
            <div class="ai-card"><h3>Harmonogram</h3><p>Priorytet: ${strategyLabel}<br>Aktywne godziny: ${ai.activeConfigured}<br>Limit mocy: ${ai.settings.maxSellPower} W<br>Min. SOC: ${ai.settings.minSoc}%<br>${this.mapWarning(slots)}</p></div>
            <div class="ai-card ai-proposal"><h3>Proponowany harmonogram 24h</h3><p>${proposalStatus}</p><div class="proposal-tools"><button data-ai-select-proposed="1">Zaznacz proponowane</button><button data-ai-clear-proposal="1">Odznacz wszystko</button><span>Wybrano: ${selectedProposalCount}</span></div><div class="ai-proposal-scroll"><table class="mini-table"><thead><tr><th></th><th>Godzina</th><th>Tryb</th><th>Moc</th><th>Roz&#322;.</th><th>&#321;ad.</th><th>SOC min.</th><th>Energia</th><th>SOC po</th><th>Bilans</th><th>Pewno&#347;&#263;</th></tr></thead><tbody>${proposalRows}</tbody></table></div><button class="wide-action" data-apply-ai-proposal="1" ${!proposalReady || !selectedProposalCount ? "disabled" : ""}>Zastosuj wybrane (${selectedProposalCount})</button></div>
          </div>
        </section>
      </div>`;
    }

    if (this._dialog.type === "multi") {
      const selectedCount = this.selectedSlotList(slots).length;
      const bulk = this.bulkValues(slots);
      return `<div class="overlay" data-close-dialog="1">
        <section class="dialog multi-dialog" data-dialog-box="1">
          <div class="dialog-head"><strong>Edytuj zaznaczone godziny</strong><button type="button" data-close-dialog="1">${this.iconSvg("close")}</button></div>
          <div class="dialog-body">
            <div class="range-box">Zakres: ${this.selectedRangeText(slots)}<br>Liczba godzin: ${selectedCount}</div>
            <label class="apply-row"><input type="checkbox" data-apply-field="active" checked> Aktywne ${this.rawSelect("multi-active", [["on", "Tak"], ["off", "Nie"]], bulk.active)}</label>
            <label class="apply-row"><input type="checkbox" data-apply-field="mode" checked> Tryb pracy ${this.rawSelect("multi-mode", this.slotWorkModes(), bulk.mode)}</label>
            <label class="apply-row"><input type="checkbox" data-apply-field="sellPower" checked> Moc sprzeda&#380;y ${this.rawNumber("multi-sell-power", bulk.sellPower, "W")}</label>
            <label class="apply-row"><input type="checkbox" data-apply-field="dischargeCurrent" checked> Pr&#261;d roz&#322;adowania ${this.rawNumber("multi-discharge-current", bulk.dischargeCurrent, "A")}</label>
            <label class="apply-row"><input type="checkbox" data-apply-field="chargeCurrent" checked> Pr&#261;d &#322;adowania ${this.rawNumber("multi-charge-current", bulk.chargeCurrent, "A")}</label>
            <label class="apply-row"><input type="checkbox" data-apply-field="gridCharge" checked> &#321;adowanie z sieci ${this.rawSelect("multi-grid-charge", [["on", "tak"], ["off", "nie"]], bulk.gridCharge)}</label>
            <label class="apply-row"><input type="checkbox" data-apply-field="gridChargeCurrent" checked> Pr&#261;d z sieci ${this.rawNumber("multi-grid-charge-current", bulk.gridChargeCurrent, "A")}</label>
            <label class="apply-row"><input type="checkbox" data-apply-field="minSoc" checked> Minimalny SOC ${this.rawNumber("multi-min-soc", bulk.minSoc, "%")}</label>
            <label class="apply-row"><input type="checkbox" data-apply-field="minSellPrice" checked> Sprzedawaj od ceny ${this.rawNumber("multi-min-sell-price", bulk.minSellPrice, "PLN")}</label>
            <div class="preview-box"><strong>Podgl&#261;d zmian</strong><br>Warto&#347;ci startowe s&#261; pobrane z pierwszej zaznaczonej godziny. Odznacz pole, kt&#243;rego nie chcesz zmienia&#263;.</div>
          </div>
          <div class="dialog-actions"><button type="button" data-close-dialog="1">Anuluj</button><button class="primary" data-apply-multi="1">Zastosuj zmiany</button></div>
        </section>
      </div>`;
    }

    if (this._dialog.type === "tou") {
      const idx = Number(this._dialog.idx);
      const tou = this.touEntities(idx);
      const endIdx = idx === 6 ? 1 : idx + 1;
      return `<div class="overlay" data-close-dialog="1">
        <section class="dialog" data-dialog-box="1">
          <div class="dialog-head"><strong>Edytuj Time Of Use - slot ${idx}</strong><button type="button" data-close-dialog="1">${this.iconSvg("close")}</button></div>
          <div class="dialog-body">
            ${this.row("Od", this.timeInput(tou.start))}
            ${this.row(`Do / start slotu ${endIdx}`, this.timeInput(tou.end))}
            ${this.row("Docelowy / minimalny SOC", this.touSocInput(tou.soc))}
            ${this.row("&#321;adowanie z sieci", this.pill(tou.grid))}
            ${this.row("Pr&#261;d &#322;adowania z sieci", this.numberInput(tou.gridCurrent, "A"))}
            <div class="hint">Je&#347;li harmonogram 24h ma tryb Charge, integracja spr&#243;buje wpisa&#263; te zakresy do slot&#243;w Deye automatycznie.</div>
          </div>
          <div class="dialog-actions"><button type="button" data-close-dialog="1">Zamknij</button></div>
        </section>
      </div>`;
    }

    const slot = slots.find(([key]) => key === this._dialog.key);
    if (!slot) return "";
    const [key, label] = slot;
    const entities = this.slotEntities(key, label);
    const mode = this.state(entities.mode, "Zero Export To Load");
    const isSelling = this.norm(mode).includes("selling");
    const isCharge = this.norm(mode).includes("charge");
    const socField = isCharge ? this.touSocInput(entities.touSoc) : this.numberInput(entities.minSoc, "%");
    const chargeNotice = isCharge ? `<div class="hint">Wartości początkowe skopiowano z profilu Charge.</div>` : "";
    const gridChargeRow = isCharge
      ? this.row("&#321;adowanie z sieci", this.exists(entities.chargeEnabled) ? this.pill(entities.chargeEnabled) : this.pill(null, "NIE"))
      : this.row("&#321;adowanie z sieci", this.slotGridChargePill(key, entities));
    return `<div class="overlay" data-close-dialog="1">
      <section class="dialog" data-dialog-box="1">
        <div class="dialog-head"><strong>Godzina ${label}</strong><button type="button" data-close-dialog="1">${this.iconSvg("close")}</button></div>
        <div class="dialog-body">
          ${chargeNotice}
          ${this.row("Aktywne", this.pill(entities.sellEnabled))}
          ${this.row("Tryb", this.selectInput(entities.mode, this.slotWorkModes()))}
          ${this.row("Moc sprzeda&#380;y", this.numberInput(entities.sellPower, "W"))}
          ${this.row("Pr&#261;d roz&#322;adowania", this.numberInput(entities.dischargeCurrent, "A"))}
          ${this.row("Pr&#261;d &#322;adowania baterii", this.numberInput(entities.chargeCurrent, "A"))}
          ${gridChargeRow}
          ${this.row("Pr&#261;d &#322;adowania z sieci", this.numberInput(entities.gridChargeCurrent, "A"))}
          ${this.row(isCharge ? "Docelowy SOC" : "Minimalny SOC", `${socField}`)}
          ${this.row("Sprzedawaj od ceny", this.numberInput(entities.minSellPrice, "PLN"))}
        </div>
        <div class="dialog-actions"><button type="button" data-close-dialog="1">Zamknij</button></div>
      </section>
    </div>`;
  }

  renderV073() {
    if (!this._hass) return;
    this.captureScrollPositions();

    const slots = this.scheduleSlots();
    const activeSlot = this.state(this.entity("sensor", "active_slot"));
    const activeSlotLabel = (slots.find(([key]) => key === activeSlot)?.[1] || activeSlot).replace(/:00/g, "");
    const [modeText, modeClass] = this.readMode(this.state(this.entity("sensor", "manager_status")));
    const currentInverterMode = this.state(this.entity("sensor", "current_work_mode"));
    const targetInverterMode = this.state(this.entity("sensor", "target_mode"));
    const decisionText = this.state(this.entity("sensor", "decision_reason"));

    const batterySoc = this.entity("sensor", "battery_soc");
    const soldEnergyToday = this.entity("sensor", "sold_energy_today");
    const soldValueToday = this.entity("sensor", "sold_value_today");
    const sellPriceToday = this.entity("sensor", ["sell_price_today", "energy_price"]);
    const sellPriceTomorrow = this.entity("sensor", "sell_price_tomorrow");
    const buyPriceToday = this.entity("sensor", "buy_price_today");
    const buyPriceTomorrow = this.entity("sensor", "buy_price_tomorrow");
    const solcastPower = this.entity("sensor", "solcast_current_power");
    const solcastToday = this.entity("sensor", "solcast_forecast_today");
    const solcastTomorrow = this.entity("sensor", "solcast_forecast_tomorrow");
    const solcastDay3 = this.entity("sensor", "solcast_forecast_day_3");
    const solcastDay4 = this.entity("sensor", "solcast_forecast_day_4");
    const solcastDay5 = this.entity("sensor", "solcast_forecast_day_5");
    const solcastDay6 = this.entity("sensor", "solcast_forecast_day_6");
    const solcastDay7 = this.entity("sensor", "solcast_forecast_day_7");
    const solcastRemaining = this.entity("sensor", "solcast_remaining_today");
    const solcastPeakPower = this.entity("sensor", "solcast_peak_power_today");
    const dailyPvProduction = this.entity("sensor", "daily_pv_production");
    const solcastAccuracy = this.entity("sensor", "solcast_accuracy");
    const minSellPrice = this.entity("number", "minimum_sell_price");
    const priceThreshold = this.asNumber(this.numberState(minSellPrice, 0)) || 0;
    const solcastEntities = [solcastToday, solcastTomorrow, solcastDay3, solcastDay4, solcastDay5, solcastDay6, solcastDay7];
    const solcastForecastValue = this.asNumber(this.state(solcastToday));
    const dailyPvValue = this.asNumber(this.state(dailyPvProduction));
    const solcastDifference = solcastForecastValue !== null && dailyPvValue !== null ? dailyPvValue - solcastForecastValue : null;
    const solcastAccuracyValue = this.asNumber(this.state(solcastAccuracy));

    const touStarts = [1, 2, 3, 4, 5, 6].map((idx) => {
      const raw = this.state(`time.deye_inverter_time_of_use_${idx}_start`, "00:00:00");
      return raw.length >= 5 ? raw.slice(0, 5) : raw;
    });

    const selectedCount = this.selectedSlotList(slots).length;
    const bulk = this.bulkValues(slots);
    const scheduleRows = slots.map(([key, label]) => {
      const entities = this.slotEntities(key, label);
      const enabled = this.displayState(entities.sellEnabled) === "on";
      const mode = this.state(entities.mode, "Zero Export To Load");
      const gridCharge = this.slotGridChargeState(key, entities) === "on";
      const isChargeMode = this.norm(mode).includes("charge");
      const gridChargeClass = gridCharge ? "on" : "off";
      const gridChargeLabel = isChargeMode ? (gridCharge ? "tak" : "nie") : "nie dotyczy";
      const gridChargeCurrent = this.numberState(entities.gridChargeCurrent);
      const selected = this._selectedSlots?.has(key);
      const meta = this.modeMeta(this.normalizeScheduleMode(mode), enabled);
      const rowClass = [
        activeSlot === key ? "active" : "",
        selected ? "selected" : "",
        enabled ? "enabled" : "disabled",
      ].filter(Boolean).join(" ");
      return `<tr class="${rowClass}" data-slot-row="${key}">
        <td class="check-col" data-label=""><label class="slot-check"><input type="checkbox" data-slot-check="${key}" ${selected ? "checked" : ""}><span></span></label></td>
        <td data-label="Godzina" class="time-col">${label.replace(/:00/g, "")}</td>
        <td data-label="Tryb">${this.modePill(mode, enabled)}</td>
        <td data-label="Moc sprzeda&#380;y" class="metric sell">${enabled ? `${this.iconSvg("sell")} ${this.numberState(entities.sellPower)} W` : "-"}</td>
        <td data-label="Pr&#261;d roz&#322;adowania" class="metric discharge">${enabled ? `&#8595; ${this.numberState(entities.dischargeCurrent)} A` : "-"}</td>
        <td data-label="Pr&#261;d &#322;adowania" class="metric charge">${enabled ? `&#8593; ${this.numberState(entities.chargeCurrent)} A` : "-"}</td>
        <td data-label="&#321;adowanie z sieci" class="metric grid">${enabled ? `<button class="pill ${gridChargeClass}" data-slot-grid-charge="${key}" data-grid-entity="${entities.chargeEnabled}">${gridChargeLabel}</button>` : "-"}</td>
        <td data-label="Pr&#261;d z sieci" class="metric grid-current">${enabled ? `${gridChargeCurrent} A` : "-"}</td>
        <td data-label="Min. SOC" class="metric soc">${enabled ? `&#9671; ${this.numberState(entities.minSoc)}%` : "-"}</td>
        <td data-label="Cena min." class="metric price-limit">${enabled ? `${this.formatPrice(this.numberState(entities.minSellPrice))} PLN` : "-"}</td>
        <td data-label="Aktywne">${this.pill(entities.sellEnabled, enabled ? "ON" : "OFF")}</td>
        <td data-label="Akcja"><button class="icon-only" data-open-slot="sell:${key}" title="Edytuj">${this.iconSvg("edit")}</button></td>
      </tr>`;
    }).join("");

    const selectedInfo = this._selectionMode ? `<aside class="bulk-panel">
      <h3>Edytuj zaznaczone godziny</h3>
      <div class="range-box">
        <strong>Zakres: ${this.selectedRangeText(slots)}</strong>
        <span>Liczba godzin: ${selectedCount}</span>
        <small>${this.mapWarning(slots)}</small>
      </div>
      <label class="apply-row"><input type="checkbox" data-apply-field="active" checked><span>Aktywne</span>${this.rawSelect("multi-active", [["on", "Tak"], ["off", "Nie"]], bulk.active)}</label>
      <label class="apply-row"><input type="checkbox" data-apply-field="mode" checked><span>Tryb pracy</span>${this.rawSelect("multi-mode", this.slotWorkModes(), bulk.mode)}</label>
      <label class="apply-row"><input type="checkbox" data-apply-field="sellPower" checked><span>Moc sprzeda&#380;y</span>${this.rawNumber("multi-sell-power", bulk.sellPower, "W")}</label>
      <label class="apply-row"><input type="checkbox" data-apply-field="dischargeCurrent" checked><span>Pr&#261;d roz&#322;adowania</span>${this.rawNumber("multi-discharge-current", bulk.dischargeCurrent, "A")}</label>
      <label class="apply-row"><input type="checkbox" data-apply-field="chargeCurrent" checked><span>Pr&#261;d &#322;adowania</span>${this.rawNumber("multi-charge-current", bulk.chargeCurrent, "A")}</label>
      <label class="apply-row"><input type="checkbox" data-apply-field="gridCharge" checked><span>&#321;adowanie z sieci</span>${this.rawSelect("multi-grid-charge", [["on", "tak"], ["off", "nie"]], bulk.gridCharge)}</label>
      <label class="apply-row"><input type="checkbox" data-apply-field="gridChargeCurrent" checked><span>Pr&#261;d z sieci</span>${this.rawNumber("multi-grid-charge-current", bulk.gridChargeCurrent, "A")}</label>
      <label class="apply-row"><input type="checkbox" data-apply-field="minSoc" checked><span>Minimalny SOC</span>${this.rawNumber("multi-min-soc", bulk.minSoc, "%")}</label>
      <label class="apply-row"><input type="checkbox" data-apply-field="minSellPrice" checked><span>Sprzedawaj od ceny</span>${this.rawNumber("multi-min-sell-price", bulk.minSellPrice, "PLN")}</label>
      <div class="preview-box"><strong>Podgl&#261;d zmian</strong><br>Wybrane pola zostan&#261; wpisane tylko do zaznaczonych godzin. Pola bez znacznika zostaj&#261; bez zmian.</div>
      <div class="bulk-actions"><button data-schedule-clear="1">${this.iconSvg("close")} Anuluj</button><button class="primary" data-apply-multi="1">${this.iconSvg("check")} Zastosuj zmiany</button></div>
    </aside>` : "";

    const touRows = [1, 2, 3, 4, 5, 6].map((idx) => {
      const tou = this.touEntities(idx);
      const end = touStarts[idx % 6] || "00:00";
      const start = this.state(tou.start, "00:00:00").slice(0, 5);
      return `<tr>
        <td data-label="Slot">${idx}</td>
        <td data-label="Od">${start}</td>
        <td data-label="Do">${end}</td>
        <td data-label="Batt">${this.numberState(tou.soc)} %</td>
        <td data-label="Pr&#261;d">${this.numberState(tou.gridCurrent)} A</td>
        <td data-label="Sie&#263;">${this.pill(tou.grid)}</td>
        <td data-label="Ustaw"><button class="set-btn" data-open-tou="${idx}">Ustaw</button></td>
      </tr>`;
    }).join("");

    this.innerHTML = `
      <ha-card class="theme-schedule-dark">
        <style>
          ha-card{--bg:#020b12;--panel:rgba(9,24,35,.92);--panel2:rgba(13,31,45,.88);--panel3:rgba(16,38,54,.72);--line:rgba(118,166,190,.22);--line2:rgba(80,169,226,.38);--text:#eef7ff;--muted:#9eb8c8;--blue:#159bff;--blue2:#0a6ad8;--green:#7ee22d;--green2:#35d66f;--purple:#bc63ff;--gold:#f6a619;--red:#ff4242;overflow:hidden;background:radial-gradient(circle at 18% 0%,rgba(26,106,164,.22),transparent 34%),linear-gradient(180deg,#020913,#06131c 54%,#050b10);color:var(--text);border:1px solid rgba(101,142,164,.32);box-shadow:0 18px 45px rgba(0,0,0,.35)}
          .dem-v076{padding:18px;display:grid;gap:16px;font-family:Roboto,Arial,sans-serif;font-size:14px}
          svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
          button{font:inherit}
          .panel,.schedule-shell,.table-wrap{border:1px solid rgba(107,157,182,.34);border-radius:10px;background:radial-gradient(circle at 12% 8%,rgba(20,85,130,.16),transparent 32%),linear-gradient(180deg,rgba(5,16,26,.98),rgba(7,21,32,.98));box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 12px 28px rgba(0,0,0,.18)}
          .panel-title,.table-title{margin:0;padding:12px 14px;background:linear-gradient(180deg,rgba(16,45,61,.92),rgba(6,20,31,.86));border-bottom:1px solid rgba(107,157,182,.24);font-size:18px;font-weight:800;color:#fff}
          .status-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;padding:10px}
          .stat{border:1px solid rgba(111,154,178,.45);border-radius:7px;background:rgba(7,18,28,.74);padding:10px;min-width:0}
          .stat span{display:block;color:#a9c1d0;font-size:12px}.stat strong{display:block;margin-top:4px;color:#fff;font-size:18px;line-height:1.2}.stat.good strong,.good{color:#2dff95!important}.stat.warn strong,.warn{color:#ffd95c!important}.bad{color:#ff6b7a!important}
          .info-grid{display:grid;grid-template-columns:1fr 1fr 1.1fr;gap:14px;align-items:stretch}.info-grid>.panel{height:auto;min-height:470px;display:flex;flex-direction:column;min-width:0}
          .price-summary,.solcast-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:9px}.price-summary.single{grid-template-columns:1fr}.price-summary .stat strong,.solcast-summary .stat strong{font-size:14px}
          .price-scroll{height:auto;flex:0 0 auto;min-height:0;overflow:visible;border-top:1px solid var(--line);overscroll-behavior:contain}.price-table{width:100%;border-collapse:collapse;table-layout:fixed}.price-table th,.price-table td{padding:3px 8px;border-top:1px solid var(--line);font-size:11px;line-height:14px}.price-table th{position:sticky;top:0;z-index:1;background:rgba(18,42,59,.96);color:#d8f4ff;text-align:left}.price-table tbody tr.active{background:rgba(37,105,151,.32);box-shadow:inset 3px 0 0 var(--blue)}.price-table tbody tr.active td:first-child{color:#fff;font-weight:900}.price{font-weight:900;color:#e9f7ff}.price.good{color:#2dff95}.price.warn{color:#ffd95c}.price.missing{opacity:.55}
          .solcast-days{display:grid;grid-template-columns:repeat(7,minmax(76px,1fr));gap:8px;padding:9px;border-top:1px solid var(--line)}.solcast-day{height:104px;border:1px solid var(--line);border-radius:8px;background:rgba(7,18,28,.72);display:grid;grid-template-rows:auto 1fr auto;gap:4px;padding:6px}.solcast-day-head{display:flex;justify-content:space-between;gap:4px}.solcast-day-head strong{font-size:11px;color:#e8f7ff;white-space:nowrap}.solcast-day-head em{font-style:normal;font-size:10px;color:#88a7bb}.solcast-day-meter{display:flex;align-items:end;justify-content:center;border-radius:6px;background:rgba(255,255,255,.03)}.solcast-day-meter span{width:34px;border-radius:8px 8px 2px 2px;background:linear-gradient(180deg,#ffd166,#39ef8d);min-height:8px}.solcast-day b{text-align:center;font-size:11px}.solcast-day.missing{opacity:.45}
          .solcast-chart{height:170px;overflow-x:auto;border-top:1px solid var(--line);padding:10px 8px 0;overscroll-behavior:contain}.solcast-bars{height:146px;min-width:520px;display:grid;grid-template-columns:repeat(24,1fr);gap:4px;align-items:end}.solcast-bar{height:146px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px}.solcast-columns{height:128px;width:100%;display:flex;align-items:end;justify-content:center;gap:2px}.solcast-columns span{display:block;width:42%;border-radius:4px 4px 0 0;min-height:3px}.solcast-columns .today{background:#2dff95}.solcast-columns .tomorrow{background:#57b9ff}.solcast-bar.now .solcast-columns span{box-shadow:0 0 0 1px #ffd166 inset}.solcast-bar em{font-style:normal;font-size:10px;color:#89a5b5;writing-mode:vertical-rl;transform:rotate(180deg)}.solcast-legend{display:flex;gap:7px;padding:4px 10px 8px;color:#a9c1d0;font-size:12px}.solcast-legend span{width:10px;height:10px;border-radius:999px;display:inline-block}.solcast-legend .today{background:#2dff95}.solcast-legend .tomorrow{background:#57b9ff}.solcast-performance{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:auto;padding:9px;border-top:1px solid var(--line)}.solcast-performance .stat{padding:8px}.solcast-performance .stat strong{font-size:14px}
          .schedule-shell{padding:10px;background:radial-gradient(circle at 12% 8%,rgba(20,85,130,.22),transparent 30%),linear-gradient(180deg,rgba(5,16,26,.98),rgba(7,21,32,.98))}
          .schedule-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:8px}.schedule-title h2{margin:0;display:flex;align-items:center;gap:8px;font-size:22px;font-weight:850}.schedule-title p{margin:3px 0 0;color:#c1d4df;font-size:13px}.title-icon{width:28px;height:28px;border-radius:999px;border:1px solid rgba(142,181,202,.42);background:rgba(255,255,255,.03);color:#d9ecf6;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}.title-icon.ai{color:#2fa8ff}.title-icon:hover{border-color:var(--blue);color:#fff}.save-indicator{display:none;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:800;line-height:1.2}.save-indicator.saving{display:inline-flex;color:#ffd166;background:rgba(246,166,25,.16)}.save-indicator.saved{display:inline-flex;color:var(--green);background:rgba(53,214,111,.14)}.save-indicator.error{display:inline-flex;max-width:360px;color:#ff8b98;background:rgba(255,77,99,.15);white-space:normal}
          .schedule-tools{display:flex;gap:9px;align-items:center;flex-wrap:wrap;justify-content:flex-end}.tool-btn,.gear-btn,.bulk-actions button,.set-btn,.icon-only{border:1px solid rgba(100,145,170,.42);border-radius:8px;background:rgba(7,17,27,.72);color:#eaf7ff;min-height:38px;padding:0 13px;display:inline-flex;align-items:center;gap:9px;cursor:pointer}.tool-btn.active{border-color:var(--blue);color:#2ea7ff;background:rgba(8,53,92,.55)}.gear-btn{width:48px;justify-content:center;padding:0}.gear-btn:hover,.tool-btn:hover,.set-btn:hover,.icon-only:hover{border-color:var(--blue);box-shadow:0 0 0 1px rgba(21,155,255,.25) inset}.icon-only{width:32px;min-height:28px;padding:0;justify-content:center}.set-btn{min-height:29px;padding:0 12px;font-weight:800}
          .mode-legend{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:4px 0 8px}.mode-tile{display:flex;align-items:center;gap:8px;min-width:0}.mode-icon{width:32px;height:32px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}.mode-tile.selling .mode-icon{background:rgba(126,226,45,.16);color:var(--green)}.mode-tile.normal .mode-icon{background:rgba(0,212,170,.16);color:#00d4aa}.mode-tile.zero .mode-icon{background:rgba(21,155,255,.16);color:var(--blue)}.mode-tile.ct .mode-icon{background:rgba(188,99,255,.18);color:var(--purple)}.mode-tile.charge .mode-icon{background:rgba(246,166,25,.18);color:var(--gold)}.mode-tile.disabled .mode-icon{background:rgba(155,178,193,.12);color:#b9c9d4}.mode-tile strong{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mode-tile.selling strong{color:var(--green)}.mode-tile.normal strong{color:#00d4aa}.mode-tile.zero strong{color:var(--blue)}.mode-tile.ct strong{color:var(--purple)}.mode-tile.charge strong{color:var(--gold)}.mode-tile span{display:block;color:#c2d4de;margin-top:1px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .schedule-main{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}.schedule-main.selecting{grid-template-columns:minmax(0,1fr) 340px}.schedule-left{min-width:0}.schedule-table-card{border:1px solid rgba(107,157,182,.28);border-radius:8px;overflow:hidden;background:rgba(6,19,29,.62)}.schedule-table{width:100%;border-collapse:collapse;table-layout:auto}.schedule-table th,.schedule-table td{padding:1px 4px;border-top:1px solid var(--line);text-align:left;vertical-align:middle}.schedule-table th{background:rgba(19,41,56,.86);color:#d9ecf6;font-size:10px;font-weight:800}.schedule-table td{font-size:11px}.schedule-table tr{height:24px}.schedule-table tr.active{background:rgba(37,105,151,.32)}.schedule-table tr.selected{background:rgba(0,122,255,.14);box-shadow:inset 0 0 0 1px var(--blue)}.check-col{width:30px}.time-col{width:56px;min-width:56px;max-width:56px;text-align:left;white-space:nowrap}.schedule-table .metric,.schedule-table .mode-pill{white-space:nowrap}.schedule-table col.col-check{width:30px}.schedule-table col.col-time{width:58px}.schedule-table col.col-mode{width:118px}.schedule-table col.col-power{width:76px}.schedule-table col.col-current{width:78px}.schedule-table col.col-grid{width:54px}.schedule-table col.col-grid-current{width:72px}.schedule-table col.col-soc{width:56px}.schedule-table col.col-price{width:70px}.schedule-table col.col-active{width:56px}.schedule-table col.col-action{width:42px}.slot-check{display:inline-flex;align-items:center;justify-content:center}.slot-check input{display:none}.slot-check span{width:18px;height:18px;border:1px solid rgba(159,190,207,.55);border-radius:5px;background:rgba(255,255,255,.02)}.slot-check input:checked+span{background:var(--blue);border-color:var(--blue);box-shadow:inset 0 0 0 3px rgba(0,0,0,.18)}.slot-check input:checked+span::after{content:"";display:block;width:8px;height:5px;border-left:2px solid #00131f;border-bottom:2px solid #00131f;transform:rotate(-45deg);margin:5px 0 0 5px}
          .mode-pill{display:inline-flex;align-items:center;border-radius:6px;padding:3px 7px;font-weight:800;background:#223241;color:#d7e7ef;white-space:nowrap}.mode-pill.selling{background:rgba(72,154,38,.24);color:var(--green)}.mode-pill.normal{background:rgba(0,212,170,.18);color:#00d4aa}.mode-pill.zero{background:rgba(21,155,255,.18);color:#55baff}.mode-pill.ct{background:rgba(188,99,255,.18);color:#ce8cff}.mode-pill.charge{background:rgba(246,166,25,.18);color:#ffc65a}.mode-pill.disabled{background:rgba(142,160,172,.16);color:#d6e1e8}.mode-tooltip{position:absolute;z-index:30;display:none;max-width:260px;padding:10px 12px;border-radius:8px;background:rgba(4,22,34,.97);border:1px solid rgba(80,140,170,.4);box-shadow:0 10px 28px rgba(0,0,0,.45);color:#e2f1f8;font-size:12px;line-height:1.5;pointer-events:none}.mode-tooltip.visible{display:block}.mode-tooltip strong{display:block;margin-bottom:6px;color:#fff;font-size:13px}
          .metric{white-space:nowrap}.metric svg{width:16px;height:16px;vertical-align:-3px}.metric.sell{color:#8cef3b}.metric.discharge{color:#ff4848}.metric.charge{color:#20a9ff}.metric.grid,.metric.grid-current{color:#ffc65a}.metric.soc{color:#d279ff}.metric.price-limit{color:#2dff95}
          .pill{border:0;border-radius:999px;min-width:42px;padding:3px 9px;font-weight:900;cursor:pointer;background:#233849;color:#d9edf5}.pill.on{background:linear-gradient(90deg,#0a68d7,#159bff);color:#fff}.pill.off{background:#263e51;color:#d9edf5}.pill.missing{opacity:.62}
          .schedule-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding:7px 12px}.schedule-foot strong{color:#2ea7ff}.foot-actions{display:flex;gap:9px;flex-wrap:wrap}.foot-actions button{border:1px solid rgba(100,145,170,.42);border-radius:8px;background:rgba(7,17,27,.72);color:#eaf7ff;min-height:32px;padding:0 12px;display:inline-flex;align-items:center;gap:8px;cursor:pointer}.foot-actions .primary{background:linear-gradient(180deg,#0b7eee,#075bc0);border-color:#159bff}
          .bulk-panel{border:1px solid rgba(107,157,182,.28);border-radius:8px;background:linear-gradient(180deg,rgba(10,29,45,.95),rgba(7,21,33,.96));padding:20px}.bulk-panel h3{margin:0 0 16px;font-size:20px}.range-box{border:1px solid rgba(21,155,255,.35);border-radius:8px;background:rgba(0,81,145,.18);padding:14px;margin-bottom:16px;color:#2ea7ff}.range-box span,.range-box small{display:block;margin-top:5px}.apply-row{display:grid;grid-template-columns:24px 1fr 1.25fr;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}.apply-row input[type="checkbox"]{width:20px;height:20px;accent-color:var(--blue)}.preview-box{margin-top:12px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.03);padding:12px;color:#cbdce5}.bulk-actions{display:flex;justify-content:space-between;gap:10px;margin-top:16px}.bulk-actions .primary{background:linear-gradient(180deg,#72d13b,#41a91d);border-color:#75e247;color:#041007}
          input,select{width:100%;min-width:0;box-sizing:border-box;background:rgba(8,22,34,.95);color:#f6fbff;border:1px solid rgba(107,157,182,.34);border-radius:7px;padding:8px}option,select option{background:#fff!important;color:#111!important}.field{position:relative;display:block}.field input{padding-right:42px}.field span{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-weight:800;color:#d8ecf7}.row{min-height:38px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border-top:1px solid var(--line)}.row strong{text-align:right}.settings-row{min-height:40px;display:grid;grid-template-columns:1fr 260px;gap:12px;align-items:center;padding:9px 12px;border-top:1px solid var(--line)}.settings-row>input[type="checkbox"]{justify-self:end;width:20px;height:20px;accent-color:var(--blue)}.settings-row select,.settings-row .compact-field{max-width:260px;justify-self:end}.hint{padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.03);color:#c7d9e2;margin-bottom:12px}.wide-action{width:100%;min-height:38px;border:1px solid rgba(100,145,170,.45);border-radius:8px;background:#173a57;color:#fff;font-weight:800;cursor:pointer}.wide-action:disabled{opacity:.45;cursor:not-allowed}.settings-table{width:100%;border-collapse:collapse}.settings-table th,.settings-table td{padding:8px;border-top:1px solid var(--line);text-align:left}.settings-tabs{display:flex;gap:8px;padding:10px;border-bottom:1px solid var(--line);overflow-x:auto}.settings-tabs button{border:1px solid var(--line2);border-radius:7px;background:rgba(255,255,255,.03);color:#dfeef6;padding:8px 10px;white-space:nowrap}.settings-tabs button.active{border-color:var(--blue);color:#fff;background:rgba(21,155,255,.22)}.overlay{position:fixed;inset:0;background:rgba(0,0,0,.68);display:flex;align-items:center;justify-content:center;z-index:20;padding:16px}.dialog{width:min(760px,100%);max-height:92vh;overflow:auto;border:1px solid rgba(107,157,182,.45);border-radius:12px;background:radial-gradient(circle at 16% 0%,rgba(22,91,139,.2),transparent 36%),linear-gradient(180deg,#071b2a,#061420);box-shadow:0 25px 70px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.04)}.settings-dialog{width:min(880px,100%)}.dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;background:linear-gradient(180deg,rgba(14,50,70,.9),rgba(10,30,44,.86));border-bottom:1px solid rgba(107,157,182,.28)}.dialog-head strong{font-size:19px}.dialog-head button{border:0;background:transparent;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}.dialog-head button svg{pointer-events:none}.dialog-body{padding:14px}.dialog-actions{display:flex;justify-content:flex-end;gap:10px;padding:0 14px 14px}.dialog-actions button{border:1px solid var(--line2);border-radius:8px;background:#173a57;color:#fff;min-height:38px;padding:0 16px}.ai-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ai-card{border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.03);padding:12px}.ai-card h3{margin:0 0 8px;color:#7ee22d}.ai-proposal,.ai-history{grid-column:1/-1}.ai-proposal-scroll,.ai-history-scroll{overflow:auto;max-height:300px;margin-bottom:10px}.ai-proposal .mini-table,.ai-history .mini-table{min-width:620px}
           .history-toolbar{display:grid;grid-template-columns:repeat(3,minmax(130px,1fr)) repeat(3,auto);gap:8px;align-items:end;margin-bottom:12px}.history-toolbar label{display:grid;gap:4px;color:#a9c1d0;font-size:11px}.history-toolbar button,.danger-action{min-height:38px;border:1px solid var(--line2);border-radius:7px;background:#173a57;color:#fff;padding:0 12px;cursor:pointer}.history-section{border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.025);margin-bottom:12px;overflow:hidden}.history-section h3{margin:0;padding:10px 12px;color:var(--green);background:rgba(18,42,59,.74)}.history-scroll{max-height:270px;overflow:auto;overscroll-behavior:contain}.history-scroll .settings-table{min-width:780px}.history-scroll details summary{cursor:pointer;color:var(--blue)}.history-scroll pre{max-width:520px;max-height:220px;overflow:auto;white-space:pre-wrap;color:#cfe1ea}.history-rating{display:inline-flex;gap:3px;margin-top:4px}.history-rating button{width:25px;height:24px;border:1px solid var(--line2);border-radius:5px;background:rgba(255,255,255,.03);color:#b9ced9;cursor:pointer}.history-rating button.active{background:var(--green);color:#041007;border-color:var(--green)}.danger-action{background:rgba(138,24,42,.28);border-color:rgba(255,77,99,.55);color:#ff9cab}
           .analysis-history-scroll{overflow-x:hidden}.history-scroll .analysis-history-table{width:100%;min-width:0;table-layout:fixed}.analysis-history-table th,.analysis-history-table td{overflow-wrap:anywhere}.analysis-history-table th:nth-child(1){width:19%}.analysis-history-table th:nth-child(2){width:14%}.analysis-history-table th:nth-child(3){width:20%}.analysis-history-table th:nth-child(4){width:32%}.analysis-history-table th:nth-child(5){width:15%}.analysis-detail-row td{padding:0 10px 8px!important;background:rgba(3,14,23,.45)}.analysis-record{width:100%}.analysis-record summary{padding:8px 2px;font-weight:800;cursor:pointer;color:var(--blue)}.analysis-details{display:grid;gap:10px;padding:2px 0 10px}.analysis-detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.analysis-detail-grid>div,.analysis-price-groups section,.analysis-explanation{border:1px solid var(--line);border-radius:7px;background:rgba(255,255,255,.025);padding:9px}.analysis-detail-grid span,.analysis-explanation span{display:block;margin-bottom:4px;color:#9db7c6;font-size:10px}.analysis-detail-grid strong,.analysis-explanation strong{display:block;overflow-wrap:anywhere}.analysis-price-groups{display:grid;grid-template-columns:1fr 1fr;gap:8px}.analysis-price-groups h4{margin:0 0 6px;color:var(--green)}.analysis-price-groups ul{list-style:none;margin:0;padding:0}.analysis-price-groups li{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid var(--line)}
           .settings-dialog{width:min(1180px,96vw)!important;height:min(820px,92vh);max-height:92vh!important;overflow:hidden!important;display:grid;grid-template-rows:auto minmax(0,1fr)}.settings-layout{min-height:0;display:grid;grid-template-columns:220px minmax(0,1fr)}.settings-nav{padding:12px;border-right:1px solid var(--line);background:rgba(4,15,24,.58);display:flex;flex-direction:column;gap:7px;overflow-y:auto}.settings-nav button{width:100%;min-height:42px;border:1px solid var(--line2);border-radius:7px;background:rgba(255,255,255,.025);color:#dfeef6;padding:8px 10px;text-align:left;cursor:pointer}.settings-nav button.active{border-color:var(--blue);color:#fff;background:rgba(21,155,255,.22)}.settings-content{min-width:0;overflow:auto;overscroll-behavior:contain;padding:14px}.diagnostic-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-bottom:12px}.diagnostic-summary>div{border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.03);padding:11px}.diagnostic-summary span{display:block;color:#9db7c6;font-size:11px}.diagnostic-summary strong{display:block;margin-top:5px;overflow-wrap:anywhere}.diagnostic-section{border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-bottom:12px;background:rgba(255,255,255,.025)}.diagnostic-section h3{margin:0;padding:10px 12px;background:rgba(18,42,59,.78);color:#dff4ff}.diagnostic-entities{max-height:260px;overflow:auto}.diag-badge{display:inline-flex;border-radius:999px;padding:3px 9px;font-weight:800}.diag-badge.ok{color:var(--green);background:rgba(53,214,111,.12)}.diag-badge.error{color:#ff8b98;background:rgba(255,77,99,.13)}.diagnostic-actions{display:flex;flex-wrap:wrap;gap:8px;padding:12px}.diagnostic-actions button{min-height:38px;border:1px solid var(--line2);border-radius:7px;background:#173a57;color:#fff;padding:0 13px;cursor:pointer}.diagnostic-actions button.danger{background:rgba(138,24,42,.28);border-color:rgba(255,77,99,.55);color:#ff9cab}
           .sales-summary{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;padding:10px}.sales-chart{height:130px;display:grid;grid-template-columns:repeat(24,1fr);gap:4px;align-items:end;padding:10px;border-top:1px solid var(--line)}.sales-bar{height:112px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px;min-width:0}.sales-bar span{display:block;width:100%;min-height:4px;border-radius:4px 4px 0 0;background:#35d66f}.sales-bar.now span{background:#ffd166}.sales-bar em{font-style:normal;font-size:10px;color:#8aa8b8;writing-mode:vertical-rl;transform:rotate(180deg)}.sales-tables{display:grid;grid-template-columns:1fr .8fr 1fr;gap:10px;padding:0 10px 10px}.section-label{padding:8px 10px;color:#d9f7ff;background:#1b3445;font-size:12px;font-weight:900;text-transform:uppercase}.sales-scroll{max-height:170px;overflow:auto;overscroll-behavior:contain}.mini-table{width:100%;border-collapse:collapse}.mini-table td{padding:5px 8px;border-top:1px solid var(--line);font-size:12px}
          .status-panel,.sales-panel{background:radial-gradient(circle at 12% 0%,rgba(20,85,130,.22),transparent 30%),linear-gradient(180deg,rgba(5,16,26,.99),rgba(7,21,32,.99));border-color:rgba(107,157,182,.3)}
          .status-panel .panel-title,.sales-panel .panel-title{display:flex;align-items:center;gap:9px;padding:13px 15px;background:transparent;border-bottom:1px solid rgba(107,157,182,.25);font-size:21px}.status-panel .panel-title svg,.sales-panel .panel-title svg{width:21px;height:21px;color:var(--blue)}
          .status-panel .status-grid{gap:10px;padding:12px}.status-panel .stat,.sales-summary .stat{position:relative;display:flex;align-items:center;gap:11px;min-height:58px;padding:10px 12px;border:1px solid rgba(107,157,182,.28);border-radius:8px;background:linear-gradient(180deg,rgba(12,31,45,.84),rgba(6,19,29,.88));box-shadow:inset 0 1px 0 rgba(255,255,255,.025)}
          .stat-icon{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;background:rgba(21,155,255,.14);color:#55baff}.stat-icon svg{width:19px;height:19px}.stat-copy{min-width:0;flex:1}.status-panel .stat span,.sales-summary .stat span{font-size:11px;color:#8eacbd}.status-panel .stat strong,.sales-summary .stat strong{font-size:16px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
           .status-mode .stat-icon{color:var(--green);background:rgba(126,226,45,.14)}.status-mode.warn .stat-icon{color:var(--gold);background:rgba(246,166,25,.16)}.status-mode.bad .stat-icon{color:#ff6b7a;background:rgba(255,77,99,.15)}.status-mode.neutral .stat-icon{color:#a9c1d0;background:rgba(155,178,193,.12)}.status-mode.charge .stat-icon{color:var(--gold);background:rgba(246,166,25,.16)}.status-mode.zero .stat-icon{color:var(--blue);background:rgba(21,155,255,.16)}.status-mode.ct .stat-icon{color:var(--purple);background:rgba(188,99,255,.18)}.status-pv .stat-icon{color:#ffd166;background:rgba(255,209,102,.14)}.status-home .stat-icon{color:#57b9ff}.status-grid .stat-icon{color:#6ec7ff}.status-battery .stat-icon,.status-soc .stat-icon{color:var(--purple);background:rgba(188,99,255,.14)}.status-sold .stat-icon{color:var(--green);background:rgba(53,214,111,.14)}.status-slot .stat-icon{color:var(--gold);background:rgba(246,166,25,.14)}.status-inverter .stat-icon{color:var(--blue);background:rgba(21,155,255,.14)}.status-action .stat-icon{color:#d8ecf7;background:rgba(155,178,193,.1)}
           .decision-strip{margin:0 12px 12px;padding:10px 13px;border:1px solid rgba(107,157,182,.32);border-left:4px solid var(--blue);border-radius:8px;background:rgba(6,20,31,.82);display:flex;align-items:center;gap:10px}.decision-strip svg{width:19px;height:19px;color:var(--blue)}.decision-strip strong{font-size:13px}.decision-strip span{color:#a9c1d0;font-size:12px}.decision-strip.good{border-left-color:var(--green)}.decision-strip.good svg{color:var(--green)}.decision-strip.warn,.decision-strip.charge{border-left-color:var(--gold)}.decision-strip.warn svg,.decision-strip.charge svg{color:var(--gold)}.decision-strip.bad{border-left-color:#ff4d63}.decision-strip.bad svg{color:#ff6b7a}.decision-strip.ct{border-left-color:var(--purple)}.decision-strip.ct svg{color:var(--purple)}
          .sales-panel>div{padding:0 2px 2px}.sales-summary{gap:10px;padding:12px}.sales-summary .stat{border-left:3px solid rgba(21,155,255,.72)}.sales-summary .stat:nth-child(1){border-left-color:var(--green)}.sales-summary .stat:nth-child(2){border-left-color:#ffd166}.sales-summary .stat:nth-child(3){border-left-color:var(--blue)}.sales-summary .stat:nth-child(4){border-left-color:var(--purple)}.sales-summary .stat:nth-child(5){border-left-color:var(--gold)}
          .sales-chart{height:118px;margin:0 12px 12px;padding:10px 8px 7px;border:1px solid rgba(107,157,182,.25);border-radius:8px;background:rgba(4,15,24,.7)}.sales-bar{height:98px}.sales-bar span{background:linear-gradient(180deg,#74ea4b,#28b963);box-shadow:0 0 10px rgba(53,214,111,.12)}.sales-bar.now span{background:linear-gradient(180deg,#ffe08a,#f5b942)}
          .sales-tables{gap:12px;padding:0 12px 12px}.sales-tables>div{overflow:hidden;border:1px solid rgba(107,157,182,.25);border-radius:8px;background:rgba(4,15,24,.62)}.section-label{padding:9px 11px;background:rgba(18,42,59,.86);color:#d8edf8;font-size:11px;letter-spacing:0;text-transform:uppercase}.mini-table td{padding:6px 9px;border-top:1px solid rgba(118,166,190,.16);font-size:11px}.mini-table tr:hover td{background:rgba(21,155,255,.05)}
          @media(max-width:1500px){.info-grid{grid-template-columns:1fr 1fr}.info-grid>.panel:nth-child(3){grid-column:1/-1}.schedule-main.selecting{grid-template-columns:1fr}.bulk-panel{max-width:none}.mode-legend{grid-template-columns:repeat(3,minmax(0,1fr))}}
           @media(max-width:980px){.dem-v076{padding:10px}.info-grid{grid-template-columns:1fr}.status-grid,.sales-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.info-grid>.panel{height:auto;min-height:340px}.schedule-head{display:grid}.schedule-tools{justify-content:stretch}.tool-btn{flex:1}.mode-legend{grid-template-columns:1fr 1fr}.schedule-table{min-width:1160px}.schedule-table-card{overflow-x:auto}.sales-tables{grid-template-columns:1fr}.sales-chart{overflow-x:auto;grid-template-columns:repeat(24,24px)}.price-scroll{height:260px;overflow:auto;scrollbar-gutter:stable}.solcast-days{grid-template-columns:repeat(2,1fr)}.settings-layout{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}.settings-nav{flex-direction:row;overflow-x:auto;overflow-y:hidden;border-right:0;border-bottom:1px solid var(--line)}.settings-nav button{width:auto;min-width:max-content;text-align:center}.diagnostic-summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
           @media(max-width:620px){
             .dem-v076{padding:4px;gap:8px}.panel,.schedule-shell,.table-wrap{border-radius:7px}.panel-title{padding:10px 12px;font-size:18px}
             .status-grid,.sales-summary{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px!important;padding:7px!important}.status-panel .stat,.sales-summary .stat{min-height:52px;padding:7px 8px;gap:7px}.status-panel .status-mode{grid-column:1/-1}.stat-icon{width:29px;height:29px}.stat-icon svg{width:17px;height:17px}.status-panel .stat span,.sales-summary .stat span{font-size:10px}.status-panel .stat strong,.sales-summary .stat strong{font-size:13px;line-height:1.25;white-space:normal;overflow-wrap:anywhere}
             .info-grid{gap:8px}.info-grid>.panel{min-height:0;height:auto}.price-summary{grid-template-columns:1fr}.price-scroll{height:230px}.price-table th,.price-table td{padding:4px 7px;font-size:11px}
             .solcast-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.solcast-days{display:flex;gap:6px;overflow-x:auto;scroll-snap-type:x proximity;padding-bottom:5px}.solcast-day{min-width:132px;scroll-snap-align:start}.solcast-chart{height:162px;padding-left:5px;padding-right:5px}.solcast-bars{height:138px;min-width:560px}.solcast-performance{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:7px}
             .schedule-shell{padding:7px}.schedule-head{gap:8px}.schedule-title h2{font-size:19px}.schedule-title p{font-size:11px;line-height:1.35}.schedule-tools{display:grid;grid-template-columns:1fr 1fr;gap:6px}.tool-btn{min-height:36px;padding:0 8px;justify-content:center;font-size:12px}.gear-btn{width:100%;min-height:36px}.mode-legend{display:flex;gap:10px;overflow-x:auto;padding:3px 1px 7px;scroll-snap-type:x proximity}.mode-tile{min-width:150px;scroll-snap-align:start}.mode-icon{width:30px;height:30px}.mode-tile strong{font-size:12px}.mode-tile span{font-size:10px}.schedule-table{min-width:880px}.schedule-table th,.schedule-table td{padding:2px 3px}.schedule-table td{font-size:10px}.schedule-foot{padding:7px;align-items:flex-start;flex-direction:column}.foot-actions{width:100%;display:grid;grid-template-columns:1fr 1fr}.foot-actions button{justify-content:center;padding:0 7px;font-size:11px}
             .sales-summary{padding:8px}.sales-chart{min-height:150px}.sales-tables{gap:8px}.sales-table-card h3{font-size:14px;padding:9px}.sales-table-card th,.sales-table-card td{font-size:11px;padding:6px 8px}
             .apply-row{grid-template-columns:24px 1fr}.apply-row .field,.apply-row select{grid-column:2}.ai-grid{grid-template-columns:1fr}.history-toolbar{grid-template-columns:1fr 1fr}.history-toolbar button{width:100%}.analysis-detail-grid,.analysis-price-groups{grid-template-columns:1fr}.settings-dialog{width:100%!important;height:94vh;max-height:94vh!important}.settings-content{padding:9px}.diagnostic-summary{grid-template-columns:1fr}.diagnostic-actions{display:grid}.diagnostic-actions button{width:100%}
           }
        </style>
        <div class="dem-v076">
          <section class="panel status-panel">
            <h2 class="panel-title">${this.iconSvg("chart")} Status energii</h2>
            <div class="status-grid">
              ${this.stat("Tryb", modeText, `${modeClass} status-mode`, "mode", "shield")}
              ${this.stat("PV", `${this.state("sensor.deye_inverter_pv_power")} W`, "status-pv", "pv", "pv")}
              ${this.stat("Dom", `${this.state("sensor.deye_inverter_load_power")} W`, "status-home", "load", "home")}
              ${this.stat("Sie&#263;", this.gridFlow(this.state("sensor.deye_inverter_grid_power")), "status-grid", "grid", "grid")}
              ${this.stat("Bateria", this.batteryFlow(this.state("sensor.deye_inverter_battery_power")), "status-battery", "battery-power", "battery")}
              ${this.stat("SOC", `${this.state(batterySoc)} %`, "status-soc", "soc", "battery")}
              ${this.stat("Sprzedane dzisiaj", `${this.state(soldEnergyToday)} kWh / ${this.state(soldValueToday)} PLN`, "status-sold", "sold-today", "money")}
              ${this.stat("Aktywny slot", activeSlotLabel, "status-slot", "active-slot", "clock")}
            </div>
            <div class="decision-strip ${modeClass || "neutral"}" data-decision-strip>
              ${this.iconSvg("shield")}
              <div><strong>Decyzja managera: </strong><span data-live="decision-strip-text">${decisionText}</span></div>
            </div>
           </section>
          <div class="info-grid">
            <section class="panel price-panel">
              <h2 class="panel-title">Ceny sprzeda&#380;y</h2>
              <div class="price-summary single">
                ${this.stat("Teraz", `${this.formatPrice(this.state(sellPriceToday))} PLN/kWh`, "", "sell-now")}
              </div>
              ${this.priceTable(sellPriceToday, sellPriceTomorrow, priceThreshold, true, "sell-prices")}
            </section>
            <section class="panel price-panel">
              <h2 class="panel-title">Ceny zakupu</h2>
              <div class="price-summary single">
                ${this.stat("Teraz", `${this.formatPrice(this.state(buyPriceToday))} PLN/kWh`, "", "buy-now")}
              </div>
              ${this.priceTable(buyPriceToday, buyPriceTomorrow, 0, false, "buy-prices")}
            </section>
            <section class="panel solcast-panel">
              <h2 class="panel-title">Prognoza Solcast</h2>
              <div class="solcast-summary">
                ${this.stat("Teraz", this.formatPower(this.state(solcastPower)), "", "solcast-power")}
                ${this.stat("Dzi&#347;", this.formatEnergy(this.state(solcastToday)), "", "solcast-today")}
                ${this.stat("Pozosta&#322;o", this.formatEnergy(this.state(solcastRemaining)), "", "solcast-remaining")}
                ${this.stat("Jutro", this.formatEnergy(this.state(solcastTomorrow)), "", "solcast-tomorrow")}
                ${this.stat("Szczyt", this.formatPower(this.state(solcastPeakPower)), "", "solcast-peak-power")}
                ${this.stat("Najlepszy dzie&#324;", this.bestSolcastDay(solcastEntities), "", "solcast-best-day")}
              </div>
              <div data-live-html="solcast-days">${this.solcastDaysChart(solcastEntities)}</div>
              <div data-live-html="solcast-chart">${this.solcastChart(solcastToday, solcastTomorrow)}</div>
              <div class="solcast-performance">
                ${this.stat("Prognoza na dzi&#347;", this.formatEnergy(solcastForecastValue), "", "solcast-performance-forecast")}
                ${this.stat("Produkcja rzeczywista", this.formatEnergy(dailyPvValue), "", "solcast-performance-actual")}
                ${this.stat("R&#243;&#380;nica", this.formatSignedEnergy(solcastDifference), "", "solcast-performance-difference")}
                ${this.stat("Trafno&#347;&#263; prognozy", solcastAccuracyValue === null ? "brak" : `${solcastAccuracyValue.toFixed(1)} %`, "", "solcast-performance-accuracy")}
              </div>
            </section>
          </div>
          <section class="schedule-shell">
            <div class="schedule-head">
              <div class="schedule-title">
                <h2>Harmonogram sprzeda&#380;y <button class="title-icon ai" data-open-ai="1" title="Sugestie AI">${this.iconSvg("ai")}</button><span class="save-indicator ${this._saveStatus}" data-save-indicator>${this._saveStatus === "saving" ? "Zapisywanie..." : this._saveStatus === "saved" ? "Zapisano" : this._saveStatus === "error" ? this._saveMessage : ""}</span></h2>
                <p>Kliknij godzin&#281;, aby edytowa&#263; pojedynczy slot lub zaznacz wiele, aby edytowa&#263; zbiorczo.</p>
              </div>
              <div class="schedule-tools">
                <button class="tool-btn ${this._selectionMode ? "active" : ""}" data-toggle-selection="1">${this.iconSvg("check")} Tryb zaznaczania</button>
                <button class="tool-btn" data-schedule-select-all="1">${this.iconSvg("copy")} Zaznacz wszystko</button>
                <button class="tool-btn" data-schedule-clear="1">${this.iconSvg("close")} Odznacz wszystko</button>
                <button class="gear-btn" data-open-settings="1" title="Ustawienia">${this.iconSvg("gear")}</button>
              </div>
            </div>
            <div class="schedule-main ${this._selectionMode ? "selecting" : ""}">
              <div class="schedule-left">
                <div class="mode-legend">${this.modeLegend()}</div>
                <div class="mode-tooltip" data-mode-tooltip></div>
                <div class="schedule-table-card">
                  <table class="schedule-table">
                    <colgroup>
                      <col class="col-check"><col class="col-time"><col class="col-mode"><col class="col-power">
                      <col class="col-current"><col class="col-current"><col class="col-grid"><col class="col-grid-current">
                      <col class="col-soc"><col class="col-price"><col class="col-active"><col class="col-action">
                    </colgroup>
                    <thead><tr><th class="check-col"></th><th class="time-col">Godz.</th><th>Tryb</th><th>Moc</th><th>Roz&#322;.</th><th>&#321;ad.</th><th>Grid</th><th>Pr&#261;d sieci</th><th>SOC</th><th>Cena min.</th><th>Aktywne</th><th>Akcja</th></tr></thead>
                    <tbody>${scheduleRows}</tbody>
                  </table>
                  <div class="schedule-foot">
                    <span>Zaznaczonych: <strong>${selectedCount} godzin</strong></span>
                    <div class="foot-actions">
                      <button data-schedule-clear="1">${this.iconSvg("close")} Odznacz</button>
                      <button class="primary" data-open-multi="1" ${selectedCount ? "" : "disabled"}>${this.iconSvg("edit")} Edytuj zaznaczone (${selectedCount})</button>
                      <button data-open-settings="mapping">${this.iconSvg("copy")} Mapowanie Deye</button>
                    </div>
                  </div>
                </div>
              </div>
              ${selectedInfo}
            </div>
          </section>
          <section class="panel sales-panel"><h2 class="panel-title">${this.iconSvg("chart")} Statystyki sprzeda&#380;y</h2><div data-live-html="sales-stats">${this.salesStatsPanel()}</div></section>
          ${this.renderDialog(slots, touStarts)}
        </div>
      </ha-card>`;

    this.bindControlsV073(slots);
    this._isRendered = true;
    this.syncBulkPanelValues(slots);
    this.restoreScrollPositions();
  }

  bindControlsV073(slots) {
    this.querySelectorAll("[data-close-dialog]").forEach((el) => {
      el.addEventListener("click", (event) => {
        if (el.classList.contains("overlay") && event.target !== el) return;
        event.preventDefault();
        event.stopPropagation();
        this.closeDialog();
      });
    });
    this.querySelectorAll("[data-toggle]").forEach((el) => {
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        this.toggle(el.dataset.toggle);
      });
    });
    this.querySelectorAll("[data-slot-grid-charge]").forEach((el) => {
      el.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const key = el.dataset.slotGridCharge;
        const slot = slots.find(([slotKey]) => slotKey === key);
        if (!slot) return;
        const entities = this.slotEntities(slot[0], slot[1]);
        const enabled = this.slotGridChargeState(key, entities) !== "on";
        await this.setSlotGridCharge(
          key,
          entities,
          enabled,
          this.numberState(entities.gridChargeCurrent, 0),
          this.numberState(entities.minSoc, 0),
        );
      });
    });
    this.querySelectorAll("[data-number]").forEach((el) => {
      el.onchange = () => this.setNumber(el.dataset.number, el.value);
      el.onkeydown = (event) => {
        if (event.key === "Enter") {
          this.setNumber(el.dataset.number, el.value);
          el.blur();
        }
      };
    });
    this.querySelectorAll("[data-select]").forEach((el) => {
      el.value = this.state(el.dataset.select);
      el.onchange = async () => {
        await this.setSelect(el.dataset.select, el.value);
        if (el.value !== "Charge") return;
        const slot = slots.find(([key, label]) => this.slotEntities(key, label).mode === el.dataset.select);
        if (!slot) return;
        const entities = this.slotEntities(slot[0], slot[1]);
        await this.setSlotGridCharge(
          slot[0],
          entities,
          true,
          this.numberState(entities.gridChargeCurrent, 0),
          this.numberState(entities.minSoc, 0),
        );
      };
    });
    this.querySelectorAll("[data-time]").forEach((el) => {
      el.onchange = () => this.setTime(el.dataset.time, el.value);
    });
    this.querySelectorAll("[data-slot-check]").forEach((el) => {
      el.addEventListener("click", (event) => event.stopPropagation());
      el.addEventListener("change", () => {
        if (!this._selectionMode) this._selectedSlots.clear();
        if (el.checked) this._selectedSlots.add(el.dataset.slotCheck);
        else this._selectedSlots.delete(el.dataset.slotCheck);
        this._selectionMode = true;
        this.render();
      });
    });
    this.querySelectorAll("[data-slot-row]").forEach((el) => el.addEventListener("click", (event) => {
      if (event.target.closest("button,input,select,label")) return;
      const key = el.dataset.slotRow;
      if (this._selectionMode) {
        if (this._selectedSlots.has(key)) this._selectedSlots.delete(key);
        else this._selectedSlots.add(key);
        this.render();
        return;
      }
      this._dialog = { type: "sell", key };
      this.render();
    }));
    this.querySelectorAll("[data-open-slot]").forEach((el) => el.addEventListener("click", (event) => {
      event.stopPropagation();
      const [type, key] = el.dataset.openSlot.split(":");
      this._dialog = { type, key };
      this.render();
    }));
    this.querySelectorAll("[data-open-tou]").forEach((el) => el.addEventListener("click", () => {
      this._dialog = { type: "tou", idx: el.dataset.openTou };
      this.render();
    }));
    this.querySelectorAll("[data-open-ai]").forEach((el) => el.addEventListener("click", () => {
      this.saveAiAnalysis(this.aiSuggestions(slots));
      this._aiProposalSelection = null;
      this._dialog = { type: "ai" };
      this.render();
    }));
    this.querySelectorAll("[data-open-settings]").forEach((el) => el.addEventListener("click", () => {
      const tab = el.dataset.openSettings;
      this._settingsTab = tab && tab !== "1" ? tab : "defaults";
      this._dialog = { type: "settings" };
      this.render();
    }));
    this.querySelectorAll("[data-settings-tab]").forEach((el) => el.addEventListener("click", () => {
      this._settingsTab = el.dataset.settingsTab;
      this.render();
    }));
    const modeTooltip = this.querySelector("[data-mode-tooltip]");
    this.querySelectorAll("[data-mode-info]").forEach((el) => {
      const showTooltip = () => {
        if (!modeTooltip) return;
        modeTooltip.innerHTML = this.modeInfoTooltip(el.dataset.modeInfo);
        modeTooltip.classList.add("visible");
        const rect = el.getBoundingClientRect();
        const container = this.getBoundingClientRect();
        let left = rect.left - container.left + rect.width / 2 - modeTooltip.offsetWidth / 2;
        let top = rect.bottom - container.top + 8;
        if (left < 8) left = 8;
        if (left + modeTooltip.offsetWidth > container.width - 8) left = container.width - modeTooltip.offsetWidth - 8;
        modeTooltip.style.left = `${left}px`;
        modeTooltip.style.top = `${top}px`;
      };
      const hideTooltip = () => modeTooltip?.classList.remove("visible");
      el.addEventListener("mouseenter", showTooltip);
      el.addEventListener("mouseleave", hideTooltip);
      el.addEventListener("click", showTooltip);
    });
    this.querySelectorAll("[data-save-normal-profile]").forEach((el) => el.addEventListener("click", () => this.saveNormalProfile()));
    this.querySelectorAll("[data-reload-normal-profile]").forEach((el) => el.addEventListener("click", () => this.reloadNormalProfileSlot(el.dataset.reloadNormalProfile)));
    this.querySelectorAll("[data-save-default-settings]").forEach((el) => el.addEventListener("click", () => this.saveDefaultSettings()));
    this.querySelectorAll("[data-save-charge-profile]").forEach((el) => el.addEventListener("click", () => this.saveChargeProfile()));
    this.querySelectorAll("[data-default-action]").forEach((button) => {
      button.disabled = this._defaultsApplying;
      button.addEventListener("click", () => this.restoreDefaults());
    });
    this.querySelectorAll("[data-resume-manager]").forEach((el) => el.addEventListener("click", () => this.resumeManager()));
    this.querySelectorAll("[data-charge-profile-number]").forEach((el) => {
      const saveDraft = () => {
        this._chargeProfileDraft[el.dataset.chargeProfileNumber] = el.value;
      };
      el.addEventListener("input", saveDraft);
      el.addEventListener("change", saveDraft);
    });
    this.querySelectorAll("[data-toggle-selection]").forEach((el) => el.addEventListener("click", () => {
      this._selectionMode = !this._selectionMode;
      this._selectedSlots.clear();
      this.render();
    }));
    this.querySelectorAll("[data-schedule-select-all]").forEach((el) => el.addEventListener("click", () => {
      slots.forEach(([key]) => this._selectedSlots.add(key));
      this._selectionMode = true;
      this.render();
    }));
    this.querySelectorAll("[data-schedule-clear]").forEach((el) => el.addEventListener("click", () => {
      this._selectedSlots.clear();
      this._dialog = null;
      this.render();
    }));
    this.querySelectorAll("[data-open-multi]").forEach((el) => el.addEventListener("click", () => {
      if (!this.selectedSlotList(slots).length) return;
      this._selectionMode = true;
      this.render();
    }));
    this.querySelectorAll("[data-apply-multi]").forEach((el) => el.addEventListener("click", () => this.applyMultiEdit(slots)));
    this.querySelectorAll("[data-action='apply-defaults']").forEach((el) => el.addEventListener("click", () => this.restoreDefaults()));
    this.querySelectorAll("[data-action='select-all']").forEach((el) => el.addEventListener("click", () => {
      slots.forEach(([key]) => this._selectedSlots.add(key));
      this._selectionMode = true;
      this.render();
    }));
    this.querySelectorAll("[data-action='clear-selected']").forEach((el) => el.addEventListener("click", () => {
      this._selectedSlots.clear();
      this.render();
    }));
    const saveAiValue = (el) => {
      const settings = this.aiSettings();
      const key = el.dataset.aiSetting;
      if (el.type === "checkbox") {
        settings[key] = el.checked;
      } else if (el.tagName === "SELECT") {
        settings[key] = el.value;
      } else {
        const parsed = this.asNumber(el.value);
        settings[key] = parsed === null ? el.value : parsed;
      }
      this.saveAiSettings(settings);
    };
    this.querySelectorAll("[data-ai-setting]").forEach((el) => {
      el.addEventListener("change", () => saveAiValue(el));
      if (el.tagName !== "SELECT" && el.type !== "checkbox") {
        el.addEventListener("input", () => saveAiValue(el));
      }
    });
    this.querySelectorAll("[data-clear-ai-history]").forEach((el) => el.addEventListener("click", () => {
      this.clearAiHistory();
      this.render();
    }));
    this.querySelectorAll("[data-history-filter]").forEach((el) => el.addEventListener("change", () => {
      this._historyFilters = { ...(this._historyFilters || {}), [el.dataset.historyFilter]: el.value };
      this.render();
    }));
    this.querySelectorAll("[data-export-history]").forEach((el) => el.addEventListener("click", () => this.exportHistory(el.dataset.exportHistory)));
    this.querySelectorAll("[data-export-monthly]").forEach((el) => el.addEventListener("click", () => this.exportMonthlyReport()));
    this.querySelectorAll("[data-rate-history]").forEach((el) => el.addEventListener("click", () => {
      const timestamp = Number(el.dataset.rateHistory);
      const rating = Number(el.dataset.rating);
      this.callService("deye_energy_manager", "rate_ai_analysis", { timestamp, rating });
      const item = this.aiHistory().find((entry) => Number(entry.timestamp) === timestamp);
      if (item) item.rating = rating;
      this.render();
    }));
    this.querySelectorAll("[data-clear-all-history]").forEach((el) => el.addEventListener("click", () => {
      if (!window.confirm("Usunąć historię sugestii, dane uczenia i porównania Solcast? Tej operacji nie można cofnąć.")) return;
      this._aiHistoryCache = [];
      this.callService("deye_energy_manager", "clear_history", {});
      try { localStorage.removeItem("deye_energy_manager_ai_history_v073"); } catch (_err) { /* ignored */ }
      this.render();
    }));
    this.querySelectorAll("[data-system-defaults]").forEach((el) => el.addEventListener("click", () => {
      if (window.confirm("Zatrzymać managera i zastosować ustawienia domyślne?")) this.restoreDefaults();
    }));
    this.querySelectorAll("[data-refresh-entities]").forEach((el) => el.addEventListener("click", () => this.refreshConfiguredEntities()));
    this.querySelectorAll("[data-export-config]").forEach((el) => el.addEventListener("click", () => this.exportConfiguration()));
    this.querySelectorAll("[data-create-backup]").forEach((el) => el.addEventListener("click", () => {
      try { this.createConfigurationBackup(); } catch (error) { window.alert(`Nie udało się utworzyć kopii: ${error.message}`); }
    }));
    this.querySelectorAll("[data-restore-backup]").forEach((el) => el.addEventListener("click", async () => {
      if (!window.confirm("Przywrócić ostatnią lokalną kopię zapasową? Bieżące ustawienia zostaną zastąpione.")) return;
      try { await this.restoreConfigurationBackup(); window.alert("Kopia zapasowa została przywrócona."); } catch (error) { window.alert(error.message); }
    }));
    this.querySelectorAll("[data-restore-defaults]").forEach((el) => el.addEventListener("click", () => {
      if (window.confirm("Przywrócić ustawienia domyślne i zatrzymać harmonogram?")) this.restoreDefaults();
    }));
    this.querySelectorAll("[data-import-config-open]").forEach((el) => el.addEventListener("click", () => this.querySelector("[data-import-config]")?.click()));
    this.querySelectorAll("[data-import-config]").forEach((el) => el.addEventListener("change", async () => {
      const file = el.files?.[0];
      if (!file) return;
      try {
        const snapshot = JSON.parse(await file.text());
        if (!window.confirm(`Zaimportować konfigurację z pliku ${file.name}?`)) return;
        await this.applyConfigurationSnapshot(snapshot);
        window.alert("Konfiguracja została zaimportowana.");
      } catch (error) {
        window.alert(`Błąd importu: ${error.message}`);
      } finally {
        el.value = "";
      }
    }));
    this.querySelectorAll("[data-apply-ai-proposal]").forEach((el) => el.addEventListener("click", () => this.applyAiProposal(slots)));
    this.querySelectorAll("[data-ai-proposal-slot]").forEach((el) => el.addEventListener("change", () => {
      if (!(this._aiProposalSelection instanceof Set)) this._aiProposalSelection = new Set();
      if (el.checked) this._aiProposalSelection.add(el.dataset.aiProposalSlot);
      else this._aiProposalSelection.delete(el.dataset.aiProposalSlot);
      this.render();
    }));
    this.querySelectorAll("[data-ai-select-proposed]").forEach((el) => el.addEventListener("click", () => {
      this._aiProposalSelection = new Set(this.aiProposal(slots).rows.filter((row) => row.enabled).map((row) => row.key));
      this.render();
    }));
    this.querySelectorAll("[data-ai-clear-proposal]").forEach((el) => el.addEventListener("click", () => {
      this._aiProposalSelection = new Set();
      this.render();
    }));
  }

  render() {
    return this.renderV073();
  }
}

customElements.define("deye-energy-manager-card", DeyeEnergyManagerCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: "deye-energy-manager-card", name: "Deye Energy Manager", description: "Deye Energy Manager 0.7.6" });
