import { loadConfigFile } from "./config.js";
import { loadCompaniesFile, MockEnricher } from "./enrich.js";
import type { Lead } from "./model.js";

export const realConfig = () => loadConfigFile(new URL("../../config/routing.json", import.meta.url));
export const realEnricher = () =>
  new MockEnricher(loadCompaniesFile(new URL("../../data/companies.json", import.meta.url)));

export const lead = (over: Partial<Lead> = {}): Lead => ({
  email: "pat@brightpath.example",
  firstName: "Pat",
  lastName: "Doe",
  source: "other",
  ...over,
});
