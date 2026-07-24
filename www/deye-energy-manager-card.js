class DeyeEnergyManagerCard extends HTMLElement {
  setConfig(config) {
    this.config = config || {};
    this._interacting = false;
    this._pendingRender = false;
    this._dialog = null;
    this._chargeProfileDraft = {};
    this._chargeProfileGridDraft = null;
    this._normalProfileDraft = {};
    this._normalProfilePending = null;
    this._defaultSettingsDraft = {};
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
    this._defaultsApplying = false;
    this._defaultsStatus = "idle";
    this._defaultsMessage = "";
    this._resumeApplying = false;
    this._selectionMode = false;
    this._selectedSlots = new Set();
    this._settingsTab = "defaults";
    this._historyFilters = { from: "", to: "", type: "all" };
    this._lastAiAnalysisCheck = 0;
    this._aiSettingsSaveTimer = null;
    this._updateFrame = null;
    this._lastSlowSignature = "";
    this._tariffDraft = null;
    this._tariffSaveStatus = "";
    this._aiView = "proposals";
    this._aiDay = "today";
    this._aiShow24 = false;
    this._aiWeatherMode = "daily";
    this._aiChartPinned = null;
    this._aiChartHiddenSeries = new Set();
    this._aiSelections = { today: new Set(), tomorrow: new Set() };
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
    if (this._updateFrame) cancelAnimationFrame(this._updateFrame);
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
      if (this._updateFrame) cancelAnimationFrame(this._updateFrame);
      this._updateFrame = requestAnimationFrame(() => {
        this._updateFrame = null;
        this.updateDynamicValues();
      });
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
    if (el && el.textContent !== String(value)) {
      el.textContent = value;
      el.classList.remove("live-changed");
      void el.offsetWidth;
      el.classList.add("live-changed");
    }
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
    this.checkNormalProfilePending();
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
    this.setText("[data-live='pv']", `${this.state(this.entity("sensor", "pv_power"))} W`);
    this.setText("[data-live='load']", `${this.state(this.entity("sensor", "load_power"))} W`);
    this.setText("[data-live='grid']", this.gridFlow(this.state(this.entity("sensor", "grid_power"))));
    this.setText("[data-live='battery-power']", this.batteryFlow(this.state(this.entity("sensor", "battery_power"))));
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

    this.setText("[data-live='target-mode']", this.state(this.entity("sensor", "target_mode")));
    this.setText("[data-live='target-sell-power']", `${this.state(this.entity("sensor", "target_sell_power"))} W`);
    this.setText("[data-live='target-discharge']", `${this.state(this.entity("sensor", "target_discharge_current"))} A`);
    this.setText("[data-live='target-charge']", `${this.state(this.entity("sensor", "target_charge_current"))} A`);
    this.setText("[data-live='current-mode']", this.state(this.entity("sensor", "current_work_mode")));
    this.setText("[data-live='current-sell-power']", `${this.state(this.entity("sensor", "current_sell_power"))} W`);
    this.setText("[data-live='current-discharge']", `${this.state(this.entity("sensor", "current_discharge_current"))} A`);
    this.setText("[data-live='current-charge']", `${this.state(this.entity("sensor", "current_charge_current"))} A`);
    this.setText("[data-live='current-grid-charge']", `${this.state(this.entity("sensor", "current_grid_charge_current"))} A`);

    const slowEntities = [sellPriceToday, sellPriceTomorrow, buyPriceToday, buyPriceTomorrow,
      solcastToday, solcastTomorrow, solcastDay3, solcastDay4, solcastDay5, solcastDay6,
      solcastDay7, solcastRemaining, solcastPeakPower, dailyPvProduction, solcastAccuracy,
      soldEnergyToday, soldValueToday];
    const slowSignature = slowEntities.map((entityId) => {
      const entity = this._hass?.states?.[entityId];
      return `${entityId}:${entity?.state}:${entity?.last_updated || ""}`;
    }).join("|");
    if (slowSignature === this._lastSlowSignature) {
      this.updateToggleButtons();
      return;
    }
    this._lastSlowSignature = slowSignature;

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
    const solcastAccuracyAttrs = this._hass?.states?.[solcastAccuracy]?.attributes || {};
    const forecastProgressValue = this.asNumber(solcastAccuracyAttrs.forecast_progress_percent);
    this.setText("[data-live='solcast-performance-forecast']", this.formatEnergy(solcastForecastValue));
    this.setText("[data-live='solcast-performance-actual']", this.formatEnergy(dailyPvValue));
    this.setText("[data-live='solcast-performance-difference']", this.formatSignedEnergy(solcastDifference));
    this.setText("[data-live='solcast-performance-progress']", forecastProgressValue === null ? "brak" : `${forecastProgressValue.toFixed(1)} %`);
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
    this.syncNormalProfileControls();
  }

  updatePriceTable(scrollKey, todayEntity, tomorrowEntity, threshold = 0, highIsGood = true) {
    const today = this.readPriceMap(todayEntity);
    const tomorrow = this.readPriceMap(tomorrowEntity, false);
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

  readPriceMap(entityId, allowStateFallback = true) {
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

    if (map.size === 0 && allowStateFallback) {
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
    const tomorrow = this.readPriceMap(tomorrowEntity, false);
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
      mode: this.slotEntity("select", key, label, [`slot_${key}_mode`, `${key}_mode`], ["mode"]),
      sellPower: this.slotEntity("number", key, label, [`slot_${key}_sell_power`, `${key}_sell_power`], ["sell", "power"]),
      dischargeCurrent: this.slotEntity("number", key, label, [`slot_${key}_discharge_current`, `${key}_discharge_current`], ["discharge", "current"]),
      chargeCurrent: this.slotEntity("number", key, label, [`slot_${key}_charge_current`, `${key}_charge_current`], ["charge", "current"], ["discharge"]),
      gridChargeCurrent: this.slotEntity("number", key, label, [`slot_${key}_grid_charge_current`, `${key}_grid_charge_current`], ["grid", "charge", "current"]),
      chargeEnabled: this.slotEntity("switch", key, label, [`slot_${key}_charge_enabled`, `${key}_charge_enabled`], ["charge"], ["slot", "enabled"]),
      minimumSellSoc: this.slotEntity("number", key, label, [`slot_${key}_minimum_sell_soc`, `${key}_minimum_sell_soc`], ["minimum", "sell", "soc"]),
      touSoc: this.slotEntity("number", key, label, [`slot_${key}_tou_soc`, `${key}_tou_soc`], ["tou", "battery", "soc"]),
      minSellPrice: this.slotEntity("number", key, label, [`slot_${key}_min_sell_price`, `${key}_min_sell_price`], ["minimum", "sell", "price"]),
    };
  }

  chargeProfileStoredValues() {
    const statusId = this.entity("sensor", "manager_status");
    const profile = this._hass?.states?.[statusId]?.attributes?.charge_profile;
    return profile && typeof profile === "object" ? profile : {};
  }

  chargeProfileNumericValue(entitySuffix, profileKey) {
    const entityId = this.entity("number", entitySuffix);
    const state = this.displayState(entityId, "");
    const known = state && !["unknown", "unavailable", "None", "null"].includes(state);
    if (known) return state;
    const stored = this.chargeProfileStoredValues()[profileKey];
    return Number.isFinite(Number(stored)) ? String(stored) : "brak";
  }

  chargeProfileGridEnabled() {
    if (typeof this._chargeProfileGridDraft === "boolean") return this._chargeProfileGridDraft;
    const state = this.displayState(this.entity("switch", "charge_profile_grid_enabled"), "");
    if (state === "on" || state === "off") return state === "on";
    return Boolean(this.chargeProfileStoredValues().grid_charge_enabled);
  }

  normalProfileStoredValues() {
    const statusId = this.entity("sensor", "manager_status");
    const profile = this._hass?.states?.[statusId]?.attributes?.normal_profile;
    return profile && typeof profile === "object" ? profile : {};
  }

  _numericOrNull(value) {
    if (value === null || value === undefined) return null;
    const str = String(value).trim();
    if (str === "") return null;
    const lower = str.toLowerCase();
    if (lower === "unknown" || lower === "unavailable" || lower === "none" || lower === "null") return null;
    const num = Number(str.replace(",", "."));
    return Number.isFinite(num) ? num : null;
  }

  normalProfileNumericValue(entitySuffix, profileKey) {
    const draft = this._normalProfileDraft[profileKey];
    if (Object.prototype.hasOwnProperty.call(this._normalProfileDraft, profileKey)) {
      const draftNum = this._numericOrNull(draft);
      return draftNum !== null ? String(draftNum) : "";
    }
    if (this._normalProfilePending) {
      const pendingNum = this._numericOrNull(this._normalProfilePending[profileKey]);
      if (pendingNum !== null) return String(pendingNum);
    }
    const entityId = this.entity("number", entitySuffix);
    const state = this.displayState(entityId, "");
    const known = state && !["unknown", "unavailable", "None", "null"].includes(state);
    if (known) return state;
    const stored = this.normalProfileStoredValues()[profileKey];
    const storedNum = this._numericOrNull(stored);
    return storedNum !== null ? String(storedNum) : "";
  }

  normalProfileValues() {
    return {
      sellPower: this.normalProfileNumericValue("normal_profile_sell_power", "sell_power"),
      dischargeCurrent: this.normalProfileNumericValue("normal_profile_discharge_current", "discharge_current"),
      chargeCurrent: this.normalProfileNumericValue("normal_profile_charge_current", "charge_current"),
      gridChargeCurrent: this.normalProfileNumericValue("normal_profile_grid_charge_current", "grid_charge_current"),
      touSoc: this.normalProfileNumericValue("normal_profile_tou_soc", "tou_soc"),
    };
  }

  normalProfileMode() {
    const draft = this._normalProfileDraft.physical_work_mode;
    if (draft) return draft;
    const pending = this._normalProfilePending?.physical_work_mode;
    if (pending) return pending;
    const stored = this.normalProfileStoredValues().physical_work_mode;
    if (stored) return stored;
    const state = this.displayState(this.entity("select", "normal_profile_mode"), "");
    return state && !["unknown", "unavailable", "None", "null"].includes(state) ? state : "";
  }

  _normalProfilePendingMatches(statusProfile) {
    if (!this._normalProfilePending || !statusProfile || typeof statusProfile !== "object") return false;
    const keys = ["physical_work_mode", "sell_power", "discharge_current", "charge_current", "grid_charge_current", "tou_soc"];
    for (const key of keys) {
      const pending = this._normalProfilePending[key];
      const stored = statusProfile[key];
      if (key === "physical_work_mode") {
        if (pending !== stored) return false;
      } else {
        const pendingNum = this._numericOrNull(pending);
        const storedNum = this._numericOrNull(stored);
        if (pendingNum === null && storedNum === null) continue;
        if (pendingNum === null || storedNum === null) return false;
        if (Math.abs(pendingNum - storedNum) > 0.05) return false;
      }
    }
    return true;
  }

  checkNormalProfilePending() {
    if (!this._normalProfilePending) return;
    const statusId = this.entity("sensor", "manager_status");
    const statusProfile = this._hass?.states?.[statusId]?.attributes?.normal_profile;
    if (statusProfile && typeof statusProfile === "object" && this._normalProfilePendingMatches(statusProfile)) {
      this._normalProfilePending = null;
    }
  }

  syncNormalProfileControls() {
    if (!this._dialog || this._dialog.type !== "settings") return;
    const modeSelect = this.querySelector('[data-raw="normal-profile-mode"]');
    if (modeSelect && !this._normalProfileDraft.physical_work_mode) {
      const value = this.normalProfileMode();
      if (value && modeSelect.value !== value) modeSelect.value = value;
    }
    this.querySelectorAll("[data-normal-profile-number]").forEach((el) => {
      const key = el.dataset.normalProfileNumber;
      if (Object.prototype.hasOwnProperty.call(this._normalProfileDraft, key)) return;
      const value = this.normalProfileNumericValue(`normal_profile_${key}`, key);
      if (value !== el.value) el.value = value;
    });
  }

  chargeProfileValues() {
    return {
      chargeCurrent: this.chargeProfileNumericValue("charge_profile_charge_current", "charge_current"),
      dischargeCurrent: this.chargeProfileNumericValue("charge_profile_discharge_current", "discharge_current"),
      gridChargeCurrent: this.chargeProfileNumericValue("charge_profile_grid_charge_current", "grid_charge_current"),
      targetSoc: this.chargeProfileNumericValue("charge_profile_target_soc", "target_soc"),
      gridEnabled: this.chargeProfileGridEnabled(),
    };
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

  callService(domain, service, data = {}) {
    return this._hass.callService(domain, service, data);
  }

  async applySchedulePatch(updates) {
    if (!Array.isArray(updates) || !updates.length) return false;
    if (!this.hasService("deye_energy_manager", "apply_schedule_patch")) return false;
    this.beginSave();
    try {
      await this.callService("deye_energy_manager", "apply_schedule_patch", { data: JSON.stringify(updates) });
      this.finishSave();
      return true;
    } catch (error) {
      this.failSave("schedule_patch", error);
      return false;
    }
  }

  hasService(domain, service) {
    return Boolean(this._hass?.services?.[domain]?.[service]);
  }

  updateSaveIndicator() {
    const el = this.querySelector("[data-save-indicator]");
    if (!el) return;
    el.className = `save-indicator ${this._saveStatus}`;
    el.textContent = this._saveStatus === "saving"
      ? this._saveMessage || "Zapisywanie..."
      : this._saveStatus === "saved"
        ? this._saveMessage || "Zapisano"
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

  updateDefaultApplyState() {
    this.querySelectorAll("[data-default-action]").forEach((button) => {
      button.disabled = this._defaultsApplying;
      button.textContent = this._defaultsApplying
        ? "Stosowanie ustawień domyślnych…"
        : button.dataset.defaultLabel || "Zastosuj ustawienia domyślne";
    });
    this.querySelectorAll("[data-defaults-status]").forEach((status) => {
      status.className = `hint defaults-status ${this._defaultsStatus}`;
      status.textContent = this._defaultsMessage;
      status.hidden = !this._defaultsMessage;
    });
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
    const raw = String(value).trim().replace(",", ".");
    if (!raw) return Promise.resolve(false);
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !this.exists(entityId)) return Promise.resolve(false);
    return this.optimisticService(entityId, parsed, "number", "set_value", { entity_id: entityId, value: parsed });
  }

  async saveChargeProfile() {
    const helpers = {
      charge_current: this.entity("number", "charge_profile_charge_current"),
      discharge_current: this.entity("number", "charge_profile_discharge_current"),
      grid_charge_current: this.entity("number", "charge_profile_grid_charge_current"),
      target_soc: this.entity("number", "charge_profile_target_soc"),
      grid_charge_enabled: this.entity("switch", "charge_profile_grid_enabled"),
    };
    const missing = Object.values(helpers).filter((entityId) => !this.exists(entityId));
    if (missing.length) {
      this.failSave("charge_profile", new Error(`Brak encji profilu ładowania: ${missing.join(", ")}`));
      return false;
    }
    const fields = [...this.querySelectorAll("[data-charge-profile-number]")];
    const values = {};
    for (const field of fields) {
      const value = Number(String(field.value).replace(",", "."));
      if (!Number.isFinite(value)) {
        this.failSave("charge_profile", new Error("Wprowadź poprawne wartości profilu ładowania"));
        return false;
      }
      values[field.dataset.chargeProfileNumber] = value;
    }
    values.grid_charge_enabled = typeof this._chargeProfileGridDraft === "boolean"
      ? this._chargeProfileGridDraft
      : this.rawValue("charge-profile-grid", "off") === "on";
    this.beginSave();
    try {
      await this.callService("deye_energy_manager", "save_charge_profile", values);
      Object.entries(values).forEach(([key, value]) => {
        const entityId = helpers[key];
        this._optimisticStates[entityId] = key === "grid_charge_enabled"
          ? (value ? "on" : "off")
          : String(value);
      });
      this._chargeProfileDraft = {};
      this._chargeProfileGridDraft = null;
      this.finishSave();
      this.captureScrollPositions();
      this.render();
      return true;
    } catch (error) {
      this.failSave("charge_profile", error);
      return false;
    }
  }

  async saveNormalProfile() {
    const physical_work_mode = this.rawValue("normal-profile-mode", "");
    if (!physical_work_mode) {
      this.failSave("normal_profile", new Error("Nie wybrano fizycznego trybu Deye dla normalnej pracy"));
      return false;
    }
    const fields = [...this.querySelectorAll("[data-normal-profile-number]")];
    const values = { physical_work_mode };
    for (const field of fields) {
      const raw = String(field.value).trim();
      if (raw === "") {
        this.failSave("normal_profile", new Error("Wprowadź poprawne wartości profilu normalnej pracy"));
        return false;
      }
      const value = Number(raw.replace(",", "."));
      if (!Number.isFinite(value)) {
        this.failSave("normal_profile", new Error("Wprowadź poprawne wartości profilu normalnej pracy"));
        return false;
      }
      values[field.dataset.normalProfileNumber] = value;
    }
    if (values.tou_soc === undefined || values.tou_soc < 0 || values.tou_soc > 100) {
      this.failSave("normal_profile", new Error("Brak poprawnej wartości SOC baterii Deye TOU"));
      return false;
    }
    this._normalProfilePending = { ...values };
    this.beginSave();
    try {
      await this.callService("deye_energy_manager", "save_normal_profile", values);
      this._normalProfileDraft = {};
      this.finishSave();
      this.captureScrollPositions();
      this.render();
      return true;
    } catch (error) {
      this._normalProfilePending = null;
      this.failSave("normal_profile", error);
      return false;
    }
  }

  async reloadNormalProfileSlot(slotKey) {
    if (!slotKey) return false;
    this.beginSave();
    try {
      await this.callService("deye_energy_manager", "apply_schedule_patch", {
        data: JSON.stringify([{
          slot_key: slotKey,
          mode: "Normalna Praca",
          force_copy_normal_profile: true,
        }]),
      });
      this.finishSave();
      this.captureScrollPositions();
      this.render();
      return true;
    } catch (error) {
      this.failSave("schedule_patch", error);
      return false;
    }
  }

  setSelect(entityId, option) {
    if (!this.exists(entityId)) return Promise.resolve(false);
    // The mode never implies permission to charge from the grid.  That
    // permission is controlled solely by „Ładowanie z sieci” in the shared
    // Charge profile.
    return this.optimisticService(entityId, option, "select", "select_option", { entity_id: entityId, option });
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
      ${merged.map((option) => `<option value="${this.escapeHtml(option)}" ${option === current ? "selected" : ""}>${this.escapeHtml(option)}</option>`).join("")}
    </select>`;
  }

  numberInput(entityId, unit = "") {
    return `<label class="field">
      <input data-number="${this.escapeHtml(entityId)}" type="text" inputmode="decimal" value="${this.escapeHtml(this.numberState(entityId))}" ${this.exists(entityId) ? "" : "disabled"}>
      <span>${this.escapeHtml(unit)}</span>
    </label>`;
  }

  touSocInput(entityId) {
    // A missing physical TOU SOC is intentionally not shown as zero.  Zero is
    // valid only when the user explicitly enters it and the Deye entity allows
    // it; migration never guesses this physical setting.
    const state = this.displayState(entityId, "");
    const known = state && !["unknown", "unavailable", "None", "null"].includes(state);
    return `<label class="field">
      <input data-number="${this.escapeHtml(entityId)}" type="text" inputmode="decimal" value="${this.escapeHtml(known ? state : "")}" placeholder="wymaga potwierdzenia" ${this.exists(entityId) ? "" : "disabled"}>
      <span>%</span>
    </label>`;
  }

  chargeProfileInput(name, entityId, unit = "") {
    const entity = this._hass.states[entityId];
    const profile = this.chargeProfileValues();
    const profileKeys = { charge_current: "chargeCurrent", discharge_current: "dischargeCurrent", grid_charge_current: "gridChargeCurrent", target_soc: "targetSoc" };
    const fallback = name === "target_soc" ? { min: 0, max: 100, step: 1 } : { min: 0, max: 240, step: 1 };
    const current = entity && !["unknown", "unavailable", ""].includes(entity.state) ? entity.state : profile[profileKeys[name]];
    const value = Object.prototype.hasOwnProperty.call(this._chargeProfileDraft, name) ? this._chargeProfileDraft[name] : current;
    const rawMin = Number(entity?.attributes?.min);
    const rawMax = Number(entity?.attributes?.max);
    const rawStep = Number(entity?.attributes?.step);
    const min = Number.isFinite(rawMin) ? rawMin : fallback.min;
    const max = Number.isFinite(rawMax) ? rawMax : fallback.max;
    const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : fallback.step;
    return `<label class="field">
      <input data-charge-profile-number="${this.escapeHtml(name)}" type="number" inputmode="decimal" value="${this.escapeHtml(value ?? "")}" min="${min}" max="${max}" step="${step}">
      <span>${this.escapeHtml(unit)}</span>
    </label>`;
  }

  defaultProfileInput(name, entityId, unit = "") {
    const entity = this._hass.states[entityId];
    const current = entity && !["unknown", "unavailable"].includes(entity.state) ? entity.state : "";
    const value = Object.prototype.hasOwnProperty.call(this._defaultSettingsDraft, name)
      ? this._defaultSettingsDraft[name] : current;
    const min = Number(entity?.attributes?.min);
    const max = Number(entity?.attributes?.max);
    const step = Number(entity?.attributes?.step);
    const range = Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(step) && step > 0;
    return `<label class="field"><input data-default-profile-number="${this.escapeHtml(name)}" type="number" inputmode="decimal" value="${this.escapeHtml(value)}" ${range ? `min="${min}" max="${max}" step="${step}"` : ""} ${this.exists(entityId) && current !== "" && range ? "" : "disabled"}><span>${this.escapeHtml(unit)}</span></label>`;
  }

  normalProfileInput(name, entityId, unit = "") {
    const profile = this.normalProfileValues();
    const profileKeys = {
      sell_power: "sellPower",
      discharge_current: "dischargeCurrent",
      charge_current: "chargeCurrent",
      grid_charge_current: "gridChargeCurrent",
      tou_soc: "touSoc",
    };
    const fallback = {
      sell_power: { min: 0, max: 13000, step: 1 },
      discharge_current: { min: 0, max: 240, step: 0.1 },
      charge_current: { min: 0, max: 240, step: 0.1 },
      grid_charge_current: { min: 0, max: 240, step: 0.1 },
      tou_soc: { min: 0, max: 100, step: 1 },
    };
    const current = profile[profileKeys[name]];
    const value = Object.prototype.hasOwnProperty.call(this._normalProfileDraft, name)
      ? this._normalProfileDraft[name] : current;
    const entity = this._hass.states[entityId];
    const rawMin = Number(entity?.attributes?.min);
    const rawMax = Number(entity?.attributes?.max);
    const rawStep = Number(entity?.attributes?.step);
    const fb = fallback[name] || { min: 0, max: 100, step: 1 };
    const min = Number.isFinite(rawMin) ? rawMin : fb.min;
    const max = Number.isFinite(rawMax) ? rawMax : fb.max;
    const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : fb.step;
    return `<label class="field"><input data-normal-profile-number="${this.escapeHtml(name)}" type="number" inputmode="decimal" value="${this.escapeHtml(value ?? "")}" min="${min}" max="${max}" step="${step}"><span>${this.escapeHtml(unit)}</span></label>`;
  }

  async saveDefaultSettings() {
    const values = { mode: this.rawValue("default-work-mode", "") };
    for (const field of this.querySelectorAll("[data-default-profile-number]")) {
      const value = Number(String(field.value).replace(",", "."));
      if (!Number.isFinite(value)) {
        this.failSave("default_settings", new Error("Wprowadź poprawne wartości ustawień domyślnych"));
        return false;
      }
      values[field.dataset.defaultProfileNumber] = value;
    }
    this.beginSave();
    try {
      await this.callService("deye_energy_manager", "save_default_settings", values);
      this._defaultSettingsDraft = {};
      this.finishSave();
      return true;
    } catch (error) {
      this.failSave("default_settings", error);
      return false;
    }
  }

  rawSelect(name, options = [], value = "") {
    return `<select data-raw="${name}">
      ${options.map((option) => {
        const optionValue = Array.isArray(option) ? option[0] : option;
        const optionLabel = Array.isArray(option) ? option[1] : option;
        return `<option value="${this.escapeHtml(optionValue)}" ${optionValue === value ? "selected" : ""}>${this.escapeHtml(optionLabel)}</option>`;
      }).join("")}
    </select>`;
  }

  rawNumber(name, value = 0, unit = "") {
    return `<label class="field">
      <input data-raw="${this.escapeHtml(name)}" type="text" inputmode="decimal" value="${this.escapeHtml(value)}">
      <span>${this.escapeHtml(unit)}</span>
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
    try {
      localStorage.setItem("deye_energy_manager_ai_settings_v073", JSON.stringify(settings));
    } catch (_err) {
      // LocalStorage can be blocked in some HA webviews. In that case the UI still works for this render.
    }
    window.clearTimeout(this._aiSettingsSaveTimer);
    this._aiSettingsSaveTimer = window.setTimeout(() => {
      this.callService("deye_energy_manager", "save_ai_settings", { data: JSON.stringify(this._aiSettingsCache) });
    }, 400);
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
        cheapBuy48: (ai.cheapBuy48 || []).slice(0, 6),
        tariff: {
          provider: ai.tariff?.provider,
          plan: ai.tariff?.plan,
          catalog_version: ai.tariff?.catalog_version,
        },
        solcastToday: ai.solcastToday,
        solcastRemaining: ai.solcastRemaining,
        dailyPv: ai.dailyPv,
        forecastCorrection: ai.forecastCorrection,
        weatherRiskFactor: ai.weatherRiskFactor,
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
    const tariff = this.tariffData();
    return {
      format: "deye-energy-manager-config",
      version: "0.7.6",
      created_at: new Date().toISOString(),
      values,
      ai_settings: this.aiSettings(),
      tariff_settings: {
        tariff_mode: tariff.mode || "automatic",
        osd_provider: tariff.provider || "pge",
        tariff_plan: tariff.plan || "g11",
        distribution_peak_rate: tariff.peak_rate ?? 0,
        distribution_offpeak_rate: tariff.offpeak_rate ?? 0,
        custom_offpeak_windows: tariff.custom_offpeak_windows || "13:00-15:00,22:00-06:00",
        price_source: tariff.price_source || "pstryk",
        price_includes_distribution: Boolean(tariff.price_includes_distribution),
        grid_positive_is_import: tariff.grid_positive_is_import !== false,
        battery_positive_is_discharge: tariff.battery_positive_is_discharge !== false,
      },
      card: { theme: this.config?.theme || "deye" },
    };
  }

  async applyConfigurationSnapshot(snapshot) {
    if (!snapshot || snapshot.format !== "deye-energy-manager-config" || typeof snapshot.values !== "object") throw new Error("Nieprawidłowy plik konfiguracji");
    const controlMode = this.entity("select", "control_mode");
    const scheduler = this.entity("switch", "scheduler");
    const chargeScheduler = this.entity("switch", "charge_scheduler");
    const deferred = new Set([controlMode, scheduler, chargeScheduler].filter(Boolean));
    if (this.exists(controlMode)) {
      await this.callService("select", "select_option", { entity_id: controlMode, option: "Stop Sell" });
    }
    if (this.exists(scheduler)) await this.callService("switch", "turn_off", { entity_id: scheduler });
    if (this.exists(chargeScheduler)) await this.callService("switch", "turn_off", { entity_id: chargeScheduler });
    for (const [entityId, value] of Object.entries(snapshot.values)) {
      if (!this.exists(entityId) || deferred.has(entityId)) continue;
      const domain = entityId.split(".")[0];
      if (["switch", "input_boolean"].includes(domain)) await this.callService(domain, value === "on" ? "turn_on" : "turn_off", { entity_id: entityId });
      else if (["select", "input_select"].includes(domain)) await this.callService(domain, "select_option", { entity_id: entityId, option: value });
      else if (["number", "input_number"].includes(domain)) await this.callService(domain, "set_value", { entity_id: entityId, value: Number(value) });
      else if (domain === "time") await this.callService(domain, "set_value", { entity_id: entityId, time: String(value).slice(0, 8) });
      else if (domain === "input_datetime") await this.callService(domain, "set_datetime", { entity_id: entityId, time: String(value).slice(0, 8) });
    }
    if (snapshot.ai_settings && typeof snapshot.ai_settings === "object") this.saveAiSettings(snapshot.ai_settings);
    if (snapshot.tariff_settings && typeof snapshot.tariff_settings === "object") {
      await this.callService("deye_energy_manager", "save_tariff_settings", { data: JSON.stringify(snapshot.tariff_settings) });
    }
    for (const entityId of [chargeScheduler, scheduler]) {
      if (!entityId || !this.exists(entityId) || !(entityId in snapshot.values)) continue;
      await this.callService("switch", snapshot.values[entityId] === "on" ? "turn_on" : "turn_off", { entity_id: entityId });
    }
    if (controlMode && this.exists(controlMode) && controlMode in snapshot.values) {
      await this.callService("select", "select_option", { entity_id: controlMode, option: snapshot.values[controlMode] });
    }
  }

  exportConfiguration() {
    const snapshot = this.configurationSnapshot();
    this.downloadHistory(`deye-konfiguracja-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(snapshot, null, 2), "application/json");
  }

  createConfigurationBackup() {
    const snapshot = this.configurationSnapshot();
    localStorage.setItem("deye_energy_manager_config_backup_v076", JSON.stringify(snapshot));
    this.downloadHistory(`deye-kopia-zapasowa-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(snapshot, null, 2), "application/json");
  }

  async restoreConfigurationBackup() {
    const raw = localStorage.getItem("deye_energy_manager_config_backup_v076") || localStorage.getItem("deye_energy_manager_config_backup_v074");
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
    const entityRows = required.length ? required.map((item) => `<tr><td>${this.escapeHtml(item.entity_id)}</td><td><span class="diag-badge ${item.ok ? "ok" : "error"}">${item.ok ? "OK" : this.escapeHtml(item.state)}</span></td></tr>`).join("") : `<tr><td colspan="2">Brak danych diagnostycznych. Uruchom ponownie Home Assistant.</td></tr>`;
    const connected = attrs.connected === true;
    const mappingSegments = attrs.mapping_segments ?? this.scheduleSegments(slots).length;
    const tou = attrs.tou || {};
    const missingTou = Array.isArray(tou.missing) ? tou.missing : [];
    const attempt = attrs.last_schedule_attempt && typeof attrs.last_schedule_attempt === "object" ? attrs.last_schedule_attempt : null;
    const activeControl = attrs.active_slot_control && typeof attrs.active_slot_control === "object" ? attrs.active_slot_control : {};
    const physicalTou = Array.isArray(attrs.physical_tou) ? attrs.physical_tou : [];
    const diagnosticValue = (value) => value === null || value === undefined || value === "" ? "brak" : String(value);
    const renderValues = (values) => Object.entries(values || {}).map(([label, value]) => `<li><span>${this.escapeHtml(label)}</span><strong>${this.escapeHtml(String(value))}</strong></li>`).join("") || "<li>Brak danych</li>";
    const attemptSection = attempt?.status ? `<section class="diagnostic-section"><h3>Ostatnia pr\u00f3ba zastosowania harmonogramu</h3><div class="schedule-attempt ${attempt.status === "failed" ? "failed" : "ok"}"><div><span>Wynik</span><strong>${attempt.status === "failed" ? "Nieudana" : attempt.status === "applied" ? "Potwierdzona" : "W toku"}</strong></div><div><span>Czas / slot</span><strong>${this.formatAppliedAt(attempt.at)} \u00b7 ${this.escapeHtml(attempt.slot || "brak")}</strong></div><div><span>Etap</span><strong>${this.escapeHtml(attempt.stage || "brak")}</strong></div><div class="schedule-attempt-message"><span>Szczeg\u00f3\u0142y</span><strong>${this.escapeHtml(attempt.message || "Brak dodatkowej informacji")}</strong></div><div><span>Oczekiwane</span><ul>${renderValues(attempt.expected)}</ul></div><div><span>Odczytane</span><ul>${renderValues(attempt.actual)}</ul></div></div></section>` : "";
    const currentRows = Object.entries(activeControl.currents || {}).map(([name, value]) => `<tr><td>${this.escapeHtml(name)}</td><td>${this.escapeHtml(diagnosticValue(value))}</td></tr>`).join("") || `<tr><td colspan="2">Brak danych o pr\u0105dach</td></tr>`;
    const activeControlSection = `<section class="diagnostic-section"><h3>SOC i parametry aktywnego slotu</h3><div class="schedule-attempt"><div><span>Slot / tryb</span><strong>${this.escapeHtml(diagnosticValue(activeControl.slot))} \u00b7 ${this.escapeHtml(diagnosticValue(activeControl.mode))}</strong></div><div><span>Minimalny SOC sprzeda\u017cy</span><strong>${this.escapeHtml(diagnosticValue(activeControl.minimum_sell_soc))}%</strong></div><div><span>SOC logiczny Deye TOU</span><strong>${this.escapeHtml(diagnosticValue(activeControl.tou_soc))}%</strong></div><div><span>Docelowy SOC profilu Charge</span><strong>${this.escapeHtml(diagnosticValue(activeControl.charge_profile_target_soc))}%</strong></div><div><span>Efektywny SOC TOU</span><strong>${this.escapeHtml(diagnosticValue(activeControl.effective_tou_soc))}%</strong></div><div><span>Fizyczny zakres / odczyt SOC</span><strong>${this.escapeHtml(diagnosticValue(activeControl.physical_range))} \u00b7 ${this.escapeHtml(diagnosticValue(activeControl.physical_soc_actual))}%</strong></div><div><span>Grid Charge oczekiwany / odczytany</span><strong>${activeControl.grid_charge_expected ? "TAK" : "NIE"} \u00b7 ${this.escapeHtml(diagnosticValue(activeControl.grid_charge_actual))}</strong></div><div class="schedule-attempt-message"><span>Pr\u0105dy oczekiwane i odczytane</span><table class="settings-table"><tbody>${currentRows}</tbody></table></div></div></section>`;
    const physicalRows = physicalTou.map((row) => `<tr class="${row.active ? "active" : ""}"><td>${this.escapeHtml(diagnosticValue(row.range))}</td><td>${this.escapeHtml(diagnosticValue(row.expected_start))}\u2013${this.escapeHtml(diagnosticValue(row.expected_end))}</td><td>${this.escapeHtml(diagnosticValue(row.expected_soc))}% / ${this.escapeHtml(diagnosticValue(row.actual_soc))}%</td><td>${row.expected_grid_charge ? "TAK" : "NIE"} / ${this.escapeHtml(diagnosticValue(row.actual_grid_charge))}</td></tr>`).join("") || `<tr><td colspan="4">Brak danych fizycznego mapowania</td></tr>`;
    const physicalSection = `<section class="diagnostic-section"><h3>Fizyczne zakresy Deye TOU</h3><div class="diagnostic-entities"><table class="settings-table"><thead><tr><th>Zakres</th><th>Oczekiwane godziny</th><th>SOC oczekiwany / odczytany</th><th>Grid oczekiwany / odczytany</th></tr></thead><tbody>${physicalRows}</tbody></table></div></section>`;
    const touSection = `<section class="diagnostic-section"><h3>Mapowanie Deye Time Of Use</h3><div class="tou-diagnostics"><span class="diag-badge ${tou.ok === false ? "error" : "ok"}">${tou.ok === false ? "B\u0141\u0104D" : "OK"}</span><strong>${tou.ok === false ? `Brakuje encji: ${this.escapeHtml(missingTou.join(", "))}` : "Wszystkie encje Time Of Use s\u0105 dost\u0119pne"}</strong></div></section>`;
    return `<div class="diagnostic-summary">
      <div><span>Po\u0142\u0105czenie z falownikiem</span><strong class="${connected ? "good" : "bad"}">${connected ? "Po\u0142\u0105czono" : "Problem"}</strong></div>
      <div><span>Stan managera</span><strong class="${this.readMode(attrs.manager_status || "NO DATA")[1]}">${this.readMode(attrs.manager_status || "NO DATA")[0]}</strong></div>
      <div><span>Slot harmonogramu</span><strong>${attrs.active_slot || "brak"} \u00b7 nast\u0119pny ${attrs.next_active_slot || "brak"}</strong></div>
      <div><span>Harmonogram i mapowanie</span><strong class="${attrs.mapping_status === "OK" ? "good" : "bad"}">${attrs.mapping_status || "brak"} \u00b7 ${mappingSegments}/6</strong></div>
      <div><span>Ostatni zapis</span><strong>${this.formatAppliedAt(attrs.last_saved_at)}</strong></div>
      <div><span>Ostatnie zastosowanie</span><strong>${this.formatAppliedAt(attrs.last_applied_at)}</strong></div>
      <div><span>Ostatni b\u0142\u0105d</span><strong class="${attrs.last_error && attrs.last_error !== "none" ? "bad" : "good"}">${attrs.last_error && attrs.last_error !== "none" ? this.escapeHtml(attrs.last_error) : "Brak"}</strong></div>
      <div><span>Wersje</span><strong>Integracja ${this.escapeHtml(attrs.integration_version || "0.7.6")} \u00b7 karta 0.7.6</strong></div>
    </div>
    ${attemptSection}
    ${activeControlSection}
    ${physicalSection}
    ${touSection}
    <section class="diagnostic-section"><h3>Wymagane encje</h3><div class="diagnostic-entities"><table class="settings-table"><thead><tr><th>Encja</th><th>Stan</th></tr></thead><tbody>${entityRows}</tbody></table></div></section>
    <section class="diagnostic-section"><h3>Sterowanie i odczyt</h3><div class="diagnostic-actions"><button class="resume" data-resume-manager="1" ${this._resumeApplying ? "disabled" : ""}>${this._resumeApplying ? "W\u0142\u0105czanie Managera\u2026" : "W\u0142\u0105cz Manager i harmonogram"}</button><button data-system-defaults="1" data-default-action="1" data-default-label="Zatrzymaj managera i zastosuj domy\u015blne" ${this._defaultsApplying ? "disabled" : ""}>${this._defaultsApplying ? "Stosowanie ustawie\u0144 domy\u015blnych\u2026" : "Zatrzymaj managera i zastosuj domy\u015blne"}</button><button data-refresh-entities="1">Ponownie odczytaj encje</button></div><p class="hint">W\u0142\u0105czenie Managera ustawia tryb Schedule i Scheduler. Nie w\u0142\u0105cza oddzielnego harmonogramu \u0142adowania z sieci.</p></section>
    <section class="diagnostic-section"><h3>Konfiguracja i kopia zapasowa</h3><div class="diagnostic-actions"><button data-export-config="1">Eksport konfiguracji</button><button data-import-config-open="1">Import konfiguracji</button><input type="file" accept="application/json,.json" data-import-config hidden><button data-create-backup="1">Utw\u00f3rz kopi\u0119 zapasow\u0105</button><button data-restore-backup="1">Przywr\u00f3\u0107 kopi\u0119</button><button class="danger" data-restore-defaults="1" data-default-action="1" data-default-label="Przywr\u00f3\u0107 ustawienia domy\u015blne" ${this._defaultsApplying ? "disabled" : ""}>${this._defaultsApplying ? "Stosowanie ustawie\u0144 domy\u015blnych\u2026" : "Przywr\u00f3\u0107 ustawienia domy\u015blne"}</button></div><div class="hint defaults-status ${this._defaultsStatus}" data-defaults-status ${this._defaultsMessage ? "" : "hidden"}>${this.escapeHtml(this._defaultsMessage)}</div></section>`;
  }

  aiCheck(name, label, value) {
    return `<div class="settings-row"><span>${label}</span><input data-ai-setting="${name}" type="checkbox" ${value ? "checked" : ""}></div>`;
  }

  tariffData() {
    const tariffState = this._hass?.states?.[this.entity("sensor", "tariff_status")];
    const aiState = this._hass?.states?.[this.entity("sensor", "ai_state")];
    return tariffState?.attributes || aiState?.attributes?.learning_summary?.tariff || aiState?.attributes?.tariff || {};
  }

  tariffZoneLabel(zone) {
    return {
      all_day: "Całodobowa", peak: "Szczytowa", offpeak: "Tania / pozaszczytowa",
      morning_peak: "Szczyt przedpołudniowy", afternoon_peak: "Szczyt popołudniowy",
      day_peak: "Dzienna szczytowa", day_offpeak: "Dzienna pozaszczytowa", night: "Nocna",
      recommended: "Zalecany pobór", restriction: "Zalecane ograniczenie", normal: "Pozostałe godziny",
      other: "Pozostałe godziny", dynamic_unavailable: "Brak sygnału dynamicznego",
    }[zone] || String(zone || "brak");
  }

  localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  collectTariffDraft() {
    const draft = { ...(this._tariffDraft || {}) };
    this.querySelectorAll("[data-tariff-field]").forEach((el) => {
      const key = el.dataset.tariffField;
      if (el.type === "checkbox") draft[key] = el.checked;
      else if (["distribution_peak_rate", "distribution_offpeak_rate"].includes(key)) draft[key] = this.asNumber(el.value) ?? el.value;
      else draft[key] = el.value;
    });
    this._tariffDraft = draft;
    return draft;
  }

  async saveTariffSettings() {
    const button = this.querySelector("[data-save-tariff]");
    if (button) button.disabled = true;
    try {
      const data = this.collectTariffDraft();
      await this.callService("deye_energy_manager", "save_tariff_settings", { data: JSON.stringify(data) });
      this._tariffDraft = null;
      this._tariffSaveStatus = "Zapisano. Profil i sugestie AI korzystają z nowych ustawień.";
    } catch (error) {
      this._tariffSaveStatus = `Błąd zapisu: ${error?.message || error}`;
    }
    this.render();
  }

  renderTariffTab() {
    const tariff = this.tariffData();
    const draft = {
      tariff_mode: tariff.mode || "automatic",
      osd_provider: tariff.provider || "pge",
      tariff_plan: tariff.plan || "g11",
      price_source: tariff.price_source || "pstryk",
      price_includes_distribution: Boolean(tariff.price_includes_distribution),
      distribution_peak_rate: tariff.peak_rate ?? 0,
      distribution_offpeak_rate: tariff.offpeak_rate ?? 0,
      custom_offpeak_windows: tariff.custom_offpeak_windows || "13:00-15:00,22:00-06:00",
      grid_positive_is_import: tariff.grid_positive_is_import !== false,
      battery_positive_is_discharge: tariff.battery_positive_is_discharge !== false,
      ...(this._tariffDraft || {}),
    };
    const providers = Array.isArray(tariff.providers) ? tariff.providers : [];
    const selectedProvider = providers.find((item) => item.id === draft.osd_provider);
    const tariffs = selectedProvider?.tariffs || (Array.isArray(tariff.tariffs) ? tariff.tariffs : []);
    if (tariffs.length && !tariffs.some((item) => item.id === draft.tariff_plan)) draft.tariff_plan = tariffs[0].id;
    const options = (rows, selected) => rows.map((item) => {
      const reason = item.available === false && item.unavailable_reason ? ` — ${item.unavailable_reason}` : "";
      const disabled = item.available === false && item.id !== selected ? "disabled" : "";
      return `<option value="${this.escapeHtml(item.id)}" ${item.id === selected ? "selected" : ""} ${disabled}>${this.escapeHtml(`${item.name}${reason}`)}</option>`;
    }).join("");
    const rows = Array.isArray(tariff.hourly_profile) ? tariff.hourly_profile : [];
    const profileRows = rows.map((row) => `<tr>
      <td>${this.escapeHtml(row.date || "")}</td><td>${this.escapeHtml(row.label || this.hourLabel(Number(row.hour)))}</td>
      <td>${this.escapeHtml(this.tariffZoneLabel(row.zone))}</td><td>${this.formatNumber(row.rate, 4)}</td>
      <td>${this.formatNumber(row.common_rate, 4)}</td><td>${this.formatNumber(row.total_distribution_rate ?? row.rate, 4)}</td>
      <td>${row.holiday ? "święto" : row.weekend ? "weekend" : "dzień roboczy"}</td>
    </tr>`).join("");
    const statusClass = tariff.catalog_error ? "bad" : tariff.configured ? "good" : "warn";
    const manual = draft.tariff_mode === "manual";
    return `<div class="hint">Operator, taryfa i stawki są zapisywane dopiero przyciskiem <b>Zapisz ustawienia</b>. Profil obejmuje dziś i jutro; weekendy, święta i sezony są wyliczane automatycznie.</div>
      <div class="diagnostic-summary"><div><span>Operator OSD</span><strong>${this.escapeHtml(tariff.provider_name || "brak")}</strong></div><div><span>Taryfa / sezon</span><strong>${this.escapeHtml(tariff.plan_name || "brak")} · ${tariff.season === "summer" ? "lato" : tariff.season === "winter" ? "zima" : "brak"}</strong></div><div><span>Bieżąca strefa</span><strong>${this.escapeHtml(this.tariffZoneLabel(tariff.zone))} · ${this.formatNumber(tariff.total_distribution_rate ?? tariff.distribution_rate, 4)} PLN/kWh</strong></div><div><span>Katalog</span><strong class="${statusClass}">${this.escapeHtml(tariff.catalog_version || "wbudowany")} · ${this.escapeHtml(tariff.catalog_source || "brak")}</strong></div></div>
      <section class="diagnostic-section"><h3>Ustawienia operatora i taryfy</h3>
        <div class="settings-row"><span>Tryb stawek</span><select data-tariff-field="tariff_mode"><option value="automatic" ${!manual ? "selected" : ""}>Automatyczny katalog OSD</option><option value="manual" ${manual ? "selected" : ""}>Profil ręczny</option></select></div>
        <div class="settings-row"><span>Operator OSD</span><select data-tariff-field="osd_provider">${options(providers, draft.osd_provider)}</select></div>
        <div class="settings-row"><span>Taryfa</span><select data-tariff-field="tariff_plan">${options(tariffs, draft.tariff_plan)}</select></div>
        <div class="settings-row"><span>Źródło cen energii</span><select data-tariff-field="price_source"><option value="pstryk" ${draft.price_source === "pstryk" ? "selected" : ""}>Pstryk</option><option value="pse_rce" ${draft.price_source === "pse_rce" ? "selected" : ""}>PSE / RCE</option><option value="other" ${draft.price_source === "other" ? "selected" : ""}>Inne</option><option value="none" ${draft.price_source === "none" ? "selected" : ""}>Bez cen energii</option></select></div>
        <div class="settings-row"><span>Cena zakupu zawiera już dystrybucję</span><input data-tariff-field="price_includes_distribution" type="checkbox" ${draft.price_includes_distribution ? "checked" : ""}></div>
        <div class="settings-row"><span>Stawka szczytowa [PLN/kWh]</span><input data-tariff-field="distribution_peak_rate" type="text" inputmode="decimal" value="${this.escapeHtml(draft.distribution_peak_rate)}" ${manual ? "" : "disabled"}></div>
        <div class="settings-row"><span>Stawka tania [PLN/kWh]</span><input data-tariff-field="distribution_offpeak_rate" type="text" inputmode="decimal" value="${this.escapeHtml(draft.distribution_offpeak_rate)}" ${manual ? "" : "disabled"}></div>
        <div class="settings-row"><span>Własne tanie godziny</span><input data-tariff-field="custom_offpeak_windows" type="text" value="${this.escapeHtml(draft.custom_offpeak_windows)}" ${manual ? "" : "disabled"}></div>
        <div class="settings-row"><span>Dodatnia moc sieci oznacza pobór</span><input data-tariff-field="grid_positive_is_import" type="checkbox" ${draft.grid_positive_is_import ? "checked" : ""}></div>
        <div class="settings-row"><span>Dodatnia moc baterii oznacza rozładowanie</span><input data-tariff-field="battery_positive_is_discharge" type="checkbox" ${draft.battery_positive_is_discharge ? "checked" : ""}></div>
        <div class="diagnostic-actions"><button class="wide-action" data-save-tariff="1">Zapisz ustawienia</button><button data-refresh-tariff="1">Sprawdź aktualizację katalogu</button></div>
        ${this._tariffSaveStatus ? `<div class="hint">${this.escapeHtml(this._tariffSaveStatus)}</div>` : ""}
        ${tariff.catalog_error ? `<div class="hint bad">${this.escapeHtml(tariff.catalog_error)}. Używany jest ostatni poprawny katalog.</div>` : ""}
        ${tariff.tariff_error ? `<div class="hint bad">Wybrany profil nie jest dostępny: ${this.escapeHtml(tariff.tariff_error)}. AI nie użyje go do planowania ładowania.</div>` : ""}
      </section>
      <section class="diagnostic-section"><h3>Profil kosztu dystrybucji — dziś i jutro</h3><div class="diagnostic-entities"><table class="settings-table"><thead><tr><th>Data</th><th>Godzina</th><th>Strefa</th><th>Sieciowa</th><th>Opłaty zmienne</th><th>Razem</th><th>Rodzaj dnia</th></tr></thead><tbody>${profileRows || '<tr><td colspan="7">Brak profilu. Wybierz operatora i taryfę, a następnie zapisz.</td></tr>'}</tbody></table></div></section>`;
  }

  aiNumber(name, label, value, unit = "") {
    return `<div class="settings-row"><span>${label}</span><label class="field compact-field"><input data-ai-setting="${this.escapeHtml(name)}" type="text" inputmode="decimal" value="${this.escapeHtml(value)}"><span>${this.escapeHtml(unit)}</span></label></div>`;
  }

  aiSelect(name, label, options, value) {
    return `<div class="settings-row"><span>${label}</span><select data-ai-setting="${name}">
      ${options.map((option) => {
        const optionValue = Array.isArray(option) ? option[0] : option;
        const optionLabel = Array.isArray(option) ? option[1] : option;
        return `<option value="${this.escapeHtml(optionValue)}" ${optionValue === value ? "selected" : ""}>${this.escapeHtml(optionLabel)}</option>`;
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
    const minSoc = this.rawValue("multi-min-soc", 40);
    const minSellPrice = this.rawValue("multi-min-sell-price", 0);

    const updates = selected.map(([key]) => {
      const update = { slot_key: key };
      if (checked("sellPower")) update.sell_power = sellPower;
      if (checked("dischargeCurrent")) update.discharge_current = dischargeCurrent;
      if (checked("chargeCurrent")) update.charge_current = chargeCurrent;
      if (checked("minSoc")) update.minimum_sell_soc = minSoc;
      if (checked("minSellPrice")) update.min_sell_price = minSellPrice;
      if (checked("mode")) update.mode = mode;
      if (checked("active")) update.enabled = activeValue;
      return update;
    });
    if (!await this.applySchedulePatch(updates)) return;
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
    if (status.includes("SELL BLOCKED")) return ["Sprzedaż zatrzymana", "warn"];
    if (status.includes("GRID CHARGE")) return ["Ładowanie z sieci według harmonogramu", "charge"];
    if (status.includes("PV CHARGE")) return ["Ładowanie z PV według harmonogramu", "charge"];
    if (status.includes("EMERGENCY")) return ["Awaryjnie zatrzymany", "bad"];
    if (status.includes("MAPPING ERROR")) return ["Błąd mapowania Deye", "bad"];
    if (status.includes("SCHEDULE APPLY ERROR")) return ["Nie zastosowano bie\u017c\u0105cego slotu", "bad"];
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
    if (this._resumeApplying) return false;
    this._resumeApplying = true;
    this._defaultsStatus = "saving";
    this._defaultsMessage = "W\u0142\u0105czanie Managera i harmonogramu\u2026";
    this.beginSave();
    this.render();
    try {
      if (!this.hasService("deye_energy_manager", "resume_manager")) throw new Error("Us\u0142uga deye_energy_manager.resume_manager jest niedost\u0119pna");
      await this.callService("deye_energy_manager", "resume_manager", {});
      this._defaultsStatus = "saved";
      this._defaultsMessage = "W\u0142\u0105czono Manager i harmonogram";
      this._saveMessage = this._defaultsMessage;
      this.finishSave();
      return true;
    } catch (error) {
      this._defaultsStatus = "error";
      this._defaultsMessage = `Nie uda\u0142o si\u0119 w\u0142\u0105czy\u0107 Managera: ${error?.message || "brak potwierdzenia Home Assistant"}`;
      this.failSave("resume_manager", error);
      return false;
    } finally {
      this._resumeApplying = false;
      this.render();
    }
  }

  async applyDefaultValues() {
    if (this._defaultsApplying) return false;
    this._defaultsApplying = true;
    this._defaultsStatus = "saving";
    this._defaultsMessage = "Stosowanie ustawień domyślnych…";
    this.beginSave();
    this._saveMessage = this._defaultsMessage;
    this.updateSaveIndicator();
    this.updateDefaultApplyState();
    try {
      if (!this.hasService("deye_energy_manager", "restore_defaults")) {
        throw new Error("Usługa deye_energy_manager.restore_defaults jest niedostępna");
      }
      await this.callService("deye_energy_manager", "restore_defaults", {});
      this._defaultsStatus = "saved";
      this._defaultsMessage = "Zastosowano ustawienia domyślne";
      this._saveMessage = this._defaultsMessage;
      this.finishSave();
      return true;
    } catch (error) {
      this._defaultsStatus = "error";
      this._defaultsMessage = `Nie udało się potwierdzić pełnego zestawu ustawień domyślnych: ${error?.message || "brak potwierdzenia Home Assistant"}`;
      this.failSave("restore_defaults", error);
      this._saveMessage = this._defaultsMessage;
      this.updateSaveIndicator();
      return false;
    } finally {
      this._defaultsApplying = false;
      this.updateDefaultApplyState();
    }
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

  iconSvg(type) {
    const icons = {
      sell: '<svg viewBox="0 0 24 24"><path d="M4 14h4l2-6 4 12 2-6h4"/><path d="M4 18h16"/></svg>',
      load: '<svg viewBox="0 0 24 24"><path d="M6 12h6V6l6 6h-6v6z"/><path d="M4 20h16"/></svg>',
      ct: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/><path d="M12 8v8M8 12h8"/></svg>',
      charge: '<svg viewBox="0 0 24 24"><path d="M13 2 5 13h6l-1 9 8-12h-6z"/></svg>',
      shield: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/><path d="M9 12l2 2 4-5"/></svg>',
      normal: '<svg viewBox="0 0 24 24"><path d="M3 12h2v7h14v-7h2"/><path d="M5 10l7-7 7 7"/><path d="M9 21v-6h6v6"/><path d="M12 3v4"/></svg>',
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
      weather: '<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="3"/><path d="M8 2v2M2 8h2M3.8 3.8l1.4 1.4M13 8h2M10.8 5.2l1.4-1.4"/><path d="M7 19h10a4 4 0 0 0 0-8 6 6 0 0 0-11.3 2A3 3 0 0 0 7 19z"/></svg>',
    };
    return icons[type] || icons.gear;
  }

  iconButton(icon, label, dataAttr = "") {
    return `<button class="icon-action" ${dataAttr} title="${label}">${this.iconSvg(icon)}<span>${label}</span></button>`;
  }

  modeLegend() {
    return this.slotWorkModes().concat(["Wy\u0142\u0105czone"]).map((mode) => {
      const meta = mode === "Wy\u0142\u0105czone" ? this.modeMeta("", false) : this.modeMeta(mode, true);
      return `<div class="mode-tile ${meta.cls}">
        <div class="mode-icon">${this.iconSvg(meta.icon)}</div>
        <div><strong>${meta.title}</strong><span>${meta.subtitle}</span></div>
      </div>`;
    }).join("");
  }

  modePill(mode, enabled) {
    const meta = this.modeMeta(mode, enabled);
    return `<span class="mode-pill ${meta.cls}">${meta.title}</span>`;
  }

  slotSummary(entities, enabled) {
    if (!enabled) return `<span class="empty-value">-</span>`;
    const mode = this.state(entities.mode, "Normalna Praca");
    const sell = this.numberState(entities.sellPower, 0);
    const discharge = this.numberState(entities.dischargeCurrent, 0);
    const charge = this.numberState(entities.chargeCurrent, 0);
    const soc = this.numberState(entities.minimumSellSoc, 0);
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
        minimumSellSoc: 0,
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
      minimumSellSoc: this.numberState(entities.minimumSellSoc, 0),
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
      "multi-min-soc": bulk.minimumSellSoc,
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
      const mode = enabled ? this.state(entities.mode, "Normalna Praca") : "Wy\u0142\u0105czone";
      const isCharge = enabled && mode === "Charge";
      const slotTouSoc = this.asNumber(this.numberState(entities.touSoc, ""));
      const data = {
        key,
        label,
        start: Number(key.slice(0, 2)),
        end: key.endsWith("_00") ? 0 : Number(key.slice(3, 5)),
        enabled,
        mode,
        sellPower: this.asNumber(this.numberState(entities.sellPower, 0)) || 0,
        dischargeCurrent: this.numberState(entities.dischargeCurrent, "brak"),
        chargeCurrent: this.numberState(entities.chargeCurrent, "brak"),
        gridChargeCurrent: this.numberState(entities.gridChargeCurrent, "brak"),
        minimumSellSoc: this.asNumber(this.numberState(entities.minimumSellSoc, 0)) || 0,
        minSellPrice: this.asNumber(this.numberState(entities.minSellPrice, 0)) || 0,
        touSoc: slotTouSoc,
        chargeMode: isCharge,
        chargeEnabled: isCharge && this.displayState(entities.chargeEnabled, "off") === "on",
      };
      return data;
    });
    // Fizyczne sloty Deye Time of Use przechowują wyłącznie granice, SOC i Grid Charge.
    // Minimalny SOC sprzedaży oraz prądy nie mogą tworzyć dodatkowych zakresów TOU.
    const same = (a, b) => ["touSoc", "chargeEnabled"].every((key) => a[key] === b[key]);
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
    const buyPriceTomorrow = this.entity("sensor", "buy_price_tomorrow");
    const solcastToday = this.asNumber(this.state(this.entity("sensor", "solcast_forecast_today"), 0)) || 0;
    const solcastRemaining = this.asNumber(this.state(this.entity("sensor", "solcast_remaining_today"), 0)) || 0;
    const dailyPv = this.asNumber(this.state(this.entity("sensor", "daily_pv_production"), 0)) || 0;
    const soldToday = this.asNumber(this.state(this.entity("sensor", "sold_energy_today"), 0)) || 0;
    const sellPrices = this.readPriceMap(sellPriceToday);
    const buyPrices = this.readPriceMap(buyPriceToday);
    const buyPricesTomorrow = this.readPriceMap(buyPriceTomorrow, false);
    const tariff = this.tariffData();
    const todayKey = this.localDateKey();
    const tomorrowDate = new Date();
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrowKey = this.localDateKey(tomorrowDate);
    const distributionByKey = new Map((Array.isArray(tariff.hourly_profile) ? tariff.hourly_profile : []).filter((row) => row.available !== false)
      .map((row) => [`${row.date || todayKey}:${Number(row.hour)}`, this.asNumber(row.total_distribution_rate ?? row.rate) || 0]));
    const distributionCost = (date, hour) => tariff.price_includes_distribution ? 0 : (distributionByKey.get(`${date}:${hour}`) || 0);
    const tariffReady = tariff.configured !== false;
    const totalBuyPrices = tariffReady ? new Map([...buyPrices.entries()].map(([hour, price]) => [hour, price + distributionCost(todayKey, hour)])) : new Map();
    const totalBuyPricesTomorrow = tariffReady ? new Map([...buyPricesTomorrow.entries()].map(([hour, price]) => [hour, price + distributionCost(tomorrowKey, hour)])) : new Map();
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
    const cheapBuy = [...totalBuyPrices.entries()].filter(([, price]) => price <= maxBuy).sort((a, b) => a[1] - b[1]).slice(0, 4);
    const cheapBuy48 = [
      ...[...totalBuyPrices.entries()].map(([hour, price]) => ({ day: "Dziś", date: todayKey, hour, price })),
      ...[...totalBuyPricesTomorrow.entries()].map(([hour, price]) => ({ day: "Jutro", date: tomorrowKey, hour, price })),
    ].filter((row) => row.price <= maxBuy).sort((a, b) => a.price - b.price).slice(0, 8);
    const activeConfigured = slots.filter(([key, label]) => {
      const e = this.slotEntities(key, label);
      return this.state(e.sellEnabled) === "on";
    }).length;
    const margin = Math.max(0, this.asNumber(settings.forecastMargin) ?? 0) / 100;
    const historicalCorrection = this.asNumber(learning.solcast_correction_factor);
    const forecastCorrection = settings.forecastEnabled && settings.history && settings.realPv
      ? (historicalCorrection ?? 1)
      : 1;
    const weatherRiskFactor = settings.forecastEnabled
      ? (this.asNumber(learning.weather?.risk_factor) ?? 1)
      : 1;
    const currentHour = new Date().getHours();
    const expectedRemainingPv = profileRows
      .filter((row) => Number(String(row.hour || "0").slice(0, 2)) >= currentHour)
      .reduce((sum, row) => sum + (this.asNumber(row.pv_kwh) || 0), 0);
    const forecastBase = settings.forecastEnabled ? solcastRemaining : expectedRemainingPv;
    const usableForecast = Math.max(0, forecastBase * forecastCorrection * weatherRiskFactor * (1 - margin));
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
      cheapBuy48,
      totalBuyPrices,
      totalBuyPricesTomorrow,
      tariff,
      settings,
      activeConfigured,
      solcastToday,
      solcastRemaining,
      usableForecast,
      dailyPv,
      forecastCorrection,
      weatherRiskFactor,
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
    if (!settings.enabled || !settings.allowDeyeMode) {
      return {
        rows: slots.map(([key, label]) => ({ key, label, enabled: false, mode: "Wyłączone", chargeEnabled: false })),
        segmentCount: 1,
        sellWindow: null,
        buyWindow: null,
      };
    }
    const sellPrices = this.readPriceMap(this.entity("sensor", ["sell_price_today", "energy_price"]));
    const buyPrices = ai.totalBuyPrices || this.readPriceMap(this.entity("sensor", "buy_price_today"));
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
        chargeCurrent: 0, gridChargeCurrent: 0, minSoc: settings.minSoc, minimumSellSoc: settings.minSoc, minSellPrice: settings.minSellPrice,
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
        gridChargeCurrent: settings.maxGridChargeCurrent, minSoc: settings.targetSoc, minimumSellSoc: settings.targetSoc, minSellPrice: 0,
        energyKwh: chargeEnergyKwh, projectedSoc: projectedStoredKwh / ai.batteryCapacityKwh * 100,
        estimatedRevenue: -chargeEnergyKwh * (buyPrices.get(hour) || 0), confidence,
      };
      }
      return { key, label, enabled: false, mode: "Wyłączone", chargeEnabled: false };
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
    const updates = rows.map((row) => ({
      slot_key: row.key,
      enabled: row.enabled,
      ...(row.enabled ? {
        mode: row.mode,
        sell_power: Number(row.sellPower) || 0,
        discharge_current: Number(row.dischargeCurrent) || 0,
        charge_current: Number(row.chargeCurrent) || 0,
        grid_charge_current: Number(row.gridChargeCurrent) || 0,
        minimum_sell_soc: Number(row.minimumSellSoc ?? row.minSoc) || 0,
        min_sell_price: Number(row.minSellPrice) || 0,
      } : {}),
    }));
    if (!await this.applySchedulePatch(updates)) return;
    await this.startSell();
    this.saveAiAnalysis(this.aiSuggestions(slots), "accepted", { segmentCount: proposal.segmentCount, accepted: true, selectedHours: rows.map((row) => row.label) });
    this._dialog = null;
    this.render();
  }

  aiPlannerData(slots) {
    const aiState = this._hass?.states?.[this.entity("sensor", "ai_state")];
    const backend = aiState?.attributes?.planner_48h;
    if (backend && Array.isArray(backend.rows) && backend.rows.length) return backend;
    const legacy = this.aiProposal(slots);
    const today = legacy.rows.map((row) => ({
      ...row,
      day: "today",
      hour: Number(row.key.slice(0, 2)),
      action: row.mode === "Selling First" ? "sell" : row.mode === "Charge" ? "charge" : "none",
      proposed: Boolean(row.enabled),
      energy_kwh: row.energyKwh || 0,
      soc_after: row.projectedSoc,
      balance_pln: row.estimatedRevenue,
      confidence: row.confidence || 25,
    }));
    return {
      rows: today,
      days: [{ day: "today", confidence: 25, prices_available: true }],
      checkpoints: {},
      data_quality: { learning_stage: "wstępne uczenie", recorded_days: 0, tomorrow_sell_prices: 0, tomorrow_buy_prices: 0, weather_hours: 0 },
      variants: {},
      selected_strategy: "balanced",
      generated_at: "",
    };
  }

  aiRowsForDay(planner, day = this._aiDay) {
    return (Array.isArray(planner?.rows) ? planner.rows : [])
      .filter((row) => row.day === day)
      .sort((a, b) => Number(a.hour) - Number(b.hour));
  }

  aiSlotKey(hour) {
    const start = String(Number(hour)).padStart(2, "0");
    const end = String((Number(hour) + 1) % 24).padStart(2, "0");
    return `${start}_${end}`;
  }

  aiSelection(day = this._aiDay) {
    if (!this._aiSelections || !(this._aiSelections[day] instanceof Set)) {
      this._aiSelections = this._aiSelections || {};
      this._aiSelections[day] = new Set();
    }
    return this._aiSelections[day];
  }

  initialiseAiSelections(planner) {
    this._aiSelections = { today: new Set(), tomorrow: new Set() };
    ["today", "tomorrow"].forEach((day) => {
      this.aiRowsForDay(planner, day)
        .filter((row) => row.proposed && (this.asNumber(row.confidence) || 0) >= 50)
        .forEach((row) => this._aiSelections[day].add(this.aiSlotKey(row.hour)));
    });
  }

  aiRowUpdate(row) {
    const settings = this.aiSettings();
    const selling = row.action === "sell";
    const charging = row.action === "charge";
    return {
      slot_key: this.aiSlotKey(row.hour),
      enabled: true,
      mode: selling ? "Selling First" : charging ? "Charge" : "Normalna Praca",
      sell_power: selling ? Math.round(this.asNumber(settings.maxSellPower) || 0) : 0,
      discharge_current: selling ? Number(settings.maxDischargeCurrent) || 0 : 0,
      charge_current: charging ? Number(settings.maxChargeCurrent) || 0 : 0,
      grid_charge_current: charging ? Number(settings.maxGridChargeCurrent) || 0 : 0,
      // The Charge target is owned by the shared Charge profile.  It must
      // never leak into the Selling First eligibility threshold.
      minimum_sell_soc: selling ? Number(settings.minSoc) || 0 : 0,
      min_sell_price: selling ? Number(settings.minSellPrice) || 0 : 0,
    };
  }

  async applyAiDayPlan(slots, day = this._aiDay) {
    const planner = this.aiPlannerData(slots);
    const selected = this.aiSelection(day);
    const rows = this.aiRowsForDay(planner, day).filter((row) => row.proposed && selected.has(this.aiSlotKey(row.hour)));
    if (!rows.length) return;
    const label = day === "today" ? "zastosować dziś" : "zaplanować na jutro";
    if (!window.confirm(`Czy ${label} ${rows.length} wybranych zmian AI? Pozostałe godziny nie zostaną zmienione.`)) return;
    const updates = rows.map((row) => this.aiRowUpdate(row));
    if (day === "today") {
      if (!await this.applySchedulePatch(updates)) return;
      await this.startSell();
      this.saveAiAnalysis(this.aiSuggestions(slots), "accepted", {
        segmentCount: rows.length,
        accepted: true,
        day,
        selectedHours: rows.map((row) => row.label),
      });
      this._dialog = null;
    } else {
      const date = rows[0]?.date;
      try {
        await this.callService("deye_energy_manager", "save_future_plan", {
          data: JSON.stringify({
            date,
            strategy: planner.selected_strategy,
            labels: rows.map((row) => row.label),
            updates,
          }),
        });
        this._saveStatus = "saved";
        this._saveMessage = "Plan na jutro zapisany";
      } catch (err) {
        this._saveStatus = "error";
        this._saveMessage = `Błąd planu na jutro: ${err?.message || err}`;
      }
    }
    this.render();
  }

  aiConfidenceClass(value) {
    const confidence = this.asNumber(value) || 0;
    return confidence >= 75 ? "good" : confidence >= 50 ? "warn" : "bad";
  }

  aiPriceColumns(slots, kind) {
    const ai = this.aiSuggestions(slots);
    const sellToday = this.readPriceMap(this.entity("sensor", ["sell_price_today", "energy_price"]));
    const sellTomorrow = this.readPriceMap(this.entity("sensor", "sell_price_tomorrow"), false);
    const maps = kind === "sell" ? [sellToday, sellTomorrow] : [ai.totalBuyPrices || new Map(), ai.totalBuyPricesTomorrow || new Map()];
    const sorted = maps.map((map) => [...map.entries()]
      .sort((a, b) => kind === "sell" ? b[1] - a[1] || a[0] - b[0] : a[1] - b[1] || a[0] - b[0])
      .slice(0, 6));
    const render = (rows, day) => `<section><h4>${day}</h4>${rows.length
      ? `<table><tbody>${rows.map(([hour, price]) => `<tr><td>${this.hourLabel(hour)}</td><td>${this.formatPrice(price)} PLN/kWh</td></tr>`).join("")}</tbody></table>`
      : `<p class="ai-empty">Brak danych</p>`}</section>`;
    return `<div class="ai-price-columns">${render(sorted[0], "Dziś")}${render(sorted[1], "Jutro")}</div>`;
  }

  aiWeatherCard(planner, day) {
    const aiState = this._hass?.states?.[this.entity("sensor", "ai_state")];
    const weather = aiState?.attributes?.weather || {};
    const targetDate = new Date();
    if (day === "tomorrow") targetDate.setDate(targetDate.getDate() + 1);
    const targetKey = this.localDateKey(targetDate);
    const rawForecast = Array.isArray(weather.forecast) ? weather.forecast : [];
    const datedForecast = rawForecast.filter((row) => {
      const raw = row?.datetime ?? row?.time;
      if (!raw) return false;
      const stamp = new Date(raw);
      return !Number.isNaN(stamp.getTime()) && this.localDateKey(stamp) === targetKey;
    });
    const forecast = datedForecast.length ? datedForecast : rawForecast.slice(day === "today" ? 0 : 24, day === "today" ? 24 : 48);
    if (!weather.available || !forecast.length) {
      return `<section class="ai-metric-card ai-weather"><h3>Pogoda</h3><p class="ai-empty">Brak danych pogodowych</p><small>Solcast pozostaje źródłem podstawowym; nie zastosowano fikcyjnej korekty.</small></section>`;
    }
    const temperatures = forecast.map((row) => this.asNumber(row.temperature)).filter((value) => value !== null);
    const clouds = forecast.map((row) => this.asNumber(row.cloud_coverage)).filter((value) => value !== null);
    const rain = forecast.map((row) => this.asNumber(row.precipitation_probability)).filter((value) => value !== null);
    const average = (rows) => rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null;
    const cloud = average(clouds);
    const risk = cloud === null ? null : Math.max(0.65, Math.min(1.05, 1 - cloud * 0.002 - (average(rain) || 0) * 0.001));
    return `<section class="ai-metric-card ai-weather"><h3>Pogoda</h3><div class="ai-weather-main"><span>${this.iconSvg("weather")}</span><strong>${temperatures.length ? `${average(temperatures).toFixed(1)}°C` : "brak temperatury"}</strong></div><p>${this.escapeHtml(String(forecast[0]?.condition || weather.condition || "brak"))}<br>Zachmurzenie: ${cloud === null ? "brak" : `${cloud.toFixed(0)}%`}<br>Opady: ${rain.length ? `${average(rain).toFixed(0)}%` : "brak"}</p><small>${risk === null ? "Bez korekty pogodowej" : `Pomocnicza korekta PV ×${risk.toFixed(2)}`}</small></section>`;
  }

  aiEnergyChart(rows, title = "Plan energii") {
    const values = rows.length ? rows : [];
    const count = Math.max(1, values.length);
    const width = 760;
    const height = 236;
    const left = 38;
    const top = 24;
    const chartWidth = width - left - 16;
    const chartHeight = 158;
    const maxEnergy = Math.max(1, ...values.flatMap((row) => [this.asNumber(row.load_kwh) || 0, this.asNumber(row.pv_kwh) || 0]));
    const distributionValues = values.map((row) => this.asNumber(row.distribution) || 0).filter((value) => value > 0);
    const minDistribution = distributionValues.length ? Math.min(...distributionValues) : null;
    const step = chartWidth / count;
    const bars = values.map((row, index) => {
      const x = left + index * step;
      const loadHeight = (this.asNumber(row.load_kwh) || 0) / maxEnergy * chartHeight;
      const pvHeight = (this.asNumber(row.pv_kwh) || 0) / maxEnergy * chartHeight;
      const marker = row.action === "sell" ? "#7ee22d" : row.action === "charge" ? "#ffd166" : "transparent";
      const cheapZone = minDistribution !== null && (this.asNumber(row.distribution) || 0) <= minDistribution + .00001;
      const weatherMarker = this.asNumber(row.weather_factor) !== null && this.asNumber(row.weather_factor) < .9 ? "☁" : "";
      return `<rect x="${x.toFixed(1)}" y="${top}" width="${Math.max(1, step).toFixed(1)}" height="${chartHeight}" fill="${cheapZone ? "rgba(255,209,102,.055)" : "transparent"}"/><rect x="${x.toFixed(1)}" y="${(top + chartHeight - loadHeight).toFixed(1)}" width="${Math.max(2, step * .38).toFixed(1)}" height="${loadHeight.toFixed(1)}" fill="#32a8e8"/><rect x="${(x + step * .4).toFixed(1)}" y="${(top + chartHeight - pvHeight).toFixed(1)}" width="${Math.max(2, step * .38).toFixed(1)}" height="${pvHeight.toFixed(1)}" fill="#67bd2e"/><circle cx="${(x + step * .5).toFixed(1)}" cy="${top + 5}" r="3.5" fill="${marker}"/>${weatherMarker ? `<text x="${(x + step * .5).toFixed(1)}" y="${top + 19}" text-anchor="middle" fill="#a9c7d8" font-size="9">${weatherMarker}</text>` : ""}`;
    }).join("");
    const points = values.map((row, index) => `${(left + index * step + step / 2).toFixed(1)},${(top + chartHeight - (this.asNumber(row.soc_after) || 0) / 100 * chartHeight).toFixed(1)}`).join(" ");
    const labels = values.map((row, index) => index % (values.length > 24 ? 4 : 2) === 0
      ? `<text x="${(left + index * step).toFixed(1)}" y="${top + chartHeight + 18}" fill="#8fb0c2" font-size="9">${String(row.hour).padStart(2, "0")}</text>` : "").join("");
    return `<section class="ai-chart-card"><h3>${title}</h3><div class="ai-chart-legend"><span class="load">Zużycie</span><span class="pv">Produkcja PV</span><span class="soc">SOC</span><span class="sell">Sprzedaż</span><span class="charge">Ładowanie</span><span class="tariff">Tania dystrybucja</span></div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}"><line x1="${left}" y1="${top + chartHeight}" x2="${width - 10}" y2="${top + chartHeight}" stroke="#24465a"/>${bars}<polyline points="${points}" fill="none" stroke="#ffd200" stroke-width="2.4"/>${labels}</svg></section>`;
  }

  aiWeatherMeta(condition) {
    const key = String(condition || "").toLowerCase();
    const values = {
      "clear-night": ["🌙", "bezchmurna noc"], cloudy: ["☁️", "pochmurno"], exceptional: ["⚠️", "warunki wyjątkowe"],
      fog: ["🌫️", "mgła"], hail: ["🌨️", "grad"], lightning: ["⛈️", "burza"], "lightning-rainy": ["⛈️", "burza z deszczem"],
      partlycloudy: ["🌤️", "częściowe zachmurzenie"], pouring: ["🌧️", "ulewa"], rainy: ["🌧️", "deszczowo"],
      snowy: ["🌨️", "śnieg"], "snowy-rainy": ["🌨️", "deszcz ze śniegiem"], sunny: ["☀️", "słonecznie"],
      windy: ["💨", "wietrznie"], "windy-variant": ["🌬️", "wietrznie z chmurami"],
    };
    return values[key] || ["🌡️", key || "brak danych"];
  }

  aiWeatherRows(weather, day, kind = "hourly") {
    const source = kind === "daily" ? weather.daily_forecast : weather.forecast;
    const rows = Array.isArray(source) ? source : [];
    if (kind === "daily") return rows;
    const target = new Date();
    if (day === "tomorrow") target.setDate(target.getDate() + 1);
    const targetKey = this.localDateKey(target);
    return rows.filter((row) => {
      const stamp = new Date(row?.datetime ?? row?.time ?? "");
      return !Number.isNaN(stamp.getTime()) && this.localDateKey(stamp) === targetKey;
    });
  }

  aiWeatherCard(planner, day) {
    const aiState = this._hass?.states?.[this.entity("sensor", "ai_state")];
    const weather = aiState?.attributes?.weather || {};
    const hourly = this.aiWeatherRows(weather, day, "hourly");
    const daily = this.aiWeatherRows(weather, day, "daily");
    const target = new Date();
    if (day === "tomorrow") target.setDate(target.getDate() + 1);
    const targetKey = this.localDateKey(target);
    const dailyTarget = daily.find((row) => {
      const stamp = new Date(row?.datetime ?? row?.time ?? "");
      return !Number.isNaN(stamp.getTime()) && this.localDateKey(stamp) === targetKey;
    }) || {};
    const first = hourly[0] || dailyTarget;
    const currentCondition = day === "today" ? weather.condition : first?.condition;
    const [icon, label] = this.aiWeatherMeta(currentCondition);
    const number = (value, digits = 0, unit = "") => {
      const parsed = this.asNumber(value);
      return parsed === null ? "brak danych" : `${parsed.toFixed(digits)}${unit}`;
    };
    const temps = hourly.map((row) => this.asNumber(row.temperature)).filter((value) => value !== null);
    const high = this.asNumber(dailyTarget.temperature) ?? (temps.length ? Math.max(...temps) : null);
    const low = this.asNumber(dailyTarget.templow) ?? (temps.length ? Math.min(...temps) : null);
    const currentTemp = day === "today" ? this.asNumber(weather.temperature) : (this.asNumber(first?.temperature) ?? high);
    const dayNames = ["niedz.", "pon.", "wt.", "śr.", "czw.", "pt.", "sob."];
    const dailyStrip = daily.length ? daily.slice(0, 7).map((row) => {
      const stamp = new Date(row.datetime ?? row.time ?? "");
      const [rowIcon, rowLabel] = this.aiWeatherMeta(row.condition);
      return `<div class="ai-weather-day" title="${this.escapeHtml(rowLabel)}"><strong>${Number.isNaN(stamp.getTime()) ? "dzień" : dayNames[stamp.getDay()]}</strong><span>${rowIcon}</span><b>${number(row.temperature, 1, "°")}</b><small>${number(row.templow, 1, "°")}</small></div>`;
    }).join("") : `<p class="ai-empty">Brak prognozy dziennej</p>`;
    const hourlyStrip = hourly.length ? hourly.slice(0, 24).map((row) => {
      const stamp = new Date(row.datetime ?? row.time ?? "");
      const [rowIcon, rowLabel] = this.aiWeatherMeta(row.condition);
      return `<div class="ai-weather-hour" title="${this.escapeHtml(rowLabel)}"><strong>${Number.isNaN(stamp.getTime()) ? "--" : `${String(stamp.getHours()).padStart(2, "0")}:00`}</strong><span>${rowIcon}</span><b>${number(row.temperature, 0, "°")}</b><small>${number(row.precipitation_probability, 0, "%")}</small></div>`;
    }).join("") : `<p class="ai-empty">Brak prognozy godzinowej</p>`;
    if (!weather.available) {
      return `<section class="ai-metric-card ai-weather ai-weather-v2"><h3>Pogoda — ${day === "today" ? "dziś" : "jutro"}</h3><p class="ai-empty">Brak danych z ${this.escapeHtml(String(weather.entity_id || "encja nie została wskazana"))}</p><small>Solcast pozostaje źródłem podstawowym; brak danych pogodowych nie jest zastępowany zerami.</small></section>`;
    }
    return `<section class="ai-metric-card ai-weather ai-weather-v2"><div class="ai-weather-head"><div><span class="ai-weather-icon">${icon}</span><div><h3>${this.escapeHtml(label)}</h3><small>${day === "today" ? "Dziś" : "Jutro"} · aktualizacja ${this.formatTimeShort(weather.last_updated)}</small></div></div><div class="ai-weather-temperature"><strong>${currentTemp === null ? "--" : `${currentTemp.toFixed(1)}°C`}</strong><span>${high === null ? "--" : high.toFixed(1)}° / ${low === null ? "--" : low.toFixed(1)}°</span></div></div><div class="ai-weather-facts"><span>Ciśnienie <b>${number(weather.pressure, 0, ` ${weather.pressure_unit || "hPa"}`)}</b></span><span>Wilgotność <b>${number(weather.humidity, 0, "%")}</b></span><span>Wiatr <b>${number(weather.wind_speed, 1, ` ${weather.wind_speed_unit || "km/h"}`)}${weather.wind_bearing ? ` · ${this.escapeHtml(String(weather.wind_bearing))}` : ""}</b></span></div><div class="ai-weather-tabs"><button class="${this._aiWeatherMode !== "hourly" ? "active" : ""}" data-ai-weather-mode="daily">Dzienna</button><button class="${this._aiWeatherMode === "hourly" ? "active" : ""}" data-ai-weather-mode="hourly">Godzinowa</button></div><div class="ai-weather-strip">${this._aiWeatherMode === "hourly" ? hourlyStrip : dailyStrip}</div><small class="ai-weather-source">Źródło: ${this.escapeHtml(String(weather.entity_id || "brak"))}${weather.last_error ? ` · ${this.escapeHtml(String(weather.last_error))}` : ""}. Solcast pozostaje prognozą podstawową.</small></section>`;
  }

  aiHistoricalHours() {
    const aiState = this._hass?.states?.[this.entity("sensor", "ai_state")];
    const samples = Array.isArray(aiState?.attributes?.energy_samples) ? aiState.attributes.energy_samples.slice() : [];
    samples.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const result = new Map();
    samples.forEach((sample, index) => {
      const stamp = new Date(sample?.timestamp || "");
      if (Number.isNaN(stamp.getTime())) return;
      const next = new Date(samples[index + 1]?.timestamp || "");
      const minutes = Number.isNaN(next.getTime()) ? 5 : Math.max(0, Math.min(15, (next - stamp) / 60000));
      if (!minutes) return;
      const key = `${this.localDateKey(stamp)}-${stamp.getHours()}`;
      const row = result.get(key) || { pv: 0, load: 0, pvSamples: 0, loadSamples: 0 };
      const pv = this.asNumber(sample.pv_power);
      const load = this.asNumber(sample.load_power);
      if (pv !== null) { row.pv += Math.max(0, pv) * minutes / 60000; row.pvSamples += 1; }
      if (load !== null) { row.load += Math.max(0, load) * minutes / 60000; row.loadSamples += 1; }
      result.set(key, row);
    });
    return result;
  }

  aiEnergyChart(rows, title = "Plan energii") {
    const values = Array.isArray(rows) ? rows : [];
    const count = Math.max(1, values.length);
    const width = 1120, height = 455, left = 62, right = 54;
    const top = 48, topHeight = 185, weatherY = 256, socTop = 294, socHeight = 92, axisY = 414;
    const chartWidth = width - left - right;
    const step = chartWidth / count;
    const history = this.aiHistoricalHours();
    const weatherState = this._hass?.states?.[this.entity("sensor", "ai_state")]?.attributes?.weather || {};
    const weatherRows = Array.isArray(weatherState.forecast) ? weatherState.forecast : [];
    const weatherMap = new Map(weatherRows.map((row) => {
      const stamp = new Date(row?.datetime ?? row?.time ?? "");
      return Number.isNaN(stamp.getTime()) ? ["", null] : [`${this.localDateKey(stamp)}-${stamp.getHours()}`, row];
    }));
    const actual = values.map((row) => history.get(`${row.date}-${row.hour}`) || null);
    const energyValues = [];
    values.forEach((row, index) => {
      [actual[index]?.pvSamples ? actual[index].pv : null, actual[index]?.loadSamples ? actual[index].load : null,
        this.asNumber(row.solcast_kwh), this.asNumber(row.corrected_pv_kwh), this.asNumber(row.forecast_high_kwh), this.asNumber(row.load_kwh)]
        .forEach((value) => { if (value !== null) energyValues.push(Math.max(0, value)); });
    });
    const maxEnergy = Math.max(1, ...energyValues) * 1.08;
    const yEnergy = (value) => top + topHeight - Math.max(0, value) / maxEnergy * topHeight;
    const xCenter = (index) => left + index * step + step / 2;
    const distributionValues = values.map((row) => this.asNumber(row.distribution)).filter((value) => value !== null && value > 0);
    const minDistribution = distributionValues.length ? Math.min(...distributionValues) : null;
    const grid = [0, .25, .5, .75, 1].map((part) => `<line x1="${left}" y1="${(top + topHeight * part).toFixed(1)}" x2="${width - right}" y2="${(top + topHeight * part).toFixed(1)}" class="ai-chart-grid"/><text x="${left - 9}" y="${(top + topHeight * part + 4).toFixed(1)}" text-anchor="end" class="ai-chart-axis">${(maxEnergy * (1 - part)).toFixed(1)}</text>`).join("");
    const cheapZones = values.map((row, index) => {
      const rate = this.asNumber(row.distribution);
      const cheap = minDistribution !== null && rate !== null && rate <= minDistribution + .00001;
      return cheap ? `<rect x="${(left + index * step).toFixed(1)}" y="${top}" width="${Math.max(1, step).toFixed(1)}" height="${socTop + socHeight - top}" class="ai-cheap-zone"/>` : "";
    }).join("");
    const bars = values.map((row, index) => {
      const actualPv = actual[index]?.pvSamples ? actual[index].pv : null;
      const actualLoad = actual[index]?.loadSamples ? actual[index].load : null;
      const plannedLoad = this.asNumber(row.load_kwh);
      const solcast = this.asNumber(row.solcast_kwh);
      const bar = (value, offset, css) => value === null ? "" : `<rect x="${(left + index * step + step * offset).toFixed(1)}" y="${yEnergy(value).toFixed(1)}" width="${Math.max(2, step * .22).toFixed(1)}" height="${Math.max(0, top + topHeight - yEnergy(value)).toFixed(1)}" class="${css}"/>`;
      return `${bar(actualLoad ?? plannedLoad, .08, "ai-bar-load")}${bar(actualPv, .32, "ai-bar-actual")}${bar(solcast, .58, "ai-bar-solcast")}`;
    }).join("");
    const linePoints = (field, yFn = yEnergy) => values.map((row, index) => {
      const value = this.asNumber(row[field]);
      return value === null ? null : `${xCenter(index).toFixed(1)},${yFn(value).toFixed(1)}`;
    }).filter(Boolean).join(" ");
    const upper = values.map((row, index) => {
      const value = this.asNumber(row.forecast_high_kwh);
      return value === null ? null : `${xCenter(index).toFixed(1)},${yEnergy(value).toFixed(1)}`;
    }).filter(Boolean);
    const lower = values.map((row, index) => {
      const value = this.asNumber(row.forecast_low_kwh);
      return value === null ? null : `${xCenter(index).toFixed(1)},${yEnergy(value).toFixed(1)}`;
    }).filter(Boolean).reverse();
    const band = upper.length && lower.length ? `<polygon points="${[...upper, ...lower].join(" ")}" class="ai-forecast-band"/>` : "";
    const minSoc = this.asNumber(this.aiSettings()?.minSoc);
    const socY = (value) => socTop + socHeight - Math.max(0, Math.min(100, value)) / 100 * socHeight;
    const socLine = linePoints("soc_after", socY);
    const minSocLine = minSoc === null ? "" : `<line x1="${left}" y1="${socY(minSoc).toFixed(1)}" x2="${width - right}" y2="${socY(minSoc).toFixed(1)}" class="ai-min-soc"/><text x="${left + 4}" y="${(socY(minSoc) - 5).toFixed(1)}" class="ai-chart-axis">Min. SOC ${minSoc.toFixed(0)}%</text>`;
    const actions = values.map((row, index) => row.action === "sell" || row.action === "charge"
      ? `<rect x="${(left + index * step + step * .2).toFixed(1)}" y="${(socTop + socHeight - 15).toFixed(1)}" width="${Math.max(3, step * .6).toFixed(1)}" height="12" class="${row.action === "sell" ? "ai-action-sell" : "ai-action-charge"}"/>` : "").join("");
    const weatherIcons = values.map((row, index) => {
      const weather = weatherMap.get(`${row.date}-${row.hour}`);
      if (!weather) return "";
      const [icon] = this.aiWeatherMeta(weather.condition);
      return `<text x="${xCenter(index).toFixed(1)}" y="${weatherY}" text-anchor="middle" class="ai-chart-weather">${icon}</text>`;
    }).join("");
    const labels = values.map((row, index) => {
      const interval = values.length > 24 ? 4 : 2;
      return index % interval === 0 ? `<text x="${xCenter(index).toFixed(1)}" y="${axisY}" text-anchor="middle" class="ai-chart-axis">${String(row.hour).padStart(2, "0")}</text>` : "";
    }).join("");
    const daySeparator = values.length > 24 ? `<line x1="${(left + step * 24).toFixed(1)}" y1="${top - 20}" x2="${(left + step * 24).toFixed(1)}" y2="${socTop + socHeight}" class="ai-day-separator"/><text x="${left + step * 12}" y="${top - 25}" text-anchor="middle" class="ai-day-label">Dziś</text><text x="${left + step * 36}" y="${top - 25}" text-anchor="middle" class="ai-day-label">Jutro</text>` : "";
    const now = new Date();
    const nowIndex = values.findIndex((row) => row.date === this.localDateKey(now) && Number(row.hour) === now.getHours());
    const currentLine = nowIndex < 0 ? "" : `<line x1="${(left + step * (nowIndex + now.getMinutes() / 60)).toFixed(1)}" y1="${top - 5}" x2="${(left + step * (nowIndex + now.getMinutes() / 60)).toFixed(1)}" y2="${socTop + socHeight}" class="ai-now-line"/><text x="${(left + step * (nowIndex + now.getMinutes() / 60) + 4).toFixed(1)}" y="${top + 12}" class="ai-now-label">teraz</text>`;
    const chartId = `chart-${String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const display = (value, digits = 2, unit = "") => {
      const parsed = this.asNumber(value);
      return parsed === null ? "brak danych" : `${parsed.toFixed(digits)}${unit}`;
    };
    const tipSources = values.map((row, index) => {
      const actualRow = actual[index];
      const weather = weatherMap.get(`${row.date}-${row.hour}`) || {};
      const [, weatherLabel] = this.aiWeatherMeta(weather.condition);
      return `<div class="ai-chart-tip-source" data-ai-tip-source="${chartId}-${index}"><strong>${this.escapeHtml(String(row.date || ""))} · ${this.escapeHtml(String(row.label || this.hourLabel(row.hour)))}</strong><div><span>Produkcja rzeczywista</span><b>${actualRow?.pvSamples ? display(actualRow.pv, 2, " kWh") : "brak danych"}</b><span>Prognoza Solcast</span><b>${display(row.solcast_kwh, 2, " kWh")}</b><span>Prognoza skorygowana</span><b>${display(row.corrected_pv_kwh, 2, " kWh")}</b><span>Przedział prognozy</span><b>${display(row.forecast_low_kwh, 2)}–${display(row.forecast_high_kwh, 2, " kWh")}</b><span>Zużycie</span><b>${actualRow?.loadSamples ? display(actualRow.load, 2, " kWh") : display(row.load_kwh, 2, " kWh")}</b><span>SOC po</span><b>${display(row.soc_after, 1, "%")}</b><span>Działanie</span><b>${row.action === "sell" ? "sprzedaż" : row.action === "charge" ? "ładowanie" : "bez zmiany"}</b><span>Bilans</span><b>${display(row.balance_pln, 2, " PLN")}</b><span>Pogoda</span><b>${this.escapeHtml(weatherLabel)} · ${display(weather.temperature, 1, "°C")}</b><span>Pewność</span><b>${display(row.confidence, 0, "%")}</b></div></div>`;
    }).join("");
    const overlays = values.map((row, index) => `<rect x="${(left + index * step).toFixed(1)}" y="${top - 10}" width="${Math.max(1, step).toFixed(1)}" height="${socTop + socHeight - top + 10}" class="ai-chart-hit" data-ai-chart-point="${chartId}" data-ai-chart-index="${index}"/>`).join("");
    return `<section class="ai-chart-card ai-chart-v2" data-ai-chart="${chartId}"><h3>${this.escapeHtml(title)}</h3><div class="ai-chart-legend"><span class="load">Zużycie</span><span class="actual">Produkcja rzeczywista</span><span class="solcast">Prognoza Solcast</span><span class="corrected">Prognoza skorygowana</span><span class="band">Przedział prognozy</span><span class="soc">SOC</span><span class="sell">Sprzedaż</span><span class="charge">Ładowanie</span><span class="tariff">Tania dystrybucja</span></div><div class="ai-chart-scroll"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${this.escapeHtml(title)}"><text x="15" y="${top + 6}" class="ai-chart-axis">kWh</text>${cheapZones}${grid}${band}${bars}<polyline points="${linePoints("corrected_pv_kwh")}" class="ai-line-corrected"/><line x1="${left}" y1="${top + topHeight}" x2="${width - right}" y2="${top + topHeight}" class="ai-chart-baseline"/><text x="15" y="${socTop + 10}" class="ai-chart-axis">SOC</text><line x1="${left}" y1="${socTop}" x2="${width - right}" y2="${socTop}" class="ai-chart-grid"/><line x1="${left}" y1="${socTop + socHeight}" x2="${width - right}" y2="${socTop + socHeight}" class="ai-chart-baseline"/>${minSocLine}<polyline points="${socLine}" class="ai-line-soc"/>${actions}${weatherIcons}${labels}${daySeparator}${currentLine}<line class="ai-chart-crosshair-x" x1="0" x2="0" y1="${top}" y2="${socTop + socHeight}"/><line class="ai-chart-crosshair-y" x1="${left}" x2="${width - right}" y1="0" y2="0"/>${overlays}</svg></div><div class="ai-chart-tooltip" data-ai-chart-tooltip></div>${tipSources}<small class="ai-chart-help">Najedź kursorem lub dotknij godziny, aby zobaczyć szczegóły. Brakujące dane są oznaczane jako „brak danych”.</small></section>`;
  }

  aiLegacyReadableEnergyChart(rows, title = "Plan energii") {
    const values = Array.isArray(rows) ? rows : [];
    const is48h = values.length > 24;
    const count = Math.max(1, values.length);
    const width = is48h ? 1800 : 1080;
    const height = 610;
    const left = 76, right = 72, top = 58, plotHeight = 305;
    const axisY = 390, weatherTimeY = 423, weatherIconY = 451;
    const statusTop = 486, statusRowHeight = 31;
    const chartWidth = width - left - right;
    const step = chartWidth / count;
    const hidden = this._aiChartHiddenSeries instanceof Set ? this._aiChartHiddenSeries : new Set();
    const visible = (name) => !hidden.has(name);
    const history = this.aiHistoricalHours();
    const actual = values.map((row) => history.get(`${row.date}-${row.hour}`) || null);
    const weatherState = this._hass?.states?.[this.entity("sensor", "ai_state")]?.attributes?.weather || {};
    const weatherRows = Array.isArray(weatherState.forecast) ? weatherState.forecast : [];
    const weatherMap = new Map(weatherRows.map((row) => {
      const stamp = new Date(row?.datetime ?? row?.time ?? "");
      return Number.isNaN(stamp.getTime()) ? ["", null] : [`${this.localDateKey(stamp)}-${stamp.getHours()}`, row];
    }));
    const energyNumbers = [];
    values.forEach((row, index) => {
      [actual[index]?.pvSamples ? actual[index].pv : null, actual[index]?.loadSamples ? actual[index].load : null,
        this.asNumber(row.load_kwh), this.asNumber(row.solcast_kwh), this.asNumber(row.corrected_pv_kwh), this.asNumber(row.forecast_high_kwh)]
        .forEach((value) => { if (value !== null) energyNumbers.push(Math.max(0, value)); });
    });
    const maxEnergy = Math.max(1, ...energyNumbers) * 1.08;
    const x = (index) => left + index * step + step / 2;
    const yEnergy = (value) => top + plotHeight - Math.max(0, value) / maxEnergy * plotHeight;
    const ySoc = (value) => top + plotHeight - Math.max(0, Math.min(100, value)) / 100 * plotHeight;
    const linePoints = (field, yFn) => values.map((row, index) => {
      const value = this.asNumber(row[field]);
      return value === null ? null : `${x(index).toFixed(1)},${yFn(value).toFixed(1)}`;
    }).filter(Boolean).join(" ");
    const horizontalGrid = [0, .2, .4, .6, .8, 1].map((part) => {
      const y = top + plotHeight * part;
      const energyLabel = maxEnergy * (1 - part);
      const socLabel = 100 * (1 - part);
      return `<line x1="${left}" y1="${y.toFixed(1)}" x2="${width - right}" y2="${y.toFixed(1)}" class="ai-readable-grid"/><text x="${left - 12}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="ai-readable-axis">${energyLabel.toFixed(1)}</text><text x="${width - right + 12}" y="${(y + 4).toFixed(1)}" class="ai-readable-axis">${socLabel.toFixed(0)}</text>`;
    }).join("");
    const gridInterval = is48h ? 4 : 2;
    const verticalGrid = values.map((row, index) => index % gridInterval === 0
      ? `<line x1="${x(index).toFixed(1)}" y1="${top}" x2="${x(index).toFixed(1)}" y2="${top + plotHeight}" class="ai-readable-grid ai-readable-grid-v"/>` : "").join("");
    const bars = values.map((row, index) => {
      const actualRow = actual[index];
      const load = actualRow?.loadSamples ? actualRow.load : this.asNumber(row.load_kwh);
      const production = actualRow?.pvSamples ? actualRow.pv : null;
      const draw = (value, offset, css) => value === null ? "" : `<rect x="${(x(index) + step * offset - Math.max(2.5, step * .14)).toFixed(1)}" y="${yEnergy(value).toFixed(1)}" width="${Math.max(5, step * .28).toFixed(1)}" height="${Math.max(0, top + plotHeight - yEnergy(value)).toFixed(1)}" rx="1.5" class="${css}"/>`;
      return `${visible("load") ? draw(load, -.18, "ai-readable-load") : ""}${visible("actual") ? draw(production, .18, "ai-readable-actual") : ""}`;
    }).join("");
    const upper = values.map((row, index) => {
      const value = this.asNumber(row.forecast_high_kwh);
      return value === null ? null : `${x(index).toFixed(1)},${yEnergy(value).toFixed(1)}`;
    }).filter(Boolean);
    const lower = values.map((row, index) => {
      const value = this.asNumber(row.forecast_low_kwh);
      return value === null ? null : `${x(index).toFixed(1)},${yEnergy(value).toFixed(1)}`;
    }).filter(Boolean).reverse();
    const band = visible("band") && upper.length && lower.length ? `<polygon points="${[...upper, ...lower].join(" ")}" class="ai-readable-band"/>` : "";
    const solcastLine = visible("solcast") ? `<polyline points="${linePoints("solcast_kwh", yEnergy)}" class="ai-readable-solcast"/>` : "";
    const correctedLine = visible("corrected") ? `<polyline points="${linePoints("corrected_pv_kwh", yEnergy)}" class="ai-readable-corrected"/>` : "";
    const socLine = visible("soc") ? `<polyline points="${linePoints("soc_after", ySoc)}" class="ai-readable-soc"/>` : "";
    const minSoc = this.asNumber(this.aiSettings()?.minSoc);
    const minSocLine = visible("minimum") && minSoc !== null
      ? `<line x1="${left}" y1="${ySoc(minSoc).toFixed(1)}" x2="${width - right}" y2="${ySoc(minSoc).toFixed(1)}" class="ai-readable-min-soc"/><text x="${left + 7}" y="${(ySoc(minSoc) - 7).toFixed(1)}" class="ai-readable-min-label">Min. SOC ${minSoc.toFixed(0)}%</text>` : "";
    const xLabels = values.map((row, index) => index % gridInterval === 0
      ? `<text x="${x(index).toFixed(1)}" y="${axisY}" text-anchor="middle" class="ai-readable-hour">${String(row.hour).padStart(2, "0")}:00</text>` : "").join("");
    const weather = values.map((row, index) => {
      const forecast = weatherMap.get(`${row.date}-${row.hour}`);
      const meta = forecast ? this.aiWeatherMeta(forecast.condition) : ["—", "brak prognozy"];
      const precipitation = this.asNumber(forecast?.precipitation_probability);
      const rainClass = precipitation === null ? "missing" : precipitation >= 70 ? "high" : precipitation >= 35 ? "medium" : "low";
      return `<text x="${x(index).toFixed(1)}" y="${weatherIconY}" text-anchor="middle" class="ai-readable-weather">${meta[0]}</text><rect x="${(x(index) - Math.max(3, step * .25)).toFixed(1)}" y="${weatherIconY + 9}" width="${Math.max(6, step * .5).toFixed(1)}" height="3" rx="1.5" class="ai-weather-risk ${rainClass}"/>`;
    }).join("");
    const distributionValues = values.map((row) => this.asNumber(row.distribution)).filter((value) => value !== null && value > 0);
    const minDistribution = distributionValues.length ? Math.min(...distributionValues) : null;
    const statuses = values.map((row, index) => {
      const cellX = left + index * step + step * .08;
      const cellWidth = Math.max(3, step * .84);
      const selling = row.action === "sell";
      const charging = row.action === "charge";
      const rate = this.asNumber(row.distribution);
      const cheap = minDistribution !== null && rate !== null && rate <= minDistribution + .00001;
      return `${selling ? `<rect x="${cellX.toFixed(1)}" y="${(statusTop + 5).toFixed(1)}" width="${cellWidth.toFixed(1)}" height="${statusRowHeight - 10}" rx="3" class="ai-status-sell"/>` : ""}${charging ? `<rect x="${cellX.toFixed(1)}" y="${(statusTop + statusRowHeight + 5).toFixed(1)}" width="${cellWidth.toFixed(1)}" height="${statusRowHeight - 10}" rx="3" class="ai-status-charge"/>` : ""}${cheap ? `<rect x="${cellX.toFixed(1)}" y="${(statusTop + statusRowHeight * 2 + 5).toFixed(1)}" width="${cellWidth.toFixed(1)}" height="${statusRowHeight - 10}" rx="3" class="ai-status-tariff"/>` : ""}`;
    }).join("");
    const statusGrid = [0, 1, 2, 3].map((index) => `<line x1="${left}" y1="${statusTop + index * statusRowHeight}" x2="${width - right}" y2="${statusTop + index * statusRowHeight}" class="ai-status-grid"/>`).join("");
    const statusVertical = values.map((row, index) => index % gridInterval === 0 ? `<line x1="${x(index).toFixed(1)}" y1="${statusTop}" x2="${x(index).toFixed(1)}" y2="${statusTop + statusRowHeight * 3}" class="ai-status-grid ai-status-grid-v"/>` : "").join("");
    const firstDate = values[0]?.date || "";
    const secondDate = values[24]?.date || "";
    const daySeparator = is48h ? `<line x1="${(left + step * 24).toFixed(1)}" y1="${top - 18}" x2="${(left + step * 24).toFixed(1)}" y2="${statusTop + statusRowHeight * 3}" class="ai-readable-day-separator"/><text x="${left + step * 12}" y="${top - 25}" text-anchor="middle" class="ai-readable-day-label">Dziś · ${this.escapeHtml(firstDate)}</text><text x="${left + step * 36}" y="${top - 25}" text-anchor="middle" class="ai-readable-day-label">Jutro · ${this.escapeHtml(secondDate)}</text>` : "";
    const now = new Date();
    const currentIndex = values.findIndex((row) => row.date === this.localDateKey(now) && Number(row.hour) === now.getHours());
    const nowX = currentIndex < 0 ? null : left + step * (currentIndex + now.getMinutes() / 60);
    const currentLine = nowX === null ? "" : `<line x1="${nowX.toFixed(1)}" y1="${top}" x2="${nowX.toFixed(1)}" y2="${statusTop + statusRowHeight * 3}" class="ai-readable-now"/><rect x="${(nowX + 6).toFixed(1)}" y="${top + 5}" width="42" height="20" rx="4" class="ai-readable-now-tag"/><text x="${(nowX + 27).toFixed(1)}" y="${top + 19}" text-anchor="middle" class="ai-readable-now-text">Teraz</text>`;
    const chartId = `readable-${String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const display = (value, digits = 2, unit = "") => {
      const number = this.asNumber(value);
      return number === null ? "brak danych" : `${number.toFixed(digits)}${unit}`;
    };
    const tips = values.map((row, index) => {
      const actualRow = actual[index];
      const forecast = weatherMap.get(`${row.date}-${row.hour}`) || {};
      const [, condition] = this.aiWeatherMeta(forecast.condition);
      return `<div class="ai-chart-tip-source" data-ai-tip-source="${chartId}-${index}"><strong>${this.escapeHtml(String(row.date || ""))} · ${this.escapeHtml(String(row.label || this.hourLabel(row.hour)))}</strong><div><span>Produkcja rzeczywista</span><b>${actualRow?.pvSamples ? display(actualRow.pv, 2, " kWh") : "brak danych"}</b><span>Zużycie</span><b>${actualRow?.loadSamples ? display(actualRow.load, 2, " kWh") : display(row.load_kwh, 2, " kWh")}</b><span>Prognoza Solcast</span><b>${display(row.solcast_kwh, 2, " kWh")}</b><span>Prognoza skorygowana</span><b>${display(row.corrected_pv_kwh, 2, " kWh")}</b><span>Przedział prognozy</span><b>${display(row.forecast_low_kwh, 2)}–${display(row.forecast_high_kwh, 2, " kWh")}</b><span>SOC</span><b>${display(row.soc_after, 1, "%")}</b><span>Status</span><b>${row.action === "sell" ? "sprzedaż" : row.action === "charge" ? "ładowanie" : "bez zmiany"}</b><span>Dystrybucja</span><b>${display(row.distribution, 4, " PLN/kWh")}</b><span>Pogoda</span><b>${forecast.condition ? `${this.escapeHtml(condition)} · ${display(forecast.temperature, 1, "°C")}` : "brak danych"}</b><span>Opady</span><b>${display(forecast.precipitation_probability, 0, "%")}</b><span>Bilans</span><b>${display(row.balance_pln, 2, " PLN")}</b></div></div>`;
    }).join("");
    const hits = values.map((row, index) => `<rect x="${(left + index * step).toFixed(1)}" y="${top}" width="${Math.max(1, step).toFixed(1)}" height="${statusTop + statusRowHeight * 3 - top}" class="ai-chart-hit" data-ai-chart-point="${chartId}" data-ai-chart-index="${index}"/>`).join("");
    const legend = [
      ["load", "Zużycie"], ["actual", "Produkcja rzeczywista"], ["solcast", "Prognoza Solcast"],
      ["corrected", "Prognoza skorygowana"], ["band", "Przedział prognozy"], ["soc", "SOC (%)"], ["minimum", `Min. SOC ${minSoc === null ? "" : `${minSoc.toFixed(0)}%`}`],
    ].map(([key, label]) => `<button class="${hidden.has(key) ? "disabled" : ""} ${key}" data-ai-chart-series="${key}" type="button"><i></i>${label}</button>`).join("");
    return `<section class="ai-chart-card ai-readable-chart" data-ai-chart="${chartId}"><h3>${this.escapeHtml(title)}</h3><div class="ai-readable-legend">${legend}</div><div class="ai-chart-scroll"><svg viewBox="0 0 ${width} ${height}" style="min-width:${width}px" role="img" aria-label="${this.escapeHtml(title)}"><text x="${left - 40}" y="${top - 16}" class="ai-readable-unit">kWh</text><text x="${width - right + 24}" y="${top - 16}" class="ai-readable-unit">%</text>${horizontalGrid}${verticalGrid}${band}${bars}${solcastLine}${correctedLine}${socLine}${minSocLine}<line x1="${left}" y1="${top + plotHeight}" x2="${width - right}" y2="${top + plotHeight}" class="ai-readable-baseline"/>${xLabels}<text x="12" y="${weatherIconY}" class="ai-readable-section-label">Pogoda</text>${weather}${statusGrid}${statusVertical}<text x="12" y="${statusTop - 10}" class="ai-readable-section-label">Status godziny</text><text x="15" y="${statusTop + 21}" class="ai-status-label sell">■ Sprzedaż</text><text x="15" y="${statusTop + statusRowHeight + 21}" class="ai-status-label charge">■ Ładowanie</text><text x="15" y="${statusTop + statusRowHeight * 2 + 21}" class="ai-status-label tariff">■ Tania dystrybucja</text>${statuses}${daySeparator}${currentLine}<line class="ai-chart-crosshair-x" x1="0" x2="0" y1="${top}" y2="${statusTop + statusRowHeight * 3}"/><line class="ai-chart-crosshair-y" x1="${left}" x2="${width - right}" y1="0" y2="0"/>${hits}</svg></div><div class="ai-chart-tooltip" data-ai-chart-tooltip></div>${tips}<small class="ai-chart-help">Kliknij legendę, aby ukryć serię. Najedź kursorem lub dotknij godziny, aby zobaczyć energię, SOC, pogodę i status.</small></section>`;
  }

  aiReadableEnergyChart(rows, title = "Plan energii") {
    const values = Array.isArray(rows) ? rows : [];
    if (values.length <= 24) return this.aiReadableDayChart(values, title, "single");

    const days = [];
    values.slice(0, 48).forEach((row) => {
      const date = row?.date || "brak daty";
      let day = days.find((item) => item.date === date);
      if (!day) {
        day = { date, rows: [] };
        days.push(day);
      }
      day.rows.push(row);
    });
    return `<section class="ai-energy-48-crisp"><h3>${this.escapeHtml(title)}</h3><div class="ai-readable-stack">${days.slice(0, 2).map((day, index) => this.aiReadableDayChart(day.rows, `${index === 0 ? "Dziś" : "Jutro"} · ${day.date}`, `day-${index}`)).join("")}</div></section>`;
  }

  aiReadableDayChart(rows, title, chartSuffix = "single") {
    const values = Array.isArray(rows) ? rows.slice(0, 24) : [];
    const count = Math.max(1, values.length);
    const width = 1000;
    const top = 10;
    const plotHeight = 252;
    const bottom = top + plotHeight;
    const step = width / count;
    const hidden = this._aiChartHiddenSeries instanceof Set ? this._aiChartHiddenSeries : new Set();
    const visible = (name) => !hidden.has(name);
    const history = this.aiHistoricalHours();
    const actual = values.map((row) => history.get(`${row.date}-${row.hour}`) || null);
    const weatherState = this._hass?.states?.[this.entity("sensor", "ai_state")]?.attributes?.weather || {};
    const forecastRows = Array.isArray(weatherState.forecast) ? weatherState.forecast : [];
    const weatherMap = new Map(forecastRows.map((row) => {
      const stamp = new Date(row?.datetime ?? row?.time ?? "");
      return Number.isNaN(stamp.getTime()) ? ["", null] : [`${this.localDateKey(stamp)}-${stamp.getHours()}`, row];
    }));
    const energyValues = [];
    values.forEach((row, index) => {
      [actual[index]?.pvSamples ? actual[index].pv : null, actual[index]?.loadSamples ? actual[index].load : null,
        this.asNumber(row.load_kwh), this.asNumber(row.solcast_kwh), this.asNumber(row.corrected_pv_kwh), this.asNumber(row.forecast_high_kwh)]
        .forEach((value) => { if (value !== null) energyValues.push(Math.max(0, value)); });
    });
    const maxEnergy = Math.max(1, ...energyValues) * 1.08;
    const x = (index) => index * step + step / 2;
    const yEnergy = (value) => bottom - Math.max(0, value || 0) / maxEnergy * plotHeight;
    const ySoc = (value) => bottom - Math.max(0, Math.min(100, value || 0)) / 100 * plotHeight;
    const linePoints = (field, yFn) => values.map((row, index) => {
      const value = this.asNumber(row[field]);
      return value === null ? null : `${x(index).toFixed(1)},${yFn(value).toFixed(1)}`;
    }).filter(Boolean).join(" ");
    const horizontalGrid = [.2, .4, .6, .8].map((part) => `<line x1="0" y1="${(top + plotHeight * part).toFixed(1)}" x2="${width}" y2="${(top + plotHeight * part).toFixed(1)}" class="ai-crisp-grid"/>`).join("");
    const verticalGuides = [0, 6, 12, 18, 24].map((hour) => `<line x1="${(hour * step).toFixed(1)}" y1="${top}" x2="${(hour * step).toFixed(1)}" y2="${bottom}" class="ai-crisp-guide"/>`).join("");
    const bars = values.map((row, index) => {
      const actualRow = actual[index];
      const load = actualRow?.loadSamples ? actualRow.load : this.asNumber(row.load_kwh);
      const production = actualRow?.pvSamples ? actualRow.pv : null;
      const draw = (value, offset, css) => value === null ? "" : `<rect x="${(x(index) + step * offset - Math.max(2, step * .13)).toFixed(1)}" y="${yEnergy(value).toFixed(1)}" width="${Math.max(4, step * .26).toFixed(1)}" height="${Math.max(0, bottom - yEnergy(value)).toFixed(1)}" rx="2" class="${css}"/>`;
      return `${visible("load") ? draw(load, -.17, "ai-crisp-load") : ""}${visible("actual") ? draw(production, .17, "ai-crisp-actual") : ""}`;
    }).join("");
    const upper = values.map((row, index) => {
      const value = this.asNumber(row.forecast_high_kwh);
      return value === null ? null : `${x(index).toFixed(1)},${yEnergy(value).toFixed(1)}`;
    }).filter(Boolean);
    const lower = values.map((row, index) => {
      const value = this.asNumber(row.forecast_low_kwh);
      return value === null ? null : `${x(index).toFixed(1)},${yEnergy(value).toFixed(1)}`;
    }).filter(Boolean).reverse();
    const band = visible("band") && upper.length && lower.length ? `<polygon points="${[...upper, ...lower].join(" ")}" class="ai-crisp-band"/>` : "";
    const solcastLine = visible("solcast") ? `<polyline points="${linePoints("solcast_kwh", yEnergy)}" class="ai-crisp-solcast"/>` : "";
    const correctedLine = visible("corrected") ? `<polyline points="${linePoints("corrected_pv_kwh", yEnergy)}" class="ai-crisp-corrected"/>` : "";
    const socLine = visible("soc") ? `<polyline points="${linePoints("soc_after", ySoc)}" class="ai-crisp-soc"/>` : "";
    const minSoc = this.asNumber(this.aiSettings()?.minSoc);
    const minSocLine = visible("minimum") && minSoc !== null ? `<line x1="0" y1="${ySoc(minSoc).toFixed(1)}" x2="${width}" y2="${ySoc(minSoc).toFixed(1)}" class="ai-crisp-min-soc"/>` : "";
    const now = new Date();
    const currentIndex = values.findIndex((row) => row.date === this.localDateKey(now) && Number(row.hour) === now.getHours());
    const currentX = currentIndex < 0 ? null : (currentIndex + now.getMinutes() / 60) * step;
    const currentLine = currentX === null ? "" : `<line x1="${currentX.toFixed(1)}" y1="${top}" x2="${currentX.toFixed(1)}" y2="${bottom}" class="ai-crisp-now"/>`;
    const distribution = values.map((row) => this.asNumber(row.distribution)).filter((value) => value !== null && value > 0);
    const cheapRate = distribution.length ? Math.min(...distribution) : null;
    const timeLabels = values.map((row, index) => `<span>${index % 3 === 0 ? `${String(row.hour).padStart(2, "0")}:00` : ""}</span>`).join("");
    const weatherCells = values.map((row) => {
      const forecast = weatherMap.get(`${row.date}-${row.hour}`);
      const [icon, label] = forecast ? this.aiWeatherMeta(forecast.condition) : ["—", "brak prognozy"];
      const precipitation = this.asNumber(forecast?.precipitation_probability);
      const risk = precipitation === null ? "missing" : precipitation >= 70 ? "high" : precipitation >= 35 ? "medium" : "low";
      return `<span class="ai-crisp-weather-cell" title="${this.escapeHtml(`${label}${precipitation === null ? "" : ` · opady ${precipitation.toFixed(0)}%`}`)}"><b>${icon}</b><i class="${risk}"></i></span>`;
    }).join("");
    const statusCells = (kind) => values.map((row) => {
      const rate = this.asNumber(row.distribution);
      const active = kind === "sell" ? row.action === "sell" : kind === "charge" ? row.action === "charge" : cheapRate !== null && rate !== null && rate <= cheapRate + .00001;
      return `<span class="${active ? `active ${kind}` : ""}"></span>`;
    }).join("");
    const chartId = `crisp-${String(chartSuffix).replace(/[^a-z0-9]+/gi, "-")}-${String(values[0]?.date || "empty").replace(/[^a-z0-9]+/gi, "-")}`;
    const display = (value, digits = 2, unit = "") => {
      const number = this.asNumber(value);
      return number === null ? "brak danych" : `${number.toFixed(digits)}${unit}`;
    };
    const tips = values.map((row, index) => {
      const actualRow = actual[index];
      const forecast = weatherMap.get(`${row.date}-${row.hour}`) || {};
      const [, condition] = this.aiWeatherMeta(forecast.condition);
      return `<div class="ai-chart-tip-source" data-ai-tip-source="${chartId}-${index}"><strong>${this.escapeHtml(String(row.date || ""))} · ${this.escapeHtml(String(row.label || this.hourLabel(row.hour)))}</strong><div><span>Produkcja rzeczywista</span><b>${actualRow?.pvSamples ? display(actualRow.pv, 2, " kWh") : "brak danych"}</b><span>Zużycie</span><b>${actualRow?.loadSamples ? display(actualRow.load, 2, " kWh") : display(row.load_kwh, 2, " kWh")}</b><span>Prognoza Solcast</span><b>${display(row.solcast_kwh, 2, " kWh")}</b><span>Prognoza skorygowana</span><b>${display(row.corrected_pv_kwh, 2, " kWh")}</b><span>Przedział prognozy</span><b>${display(row.forecast_low_kwh, 2)}–${display(row.forecast_high_kwh, 2, " kWh")}</b><span>SOC</span><b>${display(row.soc_after, 1, "%")}</b><span>Status</span><b>${row.action === "sell" ? "sprzedaż" : row.action === "charge" ? "ładowanie" : "bez zmiany"}</b><span>Pogoda</span><b>${forecast.condition ? `${this.escapeHtml(condition)} · ${display(forecast.temperature, 1, "°C")}` : "brak danych"}</b><span>Bilans</span><b>${display(row.balance_pln, 2, " PLN")}</b></div></div>`;
    }).join("");
    const hits = values.map((row, index) => `<rect x="${(index * step).toFixed(1)}" y="${top}" width="${Math.max(1, step).toFixed(1)}" height="${plotHeight}" class="ai-chart-hit ai-crisp-hit" data-ai-chart-point="${chartId}" data-ai-chart-index="${index}"/>`).join("");
    const legend = [["load", "Zużycie"], ["actual", "Produkcja rzeczywista"], ["solcast", "Prognoza Solcast"], ["corrected", "Prognoza skorygowana"], ["band", "Przedział prognozy"], ["soc", "SOC (%)"], ["minimum", `Min. SOC ${minSoc === null ? "" : `${minSoc.toFixed(0)}%`}`]].map(([key, label]) => `<button class="${hidden.has(key) ? "disabled" : ""} ${key}" data-ai-chart-series="${key}" type="button"><i></i>${label}</button>`).join("");
    const leftAxis = [maxEnergy, maxEnergy / 2, 0].map((value) => `<span>${value.toFixed(1)}</span>`).join("");
    return `<section class="ai-chart-card ai-crisp-chart" data-ai-chart="${chartId}"><h3>${this.escapeHtml(title)}</h3><div class="ai-crisp-legend">${legend}</div><div class="ai-crisp-layout"><div class="ai-crisp-axis ai-crisp-axis-left"><b>kWh</b>${leftAxis}</div><div class="ai-crisp-main"><div class="ai-crisp-plot"><svg class="ai-crisp-svg" viewBox="0 0 ${width} ${bottom}" preserveAspectRatio="none" role="img" aria-label="${this.escapeHtml(title)}">${horizontalGrid}${verticalGuides}${band}${bars}${solcastLine}${correctedLine}${socLine}${minSocLine}${currentLine}<line x1="0" y1="${bottom}" x2="${width}" y2="${bottom}" class="ai-crisp-baseline"/><line class="ai-chart-crosshair-x" x1="0" x2="0" y1="${top}" y2="${bottom}"/><line class="ai-chart-crosshair-y" x1="0" x2="${width}" y1="0" y2="0"/>${hits}</svg>${currentX === null ? "" : '<span class="ai-crisp-now-tag">Teraz</span>'}</div><div class="ai-crisp-time-grid">${timeLabels}</div><div class="ai-crisp-weather-grid">${weatherCells}</div><div class="ai-crisp-status"><span>Sprzedaż</span><div>${statusCells("sell")}</div><span>Ładowanie</span><div>${statusCells("charge")}</div><span>Tania dystrybucja</span><div>${statusCells("tariff")}</div></div></div><div class="ai-crisp-axis ai-crisp-axis-right"><b>%</b><span>100</span><span>50</span><span>0</span></div></div><div class="ai-chart-tooltip" data-ai-chart-tooltip></div>${tips}<small class="ai-chart-help">Kliknij legendę, aby ukryć serię. Najedź kursorem lub dotknij godziny, aby zobaczyć szczegóły; pogoda i status są pokazane dla każdej godziny.</small></section>`;
  }

  renderAiOverview(slots, planner) {
    const summaries = new Map((planner.days || []).map((row) => [row.day, row]));
    const checkpoints = planner.checkpoints || {};
    const future = this._hass?.states?.[this.entity("sensor", "ai_state")]?.attributes?.future_plan || {};
    return `<div class="ai-overview-grid">
      <section class="ai-metric-card"><h3>Najlepsze godziny sprzedaży</h3>${this.aiPriceColumns(slots, "sell")}</section>
      <section class="ai-metric-card"><h3>Najtańsze godziny zakupu</h3>${this.aiPriceColumns(slots, "buy")}</section>
      <section class="ai-metric-card"><h3>Prognoza SOC 48h</h3><div class="ai-kpis"><div><span>Koniec dziś</span><strong>${this.formatNumber(checkpoints.today_end, 1)}%</strong></div><div><span>Jutro 05:00</span><strong>${this.formatNumber(checkpoints.tomorrow_05, 1)}%</strong></div><div><span>Jutro 09:00</span><strong>${this.formatNumber(checkpoints.tomorrow_09, 1)}%</strong></div><div><span>Koniec jutro</span><strong>${this.formatNumber(checkpoints.tomorrow_end, 1)}%</strong></div></div></section>
      <section class="ai-metric-card"><h3>Bilans planu</h3><p>Dziś: ${this.formatEnergy(summaries.get("today")?.sold_kwh || 0)} sprzedaży / ${this.formatNumber(summaries.get("today")?.balance_pln, 2)} PLN<br>Jutro: ${this.formatEnergy(summaries.get("tomorrow")?.sold_kwh || 0)} sprzedaży / ${this.formatNumber(summaries.get("tomorrow")?.balance_pln, 2)} PLN</p><p class="${future.status === "scheduled" ? "good" : ""}">Plan na jutro: ${future.status === "scheduled" ? `zaplanowany (${future.date})` : "niezaplanowany"}</p>${future.status === "scheduled" ? '<button class="ai-cancel-plan" data-cancel-future-plan="1">Anuluj plan na jutro</button>' : ""}</section>
      ${this.aiReadableEnergyChart((planner.rows || []).slice(0, 48), "Plan energii 48h")}
    </div>`;
  }

  renderAiProposalView(slots, planner) {
    const day = this._aiDay;
    const allRows = this.aiRowsForDay(planner, day);
    const proposed = allRows.filter((row) => row.proposed);
    const rows = this._aiShow24 ? allRows : proposed;
    const selected = this.aiSelection(day);
    const allSelected = proposed.length > 0 && proposed.every((row) => selected.has(this.aiSlotKey(row.hour)));
    const selectedCount = proposed.filter((row) => selected.has(this.aiSlotKey(row.hour))).length;
    const settings = this.aiSettings();
    const tableRows = rows.length ? rows.map((row) => {
      const key = this.aiSlotKey(row.hour);
      const selling = row.action === "sell";
      const charging = row.action === "charge";
      const confidence = this.asNumber(row.confidence) || 0;
      return `<tr class="${row.proposed ? "proposed" : "unchanged"}"><td>${row.proposed ? `<input type="checkbox" data-ai-plan-row="${key}" ${selected.has(key) ? "checked" : ""}>` : "–"}</td><td>${row.label || this.hourLabel(row.hour)}</td><td>${row.proposed ? this.modePill(row.mode, true) : '<span class="mode-pill off">Bez zmiany</span>'}</td><td>${selling ? `${Math.round(this.asNumber(settings.maxSellPower) || 0)} W` : "–"}</td><td>${selling ? `${Number(settings.maxDischargeCurrent) || 0} A` : "–"}</td><td>${charging ? `${Number(settings.maxGridChargeCurrent) || 0} A` : "–"}</td><td>${row.proposed ? this.formatEnergy(row.energy_kwh) : "–"}</td><td>${this.formatNumber(row.soc_after, 1)}%</td><td class="${(this.asNumber(row.balance_pln) || 0) >= 0 ? "good" : "warn"}">${this.formatNumber(row.balance_pln, 2)} PLN</td><td><span class="ai-confidence ${this.aiConfidenceClass(confidence)}">${this.formatNumber(confidence, 0)}%</span></td></tr>`;
    }).join("") : `<tr><td colspan="10" class="ai-empty">Brak propozycji — integracja nie tworzy danych zastępczych.</td></tr>`;
    const best = proposed.slice().sort((a, b) => (this.asNumber(b.balance_pln) || 0) - (this.asNumber(a.balance_pln) || 0))[0];
    const variants = planner.variants || {};
    const variantSummary = (key, label) => {
      const summary = variants[key]?.days?.find((item) => item.day === day);
      return `<button class="${planner.selected_strategy === key ? "active" : ""}" disabled><strong>${label}</strong><span>${summary ? `SOC ${this.formatNumber(summary.end_soc, 1)}% · ${this.formatNumber(summary.balance_pln, 2)} PLN` : "brak danych"}</span></button>`;
    };
    const quality = planner.data_quality || {};
    return `<div class="ai-proposals-view"><h2>Proponowane zmiany</h2>
      <div class="ai-proposal-toolbar"><div class="ai-day-tabs"><button class="${day === "today" ? "active" : ""}" data-ai-day="today">Dziś</button><button class="${day === "tomorrow" ? "active" : ""}" data-ai-day="tomorrow">Jutro</button></div><div class="ai-view-tools"><button data-ai-toggle-24="1">${this._aiShow24 ? "Tylko propozycje" : "Pełne 24h"}</button><button class="${allSelected ? "neutral" : "select"}" data-ai-toggle-selection="1" ${!proposed.length ? "disabled" : ""}>${allSelected ? "× Odznacz wszystkie" : "✓ Zaznacz wszystkie"}</button></div></div>
      <div class="ai-plan-table-wrap"><table class="ai-plan-table"><thead><tr><th>Wybór</th><th>Godzina</th><th>Tryb</th><th>Moc</th><th>Rozł.</th><th>Ład.</th><th>Energia</th><th>SOC po</th><th>Bilans</th><th>Pewność</th></tr></thead><tbody>${tableRows}</tbody></table></div>
      <div class="ai-decision-grid"><section><h3>🏆 Najlepsza decyzja</h3><p>${best ? `${best.label}<br>${best.mode} · pewność ${this.formatNumber(best.confidence, 0)}%` : "Brak decyzji spełniającej warunki"}</p></section><section><h3>⚖ Trzy warianty</h3><div class="ai-variants">${variantSummary("safe", "Bezpieczny")}${variantSummary("balanced", "Zrównoważony")}${variantSummary("profit", "Maksymalny zysk")}</div></section><section><h3>💡 Uzasadnienie AI</h3><p>Plan uwzględnia ceny energii i dystrybucji, Solcast, pogodę pomocniczą, wyuczony profil domu, sprawność i rezerwę baterii. ${quality.learning_stage === "gotowe" ? "Model ma wystarczającą historię." : "Model jest na etapie wstępnego uczenia, dlatego pewność jest ograniczona."}</p></section></div>
      ${this.aiReadableEnergyChart(allRows, `Plan na ${day === "today" ? "dziś" : "jutro"}`)}
      <div class="ai-support-grid">${this.aiWeatherCard(planner, day)}${this.renderAiQualityCard(planner)}</div>
      <button class="ai-apply-plan" data-apply-ai-day="1" ${!selectedCount ? "disabled" : ""}>${day === "today" ? "Zastosuj wybrane na dziś" : "Zaplanuj wybrane na jutro"} (${selectedCount})</button>
    </div>`;
  }

  renderAiQualityCard(planner) {
    const quality = planner.data_quality || {};
    const tariff = this.tariffData();
    const aiState = this._hass?.states?.[this.entity("sensor", "ai_state")];
    const learning = aiState?.attributes?.learning_summary || {};
    const weather = aiState?.attributes?.weather || {};
    const mapping = this.state(this.entity("sensor", "mapping_status"), "brak");
    const accuracy = this.asNumber(learning.solcast_accuracy_avg);
    return `<section class="ai-metric-card ai-quality-card"><h3>Dane i jakość</h3><ul><li><span>Status uczenia</span><strong>${quality.learning_stage || "brak"}</strong></li><li><span>Zapisane dni / godziny</span><strong>${quality.recorded_days || 0} / ${learning.recorded_hours || 0}</strong></li><li><span>Trafność zakończonych dni</span><strong>${accuracy === null ? "brak danych" : `${accuracy.toFixed(1)}% (${learning.solcast_accuracy_days || 0} dni)`}</strong></li><li><span>Ceny jutra</span><strong>sprzedaż ${quality.tomorrow_sell_prices || 0}/24 · zakup ${quality.tomorrow_buy_prices || 0}/24</strong></li><li><span>Pogoda / aktualizacja</span><strong>${quality.weather_hours || 0}/48 h · ${this.formatTimeShort(weather.last_updated)}</strong></li><li><span>Profil PV</span><strong>${quality.pv_profile_learned ? "wyuczony" : "krzywa pomocnicza"}</strong></li><li><span>OSD / taryfa</span><strong>${tariff.provider_name || tariff.provider || "brak"} · ${tariff.plan_name || tariff.plan || "brak"}</strong></li><li><span>Wersja katalogu</span><strong>${tariff.catalog_version || "wbudowana"}</strong></li><li><span>Mapowanie Deye</span><strong>${mapping}</strong></li><li><span>Ostatnia analiza</span><strong>${this.formatTimeShort(planner.generated_at)}</strong></li></ul></section>`;
  }

  renderAiQualityCard(planner) {
    const quality = planner.data_quality || {};
    const tariff = this.tariffData();
    const aiState = this._hass?.states?.[this.entity("sensor", "ai_state")];
    const learning = aiState?.attributes?.learning_summary || {};
    const weather = aiState?.attributes?.weather || {};
    const mapping = this.state(this.entity("sensor", "mapping_status"), "brak");
    const accuracy = this.asNumber(learning.solcast_accuracy_avg);
    const weatherStatus = weather.available
      ? `${weather.entity_id || "encja pogody"} · ${weather.hourly_count || 0}/48 h · ${weather.daily_count || 0}/7 dni · ${this.formatTimeShort(weather.last_updated)}`
      : `${weather.entity_id || "brak encji"} · niedostępna${weather.last_error ? ` · ${weather.last_error}` : ""}`;
    return `<section class="ai-metric-card ai-quality-card"><h3>Dane i jakość</h3><ul><li><span>Status uczenia</span><strong>${quality.learning_stage || "brak"}</strong></li><li><span>Zapisane dni / godziny</span><strong>${quality.recorded_days || 0} / ${learning.recorded_hours || 0}</strong></li><li><span>Trafność zakończonych dni</span><strong>${accuracy === null ? "brak danych" : `${accuracy.toFixed(1)}% (${learning.solcast_accuracy_days || 0} dni)`}</strong></li><li><span>Ceny jutra</span><strong>sprzedaż ${quality.tomorrow_sell_prices || 0}/24 · zakup ${quality.tomorrow_buy_prices || 0}/24</strong></li><li><span>Pogoda / aktualizacja</span><strong>${this.escapeHtml(weatherStatus)}</strong></li><li><span>Profil PV</span><strong>${quality.pv_profile_learned ? "wyuczony" : "krzywa pomocnicza"}</strong></li><li><span>OSD / taryfa</span><strong>${tariff.provider_name || tariff.provider || "brak"} · ${tariff.plan_name || tariff.plan || "brak"}</strong></li><li><span>Wersja katalogu</span><strong>${tariff.catalog_version || "wbudowana"}</strong></li><li><span>Mapowanie Deye</span><strong>${mapping}</strong></li><li><span>Ostatnia analiza</span><strong>${this.formatTimeShort(planner.generated_at)}</strong></li></ul></section>`;
  }

  renderAiPlanDay(planner, day) {
    const rows = this.aiRowsForDay(planner, day);
    const summary = (planner.days || []).find((item) => item.day === day) || {};
    return `<div class="ai-day-plan"><div class="ai-kpis"><div><span>SOC start</span><strong>${this.formatNumber(summary.start_soc, 1)}%</strong></div><div><span>SOC koniec</span><strong>${this.formatNumber(summary.end_soc, 1)}%</strong></div><div><span>Sprzedaż</span><strong>${this.formatEnergy(summary.sold_kwh || 0)}</strong></div><div><span>Zakup</span><strong>${this.formatEnergy(summary.bought_kwh || 0)}</strong></div><div><span>Bilans</span><strong>${this.formatNumber(summary.balance_pln, 2)} PLN</strong></div></div>${this.aiReadableEnergyChart(rows, day === "today" ? "Plan na dziś" : "Plan na jutro")}${this.aiWeatherCard(planner, day)}</div>`;
  }

  renderAiDialog(slots) {
    const planner = this.aiPlannerData(slots);
    const nav = [
      ["overview", "⌂", "Przegląd"], ["proposals", "↗", "Proponowane zmiany"],
      ["today", "▣", "Plan na dziś"], ["tomorrow", "▣", "Plan na jutro"],
      ["energy", "◷", "Plan energii 48h"], ["quality", "▦", "Jakość danych"],
    ].map(([key, icon, label]) => `<button class="${this._aiView === key ? "active" : ""}" data-ai-view="${key}"><span>${icon}</span>${label}</button>`).join("");
    let body = this.renderAiOverview(slots, planner);
    if (this._aiView === "proposals") body = this.renderAiProposalView(slots, planner);
    if (this._aiView === "today") body = this.renderAiPlanDay(planner, "today");
    if (this._aiView === "tomorrow") body = this.renderAiPlanDay(planner, "tomorrow");
    if (this._aiView === "energy") body = `<div class="ai-energy-48">${this.aiReadableEnergyChart(planner.rows || [], "Plan energii 48h")}<div class="ai-support-grid">${this.aiWeatherCard(planner, "today")}${this.aiWeatherCard(planner, "tomorrow")}</div></div>`;
    if (this._aiView === "quality") body = `<div class="ai-quality-full">${this.renderAiQualityCard(planner)}${this.aiWeatherCard(planner, "today")}${this.aiWeatherCard(planner, "tomorrow")}</div>`;
    const quality = planner.data_quality || {};
    return `<div class="overlay" data-close-dialog="1"><section class="dialog ai-dialog ai-dialog-v2" data-dialog-box="1"><div class="dialog-head"><strong>Sugestie AI</strong><button type="button" data-close-dialog="1">${this.iconSvg("close")}</button></div><div class="ai-shell"><aside class="ai-sidebar"><nav>${nav}</nav><div class="ai-learning-status"><span>Status AI</span><strong>${quality.learning_stage === "gotowe" ? "UCZY SIĘ" : "WSTĘPNE UCZENIE"}</strong><small>Zapisane dni: ${quality.recorded_days || 0}</small></div></aside><main class="ai-main" data-scroll-key="ai-main">${body}</main></div></section></div>`;
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
        <div><span>Strategia</span><strong>${this.escapeHtml(strategy)}</strong></div>
        <div><span>Maks. moc sprzedaży</span><strong>${maxSellPower === null ? "Brak danych" : `${this.formatNumber(maxSellPower, 0)} W`}</strong></div>
        <div><span>Minimalny SOC</span><strong>${minSoc === null ? "Brak danych" : `${this.formatNumber(minSoc, 0)}%`}</strong></div>
        <div><span>Prognoza Solcast</span><strong>${this.formatNumber(item.solcastToday, 2)} kWh</strong></div>
        <div><span>Pozostała prognoza</span><strong>${this.formatNumber(item.solcastRemaining, 2)} kWh</strong></div>
        <div><span>Rzeczywista produkcja PV</span><strong>${this.formatNumber(item.dailyPv, 2)} kWh</strong></div>
        <div><span>Korekta prognozy</span><strong>${correction === null ? "Brak danych" : `${this.formatNumber(correction * 100, 0)}%`}</strong></div>
        <div><span>Przewidywane zużycie domu</span><strong>${this.formatNumber(item.expectedRemainingLoad, 2)} kWh</strong></div>
        <div><span>Szacowana nadwyżka</span><strong>${this.formatNumber(item.estimatedSurplus, 2)} kWh</strong></div>
        <div><span>Prognozowany SOC</span><strong>${predictedSoc === null ? "Brak danych" : `${this.formatNumber(predictedSoc, 0)}%`}</strong></div>
        <div><span>Trend magazynu</span><strong>${this.escapeHtml(item.predictedSocTrend || "Brak danych")}</strong></div>
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
    const eventLabel = (event) => this.escapeHtml(({ suggestion: "Sugestia", accepted: "Zaakceptowana", daily_summary: "Podsumowanie dnia" }[event] || event || "Sugestia"));
    const analysisRows = analyses.length ? analyses.map((item) => {
      const date = new Date(Number(item.timestamp) || item.date || 0);
      const dateLabel = Number.isNaN(date.getTime()) ? (item.date || "brak") : date.toLocaleString("pl-PL");
      const sell = item.bestSell?.[0] ? `${this.hourLabel(item.bestSell[0][0])} · ${this.formatPrice(item.bestSell[0][1])} PLN` : "brak";
      const outcome = item.event === "daily_summary" ? `Trafność ${this.formatNumber(item.accuracy_percent, 1)}%` : item.outcome ? `${this.formatNumber(item.outcome.sold_kwh, 2)} kWh / ${this.formatNumber(item.outcome.sold_value, 2)} PLN · PV ${this.formatNumber(item.outcome.pv_accuracy_percent, 0)}%` : item.rating ? `Ocena ${item.rating}/5` : item.event === "accepted" ? "Oczekuje na wynik dnia" : "Nie zastosowano";
      const rating = item.event === "accepted" || item.event === "suggestion" ? `<span class="history-rating">${[1,2,3,4,5].map((value) => `<button data-rate-history="${item.timestamp}" data-rating="${value}" class="${Number(item.rating) === value ? "active" : ""}">${value}</button>`).join("")}</span>` : "";
      return `<tr><td>${this.escapeHtml(dateLabel)}</td><td>${eventLabel(item.event)}</td><td>${sell}</td><td>${outcome}<br>${rating}</td><td></td></tr>
        <tr class="analysis-detail-row"><td colspan="5"><details class="analysis-record"><summary>Szczegóły</summary>${this.renderAnalysisDetails(item)}</details></td></tr>`;
    }).join("") : `<tr><td colspan="5">Brak rekordów dla wybranych filtrów</td></tr>`;
    const dailyRows = daily.length ? daily.map((item) => {
      const accuracy = item.accuracy_percent === null || item.accuracy_percent === undefined
        ? `W toku (${this.formatNumber(item.forecast_progress_percent, 1)}% realizacji)`
        : `${this.formatNumber(item.accuracy_percent, 1)}%`;
      return `<tr><td>${item.date}</td><td>${this.formatNumber(item.forecast_kwh, 2)}</td><td>${this.formatNumber(item.actual_kwh ?? item.pv_kwh, 2)}</td><td>${accuracy}</td><td>${this.formatNumber(item.load_kwh, 2)}</td><td>${this.formatNumber(item.battery_charge_kwh, 2)} / ${this.formatNumber(item.battery_discharge_kwh, 2)}</td><td>${this.formatNumber(item.sold_kwh, 2)} / ${this.formatNumber(item.sold_value, 2)} PLN</td></tr>`;
    }).join("") : `<tr><td colspan="7">Brak podsumowań dziennych</td></tr>`;
    const monthlyRows = monthly.length ? monthly.map((item) => `<tr><td>${item.month}</td><td>${item.days}</td><td>${this.formatNumber(item.pv_kwh, 1)}</td><td>${this.formatNumber(item.load_kwh, 1)}</td><td>${this.formatNumber(item.grid_import_kwh, 1)} / ${this.formatNumber(item.grid_export_kwh, 1)}</td><td>${this.formatNumber(item.sold_kwh, 1)} / ${this.formatNumber(item.sold_value, 2)} PLN</td></tr>`).join("") : `<tr><td colspan="6">Brak podsumowań miesięcznych</td></tr>`;
    return `<div class="history-toolbar">
      <label>Od<input type="date" data-history-filter="from" value="${filters.from || ""}"></label>
      <label>Do<input type="date" data-history-filter="to" value="${filters.to || ""}"></label>
      <label>Typ<select data-history-filter="type"><option value="all">Wszystkie</option><option value="suggestion" ${filters.type === "suggestion" ? "selected" : ""}>Sugestie</option><option value="accepted" ${filters.type === "accepted" ? "selected" : ""}>Zaakceptowane</option><option value="daily_summary" ${filters.type === "daily_summary" ? "selected" : ""}>Podsumowania dnia</option></select></label>
      <button data-export-history="csv">Eksport CSV</button><button data-export-history="json">Eksport JSON</button><button data-export-monthly="1">Raport miesięczny</button>
    </div>
    <section class="history-section"><h3>Prognoza i rzeczywista produkcja</h3><div class="history-scroll"><table class="settings-table"><thead><tr><th>Data</th><th>Prognoza kWh</th><th>Produkcja kWh</th><th>Trafność / stan</th><th>Dom kWh</th><th>Ład./rozł. kWh</th><th>Sprzedaż</th></tr></thead><tbody>${dailyRows}</tbody></table></div></section>
    <section class="history-section"><h3>Wcześniejsze sugestie i skuteczność</h3><div class="history-scroll analysis-history-scroll"><table class="settings-table analysis-history-table"><thead><tr><th>Data</th><th>Typ</th><th>Najlepsza sprzedaż</th><th>Wynik / ocena</th><th>Rekord</th></tr></thead><tbody>${analysisRows}</tbody></table></div></section>
    <section class="history-section"><h3>Podsumowania miesięczne</h3><div class="history-scroll"><table class="settings-table"><thead><tr><th>Miesiąc</th><th>Dni</th><th>PV kWh</th><th>Dom kWh</th><th>Import / eksport</th><th>Sprzedaż</th></tr></thead><tbody>${monthlyRows}</tbody></table></div></section>
    <button class="danger-action" data-clear-all-history="1">Wyczyść historię i dane</button>`;
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
          <td>${this.displayState(tou.grid, "brak") === "on" ? "tak" : this.displayState(tou.grid, "brak") === "off" ? "nie" : "brak"}</td>
          <td><button class="icon-only" data-open-tou="${idx}" title="Edytuj">${this.iconSvg("edit")}</button></td>
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
        <td>${item.touSoc === null ? "wymaga potwierdzenia" : `${item.touSoc}%`}</td>
      </tr>`).join("");

      let body = "";
      if (tab === "defaults") {
        body = `
          <h3>Ustawienia domyślne dla falownika</h3>
          <div class="hint">Te wartości są automatycznie stosowane po Stop Sell, zatrzymaniu awaryjnym albo błędzie sterowania. Ustaw tutaj konfigurację bezpieczną dla swojej instalacji.</div>
          ${this.row("Domyślny tryb falownika", this.rawSelect("default-work-mode", this.inverterWorkModes(), this.state(this.entity("select", "default_work_mode"))))}
          ${this.row("Domyślna maksymalna moc sprzedaży", this.defaultProfileInput("sell_power", this.entity("number", "default_sell_power"), "W"))}
          ${this.row("Domyślny prąd rozładowania", this.defaultProfileInput("discharge_current", this.entity("number", "default_discharge_current"), "A"))}
          ${this.row("Domyślny prąd ładowania baterii", this.defaultProfileInput("charge_current", this.entity("number", "default_charge_current"), "A"))}
          ${this.row("Domyślny prąd ładowania z sieci", this.defaultProfileInput("grid_charge_current", this.entity("number", "default_grid_charge_current"), "A"))}
          <div class="hint">Stan powrotu: ${this.escapeHtml(this.state(this.entity("select", "default_work_mode")))} · ${this.escapeHtml(this.state(this.entity("number", "default_sell_power")))} W · rozładowanie ${this.escapeHtml(this.state(this.entity("number", "default_discharge_current")))} A · ładowanie ${this.escapeHtml(this.state(this.entity("number", "default_charge_current")))} A · sieć ${this.escapeHtml(this.state(this.entity("number", "default_grid_charge_current")))} A</div>
          <button class="wide-action" data-save-default-settings="1">Zapisz ustawienia domyślne</button>
          <button class="wide-action" data-action="apply-defaults" data-default-action="1" data-default-label="Zastosuj ustawienia domyślne teraz" ${this._defaultsApplying ? "disabled" : ""}>${this._defaultsApplying ? "Stosowanie ustawień domyślnych…" : "Zastosuj ustawienia domyślne teraz"}</button>
          <h3>Ustawienia ładowania</h3>
          <div class="hint">To szablon kopiowany do slotu w chwili wybrania trybu <strong>Charge</strong>. Późniejsze ręczne zmiany w tym slocie mają pierwszeństwo i nie są nadpisywane kolejnym zapisem szablonu.</div>
          ${this.row("Tryb ładowania", "Charge")}
          ${this.row("Ładowanie z sieci", this.rawSelect("charge-profile-grid", [["on", "TAK"], ["off", "NIE"]], this.chargeProfileGridEnabled() ? "on" : "off"))}
          ${this.row("Prąd ładowania", this.chargeProfileInput("charge_current", this.entity("number", "charge_profile_charge_current"), "A"))}
          ${this.row("Prąd rozładowania", this.chargeProfileInput("discharge_current", this.entity("number", "charge_profile_discharge_current"), "A"))}
          ${this.row("Prąd ładowania z sieci", this.chargeProfileInput("grid_charge_current", this.entity("number", "charge_profile_grid_charge_current"), "A"))}
          ${this.row("Docelowy SOC", this.chargeProfileInput("target_soc", this.entity("number", "charge_profile_target_soc"), "%"))}
          <div class="hint">Ładowanie z sieci: NIE — bateria może ładować się z PV. Ładowanie z sieci: TAK — jest dozwolone wyłącznie w zakresach Charge.</div>
          <button class="wide-action" data-save-charge-profile="1">Zapisz ustawienia ładowania</button>
          <h3>Ustawienia normalnej pracy</h3>
          <div class="hint">Ten szablon jest kopiowany do slotu tylko w chwili wybrania trybu <strong>Normalna Praca</strong>. Późniejsze ręczne zmiany w danym slocie mają pierwszeństwo i nie są automatycznie nadpisywane zmianami szablonu.</div>
          ${this.row("Tryb normalnej pracy", this.rawSelect("normal-profile-mode", [["", "-- wybierz --"], ["Zero Export To Load", "Zero Export To Load"], ["Zero Export To CT", "Zero Export To CT"]], this.normalProfileMode()))}
          ${this.row("Maksymalna moc sprzedaży", this.normalProfileInput("sell_power", this.entity("number", "normal_profile_sell_power"), "W"))}
          ${this.row("Maksymalny prąd rozładowania", this.normalProfileInput("discharge_current", this.entity("number", "normal_profile_discharge_current"), "A"))}
          ${this.row("Maksymalny prąd ładowania baterii", this.normalProfileInput("charge_current", this.entity("number", "normal_profile_charge_current"), "A"))}
          ${this.row("Maksymalny prąd ładowania z sieci", this.normalProfileInput("grid_charge_current", this.entity("number", "normal_profile_grid_charge_current"), "A"))}
          ${this.row("SOC baterii Deye (TOU)", this.normalProfileInput("tou_soc", this.entity("number", "normal_profile_tou_soc"), "%"))}
          <div class="hint">Fizyczny SOC zapisywany do Deye Time Of Use dla slotów Normalnej Pracy. Nie jest to minimalny SOC sprzedaży.</div>
          <button class="wide-action" data-save-normal-profile="1">Zapisz ustawienia normalnej pracy</button>
          <div class="hint defaults-status ${this._defaultsStatus}" data-defaults-status ${this._defaultsMessage ? "" : "hidden"}>${this.escapeHtml(this._defaultsMessage)}</div>`;
      } else if (tab === "tou") {
        body = `<div class="hint">Sześć fizycznych slotów Deye. Możesz je edytować bezpośrednio; kolejne zastosowanie Harmonogramu sprzedaży może ponownie zapisać te zakresy zgodnie z mapowaniem 24 h.</div>
          <table class="settings-table"><thead><tr><th>Slot</th><th>Od</th><th>Do</th><th>SOC baterii Deye (TOU)</th><th>Ładowanie z sieci</th><th>Akcja</th></tr></thead><tbody>${touRows}</tbody></table>`;
      } else if (tab === "mapping") {
        body = `<div class="hint">${this.mapWarning(slots)}. Harmonogram 24h jest kompresowany do zakresów zgodnych z 6 slotami Deye.</div>
          <table class="settings-table"><thead><tr><th>Slot Deye</th><th>Od</th><th>Do</th><th>Funkcja</th><th>Ładowanie z sieci</th><th>SOC</th></tr></thead><tbody>${segmentRows}</tbody></table>`;
      } else if (tab === "ai") {
        body = `
          <div class="hint">Inteligentny optymalizator 0.7.6 analizuje dane i pokazuje sugestie. Harmonogram zmienia dopiero po ręcznym wyborze godzin i potwierdzeniu.</div>
          ${this.aiCheck("enabled", "Włącz inteligentne planowanie", aiSettings.enabled)}
          ${this.row("Tryb działania", "Sugestie z ręcznym zatwierdzeniem")}
          ${this.aiSelect("strategy", "Priorytet", [["balanced", "Zrównoważony"], ["profit", "Maksymalny zysk"], ["autoconsumption", "Maksymalna autokonsumpcja"]], aiSettings.strategy)}
          ${this.aiCheck("forecastEnabled", "Uwzględniaj prognozę Solcast", aiSettings.forecastEnabled)}
          ${this.aiNumber("forecastMargin", "Margines bezpieczeństwa prognozy", aiSettings.forecastMargin, "%")}
          ${this.aiCheck("realPv", "Porównuj z realną produkcją PV", aiSettings.realPv)}
          ${this.aiCheck("history", "Uwzględniaj historię produkcji i sprzedaży", aiSettings.history)}
          ${this.aiCheck("prices", "Uwzględniaj ceny energii", aiSettings.prices)}
          ${this.aiNumber("minSellPrice", "Minimalna cena sprzedaży", aiSettings.minSellPrice, "PLN")}
          ${this.aiNumber("maxBuyPrice", "Maksymalna cena zakupu", aiSettings.maxBuyPrice, "PLN")}
          ${this.aiNumber("minSoc", "Minimalny SOC", aiSettings.minSoc, "%")}
          ${this.aiNumber("targetSoc", "Docelowy SOC magazynu", aiSettings.targetSoc, "%")}
          ${this.aiNumber("batteryCapacityKwh", "Pojemność użytkowa magazynu", aiSettings.batteryCapacityKwh, "kWh")}
          ${this.aiNumber("batteryEfficiency", "Sprawność magazynu", aiSettings.batteryEfficiency, "%")}
          ${this.aiNumber("reserveKwh", "Rezerwa energii w magazynie", aiSettings.reserveKwh, "kWh")}
          ${this.aiNumber("maxSellPower", "Maksymalna moc sprzedaży", aiSettings.maxSellPower, "W")}
          ${this.aiNumber("gridExportLimit", "Limit oddawania do sieci", aiSettings.gridExportLimit, "W")}
          ${this.aiNumber("maxDischargeCurrent", "Limit prądu rozładowania", aiSettings.maxDischargeCurrent, "A")}
          ${this.aiNumber("maxChargeCurrent", "Limit prądu ładowania", aiSettings.maxChargeCurrent, "A")}
          ${this.aiNumber("maxGridChargeCurrent", "Limit prądu ładowania z sieci", aiSettings.maxGridChargeCurrent, "A")}
          ${this.aiCheck("allowGridCharge", "AI może sugerować ładowanie z sieci", aiSettings.allowGridCharge)}
           ${this.aiCheck("allowBatterySell", "AI może sugerować sprzedaż z baterii", aiSettings.allowBatterySell)}
           ${this.aiCheck("allowDeyeMode", "AI może sugerować zmianę trybu Deye", aiSettings.allowDeyeMode)}`;
      } else if (tab === "tariff") {
        body = this.renderTariffTab();
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
              ${tabButton("defaults", "Ustawienia Trybów")}
              ${tabButton("tou", "Deye Time Of Use")}
              ${tabButton("mapping", "Mapowanie 24h")}
              ${tabButton("ai", "AI i analiza")}
              ${tabButton("tariff", "Taryfa i dystrybucja")}
              ${tabButton("history", "Historia i dane")}
              ${tabButton("system", "System i diagnostyka")}
            </nav>
            <div class="settings-content">${body}</div>
          </div>
        </section>
      </div>`;
    }

    if (this._dialog.type === "ai") {
      return this.renderAiDialog(slots);
      const ai = this.aiSuggestions(slots);
      const proposal = this.aiProposal(slots);
      if (!(this._aiProposalSelection instanceof Set)) {
        this._aiProposalSelection = new Set(proposal.rows.filter((row) => row.enabled).map((row) => row.key));
      }
      const sellRows = ai.bestSell.length ? ai.bestSell.map(([hour, price]) => `<li>${this.hourLabel(hour)}: ${this.formatPrice(price)} PLN/kWh</li>`).join("") : "<li>Brak danych cen sprzedaży</li>";
      const buyRows = ai.cheapBuy48?.length ? ai.cheapBuy48.map((row) => `<li>${row.day}, ${this.hourLabel(row.hour)}: ${this.formatPrice(row.price)} PLN/kWh</li>`).join("") : "<li>Brak danych cen zakupu dziś i jutro</li>";
      const strategyLabel = { balanced: "Zrównoważony", profit: "Maksymalny zysk", autoconsumption: "Maksymalna autokonsumpcja" }[ai.settings.strategy] || ai.settings.strategy;
      const correction = ai.forecastCorrection ? `×${ai.forecastCorrection.toFixed(2)} (${ai.learning?.solcast_accuracy_days || 0} dni)` : "brak danych";
      const historicalAccuracy = this.asNumber(ai.learning?.solcast_accuracy_avg);
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
        ? "Brak godzin spełniających ustawione progi cenowe."
        : proposal.segmentCount > 6 ? `Propozycja wymaga ${proposal.segmentCount} zakresów, limit Deye wynosi 6.` : `Gotowe: ${proposal.segmentCount}/6 zakresów Deye.`;
      return `<div class="overlay" data-close-dialog="1">
        <section class="dialog ai-dialog" data-dialog-box="1">
          <div class="dialog-head"><strong>Sugestie AI</strong><button type="button" data-close-dialog="1">${this.iconSvg("close")}</button></div>
          <div class="dialog-body ai-grid">
            <div class="ai-card"><h3>Najlepsze godziny sprzedaży</h3><ul>${sellRows}</ul></div>
            <div class="ai-card"><h3>Najtańsze godziny zakupu</h3><ul>${buyRows}</ul></div>
            <div class="ai-card"><h3>Solcast, PV i magazyn</h3><p>Dzisiaj: ${this.formatEnergy(ai.solcastToday)}<br>Pozostało: ${this.formatEnergy(ai.solcastRemaining)}<br>Realna produkcja: ${this.formatEnergy(ai.dailyPv)}<br>Trafność historyczna: ${historicalAccuracy === null ? "brak danych" : `${historicalAccuracy.toFixed(1)}%`}<br>Korekta historyczna: ${correction}<br>Współczynnik ryzyka pogody: ×${this.formatNumber(ai.weatherRiskFactor, 2)}<br>Prognozowana nadwyżka PV: ${this.formatEnergy(ai.estimatedSurplus)}<br>Pojemność magazynu: ${this.formatEnergy(ai.batteryCapacityKwh)}<br>Energia w magazynie: ${this.formatEnergy(ai.storedEnergyKwh)}<br>Dostępne do sprzedaży: ${this.formatEnergy(ai.sellableEnergyKwh)}<br>Brakujące do celu: ${this.formatEnergy(ai.chargeNeedKwh)}</p></div>
            <div class="ai-card"><h3>Profil energetyczny</h3><p>Dane: ${ai.learningReady ? "gotowe" : "trwa uczenie"}<br>Zapisane dni: ${ai.learning?.recorded_days || 0}<br>Zapisane godziny: ${ai.learning?.recorded_hours || 0}<br>Typowe zużycie domu: ${this.formatEnergy(ai.learning?.typical_daily_load_kwh)}<br>Pozostałe zużycie dzisiaj: ${this.formatEnergy(ai.expectedRemainingLoad)}<br>Typowy SOC następnej godziny: ${ai.predictedSoc === null ? "brak" : `${ai.predictedSoc.toFixed(1)}%`}<br>Kierunek SOC: ${ai.predictedSocTrend}</p></div>
            <div class="ai-card"><h3>Harmonogram</h3><p>Priorytet: ${strategyLabel}<br>Aktywne godziny: ${ai.activeConfigured}<br>Limit mocy: ${ai.settings.maxSellPower} W<br>Min. SOC: ${ai.settings.minSoc}%<br>${this.mapWarning(slots)}</p></div>
            <div class="ai-card ai-proposal"><h3>Proponowany harmonogram 24h</h3><p>${proposalStatus}</p><div class="proposal-tools"><button data-ai-select-proposed="1">Zaznacz proponowane</button><button data-ai-clear-proposal="1">Odznacz wszystko</button><span>Wybrano: ${selectedProposalCount}</span></div><div class="ai-proposal-scroll"><table class="mini-table"><thead><tr><th></th><th>Godzina</th><th>Tryb</th><th>Moc</th><th>Rozł.</th><th>Ład.</th><th>SOC min.</th><th>Energia</th><th>SOC po</th><th>Bilans</th><th>Pewność</th></tr></thead><tbody>${proposalRows}</tbody></table></div><button class="wide-action" data-apply-ai-proposal="1" ${!proposalReady || !selectedProposalCount ? "disabled" : ""}>Zastosuj wybrane (${selectedProposalCount})</button></div>
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
            <label class="apply-row"><input type="checkbox" data-apply-field="sellPower" checked> Moc sprzedaży ${this.rawNumber("multi-sell-power", bulk.sellPower, "W")}</label>
            <label class="apply-row"><input type="checkbox" data-apply-field="dischargeCurrent" checked> Prąd rozładowania ${this.rawNumber("multi-discharge-current", bulk.dischargeCurrent, "A")}</label>
            <label class="apply-row"><input type="checkbox" data-apply-field="chargeCurrent" checked> Prąd ładowania ${this.rawNumber("multi-charge-current", bulk.chargeCurrent, "A")}</label>
            <label class="apply-row"><input type="checkbox" data-apply-field="minSoc" checked> Minimalny SOC sprzedaży ${this.rawNumber("multi-min-soc", bulk.minimumSellSoc, "%")}</label>
            <label class="apply-row"><input type="checkbox" data-apply-field="minSellPrice" checked> Sprzedawaj od ceny ${this.rawNumber("multi-min-sell-price", bulk.minSellPrice, "PLN")}</label>
            <div class="preview-box"><strong>Podgląd zmian</strong><br>Wartości startowe są pobrane z pierwszej zaznaczonej godziny. Odznacz pole, którego nie chcesz zmieniać.</div>
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
          <div class="dialog-head"><strong>Deye Time Of Use - slot ${idx}</strong><button type="button" data-close-dialog="1">${this.iconSvg("close")}</button></div>
          <div class="dialog-body">
            ${this.row("Od", this.timeInput(tou.start))}
            ${this.row(`Do / start slotu ${endIdx}`, this.timeInput(tou.end))}
            ${this.row("SOC baterii Deye (TOU)", this.numberInput(tou.soc, "%"))}
            ${this.row("Ładowanie z sieci", this.pill(tou.grid))}
            <div class="hint">Edycja bezpośrednia zmienia fizyczny zakres Deye. Zastosowanie mapowania 24 h może później nadpisać go wartościami harmonogramu.</div>
          </div>
          <div class="dialog-actions"><button type="button" data-close-dialog="1">Zamknij</button></div>
        </section>
      </div>`;
    }

    const slot = slots.find(([key]) => key === this._dialog.key);
    if (!slot) return "";
    const [key, label] = slot;
    const entities = this.slotEntities(key, label);
    const mode = this.state(entities.mode, "Normalna Praca");
    const isCharge = mode === "Charge";
    const isSelling = mode === "Selling First";
    const isNormal = mode === "Normalna Praca" || this.norm(mode).includes("normal");
    const physicalSocLabel = isCharge ? "Docelowy SOC" : "SOC baterii Deye (TOU)";
    const gridControl = isCharge
      ? this.pill(entities.chargeEnabled)
      : `${this.pill(null, "NIE")}<small> dostępne tylko dla Charge</small>`;

    let physicalModeLabel = "";
    if (isNormal) {
      const storedMode = this.state(entities.physicalWorkMode, "");
      physicalModeLabel = storedMode ? `Fizyczny tryb Deye: ${storedMode}` : "";
    }

    const socField = isSelling
      ? this.row("Minimalny SOC sprzedaży", this.numberInput(entities.minimumSellSoc, "%"))
      : this.row(physicalSocLabel, this.touSocInput(entities.touSoc));
    const slotFields = `
          ${isCharge ? '<div class="hint">Wartości początkowe skopiowano z Ustawień ładowania przy wyborze Charge. Późniejsze ręczne zmiany dotyczą wyłącznie tej godziny.</div>' : ""}
          ${isNormal ? '<div class="hint">Ten slot otrzymał początkowe wartości z szablonu Normalnej Pracy. Zmiany wykonane tutaj dotyczą tylko tej godziny.<br>' + physicalModeLabel + '</div>' : ""}
          ${isNormal ? `<button class="primary" data-reload-normal-profile="${key}" style="margin-bottom:8px">Wczytaj ponownie ustawienia normalnej pracy</button>` : ""}
          ${this.row("Moc sprzedaży", this.numberInput(entities.sellPower, "W"))}
          ${this.row("Prąd rozładowania", this.numberInput(entities.dischargeCurrent, "A"))}
          ${this.row("Prąd ładowania baterii", this.numberInput(entities.chargeCurrent, "A"))}
          ${this.row("Ładowanie z sieci", gridControl)}
          ${this.row("Prąd ładowania z sieci", this.numberInput(entities.gridChargeCurrent, "A"))}
          ${socField}
          ${this.row("Sprzedawaj od ceny", this.numberInput(entities.minSellPrice, "PLN"))}`;
    return `<div class="overlay" data-close-dialog="1">
      <section class="dialog" data-dialog-box="1">
        <div class="dialog-head"><strong>Godzina ${label}</strong><button type="button" data-close-dialog="1">${this.iconSvg("close")}</button></div>
        <div class="dialog-body">
          ${this.row("Aktywne", this.pill(entities.sellEnabled))}
          ${this.row("Tryb", this.selectInput(entities.mode, this.slotWorkModes()))}
          ${slotFields}
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
    const solcastAccuracyAttrs = this._hass?.states?.[solcastAccuracy]?.attributes || {};
    const forecastProgressValue = this.asNumber(solcastAccuracyAttrs.forecast_progress_percent);

    const touStarts = [1, 2, 3, 4, 5, 6].map((idx) => {
      const raw = this.state(`time.deye_inverter_time_of_use_${idx}_start`, "00:00:00");
      return raw.length >= 5 ? raw.slice(0, 5) : raw;
    });

    const selectedCount = this.selectedSlotList(slots).length;
    const bulk = this.bulkValues(slots);
    const scheduleRows = slots.map(([key, label]) => {
      const entities = this.slotEntities(key, label);
      const enabled = this.displayState(entities.sellEnabled) === "on";
      const mode = this.state(entities.mode, "Normalna Praca");
      const gridChargeState = this.displayState(entities.chargeEnabled, "");
      const gridCharge = gridChargeState === "on";
      const isChargeMode = mode === "Charge";
      const gridChargeLabel = isChargeMode ? (gridCharge ? "tak" : "nie") : "nie dotyczy";
      const gridChargeClass = isChargeMode ? (gridCharge ? "on" : "off") : "missing";
      const chargeCurrent = this.numberState(entities.chargeCurrent);
      const gridChargeCurrent = this.numberState(entities.gridChargeCurrent);
      const touSoc = mode === "Selling First" ? this.numberState(entities.minimumSellSoc) : this.numberState(entities.touSoc, "wymaga potwierdzenia");
      const selected = this._selectedSlots?.has(key);
      const meta = this.modeMeta(mode, enabled);
      const rowClass = [
        activeSlot === key ? "active" : "",
        selected ? "selected" : "",
        enabled ? "enabled" : "disabled",
      ].filter(Boolean).join(" ");
      return `<tr class="${rowClass}" data-slot-row="${key}">
        <td class="check-col" data-label=""><label class="slot-check"><input type="checkbox" data-slot-check="${key}" ${selected ? "checked" : ""}><span></span></label></td>
        <td data-label="Godzina" class="time-col">${label.replace(/:00/g, "")}</td>
        <td data-label="Tryb">${this.modePill(mode, enabled)}</td>
        <td data-label="Moc sprzedaży" class="metric sell">${enabled ? `${this.iconSvg("sell")} ${this.numberState(entities.sellPower)} W` : "-"}</td>
        <td data-label="Prąd rozładowania" class="metric discharge">${enabled ? `↓ ${this.numberState(entities.dischargeCurrent)} A` : "-"}</td>
        <td data-label="Prąd ładowania" class="metric charge">${enabled ? `↑ ${chargeCurrent} A` : "-"}</td>
        <td data-label="Ładowanie z sieci" class="metric grid">${enabled ? `<span class="pill ${gridChargeClass}">${gridChargeLabel}</span>` : "-"}</td>
        <td data-label="Prąd ładowania z sieci" class="metric grid-current">${enabled ? `⚡ ${gridChargeCurrent} A` : "-"}</td>
        <td data-label="SOC" class="metric soc">${enabled ? `◇ ${touSoc}%` : "-"}</td>
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
      <label class="apply-row"><input type="checkbox" data-apply-field="sellPower" checked><span>Moc sprzedaży</span>${this.rawNumber("multi-sell-power", bulk.sellPower, "W")}</label>
      <label class="apply-row"><input type="checkbox" data-apply-field="dischargeCurrent" checked><span>Prąd rozładowania</span>${this.rawNumber("multi-discharge-current", bulk.dischargeCurrent, "A")}</label>
      <label class="apply-row"><input type="checkbox" data-apply-field="chargeCurrent" checked><span>Prąd ładowania</span>${this.rawNumber("multi-charge-current", bulk.chargeCurrent, "A")}</label>
      <label class="apply-row"><input type="checkbox" data-apply-field="minSoc" checked><span>Minimalny SOC sprzedaży</span>${this.rawNumber("multi-min-soc", bulk.minimumSellSoc, "%")}</label>
      <label class="apply-row"><input type="checkbox" data-apply-field="minSellPrice" checked><span>Sprzedawaj od ceny</span>${this.rawNumber("multi-min-sell-price", bulk.minSellPrice, "PLN")}</label>
      <div class="preview-box"><strong>Podgląd zmian</strong><br>Wybrane pola zostaną wpisane tylko do zaznaczonych godzin. Pola bez znacznika zostają bez zmian.</div>
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
        <td data-label="SOC Deye">${this.numberState(tou.soc)} %</td>
        <td data-label="Ładowanie z sieci">${this.displayState(tou.grid, "brak") === "on" ? "tak" : this.displayState(tou.grid, "brak") === "off" ? "nie" : "brak"}</td>
      </tr>`;
    }).join("");

    this.innerHTML = `
      <ha-card class="theme-schedule-dark">
        <style>
          ha-card{--bg:#020b12;--panel:rgba(9,24,35,.92);--panel2:rgba(13,31,45,.88);--panel3:rgba(16,38,54,.72);--line:rgba(118,166,190,.22);--line2:rgba(80,169,226,.38);--text:#eef7ff;--muted:#9eb8c8;--blue:#159bff;--blue2:#0a6ad8;--green:#7ee22d;--green2:#35d66f;--purple:#bc63ff;--gold:#f6a619;--red:#ff4242;overflow:hidden;background:radial-gradient(circle at 18% 0%,rgba(26,106,164,.22),transparent 34%),linear-gradient(180deg,#020913,#06131c 54%,#050b10);color:var(--text);border:1px solid rgba(101,142,164,.32);box-shadow:0 18px 45px rgba(0,0,0,.35)}
          .dem-v073{padding:18px;display:grid;gap:16px;font-family:Roboto,Arial,sans-serif;font-size:14px}
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
          .solcast-chart{height:170px;overflow-x:auto;border-top:1px solid var(--line);padding:10px 8px 0;overscroll-behavior:contain}.solcast-bars{height:146px;min-width:520px;display:grid;grid-template-columns:repeat(24,1fr);gap:4px;align-items:end}.solcast-bar{height:146px;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px}.solcast-columns{height:128px;width:100%;display:flex;align-items:end;justify-content:center;gap:2px}.solcast-columns span{display:block;width:42%;border-radius:4px 4px 0 0;min-height:3px}.solcast-columns .today{background:#2dff95}.solcast-columns .tomorrow{background:#57b9ff}.solcast-bar.now .solcast-columns span{box-shadow:0 0 0 1px #ffd166 inset}.solcast-bar em{font-style:normal;font-size:10px;color:#89a5b5;writing-mode:vertical-rl;transform:rotate(180deg)}.solcast-legend{display:flex;gap:7px;padding:4px 10px 8px;color:#a9c1d0;font-size:12px}.solcast-legend span{width:10px;height:10px;border-radius:999px;display:inline-block}.solcast-legend .today{background:#2dff95}.solcast-legend .tomorrow{background:#57b9ff}.solcast-performance{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:auto;padding:9px;border-top:1px solid var(--line)}.solcast-performance .stat{padding:8px}.solcast-performance .stat strong{font-size:14px}.live-changed{animation:dem-live-pulse .45s ease-out}@keyframes dem-live-pulse{0%{color:#fff;text-shadow:0 0 10px rgba(87,185,255,.9)}100%{color:inherit;text-shadow:none}}
          .defaults-status{margin-top:10px}.defaults-status.saving{color:#ffd166}.defaults-status.saved{color:var(--green)}.defaults-status.error{color:#ff8b98}button[data-default-action]:disabled{opacity:.55;cursor:wait}
          .schedule-shell{padding:10px;background:radial-gradient(circle at 12% 8%,rgba(20,85,130,.22),transparent 30%),linear-gradient(180deg,rgba(5,16,26,.98),rgba(7,21,32,.98))}
          .schedule-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:8px}.schedule-title h2{margin:0;display:flex;align-items:center;gap:8px;font-size:22px;font-weight:850}.schedule-title p{margin:3px 0 0;color:#c1d4df;font-size:13px}.title-icon{width:28px;height:28px;border-radius:999px;border:1px solid rgba(142,181,202,.42);background:rgba(255,255,255,.03);color:#d9ecf6;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}.title-icon.ai{color:#2fa8ff}.title-icon:hover{border-color:var(--blue);color:#fff}.save-indicator{display:none;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:800;line-height:1.2}.save-indicator.saving{display:inline-flex;color:#ffd166;background:rgba(246,166,25,.16)}.save-indicator.saved{display:inline-flex;color:var(--green);background:rgba(53,214,111,.14)}.save-indicator.error{display:inline-flex;max-width:360px;color:#ff8b98;background:rgba(255,77,99,.15);white-space:normal}
          .schedule-tools{display:flex;gap:9px;align-items:center;flex-wrap:wrap;justify-content:flex-end}.tool-btn,.gear-btn,.bulk-actions button,.set-btn,.icon-only{border:1px solid rgba(100,145,170,.42);border-radius:8px;background:rgba(7,17,27,.72);color:#eaf7ff;min-height:38px;padding:0 13px;display:inline-flex;align-items:center;gap:9px;cursor:pointer}.tool-btn.active{border-color:var(--blue);color:#2ea7ff;background:rgba(8,53,92,.55)}.gear-btn{width:48px;justify-content:center;padding:0}.gear-btn:hover,.tool-btn:hover,.set-btn:hover,.icon-only:hover{border-color:var(--blue);box-shadow:0 0 0 1px rgba(21,155,255,.25) inset}.icon-only{width:32px;min-height:28px;padding:0;justify-content:center}.set-btn{min-height:29px;padding:0 12px;font-weight:800}
          .mode-legend{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:4px 0 8px}.mode-tile{display:flex;align-items:center;gap:8px;min-width:0}.mode-icon{width:32px;height:32px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}.mode-tile.selling .mode-icon{background:rgba(126,226,45,.16);color:var(--green)}.mode-tile.zero .mode-icon{background:rgba(21,155,255,.16);color:var(--blue)}.mode-tile.ct .mode-icon{background:rgba(188,99,255,.18);color:var(--purple)}.mode-tile.charge .mode-icon{background:rgba(246,166,25,.18);color:var(--gold)}.mode-tile.disabled .mode-icon{background:rgba(155,178,193,.12);color:#b9c9d4}.mode-tile strong{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mode-tile.selling strong{color:var(--green)}.mode-tile.zero strong{color:var(--blue)}.mode-tile.ct strong{color:var(--purple)}.mode-tile.charge strong{color:var(--gold)}.mode-tile span{display:block;color:#c2d4de;margin-top:1px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
          .schedule-main{display:grid;grid-template-columns:minmax(0,1fr);gap:10px}.schedule-main.selecting{grid-template-columns:minmax(0,1fr) 340px}.schedule-left{min-width:0}.schedule-table-card{border:1px solid rgba(107,157,182,.28);border-radius:8px;overflow:hidden;background:rgba(6,19,29,.62)}.schedule-table{width:100%;border-collapse:collapse;table-layout:auto}.schedule-table th,.schedule-table td{padding:1px 4px;border-top:1px solid var(--line);text-align:left;vertical-align:middle}.schedule-table th{background:rgba(19,41,56,.86);color:#d9ecf6;font-size:10px;font-weight:800}.schedule-table td{font-size:11px}.schedule-table tr{height:24px}.schedule-table tr.active{background:rgba(37,105,151,.32)}.schedule-table tr.selected{background:rgba(0,122,255,.14);box-shadow:inset 0 0 0 1px var(--blue)}.check-col{width:30px}.time-col{width:56px;min-width:56px;max-width:56px;text-align:left;white-space:nowrap}.schedule-table .metric,.schedule-table .mode-pill{white-space:nowrap}.schedule-table col.col-check{width:30px}.schedule-table col.col-time{width:58px}.schedule-table col.col-mode{width:118px}.schedule-table col.col-power{width:76px}.schedule-table col.col-current{width:78px}.schedule-table col.col-grid{width:54px}.schedule-table col.col-grid-current{width:72px}.schedule-table col.col-soc{width:56px}.schedule-table col.col-price{width:70px}.schedule-table col.col-active{width:56px}.schedule-table col.col-action{width:42px}.slot-check{display:inline-flex;align-items:center;justify-content:center}.slot-check input{display:none}.slot-check span{width:18px;height:18px;border:1px solid rgba(159,190,207,.55);border-radius:5px;background:rgba(255,255,255,.02)}.slot-check input:checked+span{background:var(--blue);border-color:var(--blue);box-shadow:inset 0 0 0 3px rgba(0,0,0,.18)}.slot-check input:checked+span::after{content:"";display:block;width:8px;height:5px;border-left:2px solid #00131f;border-bottom:2px solid #00131f;transform:rotate(-45deg);margin:5px 0 0 5px}
          .mode-pill{display:inline-flex;align-items:center;border-radius:6px;padding:3px 7px;font-weight:800;background:#223241;color:#d7e7ef;white-space:nowrap}.mode-pill.selling{background:rgba(72,154,38,.24);color:var(--green)}.mode-pill.zero{background:rgba(21,155,255,.18);color:#55baff}.mode-pill.ct{background:rgba(188,99,255,.18);color:#ce8cff}.mode-pill.charge{background:rgba(246,166,25,.18);color:#ffc65a}.mode-pill.disabled{background:rgba(142,160,172,.16);color:#d6e1e8}
          .metric{white-space:nowrap}.metric svg{width:16px;height:16px;vertical-align:-3px}.metric.sell{color:#8cef3b}.metric.discharge{color:#ff4848}.metric.charge{color:#20a9ff}.metric.grid,.metric.grid-current{color:#ffc65a}.metric.soc{color:#d279ff}.metric.price-limit{color:#2dff95}
          .pill{border:0;border-radius:999px;min-width:42px;padding:3px 9px;font-weight:900;cursor:pointer;background:#233849;color:#d9edf5}.pill.on{background:linear-gradient(90deg,#0a68d7,#159bff);color:#fff}.pill.off{background:#263e51;color:#d9edf5}.pill.missing{opacity:.62}
          .schedule-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;border-top:1px solid var(--line);padding:7px 12px}.schedule-foot strong{color:#2ea7ff}.foot-actions{display:flex;gap:9px;flex-wrap:wrap}.foot-actions button{border:1px solid rgba(100,145,170,.42);border-radius:8px;background:rgba(7,17,27,.72);color:#eaf7ff;min-height:32px;padding:0 12px;display:inline-flex;align-items:center;gap:8px;cursor:pointer}.foot-actions .primary{background:linear-gradient(180deg,#0b7eee,#075bc0);border-color:#159bff}
          .bulk-panel{border:1px solid rgba(107,157,182,.28);border-radius:8px;background:linear-gradient(180deg,rgba(10,29,45,.95),rgba(7,21,33,.96));padding:20px}.bulk-panel h3{margin:0 0 16px;font-size:20px}.range-box{border:1px solid rgba(21,155,255,.35);border-radius:8px;background:rgba(0,81,145,.18);padding:14px;margin-bottom:16px;color:#2ea7ff}.range-box span,.range-box small{display:block;margin-top:5px}.apply-row{display:grid;grid-template-columns:24px 1fr 1.25fr;gap:10px;align-items:center;padding:10px 0;border-top:1px solid var(--line)}.apply-row input[type="checkbox"]{width:20px;height:20px;accent-color:var(--blue)}.preview-box{margin-top:12px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.03);padding:12px;color:#cbdce5}.bulk-actions{display:flex;justify-content:space-between;gap:10px;margin-top:16px}.bulk-actions .primary{background:linear-gradient(180deg,#72d13b,#41a91d);border-color:#75e247;color:#041007}
          input,select{width:100%;min-width:0;box-sizing:border-box;background:rgba(8,22,34,.95);color:#f6fbff;border:1px solid rgba(107,157,182,.34);border-radius:7px;padding:8px}option,select option{background:#fff!important;color:#111!important}.field{position:relative;display:block}.field input{padding-right:42px}.field span{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-weight:800;color:#d8ecf7}.row{min-height:38px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 12px;border-top:1px solid var(--line)}.row strong{text-align:right}.settings-row{min-height:40px;display:grid;grid-template-columns:1fr 260px;gap:12px;align-items:center;padding:9px 12px;border-top:1px solid var(--line)}.settings-row>input[type="checkbox"]{justify-self:end;width:20px;height:20px;accent-color:var(--blue)}.settings-row select,.settings-row .compact-field{max-width:260px;justify-self:end}.hint{padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.03);color:#c7d9e2;margin-bottom:12px}.wide-action{width:100%;min-height:38px;border:1px solid rgba(100,145,170,.45);border-radius:8px;background:#173a57;color:#fff;font-weight:800;cursor:pointer}.wide-action:disabled{opacity:.45;cursor:not-allowed}.settings-table{width:100%;border-collapse:collapse}.settings-table th,.settings-table td{padding:8px;border-top:1px solid var(--line);text-align:left}.settings-tabs{display:flex;gap:8px;padding:10px;border-bottom:1px solid var(--line);overflow-x:auto}.settings-tabs button{border:1px solid var(--line2);border-radius:7px;background:rgba(255,255,255,.03);color:#dfeef6;padding:8px 10px;white-space:nowrap}.settings-tabs button.active{border-color:var(--blue);color:#fff;background:rgba(21,155,255,.22)}.overlay{position:fixed;inset:0;background:rgba(0,0,0,.68);display:flex;align-items:center;justify-content:center;z-index:20;padding:16px}.dialog{width:min(760px,100%);max-height:92vh;overflow:auto;border:1px solid rgba(107,157,182,.45);border-radius:12px;background:radial-gradient(circle at 16% 0%,rgba(22,91,139,.2),transparent 36%),linear-gradient(180deg,#071b2a,#061420);box-shadow:0 25px 70px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.04)}.settings-dialog{width:min(880px,100%)}.dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;background:linear-gradient(180deg,rgba(14,50,70,.9),rgba(10,30,44,.86));border-bottom:1px solid rgba(107,157,182,.28)}.dialog-head strong{font-size:19px}.dialog-head button{border:0;background:transparent;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center}.dialog-head button svg{pointer-events:none}.dialog-body{padding:14px}.dialog-actions{display:flex;justify-content:flex-end;gap:10px;padding:0 14px 14px}.dialog-actions button{border:1px solid var(--line2);border-radius:8px;background:#173a57;color:#fff;min-height:38px;padding:0 16px}.ai-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ai-card{border:1px solid var(--line);border-radius:9px;background:rgba(255,255,255,.03);padding:12px}.ai-card h3{margin:0 0 8px;color:#7ee22d}.ai-proposal,.ai-history{grid-column:1/-1}.ai-proposal-scroll,.ai-history-scroll{overflow:auto;max-height:300px;margin-bottom:10px}.ai-proposal .mini-table,.ai-history .mini-table{min-width:620px}
           .history-toolbar{display:grid;grid-template-columns:repeat(3,minmax(130px,1fr)) repeat(3,auto);gap:8px;align-items:end;margin-bottom:12px}.history-toolbar label{display:grid;gap:4px;color:#a9c1d0;font-size:11px}.history-toolbar button,.danger-action{min-height:38px;border:1px solid var(--line2);border-radius:7px;background:#173a57;color:#fff;padding:0 12px;cursor:pointer}.history-section{border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.025);margin-bottom:12px;overflow:hidden}.history-section h3{margin:0;padding:10px 12px;color:var(--green);background:rgba(18,42,59,.74)}.history-scroll{max-height:270px;overflow:auto;overscroll-behavior:contain}.history-scroll .settings-table{min-width:780px}.history-scroll details summary{cursor:pointer;color:var(--blue)}.history-scroll pre{max-width:520px;max-height:220px;overflow:auto;white-space:pre-wrap;color:#cfe1ea}.history-rating{display:inline-flex;gap:3px;margin-top:4px}.history-rating button{width:25px;height:24px;border:1px solid var(--line2);border-radius:5px;background:rgba(255,255,255,.03);color:#b9ced9;cursor:pointer}.history-rating button.active{background:var(--green);color:#041007;border-color:var(--green)}.danger-action{background:rgba(138,24,42,.28);border-color:rgba(255,77,99,.55);color:#ff9cab}
           .analysis-history-scroll{overflow-x:hidden}.history-scroll .analysis-history-table{width:100%;min-width:0;table-layout:fixed}.analysis-history-table th,.analysis-history-table td{overflow-wrap:anywhere}.analysis-history-table th:nth-child(1){width:19%}.analysis-history-table th:nth-child(2){width:14%}.analysis-history-table th:nth-child(3){width:20%}.analysis-history-table th:nth-child(4){width:32%}.analysis-history-table th:nth-child(5){width:15%}.analysis-detail-row td{padding:0 10px 8px!important;background:rgba(3,14,23,.45)}.analysis-record{width:100%}.analysis-record summary{padding:8px 2px;font-weight:800;cursor:pointer;color:var(--blue)}.analysis-details{display:grid;gap:10px;padding:2px 0 10px}.analysis-detail-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.analysis-detail-grid>div,.analysis-price-groups section,.analysis-explanation{border:1px solid var(--line);border-radius:7px;background:rgba(255,255,255,.025);padding:9px}.analysis-detail-grid span,.analysis-explanation span{display:block;margin-bottom:4px;color:#9db7c6;font-size:10px}.analysis-detail-grid strong,.analysis-explanation strong{display:block;overflow-wrap:anywhere}.analysis-price-groups{display:grid;grid-template-columns:1fr 1fr;gap:8px}.analysis-price-groups h4{margin:0 0 6px;color:var(--green)}.analysis-price-groups ul{list-style:none;margin:0;padding:0}.analysis-price-groups li{display:flex;justify-content:space-between;gap:8px;padding:5px 0;border-top:1px solid var(--line)}
           .settings-dialog{width:min(1180px,96vw)!important;height:min(820px,92vh);max-height:92vh!important;overflow:hidden!important;display:grid;grid-template-rows:auto minmax(0,1fr)}.settings-layout{min-height:0;display:grid;grid-template-columns:220px minmax(0,1fr)}.settings-nav{padding:12px;border-right:1px solid var(--line);background:rgba(4,15,24,.58);display:flex;flex-direction:column;gap:7px;overflow-y:auto}.settings-nav button{width:100%;min-height:42px;border:1px solid var(--line2);border-radius:7px;background:rgba(255,255,255,.025);color:#dfeef6;padding:8px 10px;text-align:left;cursor:pointer}.settings-nav button.active{border-color:var(--blue);color:#fff;background:rgba(21,155,255,.22)}.settings-content{min-width:0;overflow:auto;overscroll-behavior:contain;padding:14px}.diagnostic-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-bottom:12px}.diagnostic-summary>div{border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.03);padding:11px}.diagnostic-summary span{display:block;color:#9db7c6;font-size:11px}.diagnostic-summary strong{display:block;margin-top:5px;overflow-wrap:anywhere}.diagnostic-section{border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-bottom:12px;background:rgba(255,255,255,.025)}.diagnostic-section h3{margin:0;padding:10px 12px;background:rgba(18,42,59,.78);color:#dff4ff}.diagnostic-entities{max-height:260px;overflow:auto}.diag-badge{display:inline-flex;border-radius:999px;padding:3px 9px;font-weight:800}.diag-badge.ok{color:var(--green);background:rgba(53,214,111,.12)}.diag-badge.error{color:#ff8b98;background:rgba(255,77,99,.13)}.diagnostic-actions{display:flex;flex-wrap:wrap;gap:8px;padding:12px}.diagnostic-actions button{min-height:38px;border:1px solid var(--line2);border-radius:7px;background:#173a57;color:#fff;padding:0 13px;cursor:pointer}.diagnostic-actions button.danger{background:rgba(138,24,42,.28);border-color:rgba(255,77,99,.55);color:#ff9cab}.diagnostic-actions button.resume{background:rgba(38,112,64,.55);border-color:rgba(103,229,100,.65)}.tou-diagnostics{padding:12px;display:flex;gap:10px;align-items:center;overflow-wrap:anywhere}.schedule-attempt{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;padding:12px}.schedule-attempt>div{border:1px solid var(--line);border-radius:7px;padding:9px;overflow-wrap:anywhere}.schedule-attempt .schedule-attempt-message{grid-column:span 3}.schedule-attempt span{display:block;font-size:11px;color:#9db7c6}.schedule-attempt strong{display:block;margin-top:4px}.schedule-attempt ul{margin:6px 0 0;padding:0;list-style:none}.schedule-attempt li{display:flex;justify-content:space-between;gap:8px;font-size:12px;padding:2px 0}.schedule-attempt.failed{background:rgba(145,28,48,.08)}
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
           .dialog-head{position:sticky;top:0;z-index:5;background:linear-gradient(180deg,rgba(14,50,70,.98),rgba(10,30,44,.98))}.dialog-actions{position:sticky;bottom:0;z-index:4;padding:12px 14px;background:rgba(6,20,32,.98);border-top:1px solid var(--line)}.ai-dialog{width:min(900px,96vw);height:min(900px,92vh);max-height:92vh;overflow:hidden;display:grid;grid-template-rows:auto minmax(0,1fr)}.ai-dialog>.dialog-body{overflow:auto;overscroll-behavior:contain}.ai-proposal-scroll,.ai-history-scroll{max-height:360px}
           .ai-dialog-v2{width:min(1260px,97vw)!important;height:min(920px,94vh)!important;grid-template-rows:auto minmax(0,1fr);background:radial-gradient(circle at 18% 5%,rgba(0,117,190,.14),transparent 38%),linear-gradient(150deg,#061a29,#03111d 72%)}.ai-shell{min-height:0;display:grid;grid-template-columns:230px minmax(0,1fr)}.ai-sidebar{min-height:0;border-right:1px solid rgba(96,151,178,.28);background:rgba(3,14,23,.54);display:flex;flex-direction:column;padding:14px 10px}.ai-sidebar nav{display:grid;gap:8px}.ai-sidebar nav button{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 12px;border:1px solid transparent;border-radius:7px;background:transparent;color:#cfe1eb;text-align:left;cursor:pointer}.ai-sidebar nav button span{width:20px;color:#45b8ff;font-size:18px;text-align:center}.ai-sidebar nav button:hover{background:rgba(21,155,255,.08)}.ai-sidebar nav button.active{border-color:#169cf5;background:rgba(21,155,255,.13);color:#fff}.ai-sidebar nav button.active:nth-child(2){border-color:#58bd21;background:rgba(77,180,37,.14)}.ai-sidebar nav button.active:nth-child(2) span{color:#7ee22d}.ai-learning-status{margin-top:auto;padding:13px 9px;border-top:1px solid var(--line);display:grid;gap:4px}.ai-learning-status span,.ai-learning-status small{color:#91adbc;font-size:11px}.ai-learning-status strong{color:#7ee22d;font-size:12px}.ai-main{min-width:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding:18px}.ai-main h3{margin:0 0 10px;color:#7ee22d;font-size:17px}.ai-overview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ai-metric-card,.ai-decision-grid>section,.ai-chart-card{border:1px solid rgba(103,158,184,.28);border-radius:8px;background:linear-gradient(180deg,rgba(14,38,54,.72),rgba(7,25,38,.75));padding:14px}.ai-overview-grid>.ai-chart-card{grid-column:1/-1}.ai-price-columns{display:grid;grid-template-columns:1fr 1fr;gap:12px}.ai-price-columns section{min-width:0;border:1px solid rgba(103,158,184,.18);border-radius:6px;overflow:hidden}.ai-price-columns h4{margin:0;padding:8px 10px;background:rgba(20,56,76,.55);color:#dff3fc}.ai-price-columns table{width:100%;border-collapse:collapse}.ai-price-columns td{padding:6px 10px;border-top:1px solid rgba(103,158,184,.16);font-size:12px}.ai-price-columns td:last-child{text-align:right;font-weight:800}.ai-empty{color:#90aab9;text-align:center;padding:12px}.ai-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.ai-kpis>div{border:1px solid rgba(103,158,184,.2);border-radius:6px;padding:9px;background:rgba(3,16,25,.45)}.ai-kpis span{display:block;color:#93adbc;font-size:10px}.ai-kpis strong{display:block;margin-top:4px;color:#f3fbff}.ai-proposal-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.ai-day-tabs,.ai-view-tools{display:flex;align-items:center;gap:7px}.ai-day-tabs button,.ai-view-tools button{min-height:36px;padding:0 14px;border:1px solid var(--line2);border-radius:6px;background:#122f45;color:#e2f1f8;cursor:pointer}.ai-day-tabs button.active{background:#4b9d25;border-color:#64ba32;color:#fff}.ai-view-tools button.select{background:#1b77b5;border-color:#37a9f3}.ai-view-tools button.neutral{background:#173043}.ai-view-tools button:disabled{opacity:.42;cursor:not-allowed}.ai-plan-table-wrap{overflow-x:auto;border:1px solid rgba(103,158,184,.28);border-radius:8px}.ai-plan-table{width:100%;min-width:940px;border-collapse:collapse}.ai-plan-table th{position:sticky;top:0;z-index:2;padding:9px 8px;background:#0b283a;color:#d9ecf5;font-size:11px}.ai-plan-table td{padding:8px;border-top:1px solid rgba(103,158,184,.17);font-size:11px;white-space:nowrap}.ai-plan-table tr.proposed{background:rgba(32,91,46,.05)}.ai-plan-table tr.unchanged{opacity:.62}.ai-plan-table input{width:17px;height:17px;accent-color:#6ccc33}.ai-confidence{display:inline-flex;min-width:43px;justify-content:center;border-radius:999px;padding:3px 7px;font-weight:900}.ai-confidence.good{color:#7ee22d;background:rgba(126,226,45,.12)}.ai-confidence.warn{color:#ffd166;background:rgba(255,209,102,.12)}.ai-confidence.bad{color:#ff7585;background:rgba(255,77,99,.14)}.ai-decision-grid{display:grid;grid-template-columns:1fr 1.25fr 1.35fr;gap:10px;margin:12px 0}.ai-decision-grid>section{min-height:116px}.ai-decision-grid p{line-height:1.45;color:#d3e5ed}.ai-variants{display:grid;gap:5px}.ai-variants button{display:flex;justify-content:space-between;gap:8px;border:0;background:transparent;color:#d6e7ee;text-align:left;padding:3px}.ai-variants button.active strong{color:#7ee22d}.ai-variants span{color:#94adba;font-size:10px}.ai-chart-card{margin-top:12px;overflow:hidden}.ai-chart-legend{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;color:#a9c0cc;font-size:11px}.ai-chart-legend span:before{content:"";display:inline-block;width:11px;height:7px;margin-right:5px;border-radius:2px;background:#7d96a3}.ai-chart-legend .load:before{background:#32a8e8}.ai-chart-legend .pv:before{background:#67bd2e}.ai-chart-legend .soc:before{background:#ffd200}.ai-chart-legend .sell:before{background:#7ee22d;border-radius:50%}.ai-chart-legend .charge:before{background:#ffd166;border-radius:50%}.ai-chart-card svg{display:block;width:100%;height:auto;max-height:270px}.ai-support-grid{display:grid;grid-template-columns:.8fr 1.7fr;gap:10px;margin-top:10px}.ai-weather-main{display:flex;align-items:center;gap:12px}.ai-weather-main svg{width:46px;height:46px;color:#ffd166}.ai-weather-main strong{font-size:27px}.ai-weather small{color:#93adbc}.ai-quality-card ul{list-style:none;margin:0;padding:0}.ai-quality-card li{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid rgba(103,158,184,.15)}.ai-quality-card li span{color:#91aeba}.ai-quality-card li strong{text-align:right}.ai-apply-plan{position:sticky;bottom:-18px;z-index:4;width:100%;min-height:44px;margin:14px 0 -18px;border:1px solid #4e9e28;border-radius:7px;background:linear-gradient(180deg,#37871d,#276414);color:#fff;font-weight:900;cursor:pointer;box-shadow:0 -9px 22px rgba(3,15,24,.8)}.ai-apply-plan:disabled{opacity:.4;cursor:not-allowed}.ai-day-plan>.ai-kpis{grid-template-columns:repeat(5,minmax(0,1fr))}.ai-quality-full{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:12px}
           .ai-cancel-plan{min-height:34px;border:1px solid rgba(255,95,112,.5);border-radius:6px;background:rgba(120,24,39,.28);color:#ffabb5;padding:0 11px;cursor:pointer}
           .ai-chart-legend .tariff:before{background:rgba(255,209,102,.45)}
           .ai-chart-v2{position:relative;overflow:visible}.ai-chart-v2 h3{margin-bottom:8px}.ai-chart-scroll{overflow-x:auto;overflow-y:hidden;scrollbar-color:#527385 #071924}.ai-chart-v2 svg{width:100%;min-width:790px;max-height:none}.ai-chart-grid{stroke:rgba(152,195,216,.17);stroke-width:1}.ai-chart-baseline{stroke:#88a9b9;stroke-width:1.5}.ai-chart-axis,.ai-day-label,.ai-now-label{fill:#9ab7c6;font-size:11px}.ai-day-label{fill:#d7edf7;font-weight:800}.ai-bar-load{fill:#35aee8}.ai-bar-actual{fill:#ff9f43}.ai-bar-solcast{fill:#77d84b;opacity:.72}.ai-forecast-band{fill:rgba(255,209,102,.14);stroke:rgba(255,209,102,.3);stroke-width:1}.ai-line-corrected{fill:none;stroke:#b77cff;stroke-width:3;stroke-linejoin:round;stroke-linecap:round}.ai-line-soc{fill:none;stroke:#ffd200;stroke-width:3;stroke-linejoin:round;stroke-linecap:round}.ai-min-soc{stroke:#ff7585;stroke-width:1.3;stroke-dasharray:6 5}.ai-action-sell{fill:#7ee22d}.ai-action-charge{fill:#ffd166}.ai-cheap-zone{fill:rgba(255,209,102,.07)}.ai-chart-weather{font-size:15px}.ai-day-separator{stroke:#5cc2ff;stroke-width:2;stroke-dasharray:6 5}.ai-now-line{stroke:#ff5f70;stroke-width:2;stroke-dasharray:5 4}.ai-now-label{fill:#ff9aa5;font-weight:800}.ai-chart-hit{fill:transparent;pointer-events:all;cursor:crosshair}.ai-chart-crosshair-x,.ai-chart-crosshair-y{display:none;stroke:#d8f2ff;stroke-width:1;stroke-dasharray:4 3;pointer-events:none}.ai-chart-crosshair-x.visible,.ai-chart-crosshair-y.visible{display:block}.ai-chart-tooltip{display:none;position:absolute;z-index:20;width:min(286px,calc(100% - 16px));padding:11px;border:1px solid #4d7b94;border-radius:7px;background:rgba(3,16,25,.97);box-shadow:0 12px 30px rgba(0,0,0,.45);color:#e9f6fb;font-size:11px;pointer-events:none}.ai-chart-tooltip.visible{display:block}.ai-chart-tooltip>strong{display:block;margin-bottom:8px;color:#7ee22d;font-size:12px}.ai-chart-tooltip>div{display:grid;grid-template-columns:1fr auto;gap:4px 10px}.ai-chart-tooltip span{color:#91adbc}.ai-chart-tooltip b{text-align:right}.ai-chart-tip-source{display:none}.ai-chart-help{display:block;margin-top:5px;color:#83a3b3}.ai-chart-legend .actual:before{background:#ff9f43}.ai-chart-legend .solcast:before{background:#77d84b}.ai-chart-legend .corrected:before{height:3px;background:#b77cff}.ai-chart-legend .band:before{background:rgba(255,209,102,.35);border:1px solid rgba(255,209,102,.6)}
           .ai-weather-v2{min-width:0}.ai-weather-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.ai-weather-head>div:first-child{display:flex;align-items:center;gap:12px}.ai-weather-icon{font-size:42px;line-height:1}.ai-weather-head h3{margin:0!important;text-transform:none}.ai-weather-temperature{text-align:right}.ai-weather-temperature strong{display:block;color:#f3fbff;font-size:26px}.ai-weather-temperature span{color:#9db7c5}.ai-weather-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:12px 0}.ai-weather-facts span{padding:8px;border:1px solid rgba(103,158,184,.18);border-radius:6px;color:#91adbc}.ai-weather-facts b{display:block;margin-top:3px;color:#e6f4fa}.ai-weather-tabs{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid rgba(103,158,184,.25)}.ai-weather-tabs button{padding:9px;border:0;border-bottom:2px solid transparent;background:transparent;color:#b7cfda;cursor:pointer}.ai-weather-tabs button.active{border-bottom-color:#2aaaff;color:#52baff}.ai-weather-strip{display:flex;gap:7px;overflow-x:auto;padding:10px 0}.ai-weather-day,.ai-weather-hour{min-width:66px;display:grid;justify-items:center;gap:3px;padding:7px;border-radius:6px;background:rgba(3,16,25,.42)}.ai-weather-day span,.ai-weather-hour span{font-size:25px}.ai-weather-day small,.ai-weather-hour small{color:#92aebb}.ai-weather-source{display:block;margin-top:3px}.ai-energy-48>.ai-support-grid{grid-template-columns:1fr 1fr}
           .ai-proposals-view>h2{margin:0 0 14px;color:#7ee22d;font-size:18px}
           .ai-readable-chart{position:relative;overflow:visible;padding:15px 12px 12px;background:radial-gradient(circle at 45% 15%,rgba(17,84,117,.13),transparent 45%),linear-gradient(180deg,rgba(9,35,51,.88),rgba(5,23,35,.92))}.ai-readable-chart h3{margin:0 0 10px;color:#7ee22d}.ai-readable-chart .ai-chart-scroll{border-top:1px solid rgba(111,166,191,.13);overflow-x:auto;overflow-y:hidden;scrollbar-color:#527385 #071924;scrollbar-width:thin}.ai-readable-chart svg{display:block;width:100%;height:auto;max-height:none!important}.ai-readable-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 13px;padding:0 5px 10px}.ai-readable-legend button{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:#adc5d1;font:inherit;font-size:11px;cursor:pointer;padding:4px 5px;border-radius:4px}.ai-readable-legend button:hover{background:rgba(89,164,201,.1);color:#e9f7fd}.ai-readable-legend button.disabled{opacity:.3;text-decoration:line-through}.ai-readable-legend i{display:block;width:14px;height:7px;border-radius:2px;background:#7b96a4}.ai-readable-legend .load i{background:#35aee8}.ai-readable-legend .actual i{background:#ff8a32}.ai-readable-legend .solcast i{height:3px;background:#67c842}.ai-readable-legend .corrected i{height:3px;background:#bd6dff}.ai-readable-legend .band i{height:9px;background:rgba(151,191,213,.34);border:1px solid rgba(161,205,228,.55)}.ai-readable-legend .soc i{height:3px;background:#ffd200}.ai-readable-legend .minimum i{height:2px;background:repeating-linear-gradient(90deg,#ff6577 0 5px,transparent 5px 8px)}
           .ai-readable-grid{stroke:rgba(136,184,205,.16);stroke-width:1}.ai-readable-grid-v{stroke-dasharray:3 4;stroke:rgba(139,187,207,.24)}.ai-readable-baseline{stroke:#66899b;stroke-width:1.2}.ai-readable-axis,.ai-readable-hour,.ai-readable-unit,.ai-readable-section-label,.ai-readable-day-label{fill:#a7c1ce;font-size:11px}.ai-readable-unit{fill:#dcecf4;font-weight:800;font-size:12px}.ai-readable-hour{fill:#c6dce6;font-weight:700}.ai-readable-load{fill:#35aee8;filter:drop-shadow(0 0 2px rgba(53,174,232,.25))}.ai-readable-actual{fill:#ff8a32;filter:drop-shadow(0 0 2px rgba(255,138,50,.25))}.ai-readable-band{fill:rgba(151,191,213,.2);stroke:rgba(165,204,224,.3);stroke-width:1}.ai-readable-solcast{fill:none;stroke:#67c842;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}.ai-readable-corrected{fill:none;stroke:#bd6dff;stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round}.ai-readable-soc{fill:none;stroke:#ffd200;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.ai-readable-min-soc{stroke:#ff6577;stroke-width:1.6;stroke-dasharray:7 6}.ai-readable-min-label{fill:#ff8996;font-size:10px;font-weight:700}.ai-readable-weather{font-size:18px}.ai-weather-risk{opacity:.9}.ai-weather-risk.low{fill:#65c95a}.ai-weather-risk.medium{fill:#ffd166}.ai-weather-risk.high{fill:#49aaff}.ai-weather-risk.missing{fill:#536d79;opacity:.35}.ai-readable-section-label{font-weight:800;fill:#9fb9c6}.ai-status-grid{stroke:rgba(116,166,188,.16);stroke-width:1}.ai-status-grid-v{stroke-dasharray:3 4}.ai-status-label{font-size:10px;font-weight:700}.ai-status-label.sell{fill:#7ee22d}.ai-status-label.charge{fill:#ffd200}.ai-status-label.tariff{fill:#b39a50}.ai-status-sell{fill:#69d438;stroke:#8de960;stroke-width:1}.ai-status-charge{fill:#ffd200;stroke:#ffe36a;stroke-width:1}.ai-status-tariff{fill:#9f863d;stroke:#c7ad5b;stroke-width:1}.ai-readable-day-separator{stroke:#52bfff;stroke-width:2.2;stroke-dasharray:7 5}.ai-readable-day-label{fill:#d8eff9;font-size:12px;font-weight:900}.ai-readable-now{stroke:#ff5d70;stroke-width:2;stroke-dasharray:6 4}.ai-readable-now-tag{fill:#f3f7f9;stroke:#ff5d70}.ai-readable-now-text{fill:#172d38;font-size:10px;font-weight:900}.ai-readable-chart .ai-chart-help{margin:8px 2px 0}.ai-readable-chart .ai-chart-tooltip{width:min(300px,calc(100% - 16px))}
           .ai-energy-48-crisp{grid-column:1/-1;min-width:0}.ai-energy-48-crisp>h3{margin:0 0 10px;color:#7ee22d}.ai-readable-stack{display:grid;gap:12px}.ai-crisp-chart{position:relative;overflow:visible;padding:15px 14px 12px;background:radial-gradient(circle at 50% 0%,rgba(18,86,117,.12),transparent 46%),linear-gradient(180deg,rgba(9,34,49,.92),rgba(5,22,33,.94))}.ai-crisp-chart h3{margin:0 0 9px;color:#7ee22d;font-size:16px}.ai-crisp-legend{display:flex;justify-content:center;flex-wrap:wrap;gap:5px 12px;margin:0 0 12px}.ai-crisp-legend button{display:inline-flex;align-items:center;gap:5px;border:0;border-radius:4px;background:transparent;color:#b8cdd7;font:inherit;font-size:11px;padding:3px 4px;cursor:pointer}.ai-crisp-legend button:hover{background:rgba(69,149,188,.12);color:#fff}.ai-crisp-legend button.disabled{opacity:.32;text-decoration:line-through}.ai-crisp-legend i{display:block;width:13px;height:7px;border-radius:2px;background:#35aee8}.ai-crisp-legend .actual i{background:#ff8a32}.ai-crisp-legend .solcast i,.ai-crisp-legend .corrected i,.ai-crisp-legend .soc i,.ai-crisp-legend .minimum i{height:3px}.ai-crisp-legend .solcast i{background:#67c842}.ai-crisp-legend .corrected i{background:#bd6dff}.ai-crisp-legend .band i{height:9px;background:rgba(151,191,213,.34);border:1px solid rgba(161,205,228,.55)}.ai-crisp-legend .soc i{background:#ffd200}.ai-crisp-legend .minimum i{background:repeating-linear-gradient(90deg,#ff6577 0 5px,transparent 5px 8px)}.ai-crisp-layout{display:grid;grid-template-columns:44px minmax(0,1fr) 38px;gap:7px;align-items:stretch}.ai-crisp-main{min-width:0}.ai-crisp-plot{position:relative;height:268px;border-bottom:1px solid rgba(119,166,188,.3);background:linear-gradient(180deg,rgba(4,18,28,.25),rgba(4,18,28,.52))}.ai-crisp-svg{display:block!important;width:100%!important;min-width:0!important;height:100%!important;max-height:none!important;overflow:visible}.ai-crisp-grid{stroke:rgba(118,164,185,.18);stroke-width:1}.ai-crisp-guide{stroke:rgba(123,170,191,.2);stroke-width:1;stroke-dasharray:5 6}.ai-crisp-baseline{stroke:rgba(157,202,222,.58);stroke-width:1}.ai-crisp-load{fill:#35aee8}.ai-crisp-actual{fill:#ff8a32}.ai-crisp-band{fill:rgba(151,191,213,.18);stroke:rgba(171,210,228,.38);stroke-width:1}.ai-crisp-solcast{fill:none;stroke:#67c842;stroke-width:2.6;stroke-linejoin:round;stroke-linecap:round}.ai-crisp-corrected{fill:none;stroke:#bd6dff;stroke-width:2.7;stroke-linejoin:round;stroke-linecap:round}.ai-crisp-soc{fill:none;stroke:#ffd200;stroke-width:2.8;stroke-linejoin:round;stroke-linecap:round}.ai-crisp-min-soc{stroke:#ff6577;stroke-width:1.5;stroke-dasharray:7 5}.ai-crisp-now{stroke:#ff5d70;stroke-width:1.8;stroke-dasharray:6 4}.ai-crisp-now-tag{position:absolute;top:7px;right:8px;border:1px solid #ff5d70;border-radius:4px;background:#f4f7f8;color:#263943;padding:2px 6px;font-size:10px;font-weight:900}.ai-crisp-hit{stroke:none!important;stroke-width:0!important;fill:transparent!important}.ai-crisp-axis{display:flex;flex-direction:column;justify-content:space-between;min-height:268px;color:#a9c3d0;font-size:11px;font-weight:700}.ai-crisp-axis b{color:#e3f2f7;font-size:12px}.ai-crisp-axis-left{align-items:flex-end;text-align:right}.ai-crisp-axis-right{align-items:flex-start;text-align:left}.ai-crisp-time-grid,.ai-crisp-weather-grid{display:grid;grid-template-columns:repeat(24,minmax(0,1fr));margin-left:0}.ai-crisp-time-grid{min-height:25px;align-items:start;padding-top:6px;color:#c6dbe5;font-size:10px;font-weight:800}.ai-crisp-time-grid span{text-align:center;white-space:nowrap}.ai-crisp-weather-grid{min-height:31px;border-top:1px solid rgba(104,151,174,.12);align-items:center}.ai-crisp-weather-cell{position:relative;display:flex;align-items:center;justify-content:center;min-width:0;height:30px;cursor:default}.ai-crisp-weather-cell b{font-size:18px;line-height:1;font-weight:400}.ai-crisp-weather-cell i{position:absolute;bottom:2px;width:13px;height:2px;border-radius:4px;background:#536d79;opacity:.35}.ai-crisp-weather-cell i.low{background:#65c95a;opacity:.9}.ai-crisp-weather-cell i.medium{background:#ffd166;opacity:.9}.ai-crisp-weather-cell i.high{background:#49aaff;opacity:.9}.ai-crisp-status{display:grid;grid-template-columns:74px minmax(0,1fr);align-items:center;gap:3px 8px;margin-top:4px;padding-top:5px;border-top:1px solid rgba(104,151,174,.18);font-size:10px}.ai-crisp-status>span{font-weight:800;color:#92afbd}.ai-crisp-status>div{display:grid;grid-template-columns:repeat(24,minmax(0,1fr));gap:2px;height:13px}.ai-crisp-status>div span{display:block;border-radius:3px;background:rgba(102,137,153,.12)}.ai-crisp-status>div span.active.sell{background:#69d438;box-shadow:0 0 0 1px rgba(141,233,96,.55) inset}.ai-crisp-status>div span.active.charge{background:#ffd200;box-shadow:0 0 0 1px rgba(255,227,106,.55) inset}.ai-crisp-status>div span.active.tariff{background:#9f863d;box-shadow:0 0 0 1px rgba(199,173,91,.55) inset}.ai-crisp-chart .ai-chart-tooltip{width:min(300px,calc(100% - 18px))}.ai-crisp-chart .ai-chart-help{margin:8px 1px 0}.ai-energy-48-crisp .ai-crisp-chart{margin-top:0}
           @media(max-width:980px){.ai-energy-48>.ai-support-grid{grid-template-columns:1fr}.ai-chart-v2 svg{min-width:860px}.ai-weather-facts{grid-template-columns:1fr 1fr}.ai-weather-facts span:last-child{grid-column:1/-1}.ai-crisp-chart{padding:12px 9px}.ai-crisp-layout{grid-template-columns:36px minmax(0,1fr) 31px;gap:4px}.ai-crisp-plot{height:236px}.ai-crisp-axis{min-height:236px;font-size:10px}.ai-crisp-legend{justify-content:flex-start;gap:4px 7px}.ai-crisp-legend button{font-size:10px}.ai-crisp-status{grid-template-columns:66px minmax(0,1fr);font-size:9px}.ai-crisp-svg{min-width:0!important}}
           @media(max-width:1500px){.info-grid{grid-template-columns:1fr 1fr}.info-grid>.panel:nth-child(3){grid-column:1/-1}.schedule-main.selecting{grid-template-columns:1fr}.bulk-panel{max-width:none}.mode-legend{grid-template-columns:repeat(3,minmax(0,1fr))}}
           @media(max-width:980px){.dem-v073{padding:10px}.info-grid{grid-template-columns:1fr}.status-grid,.sales-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.info-grid>.panel{height:auto;min-height:340px}.schedule-head{display:grid}.schedule-tools{justify-content:stretch}.tool-btn{flex:1}.mode-legend{grid-template-columns:1fr 1fr}.schedule-table{min-width:1160px}.schedule-table-card{overflow-x:auto}.sales-tables{grid-template-columns:1fr}.sales-chart{overflow-x:auto;grid-template-columns:repeat(24,24px)}.price-scroll{height:260px;overflow:auto;scrollbar-gutter:stable}.solcast-days{grid-template-columns:repeat(2,1fr)}.settings-layout{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}.settings-nav{flex-direction:row;overflow-x:auto;overflow-y:hidden;border-right:0;border-bottom:1px solid var(--line)}.settings-nav button{width:auto;min-width:max-content;text-align:center}.diagnostic-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.ai-shell{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}.ai-sidebar{border-right:0;border-bottom:1px solid var(--line);padding:7px}.ai-sidebar nav{display:flex;overflow-x:auto}.ai-sidebar nav button{min-width:max-content}.ai-learning-status{display:none}.ai-overview-grid{grid-template-columns:1fr}.ai-overview-grid>.ai-chart-card{grid-column:auto}.ai-decision-grid,.ai-quality-full{grid-template-columns:1fr}.ai-support-grid{grid-template-columns:1fr}.ai-day-plan>.ai-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
           @media(max-width:620px){
             .dem-v073{padding:4px;gap:8px}.panel,.schedule-shell,.table-wrap{border-radius:7px}.panel-title{padding:10px 12px;font-size:18px}
             .status-grid,.sales-summary{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px!important;padding:7px!important}.status-panel .stat,.sales-summary .stat{min-height:52px;padding:7px 8px;gap:7px}.status-panel .status-mode{grid-column:1/-1}.stat-icon{width:29px;height:29px}.stat-icon svg{width:17px;height:17px}.status-panel .stat span,.sales-summary .stat span{font-size:10px}.status-panel .stat strong,.sales-summary .stat strong{font-size:13px;line-height:1.25;white-space:normal;overflow-wrap:anywhere}
             .info-grid{gap:8px}.info-grid>.panel{min-height:0;height:auto}.price-summary{grid-template-columns:1fr}.price-scroll{height:230px}.price-table th,.price-table td{padding:4px 7px;font-size:11px}
             .solcast-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.solcast-days{display:flex;gap:6px;overflow-x:auto;scroll-snap-type:x proximity;padding-bottom:5px}.solcast-day{min-width:132px;scroll-snap-align:start}.solcast-chart{height:162px;padding-left:5px;padding-right:5px}.solcast-bars{height:138px;min-width:560px}.solcast-performance{grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;padding:7px}
             .schedule-shell{padding:7px}.schedule-head{gap:8px}.schedule-title h2{font-size:19px}.schedule-title p{font-size:11px;line-height:1.35}.schedule-tools{display:grid;grid-template-columns:1fr 1fr;gap:6px}.tool-btn{min-height:36px;padding:0 8px;justify-content:center;font-size:12px}.gear-btn{width:100%;min-height:36px}.mode-legend{display:flex;gap:10px;overflow-x:auto;padding:3px 1px 7px;scroll-snap-type:x proximity}.mode-tile{min-width:150px;scroll-snap-align:start}.mode-icon{width:30px;height:30px}.mode-tile strong{font-size:12px}.mode-tile span{font-size:10px}.schedule-table{min-width:880px}.schedule-table th,.schedule-table td{padding:2px 3px}.schedule-table td{font-size:10px}.schedule-foot{padding:7px;align-items:flex-start;flex-direction:column}.foot-actions{width:100%;display:grid;grid-template-columns:1fr 1fr}.foot-actions button{justify-content:center;padding:0 7px;font-size:11px}
             .sales-summary{padding:8px}.sales-chart{min-height:150px}.sales-tables{gap:8px}.sales-table-card h3{font-size:14px;padding:9px}.sales-table-card th,.sales-table-card td{font-size:11px;padding:6px 8px}
              .overlay{padding:0;align-items:stretch}.dialog,.ai-dialog,.settings-dialog{width:100%!important;height:100dvh!important;max-height:100dvh!important;border-radius:0}.dialog-head{padding-top:max(14px,env(safe-area-inset-top))}.dialog-actions{padding-bottom:max(12px,env(safe-area-inset-bottom))}.apply-row{grid-template-columns:24px 1fr}.apply-row .field,.apply-row select{grid-column:2}.ai-grid{grid-template-columns:1fr}.ai-proposal-scroll,.ai-history-scroll{max-height:none}.history-toolbar{grid-template-columns:1fr 1fr}.history-toolbar button{width:100%}.analysis-detail-grid,.analysis-price-groups{grid-template-columns:1fr}.settings-content{padding:9px}.diagnostic-summary{grid-template-columns:1fr}.diagnostic-actions{display:grid}.diagnostic-actions button{width:100%}.ai-main{padding:10px}.ai-price-columns{grid-template-columns:1fr}.ai-kpis,.ai-day-plan>.ai-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.ai-proposal-toolbar{align-items:stretch;flex-direction:column}.ai-day-tabs,.ai-view-tools{display:grid;grid-template-columns:1fr 1fr}.ai-decision-grid{grid-template-columns:1fr}.ai-chart-card{padding:9px}.ai-chart-card svg{min-width:620px}.ai-chart-card{overflow-x:auto}.ai-crisp-chart svg{min-width:0!important}.ai-crisp-chart{overflow:visible}
           }
        </style>
        <div class="dem-v073">
          <section class="panel status-panel">
            <h2 class="panel-title">${this.iconSvg("chart")} Status energii</h2>
            <div class="status-grid">
              ${this.stat("Tryb", modeText, `${modeClass} status-mode`, "mode", "shield")}
              ${this.stat("PV", `${this.state(this.entity("sensor", "pv_power"))} W`, "status-pv", "pv", "pv")}
              ${this.stat("Dom", `${this.state(this.entity("sensor", "load_power"))} W`, "status-home", "load", "home")}
              ${this.stat("Sieć", this.gridFlow(this.state(this.entity("sensor", "grid_power"))), "status-grid", "grid", "grid")}
              ${this.stat("Bateria", this.batteryFlow(this.state(this.entity("sensor", "battery_power"))), "status-battery", "battery-power", "battery")}
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
              <h2 class="panel-title">Ceny sprzedaży</h2>
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
                ${this.stat("Dziś", this.formatEnergy(this.state(solcastToday)), "", "solcast-today")}
                ${this.stat("Pozostało", this.formatEnergy(this.state(solcastRemaining)), "", "solcast-remaining")}
                ${this.stat("Jutro", this.formatEnergy(this.state(solcastTomorrow)), "", "solcast-tomorrow")}
                ${this.stat("Szczyt", this.formatPower(this.state(solcastPeakPower)), "", "solcast-peak-power")}
                ${this.stat("Najlepszy dzień", this.bestSolcastDay(solcastEntities), "", "solcast-best-day")}
              </div>
              <div data-live-html="solcast-days">${this.solcastDaysChart(solcastEntities)}</div>
              <div data-live-html="solcast-chart">${this.solcastChart(solcastToday, solcastTomorrow)}</div>
              <div class="solcast-performance">
                ${this.stat("Prognoza na dziś", this.formatEnergy(solcastForecastValue), "", "solcast-performance-forecast")}
                ${this.stat("Produkcja rzeczywista", this.formatEnergy(dailyPvValue), "", "solcast-performance-actual")}
                ${this.stat("Różnica", this.formatSignedEnergy(solcastDifference), "", "solcast-performance-difference")}
                ${this.stat("Realizacja dzisiaj", forecastProgressValue === null ? "brak" : `${forecastProgressValue.toFixed(1)} %`, "", "solcast-performance-progress")}
                ${this.stat("Trafność historyczna", solcastAccuracyValue === null ? "brak" : `${solcastAccuracyValue.toFixed(1)} %`, "", "solcast-performance-accuracy")}
              </div>
            </section>
          </div>
          <section class="schedule-shell">
            <div class="schedule-head">
              <div class="schedule-title">
                <h2>Harmonogram pracy <button class="title-icon ai" data-open-ai="1" title="Sugestie AI">${this.iconSvg("ai")}</button><span class="save-indicator ${this._saveStatus}" data-save-indicator>${this._saveStatus === "saving" ? this._saveMessage || "Zapisywanie..." : this._saveStatus === "saved" ? this._saveMessage || "Zapisano" : this._saveStatus === "error" ? this._saveMessage : ""}</span></h2>
                <p>Kliknij godzinę, aby edytować pojedynczy slot lub zaznacz wiele, aby edytować zbiorczo.</p>
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
                <div class="schedule-table-card">
                  <table class="schedule-table">
                    <colgroup>
                      <col class="col-check"><col class="col-time"><col class="col-mode"><col class="col-power">
                      <col class="col-current"><col class="col-current"><col class="col-grid"><col class="col-grid-current">
                      <col class="col-soc"><col class="col-price"><col class="col-active"><col class="col-action">
                    </colgroup>
                    <thead><tr><th class="check-col"></th><th class="time-col">Godz.</th><th>Tryb</th><th>Moc</th><th>Rozł.</th><th>Ład.</th><th>Ładowanie z sieci</th><th>Prąd ładowania z sieci</th><th>SOC</th><th>Cena min.</th><th>Aktywne</th><th>Akcja</th></tr></thead>
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
          <section class="panel sales-panel"><h2 class="panel-title">${this.iconSvg("chart")} Statystyki sprzedaży</h2><div data-live-html="sales-stats">${this.salesStatsPanel()}</div></section>
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
      // Charge is a work-mode choice. Grid: yes remains a separate,
      // explicit consent and must never be inferred from this selection.
      el.onchange = () => this.setSelect(el.dataset.select, el.value);
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
    this.querySelectorAll("[data-open-tou]").forEach((el) => el.addEventListener("click", (event) => {
      event.stopPropagation();
      this._dialog = { type: "tou", idx: Number(el.dataset.openTou) };
      this.render();
    }));
    this.querySelectorAll("[data-open-ai]").forEach((el) => el.addEventListener("click", () => {
      this.saveAiAnalysis(this.aiSuggestions(slots));
      this._aiProposalSelection = null;
      this._aiView = "proposals";
      this._aiDay = "today";
      this._aiShow24 = false;
      this.initialiseAiSelections(this.aiPlannerData(slots));
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
      this._tariffDraft = null;
      this.render();
    }));
    this.querySelectorAll("[data-tariff-field='tariff_mode'],[data-tariff-field='osd_provider']").forEach((el) => el.addEventListener("change", () => {
      const draft = this.collectTariffDraft();
      if (el.dataset.tariffField === "osd_provider") {
        const provider = this.tariffData().providers?.find((item) => item.id === draft.osd_provider);
        if (provider?.tariffs?.length) draft.tariff_plan = provider.tariffs[0].id;
      }
      this._tariffDraft = draft;
      this.render();
    }));
    this.querySelectorAll("[data-save-tariff]").forEach((el) => el.addEventListener("click", () => this.saveTariffSettings()));
    this.querySelectorAll("[data-refresh-tariff]").forEach((el) => el.addEventListener("click", async () => {
      el.disabled = true;
      try {
        await this.callService("deye_energy_manager", "refresh_tariff_catalog", {});
        this._tariffSaveStatus = "Sprawdzono katalog. Aktywna pozostaje najnowsza poprawna wersja.";
      } catch (error) {
        this._tariffSaveStatus = `Nie udało się sprawdzić katalogu: ${error?.message || error}`;
      }
      this.render();
    }));
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
    this.querySelectorAll("[data-save-charge-profile]").forEach((el) => el.addEventListener("click", () => this.saveChargeProfile()));
    this.querySelectorAll("[data-save-normal-profile]").forEach((el) => el.addEventListener("click", () => this.saveNormalProfile()));
    this.querySelectorAll("[data-reload-normal-profile]").forEach((el) => el.addEventListener("click", () => this.reloadNormalProfileSlot(el.dataset.reloadNormalProfile)));
    this.querySelectorAll("[data-save-default-settings]").forEach((el) => el.addEventListener("click", () => this.saveDefaultSettings()));
    this.querySelectorAll("[data-charge-profile-number]").forEach((el) => {
      const saveDraft = () => { this._chargeProfileDraft[el.dataset.chargeProfileNumber] = el.value; };
      el.addEventListener("input", saveDraft);
      el.addEventListener("change", saveDraft);
    });
    this.querySelectorAll('[data-raw="charge-profile-grid"]').forEach((el) => {
      el.addEventListener("change", () => { this._chargeProfileGridDraft = el.value === "on"; });
    });
    this.querySelectorAll("[data-normal-profile-number]").forEach((el) => {
      const saveDraft = () => { this._normalProfileDraft[el.dataset.normalProfileNumber] = el.value; };
      el.addEventListener("input", saveDraft);
      el.addEventListener("change", saveDraft);
    });
    this.querySelectorAll('[data-raw="normal-profile-mode"]').forEach((el) => {
      el.addEventListener("change", () => { this._normalProfileDraft.physical_work_mode = el.value; });
    });
    this.querySelectorAll("[data-default-profile-number]").forEach((el) => {
      const saveDraft = () => { this._defaultSettingsDraft[el.dataset.defaultProfileNumber] = el.value; };
      el.addEventListener("input", saveDraft);
      el.addEventListener("change", saveDraft);
    });
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
    this.querySelectorAll("[data-resume-manager]").forEach((el) => el.addEventListener("click", () => {
      if (window.confirm("W\u0142\u0105czy\u0107 Manager i harmonogram? Nie w\u0142\u0105czy to harmonogramu \u0142adowania z sieci.")) this.resumeManager();
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
    this.querySelectorAll("[data-ai-view]").forEach((el) => el.addEventListener("click", () => {
      this._aiView = el.dataset.aiView;
      this.render();
    }));
    this.querySelectorAll("[data-ai-day]").forEach((el) => el.addEventListener("click", () => {
      this._aiDay = el.dataset.aiDay;
      this.render();
    }));
    this.querySelectorAll("[data-ai-weather-mode]").forEach((el) => el.addEventListener("click", () => {
      this._aiWeatherMode = el.dataset.aiWeatherMode === "hourly" ? "hourly" : "daily";
      this.render();
    }));
    this.querySelectorAll("[data-ai-chart-series]").forEach((el) => el.addEventListener("click", () => {
      if (!(this._aiChartHiddenSeries instanceof Set)) this._aiChartHiddenSeries = new Set();
      const series = el.dataset.aiChartSeries;
      if (this._aiChartHiddenSeries.has(series)) this._aiChartHiddenSeries.delete(series);
      else this._aiChartHiddenSeries.add(series);
      this.render();
    }));
    this.querySelectorAll("[data-ai-chart-point]").forEach((el) => {
      const show = (event, pin = false) => {
        const card = el.closest("[data-ai-chart]");
        if (!card) return;
        const chartId = el.dataset.aiChartPoint;
        const index = el.dataset.aiChartIndex;
        const key = `${chartId}-${index}`;
        if (pin) this._aiChartPinned = this._aiChartPinned === key ? null : key;
        const source = card.querySelector(`[data-ai-tip-source="${key}"]`);
        const tooltip = card.querySelector("[data-ai-chart-tooltip]");
        const svg = card.querySelector("svg");
        const crossX = card.querySelector(".ai-chart-crosshair-x");
        const crossY = card.querySelector(".ai-chart-crosshair-y");
        if (!source || !tooltip || !svg || !crossX || !crossY) return;
        tooltip.innerHTML = source.innerHTML;
        tooltip.classList.add("visible");
        const x = Number(el.getAttribute("x")) + Number(el.getAttribute("width")) / 2;
        const svgRect = svg.getBoundingClientRect();
        const viewBox = svg.viewBox.baseVal;
        const pointerY = event?.clientY ? (event.clientY - svgRect.top) / svgRect.height * viewBox.height : 150;
        crossX.setAttribute("x1", x); crossX.setAttribute("x2", x);
        const hitTop = Number(el.getAttribute("y")) || 48;
        const hitBottom = hitTop + (Number(el.getAttribute("height")) || 338);
        crossY.setAttribute("y1", Math.max(hitTop, Math.min(hitBottom, pointerY))); crossY.setAttribute("y2", Math.max(hitTop, Math.min(hitBottom, pointerY)));
        crossX.classList.add("visible"); crossY.classList.add("visible");
        const cardRect = card.getBoundingClientRect();
        const pointerX = event?.clientX || cardRect.left + cardRect.width / 2;
        const pointerClientY = event?.clientY || cardRect.top + 180;
        const maxLeft = Math.max(8, cardRect.width - 300);
        tooltip.style.left = `${Math.max(8, Math.min(maxLeft, pointerX - cardRect.left + 14))}px`;
        tooltip.style.top = `${Math.max(52, Math.min(cardRect.height - 300, pointerClientY - cardRect.top + 12))}px`;
        this.holdInteraction(1400);
      };
      const hide = () => {
        const key = `${el.dataset.aiChartPoint}-${el.dataset.aiChartIndex}`;
        if (this._aiChartPinned === key) return;
        const card = el.closest("[data-ai-chart]");
        card?.querySelector("[data-ai-chart-tooltip]")?.classList.remove("visible");
        card?.querySelector(".ai-chart-crosshair-x")?.classList.remove("visible");
        card?.querySelector(".ai-chart-crosshair-y")?.classList.remove("visible");
      };
      el.addEventListener("pointerenter", (event) => show(event));
      el.addEventListener("pointermove", (event) => show(event));
      el.addEventListener("pointerleave", hide);
      el.addEventListener("click", (event) => { event.stopPropagation(); show(event, true); });
    });
    this.querySelectorAll("[data-ai-toggle-24]").forEach((el) => el.addEventListener("click", () => {
      this._aiShow24 = !this._aiShow24;
      this.render();
    }));
    this.querySelectorAll("[data-ai-plan-row]").forEach((el) => el.addEventListener("change", () => {
      const selected = this.aiSelection();
      if (el.checked) selected.add(el.dataset.aiPlanRow);
      else selected.delete(el.dataset.aiPlanRow);
      this.render();
    }));
    this.querySelectorAll("[data-ai-toggle-selection]").forEach((el) => el.addEventListener("click", () => {
      const planner = this.aiPlannerData(slots);
      const proposedKeys = this.aiRowsForDay(planner).filter((row) => row.proposed).map((row) => this.aiSlotKey(row.hour));
      const selected = this.aiSelection();
      const allSelected = proposedKeys.length && proposedKeys.every((key) => selected.has(key));
      if (allSelected) selected.clear();
      else proposedKeys.forEach((key) => selected.add(key));
      this.render();
    }));
    this.querySelectorAll("[data-apply-ai-day]").forEach((el) => el.addEventListener("click", () => this.applyAiDayPlan(slots)));
    this.querySelectorAll("[data-cancel-future-plan]").forEach((el) => el.addEventListener("click", async () => {
      if (!window.confirm("Anulować zapisany plan na jutro?")) return;
      await this.callService("deye_energy_manager", "cancel_future_plan", {});
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
