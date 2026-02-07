/**
 * Plant display module.
 * Handles rendering plant cards (grid/list), detail modal, search, pagination.
 */
const PlantModule = (() => {
  let allPlants = [];
  let filteredPlants = [];
  let displayedPlants = [];
  let schema = {};
  let unitSystem = "imperial";
  let viewMode = "grid";
  let currentPage = 1;
  const PAGE_SIZE = 24;
  let searchQuery = "";

  // Heuristic: property names that likely hold the "name" of the plant
  const NAME_KEYS = ["name", "common name", "plant name", "title"];
  const SCIENTIFIC_KEYS = ["scientific name", "botanical name", "latin name", "species"];
  const IMAGE_KEYS = ["image", "photo", "picture", "thumbnail", "cover", "images", "photos"];

  function findPropByKeys(properties, keys) {
    for (const key of keys) {
      for (const propName of Object.keys(properties)) {
        if (propName.toLowerCase().trim() === key) return propName;
      }
    }
    // Fuzzy
    for (const key of keys) {
      for (const propName of Object.keys(properties)) {
        if (propName.toLowerCase().includes(key)) return propName;
      }
    }
    return null;
  }

  function getTitleProp() {
    for (const [name, info] of Object.entries(schema)) {
      if (info.type === "title") return name;
    }
    return null;
  }

  function getPlantName(plant) {
    const titleProp = getTitleProp();
    if (titleProp && plant.properties[titleProp]) return plant.properties[titleProp];
    const nameProp = findPropByKeys(plant.properties, NAME_KEYS);
    if (nameProp) return plant.properties[nameProp] || "Unnamed Plant";
    return "Unnamed Plant";
  }

  function getScientificName(plant) {
    const prop = findPropByKeys(plant.properties, SCIENTIFIC_KEYS);
    return prop ? plant.properties[prop] || "" : "";
  }

  function getImageUrl(plant) {
    // Check cover image first
    if (plant.cover) return plant.cover;
    // Check image property
    const prop = findPropByKeys(plant.properties, IMAGE_KEYS);
    if (prop) {
      const val = plant.properties[prop];
      if (Array.isArray(val) && val.length) return val[0];
      if (typeof val === "string" && val.startsWith("http")) return val;
    }
    return null;
  }

  /**
   * Identify key display properties for cards (not name/scientific/image).
   */
  function getCardProps(plant) {
    const titleProp = getTitleProp();
    const sciProp = findPropByKeys(plant.properties, SCIENTIFIC_KEYS);
    const imgProp = findPropByKeys(plant.properties, IMAGE_KEYS);
    const skip = new Set([titleProp, sciProp, imgProp].filter(Boolean));

    const props = [];
    const priorityKeys = ["hardiness zone", "zone", "type", "crop type", "height", "light", "sun", "solar access"];

    for (const key of priorityKeys) {
      for (const propName of Object.keys(plant.properties)) {
        if (skip.has(propName)) continue;
        if (propName.toLowerCase().includes(key)) {
          const val = plant.properties[propName];
          if (val != null && val !== "" && (!Array.isArray(val) || val.length)) {
            props.push({ label: propName, value: formatValue(val, propName) });
            skip.add(propName);
          }
          break;
        }
      }
      if (props.length >= 4) break;
    }

    return props;
  }

  function getCardTags(plant) {
    const tags = [];
    for (const [propName, val] of Object.entries(plant.properties)) {
      if (Array.isArray(val) && val.length && val.length <= 5 && typeof val[0] === "string") {
        tags.push(...val.slice(0, 3));
      }
      if (tags.length >= 4) break;
    }
    return tags.slice(0, 4);
  }

  function formatValue(val, propName) {
    if (val == null) return "—";
    if (Array.isArray(val)) return val.join(", ");
    if (typeof val === "boolean") return val ? "Yes" : "No";
    if (typeof val === "number") {
      return formatNumber(val, propName);
    }
    return String(val);
  }

  function formatNumber(val, propName) {
    const lower = (propName || "").toLowerCase();
    // Height/width: assume stored in a standard unit
    if (lower.includes("height") || lower.includes("width") || lower.includes("spread")) {
      if (unitSystem === "metric") {
        // Assume stored in feet, convert to meters
        return `${Math.round(val * 0.3048 * 10) / 10} m`;
      }
      return `${val} ft`;
    }
    if (lower.includes("gdd") || lower.includes("growing degree")) {
      if (unitSystem === "metric") return `${val} GDD (°C)`;
      return `${Math.round(val * 9 / 5)} GDD (°F)`;
    }
    if (lower.includes("chill") && lower.includes("hour")) {
      return `${val} hrs`;
    }
    if (lower.includes("ph")) {
      return val.toFixed(1);
    }
    return String(val);
  }

  /**
   * Format a property value for the detail modal, showing both unit systems.
   */
  function formatModalValue(val, propName, propType) {
    if (val == null || val === "") return { primary: "—" };

    if (Array.isArray(val)) {
      if (val.length === 0) return { primary: "—" };
      // Check if URLs
      if (typeof val[0] === "string" && val[0].startsWith("http")) {
        return {
          primary: val
            .map((v, i) => `<a href="${escapeHtml(v)}" target="_blank" rel="noopener">Link ${i + 1}</a>`)
            .join(", "),
        };
      }
      return { primary: val.join(", "), isArray: true };
    }

    if (typeof val === "boolean") return { primary: val ? "Yes" : "No" };

    if (typeof val === "string" && val.startsWith("http")) {
      return { primary: `<a href="${escapeHtml(val)}" target="_blank" rel="noopener">${escapeHtml(val)}</a>` };
    }

    if (typeof val === "number") {
      return formatModalNumber(val, propName);
    }

    return { primary: escapeHtml(String(val)) };
  }

  function formatModalNumber(val, propName) {
    const lower = (propName || "").toLowerCase();

    if (lower.includes("height") || lower.includes("width") || lower.includes("spread")) {
      const ft = val;
      const m = Math.round(val * 0.3048 * 10) / 10;
      return {
        primary: unitSystem === "imperial" ? `${ft} ft` : `${m} m`,
        secondary: unitSystem === "imperial" ? `${m} m` : `${ft} ft`,
      };
    }

    if (lower.includes("gdd") || lower.includes("growing degree")) {
      const gddF = Math.round(val * 9 / 5);
      return {
        primary: unitSystem === "imperial" ? `${gddF} GDD (°F base 50)` : `${val} GDD (°C base 10)`,
        secondary: unitSystem === "imperial" ? `${val} GDD (°C base 10)` : `${gddF} GDD (°F base 50)`,
      };
    }

    if (lower.includes("chill") && lower.includes("hour")) {
      return { primary: `${val} hours` };
    }

    if (lower.includes("temp")) {
      const c = val;
      const f = Math.round(c * 9 / 5 + 32);
      return {
        primary: unitSystem === "imperial" ? `${f}°F` : `${c}°C`,
        secondary: unitSystem === "imperial" ? `${c}°C` : `${f}°F`,
      };
    }

    if (lower.includes("ph")) {
      return { primary: val.toFixed(1) };
    }

    if (lower.includes("precip") || lower.includes("rain")) {
      const mm = val;
      const inches = Math.round(val / 25.4 * 10) / 10;
      return {
        primary: unitSystem === "imperial" ? `${inches} in` : `${mm} mm`,
        secondary: unitSystem === "imperial" ? `${mm} mm` : `${inches} in`,
      };
    }

    return { primary: String(val) };
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Rendering ----

  function renderGrid() {
    const grid = document.getElementById("plant-grid");
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    displayedPlants = filteredPlants.slice(start, end);

    if (filteredPlants.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
          <p>No plants match your current filters.</p>
          <p style="font-size:0.85rem">Try adjusting or clearing some filters.</p>
        </div>
      `;
      renderPagination();
      return;
    }

    grid.innerHTML = displayedPlants.map((plant) => {
      const name = getPlantName(plant);
      const sci = getScientificName(plant);
      const imgUrl = getImageUrl(plant);
      const tags = getCardTags(plant);
      const props = getCardProps(plant);

      return `
        <div class="plant-card" data-id="${plant.id}">
          <div class="plant-card-cover">
            ${imgUrl
              ? `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(name)}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=placeholder-icon>&#127793;</div>'">`
              : '<div class="placeholder-icon">&#127793;</div>'
            }
          </div>
          <div class="plant-card-body">
            <div class="plant-card-name">${escapeHtml(name)}</div>
            ${sci ? `<div class="plant-card-scientific">${escapeHtml(sci)}</div>` : ""}
            ${tags.length ? `<div class="plant-card-tags">${tags.map((t) => `<span class="plant-tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}
            ${props.length ? `<div class="plant-card-props">${props.map((p) => `<span class="plant-card-prop"><strong>${escapeHtml(p.label)}:</strong> ${escapeHtml(p.value)}</span>`).join("")}</div>` : ""}
          </div>
        </div>
      `;
    }).join("");

    // Click handlers
    grid.querySelectorAll(".plant-card").forEach((card) => {
      card.addEventListener("click", () => {
        const plant = allPlants.find((p) => p.id === card.dataset.id);
        if (plant) showModal(plant);
      });
    });

    renderPagination();
  }

  function renderPagination() {
    const container = document.getElementById("pagination");
    const totalPages = Math.ceil(filteredPlants.length / PAGE_SIZE);

    if (totalPages <= 1) {
      container.innerHTML = "";
      return;
    }

    let html = `<button ${currentPage === 1 ? "disabled" : ""} data-page="${currentPage - 1}">&laquo; Prev</button>`;

    const maxButtons = 7;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage < maxButtons - 1) {
      startPage = Math.max(1, endPage - maxButtons + 1);
    }

    if (startPage > 1) {
      html += `<button data-page="1">1</button>`;
      if (startPage > 2) html += `<button disabled>...</button>`;
    }

    for (let p = startPage; p <= endPage; p++) {
      html += `<button data-page="${p}" class="${p === currentPage ? "active" : ""}">${p}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) html += `<button disabled>...</button>`;
      html += `<button data-page="${totalPages}">${totalPages}</button>`;
    }

    html += `<button ${currentPage === totalPages ? "disabled" : ""} data-page="${currentPage + 1}">Next &raquo;</button>`;

    container.innerHTML = html;
    container.querySelectorAll("button[data-page]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const page = parseInt(btn.dataset.page);
        if (page >= 1 && page <= totalPages) {
          currentPage = page;
          renderGrid();
          document.getElementById("plant-grid").scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
  }

  function showModal(plant) {
    const overlay = document.getElementById("modal-overlay");
    const coverEl = document.getElementById("modal-cover");
    const bodyEl = document.getElementById("modal-body");

    const name = getPlantName(plant);
    const sci = getScientificName(plant);
    const imgUrl = getImageUrl(plant);

    if (imgUrl) {
      coverEl.innerHTML = `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(name)}" onerror="this.parentElement.innerHTML='<div class=placeholder-icon>&#127793;</div>'">`;
    } else {
      coverEl.innerHTML = '<div class="placeholder-icon">&#127793;</div>';
    }

    const titleProp = getTitleProp();
    const unitLabel = unitSystem === "imperial" ? "Imperial (secondary: Metric)" : "Metric (secondary: Imperial)";

    let propsHtml = "";
    for (const [propName, val] of Object.entries(plant.properties)) {
      if (propName === titleProp) continue;
      const propType = plant.propertyTypes?.[propName] || schema[propName]?.type || "unknown";
      const formatted = formatModalValue(val, propName, propType);

      propsHtml += `
        <div class="modal-prop">
          <span class="modal-prop-label">${escapeHtml(propName)}</span>
          ${formatted.isArray
            ? `<div class="modal-prop-tags">${(Array.isArray(val) ? val : [val]).map((v) => `<span class="plant-tag">${escapeHtml(String(v))}</span>`).join("")}</div>`
            : `<span class="modal-prop-value">${formatted.primary}</span>`
          }
          ${formatted.secondary ? `<span class="modal-prop-value imperial">${formatted.secondary}</span>` : ""}
        </div>
      `;
    }

    bodyEl.innerHTML = `
      <h2 class="modal-title">${escapeHtml(name)}</h2>
      ${sci ? `<p class="modal-scientific">${escapeHtml(sci)}</p>` : ""}
      <div class="modal-unit-note">Displaying in <strong>${unitLabel}</strong>. Use the toggle in the header to switch.</div>
      <div class="modal-properties">${propsHtml}</div>
    `;

    overlay.classList.add("visible");
    document.body.style.overflow = "hidden";
  }

  function hideModal() {
    document.getElementById("modal-overlay").classList.remove("visible");
    document.body.style.overflow = "";
  }

  // ---- Public API ----

  function init(plants, s) {
    allPlants = plants;
    schema = s;
    filteredPlants = [...plants];
    currentPage = 1;
    renderGrid();
    updateResultsCount();
  }

  function setFilteredPlants(plants) {
    // Also apply text search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filteredPlants = plants.filter((p) => {
        const name = getPlantName(p).toLowerCase();
        const sci = getScientificName(p).toLowerCase();
        return name.includes(q) || sci.includes(q);
      });
    } else {
      filteredPlants = plants;
    }
    currentPage = 1;
    renderGrid();
    updateResultsCount();
  }

  function setSearch(query) {
    searchQuery = query;
  }

  function setUnit(unit) {
    unitSystem = unit;
    renderGrid();
  }

  function setView(mode) {
    viewMode = mode;
    const grid = document.getElementById("plant-grid");
    if (mode === "list") {
      grid.classList.add("list-view");
    } else {
      grid.classList.remove("list-view");
    }
  }

  function updateResultsCount() {
    const el = document.getElementById("results-count");
    el.innerHTML = `Showing <strong>${filteredPlants.length}</strong> of <strong>${allPlants.length}</strong> plants`;
  }

  function getFilteredPlants() {
    return filteredPlants;
  }

  function getAllPlants() {
    return allPlants;
  }

  function getSchema() {
    return schema;
  }

  function getPlantNameFn(plant) {
    return getPlantName(plant);
  }

  return {
    init,
    setFilteredPlants,
    setSearch,
    setUnit,
    setView,
    hideModal,
    getFilteredPlants,
    getAllPlants,
    getSchema,
    getPlantName: getPlantNameFn,
    renderGrid,
    updateResultsCount,
  };
})();
