// Auth.js v5 config — email+password credentials, JWT sessions (no
// database session table needed). This is the Phase 0 checkpoint item that
// was previously the biggest structural gap: without this, any tenant URL
// was viewable/actionable by anyone who had it.

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { verifyTotp } from "@/lib/auth/totp";

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        totpToken: { label: "2FA code", type: "text" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        const totpToken = credentials?.totpToken as string | undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        // 2FA is opt-in per account (see /account/security) — only
        // enforced once the user has actually set it up and confirmed it,
        // so existing accounts are never silently locked out.
        if (user.totpEnabled) {
          if (!user.totpSecret || !totpToken || !verifyTotp(user.totpSecret, totpToken)) {
            return null;
          }
        }

        return { id: user.id, email: user.email, name: user.name ?? undefined };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.userId = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.userId) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
});
