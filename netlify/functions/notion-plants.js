const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

const CACHE_TTL = 5 * 60 * 1000;
let cachedData = null;
let cacheTimestamp = 0;

async function fetchAllPages() {
  const now = Date.now();
  if (cachedData && now - cacheTimestamp < CACHE_TTL) {
    return cachedData;
  }

  const pages = [];
  let cursor = undefined;
  let hasMore = true;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
      start_cursor: cursor,
      page_size: 100,
    });

    pages.push(...response.results);
    hasMore = response.has_more;
    cursor = response.next_cursor;
  }

  cachedData = pages;
  cacheTimestamp = now;
  return pages;
}

function extractProperty(page, propName, prop) {
  if (!prop) return null;

  switch (prop.type) {
    case "title":
      return prop.title?.map((t) => t.plain_text).join("") || null;
    case "rich_text":
      return prop.rich_text?.map((t) => t.plain_text).join("") || null;
    case "number":
      return prop.number;
    case "select":
      return prop.select?.name || null;
    case "multi_select":
      return prop.multi_select?.map((s) => s.name) || [];
    case "checkbox":
      return prop.checkbox;
    case "url":
      return prop.url;
    case "email":
      return prop.email;
    case "phone_number":
      return prop.phone_number;
    case "date":
      return prop.date?.start || null;
    case "formula":
      if (prop.formula.type === "string") return prop.formula.string;
      if (prop.formula.type === "number") return prop.formula.number;
      if (prop.formula.type === "boolean") return prop.formula.boolean;
      if (prop.formula.type === "date") return prop.formula.date?.start || null;
      return null;
    case "rollup":
      if (prop.rollup.type === "number") return prop.rollup.number;
      if (prop.rollup.type === "array")
        return prop.rollup.array?.map((item) =>
          extractProperty(page, propName, item)
        );
      return null;
    case "relation":
      return prop.relation?.map((r) => r.id) || [];
    case "files":
      return (
        prop.files?.map((f) => {
          if (f.type === "file") return f.file.url;
          if (f.type === "external") return f.external.url;
          return null;
        }) || []
      );
    case "status":
      return prop.status?.name || null;
    case "created_time":
      return prop.created_time;
    case "last_edited_time":
      return prop.last_edited_time;
    default:
      return null;
  }
}

function transformPage(page) {
  const properties = {};
  const propertyTypes = {};

  for (const [name, prop] of Object.entries(page.properties)) {
    properties[name] = extractProperty(page, name, prop);
    propertyTypes[name] = prop.type;
  }

  return {
    id: page.id,
    properties,
    propertyTypes,
    cover: page.cover?.external?.url || page.cover?.file?.url || null,
    icon: page.icon?.emoji || page.icon?.external?.url || null,
    url: page.url,
  };
}

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (!process.env.NOTION_API_KEY || !process.env.NOTION_DATABASE_ID) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Server configuration error: Notion credentials not set",
      }),
    };
  }

  try {
    const pages = await fetchAllPages();
    const plants = pages.map(transformPage);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        plants,
        total: plants.length,
        cached: Date.now() - cacheTimestamp < 1000 ? false : true,
      }),
    };
  } catch (error) {
    console.error("Notion API error:", error);
    return {
      statusCode: error.status || 500,
      headers,
      body: JSON.stringify({
        error: "Failed to fetch plants from Notion",
        details: error.message,
      }),
    };
  }
};
