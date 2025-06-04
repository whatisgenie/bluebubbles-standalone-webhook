import { isMacOSVersionGreaterThanOrEqualTo } from "macos-version";

export const isMinSequoia = isMacOSVersionGreaterThanOrEqualTo("15.0");
export const isMinSonoma = isMacOSVersionGreaterThanOrEqualTo("14.0");
export const isMinVentura = isMacOSVersionGreaterThanOrEqualTo("13.0");
export const isMinMonterey = isMacOSVersionGreaterThanOrEqualTo("12.0");
export const isMinBigSur = isMacOSVersionGreaterThanOrEqualTo("11.0");
export const isMinCatalina = isMacOSVersionGreaterThanOrEqualTo("10.15");
export const isMinMojave = isMacOSVersionGreaterThanOrEqualTo("10.14");
export const isMinHighSierra = isMacOSVersionGreaterThanOrEqualTo("10.13");
export const isMinSierra = isMacOSVersionGreaterThanOrEqualTo("10.12");