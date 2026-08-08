import type { DownloadSeries, Ecosystem, PackageSnapshot } from "../types.js";
import { getCratesDownloads, getCratesSnapshot } from "./cratesIo.js";
import { getNpmDownloads, getNpmSnapshot } from "./npmRegistry.js";
import { getPypiDownloads, getPypiSnapshot } from "./pypi.js";

/**
 * Per-ecosystem dispatch.
 *
 * These exist so adding a member to `Ecosystem` is a compile error rather than a
 * silent data bug. The call sites previously used binary ternaries
 * (`ecosystem === "npm" ? npm : pypi`), which type-check perfectly well against a
 * three-member union and would have served PyPI data for every crate request.
 * A Record keyed by Ecosystem cannot be under-populated.
 */

export const getSnapshot: Record<Ecosystem, (name: string) => Promise<PackageSnapshot>> = {
  npm: getNpmSnapshot,
  pypi: getPypiSnapshot,
  crates: getCratesSnapshot,
};

export const getDownloads: Record<Ecosystem, (name: string, range?: string) => Promise<DownloadSeries>> =
  {
    npm: (name, range) => getNpmDownloads(name, range),
    pypi: (name) => getPypiDownloads(name),
    crates: (name) => getCratesDownloads(name),
  };

/** Human-readable upstream credited in `sourceAttribution`. */
export const REGISTRY_ATTRIBUTION: Record<Ecosystem, string> = {
  npm: "npm registry",
  pypi: "PyPI",
  crates: "crates.io",
};

/** Display name used in prose (descriptions, error messages). */
export const ECOSYSTEM_LABEL: Record<Ecosystem, string> = {
  npm: "npm",
  pypi: "PyPI",
  crates: "crates.io",
};

export const ECOSYSTEMS = Object.keys(getSnapshot) as Ecosystem[];
