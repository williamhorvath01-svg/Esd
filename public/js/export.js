/**
 * Export module.
 * Supports exporting filtered plant data as PDF or XLSX spreadsheet.
 */
const ExportModule = (() => {
  function getExportData(plants, schema, unitSystem) {
    // Build header row from all property names
    const propNames = Object.keys(schema);
    const rows = [];

    for (const plant of plants) {
      const row = {};
      for (const propName of propNames) {
        const val = plant.properties[propName];
        row[propName] = formatExportValue(val, propName, unitSystem);
      }
      rows.push(row);
    }

    return { propNames, rows };
  }

  function formatExportValue(val, propName, unitSystem) {
    if (val == null || val === "") return "";
    if (Array.isArray(val)) return val.join(", ");
    if (typeof val === "boolean") return val ? "Yes" : "No";
    if (typeof val === "number") {
      const lower = propName.toLowerCase();
      if (lower.includes("height") || lower.includes("width") || lower.includes("spread")) {
        if (unitSystem === "metric") return `${Math.round(val * 0.3048 * 10) / 10} m`;
        return `${val} ft`;
      }
      if (lower.includes("temp")) {
        if (unitSystem === "metric") return `${val}°C`;
        return `${Math.round(val * 9 / 5 + 32)}°F`;
      }
      return String(val);
    }
    return String(val);
  }

  function exportPDF(plants, schema, unitSystem) {
    const { jsPDF } = window.jspdf;
    if (!jsPDF) {
      alert("PDF library not loaded. Please try again.");
      return;
    }

    const { propNames, rows } = getExportData(plants, schema, unitSystem);

    // Select key columns for PDF (too many columns won't fit)
    const maxCols = 8;
    const selectedProps = selectKeyProperties(propNames, schema, maxCols);

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    doc.setFontSize(16);
    doc.setTextColor(45, 106, 79);
    doc.text("Plant Finder - Export", 14, 15);

    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text(
      `${plants.length} plants | ${unitSystem === "imperial" ? "Imperial" : "Metric"} units | Exported ${new Date().toLocaleDateString()}`,
      14, 22
    );

    const tableHeaders = selectedProps.map((p) => ({ header: p, dataKey: p }));
    const tableData = rows.map((row) => {
      const obj = {};
      for (const p of selectedProps) {
        obj[p] = row[p] || "";
      }
      return obj;
    });

    doc.autoTable({
      columns: tableHeaders,
      body: tableData,
      startY: 28,
      styles: {
        fontSize: 7,
        cellPadding: 2,
        overflow: "linebreak",
        lineWidth: 0.1,
      },
      headStyles: {
        fillColor: [45, 106, 79],
        textColor: 255,
        fontStyle: "bold",
        fontSize: 7,
      },
      alternateRowStyles: {
        fillColor: [248, 250, 249],
      },
      margin: { top: 28, left: 10, right: 10 },
      didDrawPage: (data) => {
        // Footer
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text(
          `Page ${doc.internal.getCurrentPageInfo().pageNumber}`,
          data.settings.margin.left,
          doc.internal.pageSize.height - 8
        );
      },
    });

    doc.save("plant-finder-export.pdf");
  }

  function exportXLSX(plants, schema, unitSystem) {
    if (!window.XLSX) {
      alert("Spreadsheet library not loaded. Please try again.");
      return;
    }

    const { propNames, rows } = getExportData(plants, schema, unitSystem);

    // Build worksheet data
    const wsData = [propNames]; // header row
    for (const row of rows) {
      wsData.push(propNames.map((p) => row[p] || ""));
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    ws["!cols"] = propNames.map((name) => ({
      wch: Math.min(Math.max(name.length + 2, 12), 30),
    }));

    XLSX.utils.book_append_sheet(wb, ws, "Plants");
    XLSX.writeFile(wb, "plant-finder-export.xlsx");
  }

  /**
   * Select the most relevant properties for PDF (limited columns).
   */
  function selectKeyProperties(propNames, schema, maxCols) {
    const priority = [
      "title", "name", "common name", "plant name",
      "scientific name", "botanical name",
      "type", "crop type",
      "hardiness zone", "zone",
      "height", "width",
      "light", "sun", "solar access",
      "soil", "soil type",
      "biome",
      "features", "function",
    ];

    const selected = [];
    const used = new Set();

    // First: title property
    for (const p of propNames) {
      if (schema[p]?.type === "title") {
        selected.push(p);
        used.add(p);
        break;
      }
    }

    // Then priority names
    for (const key of priority) {
      if (selected.length >= maxCols) break;
      for (const p of propNames) {
        if (used.has(p)) continue;
        if (p.toLowerCase().includes(key)) {
          selected.push(p);
          used.add(p);
          break;
        }
      }
    }

    // Fill remaining from schema
    for (const p of propNames) {
      if (selected.length >= maxCols) break;
      if (used.has(p)) continue;
      selected.push(p);
      used.add(p);
    }

    return selected;
  }

  return { exportPDF, exportXLSX };
})();
