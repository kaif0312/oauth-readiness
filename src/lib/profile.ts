import profile from "@/data/profile/iskaria.json";

export { profile };

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

// Resolve "a.b" style keys against the developer profile (or another profile object, e.g. one an MCP client sends).
export function profileValue(key: string, root: Json = profile as unknown as Json): Json | undefined {
  let cur: Json | undefined = root;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && !Array.isArray(cur) && part in cur) cur = (cur as Record<string, Json>)[part];
    else return undefined;
  }
  return cur;
}

// true = profile has it, false = profile knows it's missing (null), undefined = key not in profile
export function profileHas(key: string, root?: Json): boolean | undefined {
  const v = profileValue(key, root);
  if (v === undefined) return undefined;
  if (v === null) return false;
  if (typeof v === "object" && !Array.isArray(v)) return Object.values(v).some((x) => x !== null && x !== "unknown");
  return true;
}

export function profileDisplay(key: string, root?: Json): string {
  const v = profileValue(key, root);
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
