import { NextResponse } from "next/server";

const spec = {
  openapi: "3.1.0",
  info: {
    title: "Ask Arthur Threat API",
    version: "1.0.0",
    description:
      "Real-time scam and fraud threat intelligence for Australia. Access trending threats, aggregate statistics, and scam analysis.",
    contact: {
      name: "Ask Arthur",
      url: "https://askarthur.au",
    },
  },
  servers: [{ url: "https://askarthur.au", description: "Production" }],
  security: [{ ApiKeyAuth: [] }],
  paths: {
    "/api/v1/threats/trending": {
      get: {
        operationId: "getTrendingThreats",
        summary: "Get trending threats",
        description:
          "Returns the top scam types detected over a configurable time window, ranked by incident count.",
        parameters: [
          {
            name: "days",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 90, default: 7 },
            description: "Lookback window in days",
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 50, default: 10 },
            description: "Max number of threat groups to return",
          },
          {
            name: "region",
            in: "query",
            schema: { type: "string" },
            description: "Filter by ISO 3166-1 alpha-2 country code",
          },
        ],
        responses: {
          "200": {
            description: "Trending threats",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    threats: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          scamType: { type: "string" },
                          count: { type: "integer" },
                          impersonatedBrands: {
                            type: "array",
                            items: { type: "string" },
                          },
                          channels: {
                            type: "array",
                            items: { type: "string" },
                          },
                          exampleSummaries: {
                            type: "array",
                            items: { type: "string" },
                          },
                        },
                      },
                    },
                    period: { type: "string" },
                    generatedAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          "401": { description: "Invalid or missing API key" },
          "429": { description: "Rate limit exceeded" },
        },
      },
    },
    "/api/v1/threats/stats": {
      get: {
        operationId: "getThreatStats",
        summary: "Get aggregate threat statistics",
        description:
          "Returns verified threat counts across multiple time periods and the top scam types from the past week.",
        responses: {
          "200": {
            description: "Threat statistics",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    stats: {
                      type: "object",
                      properties: {
                        last24h: { type: "integer" },
                        last7d: { type: "integer" },
                        last30d: { type: "integer" },
                        topScamTypes: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              type: { type: "string" },
                              count: { type: "integer" },
                            },
                          },
                        },
                      },
                    },
                    generatedAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          "401": { description: "Invalid or missing API key" },
          "429": { description: "Rate limit exceeded" },
        },
      },
    },
    "/api/analyze": {
      post: {
        operationId: "analyzeMessage",
        summary: "Analyze a message for scams",
        description:
          "Submit text or an image for AI-powered scam detection. Returns a verdict, confidence score, red flags, and recommended next steps.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  text: {
                    type: "string",
                    maxLength: 10000,
                    description: "The suspicious message text to analyze",
                  },
                  image: {
                    type: "string",
                    description: "Base64-encoded image (max ~4MB)",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Analysis result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    verdict: {
                      type: "string",
                      enum: ["SAFE", "SUSPICIOUS", "HIGH_RISK"],
                    },
                    confidence: {
                      type: "number",
                      minimum: 0,
                      maximum: 1,
                    },
                    summary: { type: "string" },
                    redFlags: {
                      type: "array",
                      items: { type: "string" },
                    },
                    nextSteps: {
                      type: "array",
                      items: { type: "string" },
                    },
                    countryCode: {
                      type: "string",
                      nullable: true,
                    },
                  },
                  required: ["verdict", "confidence", "summary", "redFlags", "nextSteps"],
                },
              },
            },
          },
          "400": { description: "Invalid request body" },
          "429": { description: "Rate limit exceeded" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description: "API key for authenticated endpoints",
      },
    },
  },
};

export async function GET() {
  return NextResponse.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
