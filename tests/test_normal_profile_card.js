const fs = require("fs");
const path = require("path");

// Minimalny mock środowiska przeglądarki wymagany przez kartę.
global.window = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
  cancelAnimationFrame: (id) => clearTimeout(id),
};
global.document = {
  scrollingElement: {},
  documentElement: {},
  body: {},
};
class HTMLElement {}
global.HTMLElement = HTMLElement;
global.customElements = { define: () => {} };

const cardPath = path.join(
  __dirname,
  "..",
  "custom_components",
  "deye_energy_manager",
  "www",
  "deye-energy-manager-card.js"
);
eval(fs.readFileSync(cardPath, "utf8") + "\nglobal.DeyeEnergyManagerCard = DeyeEnergyManagerCard;");

let failures = 0;
function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    failures += 1;
    console.error(`FAIL: ${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

function assertFalse(value, message) {
  assertTrue(!value, message);
}

function makeHass(overrides = {}) {
  const managerStatus = overrides.managerStatus || {
    state: "idle",
    attributes: {},
  };
  return {
    states: {
      "sensor.deye_energy_manager_manager_status": managerStatus,
      "number.deye_energy_manager_normal_profile_tou_soc": overrides.touSocEntity || {
        state: "unavailable",
        attributes: {},
      },
      "number.deye_energy_manager_normal_profile_sell_power": overrides.sellPowerEntity || {
        state: "unavailable",
        attributes: {},
      },
      "number.deye_energy_manager_normal_profile_discharge_current": overrides.dischargeEntity || {
        state: "unavailable",
        attributes: {},
      },
      "number.deye_energy_manager_normal_profile_charge_current": overrides.chargeEntity || {
        state: "unavailable",
        attributes: {},
      },
      "number.deye_energy_manager_normal_profile_grid_charge_current": overrides.gridEntity || {
        state: "unavailable",
        attributes: {},
      },
      "select.deye_energy_manager_normal_profile_mode": overrides.modeEntity || {
        state: "unavailable",
        attributes: {},
      },
    },
    services: { deye_energy_manager: { save_normal_profile: true } },
  };
}

function makeCard(overrides = {}) {
  const card = new DeyeEnergyManagerCard();
  card.setConfig({});
  card._hass = makeHass(overrides);
  card.render = () => {};
  card.captureScrollPositions = () => {};
  card.beginSave = () => {};
  card.finishSave = () => {};
  card.failSave = () => {};
  card.updateSaveIndicator = () => {};
  return card;
}

function fakeInput(key, value) {
  return {
    value: String(value),
    dataset: { normalProfileNumber: key },
    tagName: "INPUT",
    type: "number",
    addEventListener: () => {},
  };
}

function fakeSelect(value) {
  return {
    value: String(value),
    dataset: {},
    tagName: "SELECT",
    addEventListener: () => {},
  };
}

// 1. null w normal_profile.tou_soc daje puste pole, nie 0.
{
  const card = makeCard({
    managerStatus: {
      state: "idle",
      attributes: {
        normal_profile: {
          physical_work_mode: "Zero Export To Load",
          sell_power: 1000,
          discharge_current: 50,
          charge_current: 50,
          grid_charge_current: 10,
          tou_soc: null,
        },
      },
    },
  });
  assertEqual(card.normalProfileNumericValue("normal_profile_tou_soc", "tou_soc"), "", "null tou_soc should render as empty string");
  assertEqual(card.normalProfileValues().touSoc, "", "null tou_soc should produce empty touSoc value");
}

// 2. Pusty ciąg nie jest traktowany jako 0.
{
  const card = makeCard({
    managerStatus: {
      state: "idle",
      attributes: {
        normal_profile: {
          physical_work_mode: "Zero Export To Load",
          sell_power: 1000,
          discharge_current: 50,
          charge_current: 50,
          grid_charge_current: 10,
          tou_soc: "",
        },
      },
    },
  });
  assertEqual(card.normalProfileNumericValue("normal_profile_tou_soc", "tou_soc"), "", "empty string tou_soc should render as empty string");
}

// 3. unknown/unavailable encja nie podstawia 0.
{
  const card = makeCard({
    managerStatus: { state: "idle", attributes: { normal_profile: {} } },
    touSocEntity: { state: "unknown", attributes: {} },
  });
  assertEqual(card.normalProfileNumericValue("normal_profile_tou_soc", "tou_soc"), "", "unknown entity state should not fallback to 0");
}

// 4. Input tou_soc nie ma atrybutu disabled.
{
  const card = makeCard();
  const html = card.normalProfileInput("tou_soc", "number.deye_energy_manager_normal_profile_tou_soc", "%");
  assertFalse(html.includes("disabled"), "normalProfileInput for tou_soc must not contain disabled attribute");
  assertTrue(html.includes('type="number"'), "normalProfileInput must use number input");
  assertTrue(html.includes('min="0"'), "normalProfileInput must have min=0 fallback");
  assertTrue(html.includes('max="100"'), "normalProfileInput must have max=100 fallback");
  assertTrue(html.includes('step="1"'), "normalProfileInput must have step=1 fallback");
}

// 5. Wpisanie 25 zapisuje 25 w szkicu i renderuje to samo.
{
  const card = makeCard();
  card._normalProfileDraft.tou_soc = "25";
  assertEqual(card.normalProfileNumericValue("normal_profile_tou_soc", "tou_soc"), "25", "draft tou_soc 25 should be returned");
  const html = card.normalProfileInput("tou_soc", "number.deye_energy_manager_normal_profile_tou_soc", "%");
  assertTrue(html.includes('value="25"'), "rendered input should show drafted value 25");
}

// 6. Ponowne renderowanie przed aktualizacją HA nadal pokazuje szkic.
{
  const card = makeCard({
    managerStatus: {
      state: "idle",
      attributes: {
        normal_profile: { physical_work_mode: "Zero Export To Load", tou_soc: 0 },
      },
    },
    touSocEntity: { state: "0", attributes: {} },
    modeEntity: { state: "Zero Export To Load", attributes: {} },
  });
  card._normalProfileDraft.tou_soc = "25";
  assertEqual(card.normalProfileNumericValue("normal_profile_tou_soc", "tou_soc"), "25", "draft must survive re-render before HA update");
}

// 7. Zapis tou_soc=25 tworzy stan oczekujący i wywołuje tylko save_normal_profile.
{
  const card = makeCard({
    modeEntity: { state: "Zero Export To Load", attributes: {} },
  });
  card.querySelector = (selector) => {
    if (selector === '[data-raw="normal-profile-mode"]') return fakeSelect("Zero Export To CT");
    return null;
  };
  card.querySelectorAll = (selector) => {
    if (selector === "[data-normal-profile-number]") {
      return [
        fakeInput("sell_power", "2000"),
        fakeInput("discharge_current", "60"),
        fakeInput("charge_current", "70"),
        fakeInput("grid_charge_current", "10"),
        fakeInput("tou_soc", "25"),
      ];
    }
    return [];
  };
  const calls = [];
  card.callService = (domain, service, data) => {
    calls.push({ domain, service, data });
    return Promise.resolve();
  };
  (async () => {
    const result = await card.saveNormalProfile();
    assertTrue(result, "saveNormalProfile should succeed");
    assertEqual(calls.length, 1, "saveNormalProfile must call exactly one service");
    assertEqual(calls[0].domain, "deye_energy_manager", "service domain must be deye_energy_manager");
    assertEqual(calls[0].service, "save_normal_profile", "service must be save_normal_profile");
    assertEqual(calls[0].data.tou_soc, 25, "saved tou_soc must be 25");
    assertEqual(calls[0].data.physical_work_mode, "Zero Export To CT", "saved mode must be CT");
    assertEqual(card._normalProfilePending.tou_soc, 25, "pending state must store tou_soc 25");
    assertEqual(card._normalProfilePending.physical_work_mode, "Zero Export To CT", "pending state must store CT");
    assertEqual(Object.keys(card._normalProfileDraft).length, 0, "draft must be cleared after successful save");
  })();
}

// 8. Stary manager_status nie nadpisuje oczekującej wartości.
{
  const card = makeCard({
    managerStatus: {
      state: "idle",
      attributes: {
        normal_profile: {
          physical_work_mode: "Zero Export To Load",
          sell_power: 1000,
          discharge_current: 50,
          charge_current: 50,
          grid_charge_current: 10,
          tou_soc: 0,
        },
      },
    },
    modeEntity: { state: "Zero Export To Load", attributes: {} },
    touSocEntity: { state: "0", attributes: {} },
  });
  card._normalProfilePending = {
    physical_work_mode: "Zero Export To CT",
    sell_power: 2000,
    discharge_current: 60,
    charge_current: 70,
    grid_charge_current: 10,
    tou_soc: 25,
  };
  assertEqual(card.normalProfileMode(), "Zero Export To CT", "pending CT must override old manager_status Load");
  assertEqual(card.normalProfileNumericValue("normal_profile_tou_soc", "tou_soc"), "25", "pending tou_soc 25 must override old stored 0");
}

// 9. Potwierdzenie przez manager_status usuwa stan oczekujący.
{
  const card = makeCard({
    managerStatus: {
      state: "idle",
      attributes: {
        normal_profile: {
          physical_work_mode: "Zero Export To CT",
          sell_power: 2000,
          discharge_current: 60,
          charge_current: 70,
          grid_charge_current: 10,
          tou_soc: 25,
        },
      },
    },
  });
  card._normalProfilePending = {
    physical_work_mode: "Zero Export To CT",
    sell_power: 2000,
    discharge_current: 60,
    charge_current: 70,
    grid_charge_current: 10,
    tou_soc: 25,
  };
  card.checkNormalProfilePending();
  assertEqual(card._normalProfilePending, null, "pending state must be cleared after manager_status confirmation");
}

// 10. Wybór Zero Export To CT pozostaje widoczny po zapisie (stan oczekujący).
{
  const card = makeCard({
    managerStatus: {
      state: "idle",
      attributes: {
        normal_profile: { physical_work_mode: "Zero Export To Load", tou_soc: 0 },
      },
    },
    modeEntity: { state: "Zero Export To Load", attributes: {} },
  });
  card._normalProfilePending = {
    physical_work_mode: "Zero Export To CT",
    sell_power: 2000,
    discharge_current: 60,
    charge_current: 70,
    grid_charge_current: 10,
    tou_soc: 25,
  };
  assertEqual(card.normalProfileMode(), "Zero Export To CT", "CT must remain visible while pending");
}

// 11. Aktualizacja hass otwartego okna synchronizuje formularz.
{
  const card = makeCard({
    managerStatus: {
      state: "idle",
      attributes: {
        normal_profile: { physical_work_mode: "Zero Export To Load", tou_soc: 0 },
      },
    },
    modeEntity: { state: "Zero Export To Load", attributes: {} },
    touSocEntity: { state: "0", attributes: {} },
  });
  card._dialog = { type: "settings" };
  card._normalProfilePending = {
    physical_work_mode: "Zero Export To CT",
    sell_power: 2000,
    discharge_current: 60,
    charge_current: 70,
    grid_charge_current: 10,
    tou_soc: 25,
  };
  const modeSelect = fakeSelect("Zero Export To Load");
  const inputs = {
    sell_power: fakeInput("sell_power", "1000"),
    discharge_current: fakeInput("discharge_current", "50"),
    charge_current: fakeInput("charge_current", "50"),
    grid_charge_current: fakeInput("grid_charge_current", "10"),
    tou_soc: fakeInput("tou_soc", "0"),
  };
  card.querySelector = (selector) => {
    if (selector === '[data-raw="normal-profile-mode"]') return modeSelect;
    return null;
  };
  card.querySelectorAll = (selector) => {
    if (selector === "[data-normal-profile-number]") return Object.values(inputs);
    return [];
  };
  card._isRendered = true;
  card.updateDynamicValues();
  assertEqual(modeSelect.value, "Zero Export To CT", "sync must update mode select to pending CT");
  assertEqual(inputs.tou_soc.value, "25", "sync must update tou_soc input to pending 25");
  assertEqual(inputs.sell_power.value, "2000", "sync must update sell_power input to pending value");
}

// 12. Synchronizacja nie usuwa aktywnego szkicu użytkownika.
{
  const card = makeCard({
    managerStatus: {
      state: "idle",
      attributes: {
        normal_profile: { physical_work_mode: "Zero Export To Load", tou_soc: 0 },
      },
    },
    touSocEntity: { state: "0", attributes: {} },
  });
  card._dialog = { type: "settings" };
  card._normalProfileDraft.tou_soc = "30";
  card._normalProfilePending = { physical_work_mode: "Zero Export To CT", sell_power: 2000, discharge_current: 60, charge_current: 70, grid_charge_current: 10, tou_soc: 25 };
  const inputs = { tou_soc: fakeInput("tou_soc", "30") };
  card.querySelector = () => null;
  card.querySelectorAll = (selector) => (selector === "[data-normal-profile-number]" ? [inputs.tou_soc] : []);
  card._isRendered = true;
  card.updateDynamicValues();
  assertEqual(inputs.tou_soc.value, "30", "sync must preserve user draft value 30");
}

// 13-15. saveNormalProfile używa wyłącznie save_normal_profile (sprawdzone w teście 7).
// Nie ma tu bezpośrednich zapisów do falownika ani nadpisywania slotów, ponieważ usługa
// save_normal_profile jest jedynym wywołaniem (patrz test 7).

setTimeout(() => {
  if (failures) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("All normal profile card behavior tests passed");
  process.exit(0);
}, 50);
