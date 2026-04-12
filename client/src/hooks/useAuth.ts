import { db, id } from "../lib/instantdb";

export function useAuth() {
  const { isLoading, user, error } = db.useAuth();

  // Once authed, ensure a profile record exists
  const profileQuery = db.useQuery(
    user
      ? { profiles: { $: { where: { odib: user.id } } } }
      : null
  );

  const profile = profileQuery.data?.profiles?.[0] ?? null;

  const sendMagicCode = (email: string) => {
    return db.auth.sendMagicCode({ email });
  };

  const verifyMagicCode = (email: string, code: string) => {
    return db.auth.signInWithMagicCode({ email, code });
  };

  const signOut = () => {
    return db.auth.signOut();
  };

  const ensureProfile = (name: string) => {
    if (!user) return;
    if (profile) {
      // Update name if changed
      if (profile.name !== name) {
        db.transact(db.tx.profiles[profile.id].update({ name }));
      }
      return;
    }
    // Create new profile
    db.transact(
      db.tx.profiles[id()].update({
        odib: user.id,
        name,
        wins: 0,
        losses: 0,
        draws: 0,
        createdAt: Date.now(),
      })
    );
  };

  return {
    isLoading: isLoading || (user && profileQuery.isLoading),
    user,
    profile,
    error,
    sendMagicCode,
    verifyMagicCode,
    signOut,
    ensureProfile,
  };
}
