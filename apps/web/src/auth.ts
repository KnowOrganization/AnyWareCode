import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";

/**
 * Discord OAuth. The `guilds` scope lets us list the servers a user is in so we
 * can show only the ones they can manage (MANAGE_GUILD) where the bot is
 * installed. The access token is stashed on the JWT to call the Discord API.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Discord({
      authorization: { params: { scope: "identify guilds" } },
    }),
  ],
  callbacks: {
    jwt({ token, account, profile }) {
      if (account?.access_token) token.accessToken = account.access_token;
      if (profile?.id) token.discordId = profile.id as string;
      return token;
    },
    session({ session, token }) {
      session.accessToken = token.accessToken as string | undefined;
      session.discordId = token.discordId as string | undefined;
      return session;
    },
  },
});

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    discordId?: string;
  }
}
