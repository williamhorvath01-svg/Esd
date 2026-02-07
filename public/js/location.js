/**
 * Location lookup module.
 * Geocodes a user-entered location, then derives:
 *   - USDA Hardiness Zone (from average annual extreme minimum temperature)
 *   - Biome estimate
 *   - Approximate chill hours
 *   - Approximate growing degree days (GDD)
 *
 * Uses the free Open-Meteo APIs for weather data and Nominatim for geocoding.
 */
const LocationModule = (() => {
  let currentData = null;

  // USDA hardiness zone boundaries (avg annual extreme min temp in °F)
  const ZONE_BOUNDARIES = [
    { zone: "1a", minF: -60 }, { zone: "1b", minF: -55 },
    { zone: "2a", minF: -50 }, { zone: "2b", minF: -45 },
    { zone: "3a", minF: -40 }, { zone: "3b", minF: -35 },
    { zone: "4a", minF: -30 }, { zone: "4b", minF: -25 },
    { zone: "5a", minF: -20 }, { zone: "5b", minF: -15 },
    { zone: "6a", minF: -10 }, { zone: "6b", minF: -5 },
    { zone: "7a", minF: 0 },   { zone: "7b", minF: 5 },
    { zone: "8a", minF: 10 },  { zone: "8b", minF: 15 },
    { zone: "9a", minF: 20 },  { zone: "9b", minF: 25 },
    { zone: "10a", minF: 30 }, { zone: "10b", minF: 35 },
    { zone: "11a", minF: 40 }, { zone: "11b", minF: 45 },
    { zone: "12a", minF: 50 }, { zone: "12b", minF: 55 },
    { zone: "13a", minF: 60 }, { zone: "13b", minF: 65 },
  ];

  function cToF(c) { return c * 9 / 5 + 32; }
  function fToC(f) { return (f - 32) * 5 / 9; }

  function getZone(minTempF) {
    for (let i = ZONE_BOUNDARIES.length - 1; i >= 0; i--) {
      if (minTempF >= ZONE_BOUNDARIES[i].minF) {
        return ZONE_BOUNDARIES[i];
      }
    }
    return ZONE_BOUNDARIES[0];
  }

  function estimateBiome(lat, lon, avgTempC, annualPrecipMm) {
    const absLat = Math.abs(lat);

    if (absLat > 66) return "Tundra";
    if (absLat > 55 && avgTempC < 5) return "Boreal Forest (Taiga)";
    if (annualPrecipMm < 250) return "Desert";
    if (absLat < 23.5 && annualPrecipMm > 2000) return "Tropical Rainforest";
    if (absLat < 23.5 && annualPrecipMm > 500) return "Tropical Seasonal Forest";
    if (absLat < 23.5 && annualPrecipMm <= 500 && annualPrecipMm > 250) return "Savanna";

    // Mediterranean: dry summers, mild winters (rough heuristic using latitude bands)
    if (absLat >= 30 && absLat <= 45 && annualPrecipMm < 900 && avgTempC > 10) return "Mediterranean";

    if (absLat >= 23.5 && absLat <= 35 && annualPrecipMm > 1000) return "Subtropical";
    if (absLat >= 35 && absLat <= 55 && annualPrecipMm > 1500) return "Temperate Rainforest";
    if (absLat >= 35 && absLat <= 55 && annualPrecipMm > 500) return "Temperate Deciduous Forest";
    if (absLat >= 35 && absLat <= 55 && annualPrecipMm <= 500) return "Temperate Grassland";

    return "Temperate Deciduous Forest";
  }

  /**
   * Estimate chill hours (hours below 45°F / 7.2°C during dormant season).
   * We use monthly average temperatures as a rough proxy.
   */
  function estimateChillHours(monthlyAvgC) {
    let chillHours = 0;
    // Dormant months: Oct (9), Nov (10), Dec (11), Jan (0), Feb (1), Mar (2)
    const dormantMonths = [9, 10, 11, 0, 1, 2];
    for (const m of dormantMonths) {
      const avgC = monthlyAvgC[m];
      // Rough model: if monthly avg is below 7.2°C, most hours count
      // If avg is between 0-7.2°C, count proportionally
      // Based on simplified Utah model
      if (avgC <= 0) {
        chillHours += 0.5 * 730; // half of month hours count (some too cold)
      } else if (avgC <= 7.2) {
        const fraction = (7.2 - avgC) / 7.2;
        chillHours += fraction * 730;
      } else if (avgC <= 13) {
        const fraction = (13 - avgC) / (13 - 7.2);
        chillHours += fraction * 0.3 * 730;
      }
    }
    return Math.round(chillHours);
  }

  /**
   * Estimate GDD (base 50°F / 10°C) from monthly averages.
   */
  function estimateGDD(monthlyAvgC) {
    const baseC = 10;
    let gdd = 0;
    for (let m = 0; m < 12; m++) {
      const diff = monthlyAvgC[m] - baseC;
      if (diff > 0) {
        gdd += diff * 30; // ~30 days per month
      }
    }
    return Math.round(gdd);
  }

  function gddCToF(gddC) {
    // GDD conversion: base 10°C = base 50°F, so GDD_F = GDD_C * 9/5
    return Math.round(gddC * 9 / 5);
  }

  /**
   * Geocode a location string using Nominatim.
   */
  async function geocode(query) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "PlantFinderApp/1.0" },
    });
    if (!res.ok) throw new Error("Geocoding service unavailable");
    const data = await res.json();
    if (!data.length) throw new Error("Location not found. Try a different city or ZIP code.");
    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      name: data[0].display_name.split(",").slice(0, 2).join(","),
    };
  }

  /**
   * Fetch climate normals from Open-Meteo Climate API.
   */
  async function fetchClimateData(lat, lon) {
    const url = `https://climate-api.open-meteo.com/v1/climate?latitude=${lat}&longitude=${lon}&models=EC_Earth3P_HR&monthly=temperature_2m_mean,precipitation_sum&start_date=2000-01-01&end_date=2019-12-31`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Climate data service unavailable");
    const data = await res.json();

    // Average monthly values over the 20-year period
    const monthly = data.monthly;
    if (!monthly || !monthly.temperature_2m_mean || !monthly.precipitation_sum) {
      throw new Error("Climate data not available for this location");
    }

    const temps = monthly.temperature_2m_mean;
    const precips = monthly.precipitation_sum;
    const monthCount = temps.length;

    // Build monthly averages
    const monthlyAvgTemp = new Array(12).fill(0);
    const monthlyAvgPrecip = new Array(12).fill(0);
    const monthlyCounts = new Array(12).fill(0);

    for (let i = 0; i < monthCount; i++) {
      const monthIdx = i % 12;
      if (temps[i] != null) {
        monthlyAvgTemp[monthIdx] += temps[i];
        monthlyCounts[monthIdx]++;
      }
      if (precips[i] != null) {
        monthlyAvgPrecip[monthIdx] += precips[i];
      }
    }

    for (let m = 0; m < 12; m++) {
      if (monthlyCounts[m] > 0) {
        monthlyAvgTemp[m] /= monthlyCounts[m];
        monthlyAvgPrecip[m] /= monthlyCounts[m];
      }
    }

    const annualAvgC = monthlyAvgTemp.reduce((a, b) => a + b, 0) / 12;
    const annualPrecipMm = monthlyAvgPrecip.reduce((a, b) => a + b, 0);
    const minMonthlyC = Math.min(...monthlyAvgTemp);

    // Estimate extreme minimum (avg of coldest month - typical diurnal range)
    const extremeMinC = minMonthlyC - 12; // rough estimate
    const extremeMinF = cToF(extremeMinC);

    return {
      monthlyAvgTemp,
      monthlyAvgPrecip,
      annualAvgC,
      annualPrecipMm,
      extremeMinC,
      extremeMinF,
      minMonthlyC,
    };
  }

  async function lookup(query) {
    const geo = await geocode(query);
    const climate = await fetchClimateData(geo.lat, geo.lon);

    const zone = getZone(climate.extremeMinF);
    const biome = estimateBiome(geo.lat, geo.lon, climate.annualAvgC, climate.annualPrecipMm);
    const chillHours = estimateChillHours(climate.monthlyAvgTemp);
    const gddC = estimateGDD(climate.monthlyAvgTemp);
    const gddF = gddCToF(gddC);

    currentData = {
      location: geo.name,
      lat: geo.lat,
      lon: geo.lon,
      zone: zone.zone.toUpperCase(),
      zoneMinF: zone.minF,
      zoneMinC: Math.round(fToC(zone.minF)),
      biome,
      chillHours,
      gddC,
      gddF,
      annualAvgC: Math.round(climate.annualAvgC * 10) / 10,
      annualAvgF: Math.round(cToF(climate.annualAvgC) * 10) / 10,
      annualPrecipMm: Math.round(climate.annualPrecipMm),
      annualPrecipIn: Math.round(climate.annualPrecipMm / 25.4 * 10) / 10,
    };

    return currentData;
  }

  function getData() {
    return currentData;
  }

  return { lookup, getData, cToF, fToC, gddCToF };
})();
