/*
 * The signed-in user. Until Entra sign-in is wired up, this comes from CATALOG_USER_NAME / _EMAIL / _ROLE /
 * _TEAM, so ownership and "My solutions" work against a real person rather than a demo persona.
 */
import type { CurrentUser } from "./solutions";

export function currentUser(): CurrentUser {
  return {
    name: process.env["CATALOG_USER_NAME"]?.trim() || "Demo user",
    email: process.env["CATALOG_USER_EMAIL"]?.trim() || "",
    role: process.env["CATALOG_USER_ROLE"]?.trim() || "SE",
    team: process.env["CATALOG_USER_TEAM"]?.trim() || "",
  };
}
