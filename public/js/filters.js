/**
 * Filter system module.
 * Dynamically builds filter UI from Notion database schema and manages filter state.
 * Filter categories:
 *   - Climate: Hardiness Zone, Biome, Chill Hours, Growing Degree Days
 *   - Soil: Soil Type, pH, Moisture
 *   - Light: Solar Access
 *   - Structure: Height, Width
 *   - Growth: Crop Type, Features, Function, and remaining properties
 */
const FilterModule = (() => {
  let schema = {};
  let allPlants = [];
  let activeFilters = {};
  let onFilterChange = null;
  let unitSystem = "imperial";

  // Canonical category mapping (case-insensitive property name -> category)
  const CATEGORY_MAP = {
    // Climate
    "hardiness zone": "climate",
    "hardiness zones": "climate",
    "zone": "climate",
    "biome": "climate",
    "biomes": "climate",
    "chill hours": "climate",
    "chilling hours": "climate",
    "growing degree days": "climate",
    "gdd": "climate",
    // Soil
    "soil type": "soil",
    "soil types": "soil",
    "soil": "soil",
    "ph": "soil",
    "soil ph": "soil",
    "moisture": "soil",
    "soil moisture": "soil",
    "water needs": "soil",
    "water": "soil",
    "drainage": "soil",
    // Light
    "light": "light",
    "sun": "light",
    "solar access": "light",
    "sun exposure": "light",
    "sunlight": "light",
    "light requirements": "light",
    // Structure
    "height": "structure",
    "width": "structure",
    "spread": "structure",
    "max height": "structure",
    "max width": "structure",
    "mature height": "structure",
    "mature width": "structure",
    "size": "structure",
    // Growth
    "crop type": "growth",
    "type": "growth",
    "features": "growth",
    "feature": "growth",
    "function": "growth",
    "functions": "growth",
    "growth rate": "growth",
    "growth habit": "growth",
    "edible": "growth",
    "native": "growth",
    "native range": "growth",
    "bloom time": "growth",
    "bloom color": "growth",
    "fruit": "growth",
    "leaf type": "growth",
    "foliage": "growth",
    "pollinator": "growth",
    "wildlife": "growth",
  };

  const CATEGORY_ORDER = ["climate", "soil", "light", "structure", "growth", "other"];
  const CATEGORY_LABELS = {
    climate: "Climate",
    soil: "Soil",
    light: "Light",
    structure: "Structure",
    growth: "Growth",
    other: "Other Properties",
  };

  // Properties to skip in filters (internal Notion fields or the title field)
  const SKIP_PROPS = new Set(["created_time", "last_edited_time", "created_by", "last_edited_by"]);

  function categorize(propName) {
    const lower = propName.toLowerCase().trim();
    if (CATEGORY_MAP[lower]) return CATEGORY_MAP[lower];

    // Fuzzy match: check if the property name contains a known keyword
    for (const [keyword, cat] of Object.entries(CATEGORY_MAP)) {
      if (lower.includes(keyword) || keyword.includes(lower)) return cat;
    }
    return "other";
  }

  function setSchema(s) { schema = s; }
  function setPlants(p) { allPlants = p; }
  function setUnitSystem(u) { unitSystem = u; }
  function setOnFilterChange(fn) { onFilterChange = fn; }

  /**
   * Extract unique values for a property from all plants.
   */
  function getUniqueValues(propName) {
    const values = new Set();
    for (const plant of allPlants) {
      const val = plant.properties[propName];
      if (val == null) continue;
      if (Array.isArray(val)) {
        val.forEach((v) => { if (v) values.add(String(v)); });
      } else {
        values.add(String(val));
      }
    }
    return [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  /**
   * Get numeric range for a property.
   */
  function getNumericRange(propName) {
    let min = Infinity, max = -Infinity;
    for (const plant of allPlants) {
      const val = plant.properties[propName];
      if (typeof val === "number") {
        if (val < min) min = val;
        if (val > max) max = val;
      }
    }
    return min <= max ? { min, max } : null;
  }

  /**
   * Build the filter UI and insert into the DOM.
   */
  function buildFilters(containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";

    // Organize properties into categories
    const categories = {};
    for (const cat of CATEGORY_ORDER) {
      categories[cat] = [];
    }

    // Find the title property to exclude from filters
    let titleProp = null;
    for (const [name, info] of Object.entries(schema)) {
      if (info.type === "title") { titleProp = name; break; }
    }

    for (const [name, info] of Object.entries(schema)) {
      if (name === titleProp) continue;
      if (SKIP_PROPS.has(info.type)) continue;

      const cat = categorize(name);
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push({ name, ...info });
    }

    for (const cat of CATEGORY_ORDER) {
      const props = categories[cat];
      if (!props || !props.length) continue;

      const section = document.createElement("div");
      section.className = "filter-section";
      if (cat === "other") section.classList.add("collapsed");

      section.innerHTML = `
        <div class="filter-section-header" data-category="${cat}">
          ${CATEGORY_LABELS[cat]}
          <span class="chevron">&#9660;</span>
        </div>
        <div class="filter-section-body" id="filters-${cat}"></div>
      `;

      const body = section.querySelector(".filter-section-body");

      for (const prop of props) {
        const group = buildFilterGroup(prop);
        if (group) body.appendChild(group);
      }

      container.appendChild(section);

      // Toggle collapse
      section.querySelector(".filter-section-header").addEventListener("click", () => {
        section.classList.toggle("collapsed");
      });
    }
  }

  function buildFilterGroup(prop) {
    const { name, type } = prop;
    const group = document.createElement("div");
    group.className = "filter-group";
    group.dataset.property = name;

    if (type === "select" || type === "status") {
      const options = prop.options
        ? prop.options.map((o) => o.name)
        : getUniqueValues(name);
      if (!options.length) return null;

      group.innerHTML = `<label>${name}</label>`;
      const chipContainer = document.createElement("div");
      chipContainer.className = "chip-container";
      for (const opt of options) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = opt;
        chip.dataset.value = opt;
        chip.addEventListener("click", () => {
          chip.classList.toggle("selected");
          updateFilterState(name, getSelectedChips(chipContainer));
        });
        chipContainer.appendChild(chip);
      }
      group.appendChild(chipContainer);

    } else if (type === "multi_select") {
      const options = prop.options
        ? prop.options.map((o) => o.name)
        : getUniqueValues(name);
      if (!options.length) return null;

      group.innerHTML = `<label>${name}</label>`;
      const chipContainer = document.createElement("div");
      chipContainer.className = "chip-container";
      for (const opt of options) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = opt;
        chip.dataset.value = opt;
        chip.addEventListener("click", () => {
          chip.classList.toggle("selected");
          updateFilterState(name, getSelectedChips(chipContainer));
        });
        chipContainer.appendChild(chip);
      }
      group.appendChild(chipContainer);

    } else if (type === "number") {
      const range = getNumericRange(name);
      if (!range) return null;

      group.innerHTML = `
        <label>${name}</label>
        <div class="range-slider">
          <input type="number" class="range-min" placeholder="${range.min}" data-prop="${name}" step="any">
          <span class="range-sep">to</span>
          <input type="number" class="range-max" placeholder="${range.max}" data-prop="${name}" step="any">
        </div>
      `;

      const debounced = debounce(() => {
        const minVal = group.querySelector(".range-min").value;
        const maxVal = group.querySelector(".range-max").value;
        updateFilterState(name, {
          min: minVal !== "" ? parseFloat(minVal) : null,
          max: maxVal !== "" ? parseFloat(maxVal) : null,
        });
      }, 300);

      group.querySelector(".range-min").addEventListener("input", debounced);
      group.querySelector(".range-max").addEventListener("input", debounced);

    } else if (type === "checkbox") {
      group.innerHTML = `
        <label>${name}</label>
        <div class="chip-container">
          <span class="chip" data-value="true">Yes</span>
          <span class="chip" data-value="false">No</span>
        </div>
      `;
      const chips = group.querySelectorAll(".chip");
      chips.forEach((chip) => {
        chip.addEventListener("click", () => {
          // Toggle: deselect if clicking the active one
          const wasSelected = chip.classList.contains("selected");
          chips.forEach((c) => c.classList.remove("selected"));
          if (!wasSelected) {
            chip.classList.add("selected");
            updateFilterState(name, chip.dataset.value === "true");
          } else {
            updateFilterState(name, null);
          }
        });
      });

    } else if (type === "rich_text" || type === "url" || type === "email" || type === "phone_number") {
      // Text search filter
      const values = getUniqueValues(name);
      if (!values.length && type === "rich_text") return null;

      group.innerHTML = `
        <label>${name}</label>
        <input type="text" placeholder="Filter ${name}..." data-prop="${name}">
      `;

      const input = group.querySelector("input");
      const debouncedText = debounce(() => {
        updateFilterState(name, input.value.trim() || null);
      }, 300);
      input.addEventListener("input", debouncedText);

    } else {
      // For formula, rollup, relation, date, files, etc. — try chips from unique values
      const values = getUniqueValues(name);
      if (!values.length) return null;

      // If there are few options (< 30), show chips; otherwise show a select
      if (values.length <= 30) {
        group.innerHTML = `<label>${name}</label>`;
        const chipContainer = document.createElement("div");
        chipContainer.className = "chip-container";
        for (const val of values) {
          const chip = document.createElement("span");
          chip.className = "chip";
          chip.textContent = val;
          chip.dataset.value = val;
          chip.addEventListener("click", () => {
            chip.classList.toggle("selected");
            updateFilterState(name, getSelectedChips(chipContainer));
          });
          chipContainer.appendChild(chip);
        }
        group.appendChild(chipContainer);
      } else {
        group.innerHTML = `
          <label>${name}</label>
          <select data-prop="${name}">
            <option value="">All</option>
            ${values.map((v) => `<option value="${v}">${v}</option>`).join("")}
          </select>
        `;
        group.querySelector("select").addEventListener("change", (e) => {
          updateFilterState(name, e.target.value || null);
        });
      }
    }

    return group;
  }

  function getSelectedChips(container) {
    const selected = [...container.querySelectorAll(".chip.selected")].map(
      (c) => c.dataset.value
    );
    return selected.length ? selected : null;
  }

  function updateFilterState(propName, value) {
    if (value === null || (Array.isArray(value) && !value.length) ||
        (typeof value === "object" && !Array.isArray(value) && value.min == null && value.max == null)) {
      delete activeFilters[propName];
    } else {
      activeFilters[propName] = value;
    }
    if (onFilterChange) onFilterChange();
  }

  /**
   * Apply all active filters to the plant list.
   */
  function applyFilters(plants) {
    if (Object.keys(activeFilters).length === 0) return plants;

    return plants.filter((plant) => {
      for (const [propName, filterVal] of Object.entries(activeFilters)) {
        const plantVal = plant.properties[propName];

        if (Array.isArray(filterVal)) {
          // Multi-select / chip filter: plant value must match at least one selected
          if (Array.isArray(plantVal)) {
            // Plant has array: check intersection
            const match = filterVal.some((fv) =>
              plantVal.some((pv) => String(pv).toLowerCase() === fv.toLowerCase())
            );
            if (!match) return false;
          } else {
            // Plant has single value
            if (!filterVal.some((fv) => String(plantVal).toLowerCase() === fv.toLowerCase())) {
              return false;
            }
          }
        } else if (typeof filterVal === "object" && filterVal !== null && ("min" in filterVal || "max" in filterVal)) {
          // Range filter
          const num = typeof plantVal === "number" ? plantVal : parseFloat(plantVal);
          if (isNaN(num)) return false;
          if (filterVal.min != null && num < filterVal.min) return false;
          if (filterVal.max != null && num > filterVal.max) return false;
        } else if (typeof filterVal === "boolean") {
          if (plantVal !== filterVal) return false;
        } else if (typeof filterVal === "string") {
          // Text search
          const pStr = Array.isArray(plantVal) ? plantVal.join(" ") : String(plantVal || "");
          if (!pStr.toLowerCase().includes(filterVal.toLowerCase())) return false;
        }
      }
      return true;
    });
  }

  function clearAll() {
    activeFilters = {};
    const container = document.getElementById("filter-container");
    container.querySelectorAll(".chip.selected").forEach((c) => c.classList.remove("selected"));
    container.querySelectorAll("input").forEach((i) => { i.value = ""; });
    container.querySelectorAll("select").forEach((s) => { s.value = ""; });
    if (onFilterChange) onFilterChange();
  }

  function getActiveFilters() {
    return { ...activeFilters };
  }

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  return {
    setSchema,
    setPlants,
    setUnitSystem,
    setOnFilterChange,
    buildFilters,
    applyFilters,
    clearAll,
    getActiveFilters,
  };
})();
