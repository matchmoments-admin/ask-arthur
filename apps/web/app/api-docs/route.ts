import { ApiReference } from "@scalar/nextjs-api-reference";

const config = {
  url: "/api/v1/openapi.json",
  title: "Ask Arthur API",
};

export const GET = ApiReference(config);
