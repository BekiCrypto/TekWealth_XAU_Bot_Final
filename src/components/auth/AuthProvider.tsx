import React, { createContext, useContext, ReactNode } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { Database } from '../../types/database';
import type { User as SupabaseUser, Session } from '@supabase/supabase-js'; // Import SupabaseUser & Session type

type Profile = Database['public']['Tables']['profiles']['Row'];

interface AuthContextType {
  user: SupabaseUser | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (_email: string, _password: string) => Promise<{ data: { user: SupabaseUser | null; session: Session | null; } | null; error: Error | null; }>;
  signUp: (_email: string, _password: string, _fullName: string) => Promise<{ data: { user: SupabaseUser | null; session: Session | null; } | null; error: Error | null; }>;
  signOut: () => Promise<{ error: Error | null; }>;
  updateProfile: (_updates: Partial<Profile>) => Promise<{ data: Profile | null; error: Error | null; }>;
  isAdmin: boolean;
  isSubscriber: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function AuthProviderComponent({ children }: { children: ReactNode }) { // Renamed for clarity
  const auth = useAuth();

  return (
    <AuthContext.Provider value={auth}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuthContext = () => { // Keep as named export
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
};

export default AuthProviderComponent; // Default export for the component