const { Client } = require("@notionhq/client");

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

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
    const database = await notion.databases.retrieve({
      database_id: DATABASE_ID,
    });

    const schema = {};
    for (const [name, prop] of Object.entries(database.properties)) {
      schema[name] = {
        type: prop.type,
        name: prop.name,
      };

      if (prop.type === "select" && prop.select?.options) {
        schema[name].options = prop.select.options.map((o) => ({
          name: o.name,
          color: o.color,
        }));
      }
      if (prop.type === "multi_select" && prop.multi_select?.options) {
        schema[name].options = prop.multi_select.options.map((o) => ({
          name: o.name,
          color: o.color,
        }));
      }
      if (prop.type === "status" && prop.status?.options) {
        schema[name].options = prop.status.options.map((o) => ({
          name: o.name,
          color: o.color,
        }));
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        title:
          database.title?.map((t) => t.plain_text).join("") ||
          "Plant Database",
        schema,
      }),
    };
  } catch (error) {
    console.error("Notion API error:", error);
    return {
      statusCode: error.status || 500,
      headers,
      body: JSON.stringify({
        error: "Failed to fetch database schema",
        details: error.message,
      }),
    };
  }
};
