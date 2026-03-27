import type { Env } from "./types";

export function getGlobalUsersDO(env: Env) {
  return env.GLOBAL_USERS.get(env.GLOBAL_USERS.idFromName("global-users"));
}

export function getUserProjectsDO(env: Env, username: string) {
  return env.USER_PROJECTS.get(
    env.USER_PROJECTS.idFromName(`projects:${username}`),
  );
}
