/** Discord MANAGE_GUILD permission bit. */
const MANAGE_GUILD = 0x20n;

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  permissions: string;
}

export function canManage(g: DiscordGuild): boolean {
  return (BigInt(g.permissions) & MANAGE_GUILD) === MANAGE_GUILD;
}

/** Servers the signed-in user can administer (MANAGE_GUILD). */
export async function fetchManagedGuilds(
  accessToken: string,
): Promise<DiscordGuild[]> {
  const res = await fetch("https://discord.com/api/v10/users/@me/guilds", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const all = (await res.json()) as DiscordGuild[];
  return all.filter(canManage);
}

/** Authorize a single guild for the signed-in user. */
export async function userManagesGuild(
  accessToken: string,
  guildId: string,
): Promise<boolean> {
  const managed = await fetchManagedGuilds(accessToken);
  return managed.some((g) => g.id === guildId);
}
