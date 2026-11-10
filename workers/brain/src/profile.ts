export const USER_MD = "USER.md";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type Preferences = { [key: string]: JsonValue };

export interface Profile {
  preferences: Preferences;
  about: string;
  updated_at: string;
}

/** USER.md as the user would see it: their own text, and what the assistant learned as plain lines. */
export interface PublicProfile extends Profile {
  learned: string[];
}
