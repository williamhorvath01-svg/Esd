/**
 * Main application controller.
 * Wires together location, filters, plant display, and export modules.
 */
(function () {
  "use strict";

  let allPlants = [];
  let schema = {};
  let unitSystem = "imperial";

  // ---- Initialization ----

  async function init() {
    setupEventListeners();
    await loadData();
  }

  async function loadData() {
    const grid = document.getElementById("plant-grid");
    grid.innerHTML = `
      <div class="loading-state" style="grid-column:1/-1">
        <div class="loading-spinner"></div>
        <p>Loading plants from Notion...</p>
      </div>
    `;

    try {
      // Fetch schema and plants in parallel
      const [schemaRes, plantsRes] = await Promise.all([
        fetch("/api/notion-schema"),
        fetch("/api/notion-plants"),
      ]);

      if (!schemaRes.ok || !plantsRes.ok) {
        const err = !schemaRes.ok
          ? await schemaRes.json().catch(() => ({}))
          : await plantsRes.json().catch(() => ({}));
        throw new Error(err.error || `API returned ${schemaRes.status || plantsRes.status}`);
      }

      const schemaData = await schemaRes.json();
      const plantsData = await plantsRes.json();

      schema = schemaData.schema || {};
      allPlants = plantsData.plants || [];

      // Initialize modules
      FilterModule.setSchema(schema);
      FilterModule.setPlants(allPlants);
      FilterModule.setUnitSystem(unitSystem);
      FilterModule.buildFilters("filter-container");
      FilterModule.setOnFilterChange(applyAllFilters);

      PlantModule.init(allPlants, schema);

      document.getElementById("results-count").innerHTML =
        `Showing <strong>${allPlants.length}</strong> of <strong>${allPlants.length}</strong> plants`;

    } catch (err) {
      console.error("Failed to load data:", err);
      grid.innerHTML = `
        <div class="error-state" style="grid-column:1/-1">
          <p><strong>Failed to load plant data</strong></p>
          <p style="font-size:0.85rem;margin-top:0.5rem">${escapeHtml(err.message)}</p>
          <p style="font-size:0.8rem;margin-top:1rem;color:#6b7280">
            Make sure your Notion API key and Database ID are configured in the Netlify environment variables.
          </p>
          <button class="btn btn-primary" onclick="location.reload()" style="margin-top:1rem">Retry</button>
        </div>
      `;
    }
  }

  function applyAllFilters() {
    const filtered = FilterModule.applyFilters(allPlants);
    PlantModule.setFilteredPlants(filtered);
  }

  // ---- Event Listeners ----

  function setupEventListeners() {
    // Unit toggle
    document.getElementById("btn-imperial").addEventListener("click", () => setUnit("imperial"));
    document.getElementById("btn-metric").addEventListener("click", () => setUnit("metric"));

    // Location lookup
    document.getElementById("location-btn").addEventListener("click", lookupLocation);
    document.getElementById("location-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") lookupLocation();
    });

    // Search
    const searchInput = document.getElementById("search-input");
    let searchTimer;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        PlantModule.setSearch(searchInput.value.trim());
        applyAllFilters();
      }, 250);
    });

    // View toggle
    document.getElementById("view-grid").addEventListener("click", () => {
      document.getElementById("view-grid").classList.add("active");
      document.getElementById("view-list").classList.remove("active");
      PlantModule.setView("grid");
    });
    document.getElementById("view-list").addEventListener("click", () => {
      document.getElementById("view-list").classList.add("active");
      document.getElementById("view-grid").classList.remove("active");
      PlantModule.setView("list");
    });

    // Clear all filters
    document.getElementById("clear-all-filters").addEventListener("click", () => {
      FilterModule.clearAll();
      document.getElementById("search-input").value = "";
      PlantModule.setSearch("");
    });

    // Export
    document.getElementById("btn-export-pdf").addEventListener("click", () => {
      const plants = PlantModule.getFilteredPlants();
      if (!plants.length) {
        alert("No plants to export. Adjust your filters first.");
        return;
      }
      ExportModule.exportPDF(plants, schema, unitSystem);
    });

    document.getElementById("btn-export-xlsx").addEventListener("click", () => {
      const plants = PlantModule.getFilteredPlants();
      if (!plants.length) {
        alert("No plants to export. Adjust your filters first.");
        return;
      }
      ExportModule.exportXLSX(plants, schema, unitSystem);
    });

    // Modal close
    document.getElementById("modal-close").addEventListener("click", PlantModule.hideModal);
    document.getElementById("modal-overlay").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) PlantModule.hideModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") PlantModule.hideModal();
    });
  }

  function setUnit(unit) {
    unitSystem = unit;
    document.getElementById("btn-imperial").classList.toggle("active", unit === "imperial");
    document.getElementById("btn-metric").classList.toggle("active", unit === "metric");
    FilterModule.setUnitSystem(unit);
    PlantModule.setUnit(unit);
    updateLocationDisplay();
  }

  // ---- Location ----

  async function lookupLocation() {
    const input = document.getElementById("location-input");
    const btn = document.getElementById("location-btn");
    const errorEl = document.getElementById("location-error");
    const resultsEl = document.getElementById("location-results");

    const query = input.value.trim();
    if (!query) {
      errorEl.textContent = "Please enter a location.";
      errorEl.classList.add("visible");
      return;
    }

    btn.disabled = true;
    btn.textContent = "Looking up...";
    errorEl.classList.remove("visible");
    resultsEl.classList.remove("visible");

    try {
      await LocationModule.lookup(query);
      updateLocationDisplay();
      resultsEl.classList.add("visible");
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.add("visible");
    } finally {
      btn.disabled = false;
      btn.textContent = "Look Up";
    }
  }

  function updateLocationDisplay() {
    const data = LocationModule.getData();
    if (!data) return;

    document.getElementById("loc-zone").textContent = data.zone;
    document.getElementById("loc-zone-detail").textContent =
      unitSystem === "imperial"
        ? `Min temp: ${data.zoneMinF}°F`
        : `Min temp: ${data.zoneMinC}°C`;

    document.getElementById("loc-biome").textContent = data.biome;

    document.getElementById("loc-chill").textContent = `${data.chillHours} hrs`;
    document.getElementById("loc-chill-detail").textContent = "Estimated annual";

    document.getElementById("loc-gdd").textContent =
      unitSystem === "imperial"
        ? `${data.gddF}`
        : `${data.gddC}`;
    document.getElementById("loc-gdd-detail").textContent =
      unitSystem === "imperial"
        ? "°F base 50"
        : "°C base 10";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Start ----
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
